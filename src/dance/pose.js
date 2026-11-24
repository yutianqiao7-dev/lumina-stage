// ポーズは数値の集まり。ムーブ同士を自然にブレンドできるよう、全部同じキーを持つ。
// 座標の約束: キャラは +Z を向く。+X がキャラの左手側、+Y が上。
// 手の位置 = 肩からの相対位置(腕の長さ=1 の単位、胸の向きに追従)
// 足の位置 = 立ち位置からの相対(脚の長さ=1 の単位、床基準)

export const POSE_KEYS = [
  // 腰
  'hx', 'hy', 'hz', 'hp', 'hyaw', 'hr',
  // 体全体の向き(足ごと回る。ターン用)
  'ry',
  // 背骨・胸・首・頭 (pitch=前屈, yaw=ひねり, roll=横倒し)
  'sp', 'sy', 'sr', 'cp', 'cy', 'cr', 'np', 'ny', 'nr', 'headP', 'headY', 'headR',
  // 肩
  'lsUp', 'lsFw', 'rsUp', 'rsFw',
  // 左手 目標位置・ひじの向き・手首
  'lx', 'ly', 'lz', 'lex', 'ley', 'lez', 'lwp', 'lwy', 'lwr',
  // 右手
  'rx', 'ry_', 'rz', 'rex', 'rey', 'rez', 'rwp', 'rwy', 'rwr',
  // 左足 位置・向き・つま先
  'lfx', 'lfy', 'lfz', 'lfyaw', 'lfp',
  // 右足
  'rfx', 'rfy', 'rfz', 'rfyaw', 'rfp',
  // 表情
  'happy', 'surprised', 'mouth', 'wink', 'relaxed',
];

export const ANGLE_KEYS = new Set(['ry', 'hyaw']);

export function neutralPose() {
  const p = {};
  for (const k of POSE_KEYS) p[k] = 0;
  // 腕は体の横に自然に下ろす
  p.lx = 0.12; p.ly = -0.96; p.lz = 0.08; p.lex = 0.4; p.ley = -0.3; p.lez = -1;
  p.rx = -0.12; p.ry_ = -0.96; p.rz = 0.08; p.rex = -0.4; p.rey = -0.3; p.rez = -1;
  p.lwp = 0; p.rwp = 0;
  p.hy = -0.02; // ほんの少し膝を曲げる
  p.relaxed = 0.15;
  return p;
}

export function copyPose(dst, src) { for (const k of POSE_KEYS) dst[k] = src[k]; return dst; }

export function blendPose(out, a, b, t) {
  for (const k of POSE_KEYS) {
    if (ANGLE_KEYS.has(k)) {
      let d = (b[k] - a[k]) % (Math.PI * 2);
      if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2;
      out[k] = a[k] + d * t;
    } else out[k] = a[k] + (b[k] - a[k]) * t;
  }
  return out;
}

// 左右反転(ムーブの鏡写し)
export function mirrorPose(p) {
  const m = { ...p };
  const swap = (a, b) => { const t = m[a]; m[a] = m[b]; m[b] = t; };
  // 中心系: yaw と roll と x を反転
  m.hx = -p.hx; m.hyaw = -p.hyaw; m.hr = -p.hr; m.ry = -p.ry;
  m.sy = -p.sy; m.sr = -p.sr; m.cy = -p.cy; m.cr = -p.cr;
  m.ny = -p.ny; m.nr = -p.nr; m.headY = -p.headY; m.headR = -p.headR;
  // 腕
  m.lx = -p.rx; m.ly = p.ry_; m.lz = p.rz; m.lex = -p.rex; m.ley = p.rey; m.lez = p.rez;
  m.rx = -p.lx; m.ry_ = p.ly; m.rz = p.lz; m.rex = -p.lex; m.rey = p.ley; m.rez = p.lez;
  m.lwp = p.rwp; m.lwy = -p.rwy; m.lwr = -p.rwr; m.rwp = p.lwp; m.rwy = -p.lwy; m.rwr = -p.lwr;
  swap('lsUp', 'rsUp'); swap('lsFw', 'rsFw');
  // 脚
  m.lfx = -p.rfx; m.lfy = p.rfy; m.lfz = p.rfz; m.lfyaw = -p.rfyaw; m.lfp = p.rfp;
  m.rfx = -p.lfx; m.rfy = p.lfy; m.rfz = p.lfz; m.rfyaw = -p.lfyaw; m.rfp = p.lfp;
  return m;
}
