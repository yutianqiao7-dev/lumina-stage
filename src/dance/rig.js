// 人型リグ: ポーズ(数値)→ 各ボーンの回転。腕と脚は2ボーンIKで解き、足は床に固定する。
// VRM(正規化ボーン)でも、内蔵マネキンでも同じように動く。
import * as THREE from 'three';

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();
const _m1 = new THREE.Matrix4(), _m2 = new THREE.Matrix4();
const _e = new THREE.Euler();
const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);

const BONES = [
  'hips', 'spine', 'chest', 'upperChest', 'neck', 'head',
  'leftShoulder', 'leftUpperArm', 'leftLowerArm', 'leftHand',
  'rightShoulder', 'rightUpperArm', 'rightLowerArm', 'rightHand',
  'leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'leftToes',
  'rightUpperLeg', 'rightLowerLeg', 'rightFoot', 'rightToes',
];
// 指(VRMのみ)。自然に軽く曲げる
const FINGERS = [];
for (const s of ['left', 'right']) for (const f of ['Index', 'Middle', 'Ring', 'Little']) for (const k of ['Proximal', 'Intermediate', 'Distal']) FINGERS.push(s + f + k);
for (const s of ['left', 'right']) for (const k of ['Metacarpal', 'Proximal', 'Distal']) FINGERS.push(s + 'Thumb' + k);
BONES.push(...FINGERS);
// モーションキャプチャー(SMPL 22関節)→ VRMボーン
const MOCAP_BONES = ['hips', 'leftUpperLeg', 'rightUpperLeg', 'spine', 'leftLowerLeg', 'rightLowerLeg', 'chest', 'leftFoot', 'rightFoot',
  'upperChest', 'leftToes', 'rightToes', 'neck', 'leftShoulder', 'rightShoulder', 'head', 'leftUpperArm', 'rightUpperArm',
  'leftLowerArm', 'rightLowerArm', 'leftHand', 'rightHand'];
const MOCAP_PARENT = [-1, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 9, 9, 12, 13, 14, 16, 17, 18, 19];
const _mq = Array.from({ length: 22 }, () => new THREE.Quaternion());

function basisQuat(xAxis, nAxis, out) {
  // xAxis, nAxis(直交)からの回転
  const z = _v3.crossVectors(xAxis, nAxis).normalize();
  _m1.makeBasis(xAxis, nAxis, z);
  return out.setFromRotationMatrix(_m1);
}

export class Rig {
  constructor(root, getBone) {
    this.root = root; // キャラ空間(ターン用グループ)
    this.b = {};
    for (const n of BONES) this.b[n] = getBone(n) || null;
    this.rest = {};
  }

  // 静止姿勢(Tポーズ・回転なし)のときに呼ぶ
  init() {
    const root = this.root;
    root.updateMatrixWorld(true);
    const rootQInv = root.getWorldQuaternion(new THREE.Quaternion()).invert();
    const cpos = (bone) => root.worldToLocal(bone.getWorldPosition(new THREE.Vector3()));
    const cquat = (bone) => rootQInv.clone().multiply(bone.getWorldQuaternion(new THREE.Quaternion()));
    for (const n of BONES) {
      const bone = this.b[n];
      if (!bone) continue;
      this.rest[n] = { pos: cpos(bone), q: cquat(bone), qInv: cquat(bone).invert(), local: bone.quaternion.clone(), localPos: bone.position.clone() };
    }
    const R = this.rest;
    const chain = (a, b, c, fwd) => {
      const pa = R[a].pos, pb = R[b].pos, pc = R[c].pos;
      const r1 = pb.clone().sub(pa), r2 = pc.clone().sub(pb);
      const len1 = r1.length(), len2 = r2.length();
      r1.normalize(); r2.normalize();
      const n1 = new THREE.Vector3().crossVectors(r1, fwd).normalize();
      const n2 = new THREE.Vector3().crossVectors(r2, fwd).normalize();
      // 休止時の基準姿勢(char空間)
      const M1 = basisQuat(r1, n1, new THREE.Quaternion());
      const M2 = basisQuat(r2, n2, new THREE.Quaternion());
      return { len1, len2, r1, r2, n1, n2, M1inv: M1.invert(), M2inv: M2.invert() };
    };
    this.armL = chain('leftUpperArm', 'leftLowerArm', 'leftHand', Z);
    this.armR = chain('rightUpperArm', 'rightLowerArm', 'rightHand', Z);
    this.legL = chain('leftUpperLeg', 'leftLowerLeg', 'leftFoot', Z.clone().negate());
    this.legR = chain('rightUpperLeg', 'rightLowerLeg', 'rightFoot', Z.clone().negate());
    this.armLen = (this.armL.len1 + this.armL.len2 + this.armR.len1 + this.armR.len2) / 2;
    this.legLen = (this.legL.len1 + this.legL.len2 + this.legR.len1 + this.legR.len2) / 2;
    this.hipsY = R.hips.pos.y;
    this.headY = R.head.pos.y;
    this.height = R.head.pos.y + (R.head.pos.y - (R.neck ? R.neck.pos.y : R.head.pos.y - 0.1)) * 1.6 + 0.08;
    this.chestName = this.b.upperChest ? 'upperChest' : this.b.chest ? 'chest' : 'spine';
    this.ready = true;
  }

  charQuat(bone, out) {
    this.root.getWorldQuaternion(_q3).invert();
    return out.copy(_q3).multiply(bone.getWorldQuaternion(_q2));
  }

  charPos(bone, out) {
    return this.root.worldToLocal(bone.getWorldPosition(out));
  }

  // 親の座標で「キャラ軸まわりの回転 q」を掛ける
  setRel(name, q) {
    const bone = this.b[name];
    if (!bone) return;
    const r = this.rest[name];
    // L = local0 * Rb^-1 q Rb
    bone.quaternion.copy(r.local).multiply(_q1.copy(r.qInv).multiply(q).multiply(r.q));
  }

  apply(p) {
    if (!this.ready) return;
    const R = this.rest, b = this.b;
    const L = this.legLen;
    this.root.rotation.y = p.ry;
    this.root.updateMatrixWorld(true);

    // 腰の位置
    if (b.hips) {
      _v1.set(R.hips.pos.x + p.hx * L, R.hips.pos.y + p.hy * L, R.hips.pos.z + p.hz * L);
      this.root.localToWorld(_v1);
      b.hips.parent.worldToLocal(_v1);
      b.hips.position.copy(_v1);
      _e.set(p.hp, p.hyaw, p.hr, 'YXZ');
      this.setRel('hips', _q2.setFromEuler(_e));
    }
    // 背骨
    _e.set(p.sp, p.sy, p.sr, 'YXZ'); this.setRel('spine', _q2.setFromEuler(_e));
    if (b.upperChest) {
      _e.set(p.cp * 0.5, p.cy * 0.5, p.cr * 0.5, 'YXZ'); this.setRel('chest', _q2.setFromEuler(_e));
      this.setRel('upperChest', _q2.setFromEuler(_e));
    } else {
      _e.set(p.cp, p.cy, p.cr, 'YXZ'); this.setRel('chest', _q2.setFromEuler(_e));
    }
    _e.set(p.np, p.ny, p.nr, 'YXZ'); this.setRel('neck', _q2.setFromEuler(_e));
    _e.set(p.headP, p.headY, p.headR, 'YXZ'); this.setRel('head', _q2.setFromEuler(_e));
    // 肩
    _e.set(0, -p.lsFw, p.lsUp, 'YXZ'); this.setRel('leftShoulder', _q2.setFromEuler(_e));
    _e.set(0, p.rsFw, -p.rsUp, 'YXZ'); this.setRel('rightShoulder', _q2.setFromEuler(_e));
    // 手首・つま先はここでリセット
    this.root.updateMatrixWorld(true);

    // 胸の回転(静止からの差分)
    const chestBone = b[this.chestName];
    const chestDelta = this.charQuat(chestBone, new THREE.Quaternion()).multiply(R[this.chestName].qInv);

    this.solveArm('left', this.armL, p.lx, p.ly, p.lz, p.lex, p.ley, p.lez, chestDelta);
    this.solveArm('right', this.armR, p.rx, p.ry_, p.rz, p.rex, p.rey, p.rez, chestDelta);
    // 手首
    this.wrist('leftHand', -p.lwp, p.lwy, p.lwr);
    this.wrist('rightHand', p.rwp, p.rwy, -p.rwr);

    this.solveLeg('left', this.legL, p.lfx, p.lfy, p.lfz, p.lfyaw, p.lfp, 1);
    this.solveLeg('right', this.legR, p.rfx, p.rfy, p.rfz, p.rfyaw, p.rfp, -1);
    this.relaxFingers(1);
  }

  wrist(name, flexZ, sideY, twistX) {
    _e.set(twistX, sideY, flexZ, 'XYZ');
    this.setRel(name, _q2.setFromEuler(_e));
  }

  solveTwoBone(S, T, a, b, pole, outE, outT) {
    const d = _v1.subVectors(T, S);
    let dist = d.length();
    const dir = d.normalize();
    dist = Math.min(Math.max(dist, Math.abs(a - b) + 1e-3), (a + b) * 0.9995);
    const cosA = (a * a + dist * dist - b * b) / (2 * a * dist);
    const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA));
    const perp = _v2.copy(pole).addScaledVector(dir, -pole.dot(dir));
    if (perp.lengthSq() < 1e-8) perp.set(0, -1, 0).addScaledVector(dir, -dir.y);
    perp.normalize();
    outE.copy(S).addScaledVector(dir, a * cosA).addScaledVector(perp, a * sinA);
    outT.copy(S).addScaledVector(dir, dist);
  }

  solveArm(side, ch, x, y, z, ex, ey, ez, chestDelta) {
    const up = this.b[side + 'UpperArm'], lo = this.b[side + 'LowerArm'];
    if (!up || !lo) return;
    const S = this.charPos(up, new THREE.Vector3());
    const T = new THREE.Vector3(x, y, z).applyQuaternion(chestDelta).multiplyScalar(this.armLen).add(S);
    const pole = new THREE.Vector3(ex, ey, ez).applyQuaternion(chestDelta);
    this.solveChain(up, lo, ch, S, T, pole);
  }

  solveChain(up, lo, ch, S, T, pole) {
    const E = new THREE.Vector3(), T2 = new THREE.Vector3();
    this.solveTwoBone(S, T, ch.len1, ch.len2, pole, E, T2);
    const xa = new THREE.Vector3().subVectors(E, S).normalize();
    const xb = new THREE.Vector3().subVectors(T2, E).normalize();
    const n = new THREE.Vector3().crossVectors(xa, xb);
    if (n.lengthSq() < 1e-7) n.crossVectors(xa, pole).negate();
    if (n.lengthSq() < 1e-7) n.set(0, 1, 0);
    n.normalize();
    // 直交化
    const nA = n.clone().addScaledVector(xa, -n.dot(xa)).normalize();
    const nB = n.clone().addScaledVector(xb, -n.dot(xb)).normalize();
    const Rup = this.rest[up === this.b.leftUpperArm ? 'leftUpperArm' : up === this.b.rightUpperArm ? 'rightUpperArm' : up === this.b.leftUpperLeg ? 'leftUpperLeg' : 'rightUpperLeg'];
    const Rlo = this.rest[lo === this.b.leftLowerArm ? 'leftLowerArm' : lo === this.b.rightLowerArm ? 'rightLowerArm' : lo === this.b.leftLowerLeg ? 'leftLowerLeg' : 'rightLowerLeg'];
    // 上腕: 目標の基底 * 休止基底^-1 * 休止向き
    const Bup = basisQuat(xa, nA, new THREE.Quaternion()).multiply(ch.M1inv).multiply(Rup.q);
    const Blo = basisQuat(xb, nB, new THREE.Quaternion()).multiply(ch.M2inv).multiply(Rlo.q);
    // ローカルへ
    const Pup = this.charQuat(up.parent, new THREE.Quaternion());
    // up.parent の world を使うので root 下である前提
    up.quaternion.copy(Pup.invert().multiply(Bup));
    lo.quaternion.copy(Bup.clone().invert().multiply(Blo));
    up.updateMatrixWorld(true);
    return { Bup, Blo };
  }

  solveLeg(side, ch, x, y, z, yaw, pitch, sign) {
    const up = this.b[side + 'UpperLeg'], lo = this.b[side + 'LowerLeg'], foot = this.b[side + 'Foot'];
    if (!up || !lo || !foot) return;
    const R = this.rest;
    const S = this.charPos(up, new THREE.Vector3());
    const rest = R[side + 'Foot'].pos;
    const L = this.legLen;
    const T = new THREE.Vector3(rest.x + x * L, rest.y + y * L, rest.z + z * L);
    // 膝は少し外側・前へ
    const pole = new THREE.Vector3(sign * 0.18, 0, 1).applyAxisAngle(Y, yaw).normalize();
    const { Blo } = this.solveChain(up, lo, ch, S, T, pole);
    // 足首: 床と平行(向きとつま先だけ指定)
    _e.set(pitch, yaw, 0, 'YXZ');
    const Bfoot = _q1.setFromEuler(_e).multiply(R[side + 'Foot'].q);
    // 親(下腿)のchar姿勢 = Blo なので L = Blo^-1 * Bfoot
    foot.quaternion.copy(Blo.clone().invert().multiply(Bfoot));
    const toes = this.b[side + 'Toes'];
    if (toes) {
      _e.set(-Math.max(0, pitch) * 0.8, 0, 0, 'YXZ');
      this.setRel(side + 'Toes', _q3.setFromEuler(_e));
    }
  }

  // 指を軽く曲げる(Tポーズのまっすぐな指はかたく見える)
  relaxFingers(amount = 1) {
    for (const n of FINGERS) {
      if (!this.b[n]) continue;
      const left = n.startsWith('left');
      const thumb = n.includes('Thumb');
      const k = n.endsWith('Proximal') ? 0.35 : n.endsWith('Intermediate') ? 0.45 : n.endsWith('Distal') ? 0.3 : 0.1;
      if (thumb) _e.set(0, (left ? -0.35 : 0.35) * amount * k * 2, 0, 'YXZ');
      else _e.set(0, 0, (left ? -1 : 1) * k * amount, 'YXZ');
      this.setRel(n, _q1.setFromEuler(_e));
    }
  }

  // モーションキャプチャーの1フレームを当てる。q: 22関節×(x,y,z,w) 親からの回転 / root: 腰の移動(m)
  applyMocap(q, root, { travel = 0.75, ground = true } = {}) {
    if (!this.ready) return;
    const R = this.rest, b = this.b;
    this.root.rotation.y = 0;
    for (let j = 0; j < 22; j++) _mq[j].set(q[j * 4], q[j * 4 + 1], q[j * 4 + 2], q[j * 4 + 3]);
    // 無いボーンの回転は、あるボーンへまとめる(例: upperChest が無ければ chest へ)
    const eff = _mq.map((x) => x.clone());
    for (let j = 1; j < 22; j++) {
      if (!b[MOCAP_BONES[j]]) {
        // 子に引き継ぐ: 子の回転 = 自分 * 子
        for (let c = j + 1; c < 22; c++) if (MOCAP_PARENT[c] === j) eff[c].premultiply(eff[j]);
      }
    }
    for (let j = 0; j < 22; j++) {
      const name = MOCAP_BONES[j];
      if (b[name]) this.setRel(name, eff[j]);
    }
    // 腰の位置: 体の大きさに合わせて縮尺
    const scale = this.hipsY / 0.95;
    let x = root[0] * scale * travel, z = root[2] * scale * travel;
    const rr = Math.hypot(x, z);
    if (rr > 0.9) { x *= 0.9 / rr; z *= 0.9 / rr; }
    const setHips = (dy) => {
      _v1.set(R.hips.pos.x + x, R.hips.pos.y + root[1] * scale + dy, R.hips.pos.z + z);
      this.root.localToWorld(_v1);
      b.hips.parent.worldToLocal(_v1);
      b.hips.position.copy(_v1);
    };
    setHips(0);
    this.relaxFingers(1);
    this.root.updateMatrixWorld(true);
    if (ground) {
      // 足が床にめりこむ・浮くのを直す(大きなジャンプはそのまま)
      let minY = Infinity;
      for (const n of ['leftFoot', 'rightFoot']) {
        if (!b[n]) continue;
        const y = this.charPos(b[n], _v2).y - R[n].pos.y;
        minY = Math.min(minY, y);
      }
      for (const n of ['leftToes', 'rightToes']) {
        if (!b[n]) continue;
        const y = this.charPos(b[n], _v2).y - R[n].pos.y;
        minY = Math.min(minY, y);
      }
      if (isFinite(minY)) {
        const dy = -minY;
        if (dy > 0 || dy > -0.05) { setHips(dy); this.root.updateMatrixWorld(true); }
      }
    }
  }

  // カメラ・演出用の位置
  getHeadWorld(out) { return this.b.head ? this.b.head.getWorldPosition(out) : out.set(0, 1.5, 0); }
  getChestWorld(out) { const c = this.b[this.chestName]; return c ? c.getWorldPosition(out) : out.set(0, 1.2, 0); }
  getHipsWorld(out) { return this.b.hips ? this.b.hips.getWorldPosition(out) : out.set(0, 1, 0); }
  getHandWorld(side, out) { const h = this.b[side + 'Hand']; return h ? h.getWorldPosition(out) : out.set(0, 1, 0); }
}
