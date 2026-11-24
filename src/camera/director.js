// 自動カメラ(カメラマン兼スイッチャー): 盛り上がりに合わせてショットを選び、拍でカットする
import * as THREE from 'three';
import { Rng, fbm1, smoother, clamp, lerp, easeInOut } from '../util/math.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);

// ショット: (進み具合 u 0..1, 情報) → {pos, look, fov}
const SHOTS = {
  wide: { energy: [0, 3], dur: [8, 16], fn: (u, I, r) => ({ pos: V(lerp(-3, 3, u) * r.s, I.H + 4.5 + r.a, 22 - u * 3), look: V(0, I.H + 2.6, -1), fov: 42 }) },
  wideHigh: { energy: [1, 3], dur: [4, 8], fn: (u, I, r) => ({ pos: V(Math.sin(u * 0.6 + r.a) * 8, I.H + 11, 26), look: V(0, I.H + 1.5, 0), fov: 40 }) },
  full: { energy: [0, 3], dur: [4, 8], fn: (u, I, r) => ({ pos: V(lerp(-1.2, 1.2, u) * r.s, I.chest.y + 0.1, I.d.z + 6.2 - u * 1.2), look: V(I.d.x, I.chest.y - 0.15, I.d.z), fov: 34 }) },
  medium: { energy: [0, 3], dur: [2, 6], fn: (u, I, r) => ({ pos: V(I.d.x + lerp(-1.5, 1.5, u) * r.s, I.chest.y + 0.25, I.d.z + 3.2), look: V(I.d.x, I.chest.y + 0.15, I.d.z), fov: 30 }) },
  closeup: { energy: [0, 2], dur: [2, 6], fn: (u, I, r) => ({ pos: V(I.head.x + 0.55 * r.s + Math.sin(u * 1.5) * 0.3, I.head.y + 0.05, I.head.z + 1.55 - u * 0.25), look: I.head.clone().add(V(0, -0.02, 0)), fov: 24 }) },
  orbit: { energy: [1, 3], dur: [4, 8], fn: (u, I, r) => { const a = r.a + u * 1.2 * r.s; return { pos: V(I.d.x + Math.sin(a) * 4.5, I.H + 1.6 + Math.sin(u * 3) * 0.3, I.d.z + Math.cos(a) * 4.5), look: V(I.d.x, I.chest.y, I.d.z), fov: 36 }; } },
  low: { energy: [2, 3], dur: [2, 4], fn: (u, I, r) => ({ pos: V(I.d.x + 1.4 * r.s - u * 0.6 * r.s, I.H + 0.25, I.d.z + 2.6), look: V(I.d.x, I.chest.y + 0.35, I.d.z), fov: 40 }) },
  crowd: { energy: [1, 3], dur: [4, 8], fn: (u, I, r) => ({ pos: V(lerp(-4, -1, u) * r.s, 2.0, 14 + r.a * 2), look: V(I.d.x, I.H + 1.6, I.d.z), fov: 30 }) },
  side: { energy: [1, 3], dur: [2, 6], fn: (u, I, r) => ({ pos: V(7.5 * r.s, I.H + 1.5 + u * 0.8, I.d.z + 1.5 - u * 1.0), look: V(I.d.x, I.chest.y, I.d.z), fov: 30 }) },
  crane: { energy: [1, 3], dur: [4, 8], fn: (u, I, r) => { const k = easeInOut(u); return { pos: V(lerp(-5, 3, k) * r.s, I.H + lerp(7, 1.8, k), lerp(9, 5.5, k)), look: V(I.d.x, I.chest.y, I.d.z), fov: 36 }; } },
  top: { energy: [2, 3], dur: [2, 4], fn: (u, I, r) => ({ pos: V(I.d.x + 0.01, I.H + 8.5, I.d.z + 0.6), look: V(I.d.x, I.H, I.d.z), fov: 44, roll: r.a + u * 0.6 }) },
  back: { energy: [2, 3], dur: [2, 4], fn: (u, I, r) => ({ pos: V(I.d.x + 1.8 * r.s, I.H + 2.3, I.d.z - 3.3), look: V(I.d.x - 1 * r.s, I.H + 2.5, 12), fov: 52 }) },
  handheld: { energy: [2, 3], dur: [2, 4], fn: (u, I, r) => ({ pos: V(I.d.x - 1.2 * r.s, I.chest.y + 0.1, I.d.z + 2.2), look: V(I.d.x, I.chest.y + 0.1, I.d.z), fov: 34, shake: 1 }) },
  idle: { energy: [9, 9], dur: [64, 64], fn: (u, I, r) => { const a = I.time * 0.06; return { pos: V(Math.sin(a) * 9, I.H + 3.2 + Math.sin(I.time * 0.11) * 1.2, 4 + Math.cos(a) * 9), look: V(0, I.H + 1.6, -1), fov: 40 }; } },
  group: { energy: [1, 3], dur: [4, 8], needGroup: true, fn: (u, I, r) => ({ pos: V(lerp(-2, 2, u) * r.s, I.H + 2.2, 9.5), look: V(0, I.H + 1.1, -1.5), fov: 38 }) },
};

export const SHOT_NAMES = {
  wide: '引き(正面)', wideHigh: '高い所から', full: '全身', medium: 'バストアップ', closeup: '顔アップ',
  orbit: '回り込み', low: 'ローアングル', crowd: '客席から', side: '横から', crane: 'クレーン', top: '真上', back: '背中から', handheld: '手持ち', group: 'グループ',
};

export class Director {
  constructor(camera) {
    this.camera = camera;
    this.rng = new Rng(123);
    this.shot = 'wide';
    this.shotStartBeat = -999;
    this.shotLen = 8;
    this.params = { s: 1, a: 0 };
    this.cutRate = 1; // 1=ふつう
    this.history = [];
    this.manualShot = null;
    this._pos = new THREE.Vector3(); this._look = new THREE.Vector3();
    this.lastSectionIdx = -1;
    this.hasGroup = false;
  }

  forceShot(name) { this.manualShot = name; this.shotStartBeat = -999; }

  chooseShot(energy, beat, reason) {
    const names = Object.keys(SHOTS).filter((n) => {
      const S = SHOTS[n];
      if (S.needGroup && !this.hasGroup) return false;
      return energy >= S.energy[0] - (reason === 'section' ? 0 : 0) && energy <= S.energy[1];
    });
    const prev = this.history.slice(-3);
    const pick = this.rng.weighted(names, (n) => {
      let w = 1;
      if (prev.includes(n)) w *= 0.1;
      if (n === this.shot) w = 0;
      if (reason === 'section' && (n === 'wide' || n === 'wideHigh' || n === 'crane' || n === 'group')) w *= 3;
      if (energy === 0 && (n === 'closeup' || n === 'full' || n === 'wide')) w *= 2;
      if (energy >= 3 && (n === 'handheld' || n === 'low' || n === 'orbit' || n === 'top')) w *= 1.6;
      return w;
    });
    this.shot = pick;
    this.history.push(pick); if (this.history.length > 8) this.history.shift();
    const S = SHOTS[pick];
    // 長さ(拍): 盛り上がるほど短く
    const baseBars = energy >= 3 ? this.rng.pick([1, 1, 2]) : energy === 2 ? this.rng.pick([1, 2, 2]) : energy === 1 ? this.rng.pick([2, 2, 4]) : this.rng.pick([4, 4, 8]);
    this.shotLen = clamp(Math.round(baseBars * 4 / this.cutRate), S.dur[0], Math.max(S.dur[1], 4) * 2);
    this.shotStartBeat = beat;
    this.params = { s: this.rng.chance(0.5) ? 1 : -1, a: this.rng.float(-1, 1) };
  }

  update(dt, { beat, energy, sectionIdx, section, info, nextBoundaryBeat }) {
    const e = section ? section.energy : Math.round(energy);
    // カット判定: 小節頭に合わせる
    const barBeat = Math.floor(beat / 4) * 4 + (info.downbeatOffset || 0);
    let cut = false;
    if (sectionIdx !== this.lastSectionIdx) { this.lastSectionIdx = sectionIdx; cut = 'section'; }
    else if (beat - this.shotStartBeat >= this.shotLen) cut = 'time';
    if (this.manualShot) {
      if (this.shot !== this.manualShot || this.shotStartBeat < -100) {
        this.shot = this.manualShot; this.shotStartBeat = beat; this.shotLen = 16;
        this.params = { s: 1, a: 0.3 };
      }
      cut = false;
      if (beat - this.shotStartBeat > 16) { this.shotStartBeat = beat; }
    }
    if (!section && !this.manualShot) {
      // 曲が始まる前: ゆっくり会場を見せる
      if (this.shot !== 'idle') { this.shot = 'idle'; cut = 'idle'; }
      this.shotStartBeat = beat;
    } else if (cut) this.chooseShot(e, beat, cut);
    void barBeat; void nextBoundaryBeat;

    const S = SHOTS[this.shot];
    const u = clamp((beat - this.shotStartBeat) / Math.max(1, this.shotLen), 0, 1);
    const r = S.fn(u, info, this.params);
    // 手ブレ(常に少し + 手持ちは強め)
    const shake = (r.shake ? 0.07 : 0.012) * (0.5 + energy / 3);
    const tt = info.time;
    r.pos.x += fbm1(tt * 0.8, 1) * shake; r.pos.y += fbm1(tt * 0.9, 2) * shake; r.pos.z += fbm1(tt * 0.7, 3) * shake * 0.5;
    r.look.x += fbm1(tt * 0.6, 4) * shake * 0.6; r.look.y += fbm1(tt * 0.6, 5) * shake * 0.6;
    // カメラは遠すぎる・近すぎる時だけ少し追従させる
    if (cut || this._first !== true) { this._pos.copy(r.pos); this._look.copy(r.look); this._first = true; }
    else {
      const k = 1 - Math.exp(-dt * 10);
      this._pos.lerp(r.pos, k); this._look.lerp(r.look, k);
    }
    this.camera.position.copy(this._pos);
    this.camera.up.set(0, 1, 0);
    if (r.roll != null) this.camera.up.set(Math.sin(r.roll), 0, -Math.cos(r.roll));
    this.camera.lookAt(this._look);
    // ビートでわずかにズーム
    const zoomPulse = energy >= 2.5 ? Math.exp(-((beat % 1 + 1) % 1) * 6) * 0.8 : 0;
    this.camera.fov = r.fov - zoomPulse;
    this.camera.updateProjectionMatrix();
    return cut;
  }
}

// LEDスクリーン用のカメラ(常にキャラのアップを映す)
export class FeedDirector {
  constructor(camera) { this.camera = camera; this.mode = 0; this.lastBar = -1; this.rng = new Rng(7); this.s = 1; }
  update(dt, beat, info) {
    const bar = Math.floor(beat / 8);
    if (bar !== this.lastBar) { this.lastBar = bar; this.mode = this.rng.int(0, 2); this.s = this.rng.chance(0.5) ? 1 : -1; }
    const u = (beat / 8) % 1;
    let pos, look, fov;
    const d = info.d, head = info.head, chest = info.chest;
    if (this.mode === 0) { pos = V(head.x + 0.4 * this.s, head.y + 0.02, head.z + 1.4); look = head.clone().add(V(0, -0.05, 0)); fov = 28; }
    else if (this.mode === 1) { pos = V(d.x + (u - 0.5) * 1.8 * this.s, chest.y + 0.1, d.z + 2.6); look = V(d.x, chest.y + 0.12, d.z); fov = 32; }
    else { pos = V(d.x + 2.2 * this.s, info.H + 0.9, d.z + 3.2); look = V(d.x, chest.y - 0.2, d.z); fov = 38; }
    this.camera.position.lerp(pos, 1 - Math.exp(-dt * 6));
    this.camera.lookAt(look);
    this.camera.fov = fov; this.camera.updateProjectionMatrix();
  }
}
