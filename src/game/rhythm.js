// 音ゲーモード「ステージチャレンジ」
// 曲の拍・構成から譜面を自動で作り、画面のあちこちに出る的へ飛んでくるマークを、タイミングよく押す。
import { Rng, clamp, easeOut } from '../util/math.js';
import { beatToTime } from '../dance/composer.js';

export const LANES = [
  { key: 'D', alt: 'ArrowLeft', sym: 'heart', color: '#ff5fa8', label: '♥' },
  { key: 'F', alt: 'ArrowDown', sym: 'diamond', color: '#4fd8ff', label: '◆' },
  { key: 'J', alt: 'ArrowUp', sym: 'star', color: '#ffd84a', label: '★' },
  { key: 'K', alt: 'ArrowRight', sym: 'note', color: '#7dff9b', label: '♪' },
];
export const DIFFICULTIES = {
  easy: { name: 'かんたん', approach: 1.35, holds: false },
  normal: { name: 'ふつう', approach: 1.1, holds: true },
  hard: { name: 'むずかしい', approach: 0.85, holds: true },
};
const WIN = { perfect: 0.05, great: 0.095, good: 0.145 };
const POINTS = { perfect: 300, great: 200, good: 100, miss: 0 };
const JUDGE_TEXT = { perfect: 'PERFECT', great: 'GREAT', good: 'GOOD', miss: 'MISS' };
const JUDGE_COLOR = { perfect: '#ffe66b', great: '#7df0ff', good: '#b9ff8a', miss: '#ff6b8a' };

// 1小節(4拍)ぶんのリズム(拍の位置)。難しさ × 盛り上がり
const PATTERNS = {
  easy: [[[0]], [[0, 2]], [[0, 2], [0, 1, 2]], [[0, 1, 2, 3], [0, 2, 3]]],
  normal: [[[0, 2]], [[0, 1, 2, 3], [0, 2, 3], [0, 1, 2]], [[0, 1, 2, 3], [0, 1, 2, 2.5, 3], [0, 0.5, 1, 2, 3]], [[0, 1, 1.5, 2, 3, 3.5], [0, 0.5, 1, 2, 2.5, 3], [0, 1, 2, 2.5, 3, 3.5]]],
  hard: [[[0, 1, 2, 3]], [[0, 1, 1.5, 2, 3], [0, 0.5, 1, 2, 3, 3.5]], [[0, 0.5, 1, 1.5, 2, 3, 3.5], [0, 1, 1.5, 2, 2.5, 3, 3.5]], [[0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5], [0, 0.5, 1, 1.5, 2, 2.25, 2.5, 3, 3.5], [0, 0.5, 1, 2, 2.5, 3, 3.25, 3.5]]],
};

export function makeChart(song, difficulty = 'normal', seed = 7) {
  const rng = new Rng(seed * 31 + difficulty.length);
  const beats = song.beats;
  const db = song.firstDownbeat || 0;
  const notes = [];
  const memo = {};
  const lanePattern = () => {
    const kinds = [
      (i) => i % 4, (i) => 3 - (i % 4), (i) => [0, 1, 0, 1, 2, 3, 2, 3][i % 8], (i) => [0, 3, 1, 2][i % 4],
      (i) => Math.floor(i / 2) % 4, (i) => [0, 0, 1, 1, 2, 2, 3, 3][i % 8], (i) => [1, 2, 1, 2, 0, 3, 0, 3][i % 8],
    ];
    return rng.pick(kinds);
  };
  const startT = 1.8;
  for (const sec of song.sections) {
    const e = clamp(sec.energy, 0, 3);
    const key = sec.label.replace(/[0-9０-９'’]+$/, '').replace(/^ラスト/, '') + '_' + e;
    if (!memo[key]) {
      // セクションの種類ごとに譜面のくせを決めて、くり返しは同じ譜面にする
      const bars = [];
      for (let k = 0; k < 8; k++) bars.push(rng.pick(PATTERNS[difficulty][e]));
      memo[key] = { bars, lane: lanePattern(), lane2: lanePattern() };
    }
    const m = memo[key];
    let idx = 0;
    const firstBar = Math.ceil((sec.startBeat - db) / 4);
    const lastBar = Math.floor((sec.endBeat - db) / 4);
    for (let bar = firstBar; bar < lastBar; bar++) {
      const local = bar - firstBar;
      const pat = m.bars[local % 8];
      const laneFn = Math.floor(local / 8) % 2 ? m.lane2 : m.lane;
      for (const off of pat) {
        const beat = db + bar * 4 + off;
        const time = beatToTime(beats, beat);
        if (time < startT || time > song.duration - 1.5) continue;
        notes.push({ time, beat, lane: laneFn(idx++), sec: e });
      }
      // フレーズの終わりは長押し
      if (DIFFICULTIES[difficulty].holds && local % 8 === 7 && e >= 1) {
        const last = notes[notes.length - 1];
        if (last && last.beat >= db + bar * 4 + 2) {
          // 小節の頭の音を長押しに変える
          const head = notes.find((n) => n.beat === db + bar * 4);
          if (head) {
            const endBeat = db + bar * 4 + 2;
            head.end = beatToTime(beats, endBeat);
            // 長押し中の音は消す
            for (let i = notes.length - 1; i >= 0; i--) if (notes[i].beat > head.beat && notes[i].beat < endBeat + 0.01) notes.splice(i, 1);
          }
        }
      }
    }
  }
  notes.sort((a, b) => a.time - b.time);
  // 画面上の位置: なめらかな流れに沿って並べる
  let u = rng.float(0, 10), ph = rng.float(0, 6);
  notes.forEach((n, i) => {
    if (i % 12 === 0) ph += rng.float(1, 3);
    const gap = i ? clamp(n.time - notes[i - 1].time, 0.1, 1) : 0.5;
    u += 0.75 + gap * 1.1;
    n.px = 0.5 + 0.44 * Math.sin(u * 0.61 + ph);
    n.py = 0.5 + 0.42 * Math.sin(u * 1.13 + ph * 1.7);
    n.state = 'wait';
  });
  // フィーバー: 最後のサビ
  let fever = null;
  const lastChorus = [...song.sections].reverse().find((s) => s.energy >= 3);
  if (lastChorus) fever = { start: lastChorus.start, end: lastChorus.end };
  return { notes, difficulty, fever };
}

function drawSymbol(g, sym, x, y, r) {
  g.beginPath();
  if (sym === 'heart') {
    const s = r * 1.05;
    g.moveTo(x, y + s * 0.75);
    g.bezierCurveTo(x - s * 1.25, y - s * 0.05, x - s * 0.6, y - s * 1.05, x, y - s * 0.4);
    g.bezierCurveTo(x + s * 0.6, y - s * 1.05, x + s * 1.25, y - s * 0.05, x, y + s * 0.75);
  } else if (sym === 'diamond') {
    g.moveTo(x, y - r); g.lineTo(x + r * 0.8, y); g.lineTo(x, y + r); g.lineTo(x - r * 0.8, y); g.closePath();
  } else if (sym === 'star') {
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? r * 0.45 : r;
      i ? g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr) : g.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    g.closePath();
  } else {
    // 音符
    g.ellipse(x - r * 0.25, y + r * 0.45, r * 0.45, r * 0.34, -0.4, 0, Math.PI * 2);
    g.moveTo(x + r * 0.15, y + r * 0.4); g.lineTo(x + r * 0.15, y - r * 0.85);
    g.lineTo(x + r * 0.75, y - r * 0.55); g.lineTo(x + r * 0.75, y - r * 0.25); g.lineTo(x + r * 0.15, y - r * 0.5);
  }
}

export class RhythmGame {
  constructor(app) {
    this.app = app;
    this.active = false;
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'gameCanvas';
    document.body.appendChild(this.canvas);
    this.g = this.canvas.getContext('2d');
    this.offset = 0;
    try { this.offset = parseFloat(localStorage.getItem('lumina.gameOffset') || '0') || 0; } catch (e) { /* */ }
    this.held = [false, false, false, false];
    this.popups = [];
    this.bursts = [];
    this.padPrev = [];
    this.resize();
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
    this.buildTouch();
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.w = window.innerWidth; this.h = window.innerHeight;
    this.canvas.width = this.w * dpr; this.canvas.height = this.h * dpr;
    this.g.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.r = clamp(Math.min(this.w, this.h) * 0.045, 20, 40);
  }

  buildTouch() {
    const wrap = document.createElement('div');
    wrap.id = 'gameTouch';
    LANES.forEach((L, i) => {
      const b = document.createElement('button');
      b.className = 'gbtn'; b.style.setProperty('--c', L.color);
      b.innerHTML = `<span>${L.label}</span><small>${L.key}</small>`;
      const down = (e) => { e.preventDefault(); this.press(i, true); b.classList.add('on'); };
      const up = (e) => { e.preventDefault(); this.press(i, false); b.classList.remove('on'); };
      b.addEventListener('pointerdown', down); b.addEventListener('pointerup', up); b.addEventListener('pointerleave', up); b.addEventListener('pointercancel', up);
      wrap.appendChild(b);
    });
    document.body.appendChild(wrap);
    this.touchEl = wrap;
  }

  setOffset(ms) { this.offset = ms / 1000; try { localStorage.setItem('lumina.gameOffset', String(this.offset)); } catch (e) { /* */ } }

  start(song, difficulty) {
    this.chart = makeChart(song, difficulty, Math.floor(Math.random() * 1000));
    this.difficulty = difficulty;
    this.approach = DIFFICULTIES[difficulty].approach;
    this.active = true;
    this.finished = false;
    this.score = 0; this.combo = 0; this.maxCombo = 0; this.life = 60;
    this.counts = { perfect: 0, great: 0, good: 0, miss: 0 };
    this.popups = []; this.bursts = [];
    this.feverOn = false;
    this.lastT = 0;
    const n = this.chart.notes.length;
    this.maxScore = Math.max(1, n * 300 + n * 100);
    document.body.classList.add('game-mode');
    this.canvas.style.display = 'block';
  }

  stop() {
    this.active = false;
    document.body.classList.remove('game-mode');
    this.canvas.style.display = 'none';
    this.g.clearRect(0, 0, this.w, this.h);
  }

  now() { return this.app.audio.currentTime - this.offset; }

  onKey(e, down) {
    if (!this.active || e.repeat) return;
    const k = e.key.length === 1 ? e.key.toUpperCase() : e.key;
    const i = LANES.findIndex((L) => L.key === k || L.alt === k);
    if (i < 0) return;
    e.preventDefault(); e.stopPropagation();
    this.press(i, down);
  }

  press(lane, down) {
    if (!this.active || this.finished) return;
    this.held[lane] = down;
    const t = this.now();
    if (down) {
      this.app.playTick && this.app.playTick(lane);
      // いちばん近い、まだ叩いていない同じマークの音符
      let best = null, bd = 1e9;
      for (const n of this.chart.notes) {
        if (n.state !== 'wait' || n.lane !== lane) continue;
        const d = Math.abs(n.time - t);
        if (n.time - t > WIN.good + 0.05) break;
        if (d < bd) { bd = d; best = n; }
      }
      if (best && bd <= WIN.good) {
        const j = bd <= WIN.perfect ? 'perfect' : bd <= WIN.great ? 'great' : 'good';
        if (best.end) { best.state = 'holding'; best.headJudge = j; this.judge(best, j, true); }
        else { best.state = 'hit'; this.judge(best, j); }
      }
    } else {
      for (const n of this.chart.notes) {
        if (n.state === 'holding' && n.lane === lane) {
          const d = n.end - t;
          if (d > WIN.good * 1.5) { n.state = 'miss'; this.judge(n, 'miss', false, true); }
          else { n.state = 'hit'; this.judge(n, d <= WIN.great ? n.headJudge : 'good', false, true); }
        }
      }
    }
  }

  judge(n, j, isHead = false, isTail = false) {
    if (!isTail || j === 'miss') this.counts[j]++;
    const fever = this.feverOn ? 2 : 1;
    if (j === 'miss') { this.combo = 0; this.life = Math.max(0, this.life - 8); }
    else {
      this.combo++; this.maxCombo = Math.max(this.maxCombo, this.combo);
      this.score += (POINTS[j] + Math.min(this.combo, 50) * 2) * fever;
      this.life = Math.min(100, this.life + (j === 'perfect' ? 2 : j === 'great' ? 1 : 0));
      if (this.combo % 50 === 0) this.app.stage.flash = 0.25;
      this.bursts.push({ x: n.px, y: n.py, t: 0, color: LANES[n.lane].color, big: j === 'perfect' });
    }
    this.popups.push({ x: n.px, y: n.py, text: JUDGE_TEXT[j], color: JUDGE_COLOR[j], t: 0 });
    void isHead;
  }

  pollGamepad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const p = pads && [...pads].find((x) => x);
    if (!p) return;
    // 右の4ボタン: 下=0 右=1 左=2 上=3 / 十字キー
    const map = [[2, 14], [0, 13], [3, 12], [1, 15]];
    map.forEach((btns, lane) => {
      const v = btns.some((b) => p.buttons[b] && p.buttons[b].pressed);
      if (v !== !!this.padPrev[lane]) this.press(lane, v);
      this.padPrev[lane] = v;
    });
  }

  update(dt) {
    if (!this.active) return;
    this.pollGamepad();
    const t = this.now();
    const ch = this.chart;
    // 再生位置が飛んだとき(シークなど)は、飛ばした音符を数えない
    if (this.lastT != null && Math.abs(t - this.lastT) > 0.6) {
      for (const n of ch.notes) if ((n.state === 'wait' || n.state === 'holding') && n.time < t - WIN.good) n.state = 'skip';
    }
    this.lastT = t;
    // 見逃し
    for (const n of ch.notes) {
      if (n.state === 'wait' && t - n.time > WIN.good) { n.state = 'miss'; this.judge(n, 'miss'); }
      if (n.state === 'holding' && t >= n.end) { n.state = 'hit'; this.judge(n, n.headJudge, false, true); }
    }
    // フィーバー
    const fv = ch.fever && t >= ch.fever.start && t < ch.fever.end;
    if (fv && !this.feverOn) { this.feverOn = true; this.app.ui.toast('🔥 フィーバータイム! 得点2倍'); this.app.stage.flash = 0.6; }
    if (!fv) this.feverOn = false;
    for (const p of this.popups) p.t += dt;
    this.popups = this.popups.filter((p) => p.t < 0.6).slice(-12);
    for (const b of this.bursts) b.t += dt;
    this.bursts = this.bursts.filter((b) => b.t < 0.45);
    this.draw(t);
  }

  draw(t) {
    const g = this.g, W = this.w, H = this.h, R = this.r;
    g.clearRect(0, 0, W, H);
    const top = 150, bottom = 175, left = 70, right = 70;
    const X = (px) => left + px * (W - left - right);
    const Y = (py) => top + py * (H - top - bottom);
    const A = this.approach;
    // フィーバーの枠
    if (this.feverOn) {
      const k = 0.5 + 0.5 * Math.sin(t * 8);
      const gr = g.createLinearGradient(0, 0, W, 0);
      gr.addColorStop(0, `rgba(255,80,160,${0.35 + 0.25 * k})`); gr.addColorStop(0.5, 'rgba(255,220,80,0)'); gr.addColorStop(1, `rgba(80,220,255,${0.35 + 0.25 * k})`);
      g.fillStyle = gr; g.fillRect(0, 0, W, H);
    }
    // 次に来る音符どうしを線でつなぐ
    const vis = this.chart.notes.filter((n) => (n.state === 'wait' && n.time - t < A && n.time - t > -WIN.good) || n.state === 'holding');
    g.lineWidth = 2; g.strokeStyle = 'rgba(255,255,255,0.16)';
    g.beginPath();
    vis.forEach((n, i) => { const x = X(n.px), y = Y(n.py); i ? g.lineTo(x, y) : g.moveTo(x, y); });
    g.stroke();
    // 遠い順に描く
    for (let i = vis.length - 1; i >= 0; i--) {
      const n = vis[i];
      const L = LANES[n.lane];
      const x = X(n.px), y = Y(n.py);
      const k = clamp(1 - (n.time - t) / A, 0, 1); // 0→1
      // 的(マークの形の枠)
      g.save();
      g.globalAlpha = Math.min(1, k * 3);
      g.lineWidth = 4; g.strokeStyle = 'rgba(255,255,255,0.9)'; g.fillStyle = 'rgba(10,8,25,0.45)';
      g.beginPath(); g.arc(x, y, R * 1.15, 0, Math.PI * 2); g.fill(); g.stroke();
      g.lineWidth = 2.5; g.strokeStyle = L.color;
      drawSymbol(g, L.sym, x, y, R * 0.62); g.stroke();
      // 時計の針のように減っていく残り時間の弧
      g.lineWidth = 5; g.strokeStyle = L.color;
      g.beginPath(); g.arc(x, y, R * 1.38, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * k); g.stroke();
      g.restore();
      // 長押し
      if (n.end) {
        const holdK = n.state === 'holding' ? clamp((t - n.time) / (n.end - n.time), 0, 1) : 0;
        g.save(); g.lineWidth = 8; g.strokeStyle = 'rgba(255,255,255,0.25)';
        g.beginPath(); g.arc(x, y, R * 1.7, 0, Math.PI * 2); g.stroke();
        g.strokeStyle = L.color; g.shadowColor = L.color; g.shadowBlur = 14;
        g.beginPath(); g.arc(x, y, R * 1.7, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * holdK); g.stroke();
        g.restore();
      }
      if (n.state === 'holding') continue;
      // 飛んでくるマーク(画面の外から弧を描いて)
      const ang = Math.atan2(y - H / 2, x - W / 2) + 0.9;
      const dist = Math.max(W, H) * 0.55 * (1 - easeOut(k));
      const fx = x + Math.cos(ang) * dist, fy = y + Math.sin(ang) * dist;
      g.save();
      g.shadowColor = L.color; g.shadowBlur = 18;
      g.fillStyle = L.color; g.strokeStyle = '#fff'; g.lineWidth = 3;
      drawSymbol(g, L.sym, fx, fy, R * 0.72); g.fill(); g.stroke();
      g.restore();
      // 尾
      g.save(); g.globalAlpha = 0.35; g.strokeStyle = L.color; g.lineWidth = R * 0.5; g.lineCap = 'round';
      const tx = x + Math.cos(ang) * (dist + R * 2.2), ty = y + Math.sin(ang) * (dist + R * 2.2);
      g.beginPath(); g.moveTo(fx, fy); g.lineTo(tx, ty); g.stroke(); g.restore();
    }
    // はじける光
    for (const b of this.bursts) {
      const k = b.t / 0.45;
      const x = X(b.x), y = Y(b.y);
      g.save(); g.globalAlpha = 1 - k; g.strokeStyle = b.color; g.lineWidth = 6 * (1 - k);
      g.beginPath(); g.arc(x, y, R * (1.2 + k * (b.big ? 1.1 : 0.7)), 0, Math.PI * 2); g.stroke();
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2, d = R * (1 + k * 1.4);
        g.fillStyle = b.color; g.beginPath(); g.arc(x + Math.cos(a) * d, y + Math.sin(a) * d, 3 * (1 - k) + 1, 0, Math.PI * 2); g.fill();
      }
      g.restore();
    }
    // 判定の文字
    for (const p of this.popups) {
      const k = p.t / 0.6;
      g.save(); g.globalAlpha = 1 - k * k;
      g.font = `900 ${Math.round(R * 0.75)}px Montserrat, sans-serif`; g.textAlign = 'center';
      g.lineWidth = 4; g.strokeStyle = 'rgba(0,0,0,0.6)'; g.fillStyle = p.color;
      const y = Y(p.y) - R * 1.9 - k * 20;
      g.strokeText(p.text, X(p.x), y); g.fillText(p.text, X(p.x), y);
      g.restore();
    }
    // コンボ・スコア・ライフ
    g.save();
    g.textAlign = 'center';
    if (this.combo >= 3) {
      g.font = `900 ${Math.round(R * 1.5)}px Montserrat, sans-serif`;
      g.fillStyle = '#fff'; g.shadowColor = '#ff5fa8'; g.shadowBlur = 20;
      g.fillText(String(this.combo), W / 2, 112);
      g.font = '700 13px Montserrat, sans-serif'; g.shadowBlur = 0; g.fillStyle = '#ffd1ea';
      g.fillText('COMBO', W / 2, 130);
    }
    g.textAlign = 'right';
    g.font = '900 26px Montserrat, sans-serif'; g.fillStyle = '#fff'; g.shadowColor = 'rgba(0,0,0,0.6)'; g.shadowBlur = 8;
    g.fillText(String(this.score).padStart(7, '0'), W - 24, 44);
    g.font = '700 12px "Zen Maru Gothic", sans-serif'; g.fillStyle = '#ddd6f7';
    g.fillText(`${DIFFICULTIES[this.difficulty].name}${this.feverOn ? '  🔥×2' : ''}`, W - 24, 62);
    // ライフゲージ
    const gw = Math.min(260, W * 0.3), gx = W - 24 - gw, gy = 72;
    g.shadowBlur = 0; g.fillStyle = 'rgba(255,255,255,0.15)'; g.fillRect(gx, gy, gw, 8);
    const lg = g.createLinearGradient(gx, 0, gx + gw, 0); lg.addColorStop(0, '#ff5fa8'); lg.addColorStop(1, '#ffd84a');
    g.fillStyle = this.life > 25 ? lg : '#ff4a5a'; g.fillRect(gx, gy, gw * (this.life / 100), 8);
    g.restore();
  }

  result() {
    const c = this.counts;
    const total = c.perfect + c.great + c.good + c.miss || 1;
    const acc = (c.perfect + c.great * 0.7 + c.good * 0.4) / total;
    const rank = acc >= 0.95 ? 'S' : acc >= 0.85 ? 'A' : acc >= 0.7 ? 'B' : acc >= 0.5 ? 'C' : 'D';
    return { ...c, total, acc, rank, score: this.score, maxCombo: this.maxCombo, clear: acc >= 0.6 && this.life > 0, fullCombo: c.miss === 0 };
  }
}
