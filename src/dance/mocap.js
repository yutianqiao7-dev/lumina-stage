// 本物のダンス(AIST++ モーションキャプチャー、Google LLC, CC BY 4.0)で踊らせる振付エンジン
// 曲の拍に合わせて、ダンサーの振りを「8拍のかたまり」単位でつなぎ、テンポに合わせて伸び縮みさせる
import { Rng, smoother, clamp } from '../util/math.js';

export const J = 22; // 関節数
export const MOCAP_STYLES = {
  // 振付スタイル → 使うジャンル(重み)
  cute: { PO: 3, LO: 2, JS: 2, HO: 1 },
  cool: { LH: 3, MH: 2, WA: 2, JS: 2, PO: 1 },
  power: { KR: 2, HO: 3, MH: 2, LH: 1 },
  elegant: { JB: 4, WA: 1, PO: 1 },
};

let libPromise = null;
export function loadDanceLibrary(base = './dances/', name = 'aist') {
  if (libPromise) return libPromise;
  libPromise = (async () => {
    const [meta, bin] = await Promise.all([
      fetch(base + name + '.json').then((r) => { if (!r.ok) throw new Error('aist.json ' + r.status); return r.json(); }),
      fetch(base + name + '.bin').then((r) => { if (!r.ok) throw new Error('aist.bin ' + r.status); return r.arrayBuffer(); }),
    ]);
    const clips = [];
    for (const c of meta.clips) {
      // 動きがほぼ無いもの・乱れが大きいものは使わない
      if (c.energy < 6 || c.energy > 76) continue;
      const q = new Int16Array(bin, c.offset, c.frames * J * 4);
      const root = new Int16Array(bin, c.offset + c.frames * J * 4 * 2, c.frames * 3);
      clips.push({ ...c, q, root, spb: 60 / c.bpm });
    }
    // 勢いの順位(0..1)
    const segs = [];
    for (const c of clips) c.seg.forEach((e) => segs.push(e));
    segs.sort((a, b) => a - b);
    const rank = (e) => { let lo = 0, hi = segs.length; while (lo < hi) { const m = (lo + hi) >> 1; if (segs[m] < e) lo = m + 1; else hi = m; } return lo / segs.length; };
    for (const c of clips) c.segRank = c.seg.map(rank);
    return { meta, clips, genres: meta.genres };
  })();
  return libPromise;
}

// clip の時刻 t(秒)のフレームを out に書く(フレーム間は補間)
const MIRROR_IDX = [0, 2, 1, 3, 5, 4, 6, 8, 7, 9, 11, 10, 12, 14, 13, 15, 17, 16, 19, 18, 21, 20];
export function sampleClip(clip, t, outQ, outRoot, mirror = false) {
  const fps = clip.fps;
  let f = t * fps;
  const n = clip.frames;
  f = clamp(f, 0, n - 1.001);
  const i0 = Math.floor(f), a = f - i0, i1 = Math.min(n - 1, i0 + 1);
  const q = clip.q, r = clip.root;
  for (let j = 0; j < J; j++) {
    const src = mirror ? MIRROR_IDX[j] : j;
    const o0 = (i0 * J + src) * 4, o1 = (i1 * J + src) * 4;
    let x0 = q[o0], y0 = q[o0 + 1], z0 = q[o0 + 2], w0 = q[o0 + 3];
    let x1 = q[o1], y1 = q[o1 + 1], z1 = q[o1 + 2], w1 = q[o1 + 3];
    if (x0 * x1 + y0 * y1 + z0 * z1 + w0 * w1 < 0) { x1 = -x1; y1 = -y1; z1 = -z1; w1 = -w1; }
    let x = x0 + (x1 - x0) * a, y = y0 + (y1 - y0) * a, z = z0 + (z1 - z0) * a, w = w0 + (w1 - w0) * a;
    if (mirror) { y = -y; z = -z; }
    const l = Math.hypot(x, y, z, w) || 1;
    outQ[j * 4] = x / l; outQ[j * 4 + 1] = y / l; outQ[j * 4 + 2] = z / l; outQ[j * 4 + 3] = w / l;
  }
  const r0 = i0 * 3, r1 = i1 * 3;
  outRoot[0] = ((r[r0] + (r[r1] - r[r0]) * a) / 1000) * (mirror ? -1 : 1);
  outRoot[1] = (r[r0 + 1] + (r[r1 + 1] - r[r0 + 1]) * a) / 1000;
  outRoot[2] = (r[r0 + 2] + (r[r1 + 2] - r[r0 + 2]) * a) / 1000;
}

function blendFrames(qa, ra, qb, rb, t, outQ, outR) {
  for (let j = 0; j < J; j++) {
    const o = j * 4;
    let bx = qb[o], by = qb[o + 1], bz = qb[o + 2], bw = qb[o + 3];
    if (qa[o] * bx + qa[o + 1] * by + qa[o + 2] * bz + qa[o + 3] * bw < 0) { bx = -bx; by = -by; bz = -bz; bw = -bw; }
    const x = qa[o] + (bx - qa[o]) * t, y = qa[o + 1] + (by - qa[o + 1]) * t, z = qa[o + 2] + (bz - qa[o + 2]) * t, w = qa[o + 3] + (bw - qa[o + 3]) * t;
    const l = Math.hypot(x, y, z, w) || 1;
    outQ[o] = x / l; outQ[o + 1] = y / l; outQ[o + 2] = z / l; outQ[o + 3] = w / l;
  }
  for (let k = 0; k < 3; k++) outR[k] = ra[k] + (rb[k] - ra[k]) * t;
}

export function newFrame() { return { q: new Float32Array(J * 4), root: new Float32Array(3) }; }

const baseLabel = (l) => l.replace(/[0-9０-９'’]+$/, '').replace(/^ラスト/, '');

export function composeMocap(lib, song, { style = 'auto', seed = 1 } = {}) {
  const rng = new Rng(seed * 104729 + 7);
  let st = style;
  if (!MOCAP_STYLES[st]) {
    st = song.style && MOCAP_STYLES[song.style] ? song.style : song.bpm < 95 ? 'elegant' : song.bpm >= 125 ? 'power' : 'cool';
  }
  const gw = MOCAP_STYLES[st];
  const bpm = song.bpm;
  // 曲のテンポに合う(倍・半分も含む)クリップを候補にする
  const cands = lib.clips.filter((c) => gw[c.genre]).map((c) => {
    let best = null;
    for (const f of [1, 0.5, 2]) {
      const ratio = (bpm * f) / c.bpm; // >1 なら速く再生
      const cost = Math.abs(Math.log2(ratio));
      if (!best || cost < best.cost) best = { f, ratio, cost };
    }
    return { clip: c, ...best };
  }).filter((x) => x.cost < 0.32);
  const pool = cands.length ? cands : lib.clips.map((c) => ({ clip: c, f: 1, ratio: bpm / c.bpm, cost: Math.abs(Math.log2(bpm / c.bpm)) }));

  const recentClips = [];
  let lastGenre = null;
  // 1つの「かたまり」: クリップの 8拍 × n
  const pickPhrase = (energy, songBeats) => {
    const targetRank = [0.12, 0.38, 0.62, 0.85][energy] ?? 0.5;
    const items = [];
    for (const p of pool) {
      const c = p.clip;
      for (let s = 0; s < c.seg.length; s++) {
        let w = (gw[c.genre] || 0.2);
        w *= Math.exp(-Math.pow((c.segRank[s] - targetRank) / 0.18, 2));
        w *= Math.exp(-p.cost * 6);
        if (!c.beatok) w *= 0.5;
        if (recentClips.includes(c.id)) w *= 0.05;
        if (lastGenre && c.genre === lastGenre) w *= 4; // 同じセクションではジャンルをそろえる
        if (c.move > 1.4) w *= 0.4; // 大きく移動するものは控えめ
        if (w > 1e-4) items.push({ p, s, w });
      }
    }
    const it = rng.weighted(items, (x) => x.w);
    recentClips.push(it.p.clip.id); if (recentClips.length > 6) recentClips.shift();
    lastGenre = it.p.clip.genre;
    // 同じクリップの続きの 8拍も使えるだけ使う(最大 songBeats)
    const c = it.p.clip;
    const clipBeatsAvail = (c.seg.length - it.s) * 8;
    const songBeatsAvail = clipBeatsAvail / it.p.f;
    return { clip: c, f: it.p.f, startClipBeat: it.s * 8, maxSongBeats: Math.max(8, Math.floor(songBeatsAvail / 4) * 4) };
  };

  const timeline = [];
  const memory = {};
  const sections = song.sections;
  const db = song.firstDownbeat || 0;
  if (db > 0) {
    const ph = pickPhrase(0, db);
    timeline.push({ start: 0, beats: db, ...ph });
  }
  sections.forEach((sec, si) => {
    const s0 = Math.max(sec.startBeat, si === 0 ? db : sec.startBeat);
    const s1 = sec.endBeat;
    if (s1 <= s0) return;
    const key = baseLabel(sec.label) + '_' + sec.energy;
    const seq = memory[key] ? memory[key].slice() : [];
    const made = [];
    let b = s0;
    // 覚えている振りを繰り返す
    for (const it of seq) {
      if (b >= s1) break;
      const len = Math.min(it.beats, s1 - b);
      timeline.push({ ...it, start: b, beats: len });
      b += len;
    }
    if (!seq.length) lastGenre = null;
    while (b < s1 - 0.01) {
      const ph = pickPhrase(sec.energy, s1 - b);
      const len = Math.min(ph.maxSongBeats, 32, s1 - b);
      const ent = { ...ph, start: b, beats: len };
      timeline.push(ent); made.push(ent);
      b += len;
    }
    if (!memory[key]) memory[key] = made.map((e) => ({ clip: e.clip, f: e.f, startClipBeat: e.startClipBeat, maxSongBeats: e.maxSongBeats, beats: e.beats }));
  });
  return new MocapChoreography(timeline, st, lib);
}

export class MocapChoreography {
  constructor(timeline, style, lib) {
    this.timeline = timeline.sort((a, b) => a.start - b.start);
    this.style = style;
    this.lib = lib;
    this.kind = 'mocap';
    this.blendBeats = 0.6;
    this._a = newFrame(); this._b = newFrame();
  }

  find(beat) {
    const tl = this.timeline;
    let lo = 0, hi = tl.length - 1, ans = -1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (tl[m].start <= beat) { ans = m; lo = m + 1; } else hi = m - 1; }
    return ans;
  }

  evalEntry(e, beat, out, mirror) {
    // 曲の拍 → クリップの拍 → クリップの時刻
    const clipBeat = e.startClipBeat + Math.max(0, beat - e.start) * e.f;
    const t = e.clip.beat0 + clipBeat * e.clip.spb;
    sampleClip(e.clip, t, out.q, out.root, mirror);
  }

  sample(beat, out, mirror = false) {
    const i = this.find(Math.max(beat, 0));
    const cur = this.timeline[Math.max(0, i)];
    if (!cur) return null;
    // 曲が終わった後はゆっくり止まる
    const b = Math.min(beat, cur.start + cur.beats + 2);
    this.evalEntry(cur, b, this._a, mirror);
    const ph = beat - cur.start;
    if (ph < this.blendBeats && i > 0) {
      const prev = this.timeline[i - 1];
      this.evalEntry(prev, beat, this._b, mirror);
      blendFrames(this._b.q, this._b.root, this._a.q, this._a.root, smoother(ph / this.blendBeats), out.q, out.root);
    } else { out.q.set(this._a.q); out.root.set(this._a.root); }
    return cur;
  }
}

// 曲が始まる前などの待機: ゆったりした振りをくり返す
export function makeIdleMocap(lib) {
  const calm = lib.clips.filter((c) => c.genre === 'PO' || c.genre === 'JB' || c.genre === 'LO').sort((a, b) => a.energy - b.energy);
  const clip = calm[Math.floor(calm.length * 0.3)] || lib.clips[0];
  return {
    clip,
    sample(beat, out, mirror = false) {
      const total = Math.max(8, Math.floor(clip.beats / 8) * 8);
      const cb = ((beat % total) + total) % total;
      sampleClip(clip, clip.beat0 + cb * clip.spb, out.q, out.root, mirror);
    },
  };
}
