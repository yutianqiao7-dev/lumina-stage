// VRMが無いときの内蔵キャラ「ルミナ」: 関節ごとのパーツで作ったアンドロイド風アイドル
import * as THREE from 'three';

const BONE_DEF = [
  ['hips', null, [0, 0.95, 0]],
  ['spine', 'hips', [0, 1.03, 0]],
  ['chest', 'spine', [0, 1.16, 0]],
  ['upperChest', 'chest', [0, 1.29, 0]],
  ['neck', 'upperChest', [0, 1.42, 0]],
  ['head', 'neck', [0, 1.5, 0]],
  ['leftShoulder', 'upperChest', [0.035, 1.385, 0]],
  ['leftUpperArm', 'leftShoulder', [0.165, 1.385, 0]],
  ['leftLowerArm', 'leftUpperArm', [0.42, 1.385, 0]],
  ['leftHand', 'leftLowerArm', [0.655, 1.385, 0]],
  ['rightShoulder', 'upperChest', [-0.035, 1.385, 0]],
  ['rightUpperArm', 'rightShoulder', [-0.165, 1.385, 0]],
  ['rightLowerArm', 'rightUpperArm', [-0.42, 1.385, 0]],
  ['rightHand', 'rightLowerArm', [-0.655, 1.385, 0]],
  ['leftUpperLeg', 'hips', [0.088, 0.9, 0]],
  ['leftLowerLeg', 'leftUpperLeg', [0.088, 0.49, 0.005]],
  ['leftFoot', 'leftLowerLeg', [0.088, 0.085, -0.01]],
  ['leftToes', 'leftFoot', [0.088, 0.02, 0.12]],
  ['rightUpperLeg', 'hips', [-0.088, 0.9, 0]],
  ['rightLowerLeg', 'rightUpperLeg', [-0.088, 0.49, 0.005]],
  ['rightFoot', 'rightLowerLeg', [-0.088, 0.085, -0.01]],
  ['rightToes', 'rightFoot', [-0.088, 0.02, 0.12]],
];

function segment(from, to, r0, r1, mat) {
  // from→to のカプセル風パーツ(fromのボーン座標系に置く)
  const dir = new THREE.Vector3().subVectors(to, from);
  const len = dir.length();
  const geo = new THREE.CylinderGeometry(r1, r0, len, 20, 1);
  geo.translate(0, len / 2, 0);
  const m = new THREE.Mesh(geo, mat);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
  const g = new THREE.Group(); g.add(m);
  const cap0 = new THREE.Mesh(new THREE.SphereGeometry(r0, 20, 12), mat);
  const cap1 = new THREE.Mesh(new THREE.SphereGeometry(r1, 20, 12), mat);
  cap1.position.copy(dir);
  g.add(cap0, cap1);
  return g;
}

export function createMannequin({ accent = new THREE.Color('#ff4fa3'), accent2 = new THREE.Color('#4fe3ff') } = {}) {
  const root = new THREE.Group();
  root.name = 'Lumina';
  const bones = {};
  const world = {};
  for (const [name, parent, pos] of BONE_DEF) {
    const b = new THREE.Object3D(); b.name = name;
    world[name] = new THREE.Vector3(...pos);
    if (parent) {
      b.position.copy(world[name]).sub(world[parent]);
      bones[parent].add(b);
    } else { b.position.copy(world[name]); root.add(b); }
    bones[name] = b;
  }
  const W = (n) => world[n];
  const local = (n, v) => v.clone().sub(world[n]);

  const body = new THREE.MeshPhysicalMaterial({ color: '#dcd7e6', roughness: 0.4, metalness: 0.05, clearcoat: 0.9, clearcoatRoughness: 0.15, sheen: 0.3, sheenColor: new THREE.Color('#ffd6f0') });
  const suit = new THREE.MeshPhysicalMaterial({ color: '#1b1830', roughness: 0.45, metalness: 0.3, clearcoat: 0.6, clearcoatRoughness: 0.3 });
  const joint = new THREE.MeshStandardMaterial({ color: '#2a2640', roughness: 0.4, metalness: 0.6 });
  const glowA = new THREE.MeshStandardMaterial({ color: '#000000', emissive: accent, emissiveIntensity: 3.2, roughness: 0.4 });
  const glowB = new THREE.MeshStandardMaterial({ color: '#000000', emissive: accent2, emissiveIntensity: 2.6, roughness: 0.4 });
  const hairMat = new THREE.MeshPhysicalMaterial({ color: accent.clone().lerp(new THREE.Color('#ffffff'), 0.25), roughness: 0.35, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.2, sheen: 1, sheenColor: accent2 });
  const mats = { body, suit, joint, glowA, glowB, hairMat };

  const add = (boneName, obj) => { bones[boneName].add(obj); return obj; };

  // 胴体
  const torso = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 24), suit);
  torso.scale.set(0.112, 0.16, 0.08); torso.position.set(0, 0.06, 0.0);
  add('chest', torso);
  const bust = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 24), suit);
  bust.scale.set(0.122, 0.095, 0.085); bust.position.set(0, 0.02, 0.005);
  add('upperChest', bust);
  const collar = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.012, 10, 32), glowA);
  collar.rotation.x = Math.PI / 2; collar.position.set(0, 0.11, 0);
  add('upperChest', collar);
  const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.028, 0), glowB);
  core.position.set(0, 0.02, 0.1); core.scale.set(1, 1.3, 0.5);
  add('upperChest', core);
  const waist = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 20), suit);
  waist.scale.set(0.095, 0.1, 0.07); waist.position.set(0, 0.02, 0);
  add('spine', waist);
  const belt = new THREE.Mesh(new THREE.TorusGeometry(0.097, 0.009, 10, 40), glowA);
  belt.rotation.x = Math.PI / 2; belt.scale.set(1, 0.75, 1); belt.position.set(0, -0.04, 0);
  add('spine', belt);
  const pelvis = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 20), suit);
  pelvis.scale.set(0.12, 0.085, 0.085); pelvis.position.set(0, -0.03, 0);
  add('hips', pelvis);
  // スカート(フリル付き)
  const skirtGeo = new THREE.CylinderGeometry(0.125, 0.25, 0.24, 48, 1, true);
  const pos = skirtGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y < 0) { const a = Math.atan2(pos.getZ(i), pos.getX(i)); const r = 1 + 0.06 * Math.sin(a * 12); pos.setX(i, pos.getX(i) * r); pos.setZ(i, pos.getZ(i) * r); }
  }
  skirtGeo.computeVertexNormals();
  const skirtMat = new THREE.MeshPhysicalMaterial({ color: accent, roughness: 0.4, metalness: 0.1, clearcoat: 0.5, side: THREE.DoubleSide, sheen: 1, sheenColor: '#ffffff' });
  mats.skirt = skirtMat;
  const skirt = new THREE.Mesh(skirtGeo, skirtMat);
  skirt.position.set(0, -0.12, 0);
  add('hips', skirt);
  const hem = new THREE.Mesh(new THREE.TorusGeometry(0.255, 0.006, 6, 64), glowB);
  hem.rotation.x = Math.PI / 2; hem.position.set(0, -0.24, 0);
  add('hips', hem);

  // 首・頭
  const skin = new THREE.MeshPhysicalMaterial({ color: '#ffe6dc', roughness: 0.55, metalness: 0, sheen: 0.6, sheenColor: new THREE.Color('#ffc4c4') });
  mats.skin = skin;
  add('neck', segment(new THREE.Vector3(0, -0.01, 0), local('neck', W('head')).add(new THREE.Vector3(0, 0.02, 0)), 0.03, 0.027, skin));
  const head = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 36), skin);
  head.scale.set(0.095, 0.108, 0.098); head.position.set(0, 0.1, 0.005);
  add('head', head);
  // あご(少し細く)
  const chin = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 24), skin);
  chin.scale.set(0.07, 0.07, 0.075); chin.position.set(0, 0.055, 0.02);
  add('head', chin);
  // 顔(アニメ風の目・口・ほっぺ)
  const iris = '#' + accent2.clone().lerp(new THREE.Color('#5a7dff'), 0.35).getHexString();
  const eyeTex = makeEyeTexture(iris, false), eyeClosed = makeEyeTexture(iris, true);
  const eyeMats = [];
  const eyes = [];
  for (const sx of [1, -1]) {
    const m = new THREE.MeshBasicMaterial({ map: eyeTex, transparent: true, depthWrite: false, toneMapped: false });
    const e = new THREE.Mesh(new THREE.PlaneGeometry(0.056, 0.058), m);
    e.position.set(0.035 * sx, 0.094, 0.1); e.rotation.y = 0.32 * sx;
    if (sx < 0) e.scale.x = -1;
    e.renderOrder = 3;
    add('head', e); eyes.push(e); eyeMats.push(m);
  }
  const mouthSmile = makeMouthTexture(false), mouthOpen = makeMouthTexture(true);
  const mouthMat = new THREE.MeshBasicMaterial({ map: mouthSmile, transparent: true, depthWrite: false });
  const mouth = new THREE.Mesh(new THREE.PlaneGeometry(0.03, 0.022), mouthMat);
  mouth.position.set(0, 0.052, 0.0985); mouth.renderOrder = 3;
  add('head', mouth);
  const blushMat = new THREE.MeshBasicMaterial({ map: makeBlushTexture(), transparent: true, depthWrite: false, opacity: 0.55 });
  for (const sx of [1, -1]) {
    const b = new THREE.Mesh(new THREE.PlaneGeometry(0.032, 0.018), blushMat);
    b.position.set(0.05 * sx, 0.068, 0.088); b.rotation.y = 0.5 * sx; b.renderOrder = 2;
    add('head', b);
  }
  // 髪(ボブ+ツインテール)
  const hair = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 28, Math.PI * 0.8, Math.PI * 1.4, 0, Math.PI * 0.66), hairMat);
  hairMat.side = THREE.DoubleSide;
  hair.scale.set(0.108, 0.122, 0.11); hair.position.set(0, 0.1, -0.004); hair.rotation.x = -0.1;
  add('head', hair);
  const bangs = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16, Math.PI * 0.5 - Math.PI * 0.36, Math.PI * 0.72, 0, Math.PI * 0.39), hairMat);
  bangs.scale.set(0.11, 0.118, 0.112); bangs.position.set(0, 0.112, 0.004);
  add('head', bangs);
  const tails = [];
  for (const sx of [1, -1]) {
    const pivot = new THREE.Group(); pivot.position.set(0.085 * sx, 0.17, -0.03);
    const tie = new THREE.Mesh(new THREE.TorusGeometry(0.018, 0.007, 8, 20), glowA);
    tie.rotation.y = Math.PI / 2; pivot.add(tie);
    const tailGeo = new THREE.CapsuleGeometry(0.032, 0.26, 6, 16);
    const tp = tailGeo.attributes.position;
    for (let i = 0; i < tp.count; i++) { const y = tp.getY(i); const k = 1 - Math.max(0, (-y) / 0.3) * 0.6; tp.setX(i, tp.getX(i) * k * (1 + 0.15 * (y > 0 ? 1 : 0))); tp.setZ(i, tp.getZ(i) * k); }
    tailGeo.computeVertexNormals();
    const tail = new THREE.Mesh(tailGeo, hairMat);
    tail.position.set(0.02 * sx, -0.16, -0.01); tail.rotation.z = 0.15 * sx;
    pivot.add(tail);
    add('head', pivot); tails.push({ pivot, sx, vel: new THREE.Vector2(), ang: new THREE.Vector2() });
  }
  // ヘッドホン風の飾り
  for (const sx of [1, -1]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.026, 0.008, 8, 24), glowB);
    ring.position.set(0.1 * sx, 0.1, 0); ring.rotation.y = Math.PI / 2;
    add('head', ring);
  }

  // 腕
  for (const s of ['left', 'right']) {
    add(s + 'Shoulder', segment(new THREE.Vector3(), local(s + 'Shoulder', W(s + 'UpperArm')), 0.034, 0.038, suit));
    add(s + 'UpperArm', segment(new THREE.Vector3(), local(s + 'UpperArm', W(s + 'LowerArm')), 0.033, 0.028, body));
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.033, 0.005, 8, 24), glowA);
    band.rotation.y = Math.PI / 2; band.position.copy(local(s + 'UpperArm', W(s + 'UpperArm')).lerp(local(s + 'UpperArm', W(s + 'LowerArm')), 0.25));
    add(s + 'UpperArm', band);
    add(s + 'LowerArm', segment(new THREE.Vector3(), local(s + 'LowerArm', W(s + 'Hand')), 0.027, 0.022, body));
    const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.029, 0.032, 0.07, 20), suit);
    cuff.rotation.z = Math.PI / 2; cuff.position.copy(local(s + 'LowerArm', W(s + 'Hand'))).multiplyScalar(0.8);
    add(s + 'LowerArm', cuff);
    const cuffGlow = new THREE.Mesh(new THREE.TorusGeometry(0.031, 0.005, 6, 24), glowB);
    cuffGlow.rotation.y = Math.PI / 2; cuffGlow.position.copy(cuff.position).multiplyScalar(0.95);
    add(s + 'LowerArm', cuffGlow);
    const sx = s === 'left' ? 1 : -1;
    const palm = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.025, 0.06, 2, 2, 2), body);
    palm.position.set(0.045 * sx, 0, 0.005);
    add(s + 'Hand', palm);
    const fingers = new THREE.Mesh(new THREE.CapsuleGeometry(0.012, 0.055, 4, 8), body);
    fingers.rotation.z = Math.PI / 2; fingers.scale.set(1, 1, 2.2); fingers.position.set(0.1 * sx, -0.002, 0.005);
    add(s + 'Hand', fingers);
    const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.01, 0.03, 4, 8), body);
    thumb.position.set(0.045 * sx, -0.005, 0.04); thumb.rotation.x = Math.PI / 2; thumb.rotation.z = 0.5 * sx;
    add(s + 'Hand', thumb);
  }
  // 脚
  for (const s of ['left', 'right']) {
    add(s + 'UpperLeg', segment(new THREE.Vector3(), local(s + 'UpperLeg', W(s + 'LowerLeg')), 0.06, 0.042, body));
    add(s + 'LowerLeg', segment(new THREE.Vector3(), local(s + 'LowerLeg', W(s + 'Foot')), 0.04, 0.03, body));
    // ブーツ
    const boot = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.044, 0.2, 24), suit);
    boot.position.copy(local(s + 'LowerLeg', W(s + 'Foot'))).multiplyScalar(0.27).add(new THREE.Vector3(0, 0, 0));
    boot.position.copy(local(s + 'LowerLeg', W(s + 'Foot')).multiplyScalar(0.78));
    add(s + 'LowerLeg', boot);
    const bootGlow = new THREE.Mesh(new THREE.TorusGeometry(0.051, 0.006, 6, 28), glowA);
    bootGlow.rotation.x = Math.PI / 2; bootGlow.position.copy(boot.position).add(new THREE.Vector3(0, 0.1, 0));
    add(s + 'LowerLeg', bootGlow);
    const foot = new THREE.Mesh(new THREE.CapsuleGeometry(0.038, 0.1, 6, 12), suit);
    foot.rotation.x = Math.PI / 2; foot.scale.set(1, 1, 0.75); foot.position.set(0, -0.045, 0.05);
    add(s + 'Foot', foot);
    const knee = new THREE.Mesh(new THREE.SphereGeometry(0.045, 16, 12), joint);
    knee.position.set(0, 0, 0.015); add(s + 'LowerLeg', knee);
  }
  root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });

  const expr = { blink: 0, aa: 0, happy: 0, wink: 0, surprised: 0 };
  const _wp = new THREE.Vector3(), _prev = new THREE.Vector3();
  let first = true;
  return {
    root,
    bones,
    mats,
    getBone: (n) => bones[n] || null,
    setExpression(name, v) { expr[name] = v; },
    update(dt) {
      for (let i = 0; i < 2; i++) {
        const e = eyes[i];
        const closed = Math.max(expr.blink, i === 0 ? expr.wink : 0);
        eyeMats[i].map = closed > 0.55 ? eyeClosed : eyeTex;
        const sy = closed > 0.55 ? 1 : (1 - closed * 0.6) * (1 - expr.happy * 0.18) * (1 + expr.surprised * 0.15);
        e.scale.y = sy;
      }
      mouthMat.map = expr.aa > 0.18 ? mouthOpen : mouthSmile;
      mouth.scale.set(1 + expr.happy * 0.15, expr.aa > 0.18 ? 0.6 + expr.aa * 0.9 : 1, 1);
      // ツインテールの簡易物理
      bones.head.getWorldPosition(_wp);
      if (first) { _prev.copy(_wp); first = false; }
      const vel = _wp.clone().sub(_prev).divideScalar(Math.max(dt, 1 / 240));
      _prev.copy(_wp);
      for (const t of tails) {
        const k = 60, damp = 7;
        const target = new THREE.Vector2(THREE.MathUtils.clamp(-vel.x * 0.06 * t.sx, -0.8, 0.8), THREE.MathUtils.clamp(vel.z * 0.06 + vel.y * 0.05, -0.8, 0.8));
        const acc = target.clone().sub(t.ang).multiplyScalar(k).sub(t.vel.clone().multiplyScalar(damp));
        t.vel.addScaledVector(acc, Math.min(dt, 1 / 30));
        t.ang.addScaledVector(t.vel, Math.min(dt, 1 / 30));
        t.pivot.rotation.set(t.ang.y, 0, t.ang.x * t.sx + 0.08 * t.sx);
      }
    },
    setAccent(c1, c2) {
      glowA.emissive.copy(c1); glowB.emissive.copy(c2);
      skirtMat.color.copy(c1);
      hairMat.color.copy(c1).lerp(new THREE.Color('#ffffff'), 0.25);
      hairMat.sheenColor.copy(c2);
    },
  };
}

// ---- 顔のテクスチャ(キャンバスで描く) ----
function canvasTex(w, h, draw) {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  draw(cv.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
function makeEyeTexture(iris, closed) {
  return canvasTex(256, 256, (g, w, h) => {
    g.lineCap = 'round';
    if (closed) {
      g.strokeStyle = '#3a2433'; g.lineWidth = 16;
      g.beginPath(); g.moveTo(40, 130); g.quadraticCurveTo(128, 175, 216, 120); g.stroke();
      g.lineWidth = 8; g.beginPath(); g.moveTo(205, 122); g.lineTo(236, 104); g.stroke();
      return;
    }
    // 白目
    g.fillStyle = '#ffffff';
    g.beginPath(); g.ellipse(128, 140, 92, 100, 0, 0, Math.PI * 2); g.fill();
    // 虹彩
    const gr = g.createLinearGradient(0, 50, 0, 230);
    gr.addColorStop(0, '#1d1530'); gr.addColorStop(0.45, iris); gr.addColorStop(1, '#ffffff');
    g.fillStyle = gr;
    g.beginPath(); g.ellipse(128, 150, 66, 84, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(20,10,40,0.85)';
    g.beginPath(); g.ellipse(128, 150, 30, 40, 0, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(30,20,50,0.9)'; g.lineWidth = 6;
    g.beginPath(); g.ellipse(128, 150, 66, 84, 0, 0, Math.PI * 2); g.stroke();
    // ハイライト
    g.fillStyle = '#ffffff';
    g.beginPath(); g.ellipse(100, 112, 22, 26, -0.4, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.ellipse(160, 190, 10, 12, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.6)';
    g.beginPath(); g.ellipse(150, 120, 6, 6, 0, 0, Math.PI * 2); g.fill();
    // まつげ(上)
    g.strokeStyle = '#2a1826'; g.lineWidth = 18;
    g.beginPath(); g.moveTo(30, 108); g.quadraticCurveTo(110, 30, 222, 80); g.stroke();
    g.lineWidth = 10; g.beginPath(); g.moveTo(214, 80); g.lineTo(244, 62); g.stroke();
    g.beginPath(); g.moveTo(222, 92); g.lineTo(246, 92); g.stroke();
    // 下まつげ
    g.lineWidth = 4; g.strokeStyle = 'rgba(42,24,38,0.7)';
    g.beginPath(); g.moveTo(70, 232); g.quadraticCurveTo(128, 246, 190, 228); g.stroke();
    // 外側を透明に
    g.globalCompositeOperation = 'destination-in';
    g.beginPath(); g.ellipse(128, 136, 124, 122, 0, 0, Math.PI * 2); g.fill();
  });
}
function makeMouthTexture(open) {
  return canvasTex(128, 96, (g) => {
    g.lineCap = 'round';
    if (!open) {
      g.strokeStyle = '#7a3443'; g.lineWidth = 7;
      g.beginPath(); g.moveTo(34, 40); g.quadraticCurveTo(64, 66, 94, 40); g.stroke();
    } else {
      g.fillStyle = '#7a2638';
      g.beginPath(); g.moveTo(26, 30); g.quadraticCurveTo(64, 26, 102, 30); g.quadraticCurveTo(96, 86, 64, 88); g.quadraticCurveTo(32, 86, 26, 30); g.fill();
      g.fillStyle = '#ff8fa3';
      g.beginPath(); g.ellipse(64, 72, 22, 12, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#ffffff';
      g.fillRect(36, 30, 56, 8);
    }
  });
}
function makeBlushTexture() {
  return canvasTex(128, 64, (g) => {
    const gr = g.createRadialGradient(64, 32, 2, 64, 32, 60);
    gr.addColorStop(0, 'rgba(255,110,150,0.9)'); gr.addColorStop(1, 'rgba(255,110,150,0)');
    g.fillStyle = gr; g.scale(1, 0.5); g.beginPath(); g.arc(64, 64, 60, 0, Math.PI * 2); g.fill();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.strokeStyle = 'rgba(255,80,120,0.55)'; g.lineWidth = 3;
    for (let i = 0; i < 3; i++) { g.beginPath(); g.moveTo(44 + i * 16, 38); g.lineTo(52 + i * 16, 26); g.stroke(); }
  });
}
