// 小さな数学・乱数ヘルパー

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Rng {
  constructor(seed = 1) { this.next = mulberry32(seed); }
  float(a = 0, b = 1) { return a + (b - a) * this.next(); }
  int(a, b) { return Math.floor(this.float(a, b + 1)); }
  pick(arr) { return arr[Math.floor(this.next() * arr.length)]; }
  chance(p) { return this.next() < p; }
  weighted(items, weightFn) {
    let total = 0;
    const ws = items.map((it) => { const w = Math.max(0, weightFn(it)); total += w; return w; });
    if (total <= 0) return this.pick(items);
    let r = this.next() * total;
    for (let i = 0; i < items.length; i++) { r -= ws[i]; if (r <= 0) return items[i]; }
    return items[items.length - 1];
  }
}

export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
export const smoother = (t) => { t = clamp(t, 0, 1); return t * t * t * (t * (t * 6 - 15) + 10); };
export const easeInOut = (t) => { t = clamp(t, 0, 1); return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; };
export const easeOut = (t) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
export const easeIn = (t) => Math.pow(clamp(t, 0, 1), 3);
export const fract = (x) => x - Math.floor(x);
export const TAU = Math.PI * 2;

// 拍の中で「ノリ」を作る波形。拍頭で沈み、裏で浮く
export const bounce = (b) => -Math.abs(Math.sin(Math.PI * b));
export const pulse = (b, sharp = 4) => Math.exp(-sharp * fract(b));
export const tri = (x) => 1 - 4 * Math.abs(fract(x + 0.25) - 0.5); // -1..1 三角波
export const sin = (x) => Math.sin(x * TAU);
export const cos = (x) => Math.cos(x * TAU);

// 2つの値の間を拍のフェーズで行き来(hold付き)
export function stepCurve(b, period = 2, hold = 0.35) {
  // 0..1..0 を往復、端でhold
  const p = fract(b / period) * 2; // 0..2
  const seg = p < 1 ? p : 2 - p;
  return smoother((seg - hold * 0.5) / (1 - hold));
}

export function wrapAngle(a) {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}

export function lerpAngle(a, b, t) {
  return a + wrapAngle(b - a) * t;
}

// 値ノイズ(カメラの手ブレなど)
export function noise1(x, seed = 0) {
  const i = Math.floor(x), f = x - i;
  const h = (n) => { const s = Math.sin((n + seed * 57.13) * 127.1) * 43758.5453; return s - Math.floor(s); };
  const u = f * f * (3 - 2 * f);
  return lerp(h(i), h(i + 1), u) * 2 - 1;
}

export function fbm1(x, seed = 0) {
  return noise1(x, seed) * 0.6 + noise1(x * 2.1, seed + 3) * 0.3 + noise1(x * 4.3, seed + 7) * 0.1;
}

export function hsl(h, s, l) {
  // 戻り値 [r,g,b] 0..1
  h = fract(h);
  const a = s * Math.min(l, 1 - l);
  const f = (n) => { const k = (n + h * 12) % 12; return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
  return [f(0), f(8), f(4)];
}
