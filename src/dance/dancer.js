// ダンサー: キャラ(VRM または内蔵キャラ)+ リグ + 表情・まばたき・口パク・視線
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';
import { Rig } from './rig.js';
import { createMannequin } from './mannequin.js';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3();

export async function loadVRMFromBuffer(arrayBuffer) {
  const loader = new GLTFLoader();
  loader.register((parser) => new VRMLoaderPlugin(parser));
  const gltf = await loader.parseAsync(arrayBuffer, '');
  const vrm = gltf.userData.vrm;
  if (!vrm) throw new Error('VRMファイルではないようです');
  VRMUtils.removeUnnecessaryVertices(gltf.scene);
  if (VRMUtils.combineSkeletons) VRMUtils.combineSkeletons(gltf.scene);
  VRMUtils.rotateVRM0(vrm);
  vrm.scene.traverse((o) => {
    o.frustumCulled = false;
    if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }
  });
  return vrm;
}

// 色違い(記事のバックダンサー): 彩度の高い部分だけ色相を回す。肌の色は残す
function hueShiftImage(image, shift) {
  // 色変えの計算は大きくても1024pxに縮めて行う(読み込みを速く・メモリを少なく)
  const k = Math.min(1, 1024 / Math.max(image.width || 1, image.height || 1));
  const w = Math.round(image.width * k), h = Math.round(image.height * k);
  if (!w || !h) return null;
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const g = cv.getContext('2d', { willReadFrequently: true });
  g.drawImage(image, 0, 0, w, h);
  const id = g.getImageData(0, 0, w, h);
  const d = id.data;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i] / 255, gg = d[i + 1] / 255, b = d[i + 2] / 255;
    const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b);
    const l = (mx + mn) / 2;
    const dd = mx - mn;
    if (dd < 0.12) continue;
    const s = dd / (1 - Math.abs(2 * l - 1) + 1e-6);
    let hh;
    if (mx === r) hh = ((gg - b) / dd) % 6; else if (mx === gg) hh = (b - r) / dd + 2; else hh = (r - gg) / dd + 4;
    hh /= 6; if (hh < 0) hh += 1;
    // 肌っぽい色(オレンジ寄り・明るい・彩度ひかえめ)は残す
    if (hh > 0.01 && hh < 0.12 && l > 0.55 && s < 0.75) continue;
    const nh = (hh + shift) % 1;
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((nh * 6) % 2) - 1));
    const m = l - c / 2;
    let rr, g2, bb;
    const k = Math.floor(nh * 6);
    [rr, g2, bb] = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][k % 6];
    d[i] = (rr + m) * 255; d[i + 1] = (g2 + m) * 255; d[i + 2] = (bb + m) * 255;
  }
  g.putImageData(id, 0, 0);
  return cv;
}

function hueShiftColor(col, shift) {
  const hsl = {}; col.getHSL(hsl);
  if (hsl.s < 0.15) return;
  col.setHSL((hsl.h + shift) % 1, hsl.s, hsl.l);
}

export function recolorVRM(vrm, shift) {
  const done = new Map();
  vrm.scene.traverse((o) => {
    if (!o.isMesh) return;
    const ms = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of ms) {
      if (done.has(m)) continue;
      done.set(m, true);
      for (const key of ['map', 'shadeMultiplyTexture']) {
        const tex = m[key] || m.uniforms?.[key]?.value;
        if (tex && tex.image) {
          const cv = hueShiftImage(tex.image, shift);
          if (cv) {
            const nt = tex.clone(); nt.image = cv; nt.needsUpdate = true;
            if (m[key] !== undefined) m[key] = nt; else m.uniforms[key].value = nt;
          }
        }
      }
      if (m.color) hueShiftColor(m.color, shift);
      if (m.shadeColorFactor) hueShiftColor(m.shadeColorFactor, shift);
      m.needsUpdate = true;
    }
  });
}

export class Dancer {
  constructor({ isMain = true } = {}) {
    this.group = new THREE.Group(); // 立ち位置
    this.turn = new THREE.Group(); // 体ごとの回転
    this.group.add(this.turn);
    this.isMain = isMain;
    this.vrm = null;
    this.mannequin = null;
    this.rig = null;
    this.blinkTimer = 2 + Math.random() * 3;
    this.blink = 0;
    this.look = new THREE.Vector2();
    this.mouth = 0;
    this.time = 0;
  }

  get kind() { return this.vrm ? 'vrm' : 'mannequin'; }

  clear() {
    if (this.vrm) { this.turn.remove(this.vrm.scene); VRMUtils.deepDispose(this.vrm.scene); this.vrm = null; }
    if (this.mannequin) { this.turn.remove(this.mannequin.root); this.mannequin = null; }
    this.rig = null;
  }

  useMannequin(accent, accent2) {
    this.clear();
    this.mannequin = createMannequin({ accent: new THREE.Color(accent), accent2: new THREE.Color(accent2) });
    this.turn.add(this.mannequin.root);
    this.turn.rotation.set(0, 0, 0);
    this.rig = new Rig(this.turn, (n) => this.mannequin.getBone(n));
    this.rig.init();
  }

  useVRM(vrm) {
    this.clear();
    this.vrm = vrm;
    this.turn.rotation.set(0, 0, 0);
    this.turn.add(vrm.scene);
    vrm.humanoid.resetNormalizedPose();
    vrm.update(0);
    this.rig = new Rig(this.turn, (n) => vrm.humanoid.getNormalizedBoneNode(n));
    this.rig.init();
    if (vrm.lookAt) vrm.lookAt.autoUpdate = true;
    // 揺れもの初期化
    if (vrm.springBoneManager) vrm.springBoneManager.reset();
  }

  get height() { return this.rig ? this.rig.height : 1.6; }

  setExpr(name, v) {
    if (this.vrm && this.vrm.expressionManager) {
      const em = this.vrm.expressionManager;
      if (em.getExpression(name)) em.setValue(name, v);
    } else if (this.mannequin) this.mannequin.setExpression(name, v);
  }

  // pose: 振り付けのポーズ / camera: 視線先 / levels: 音量
  update(dt, pose, camera, levels, { lookAtCamera = true, singing = 0 } = {}) {
    if (!this.rig) return;
    this.time += dt;
    // 頭を少しカメラへ向ける
    if (lookAtCamera && camera && !pose.mocap) {
      this.rig.getHeadWorld(_v);
      camera.getWorldPosition(_v2);
      this.turn.worldToLocal(_v2);
      const head = this.turn.worldToLocal(_v.clone());
      const d = _v2.sub(head);
      const yaw = Math.atan2(d.x, d.z);
      const pitch = -Math.atan2(d.y, Math.hypot(d.x, d.z));
      const inFront = Math.abs(yaw) < 1.3 ? 1 : 0;
      const ty = THREE.MathUtils.clamp(yaw, -0.6, 0.6) * 0.35 * inFront;
      const tp = THREE.MathUtils.clamp(pitch, -0.35, 0.35) * 0.3 * inFront;
      const k = 1 - Math.exp(-dt * 4);
      this.look.x += (ty - this.look.x) * k;
      this.look.y += (tp - this.look.y) * k;
      pose.headY += this.look.x; pose.headP += this.look.y;
    }
    if (pose.mocap) this.rig.applyMocap(pose.mocap.q, pose.mocap.root);
    else this.rig.apply(pose);

    // まばたき
    this.blinkTimer -= dt;
    if (this.blinkTimer <= 0) { this.blink = 1; this.blinkTimer = 1.5 + Math.random() * 4; }
    const blinkVal = this.blink > 0 ? Math.sin(Math.PI * (1 - this.blink)) : 0;
    this.blink = Math.max(0, this.blink - dt * 7);
    // 口パク(歌声の帯域の音量に合わせる)
    const target = Math.min(1, Math.max(0, (levels.vocal - 0.25) * 2.2)) * singing;
    this.mouth += (target - this.mouth) * (1 - Math.exp(-dt * 18));
    const happy = Math.min(1, pose.happy);
    this.setExpr('happy', happy * (1 - this.mouth * 0.4));
    this.setExpr('relaxed', Math.max(0, pose.relaxed - happy) * 0.6);
    this.setExpr('surprised', pose.surprised * 0.6);
    this.setExpr('aa', this.mouth * 0.85);
    this.setExpr('oh', this.mouth * 0.25 * (0.5 + 0.5 * Math.sin(this.time * 9)));
    const wink = Math.min(1, pose.wink);
    if (this.vrm) {
      this.setExpr('blink', Math.max(blinkVal * (1 - happy * 0.6), 0));
      this.setExpr('blinkLeft', wink);
    } else {
      this.setExpr('blink', blinkVal);
      this.setExpr('wink', wink);
    }

    if (this.vrm) {
      if (this.vrm.lookAt && camera) this.vrm.lookAt.target = camera;
      this.vrm.update(dt);
    } else if (this.mannequin) this.mannequin.update(dt);
  }
}
