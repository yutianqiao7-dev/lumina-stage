// ライブ会場: ステージ・花道・トラス・ムービングライト・レーザー・LEDスクリーン・観客・特効
import * as THREE from 'three';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { makeBeamMaterial, makeLaserMaterial, makeLEDWallMaterial, makeLEDFloorMaterial, makeChaseMaterial } from './shaders.js';
import { Crowd } from './crowd.js';
import { Haze, Sparks, Confetti, FloorSmoke } from './fx.js';
import { fract, clamp, lerp } from '../util/math.js';

export const STAGE_H = 1.0;
const STAGE_W = 16, STAGE_D = 10, STAGE_Z0 = -6; // 奥 z=-6 〜 手前 z=4

// 反射を「足し算」で重ねる床用シェーダー(ぼかし付き)
const AdditiveReflectorShader = {
  name: 'AdditiveReflectorShader',
  uniforms: { color: { value: null }, tDiffuse: { value: null }, textureMatrix: { value: null }, uBlur: { value: 0.004 } },
  vertexShader: /* glsl */ `
    uniform mat4 textureMatrix; varying vec4 vUv; varying vec2 vLocal;
    #include <common>
    #include <logdepthbuf_pars_vertex>
    void main(){ vUv = textureMatrix * vec4(position, 1.0); vLocal = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    #include <logdepthbuf_vertex>
    }`,
  fragmentShader: /* glsl */ `
    uniform vec3 color; uniform sampler2D tDiffuse; uniform float uBlur; varying vec4 vUv; varying vec2 vLocal;
    #include <logdepthbuf_pars_fragment>
    void main(){
      #include <logdepthbuf_fragment>
      vec2 uv = vUv.xy / vUv.w;
      vec3 c = vec3(0.0); float tot = 0.0;
      for (int x = -2; x <= 2; x++) for (int y = -2; y <= 2; y++) {
        float w = 1.0 - length(vec2(x, y)) / 3.2;
        c += texture2D(tDiffuse, uv + vec2(float(x), float(y)) * uBlur).rgb * w; tot += w;
      }
      c /= tot;
      // 端に行くほど弱く
      float edge = smoothstep(0.0, 0.08, vLocal.x) * smoothstep(1.0, 0.92, vLocal.x) * smoothstep(0.0, 0.08, vLocal.y) * smoothstep(1.0, 0.92, vLocal.y);
      gl_FragColor = vec4(c * color * edge, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
};

function trussBeam(length, size = 0.42, axis = 'x') {
  const parts = [];
  const r = 0.028;
  const h = size / 2;
  const corners = [[h, h], [h, -h], [-h, h], [-h, -h]];
  for (const [a, b] of corners) {
    const g = new THREE.CylinderGeometry(r, r, length, 6); g.rotateZ(Math.PI / 2); g.translate(0, a, b); parts.push(g);
  }
  const step = size;
  const n = Math.floor(length / step);
  const diag = Math.hypot(step, size);
  const faces = [[[h, h], [h, -h]], [[-h, h], [-h, -h]], [[h, h], [-h, h]], [[h, -h], [-h, -h]]];
  for (let i = 0; i < n; i++) {
    const x0 = -length / 2 + i * step;
    for (const [A, B] of faces) {
      const from = i % 2 ? A : B, to = i % 2 ? B : A;
      const g = new THREE.CylinderGeometry(r * 0.6, r * 0.6, diag, 5);
      const dir = new THREE.Vector3(step, to[0] - from[0], to[1] - from[1]);
      g.translate(0, diag / 2, 0);
      g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize()));
      g.translate(x0, from[0], from[1]);
      parts.push(g);
    }
  }
  const geo = mergeGeometries(parts.map((p) => p.toNonIndexed()));
  if (axis === 'y') geo.rotateZ(Math.PI / 2);
  if (axis === 'z') geo.rotateY(Math.PI / 2);
  return geo;
}

class MovingHead {
  constructor(beamMat, { up = false, length = 22 } = {}) {
    this.group = new THREE.Group();
    this.up = up;
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.18, 0.32), MovingHead.bodyMat ||= new THREE.MeshStandardMaterial({ color: '#15151c', metalness: 0.7, roughness: 0.4 }));
    body.position.y = up ? -0.09 : 0.09;
    this.group.add(body);
    this.head = new THREE.Group();
    this.group.add(this.head);
    const can = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.17, 0.36, 16), MovingHead.bodyMat);
    can.position.y = -0.05; this.head.add(can);
    this.lensMat = new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false });
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.13, 20), this.lensMat);
    lens.rotation.x = Math.PI / 2; lens.position.y = -0.235; this.head.add(lens);
    this.mat = beamMat.clone();
    this.mat.uniforms.uLength.value = length;
    const coneGeo = new THREE.CylinderGeometry(0.12, 1.25, length, 24, 1, true);
    coneGeo.translate(0, -length / 2 - 0.24, 0);
    this.beam = new THREE.Mesh(coneGeo, this.mat);
    this.beam.frustumCulled = false;
    this.head.add(this.beam);
    this.dir = new THREE.Vector3(0, -1, 0);
    this.target = new THREE.Vector3(0, -1, 0);
    this.color = new THREE.Color();
    this.intensity = 0;
    if (up) this.group.rotation.x = Math.PI; // 床置きは上向き
  }
  aim(dirWorld, dt, speed = 4) {
    this.target.copy(dirWorld).normalize();
    // モーターの速さで追いかける
    const k = 1 - Math.exp(-dt * speed);
    this.dir.lerp(this.target, k).normalize();
    const local = this.dir.clone();
    if (this.up) local.y = -local.y, local.z = -local.z;
    this.head.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), local);
  }
  set(color, intensity) {
    this.color.copy(color);
    this.intensity = intensity;
    this.mat.uniforms.uColor.value.copy(color);
    this.mat.uniforms.uIntensity.value = intensity;
    this.lensMat.color.copy(color).multiplyScalar(0.5 + intensity * 3);
    this.beam.visible = intensity > 0.01;
  }
}

export class Stage {
  constructor(scene, renderer) {
    this.scene = scene;
    this.renderer = renderer;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.palette = [new THREE.Color('#ff3fa0'), new THREE.Color('#3fd0ff'), new THREE.Color('#ffd23f')];
    this.targetPalette = this.palette.map((c) => c.clone());
    this.dancerPos = new THREE.Vector3(0, STAGE_H, 0);
    this.time = 0;
    this.lastSection = -1;
    this.flash = 0;
    this.quality = 'high';
    this.charLight = 1; // VRM(MToon)は明るく出るので弱める
    this.build();
  }

  build() {
    const G = this.group;
    const H = STAGE_H;
    this.scene.fog = new THREE.FogExp2('#05040b', 0.011);
    this.scene.background = new THREE.Color('#020205');

    // 会場の床
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(160, 160), new THREE.MeshStandardMaterial({ color: '#08070d', roughness: 0.92 }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true;
    G.add(floor);

    // ステージ本体(黒い光沢)
    const stageMat = new THREE.MeshStandardMaterial({ color: '#0b0b12', roughness: 0.28, metalness: 0.55 });
    const sideMat = new THREE.MeshStandardMaterial({ color: '#050509', roughness: 0.6, metalness: 0.3 });
    const box = new THREE.Mesh(new THREE.BoxGeometry(STAGE_W, H, STAGE_D), [sideMat, sideMat, stageMat, sideMat, sideMat, sideMat]);
    box.position.set(0, H / 2, STAGE_Z0 + STAGE_D / 2);
    box.receiveShadow = true; box.castShadow = false;
    G.add(box);
    // 花道とセンターステージ
    const run = new THREE.Mesh(new THREE.BoxGeometry(3, H * 0.98, 8), [sideMat, sideMat, stageMat, sideMat, sideMat, sideMat]);
    run.position.set(0, H * 0.49, 4 + 4); run.receiveShadow = true; G.add(run);
    const cen = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, H * 0.98, 48), [sideMat, stageMat, sideMat]);
    cen.position.set(0, H * 0.49, 13); cen.receiveShadow = true; G.add(cen);

    // 床の反射
    this.reflector = new Reflector(new THREE.PlaneGeometry(STAGE_W, STAGE_D), {
      clipBias: 0.003, textureWidth: 1024, textureHeight: 640, color: 0x8a8a96, shader: AdditiveReflectorShader,
    });
    this.reflector.material.transparent = true;
    this.reflector.material.blending = THREE.AdditiveBlending;
    this.reflector.material.depthWrite = false;
    this.reflector.rotation.x = -Math.PI / 2;
    this.reflector.position.set(0, H + 0.002, STAGE_Z0 + STAGE_D / 2);
    this.reflector.renderOrder = 1;
    G.add(this.reflector);

    // LEDの床
    this.floorMat = makeLEDFloorMaterial({ size: new THREE.Vector2(STAGE_W, STAGE_D) });
    const led = new THREE.Mesh(new THREE.PlaneGeometry(STAGE_W, STAGE_D), this.floorMat);
    led.rotation.x = -Math.PI / 2; led.position.set(0, H + 0.004, STAGE_Z0 + STAGE_D / 2); led.renderOrder = 2;
    G.add(led);
    this.floorMat.uniforms.uDancer.value.set(0, -(0 - (STAGE_Z0 + STAGE_D / 2)));

    // 縁のLEDライン
    this.chaseMats = [];
    const addChase = (w, x, y, z, ry = 0, len = w) => {
      const m = makeChaseMaterial(); m.uniforms.uLen.value = len;
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, 0.12), m);
      mesh.position.set(x, y, z); mesh.rotation.y = ry; G.add(mesh); this.chaseMats.push(m);
      return mesh;
    };
    addChase(STAGE_W, 0, H - 0.12, STAGE_Z0 + STAGE_D + 0.01);
    addChase(STAGE_W * 0.98, 0, 0.12, STAGE_Z0 + STAGE_D + 0.01);
    addChase(8, 1.51, H - 0.12, 8, Math.PI / 2); addChase(8, -1.51, H - 0.12, 8, -Math.PI / 2);

    // LEDの大型スクリーン
    this.wallMat = makeLEDWallMaterial({ res: new THREE.Vector2(320, 133), aspect: 18 / 7.5 });
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(18, 7.5), this.wallMat);
    wall.position.set(0, H + 0.4 + 3.75, STAGE_Z0 - 0.15);
    G.add(wall);
    const frame = new THREE.Mesh(new THREE.BoxGeometry(18.4, 7.9, 0.3), sideMat);
    frame.position.set(0, wall.position.y, STAGE_Z0 - 0.35); G.add(frame);
    // サイドスクリーン(カメラ映像)
    this.sideMats = [];
    for (const sx of [-1, 1]) {
      const m = makeLEDWallMaterial({ res: new THREE.Vector2(192, 108), aspect: 16 / 9 });
      m.uniforms.uFeedMix.value = 1; m.uniforms.uFeedFull.value = 1;
      const scr = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 3.6), m);
      scr.position.set(sx * 12.8, H + 5.2, -1.8);
      scr.rotation.y = -sx * 0.42;
      G.add(scr);
      const fr = new THREE.Mesh(new THREE.BoxGeometry(6.7, 3.9, 0.2), sideMat);
      fr.position.copy(scr.position).add(new THREE.Vector3(sx * 0.04, 0, -0.12)); fr.rotation.y = scr.rotation.y; G.add(fr);
      this.sideMats.push(m);
    }

    // トラス
    const trussMat = new THREE.MeshStandardMaterial({ color: '#9a9aa6', metalness: 0.9, roughness: 0.32 });
    const tY = H + 8;
    const addT = (geo, x, y, z) => { const m = new THREE.Mesh(geo, trussMat); m.position.set(x, y, z); G.add(m); return m; };
    addT(trussBeam(20), 0, tY, 2.5);
    addT(trussBeam(20), 0, tY, -3.8);
    addT(trussBeam(6.3, 0.42, 'z'), -9.8, tY, -0.65);
    addT(trussBeam(6.3, 0.42, 'z'), 9.8, tY, -0.65);
    for (const x of [-9.8, 9.8]) for (const z of [2.5, -3.8]) addT(trussBeam(tY, 0.42, 'y'), x, tY / 2, z);

    // スピーカー(ラインアレイ)
    const spkMat = new THREE.MeshStandardMaterial({ color: '#0a0a0e', roughness: 0.7, metalness: 0.2 });
    for (const sx of [-1, 1]) {
      for (let i = 0; i < 8; i++) {
        const s = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.38, 0.8), spkMat);
        s.position.set(sx * 9.3, tY - 0.8 - i * 0.4, 3.6 + i * 0.03);
        s.rotation.x = i * 0.035;
        G.add(s);
      }
    }
    // 足元のモニタースピーカー
    for (const x of [-4, -1.4, 1.4, 4]) {
      const w = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.38, 0.6), spkMat);
      w.position.set(x, H + 0.19, 3.4); w.rotation.x = -0.5; G.add(w);
    }

    // ムービングライト
    const beamMat = makeBeamMaterial();
    this.heads = [];
    for (let i = 0; i < 8; i++) { const h = new MovingHead(beamMat); h.group.position.set(-8.4 + i * 2.4, tY - 0.45, 2.5); h.row = 'front'; h.idx = i; G.add(h.group); this.heads.push(h); }
    for (let i = 0; i < 6; i++) { const h = new MovingHead(beamMat); h.group.position.set(-7.5 + i * 3, tY - 0.45, -3.8); h.row = 'back'; h.idx = i; G.add(h.group); this.heads.push(h); }
    for (let i = 0; i < 8; i++) { const h = new MovingHead(beamMat, { up: true, length: 18 }); h.group.position.set(-7.7 + i * 2.2, H + 0.05, STAGE_Z0 + 0.5); h.row = 'floor'; h.idx = i; G.add(h.group); this.heads.push(h); }

    // レーザー
    const LN = 7 * 8;
    const laserGeo = new THREE.PlaneGeometry(0.05, 45); laserGeo.translate(0, 22.5, 0);
    const laserGeo2 = laserGeo.clone().rotateY(Math.PI / 2);
    const lg = mergeGeometries([laserGeo, laserGeo2]);
    this.laserMat = makeLaserMaterial();
    this.lasers = new THREE.InstancedMesh(lg, this.laserMat, LN);
    this.lasers.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(LN * 3), 3);
    this.lasers.frustumCulled = false;
    this.laserOrigins = [];
    for (let e = 0; e < 7; e++) this.laserOrigins.push(new THREE.Vector3(-7.5 + e * 2.5, H + 7.2, STAGE_Z0 + 0.2));
    G.add(this.lasers);
    this.laserLevel = 0;

    // 本物のライト(キャラを照らす)
    this.hemi = new THREE.HemisphereLight('#4a4a7a', '#0a0610', 0.6);
    G.add(this.hemi);
    this.key = new THREE.SpotLight('#fff1e6', 900, 40, 0.2, 0.55, 2);
    this.key.position.set(2.5, H + 12, 14);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(2048, 2048);
    this.key.shadow.bias = -0.0002; this.key.shadow.normalBias = 0.02;
    this.key.shadow.camera.near = 4; this.key.shadow.camera.far = 40;
    G.add(this.key, this.key.target);
    this.rimL = new THREE.SpotLight('#ff3fa0', 500, 30, 0.35, 0.7, 2);
    this.rimL.position.set(-6, H + 7.5, -4.5);
    this.rimR = new THREE.SpotLight('#3fd0ff', 500, 30, 0.35, 0.7, 2);
    this.rimR.position.set(6, H + 7.5, -4.5);
    this.top = new THREE.SpotLight('#ffffff', 300, 20, 0.5, 0.8, 2);
    this.top.position.set(0, H + 8, 0.5);
    for (const l of [this.rimL, this.rimR, this.top]) G.add(l, l.target);
    this.fill = new THREE.PointLight('#8890ff', 30, 25, 2);
    this.fill.position.set(0, H + 3, 8); G.add(this.fill);

    // 観客
    this.crowd = new Crowd(1700);
    G.add(this.crowd.group);
    // 会場の遠くの明かり(バルコニー)
    const bg = new THREE.BufferGeometry();
    const bp = [];
    for (let i = 0; i < 600; i++) {
      const a = Math.PI * (0.15 + 0.7 * Math.random());
      const r = 48 + Math.random() * 6;
      bp.push(Math.cos(a) * r * 1.1, 4 + Math.random() * 14, Math.sin(a) * r - 6);
    }
    bg.setAttribute('position', new THREE.Float32BufferAttribute(bp, 3));
    this.venueLights = new THREE.Points(bg, new THREE.PointsMaterial({ color: '#ffd9a8', size: 0.25, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    G.add(this.venueLights);

    // 特効
    this.haze = new Haze(2600, H); G.add(this.haze.points);
    this.sparks = new Sparks(5000); G.add(this.sparks.points);
    this.confetti = new Confetti(2000); G.add(this.confetti.mesh);
    this.smoke = new FloorSmoke(30, H); G.add(this.smoke.group);
  }

  setQuality(q) {
    this.quality = q;
    this.reflector.visible = q !== 'low';
    this.key.castShadow = q !== 'low';
    const n = this.crowd.count;
    const cn = q === 'high' ? n : q === 'medium' ? Math.floor(n * 0.6) : Math.floor(n * 0.3);
    this.crowd.bodies.count = cn; this.crowd.sticks.count = cn;
    this.haze.points.geometry.setDrawRange(0, q === 'low' ? 600 : 2600);
    this.smoke.group.visible = q !== 'low';
  }

  setPalette(hues) {
    const sat = [0.95, 0.9, 0.95];
    this.targetPalette = hues.map((h, i) => new THREE.Color().setHSL(h, sat[i], 0.55));
    this.crowd.setColors(this.targetPalette);
  }

  setWallText(texture) { this.wallMat.uniforms.uText.value = texture; }

  // 毎フレームの演出
  update(dt, c) {
    this.time += dt;
    const t = this.time;
    const H = STAGE_H;
    const beat = c.beat;
    const fb = fract(beat);
    const E = c.energy; // 0..3 なめらか
    const secE = c.section ? c.section.energy : 0;
    const secIdx = c.sectionIdx ?? 0;
    const kick = Math.exp(-fb * 6);
    const playing = c.playing;

    // パレットはゆっくり切り替え。セクションごとに主役の色を回す
    const rot = secIdx % 3;
    for (let i = 0; i < 3; i++) this.palette[i].lerp(this.targetPalette[(i + rot) % 3], 1 - Math.exp(-dt * 1.5));
    const [C1, C2, C3] = this.palette;
    const white = new THREE.Color(1, 1, 1);

    // セクションの切り替わり
    if (c.sectionIdx !== this.lastSection && playing) {
      this.onSection(c);
      this.lastSection = c.sectionIdx;
    }
    // ドロップ前の暗転
    let blackout = 0;
    if (c.nextSection && c.nextSection.energy >= 3 && secE < 3 && c.beatsToNext != null) {
      if (c.beatsToNext < 1) blackout = 1 - clamp(c.beatsToNext, 0, 1) * 0.3;
      if (c.beatsToNext < 0.5) blackout = 1;
    }
    // ストロボ
    const strobe = secE >= 3 ? (Math.floor(beat * 2) % 2 === 0 ? Math.exp(-fract(beat * 2) * 10) : 0) : 0;
    this.flash = Math.max(this.flash * Math.exp(-dt * 6), 0);

    const dancer = this.dancerPos;
    // ---- ムービングライト ----
    const pattern = secE >= 3 ? (secIdx % 2 ? 'fan' : 'cross') : secE === 2 ? 'sweep' : secE === 1 ? 'slow' : 'focus';
    const v = new THREE.Vector3();
    for (const h of this.heads) {
      const p = h.group.position;
      const i = h.idx;
      const sgn = p.x < 0 ? -1 : 1;
      let target;
      if (h.row === 'floor') {
        // 床から上へ扇形
        const spread = pattern === 'focus' ? 0.15 : pattern === 'slow' ? 0.3 + 0.2 * Math.sin(t * 0.4 + i) : 0.5 * Math.sin(beat * Math.PI / 4 + i * 0.8);
        target = v.set(spread + (i - 3.5) * 0.08, 1, 0.15 + 0.35 * Math.sin(beat * Math.PI / 8 + i));
      } else if (pattern === 'focus') {
        target = v.copy(dancer).add(new THREE.Vector3(Math.sin(t * 0.5 + i) * 0.8, 0, Math.cos(t * 0.4 + i) * 0.8)).sub(p);
      } else if (pattern === 'slow') {
        target = v.set(Math.sin(t * 0.35 + i * 0.9) * 0.6, -1, 0.4 + 0.4 * Math.sin(t * 0.27 + i));
      } else if (pattern === 'sweep') {
        const a = Math.sin(beat * Math.PI / 2 + i * 0.5);
        target = v.set(a * 0.9, -1, 0.6 + 0.5 * Math.cos(beat * Math.PI / 4));
      } else if (pattern === 'fan') {
        const open = 0.5 + 0.5 * Math.sin(beat * Math.PI / 2);
        target = v.set(sgn * (0.2 + 0.9 * open) * (Math.abs(p.x) / 8), -1, 0.9 + 0.3 * Math.sin(beat * Math.PI / 4 + i));
      } else { // cross
        const a = Math.sin(beat * Math.PI / 2) * sgn;
        target = v.set(-sgn * 0.5 + a * 0.6, -1, 0.7 + 0.5 * Math.sin(beat * Math.PI + i * 0.7));
      }
      const speed = pattern === 'focus' || pattern === 'slow' ? 2 : 5;
      h.aim(target, dt, speed);
      // 色と明るさ
      const col = (i % 3 === 0 ? C1 : i % 3 === 1 ? C2 : C3).clone();
      let inten;
      if (h.row === 'floor') inten = secE >= 2 ? 0.55 : secE === 1 ? 0.25 : 0.06;
      else if (pattern === 'focus') inten = h.row === 'front' && (i === 3 || i === 4) ? 0.55 : 0.1;
      else inten = 0.25 + 0.18 * E;
      if (secE >= 3) {
        // 拍ごとにチェイス
        const chase = (Math.floor(beat * 2) + i) % 4 === 0 ? 1 : 0;
        inten *= 0.6 + 0.8 * chase * kick + 0.3 * kick;
        if (strobe > 0.3) col.lerp(white, 0.7);
      } else if (secE === 2) inten *= 0.7 + 0.5 * kick;
      inten *= (1 - blackout) * (playing ? 1 : 0.5);
      h.set(col, inten * 0.85);
      h.mat.uniforms.uTime.value = t;
    }

    // ---- レーザー ----
    const lt = secE >= 3 && playing ? 1 : 0;
    this.laserLevel += (lt * (1 - blackout) - this.laserLevel) * (1 - Math.exp(-dt * 6));
    this.lasers.visible = this.laserLevel > 0.01;
    if (this.lasers.visible) {
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(1, 1, 1);
      const col = new THREE.Color();
      let k = 0;
      const mode = secIdx % 3;
      for (let o = 0; o < this.laserOrigins.length; o++) {
        const O = this.laserOrigins[o];
        for (let j = 0; j < 8; j++) {
          let rx, rz;
          const fanA = (j - 3.5) / 3.5;
          if (mode === 0) { rx = 1.25 + 0.15 * Math.sin(beat * Math.PI / 2 + o); rz = fanA * 0.6 * (0.6 + 0.4 * Math.sin(beat * Math.PI / 4)) + Math.sin(t * 0.8 + o) * 0.2; }
          else if (mode === 1) { rx = 1.2 + 0.35 * Math.sin(beat * Math.PI / 2 + j * 0.4); rz = Math.sin(t * 1.3 + o * 0.9 + j * 0.25) * 0.8; }
          else { rx = 1.0 + 0.4 * fract(beat / 2 + j / 8); rz = fanA * 0.9 * Math.cos(beat * Math.PI / 4 + o * 0.3); }
          e.set(rx, 0, rz, 'XZY');
          q.setFromEuler(e);
          m.compose(O, q, s);
          this.lasers.setMatrixAt(k, m);
          col.copy(o % 2 ? C2 : C1);
          if (mode === 2) col.copy(j % 2 ? C3 : C1);
          this.lasers.setColorAt(k, col);
          k++;
        }
      }
      this.lasers.instanceMatrix.needsUpdate = true;
      this.lasers.instanceColor.needsUpdate = true;
      this.laserMat.uniforms.uIntensity.value = this.laserLevel * (0.55 + 0.45 * kick);
    }

    // ---- 本物のライト ----
    this.key.target.position.copy(dancer).add(new THREE.Vector3(0, 0.9, 0));
    this.top.target.position.copy(dancer);
    this.rimL.target.position.copy(dancer).add(new THREE.Vector3(0, 1, 0));
    this.rimR.target.position.copy(dancer).add(new THREE.Vector3(0, 1, 0));
    this.key.position.x = 2.5 + Math.sin(t * 0.1) * 0.5;
    const keyI = (secE === 0 ? 520 : 680) * (1 - blackout * 0.85);
    const CL = this.charLight;
    this.key.intensity = (keyI + strobe * 600) * CL;
    this.rimL.color.copy(C1); this.rimR.color.copy(C2);
    this.rimL.intensity = (350 + 450 * E / 3 + kick * 300 * (E / 3)) * (1 - blackout) * CL;
    this.rimR.intensity = this.rimL.intensity;
    this.top.color.copy(C3).lerp(white, 0.6);
    this.top.intensity = (secE === 0 ? 250 : 150 + 200 * kick * E / 3) * (1 - blackout) * CL;
    this.hemi.intensity = (0.35 + 0.15 * E / 3) * (0.5 + 0.5 * CL);
    this.hemi.color.copy(C2).lerp(new THREE.Color('#3a3a6a'), 0.7);
    this.fill.color.copy(C1).lerp(white, 0.5);
    this.fill.intensity = (25 + 25 * E / 3) * CL;

    // ---- LEDスクリーン ----
    const W = this.wallMat.uniforms;
    W.uTime.value = t; W.uBeat.value = beat; W.uEnergy.value = E;
    W.uC1.value.copy(C1); W.uC2.value.copy(C2); W.uC3.value.copy(C3);
    W.uLevels.value.set(c.levels.bass, c.levels.mid, c.levels.high, c.levels.kick);
    W.uFeed.value = c.feedTexture;
    // モードの切り替え(セクションと小節で)
    const wantA = this.wallModeFor(secE, secIdx, Math.floor(beat / 16));
    if (wantA !== this._wallTarget) { this._wallFrom = this._wallTarget ?? wantA; this._wallTarget = wantA; this._wallMix = 0; }
    this._wallMix = Math.min(1, (this._wallMix ?? 1) + dt * 1.5);
    W.uModeA.value = this._wallFrom ?? wantA; W.uModeB.value = this._wallTarget; W.uMix.value = this._wallMix;
    const feedTarget = c.feedOn ? (secE >= 1 ? 1 : 0.0) : 0;
    W.uFeedMix.value += (feedTarget - W.uFeedMix.value) * (1 - Math.exp(-dt * 2));
    W.uFeedFull.value += ((secE === 1 && Math.floor(beat / 32) % 2 === 1 ? 1 : 0) - W.uFeedFull.value) * (1 - Math.exp(-dt * 2));
    W.uBright.value = (playing ? 0.9 + 0.2 * kick * (E / 3) : 0.7) * (1 - blackout * 0.95);
    W.uFlash.value = strobe * 0.18 + this.flash * 0.3;
    W.uTextMix.value += ((c.showTitle ? 1 : 0) - W.uTextMix.value) * (1 - Math.exp(-dt * 3));
    for (const m of this.sideMats) {
      const U = m.uniforms;
      U.uTime.value = t; U.uBeat.value = beat; U.uC1.value.copy(C1); U.uC2.value.copy(C2); U.uC3.value.copy(C3);
      U.uFeed.value = c.feedTexture; U.uFeedMix.value = c.feedOn ? 1 : 0; U.uModeA.value = U.uModeB.value = 0;
      U.uBright.value = 0.9 * (1 - blackout * 0.9); U.uFlash.value = strobe * 0.1;
    }

    // ---- 床 ----
    const F = this.floorMat.uniforms;
    F.uTime.value = t; F.uBeat.value = beat; F.uEnergy.value = E;
    F.uC1.value.copy(C1); F.uC2.value.copy(C2); F.uC3.value.copy(C3);
    F.uPattern.value = secE >= 3 ? 3 : secE === 2 ? 1 + (secIdx % 2) : 0;
    F.uBright.value = (1 - blackout) * (playing ? 1 : 0.5);
    F.uDancer.value.set(dancer.x, dancer.z - (STAGE_Z0 + STAGE_D / 2));
    for (const m of this.chaseMats) {
      m.uniforms.uTime.value = t; m.uniforms.uBeat.value = beat; m.uniforms.uEnergy.value = E * (1 - blackout);
      m.uniforms.uC1.value.copy(C1); m.uniforms.uC2.value.copy(C2);
    }

    // ---- 観客・特効 ----
    this.crowd.update(dt, beat, playing ? secE : 0, t);
    this.haze.mat.color.copy(C2).lerp(white, 0.5);
    this.haze.mat.opacity = 0.18 + 0.2 * E / 3;
    this.haze.update(dt, t);
    this.sparks.update(dt);
    this.confetti.update(dt);
    this.smoke.update(dt, secE === 0 || (c.section && c.section.label.includes('間奏')) ? 1 : 0.35);

    if (this.reflector) this.reflector.material.uniforms.color.value.setScalar(0.55 + 0.1 * E / 3);
  }

  wallModeFor(e, secIdx, phrase) {
    if (e === 0) return phrase % 2 ? 4 : 0;
    if (e === 1) return [0, 2, 4][(secIdx + phrase) % 3];
    if (e === 2) return phrase % 2 ? 1 : 2;
    return [3, 1, 3, 2][(secIdx + phrase) % 4];
  }

  onSection(c) {
    const s = c.section;
    if (!s) return;
    const H = STAGE_H;
    if (s.energy >= 3) {
      // サビの頭: 火花とフラッシュ
      this.flash = 0.9;
      for (const x of [-6.5, -3.5, 3.5, 6.5]) this.sparks.fountain(x, H, 3.6, 2.2, new THREE.Color('#ffcf7a'), 1);
      this.sparks.fountain(0, H, 13, 2.2, new THREE.Color('#ffe6b0'), 1.1);
      if (c.isLastChorus) this.confetti.launch(this.palette.map((x) => x.clone()), H);
    } else if (s.energy === 2 && c.prevEnergy < 2) {
      this.flash = 0.3;
    }
  }

  finale() {
    const H = STAGE_H;
    this.flash = 1;
    for (const x of [-7, -4.5, -2, 2, 4.5, 7]) this.sparks.fountain(x, H, 3.6, 3, new THREE.Color('#ffd27a'), 1.2);
    this.sparks.burst(0, H + 9, -2, 600, new THREE.Color('#fff4d0'), 8);
    this.confetti.launch(this.palette.map((x) => x.clone()), H);
  }
}
