// デモ曲をその場で作曲・演奏して AudioBuffer にする(著作権フリーの自作曲)
import { Rng } from '../util/math.js';

const SR = 44100;
const SCALES = {
  minor: [0, 2, 3, 5, 7, 8, 10],
  major: [0, 2, 4, 5, 7, 9, 11],
};
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

function scaleNote(def, degree, octave = 0) {
  const sc = SCALES[def.mode];
  const o = Math.floor(degree / 7);
  const d = ((degree % 7) + 7) % 7;
  return def.key + sc[d] + 12 * (o + octave);
}

function chordNotes(def, degree, oct = 0, seventh = false) {
  const n = [scaleNote(def, degree, oct), scaleNote(def, degree + 2, oct), scaleNote(def, degree + 4, oct)];
  if (seventh) n.push(scaleNote(def, degree + 6, oct));
  return n;
}

const _cache = {};
function makeNoise(ctx, seconds = 2) {
  if (_cache['n' + seconds]) return _cache['n' + seconds];
  const buf = _cache['n' + seconds] = new AudioBuffer({ length: SR * seconds, numberOfChannels: 1, sampleRate: SR });
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

function makeImpulse(ctx, seconds = 3.2, decay = 2.6) {
  if (_cache.ir) return _cache.ir;
  const len = Math.floor(SR * seconds);
  const buf = _cache.ir = new AudioBuffer({ length: len, numberOfChannels: 2, sampleRate: SR });
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) {
      const t = i / len;
      d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay) * (i < 200 ? i / 200 : 1);
    }
  }
  return buf;
}

// ---------------- 楽器 ----------------
class Instruments {
  constructor(ctx, def) {
    this.ctx = ctx;
    this.def = def;
    this.noise = makeNoise(ctx, 3);

    // バス構成
    this.master = ctx.createGain(); this.master.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 8; comp.ratio.value = 4;
    comp.attack.value = 0.004; comp.release.value = 0.18;
    this.master.connect(comp); comp.connect(ctx.destination);

    this.reverb = ctx.createConvolver(); this.reverb.buffer = makeImpulse(ctx);
    const revGain = ctx.createGain(); revGain.gain.value = 0.32;
    this.reverb.connect(revGain); revGain.connect(this.master);

    this.delay = ctx.createDelay(2);
    this.delay.delayTime.value = (60 / def.bpm) * 0.75;
    const fb = ctx.createGain(); fb.gain.value = 0.32;
    const dlp = ctx.createBiquadFilter(); dlp.type = 'lowpass'; dlp.frequency.value = 3800;
    this.delay.connect(dlp); dlp.connect(fb); fb.connect(this.delay);
    const delOut = ctx.createGain(); delOut.gain.value = 0.38;
    dlp.connect(delOut); delOut.connect(this.master); delOut.connect(this.reverb);

    // サイドチェイン(キックで沈む)を受ける音楽バス
    this.duck = ctx.createGain(); this.duck.gain.value = 1;
    this.musicFilter = ctx.createBiquadFilter(); this.musicFilter.type = 'lowpass';
    this.musicFilter.frequency.value = 18000; this.musicFilter.Q.value = 0.8;
    this.duck.connect(this.musicFilter); this.musicFilter.connect(this.master);

    this.drums = ctx.createGain(); this.drums.gain.value = 1; this.drums.connect(this.master);
  }

  send(node, rev = 0.2, del = 0) {
    if (rev > 0) { const g = this.ctx.createGain(); g.gain.value = rev; node.connect(g); g.connect(this.reverb); }
    if (del > 0) { const g = this.ctx.createGain(); g.gain.value = del; node.connect(g); g.connect(this.delay); }
  }

  duckAt(t, depth = 0.55, rel = 0.22) {
    const g = this.duck.gain;
    g.setValueAtTime(1, t);
    g.linearRampToValueAtTime(1 - depth, t + 0.008);
    g.setTargetAtTime(1, t + 0.02, rel / 3);
  }

  kick(t, vel = 1) {
    const c = this.ctx;
    const o = c.createOscillator(); o.type = 'sine';
    const g = c.createGain();
    o.frequency.setValueAtTime(165, t);
    o.frequency.exponentialRampToValueAtTime(48, t + 0.11);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.4);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(1.05 * vel, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.48);
    o.connect(g); g.connect(this.drums);
    o.start(t); o.stop(t + 0.5);
    // クリック
    const n = c.createBufferSource(); n.buffer = this.noise;
    const nf = c.createBiquadFilter(); nf.type = 'highpass'; nf.frequency.value = 2500;
    const ng = c.createGain();
    ng.gain.setValueAtTime(0.25 * vel, t); ng.gain.exponentialRampToValueAtTime(0.001, t + 0.02);
    n.connect(nf); nf.connect(ng); ng.connect(this.drums);
    n.start(t, Math.random()); n.stop(t + 0.03);
  }

  clap(t, vel = 1) {
    const c = this.ctx;
    const n = c.createBufferSource(); n.buffer = this.noise;
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1500; f.Q.value = 0.9;
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    // 手拍子らしい3連アタック
    for (let i = 0; i < 3; i++) {
      g.gain.linearRampToValueAtTime(0.75 * vel, t + i * 0.011 + 0.001);
      g.gain.linearRampToValueAtTime(0.15 * vel, t + i * 0.011 + 0.009);
    }
    g.gain.linearRampToValueAtTime(0.6 * vel, t + 0.035);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
    n.connect(f); f.connect(g); g.connect(this.drums);
    this.send(g, 0.35);
    n.start(t, Math.random() * 2); n.stop(t + 0.3);
    // 胴鳴り
    const o = c.createOscillator(); o.type = 'triangle';
    o.frequency.setValueAtTime(240, t); o.frequency.exponentialRampToValueAtTime(160, t + 0.08);
    const og = c.createGain(); og.gain.setValueAtTime(0.25 * vel, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    o.connect(og); og.connect(this.drums); o.start(t); o.stop(t + 0.13);
  }

  snare(t, vel = 1) {
    const c = this.ctx;
    const n = c.createBufferSource(); n.buffer = this.noise;
    const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 1200;
    const g = c.createGain();
    g.gain.setValueAtTime(0.55 * vel, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    n.connect(f); f.connect(g); g.connect(this.drums);
    this.send(g, 0.2);
    n.start(t, Math.random() * 2); n.stop(t + 0.18);
  }

  hat(t, vel = 1, open = false) {
    const c = this.ctx;
    const n = c.createBufferSource(); n.buffer = this.noise;
    const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = open ? 7000 : 8500;
    const f2 = c.createBiquadFilter(); f2.type = 'peaking'; f2.frequency.value = 10000; f2.gain.value = 6;
    const g = c.createGain();
    const len = open ? 0.32 : 0.045;
    g.gain.setValueAtTime(0.32 * vel, t); g.gain.exponentialRampToValueAtTime(0.001, t + len);
    n.connect(f); f.connect(f2); f2.connect(g); g.connect(this.drums);
    n.start(t, Math.random() * 2); n.stop(t + len + 0.02);
  }

  crash(t, vel = 1) {
    const c = this.ctx;
    const n = c.createBufferSource(); n.buffer = this.noise;
    const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 4500;
    const g = c.createGain();
    g.gain.setValueAtTime(0.4 * vel, t); g.gain.exponentialRampToValueAtTime(0.001, t + 2.4);
    n.connect(f); f.connect(g); g.connect(this.drums);
    this.send(g, 0.4);
    n.start(t, 0); n.stop(t + 2.5);
  }

  riser(t, dur) {
    const c = this.ctx;
    const n = c.createBufferSource(); n.buffer = this.noise; n.loop = true;
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 3;
    f.frequency.setValueAtTime(400, t); f.frequency.exponentialRampToValueAtTime(9000, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.3, t + dur);
    g.gain.linearRampToValueAtTime(0, t + dur + 0.05);
    n.connect(f); f.connect(g); g.connect(this.master); this.send(g, 0.5);
    n.start(t); n.stop(t + dur + 0.1);
  }

  impact(t) {
    const c = this.ctx;
    const o = c.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(90, t); o.frequency.exponentialRampToValueAtTime(30, t + 1.2);
    const g = c.createGain(); g.gain.setValueAtTime(0.7, t); g.gain.exponentialRampToValueAtTime(0.001, t + 1.5);
    o.connect(g); g.connect(this.master); this.send(g, 0.6);
    o.start(t); o.stop(t + 1.6);
  }

  bass(t, midi, dur, vel = 1, bright = 1) {
    const c = this.ctx;
    const f0 = mtof(midi);
    const o1 = c.createOscillator(); o1.type = 'sawtooth'; o1.frequency.value = f0;
    const o2 = c.createOscillator(); o2.type = 'square'; o2.frequency.value = f0 / 2;
    const sub = c.createGain(); sub.gain.value = 0.5;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 6;
    lp.frequency.setValueAtTime(180 + 1400 * bright, t);
    lp.frequency.exponentialRampToValueAtTime(140 + 300 * bright, t + Math.min(dur, 0.25));
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.42 * vel, t + 0.006);
    g.gain.setValueAtTime(0.36 * vel, t + dur * 0.8);
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    o1.connect(lp); o2.connect(sub); sub.connect(lp); lp.connect(g); g.connect(this.duck);
    o1.start(t); o2.start(t); o1.stop(t + dur + 0.02); o2.stop(t + dur + 0.02);
  }

  pad(t, notes, dur, vel = 1, cutoff = 2200) {
    const c = this.ctx;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = cutoff; lp.Q.value = 0.5;
    const g = c.createGain();
    const att = Math.min(0.5, dur * 0.3);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.07 * vel, t + att);
    g.gain.setValueAtTime(0.07 * vel, t + dur - 0.1);
    g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.35);
    lp.connect(g); g.connect(this.duck); this.send(g, 0.45);
    for (const m of notes) {
      for (const det of [-9, 0, 9]) {
        const o = c.createOscillator(); o.type = 'sawtooth';
        o.frequency.value = mtof(m); o.detune.value = det;
        o.connect(lp); o.start(t); o.stop(t + dur + 0.4);
      }
    }
  }

  stab(t, notes, dur, vel = 1) {
    // 明るいスーパーソウのコード
    const c = this.ctx;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 2;
    lp.frequency.setValueAtTime(6500, t); lp.frequency.exponentialRampToValueAtTime(1600, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.06 * vel, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    lp.connect(g); g.connect(this.duck); this.send(g, 0.3, 0.25);
    for (const m of notes) {
      for (const det of [-14, -5, 5, 14]) {
        const o = c.createOscillator(); o.type = 'sawtooth';
        o.frequency.value = mtof(m); o.detune.value = det;
        o.connect(lp); o.start(t); o.stop(t + dur + 0.05);
      }
    }
  }

  pluck(t, midi, dur, vel = 1) {
    const c = this.ctx;
    const o = c.createOscillator(); o.type = 'square'; o.frequency.value = mtof(midi);
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 4;
    lp.frequency.setValueAtTime(5000, t); lp.frequency.exponentialRampToValueAtTime(500, t + 0.18);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.09 * vel, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.001, t + Math.max(0.2, dur));
    o.connect(lp); lp.connect(g); g.connect(this.duck); this.send(g, 0.25, 0.4);
    o.start(t); o.stop(t + Math.max(0.2, dur) + 0.05);
  }

  lead(t, midi, dur, vel = 1, bright = 1) {
    // 歌メロ役。2本のノコギリ波+ビブラート
    const c = this.ctx;
    const f = mtof(midi);
    const lfo = c.createOscillator(); lfo.frequency.value = 5.2;
    const lfoG = c.createGain(); lfoG.gain.setValueAtTime(0, t); lfoG.gain.linearRampToValueAtTime(f * 0.006, t + Math.min(dur, 0.4));
    lfo.connect(lfoG);
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 1.5;
    lp.frequency.setValueAtTime(1200 + 3200 * bright, t);
    lp.frequency.linearRampToValueAtTime(900 + 1800 * bright, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.11 * vel, t + 0.02);
    g.gain.setValueAtTime(0.095 * vel, t + Math.max(0.03, dur - 0.05));
    g.gain.linearRampToValueAtTime(0.0001, t + dur + 0.06);
    lp.connect(g); g.connect(this.master); this.send(g, 0.35, 0.3);
    for (const [type, det] of [['sawtooth', -7], ['sawtooth', 7], ['triangle', 1200]]) {
      const o = c.createOscillator(); o.type = type; o.frequency.value = f; o.detune.value = det;
      lfoG.connect(o.frequency);
      const og = c.createGain(); og.gain.value = type === 'triangle' ? 0.4 : 1;
      o.connect(og); og.connect(lp); o.start(t); o.stop(t + dur + 0.1);
    }
    lfo.start(t); lfo.stop(t + dur + 0.1);
  }

  bell(t, midi, vel = 1) {
    const c = this.ctx;
    const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = mtof(midi);
    const m = c.createOscillator(); m.type = 'sine'; m.frequency.value = mtof(midi) * 3.5;
    const mg = c.createGain(); mg.gain.setValueAtTime(mtof(midi) * 2, t); mg.gain.exponentialRampToValueAtTime(1, t + 1.2);
    m.connect(mg); mg.connect(o.frequency);
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.08 * vel, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.6);
    o.connect(g); g.connect(this.duck); this.send(g, 0.5, 0.35);
    o.start(t); m.start(t); o.stop(t + 1.7); m.stop(t + 1.7);
  }
}

// ---------------- メロディ生成 ----------------
const RHYTHMS = [
  // 1小節ぶんの [開始拍, 長さ拍]
  [[0, 1], [1, 0.5], [1.5, 0.5], [2, 1.5], [3.5, 0.5]],
  [[0, 0.5], [0.5, 0.5], [1, 1], [2, 0.5], [2.5, 0.5], [3, 1]],
  [[0.5, 0.5], [1, 0.5], [1.5, 1], [2.5, 0.5], [3, 1]],
  [[0, 1.5], [1.5, 0.5], [2, 0.5], [2.5, 1.5]],
  [[0, 0.75], [0.75, 0.75], [1.5, 0.5], [2, 1], [3, 0.5], [3.5, 0.5]],
  [[0, 2], [2, 1], [3, 1]],
];

function makeMotif(def, rng, bars, chordDegs, baseDeg, density) {
  // 4小節単位のモチーフ → [{beat, len, midi}]
  const notes = [];
  let deg = baseDeg;
  for (let b = 0; b < bars; b++) {
    const pool = density > 0.6 ? [0, 1, 2, 4] : density > 0.3 ? [0, 1, 3, 4] : [3, 5, 0];
    let rhythm = RHYTHMS[pool[Math.floor(rng.next() * pool.length)]];
    if (b === bars - 1) rhythm = [[0, 1], [1, 1], [2, 2]]; // フレーズ終わりは伸ばす
    const chord = chordDegs[b % chordDegs.length];
    rhythm.forEach(([st, len], i) => {
      const strong = st === 0 || st === 2;
      if (strong) {
        // コードトーンへ寄せる
        const tones = [chord, chord + 2, chord + 4, chord + 7];
        let best = tones[0], bd = 99;
        for (const tt of tones) for (const o of [-7, 0, 7]) {
          const cand = tt + o; const dd = Math.abs(cand - deg);
          if (dd < bd && cand >= baseDeg - 3 && cand <= baseDeg + 8) { bd = dd; best = cand; }
        }
        deg = best;
      } else {
        deg += rng.pick([-2, -1, -1, 1, 1, 2, 0]);
        deg = Math.max(baseDeg - 3, Math.min(baseDeg + 8, deg));
      }
      if (b === bars - 1 && i === rhythm.length - 1) deg = chord; // 解決
      notes.push({ beat: b * 4 + st, len: len * 0.92, midi: scaleNote(def, deg, 1) });
    });
  }
  return notes;
}

// ---------------- 曲全体 ----------------
export async function renderSong(def, onProgress = () => {}) {
  const rng = new Rng(def.seed);
  const spb = 60 / def.bpm;
  const totalBars = def.structure.reduce((s, x) => s + x.bars, 0);
  const lead = 0.25; // 頭の無音
  const duration = lead + totalBars * 4 * spb + 4;
  // 呼び出しを記録しておき、あとで短い区間ごとに分けて並列に演奏する(速い)
  const calls = [];
  const I = new Proxy({}, { get: (_, name) => (...args) => calls.push({ name, args }) });
  const filterSegs = []; // [start, end, f0, f1]
  const tb = (beat) => lead + beat * spb;

  // セクション情報
  const sections = [];
  let bar = 0;
  for (const s of def.structure) {
    sections.push({ ...s, startBar: bar, endBar: bar + s.bars, startBeat: bar * 4, endBeat: (bar + s.bars) * 4, start: tb(bar * 4), end: tb((bar + s.bars) * 4) });
    bar += s.bars;
  }

  // セクションのタイプごとにメロディを1つ作り、同じタイプでは繰り返す
  const motifs = {};
  const melodyEvents = []; // 歌詞タイミング用
  const prog = def.progression;

  for (const sec of sections) {
    const e = sec.energy;
    const hasKick = sec.kick ?? e >= 1;
    const half = def.halftime || sec.halftime;
    // フィルター
    if (sec.filter) {
      filterSegs.push([sec.start, sec.end, sec.filter[0], sec.filter[1]]);
    }
    if (e >= 3) { I.crash(sec.start, 1); I.impact(sec.start); }
    if (sec.riser) I.riser(tb(sec.endBeat - sec.riser * 4), sec.riser * 4 * spb);

    for (let b = sec.startBar; b < sec.endBar; b++) {
      const barInSec = b - sec.startBar;
      const deg = prog[b % prog.length];
      const t0 = tb(b * 4);
      const lastBarOfSec = b === sec.endBar - 1;

      // ドラム
      for (let q = 0; q < 16; q++) {
        const t = tb(b * 4 + q / 4 + (q % 2 === 1 ? (def.swing || 0) * 0.25 : 0));
        const beatPos = q / 4;
        if (hasKick) {
          const kickHere = half ? (q === 0 || q === 10 || (e >= 2 && q === 7)) : (q % 4 === 0);
          if (kickHere && !(sec.dropout && lastBarOfSec && q >= 8)) { I.kick(t, e >= 3 ? 1 : 0.9); I.duckAt(t, e >= 2 ? 0.6 : 0.35); }
        }
        if (e >= 1) {
          const clapHere = half ? q === 8 : (q === 4 || q === 12);
          if (clapHere) I.clap(t, e >= 2 ? 1 : 0.75);
        }
        // ハイハット
        if (e >= 1 || sec.hats) {
          if (def.hat16 || e >= 3) { if (q % 2 === 0 || e >= 2) I.hat(t, q % 4 === 2 ? 0.9 : 0.45); }
          else if (q % 4 === 2) I.hat(t, 0.8);
          if (e >= 3 && q % 4 === 2 && !def.hat16) I.hat(t, 0.5, true);
        } else if (e === 0 && sec.hatsSoft && q % 4 === 2) I.hat(t, 0.3);
        void beatPos;
      }
      // ビルドアップのスネアロール
      if (sec.build) {
        const progress = (barInSec + 1) / sec.bars;
        const steps = progress > 0.75 ? 16 : progress > 0.5 ? 8 : 4;
        for (let i = 0; i < steps; i++) I.snare(tb(b * 4 + i * (4 / steps)), 0.3 + 0.7 * progress);
      }
      if (lastBarOfSec && e >= 1 && !sec.build && sec.fill !== false) {
        for (let i = 0; i < 4; i++) I.snare(tb(b * 4 + 3 + i * 0.25), 0.4 + i * 0.15);
      }

      // ベース
      if (e >= 1 || sec.bass) {
        const root = scaleNote(def, deg, -2);
        if (def.bassStyle === 'funk') {
          const pat = [[0, 0.4, 0], [0.75, 0.2, 12], [1.5, 0.4, 0], [2, 0.3, 7], [2.5, 0.2, 12], [3, 0.4, 0], [3.5, 0.3, 10]];
          for (const [st, len, off] of pat) I.bass(tb(b * 4 + st), root + off, len * spb * 2, 0.9, e >= 2 ? 1 : 0.6);
        } else if (half) {
          I.bass(t0, root, spb * 2.8, 0.9, 0.4);
          I.bass(tb(b * 4 + 2.5), root, spb * 1.4, 0.8, 0.4);
        } else {
          for (let i = 0; i < 8; i++) {
            if (i % 2 === 0 && e < 3) continue; // 裏打ち
            I.bass(tb(b * 4 + i * 0.5), root + (e >= 3 && i % 4 === 3 ? 12 : 0), spb * 0.45, i % 2 ? 1 : 0.8, e >= 3 ? 1 : 0.7);
          }
        }
      }

      // コード
      const notes = chordNotes(def, deg, 0, def.seventh);
      if (sec.pad !== false) I.pad(t0, notes, 4 * spb, e >= 2 ? 0.8 : 1, e === 0 ? 1400 : 2600);
      if (e >= 3 && def.stabs !== false) {
        const pat = def.stabPattern || [0, 0.75, 1.5, 2.5, 3.25];
        for (const st of pat) I.stab(tb(b * 4 + st), chordNotes(def, deg, 1), spb * 0.6, 1);
      }
      // アルペジオ
      if (sec.arp || (e >= 2 && def.arp !== false)) {
        const ar = [...notes, notes[0] + 12, notes[1] + 12];
        for (let i = 0; i < 8; i++) I.pluck(tb(b * 4 + i * 0.5), ar[(i * 3 + barInSec) % ar.length] + 12, spb * 0.4, e === 0 ? 0.6 : 0.8);
      }
      if (sec.bells && barInSec % 2 === 0) I.bell(t0, notes[2] + 24, 0.8);
    }

    // メロディ
    if (sec.melody) {
      const key = sec.melody;
      if (!motifs[key]) {
        const chordDegs = [0, 1, 2, 3].map((i) => prog[(sec.startBar + i) % prog.length]);
        motifs[key] = [
          makeMotif(def, rng, 4, chordDegs, key === 'chorus' ? 4 : 2, sec.energy >= 3 ? 0.8 : 0.45),
          makeMotif(def, rng, 4, chordDegs, key === 'chorus' ? 5 : 1, sec.energy >= 3 ? 0.8 : 0.45),
        ];
      }
      const [mA, mB] = motifs[key];
      for (let p = 0; p * 4 < sec.bars; p++) {
        const motif = p % 2 === 0 ? mA : mB;
        const phraseNotes = [];
        for (const n of motif) {
          const beat = sec.startBeat + p * 16 + n.beat;
          if (beat >= sec.endBeat) continue;
          I.lead(tb(beat), n.midi, n.len * spb, sec.energy >= 3 ? 1 : 0.85, sec.energy >= 3 ? 1 : 0.5);
          phraseNotes.push({ time: tb(beat), end: tb(beat + n.len), beat });
        }
        melodyEvents.push({ section: sec, phrase: p, notes: phraseNotes, startBeat: sec.startBeat + p * 16 });
      }
    }
  }
  // 最後の締め
  const endT = tb(totalBars * 4);
  I.crash(endT, 0.8); I.kick(endT, 1); I.impact(endT);
  I.pad(endT, chordNotes(def, prog[0], 0), 3, 1, 1800);

  onProgress(0.08);
  const buffer = await renderChunks(def, calls, filterSegs, duration, onProgress);
  onProgress(1);

  // 拍・小節
  const beats = [];
  for (let i = 0; i <= totalBars * 4 + 8; i++) beats.push(tb(i));

  // 歌詞の時刻づけ(メロディ音符に1文字ずつ割り当てる)
  const lyrics = [];
  if (def.lyrics) {
    const used = {};
    for (const ev of melodyEvents) {
      const key = ev.section.label;
      const lines = def.lyrics[ev.section.melody] || def.lyrics[key];
      if (!lines) continue;
      const lineIdx = used[ev.section.melody] = (used[ev.section.melody] ?? -1) + 1;
      // 1フレーズ(4小節)に2行
      const halves = [ev.notes.filter((n) => n.beat < ev.startBeat + 8), ev.notes.filter((n) => n.beat >= ev.startBeat + 8)];
      halves.forEach((ns, h) => {
        if (!ns.length) return;
        const text = lines[(lineIdx * 2 + h) % lines.length];
        const chars = [...text];
        const visible = chars.filter((c) => c !== ' ' && c !== '　');
        const words = [];
        let vi = 0;
        chars.forEach((ch) => {
          if (ch === ' ' || ch === '　') { words.push({ text: ch, time: null }); return; }
          const ni = Math.min(ns.length - 1, Math.floor((vi * ns.length) / visible.length));
          const nn = ns[ni];
          const within = (vi * ns.length) / visible.length - ni;
          const tt = nn.time + (nn.end - nn.time) * within;
          words.push({ text: ch, time: tt });
          vi++;
        });
        let last = null;
        for (const w of words) { if (w.time == null) w.time = last ?? ns[0].time; last = w.time; }
        lyrics.push({ time: ns[0].time - 0.05, end: ns[ns.length - 1].end + 0.25, text, words, section: ev.section.label });
      });
    }
  }

  return {
    id: def.id,
    title: def.title,
    artist: def.artist,
    buffer,
    bpm: def.bpm,
    beats,
    beatsPerBar: 4,
    firstDownbeat: 0,
    sections: sections.map((s) => ({ label: s.label, energy: s.energy, start: s.start, end: s.end, startBeat: s.startBeat, endBeat: s.endBeat, startBar: s.startBar, endBar: s.endBar })),
    lyrics,
    palette: def.palette,
    style: def.style,
    duration: endT + 3,
  };
}


// ---------------- 区間ごとの並列レンダリング ----------------
const DUR = {
  kick: () => 0.5, clap: () => 0.3, snare: () => 0.2, hat: (a) => (a[2] ? 0.35 : 0.06), crash: () => 2.5,
  riser: (a) => a[1] + 0.1, impact: () => 1.6, bass: (a) => a[2] + 0.02, pad: (a) => a[2] + 0.4,
  stab: (a) => a[2] + 0.05, pluck: (a) => Math.max(0.2, a[2]) + 0.05, lead: (a) => a[2] + 0.1, bell: () => 1.7, duckAt: () => 0.3,
};
const filterAt = (segs, t) => {
  for (const [a, b, f0, f1] of segs) if (t >= a && t < b) return f0 * Math.pow(f1 / f0, (t - a) / (b - a));
  return 18000;
};

async function renderChunks(def, calls, filterSegs, duration, onProgress) {
  const CH = 6; // 秒
  const TAIL = 3.6; // 残響
  const nChunks = Math.ceil(duration / CH);
  const groups = Array.from({ length: nChunks }, () => []);
  for (const c of calls) {
    const i = Math.max(0, Math.min(nChunks - 1, Math.floor(c.args[0] / CH)));
    groups[i].push(c);
  }
  const total = Math.ceil(duration * SR);
  const out = [new Float32Array(total), new Float32Array(total)];
  let done = 0;
  const renderOne = async (i) => {
    const g = groups[i];
    const t0 = i * CH;
    let end = t0 + CH;
    for (const c of g) end = Math.max(end, c.args[0] + (DUR[c.name] ? DUR[c.name](c.args) : 1));
    const len = Math.ceil((end - t0 + TAIL) * SR);
    const ctx = new OfflineAudioContext(2, len, SR);
    const I = new Instruments(ctx, def);
    // フィルターの動き
    const steps = Math.max(2, Math.ceil((end - t0 + TAIL) * 20));
    const curve = new Float32Array(steps);
    for (let k = 0; k < steps; k++) curve[k] = filterAt(filterSegs, t0 + (k / (steps - 1)) * (end - t0 + TAIL));
    I.musicFilter.frequency.setValueCurveAtTime(curve, 0, end - t0 + TAIL);
    for (const c of g) {
      const args = c.args.slice();
      args[0] = Math.max(0, args[0] - t0);
      I[c.name](...args);
    }
    const buf = await ctx.startRendering();
    const off = Math.floor(t0 * SR);
    for (let ch = 0; ch < 2; ch++) {
      const src = buf.getChannelData(ch), dst = out[ch];
      const n = Math.min(src.length, total - off);
      for (let k = 0; k < n; k++) dst[off + k] += src[k];
    }
    done++;
    onProgress(0.08 + 0.9 * (done / nChunks));
  };
  // CPUの数だけ並列
  let next = 0;
  const worker = async () => { while (next < nChunks) { const i = next++; await renderOne(i); } };
  await Promise.all(Array.from({ length: Math.min(8, navigator.hardwareConcurrency || 4) }, worker));
  // 音量をそろえる(やわらかいクリップ)
  let peak = 0;
  for (const ch of out) for (let k = 0; k < ch.length; k++) peak = Math.max(peak, Math.abs(ch[k]));
  const gain = peak > 0 ? 0.98 / Math.max(1, peak) : 1;
  const buffer = new AudioBuffer({ length: total, numberOfChannels: 2, sampleRate: SR });
  for (let ch = 0; ch < 2; ch++) {
    const d = out[ch];
    for (let k = 0; k < d.length; k++) { const x = d[k] * gain; d[k] = Math.tanh(x * 1.1) / Math.tanh(1.1); }
    buffer.copyToChannel(d, ch);
  }
  return buffer;
}
