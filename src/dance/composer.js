// 振り付けの自動作成: 曲の拍・構成・盛り上がりに合わせてムーブを並べる
import { MOVES, MOVE_BY_ID } from './moves.js';
import { neutralPose, blendPose, mirrorPose, copyPose } from './pose.js';
import { Rng, smoother } from '../util/math.js';

export const STYLES = {
  auto: 'おまかせ',
  cute: 'かわいい',
  cool: 'クール',
  power: 'パワフル',
  elegant: 'しっとり',
};

const baseLabel = (l) => l.replace(/[0-9０-９'’]+$/, '').replace(/^ラスト/, '');

export function composeChoreography(song, { style = 'auto', seed = 1, hasLyrics = false } = {}) {
  const rng = new Rng(seed * 7919 + 13);
  let st = style;
  if (st === 'auto') {
    if (song.style) st = song.style;
    else {
      const avgE = song.sections.reduce((s, x) => s + x.energy * (x.endBeat - x.startBeat), 0) / Math.max(1, song.sections.reduce((s, x) => s + x.endBeat - x.startBeat, 0));
      st = song.bpm < 95 ? 'elegant' : avgE > 1.8 ? (song.bpm > 135 ? 'power' : 'cool') : 'cute';
    }
  }
  const pool = MOVES.filter((m) => !m.special && !m.pose);
  const poses = MOVES.filter((m) => m.pose);
  const recent = [];

  const pick = (energy, beatsLeft, opts = {}) => {
    const cands = pool.filter((m) => m.beats <= beatsLeft && (!opts.noAccent || !m.accent));
    return rng.weighted(cands, (m) => {
      let w = 1;
      const [lo, hi] = m.energy;
      if (energy < lo) w *= lo - energy === 1 ? 0.12 : 0;
      else if (energy > hi) w *= energy - hi === 1 ? 0.2 : 0.02;
      w *= m.tags.includes(st) ? 3 : 0.35;
      if (recent.includes(m.id)) w *= 0.08;
      if (m.sing) w *= hasLyrics && energy <= 2 ? 2.2 : 0.4;
      if (m.accent) w *= 0.35;
      return w;
    });
  };
  const use = (id) => { recent.push(id); if (recent.length > 4) recent.shift(); };

  const timeline = [];
  const add = (start, move, mirror = false, energy = 1) => {
    timeline.push({ start, beats: move.beats, move, mirror, energy });
    use(move.id);
  };

  const memory = {}; // 同じ種類のセクションは同じ振り付けにする
  const sections = song.sections;
  const db = song.firstDownbeat || 0;

  // 最初の小節頭より前
  if (db > 0) add(0, MOVE_BY_ID.idle, false, 0);

  sections.forEach((sec, si) => {
    const s0 = Math.max(sec.startBeat, si === 0 ? db : sec.startBeat);
    const s1 = sec.endBeat;
    let len = s1 - s0;
    if (len <= 0) return;
    const e = sec.energy;
    const prevE = si > 0 ? sections[si - 1].energy : 0;
    const nextSec = sections[si + 1];
    const isLast = si === sections.length - 1;
    let b = s0;
    const seq = [];

    // 登場
    if (si === 0 && e <= 1 && len >= 8) { seq.push({ move: MOVE_BY_ID.intro, mirror: false }); b += 8; }

    const key = baseLabel(sec.label) + '_' + e;
    const remembered = memory[key];
    // 盛り上がりの入り
    const accentStart = e >= 3 && prevE < 3;
    // 区切りの決めポーズ
    const endPose = !isLast && e >= 1 && len >= 8 && (nextSec && Math.abs(nextSec.energy - e) >= 1 || rng.chance(0.3));
    const endBow = isLast;
    let bodyEnd = s1 - (endPose ? 2 : 0) - (endBow ? 8 : 0);
    if (endBow && bodyEnd - b < 0) bodyEnd = b;

    if (remembered) {
      // 覚えている振り付けを繰り返す(長さが足りないところは新しく作る)
      for (const it of remembered) {
        if (b + it.move.beats > bodyEnd) break;
        seq.push(it); b += it.move.beats;
      }
    }
    {
      const made = [];
      if (!remembered && accentStart && b + 4 <= bodyEnd) {
        const acc = rng.weighted(pool.filter((m) => m.accent), (m) => (m.tags.includes(st) ? 3 : 1));
        made.push({ move: acc, mirror: false }); seq.push(made[made.length - 1]); b += 4;
      }
      // 8拍フレーズ: A, A(反転), B, B(反転) ...
      while (b + 4 <= bodyEnd) {
        const room = bodyEnd - b;
        const m = pick(e, Math.min(room, 8), { noAccent: made.length < 1 && !accentStart });
        const mirrorFirst = rng.chance(0.5);
        made.push({ move: m, mirror: mirrorFirst }); seq.push(made[made.length - 1]); b += m.beats;
        if (m.beats <= 4 && b + m.beats <= bodyEnd) {
          // 反転して繰り返す(ダンスらしい左右対称)
          const rep = { move: m, mirror: !mirrorFirst };
          made.push(rep); seq.push(rep); b += m.beats;
        }
      }
      if (!remembered) memory[key] = made;
    }
    // 端数
    if (b < bodyEnd) {
      const fill = pool.filter((m) => m.beats <= bodyEnd - b);
      if (fill.length) { const m = rng.pick(fill); seq.push({ move: m, mirror: false }); b += m.beats; }
      else b = bodyEnd;
    }
    if (endPose) { seq.push({ move: rng.weighted(poses, (m) => (m.tags.includes(st) ? 3 : 1)), mirror: rng.chance(0.5) }); }
    if (endBow) seq.push({ move: MOVE_BY_ID.bow, mirror: false });

    let t = s0;
    for (const it of seq) {
      add(t, it.move, it.mirror, e);
      t += it.move.beats;
    }
  });

  // 曲の後はおじぎの後ずっと立つ
  return new Choreography(timeline, st);
}

export class Choreography {
  constructor(timeline, style) {
    this.timeline = timeline.sort((a, b) => a.start - b.start);
    this.style = style;
    this._a = neutralPose();
    this._b = neutralPose();
    this._tmp = neutralPose();
    this.blendBeats = 0.4;
  }

  find(beat) {
    const tl = this.timeline;
    let lo = 0, hi = tl.length - 1, ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (tl[mid].start <= beat) { ans = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return ans;
  }

  evalEntry(entry, phase, out, ctx) {
    copyPose(out, NEUTRAL);
    const ph = Math.max(0, Math.min(entry.beats - 1e-4, phase));
    entry.move.fn(out, ph, ctx);
    if (entry.mirror) copyPose(out, mirrorPose(out));
    return out;
  }

  // beat(小数)のポーズを out に書く
  sample(beat, out, ctx = { e: 0.6 }) {
    const i = this.find(beat);
    if (i < 0) { copyPose(out, NEUTRAL); return { entry: null, phase: 0 }; }
    const cur = this.timeline[i];
    const phase = beat - cur.start;
    const c2 = { ...ctx, e: Math.min(1, (cur.energy + 1) / 4 + (ctx.boost || 0)) };
    if (phase > cur.beats) {
      // 最後のムーブの後: 立ちポーズへゆっくり戻す
      this.evalEntry(cur, cur.beats, this._a, c2);
      const k = smoother((phase - cur.beats) / 2);
      blendPose(out, this._a, NEUTRAL, k);
      return { entry: cur, phase };
    }
    this.evalEntry(cur, phase, this._a, c2);
    if (phase < this.blendBeats && i > 0) {
      const prev = this.timeline[i - 1];
      this.evalEntry(prev, beat - prev.start, this._b, c2);
      blendPose(out, this._b, this._a, smoother(phase / this.blendBeats));
    } else copyPose(out, this._a);
    return { entry: cur, phase };
  }
}

const NEUTRAL = neutralPose();

// 時刻 → 拍(小数)
export function timeToBeat(beats, t) {
  if (!beats.length) return 0;
  if (t <= beats[0]) {
    const spb = beats[1] - beats[0] || 0.5;
    return (t - beats[0]) / spb;
  }
  const n = beats.length;
  if (t >= beats[n - 1]) {
    const spb = beats[n - 1] - beats[n - 2] || 0.5;
    return n - 1 + (t - beats[n - 1]) / spb;
  }
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (beats[m] <= t) lo = m; else hi = m; }
  return lo + (t - beats[lo]) / (beats[hi] - beats[lo]);
}

export function beatToTime(beats, b) {
  const n = beats.length;
  if (b <= 0) return beats[0] + b * (beats[1] - beats[0]);
  if (b >= n - 1) return beats[n - 1] + (b - n + 1) * (beats[n - 1] - beats[n - 2]);
  const i = Math.floor(b);
  return beats[i] + (b - i) * (beats[i + 1] - beats[i]);
}
