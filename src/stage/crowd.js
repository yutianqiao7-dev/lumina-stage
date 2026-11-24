// 観客とペンライト(数千人をインスタンス描画、拍に合わせて跳ねる・振る)
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

function personGeometry() {
  const body = new THREE.CapsuleGeometry(0.2, 0.75, 4, 10); body.translate(0, 0.62, 0); body.scale(1, 1, 0.65);
  const head = new THREE.SphereGeometry(0.12, 12, 10); head.translate(0, 1.36, 0);
  const g = mergeGeometries([body.toNonIndexed(), head.toNonIndexed()]);
  return g;
}

export class Crowd {
  constructor(count = 1400) {
    this.group = new THREE.Group();
    this.count = count;
    this.uniforms = { uBeat: { value: 0 }, uJump: { value: 0 }, uWave: { value: 0 }, uTime: { value: 0 } };
    const rng = (() => { let s = 99; return () => { s = (s * 16807) % 2147483647; return s / 2147483647; }; })();

    // 位置(花道を囲むように扇形に並ぶ)
    const pos = [];
    for (let i = 0; pos.length < count && i < count * 6; i++) {
      const x = (rng() - 0.5) * 46;
      const z = 6 + rng() * 32;
      if (Math.abs(x) < 2.6 && z < 13.5) continue; // 花道
      if (z < 8 && Math.abs(x) < 8) continue;
      if (Math.hypot(x, z - 13) < 3.2) continue; // センターステージ
      pos.push([x + (rng() - 0.5) * 0.3, z]);
    }
    this.count = pos.length;
    const n = this.count;

    // 体
    const geo = personGeometry();
    const phase = new Float32Array(n);
    for (let i = 0; i < n; i++) phase[i] = rng();
    geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phase, 1));
    const mat = new THREE.MeshStandardMaterial({ color: '#0c0b12', roughness: 0.9, metalness: 0.0 });
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, this.uniforms);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
          attribute float aPhase; uniform float uBeat; uniform float uJump; uniform float uTime;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          float ph = fract(uBeat + aPhase * 0.25);
          float hop = pow(abs(sin(3.14159 * (uBeat + aPhase * 0.3))), 2.0) * uJump * (0.6 + aPhase * 0.6);
          transformed.y += hop * 0.28 + sin(uTime * 1.3 + aPhase * 40.0) * 0.02;
          transformed.x += sin(uTime * 0.7 + aPhase * 20.0) * 0.03 * transformed.y;`);
    };
    this.bodies = new THREE.InstancedMesh(geo, mat, n);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      const sc = 0.9 + rng() * 0.22;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(-pos[i][0], -(pos[i][1] - 0)) + (rng() - 0.5) * 0.4);
      s.set(sc, sc, sc);
      m.compose(new THREE.Vector3(pos[i][0], 0, pos[i][1]), q, s);
      this.bodies.setMatrixAt(i, m);
    }
    this.bodies.frustumCulled = false;
    this.group.add(this.bodies);

    // ペンライト
    const stickGeo = new THREE.CylinderGeometry(0.022, 0.022, 0.42, 6, 1); stickGeo.translate(0, 0.21, 0);
    const sPhase = new Float32Array(n), sSide = new Float32Array(n);
    for (let i = 0; i < n; i++) { sPhase[i] = phase[i]; sSide[i] = rng() < 0.5 ? -1 : 1; }
    stickGeo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(sPhase, 1));
    stickGeo.setAttribute('aSide', new THREE.InstancedBufferAttribute(sSide, 1));
    const smat = new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false });
    smat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, this.uniforms);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
          attribute float aPhase; attribute float aSide; uniform float uBeat; uniform float uJump; uniform float uWave; uniform float uTime;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          // 2拍で左右に振る。盛り上がると頭上で大きく
          float sw = sin(3.14159 * (uBeat + aPhase * 0.06 * (1.0 - uWave)));
          float ang = sw * (0.55 + 0.4 * uJump) * aSide + aSide * 0.15;
          float c = cos(ang), s = sin(ang);
          transformed.xy = vec2(c * transformed.x - s * transformed.y, s * transformed.x + c * transformed.y);
          float hop = pow(abs(sin(3.14159 * (uBeat + aPhase * 0.3))), 2.0) * uJump * (0.6 + aPhase * 0.6);
          transformed.y += hop * 0.28;`);
      sh.fragmentShader = sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
          diffuseColor.rgb *= 2.6;`);
    };
    this.sticks = new THREE.InstancedMesh(stickGeo, smat, n);
    const col = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const sc = 1;
      const hx = pos[i][0] + 0.18 * sSide[i], hz = pos[i][1];
      m.compose(new THREE.Vector3(hx, 1.45 + rng() * 0.25, hz), new THREE.Quaternion(), new THREE.Vector3(sc, sc, sc));
      this.sticks.setMatrixAt(i, m);
      this.sticks.setColorAt(i, col.setRGB(1, 1, 1));
    }
    this.sticks.frustumCulled = false;
    this.group.add(this.sticks);
    this.stickHue = [];
    for (let i = 0; i < n; i++) this.stickHue.push(rng());
    this._curColors = null;
  }

  // ペンライトの色をそろえる(曲ごとのテーマ色)
  setColors(colors, mix = 0.82) {
    const c = new THREE.Color();
    for (let i = 0; i < this.count; i++) {
      const h = this.stickHue[i];
      // 大半はメインカラー、一部は推し色
      const idx = h < mix ? 0 : h < mix + (1 - mix) / 2 ? 1 : 2;
      c.copy(colors[idx]);
      this.sticks.setColorAt(i, c);
    }
    this.sticks.instanceColor.needsUpdate = true;
  }

  update(dt, beat, energy, time) {
    this.uniforms.uBeat.value = beat / 2; // 2拍で1往復
    const target = energy >= 3 ? 1 : energy >= 2 ? 0.45 : energy >= 1 ? 0.15 : 0.03;
    this.uniforms.uJump.value += (target - this.uniforms.uJump.value) * (1 - Math.exp(-dt * 2));
    this.uniforms.uWave.value += ((energy >= 2 ? 1 : 0) - this.uniforms.uWave.value) * (1 - Math.exp(-dt * 1.5));
    this.uniforms.uTime.value = time;
  }
}
