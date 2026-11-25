// 立体歌詞: 1文字ずつ3D空間に配置して動かす(記事の JIZURA の歌詞レイヤーを立体配置する仕組みに相当)
import * as THREE from 'three';
import { clamp, easeOut, easeInOut, Rng } from '../util/math.js';

export const LYRIC_FONT = '"Zen Maru Gothic", "M PLUS Rounded 1c", "Hiragino Maru Gothic ProN", "Yu Gothic UI", "Meiryo", sans-serif';

const glyphCache = new Map();
function glyphTexture(ch) {
  if (glyphCache.has(ch)) return glyphCache.get(ch);
  const S = 128;
  const cv = document.createElement('canvas'); cv.width = cv.height = S;
  const g = cv.getContext('2d');
  g.font = `900 92px ${LYRIC_FONT}`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.shadowColor = 'rgba(255,255,255,0.9)'; g.shadowBlur = 14;
  g.fillStyle = '#ffffff';
  g.fillText(ch, S / 2, S / 2 + 4);
  g.shadowBlur = 0;
  g.lineWidth = 3; g.strokeStyle = 'rgba(40,20,60,0.55)';
  g.strokeText(ch, S / 2, S / 2 + 4);
  g.fillText(ch, S / 2, S / 2 + 4);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  glyphCache.set(ch, t);
  return t;
}
export function clearGlyphCache() { for (const t of glyphCache.values()) t.dispose(); glyphCache.clear(); }

const isNarrow = (ch) => /[\x20-\x7e]/.test(ch);
const planeGeo = new THREE.PlaneGeometry(1, 1);

const STYLES = ['arc', 'side', 'floor', 'big', 'tilt'];

class LyricLine {
  constructor(line, index, style, H, palette, layer = 0) {
    this.line = line;
    this.index = index;
    this.style = style;
    this.layer = layer; // 0=手前 1=奥の残像
    this.group = new THREE.Group();
    this.inner = new THREE.Group();
    this.group.add(this.inner);
    this.chars = [];
    const rng = new Rng(index * 31 + layer * 7 + 1);
    const words = line.words || [...line.text].map((c) => ({ text: c, time: line.time }));
    const vertical = style === 'side';
    const size = (style === 'big' ? 1.05 : style === 'floor' ? 0.42 : style === 'side' ? 0.46 : 0.5) * (layer ? 1.7 : 1);
    // 文字送り
    let adv = 0;
    const items = [];
    for (const w of words) {
      const ch = w.text;
      const step = (ch === ' ' || ch === '　') ? 0.45 : isNarrow(ch) ? 0.62 : 1;
      items.push({ ch, time: w.time, off: adv + step / 2 });
      adv += step;
    }
    const total = adv;
    this.total = total * size;
    items.forEach((it, i) => {
      if (it.ch === ' ' || it.ch === '　') return;
      const mat = new THREE.MeshBasicMaterial({ map: glyphTexture(it.ch), transparent: true, depthWrite: false, color: new THREE.Color(1, 1, 1), fog: false, opacity: 0 });
      const mesh = new THREE.Mesh(planeGeo, mat);
      mesh.renderOrder = 10 + layer;
      const x = (it.off - total / 2) * size;
      let base;
      if (vertical) base = new THREE.Vector3(0, -x, 0);
      else if (style === 'arc') { const a = (x / Math.max(this.total, 0.01)) * 0.55; base = new THREE.Vector3(Math.sin(a) * this.total * 0.95, 0, (Math.cos(a) - 1) * this.total * 0.6); }
      else base = new THREE.Vector3(x, 0, 0);
      mesh.position.copy(base);
      mesh.scale.setScalar(size);
      this.inner.add(mesh);
      const dir = new THREE.Vector3(rng.float(-1, 1), rng.float(-0.4, 1), rng.float(0.5, 1.5)).normalize();
      this.chars.push({ mesh, mat, base, time: it.time, i, dir, spin: rng.float(-2, 2), size, popped: false });
    });
    this.palette = palette;
    this.H = H;
    this.seed = rng.float(0, 10);
    this.placed = false;
  }

  place(H, dancer, side) {
    const g = this.group;
    const L = this.layer;
    switch (this.style) {
      case 'arc': g.position.set(dancer.x, H + 3.3 + (L ? 1.2 : 0), dancer.z + 1.2 - (L ? 4.5 : 0)); break;
      case 'side': g.position.set(dancer.x + side * (2.6 + L * 2.2), H + 2.6 + L * 0.8, dancer.z + 0.6 - L * 3); break;
      case 'floor': g.position.set(dancer.x, H + 0.55 + L * 2, dancer.z + 2.3 - L * 5); break;
      case 'big': g.position.set(0, H + 4.2, -4.6 - L * 0.5); break;
      default: g.position.set(dancer.x + side * 1.6, H + 2.9 + L, dancer.z + 1.4 - L * 4); this.inner.rotation.z = side * 0.12; break;
    }
    this.placed = true;
  }

  update(t, camera, palette, energy) {
    const line = this.line;
    const L = this.layer;
    const appear0 = line.time - 0.45;
    const exit0 = line.end;
    let alive = false;
    const sung = palette[0].clone().lerp(new THREE.Color(1, 1, 1), 0.15).multiplyScalar(2.6 + energy * 0.4);
    const unsung = new THREE.Color(1, 1, 1).multiplyScalar(L ? 0.35 : 0.95);
    const n = this.chars.length;
    for (const c of this.chars) {
      const ta = appear0 + c.i * 0.025;
      const te = exit0 + c.i * 0.03;
      const kin = easeOut(clamp((t - ta) / 0.45, 0, 1));
      const kout = easeInOut(clamp((t - te) / 0.6, 0, 1));
      const vis = kin * (1 - kout);
      if (vis > 0.001) alive = true;
      const m = c.mesh;
      // 入り: 奥から回転しながら / 出: 上へ舞い上がる
      m.position.copy(c.base)
        .addScaledVector(c.dir, (1 - kin) * 1.6)
        .add(new THREE.Vector3(0, kout * 1.4 + Math.sin(t * 1.4 + c.i * 0.6 + this.seed) * 0.03, -kout * 0.5));
      m.rotation.set((1 - kin) * c.spin * 0.6 + kout * c.spin, (1 - kin) * c.spin, kout * c.spin * 0.5);
      const prog = clamp((t - c.time) / 0.12, 0, 1);
      const pop = prog > 0 && prog < 1 ? Math.sin(prog * Math.PI) * 0.28 : 0;
      m.scale.setScalar(c.size * (0.4 + 0.6 * kin) * (1 + pop * (L ? 0 : 1)));
      c.mat.color.copy(unsung).lerp(sung, L ? 0.3 * prog : prog);
      c.mat.opacity = vis * (L ? 0.16 : 1);
    }
    // カメラの方へ 8割くらい向ける(立体感を残しつつ読める)
    if (camera) {
      const to = camera.position.clone().sub(this.group.getWorldPosition(new THREE.Vector3()));
      to.y *= 0.4;
      const target = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), to.normalize());
      const k = this.style === 'big' ? 0.35 : 0.85;
      const q = new THREE.Quaternion().slerp(target, k);
      this.group.quaternion.slerp(q, this._init ? 0.08 : 1);
      this._init = true;
    }
    void n;
    return alive || t < appear0;
  }

  dispose() { for (const c of this.chars) c.mat.dispose(); }
}

export class Lyrics3D {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.lines = [];
    this.active = new Map();
    this.mode = '3d'; // '3d' | 'sub' | 'off'
    this.H = 1;
    this.palette = [new THREE.Color('#ff4fa3')];
  }

  setLyrics(lines) {
    for (const o of this.active.values()) { this.group.remove(o.group); o.dispose(); }
    this.active.clear();
    this.lines = (lines || []).slice().sort((a, b) => a.time - b.time);
  }

  reset() { this.setLyrics(this.lines); }

  current(t) {
    let cur = null;
    for (const l of this.lines) { if (l.time - 0.3 <= t && t <= l.end + 0.2) cur = l; if (l.time > t) break; }
    return cur;
  }

  styleFor(i, line, energy) {
    const sec = line.section || '';
    if (energy >= 3 || sec.includes('サビ')) return ['arc', 'big', 'arc', 'tilt'][i % 4];
    if (energy === 2) return ['tilt', 'side', 'arc', 'side'][i % 4];
    return ['side', 'floor', 'side', 'tilt'][i % 4];
  }

  update(t, camera, { dancer, palette, energyAt, H }) {
    this.H = H;
    if (this.mode !== '3d') {
      if (this.active.size) { for (const o of this.active.values()) { this.group.remove(o.group); o.dispose(); } this.active.clear(); }
      return;
    }
    // 出す行(今の時刻の近くだけ調べる)
    const L = this.lines;
    if (this._ptr == null || this._ptr >= L.length || (L[this._ptr] && L[this._ptr].time > t + 2)) this._ptr = 0;
    while (this._ptr < L.length - 1 && L[this._ptr].end + 1.5 < t) this._ptr++;
    for (let i = this._ptr; i < L.length && L[i].time - 0.6 <= t; i++) {
      const line = L[i];
      const key = i;
      const inWin = t >= line.time - 0.6 && t <= line.end + 1.2;
      if (inWin && !this.active.has(key)) {
        const e = energyAt(line.time);
        const style = this.styleFor(i, line, e);
        const side = i % 2 ? 1 : -1;
        const objs = [new LyricLine(line, i, style, H, palette, 0)];
        if (style !== 'big' && style !== 'floor' && !this.lite) objs.push(new LyricLine(line, i, style, H, palette, 1));
        for (const o of objs) { o.place(H, dancer, side); this.group.add(o.group); }
        this.active.set(key, { objs, group: null, dispose() { for (const o of objs) { o.dispose(); } } });
      }
    }
    for (const [key, entry] of this.active) {
      const line = this.lines[key];
      let alive = false;
      const e = line ? energyAt(line.time) : 0;
      for (const o of entry.objs) alive = o.update(t, camera, palette, e) || alive;
      const outOfWin = !line || t < line.time - 0.8 || t > line.end + 1.5;
      if (!alive || outOfWin) {
        for (const o of entry.objs) { this.group.remove(o.group); o.dispose(); }
        this.active.delete(key);
      }
    }
  }
}
