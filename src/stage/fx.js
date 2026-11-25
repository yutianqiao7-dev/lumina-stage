// 特殊効果: 空気中のちり・火花(スパークラー)・紙吹雪・床のスモーク
import * as THREE from 'three';
import { makeSoftSpriteTexture } from './shaders.js';

const dotTex = () => (dotTex.t ||= makeSoftSpriteTexture(64, 'dot'));

export class Haze {
  constructor(count = 2500, stageH = 1) {
    const g = new THREE.BufferGeometry();
    const p = new Float32Array(count * 3);
    this.seed = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      p[i * 3] = (Math.random() - 0.5) * 30;
      p[i * 3 + 1] = stageH + Math.random() * 10;
      p[i * 3 + 2] = -6 + Math.random() * 22;
      this.seed[i] = Math.random();
    }
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    this.mat = new THREE.PointsMaterial({ size: 0.05, map: dotTex(), transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending, color: '#9fb4ff', sizeAttenuation: true });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.count = count;
  }
  update(dt, t) {
    const p = this.points.geometry.attributes.position;
    for (let i = 0; i < this.count; i++) {
      const s = this.seed[i];
      p.array[i * 3] += Math.sin(t * 0.2 + s * 30) * dt * 0.08;
      p.array[i * 3 + 1] += (0.03 + s * 0.05) * dt;
      if (p.array[i * 3 + 1] > 12) p.array[i * 3 + 1] = 1;
    }
    p.needsUpdate = true;
  }
}

// 火花の噴水(ステージ前の特効)
export class Sparks {
  constructor(max = 3000) {
    this.max = max;
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.col = new Float32Array(max * 3);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.mat = new THREE.PointsMaterial({ size: 0.09, map: dotTex(), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.cursor = 0;
    this.emitters = []; // {pos, until, rate, color}
    for (let i = 0; i < max; i++) this.pos[i * 3 + 1] = -100;
  }
  fountain(x, y, z, duration = 1.6, color = new THREE.Color('#ffd27a'), power = 1) {
    this.emitters.push({ x, y, z, t: 0, duration, color, power, acc: 0 });
  }
  burst(x, y, z, n = 200, color = new THREE.Color('#fff2c0'), speed = 6) {
    this.aliveUntil = performance.now() + 3000;
    for (let k = 0; k < n; k++) {
      const th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1);
      const v = speed * (0.4 + Math.random() * 0.6);
      this.spawn(x, y, z, Math.sin(ph) * Math.cos(th) * v, Math.cos(ph) * v, Math.sin(ph) * Math.sin(th) * v, color, 1 + Math.random());
    }
  }
  spawn(x, y, z, vx, vy, vz, color, life) {
    const i = this.cursor; this.cursor = (this.cursor + 1) % this.max;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.life[i] = life;
    this.col[i * 3] = color.r; this.col[i * 3 + 1] = color.g; this.col[i * 3 + 2] = color.b;
  }
  update(dt) {
    if (!this.emitters.length && !(this.aliveUntil > performance.now())) return;
    this.aliveUntil = Math.max(this.aliveUntil || 0, performance.now() + 2500);
    for (const e of this.emitters) {
      e.t += dt;
      e.acc += dt * 700 * e.power * (this.maxEmit ?? 1);
      while (e.acc > 1) {
        e.acc -= 1;
        const a = Math.random() * Math.PI * 2, r = Math.random() * 0.5;
        this.spawn(e.x + (Math.random() - 0.5) * 0.15, e.y, e.z + (Math.random() - 0.5) * 0.15,
          Math.cos(a) * r, (6.5 + Math.random() * 3) * e.power, Math.sin(a) * r, e.color, 0.8 + Math.random() * 0.8);
      }
    }
    this.emitters = this.emitters.filter((e) => e.t < e.duration);
    const p = this.pos, v = this.vel, c = this.col;
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      v[i * 3 + 1] -= 9.8 * dt * 0.8;
      v[i * 3] *= 0.99; v[i * 3 + 2] *= 0.99;
      p[i * 3] += v[i * 3] * dt; p[i * 3 + 1] += v[i * 3 + 1] * dt; p[i * 3 + 2] += v[i * 3 + 2] * dt;
      const k = Math.max(0, Math.min(1, this.life[i]));
      c[i * 3] *= 0.985; c[i * 3 + 1] *= 0.975; c[i * 3 + 2] *= 0.96;
      if (this.life[i] <= 0 || p[i * 3 + 1] < 0) { p[i * 3 + 1] = -100; this.life[i] = 0; }
      void k;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
  }
}

// 紙吹雪
export class Confetti {
  constructor(count = 1800) {
    this.count = count;
    const geo = new THREE.PlaneGeometry(0.06, 0.1);
    const mat = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, toneMapped: true });
    this.mesh = new THREE.InstancedMesh(geo, mat, count);
    this.mesh.frustumCulled = false;
    this.p = new Float32Array(count * 3);
    this.v = new Float32Array(count * 3);
    this.r = new Float32Array(count * 3);
    this.w = new Float32Array(count * 3);
    this.alive = new Uint8Array(count);
    const m = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < count; i++) { this.mesh.setMatrixAt(i, m); this.mesh.setColorAt(i, new THREE.Color(1, 1, 1)); }
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._e = new THREE.Euler(); this._s = new THREE.Vector3(1, 1, 1); this._v = new THREE.Vector3();
    this.active = 0;
  }
  launch(colors, stageH = 1) {
    const c = new THREE.Color();
    for (let i = 0; i < this.count; i++) {
      // 2台のキャノンから客席上空へ
      const side = i % 2 ? 1 : -1;
      this.p[i * 3] = side * 6; this.p[i * 3 + 1] = stageH + 0.5; this.p[i * 3 + 2] = 1.5;
      const sp = 10 + Math.random() * 9;
      const dir = new THREE.Vector3(-side * (0.15 + Math.random() * 0.5), 1, 0.3 + Math.random() * 0.8).normalize();
      this.v[i * 3] = dir.x * sp; this.v[i * 3 + 1] = dir.y * sp; this.v[i * 3 + 2] = dir.z * sp;
      this.r[i * 3] = Math.random() * 6; this.r[i * 3 + 1] = Math.random() * 6; this.r[i * 3 + 2] = Math.random() * 6;
      this.w[i * 3] = (Math.random() - 0.5) * 12; this.w[i * 3 + 1] = (Math.random() - 0.5) * 12; this.w[i * 3 + 2] = (Math.random() - 0.5) * 12;
      this.alive[i] = 1;
      c.copy(colors[i % colors.length]);
      if (Math.random() < 0.3) c.set('#ffffff');
      if (Math.random() < 0.15) c.set('#ffd84a');
      this.mesh.setColorAt(i, c);
    }
    this.mesh.instanceColor.needsUpdate = true;
    this.active = 12;
  }
  update(dt) {
    if (this.active <= 0) return;
    this.active -= dt;
    for (let i = 0; i < this.count; i++) {
      if (!this.alive[i]) continue;
      const k = i * 3;
      // 空気抵抗でひらひら
      this.v[k + 1] -= 9.8 * dt;
      const drag = this.v[k + 1] < 0 ? 3.2 : 0.6;
      this.v[k] *= Math.exp(-drag * 0.5 * dt); this.v[k + 2] *= Math.exp(-drag * 0.5 * dt);
      if (this.v[k + 1] < -1.2) this.v[k + 1] = -1.2 + (this.v[k + 1] + 1.2) * Math.exp(-drag * dt);
      this.p[k] += (this.v[k] + Math.sin(this.r[k] * 2) * 0.4) * dt;
      this.p[k + 1] += this.v[k + 1] * dt;
      this.p[k + 2] += (this.v[k + 2] + Math.cos(this.r[k + 1] * 2) * 0.4) * dt;
      this.r[k] += this.w[k] * dt; this.r[k + 1] += this.w[k + 1] * dt; this.r[k + 2] += this.w[k + 2] * dt;
      if (this.p[k + 1] < 0.02) { this.p[k + 1] = 0.02; this.v[k] = this.v[k + 1] = this.v[k + 2] = 0; this.w[k] = this.w[k + 1] = this.w[k + 2] = 0; this.r[k] = Math.PI / 2; }
      this._e.set(this.r[k], this.r[k + 1], this.r[k + 2]);
      this._q.setFromEuler(this._e);
      this._m.compose(this._v.set(this.p[k], this.p[k + 1], this.p[k + 2]), this._q, this._s);
      this.mesh.setMatrixAt(i, this._m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

// 床をはうスモーク(ドライアイス)
export class FloorSmoke {
  constructor(count = 28, stageH = 1) {
    this.group = new THREE.Group();
    const tex = makeSoftSpriteTexture(256, 'smoke');
    this.items = [];
    for (let i = 0; i < count; i++) {
      const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0, depthWrite: false, color: '#c9d4ff' });
      const sp = new THREE.Sprite(mat);
      const s = 3 + Math.random() * 3;
      sp.scale.set(s, s * 0.45, 1);
      sp.position.set((Math.random() - 0.5) * 13, stageH + 0.25, -4 + Math.random() * 7);
      sp.material.rotation = Math.random() * Math.PI * 2;
      this.group.add(sp);
      this.items.push({ sp, vx: (Math.random() - 0.5) * 0.3, vz: 0.1 + Math.random() * 0.25, rot: (Math.random() - 0.5) * 0.1, base: 0.18 + Math.random() * 0.15 });
    }
    this.level = 0;
    this.stageH = stageH;
  }
  update(dt, target) {
    this.level += (target - this.level) * (1 - Math.exp(-dt * 0.6));
    for (const it of this.items) {
      it.sp.position.x += it.vx * dt;
      it.sp.position.z += it.vz * dt;
      it.sp.material.rotation += it.rot * dt;
      if (it.sp.position.z > 3.2) { it.sp.position.z = -4; it.sp.position.x = (Math.random() - 0.5) * 13; }
      const edge = Math.min(1, (3.2 - it.sp.position.z) / 1.5) * Math.min(1, (it.sp.position.z + 4) / 1.5);
      it.sp.material.opacity = it.base * this.level * edge;
    }
  }
}
