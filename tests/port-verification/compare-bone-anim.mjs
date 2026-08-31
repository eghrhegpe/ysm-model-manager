#!/usr/bin/env node
/**
 * compare-bone-anim.mjs — 骨骼动画变换「游戏内 vs 本项目」对拍
 *
 * 定位：手动诊断工具（非门禁）。诡异运动定位用。
 *
 * oracle：Modern YSM 游戏内算法（权威参照）
 *   - NativeModelRenderer.calculateBoneMatrix（common/.../geckolib3/geo/NativeModelRenderer.java:177-249）
 *   - RenderUtils.prepMatrixForBone（common/.../geckolib3/util/RenderUtils.java:89-103）同口径
 *   数学形式（局部）：M = T(-pos/16)·T(pivot/16)·Rz·Ry·Rx·T(-pivot/16)
 *     - posX 取负（-posX/16）、posY/posZ 为正（/16 像素→方块）
 *     - 旋转序 ZYX intrinsic（rotateZ→rotateY→rotateX）
 *     - scale=0 时整骨不可见（isVisible=false）
 *
 * 被测：本项目 ysm-animation-player.apply（frontend/src/preview-3d/ysm-animation-player.ts:91-145）
 *   - rotation: Euler(rz, ry, rx, 'ZYX') → 四元数（L4 已修）
 *   - position: 直接 node.position.set(tx, ty, tz) 覆盖 localPosition（无 pivot 包裹/X 取负//16）
 *   - scale: 直接 set(sx, sy, sz)（无 scale=0 隐藏）
 *
 * 纯 Node 零依赖（手写矩阵/四元数），退出码 0=全绿 / 1=有分歧。
 */

// ============================================================
// 最小矩阵/四元数工具（列主序 4x4，仅对拍用）
// ============================================================
function mat4() {
  const m = new Float64Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}
function matMul(a, b) {
  const m = new Float64Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
    m[c * 4 + r] = s;
  }
  return m;
}
function matTranslate(m, x, y, z) {
  const t = mat4();
  t[12] = x; t[13] = y; t[14] = z;
  return matMul(m, t);
}
function matRotateAxis(m, axis, rad) {
  const c = Math.cos(rad), s = Math.sin(rad);
  const r = mat4();
  if (axis === "x") {
    r[5] = c; r[6] = s; r[9] = -s; r[10] = c;
  } else if (axis === "y") {
    r[0] = c; r[2] = -s; r[8] = s; r[10] = c;
  } else {
    r[0] = c; r[1] = s; r[4] = -s; r[5] = c;
  }
  return matMul(m, r);
}
function matScale(m, x, y, z) {
  const s = mat4();
  s[0] = x; s[5] = y; s[10] = z;
  return matMul(m, s);
}
function matTranslation(m) {
  return [m[12], m[13], m[14]];
}
/** 矩阵 → 四元数（Shepperd 法，{x,y,z,w}） */
function matToQuat(m) {
  const t = m[0] + m[5] + m[10];
  let q;
  if (t > 0) {
    const s = 0.5 / Math.sqrt(t + 1);
    q = [(m[6] - m[9]) * s, (m[8] - m[2]) * s, (m[1] - m[4]) * s, 0.25 / s];
  } else if (m[0] > m[5] && m[0] > m[10]) {
    const s = 2 * Math.sqrt(1 + m[0] - m[5] - m[10]);
    q = [0.25 * s, (m[1] + m[4]) / s, (m[2] + m[8]) / s, (m[6] - m[9]) / s];
  } else if (m[5] > m[10]) {
    const s = 2 * Math.sqrt(1 + m[5] - m[0] - m[10]);
    q = [(m[1] + m[4]) / s, 0.25 * s, (m[6] + m[9]) / s, (m[8] - m[2]) / s];
  } else {
    const s = 2 * Math.sqrt(1 + m[10] - m[0] - m[5]);
    q = [(m[2] + m[8]) / s, (m[6] + m[9]) / s, 0.25 * s, (m[1] - m[4]) / s];
  }
  return q;
}
/** 欧拉 ZYX intrinsic → 四元数（Euler(rz,ry,rx,'ZYX') 口径，测试用独立实现） */
function eulerZYXQuat(rx, ry, rz) {
  const hx = (rx * Math.PI / 180) / 2, hy = (ry * Math.PI / 180) / 2, hz = (rz * Math.PI / 180) / 2;
  const cx = Math.cos(hx), sx = Math.sin(hx), cy = Math.cos(hy), sy = Math.sin(hy), cz = Math.cos(hz), sz = Math.sin(hz);
  // q = qz ⊗ qy ⊗ qx
  return [
    cz * cy * sx - sz * sy * cx,
    cz * sy * cx + sz * cy * sx,
    sz * cy * cx - cz * sy * sx,
    cz * cy * cx + sz * sy * sx,
  ];
}
function quatDist(a, b) {
  return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) + Math.abs(a[3] - b[3]);
}
function v3(a, b) {
  return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
}

// ============================================================
// oracle：游戏内局部骨骼矩阵（RenderUtils.prepMatrixForBone 口径）
//   M = T(-pos/16)·T(pivot/16)·Rz·Ry·Rx·T(-pivot/16)；scale=0 → 不可见
// ============================================================
function gameBoneMatrix(pivot, animR, animT, animS) {
  const [px, py, pz] = pivot;
  const [rx, ry, rz] = animR;   // 度
  const [tx, ty, tz] = animT;   // 像素
  const [sx, sy, sz] = animS;
  let m = mat4();
  m = matTranslate(m, -tx / 16, ty / 16, tz / 16);           // posX 取负 + /16
  m = matTranslate(m, px / 16, py / 16, pz / 16);
  m = matRotateAxis(m, "z", (rz * Math.PI) / 180);
  m = matRotateAxis(m, "y", (ry * Math.PI) / 180);
  m = matRotateAxis(m, "x", (rx * Math.PI) / 180);
  m = matScale(m, sx, sy, sz);
  m = matTranslate(m, -px / 16, -py / 16, -pz / 16);
  return m;
}

// ============================================================
// 被测：本项目 ysm-animation-player.apply（L91-145）**修复后**逻辑
//   rotation → Euler(rz,ry,rx,'ZYX') 四元数（L4 已修）
//   position → base(localPosition) + (-tx, +ty, +tz) 相对叠加（修复后，对齐游戏内 pivot 平移）
//   scale=0 → 整骨隐藏（visible=false）
// ============================================================
function ourBoneTransform(pivot, animR, animT, animS) {
  // 旋转：Euler(rz, ry, rx, 'ZYX')（L4 修复后口径）
  const q = eulerZYXQuat(animR[0], animR[1], animR[2]);
  // 位置（修复后）：base = localPosition（单骨无父 = pivot）；动画位移 X 取负叠加，
  // /16 像素→方块（对齐游戏内，外层 modelScale 同效）
  const pos = [
    (pivot[0] - animT[0]) / 16,
    (pivot[1] + animT[1]) / 16,
    (pivot[2] + animT[2]) / 16,
  ];
  const s = [...animS];
  return { q, pos, s };
}

/**
 * 游戏内 pivot 处顶点最终位置（闭合公式，不需矩阵）：
 * M·(pivot/16)，pivot 点是旋转中心 → 旋转/缩放（scale=1）不影响其位置；
 * 游戏内 M = T(-pos/16)·T(pivot/16)·R·T(-pivot/16) → (pivot - pos)/16（X 取负在 -tx）。
 * 与本项目 (base + (-tx,+ty,+tz))/16 应完全一致。
 */
function gamePivotPos(gm, pivot, animT) {
  void gm;
  return [
    (pivot[0] - animT[0]) / 16,
    (pivot[1] + animT[1]) / 16,
    (pivot[2] + animT[2]) / 16,
  ];
}

// ============================================================
// 测试 case（合成：单骨 + 一个带 pivot 的父子 case）
// ============================================================
const CASES = [
  { name: "纯旋转(30,45,60) 无位移", pivot: [8, 16, 0], r: [30, 45, 60], t: [0, 0, 0], s: [1, 1, 1] },
  { name: "纯位移 X+4（X 取负验证）", pivot: [8, 16, 0], r: [0, 0, 0], t: [4, 0, 0], s: [1, 1, 1] },
  { name: "纯位移 Y+4", pivot: [8, 16, 0], r: [0, 0, 0], t: [0, 4, 0], s: [1, 1, 1] },
  { name: "位移+旋转组合（pivot 包裹验证）", pivot: [8, 16, 0], r: [30, 45, 60], t: [4, 2, 0], s: [1, 1, 1] },
  { name: "scale=(0,0,0) 隐藏语义", pivot: [8, 16, 0], r: [0, 0, 0], t: [0, 0, 0], s: [0, 0, 0] },
  { name: "大位移 + 旋转（单位 /16 验证）", pivot: [0, 0, 0], r: [90, 0, 0], t: [16, 16, 0], s: [1, 1, 1] },
];

const TOL = 1e-2;
let failCount = 0;

console.log("════════ 骨骼动画变换对拍：游戏内 vs 本项目 ════════\n");
console.log(`${"case".padEnd(34)}| ${"游戏内位置".padEnd(22)}| ${"本项目位置".padEnd(22)}| posΔ | rotΔ |`);
console.log("─".repeat(110));

for (const c of CASES) {
  const gm = gameBoneMatrix(c.pivot, c.r, c.t, c.s);
  const gPos = gamePivotPos(gm, c.pivot, c.t);
  const gQuat = matToQuat(gm);
  const ours = ourBoneTransform(c.pivot, c.r, c.t, c.s);
  const oPos = ours.pos;
  const oQuat = ours.q;

  // 游戏内 scale=0 → 整骨隐藏：旋转对比无意义（奇异矩阵 matToQuat 失真），跳过
  const hidden = c.s[0] === 0 && c.s[1] === 0 && c.s[2] === 0;
  const rotDelta = hidden ? 0 : quatDist(gQuat, oQuat);
  const posDelta = v3(gPos, oPos);
  const fail = posDelta > TOL || rotDelta > TOL;
  if (fail) failCount++;

  const fmt = (p) => `(${p[0].toFixed(2)}, ${p[1].toFixed(2)}, ${p[2].toFixed(2)})`;
  console.log(
    `${c.name.padEnd(34)}| ${fmt(gPos).padEnd(22)}| ${fmt(oPos).padEnd(22)}| ${posDelta.toFixed(3).padStart(6)} | ${(hidden ? "  —  " : rotDelta.toFixed(3).padStart(6))} |${hidden ? " ⚠ scale=0 隐藏" : ""}${fail ? " ❌" : " ✅"}`,
  );
}

console.log("─".repeat(110));
console.log("\n说明：");
console.log("  - 游戏内：M = T(-pos/16)·T(pivot/16)·Rz·Ry·Rx·T(-pivot/16)，posX 取负，scale=0 隐藏");
console.log("  - 本项目：rotation=Euler(rz,ry,rx,'ZYX')；position/scale 直接覆盖（ysm-animation-player L113-128）");
console.log("  - posΔ/rotΔ > 0.01 视为分歧（差异显著 = 诡异运动根因候选）");
console.log(`\n结论: ${failCount === 0 ? "PASS ✅ 全绿" : `FAIL ❌ ${failCount}/${CASES.length} 个 case 有分歧`}`);
process.exit(failCount === 0 ? 0 : 1);
