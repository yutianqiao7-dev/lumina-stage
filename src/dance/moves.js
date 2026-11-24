// ダンスの「ムーブ」データベース(記事の「句の庫」に相当)
// 1つのムーブは 2〜8拍。タグ(盛り上がり・雰囲気)つきで、作曲解析の結果に合わせて並べられる。
import { clamp, lerp, smoother, easeInOut, easeOut, fract, TAU } from '../util/math.js';

const PI = Math.PI;
const dip = (b, sharp = 1.6) => Math.pow(0.5 + 0.5 * Math.cos(TAU * b), sharp); // 拍頭で1
const halfDip = (b) => dip(b * 2, 2); // 裏拍でも
const s = (x) => Math.sin(TAU * x);
const c = (x) => Math.cos(TAU * x);
const hit = (b, sharp = 6) => Math.exp(-sharp * fract(b)); // 拍頭で鋭く1→0
const hold = (t, h = 0.3) => smoother(clamp((t - h * 0.5) / (1 - h), 0, 1));
// 0..1 を拍ごとに snap しながら補間(ロボット・ヒット系)
const snapT = (b, len = 1, att = 0.18) => clamp(fract(b / len) / att, 0, 1);

// 手のプリセット(左手基準): [x, y, z, ひじx, ひじy, ひじz]
export const H = {
  down: [0.12, -0.96, 0.08, 0.4, -0.3, -1],
  relax: [0.16, -0.9, 0.22, 0.5, -0.4, -1],
  hip: [0.12, -0.5, -0.1, 1, -0.1, -0.5],
  chest: [-0.25, -0.28, 0.5, 0.5, -1, 0],
  clap: [-0.31, -0.12, 0.6, 0.7, -1, 0],
  clapLow: [-0.3, -0.45, 0.5, 0.6, -1, 0],
  clapUp: [-0.27, 0.82, 0.32, 1, 0.1, 0],
  up: [0.12, 0.98, 0.06, 1, 0, -0.1],
  V: [0.55, 0.8, 0.14, 1, -0.1, -0.2],
  out: [0.97, 0.08, 0.12, 0, -1, -0.4],
  outUp: [0.8, 0.52, 0.18, 0.2, -1, -0.3],
  outLow: [0.75, -0.6, 0.18, 0.4, -1, -0.5],
  front: [0.0, 0.12, 0.97, 0.4, -1, 0],
  frontUp: [0.12, 0.62, 0.74, 0.7, -0.6, 0],
  frontLow: [0.05, -0.55, 0.78, 0.4, -1, 0],
  mic: [-0.27, 0.3, 0.42, 0.4, -1, -0.2],
  cheek: [-0.08, 0.42, 0.38, 0.9, -0.7, 0],
  heart: [-0.31, 0.02, 0.56, 0.8, -0.6, 0],
  heartUp: [-0.26, 0.92, 0.26, 1, 0.2, 0],
  pump: [0.12, 0.35, 0.42, 0.9, -0.6, -0.2],
  pumpUp: [0.2, 0.96, 0.2, 1, -0.2, 0],
  swingBack: [0.18, -0.82, -0.5, 0.4, -0.2, -1],
  swingFront: [0.02, -0.55, 0.72, 0.3, -1, -0.3],
  cross: [-0.55, -0.35, 0.45, 0.8, -0.6, 0],
  punchDown: [0.0, -0.75, 0.5, 0.6, -0.5, -0.4],
  elbowOut: [0.62, 0.0, 0.32, 1, -0.4, -0.2],
  robotUp: [0.58, 0.55, 0.12, 1, -0.6, 0],
  head: [-0.2, 0.72, 0.18, 1, 0.3, -0.2],
  diagUp: [0.72, 0.7, 0.2, 0.3, -1, -0.2],
  diagDownCross: [-0.5, -0.75, 0.42, 0.5, -1, 0],
  wing: [0.42, -0.25, -0.2, 1, 0.2, -0.6],
};

export function hand(p, side, A) {
  if (side === 'l') { p.lx = A[0]; p.ly = A[1]; p.lz = A[2]; p.lex = A[3]; p.ley = A[4]; p.lez = A[5]; }
  else { p.rx = -A[0]; p.ry_ = A[1]; p.rz = A[2]; p.rex = -A[3]; p.rey = A[4]; p.rez = A[5]; }
}
export function handLerp(p, side, A, B, t) {
  const m = A.map((v, i) => lerp(v, B[i], t));
  hand(p, side, m);
}
function hands(p, A, B = A) { hand(p, 'l', A); hand(p, 'r', B); }
function handsLerp(p, A, B, t, A2 = A, B2 = B) { handLerp(p, 'l', A, B, t); handLerp(p, 'r', A2, B2, t); }
function handOffset(p, side, dx, dy, dz) {
  if (side === 'l') { p.lx += dx; p.ly += dy; p.lz += dz; } else { p.rx -= dx; p.ry_ += dy; p.rz += dz; }
}

// 基本のノリ(膝の屈伸・胸・頭)
function groove(p, b, amt = 1, e = 0.6) {
  const d = dip(b);
  p.hy += -0.022 * amt - 0.035 * amt * d * (0.6 + e * 0.6);
  p.sp += 0.03 * amt * d;
  p.cp += 0.03 * amt * dip(b - 0.08);
  p.headP += 0.07 * amt * dip(b - 0.15);
}

function weight(p, x) {
  // 左右の重心移動(x: -1..1、+ で左足に乗る)
  p.hx += 0.055 * x;
  p.hr += -0.06 * x;
  p.sr += 0.05 * x;
  p.headR += -0.04 * x;
}

// ステップ: 足を目標へ弧を描いて運ぶ
function stepFoot(p, side, from, to, t, lift = 0.08) {
  const k = easeInOut(t);
  const x = lerp(from[0], to[0], k), z = lerp(from[1], to[1], k);
  const y = Math.sin(PI * clamp(t, 0, 1)) * lift;
  if (side === 'l') { p.lfx = x; p.lfz = z; p.lfy = y; } else { p.rfx = -x; p.rfz = z; p.rfy = y; }
}
function footAt(p, side, x, z, y = 0) {
  if (side === 'l') { p.lfx = x; p.lfz = z; p.lfy = y; } else { p.rfx = -x; p.rfz = z; p.rfy = y; }
}
const seg = (b, a, len) => clamp((b - a) / len, 0, 1);

export const MOVES = [
  // ---------- おだやか(0〜1) ----------
  {
    id: 'idle', name: 'ゆらゆら', beats: 4, energy: [0, 1], tags: ['cute', 'cool', 'elegant', 'power'],
    fn(p, b, x) {
      groove(p, b, 0.6, x.e);
      const w = s(b / 4);
      weight(p, w * 0.8);
      handLerp(p, 'l', H.relax, H.down, 0.5 + 0.5 * w);
      handLerp(p, 'r', H.relax, H.down, 0.5 - 0.5 * w);
      p.headY = 0.08 * s(b / 8);
      p.relaxed = 0.3;
    },
  },
  {
    id: 'sway', name: 'スウェイ', beats: 4, energy: [0, 1], tags: ['elegant', 'cute'],
    fn(p, b, x) {
      const w = s((b - 1) / 4);
      weight(p, w * 1.2);
      p.hy -= 0.03 + 0.02 * dip(b);
      const o = 0.5 + 0.5 * w;
      handLerp(p, 'l', H.outLow, H.relax, o);
      handLerp(p, 'r', H.relax, H.outLow, o);
      p.lwp = 0.4 * o; p.rwp = 0.4 * (1 - o);
      p.headR = -0.1 * w; p.headY = 0.12 * w;
      footAt(p, 'l', 0.08, 0); footAt(p, 'r', 0.08, 0);
      p.lfp = 0.25 * Math.max(0, -w); p.rfp = 0.25 * Math.max(0, w);
      p.lfy = 0.03 * Math.max(0, -w); p.rfy = 0.03 * Math.max(0, w);
      p.relaxed = 0.4;
    },
  },
  {
    id: 'mic', name: 'マイクで歌う', beats: 8, energy: [0, 2], tags: ['cute', 'cool', 'elegant', 'power'], sing: true,
    fn(p, b, x) {
      groove(p, b, 0.5, x.e);
      const w = s(b / 8);
      weight(p, w * 0.7);
      hand(p, 'r', H.mic);
      p.rwp = 0.3; p.rwr = -0.4;
      // 左手は観客へ伸ばして戻す
      const reach = Math.sin(PI * seg(b, 1, 6));
      handLerp(p, 'l', H.relax, H.frontUp, easeInOut(reach));
      handOffset(p, 'l', 0.25 * reach, 0, 0);
      p.lwp = -0.3 * reach;
      p.headP = -0.08 * reach; p.headY = 0.12 * reach;
      p.cp -= 0.06 * reach;
      p.happy = 0.4;
    },
  },
  {
    id: 'reach', name: '手をのばす', beats: 4, energy: [0, 1], tags: ['elegant', 'cool'],
    fn(p, b, x) {
      const t = easeInOut(seg(b, 0, 3));
      const back = smoother(seg(b, 3, 1));
      const k = t * (1 - back * 0.6);
      hand(p, 'r', H.chest); p.rwp = 0.2;
      handLerp(p, 'l', H.relax, H.frontUp, k);
      handOffset(p, 'l', 0.35 * k, 0.1 * k, 0);
      p.lwp = -0.5 * k;
      weight(p, 0.8 * k);
      p.hy -= 0.04 * k; p.cp -= 0.08 * k; p.headP = -0.1 * k; p.headY = 0.25 * k;
      footAt(p, 'l', 0.15 * k, 0.12 * k);
      groove(p, b, 0.25, x.e);
      p.relaxed = 0.5;
    },
  },
  {
    id: 'wave_hand', name: '手をふる', beats: 4, energy: [0, 1], tags: ['cute'],
    fn(p, b, x) {
      groove(p, b, 0.7, x.e);
      hand(p, 'l', H.outUp); handOffset(p, 'l', -0.25, 0.25, 0.2);
      p.lwp = 0.6 * s(b / 1); p.lwr = 0.4;
      hand(p, 'r', H.hip);
      weight(p, 0.5 * s(b / 4));
      p.headR = 0.12; p.happy = 0.8;
    },
  },
  {
    id: 'arm_circle', name: 'アームサークル', beats: 8, energy: [0, 1], tags: ['elegant'],
    fn(p, b, x) {
      const t = b / 8;
      const ang = -PI / 2 + TAU * easeInOut(t);
      const v = (side) => {
        const yy = Math.sin(ang), xx = Math.cos(ang);
        return [0.25 + 0.6 * Math.abs(xx), yy * 0.9, 0.35 - 0.1 * yy, 1, -0.3, -0.2];
      };
      hand(p, 'l', v('l')); hand(p, 'r', v('r'));
      const top = Math.max(0, Math.sin(ang));
      p.lfp = p.rfp = 0.35 * top; p.lfy = p.rfy = 0.04 * top; p.hy = 0.02 * top - 0.03;
      p.cp = -0.12 * top; p.headP = -0.2 * top;
      footAt(p, 'l', 0.0, 0.05 * top, 0.04 * top); footAt(p, 'r', 0.0, -0.05 * top, 0.04 * top);
      p.relaxed = 0.6;
    },
  },
  {
    id: 'intro', name: '登場', beats: 8, energy: [0, 0], tags: ['cute', 'cool', 'elegant', 'power'], special: 'intro',
    fn(p, b) {
      const up = easeInOut(seg(b, 5, 2.5));
      p.headP = 0.4 * (1 - up); p.np = 0.2 * (1 - up);
      hands(p, H.down);
      handLerp(p, 'r', H.down, H.V, easeOut(seg(b, 6.5, 1.2)));
      p.hy = -0.03;
      p.happy = up * 0.7;
    },
  },
  // ---------- 中くらい(1〜2) ----------
  {
    id: 'step_touch', name: 'ステップタッチ', beats: 4, energy: [1, 2], tags: ['cute', 'cool', 'power', 'elegant'],
    fn(p, b, x) {
      groove(p, b, 1, x.e);
      const ph = b % 4;
      // 0: 右へ 1: 左をそろえる 2: 左へ 3: 右をそろえる
      let w;
      if (ph < 1) { stepFoot(p, 'r', [0, 0], [0.16, 0], seg(ph, 0, 0.6)); footAt(p, 'l', -0.04, 0); w = -smoother(ph); }
      else if (ph < 2) { footAt(p, 'r', 0.16, 0); stepFoot(p, 'l', [-0.04, 0], [-0.12, 0], seg(ph, 1, 0.6)); w = -1; }
      else if (ph < 3) { stepFoot(p, 'l', [-0.12, 0], [0.12, 0], seg(ph, 2, 0.6)); footAt(p, 'r', 0.16, 0); stepFoot(p, 'r', [0.16, 0], [0, 0], seg(ph, 2, 0.6)); w = -1 + 2 * smoother(ph - 2); }
      else { footAt(p, 'l', 0.12, 0); stepFoot(p, 'r', [0, 0], [0, 0], seg(ph, 3, 0.6), 0.04); w = 1 - smoother(ph - 3); }
      weight(p, w * 1.1);
      p.hyaw = 0.12 * w;
      const clapT = Math.max(hit(ph - 1 + 0.1 > 0 ? ph - 1 : 9, 5) * (ph >= 1 && ph < 2 ? 1 : 0), (ph >= 3 ? hit(ph - 3, 5) : 0));
      const k = 1 - Math.pow(Math.abs(s(b / 2 + 0.25)), 2);
      handsLerp(p, H.relax, H.clap, k * 0.9 + clapT * 0.1);
    },
  },
  {
    id: 'clap_side', name: '横で手拍子', beats: 4, energy: [1, 2], tags: ['cute', 'power'],
    fn(p, b, x) {
      groove(p, b, 1, x.e);
      const side = Math.floor(b / 2) % 2 === 0 ? 1 : -1;
      const ph = fract(b);
      const k = 1 - easeOut(clamp(ph / 0.5, 0, 1)) * 0.0;
      const shift = easeInOut(clamp(fract(b / 2) * 4, 0, 1));
      const sx = side * (0.35 * shift + 0.0);
      const open = 1 - hit(b, 7);
      hand(p, 'l', H.clap); hand(p, 'r', H.clap);
      p.lx += sx + 0.2 * open; p.rx += sx - 0.2 * open; p.ly += 0.2; p.ry_ += 0.2;
      weight(p, side * 0.9);
      p.headY = 0.25 * side; p.cy = 0.15 * side;
      footAt(p, side > 0 ? 'l' : 'r', 0.1, 0); footAt(p, side > 0 ? 'r' : 'l', 0.0, 0, 0.03 * (1 - open));
      p.happy = 0.6; void k;
    },
  },
  {
    id: 'body_roll', name: 'ボディロール', beats: 4, energy: [1, 2], tags: ['cool', 'elegant'],
    fn(p, b, x) {
      const w = (o) => s(b / 2 - o);
      p.hz = 0.035 * w(0.0); p.hp = -0.08 * w(0.0);
      p.sp = 0.12 * w(0.1); p.cp = 0.14 * w(0.2); p.np = 0.1 * w(0.3); p.headP = -0.08 * w(0.35);
      p.hy = -0.05 - 0.03 * (0.5 + 0.5 * w(0));
      hand(p, 'l', H.hip); hand(p, 'r', H.relax);
      handOffset(p, 'r', 0.0, 0.25 * (0.5 + 0.5 * w(0.25)), 0.1);
      footAt(p, 'l', 0.12, 0); footAt(p, 'r', 0.12, 0);
      p.headY = 0.1 * s(b / 8);
      groove(p, b, 0.3, x.e);
    },
  },
  {
    id: 'shoulder', name: 'ショルダーバウンス', beats: 4, energy: [1, 2], tags: ['cool', 'power'],
    fn(p, b, x) {
      groove(p, b, 1.1, x.e);
      const alt = Math.floor(b) % 2 === 0 ? 1 : -1;
      const h = hit(b, 5);
      p.lsUp = 0.25 * h * (alt > 0 ? 1 : 0.2); p.rsUp = 0.25 * h * (alt < 0 ? 1 : 0.2);
      hand(p, 'l', H.elbowOut); hand(p, 'r', H.elbowOut);
      p.ly -= 0.3; p.ry_ -= 0.3; p.lz -= 0.05; p.rz -= 0.05;
      p.cr = 0.08 * alt * h; p.headR = -0.06 * alt * h;
      footAt(p, 'l', 0.14, 0); footAt(p, 'r', 0.14, 0);
      p.hy -= 0.03;
    },
  },
  {
    id: 'heart', name: 'ハート', beats: 4, energy: [1, 2], tags: ['cute'],
    fn(p, b, x) {
      groove(p, b, 0.9, x.e);
      const inT = easeOut(seg(b, 0, 0.6));
      const up = easeInOut(seg(b, 2, 1));
      const A = H.heart.map((v, i) => lerp(v, H.heartUp[i], up));
      handsLerp(p, H.relax, A, inT);
      p.lwp = p.rwp = 0.6 * inT; p.lwr = p.rwr = 0.5 * inT;
      const tilt = s(b / 4);
      p.headR = 0.15 * tilt; weight(p, tilt * 0.6);
      p.happy = 0.9; p.wink = b > 1 && b < 2 ? Math.sin(PI * (b - 1)) : 0;
    },
  },
  {
    id: 'cheek', name: 'ほっぺ', beats: 4, energy: [1, 2], tags: ['cute'],
    fn(p, b, x) {
      groove(p, b, 0.9, x.e);
      const w = s(b / 4);
      hands(p, H.cheek);
      p.lwp = p.rwp = 0.4;
      weight(p, w * 1.2);
      p.headR = -0.18 * w; p.hyaw = 0.15 * w;
      footAt(p, 'l', 0.06, 0.04 * w); footAt(p, 'r', 0.06, -0.04 * w);
      p.lfp = 0.2 * Math.max(0, -w); p.rfp = 0.2 * Math.max(0, w);
      p.happy = 1;
    },
  },
  {
    id: 'twist', name: 'ツイスト', beats: 4, energy: [1, 2], tags: ['cute', 'power'],
    fn(p, b, x) {
      const w = s(b / 2);
      p.hyaw = 0.4 * w; p.cy = -0.5 * w; p.headY = 0.25 * w;
      p.lfyaw = p.rfyaw = 0.45 * w;
      p.hy = -0.07 - 0.03 * dip(b * 2);
      hand(p, 'l', H.elbowOut); hand(p, 'r', H.elbowOut);
      p.ly -= 0.25; p.ry_ -= 0.25; p.lz += 0.1 * w; p.rz -= 0.1 * w;
      footAt(p, 'l', 0.1, 0); footAt(p, 'r', 0.1, 0);
      p.happy = 0.7;
    },
  },
  {
    id: 'cross_open', name: 'クロス＆オープン', beats: 4, energy: [1, 2], tags: ['cool', 'elegant', 'power'],
    fn(p, b, x) {
      groove(p, b, 0.8, x.e);
      const close = easeOut(seg(b, 0, 0.4)) * (1 - easeOut(seg(b, 2, 0.4)));
      const open = easeOut(seg(b, 2, 0.4));
      if (b < 2) handsLerp(p, H.relax, H.cross, close);
      else handsLerp(p, H.cross, H.outUp, open);
      p.lz += 0.05; p.rz -= 0.05;
      p.cp = 0.1 * close - 0.1 * open; p.headP = 0.15 * close - 0.12 * open;
      p.hy -= 0.05 * close;
      footAt(p, 'l', 0.05 + 0.1 * open, 0); footAt(p, 'r', 0.05 + 0.1 * open, 0);
    },
  },
  {
    id: 'robot', name: 'ロボット', beats: 4, energy: [1, 2], tags: ['cool'],
    fn(p, b, x) {
      const poses = [
        [H.robotUp, H.elbowOut, 0.3],
        [H.elbowOut, H.robotUp, -0.3],
        [H.front, H.hip, 0.2],
        [H.hip, H.front, -0.2],
      ];
      const i = Math.floor(b) % 4, prev = (i + 3) % 4;
      const t = easeOut(snapT(b, 1, 0.15));
      handLerp(p, 'l', poses[prev][0], poses[i][0], t);
      handLerp(p, 'r', poses[prev][1], poses[i][1], t);
      p.headY = lerp(poses[prev][2], poses[i][2], t);
      p.cy = p.headY * 0.4;
      p.hy = -0.05 - 0.02 * hit(b, 8);
      footAt(p, 'l', 0.12, 0); footAt(p, 'r', 0.12, 0);
    },
  },
  {
    id: 'lean_point', name: 'もたれて指さし', beats: 4, energy: [1, 2], tags: ['cool', 'cute', 'power'],
    fn(p, b, x) {
      groove(p, b, 0.9, x.e);
      const side = Math.floor(b / 2) % 2 === 0 ? 1 : -1;
      const t = easeOut(clamp(fract(b / 2) * 3, 0, 1));
      const sl = side > 0 ? 'l' : 'r', so = side > 0 ? 'r' : 'l';
      handLerp(p, sl, H.relax, H.diagUp, t); hand(p, so, H.hip);
      weight(p, side * 1.3 * t);
      p.headY = 0.3 * side * t; p.headR = 0.1 * side;
      footAt(p, sl, 0.18 * t, 0.05); footAt(p, so, 0, 0);
      p.happy = 0.5;
    },
  },
  {
    id: 'hip_push', name: 'ヒップ', beats: 4, energy: [1, 3], tags: ['cool', 'cute'],
    fn(p, b, x) {
      const i = Math.floor(b);
      const side = i % 2 === 0 ? 1 : -1;
      const h = easeOut(clamp(fract(b) * 4, 0, 1)) * (1 - 0.3 * fract(b));
      const prevSide = -side;
      const xx = lerp(prevSide, side, h);
      weight(p, xx * 1.4);
      p.hy -= 0.06;
      hand(p, 'l', H.hip); hand(p, 'r', H.hip);
      if (i % 4 >= 2) { hand(p, 'r', H.pump); p.rwp = 0.5; }
      p.headR = -0.12 * xx; p.headY = 0.1 * xx;
      footAt(p, 'l', 0.15, 0); footAt(p, 'r', 0.15, 0);
      p.lfp = 0.2 * Math.max(0, -xx); p.rfp = 0.2 * Math.max(0, xx);
    },
  },
  // ---------- 盛り上がり(2〜3) ----------
  {
    id: 'fist_pump', name: 'こぶしを突き上げる', beats: 4, energy: [2, 3], tags: ['power', 'cool'],
    fn(p, b, x) {
      groove(p, b, 1.3, x.e);
      const h = 1 - easeOut(clamp(fract(b) * 2.5, 0, 1));
      const k = hit(b, 4);
      handLerp(p, 'r', H.pump, H.pumpUp, k);
      hand(p, 'l', H.hip);
      p.rwp = -0.2;
      p.cp = -0.1 * k; p.headP = -0.15 * k;
      weight(p, 0.4);
      footAt(p, 'l', 0.15, 0.06); footAt(p, 'r', 0.12, -0.05);
      p.happy = 0.6; void h;
    },
  },
  {
    id: 'cheer_v', name: 'Vサイン応援', beats: 4, energy: [2, 3], tags: ['cute', 'power'],
    fn(p, b, x) {
      groove(p, b, 1.2, x.e);
      const k = hit(b, 3);
      handsLerp(p, H.pump, H.V, 0.3 + 0.7 * k);
      p.lwp = p.rwp = -0.2;
      const hop = Math.max(0, Math.sin(PI * fract(b))) * (Math.floor(b) % 2);
      const alt = Math.floor(b) % 2 ? 'l' : 'r';
      footAt(p, alt, 0.08, 0.05, 0.08 * hop);
      footAt(p, alt === 'l' ? 'r' : 'l', 0.08, 0);
      weight(p, (alt === 'l' ? -0.5 : 0.5) * hop);
      p.happy = 1;
    },
  },
  {
    id: 'jump', name: 'ジャンプ', beats: 4, energy: [3, 3], tags: ['power', 'cute', 'cool'], accent: true,
    fn(p, b, x) {
      // 0〜0.8 しゃがむ / 0.8〜2.2 跳ぶ / 2.2〜 着地
      const crouch = easeInOut(seg(b, 0, 0.8));
      const air = seg(b, 0.8, 1.3);
      const land = seg(b, 2.1, 0.5);
      const rec = easeInOut(seg(b, 2.6, 1.4));
      let hy = -0.03;
      if (b < 0.8) hy = -0.03 - 0.14 * crouch;
      else if (b < 2.1) hy = -0.05 + 0.2 * Math.sin(PI * air);
      else hy = -0.03 - 0.14 * Math.sin(PI * land * 0.5) * (1 - rec);
      p.hy = hy;
      const lift = b >= 0.8 && b < 2.1 ? Math.max(0, 0.2 * Math.sin(PI * air) - 0.01) + 0.08 * Math.sin(PI * air) : 0;
      p.lfy = p.rfy = lift;
      p.lfp = p.rfp = b >= 0.8 && b < 2.1 ? 0.5 * Math.sin(PI * air) : 0.15 * crouch * (b < 0.8 ? 1 : 0);
      footAt(p, 'l', 0.08, 0, lift); footAt(p, 'r', 0.08, 0, lift);
      const armsUp = b < 0.8 ? 0 : b < 2.3 ? easeOut(seg(b, 0.8, 0.4)) : 1 - rec;
      handsLerp(p, H.swingBack, H.V, armsUp);
      if (b < 0.8) handsLerp(p, H.relax, H.swingBack, crouch);
      p.cp = 0.2 * crouch * (b < 0.8 ? 1 : 0) - 0.15 * armsUp; p.headP = -0.2 * armsUp;
      p.happy = 1; p.surprised = 0.3 * armsUp;
    },
  },
  {
    id: 'spin', name: 'ターン', beats: 4, energy: [2, 3], tags: ['cute', 'cool', 'elegant'], accent: true,
    fn(p, b, x) {
      const t = easeInOut(seg(b, 0.6, 2.2));
      p.ry = TAU * t;
      const inSpin = Math.sin(PI * t);
      handsLerp(p, H.outLow, H.chest, inSpin);
      if (b < 0.6) handsLerp(p, H.relax, H.outLow, easeOut(b / 0.6));
      if (b > 2.8) handsLerp(p, H.chest, H.outUp, easeOut(seg(b, 2.8, 0.5)));
      p.lfy = 0.1 * inSpin; p.lfp = 0.4 * inSpin; p.rfp = 0.3 * inSpin;
      footAt(p, 'l', 0.0, 0.08 * inSpin, 0.12 * inSpin); footAt(p, 'r', 0.02, 0);
      p.hy = -0.04 + 0.03 * inSpin;
      p.headP = -0.1 * inSpin;
      groove(p, b, b > 3 ? 0.6 : 0, x.e);
      p.happy = 0.7;
    },
  },
  {
    id: 'wave_arms', name: '両手を振る', beats: 4, energy: [1, 3], tags: ['cute', 'power', 'cool', 'elegant'],
    fn(p, b, x) {
      groove(p, b, 1, x.e);
      const w = s(b / 4);
      hand(p, 'l', H.up); hand(p, 'r', H.up);
      p.lx += 0.45 * w; p.rx += 0.45 * w; p.ly -= 0.12 * Math.abs(w); p.ry_ -= 0.12 * Math.abs(w);
      p.lwp = p.rwp = 0.3 * w;
      weight(p, w);
      p.cr = -0.08 * w; p.headR = 0.06 * w;
      footAt(p, 'l', 0.12, 0); footAt(p, 'r', 0.12, 0);
      p.happy = 0.8;
    },
  },
  {
    id: 'point_sky', name: 'ディスコ指さし', beats: 4, energy: [2, 3], tags: ['cool', 'power'],
    fn(p, b, x) {
      groove(p, b, 1, x.e);
      const i = Math.floor(b) % 2;
      const t = easeOut(clamp(fract(b) * 3.5, 0, 1));
      const A = i === 0 ? H.diagDownCross : H.diagUp, B = i === 0 ? H.diagUp : H.diagDownCross;
      handLerp(p, 'r', A, B, t);
      hand(p, 'l', H.hip);
      const up = i === 0 ? t : 1 - t;
      p.headY = -0.3 * up + 0.1; p.headP = -0.2 * up + 0.1 * (1 - up);
      p.cy = -0.15 * up; p.cr = 0.1 * up;
      weight(p, -0.6 * up + 0.3);
      footAt(p, 'r', 0.18, 0.04); footAt(p, 'l', 0.05, 0);
      p.rfp = 0.15 * (1 - up);
    },
  },
  {
    id: 'kick', name: 'キックステップ', beats: 4, energy: [2, 3], tags: ['power', 'cute'],
    fn(p, b, x) {
      groove(p, b, 1, x.e);
      const i = Math.floor(b) % 2;
      const ph = fract(b);
      const kick = Math.sin(PI * clamp(ph / 0.7, 0, 1));
      const side = i === 0 ? 'r' : 'l', other = i === 0 ? 'l' : 'r';
      footAt(p, side, 0.06, 0.32 * kick, 0.14 * kick);
      if (side === 'l') p.lfp = -0.4 * kick; else p.rfp = -0.4 * kick;
      footAt(p, other, 0.06, 0);
      p.hy += 0.02 * kick;
      p.hz = -0.03 * kick;
      handLerp(p, side === 'l' ? 'r' : 'l', H.relax, H.swingFront, kick);
      handLerp(p, side, H.relax, H.swingBack, kick);
      weight(p, (side === 'l' ? -0.7 : 0.7));
      p.happy = 0.7;
    },
  },
  {
    id: 'parapara', name: 'パラパラ', beats: 4, energy: [2, 3], tags: ['cute', 'cool'],
    fn(p, b, x) {
      groove(p, b, 0.8, x.e);
      const ph = Math.floor(b * 2) % 8;
      const t = easeOut(clamp(fract(b * 2) * 3, 0, 1));
      const seq = [
        [H.outUp, H.chest], [H.chest, H.outUp], [H.frontUp, H.hip], [H.hip, H.frontUp],
        [H.up, H.up], [H.out, H.out], [H.cross, H.cross], [H.chest, H.chest],
      ];
      const cur = seq[ph], prev = seq[(ph + 7) % 8];
      handLerp(p, 'l', prev[0], cur[0], t); handLerp(p, 'r', prev[1], cur[1], t);
      p.lwp = 0.4; p.rwp = 0.4;
      // 足はステップタッチ
      const st = Math.floor(b) % 2 === 0 ? 1 : -1;
      weight(p, st * 0.8);
      footAt(p, 'l', 0.12, 0, st < 0 ? 0.03 * Math.sin(PI * fract(b)) : 0);
      footAt(p, 'r', 0.12, 0, st > 0 ? 0.03 * Math.sin(PI * fract(b)) : 0);
      p.happy = 0.7;
    },
  },
  {
    id: 'wota', name: 'オタ芸スイング', beats: 4, energy: [3, 3], tags: ['power', 'cute'],
    fn(p, b, x) {
      // 正面で両腕を大きく回す
      const ang = TAU * (b / 2) - PI / 2;
      const r = 0.85;
      const lx = Math.cos(ang) * r, ly = Math.sin(ang) * r;
      hand(p, 'l', [0.05 + lx * 0.6, ly, 0.45, 1, -0.3, -0.1]);
      hand(p, 'r', [0.05 - lx * 0.6, ly, 0.45, 1, -0.3, -0.1]);
      p.lx -= 0.25; p.rx += 0.25;
      p.cy = 0.25 * Math.cos(ang); p.cr = 0.1 * Math.cos(ang);
      p.hy = -0.1 - 0.04 * dip(b);
      weight(p, Math.cos(ang) * 0.7);
      footAt(p, 'l', 0.2, 0.05); footAt(p, 'r', 0.2, -0.05);
      p.happy = 1; p.surprised = 0.2;
    },
  },
  {
    id: 'shuffle', name: 'シャッフル', beats: 4, energy: [3, 3], tags: ['power', 'cool'],
    fn(p, b, x) {
      // ランニングマン
      const i = Math.floor(b) % 2;
      const ph = fract(b);
      const front = i === 0 ? 'l' : 'r', back = i === 0 ? 'r' : 'l';
      const slide = easeInOut(ph);
      footAt(p, front, 0.06, lerp(0.12, -0.12, slide), 0);
      const lift = Math.sin(PI * ph);
      footAt(p, back, 0.06, lerp(-0.12, 0.12, slide), 0.12 * lift);
      p.hy = -0.06 - 0.04 * dip(b * 2);
      p.cp = 0.12; p.headP = 0.05;
      const sw = Math.sin(PI * (b % 2 - 0.5));
      handLerp(p, 'l', H.pump, H.punchDown, 0.5 + 0.5 * sw);
      handLerp(p, 'r', H.pump, H.punchDown, 0.5 - 0.5 * sw);
      weight(p, i === 0 ? 0.3 : -0.3);
    },
  },
  {
    id: 'clap_up', name: '頭上で手拍子', beats: 4, energy: [2, 3], tags: ['power', 'cute', 'elegant', 'cool'],
    fn(p, b, x) {
      groove(p, b, 1.2, x.e);
      const open = 1 - hit(b, 5);
      handsLerp(p, H.clapUp, H.V, open * 0.45);
      weight(p, 0.5 * s(b / 4));
      p.headP = -0.12; p.happy = 0.9;
      footAt(p, 'l', 0.12, 0); footAt(p, 'r', 0.12, 0);
    },
  },
  {
    id: 'stomp', name: 'ストンプ', beats: 4, energy: [3, 3], tags: ['power', 'cool'],
    fn(p, b, x) {
      const i = Math.floor(b) % 2;
      const ph = fract(b);
      const up = Math.sin(PI * clamp((ph - 0.5) / 0.5, 0, 1));
      const side = i === 0 ? 'l' : 'r';
      footAt(p, 'l', 0.22, 0, side === 'r' ? 0.12 * up : 0);
      footAt(p, 'r', 0.22, 0, side === 'l' ? 0.12 * up : 0);
      p.hy = -0.13 - 0.05 * dip(b);
      const k = hit(b, 6);
      handsLerp(p, H.pump, H.punchDown, k);
      p.cp = 0.2 * k + 0.05; p.headP = 0.15 * k;
      weight(p, i === 0 ? 0.6 : -0.6);
    },
  },
  {
    id: 'groove_hit', name: 'グルーヴヒット', beats: 4, energy: [2, 3], tags: ['cool', 'power'],
    fn(p, b, x) {
      groove(p, b, 1.4, x.e);
      const back = Math.floor(b) % 2 === 1;
      const k = back ? hit(b, 6) : 0;
      handsLerp(p, H.elbowOut, H.front, k * 0.8);
      p.ly -= 0.2; p.ry_ -= 0.2;
      p.cp = -0.15 * k + 0.06; p.hz = 0.02 * k;
      p.headY = 0.2 * s(b / 8);
      footAt(p, 'l', 0.2, 0); footAt(p, 'r', 0.2, 0);
      p.hy -= 0.06;
    },
  },
  {
    id: 'hop', name: 'ホップ', beats: 4, energy: [2, 3], tags: ['cute', 'power'],
    fn(p, b, x) {
      const ph = fract(b);
      const i = Math.floor(b) % 2;
      const air = Math.sin(PI * ph);
      p.hy = -0.05 + 0.05 * air - 0.05 * dip(b);
      footAt(p, i ? 'l' : 'r', 0.08, 0.05, 0.12 * air);
      footAt(p, i ? 'r' : 'l', 0.08, 0, 0.03 * air);
      if (i) p.lfp = 0.3 * air; else p.rfp = 0.3 * air;
      handLerp(p, i ? 'r' : 'l', H.relax, H.pumpUp, air);
      hand(p, i ? 'l' : 'r', H.hip);
      weight(p, i ? -0.6 : 0.6);
      p.happy = 1;
    },
  },
  // ---------- 決めポーズ(区切り用) ----------
  {
    id: 'pose_a', name: '決めポーズA', beats: 2, energy: [1, 3], tags: ['cool', 'power', 'cute', 'elegant'], pose: true,
    fn(p, b) {
      const t = easeOut(seg(b, 0, 0.35));
      handLerp(p, 'l', H.relax, H.diagUp, t);
      handLerp(p, 'r', H.relax, H.hip, t);
      weight(p, 1.0 * t);
      footAt(p, 'l', 0.2 * t, 0.05); p.rfp = 0.3 * t;
      p.headY = 0.3 * t; p.headP = -0.1 * t;
      p.hy = -0.04;
      p.happy = 0.8;
    },
  },
  {
    id: 'pose_b', name: '決めポーズB', beats: 2, energy: [1, 3], tags: ['cool', 'power'], pose: true,
    fn(p, b) {
      const t = easeOut(seg(b, 0, 0.3));
      handLerp(p, 'r', H.relax, H.front, t); p.rwp = -0.3 * t;
      handLerp(p, 'l', H.relax, H.wing, t);
      p.hy = -0.03 - 0.12 * t; p.cp = 0.1 * t; p.headP = -0.05 * t;
      footAt(p, 'r', 0.22 * t, 0.15 * t); footAt(p, 'l', 0.12 * t, -0.1 * t);
      p.hyaw = 0.25 * t; p.cy = 0.1 * t;
    },
  },
  {
    id: 'pose_c', name: '決めポーズC', beats: 2, energy: [1, 3], tags: ['cute', 'elegant'], pose: true,
    fn(p, b) {
      const t = easeOut(seg(b, 0, 0.35));
      handLerp(p, 'l', H.relax, H.cheek, t); p.lwp = 0.5 * t;
      handLerp(p, 'r', H.relax, H.outUp, t);
      p.headR = 0.2 * t; weight(p, -0.8 * t);
      footAt(p, 'l', 0.02, 0.06 * t); p.lfp = 0.35 * t; p.lfy = 0.03 * t;
      p.happy = 1; p.wink = t;
    },
  },
  {
    id: 'bow', name: 'おじぎ', beats: 8, energy: [0, 3], tags: ['cute', 'cool', 'elegant', 'power'], special: 'end',
    fn(p, b) {
      const wave = easeInOut(seg(b, 0, 1.5)) * (1 - easeInOut(seg(b, 2.5, 1)));
      hand(p, 'l', H.down); handLerp(p, 'r', H.down, H.outUp, wave);
      p.rwp = 0.6 * Math.sin(TAU * b) * wave;
      const bow = easeInOut(seg(b, 4, 1.2)) * (1 - easeInOut(seg(b, 6.4, 1.2)));
      handLerp(p, 'r', [p.rx * -1, p.ry_, p.rz, -p.rex, p.rey, p.rez], H.chest, bow);
      p.sp = 0.35 * bow; p.cp = 0.25 * bow; p.headP = 0.25 * bow;
      p.hz = -0.06 * bow; p.hy = -0.02;
      p.happy = 1;
    },
  },
];

export const MOVE_BY_ID = Object.fromEntries(MOVES.map((m) => [m.id, m]));
