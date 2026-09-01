#!/usr/bin/env node
/**
 * compare-bone-anim-real.mjs — 真实模型逐骨骼对拍（游戏内递归 vs 本项目场景图）
 *
 * 定位：手动诊断工具（非门禁）。修复动画位移应用后，用真实模型验证层级递归下
 * 双方逐骨骼无残留分歧（合成 case 只证原理，真实层级才暴露父级累积/visible 传播差异）。
 *
 * 数据：upstream/[YSM模型]官方开源wine_fox_json/01_taisho_maid（官方开源 wine_fox）
 *   - ysm.json：files.player.model.main → models/main.json（195 骨骼）
 *   - animations/main.animation.json：main 动画关键帧
 *
 * 游戏内：Modern YSM NativeModelRenderer.calculateBoneMatrix（Java 直译递归 +
 *   visibleCache 传播 + cache）：M = T(-pos/16)·T(pivot/16)·Rz·Ry·Rx·S·T(-pivot/16)
 * 本项目：ysm-animation-player.apply 修复后 + THREE.Group 场景图递归（父级累积）：
 *   局部 = T((localPosition + Δpos)/16)·R(ZYX 四元数)·S，localPosition = pivot − parentPivot
 *
 * 对比基准（两系统"骨骼原点"定义不同，取 **pivot 处顶点模型空间位置**，双方语义一致：
 *   游戏内 = WorldMat·(pivot/16)；本项目 = WorldMat 平移分量（骨骼原点=bonePivot=localPosition 累积））
 * 世界旋转：matToQuat(WorldMat) 双方对比（与原点无关）。
 * 退出码 0=全绿 / 1=有分歧。
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, "..", ".."); // tests/port-verification → 仓库根
// YSM_MODEL_DIR 环境变量指定模型目录（批量扫描用）；默认官方开源 wine_fox 01_taisho_maid
const MODEL_DIR = process.env.YSM_MODEL_DIR || join(REPO, "upstream", "[YSM模型]官方开源wine_fox_json", "01_taisho_maid");

// ============================================================
// 矩阵/四元数工具（列主序 4x4）
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
  if (axis === "x") { r[5] = c; r[6] = s; r[9] = -s; r[10] = c; }
  else if (axis === "y") { r[0] = c; r[2] = -s; r[8] = s; r[10] = c; }
  else { r[0] = c; r[1] = s; r[4] = -s; r[5] = c; }
  return matMul(m, r);
}
function matScale(m, x, y, z) {
  const s = mat4();
  s[0] = x; s[5] = y; s[10] = z;
  return matMul(m, s);
}
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
function quatToMat(q) {
  const [x, y, z, w] = q;
  const m = mat4();
  m[0] = 1 - 2 * (y * y + z * z); m[4] = 2 * (x * y - z * w); m[8] = 2 * (x * z + y * w);
  m[1] = 2 * (x * y + z * w); m[5] = 1 - 2 * (x * x + z * z); m[9] = 2 * (y * z - x * w);
  m[2] = 2 * (x * z - y * w); m[6] = 2 * (y * z + x * w); m[10] = 1 - 2 * (x * x + y * y);
  return m;
}
function eulerZYXQuat(rxD, ryD, rzD) {
  const hx = (rxD * Math.PI / 180) / 2, hy = (ryD * Math.PI / 180) / 2, hz = (rzD * Math.PI / 180) / 2;
  const cx = Math.cos(hx), sx = Math.sin(hx), cy = Math.cos(hy), sy = Math.sin(hy), cz = Math.cos(hz), sz = Math.sin(hz);
  return [cz * cy * sx - sz * sy * cx, cz * sy * cx + sz * cy * sx, sz * cy * cx - cz * sy * sx, cz * cy * cx + sz * sy * sx];
}
function quatDist(a, b) { return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) + Math.abs(a[3] - b[3]); }
function v3(a, b) { return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]); }

// ============================================================
// 解析 main.json 骨骼层级
// ============================================================
const rawGeo = JSON.parse(readFileSync(join(MODEL_DIR, "models", "main.json"), "utf8"));
const geo = rawGeo["minecraft:geometry"]?.[0] ?? Object.values(rawGeo).find((v) => v && Array.isArray(v.bones));
const bones = geo.bones;
const byName = new Map(bones.map((b, i) => [b.name, i]));
for (const b of bones) b.parentIdx = b.parent ? (byName.get(b.parent) ?? -1) : -1;
for (const b of bones) b.pivot = b.pivot || [0, 0, 0];

// ============================================================
// 动画采样：main.animation.json 首个 clip，在 t 处对每骨骼三通道求值（线性插值）
// 输出 boneParams（每骨骼 12：Rx,Ry,Rz,Tx,Ty,Tz,Sx,Sy,Sz + 3 unk，旋转为**弧度**，位移像素）
// ============================================================
function sampleKeys(kfs, t) {
  if (!kfs?.length) return null;
  if (t <= kfs[0].time) return kfs[0].post;
  const last = kfs[kfs.length - 1];
  if (t >= last.time) return last.post;
  for (let i = 0; i < kfs.length - 1; i++) {
    const a = kfs[i], b = kfs[i + 1];
    if (t >= a.time && t <= b.time) {
      if (a.lerp === "step") return a.post;
      const f = (t - a.time) / Math.max(1e-9, b.time - a.time);
      return a.post.map((v, k) => v + (b.post[k] - v) * f);
    }
  }
  return null;
}
function buildBoneParams(animClip, t) {
  const params = new Float64Array(bones.length * 12);
  const RAD = Math.PI / 180;
  for (const [name, ch] of Object.entries(animClip?.bones || {})) {
    const bi = byName.get(name);
    if (bi === undefined) continue;
    const off = bi * 12;
    for (const [chan, base] of [["rotation", 0], ["position", 3], ["scale", 6]]) {
      const v = sampleKeys(ch[chan], t);
      if (!v) continue;
      for (let k = 0; k < 3; k++) {
        params[off + base + k] = chan === "rotation" ? v[k] * RAD : v[k];
      }
    }
  }
  return params;
}

// ============================================================
// 游戏内递归（Java calculateBoneMatrix 直译：递归 + visible 传播 + cache）
// ============================================================
function gameWorldMats(params) {
  const cache = new Array(bones.length).fill(null);
  const visible = new Array(bones.length).fill(true);
  const rootPose = mat4();
  const calc = (idx) => {
    if (cache[idx]) return cache[idx];
    const bone = bones[idx];
    let m = mat4(rootPose);
    if (bone.parentIdx !== -1) {
      m = matMul(calc(bone.parentIdx), mat4(rootPose)); // 保留父矩阵
      if (!visible[bone.parentIdx]) visible[idx] = false;
    }
    const off = idx * 12;
    const rx = params[off], ry = params[off + 1], rz = params[off + 2];
    const tx = params[off + 3], ty = params[off + 4], tz = params[off + 5];
    const sx = params[off + 6], sy = params[off + 7], sz = params[off + 8];
    const [px, py, pz] = bone.pivot;
    if (sx === 0 && sy === 0 && sz === 0) visible[idx] = false;
    m = matTranslate(m, (px - tx) / 16, (py + ty) / 16, (pz + tz) / 16);
    m = matRotateAxis(m, "z", rz);
    m = matRotateAxis(m, "y", ry);
    m = matRotateAxis(m, "x", rx);
    if (sx !== 1 || sy !== 1 || sz !== 1) m = matScale(m, sx, sy, sz);
    m = matTranslate(m, -px / 16, -py / 16, -pz / 16);
    cache[idx] = m;
    return m;
  };
  for (let i = 0; i < bones.length; i++) calc(i);
  return { mats: cache, visible };
}

// ============================================================
// 本项目：场景图递归（THREE.Group 语义：父世界 × 局部；局部 = T·R(ZYX)·S）
//   localPosition = pivot − parentPivot；动画位移相对叠加（X 取负）
// ============================================================
function ourWorldMats(params) {
  const world = new Array(bones.length).fill(null);
  const visible = new Array(bones.length).fill(true);
  for (let i = 0; i < bones.length; i++) {
    const bone = bones[i];
    const off = i * 12;
    const rx = params[off], ry = params[off + 1], rz = params[off + 2];
    const tx = params[off + 3], ty = params[off + 4], tz = params[off + 5];
    const sx = params[off + 6], sy = params[off + 7], sz = params[off + 8];
    const [px, py, pz] = bone.pivot;
    const pp = bone.parentIdx !== -1 ? bones[bone.parentIdx].pivot : [0, 0, 0];
    const localPos = [px - pp[0], py - pp[1], pz - pp[2]];
    // 修复后：动画位移相对叠加（X 取负），/16 像素→方块（外层 modelScale 同效）
    const pos = [(localPos[0] - tx) / 16, (localPos[1] + ty) / 16, (localPos[2] + tz) / 16];
    let m = mat4();
    m = matTranslate(m, pos[0], pos[1], pos[2]);
    m = matMul(m, quatToMat(eulerZYXQuat(rx / (Math.PI / 180), ry / (Math.PI / 180), rz / (Math.PI / 180))));
    if (sx !== 1 || sy !== 1 || sz !== 1) m = matScale(m, sx, sy, sz);
    if (sx === 0 && sy === 0 && sz === 0) visible[i] = false;
    world[i] = bone.parentIdx !== -1 && world[bone.parentIdx] ? matMul(world[bone.parentIdx], m) : m;
  }
  return { mats: world, visible };
}

// ============================================================
// 主流程：采样动画 → 双方世界矩阵 → 逐骨骼对比
// 用法：node compare-bone-anim-real.mjs [clip名] [t]
//   YSM_MODEL_DIR 环境变量指定模型目录（默认 01_taisho_maid）；
//   动画文件从 ysm.json files.player.animation 声明发现（首个值），
//   无声明/读取失败 → 静态姿态对拍（params 全 0，兼容中文文件名套装如 15_kluonoa）
// ============================================================
let animPath = null;
try {
  const ysmJson = JSON.parse(readFileSync(join(MODEL_DIR, "ysm.json"), "utf8"));
  const animDecl = ysmJson?.files?.player?.animation;
  if (animDecl && typeof animDecl === "object" && !Array.isArray(animDecl)) {
    const first = Object.values(animDecl)[0];
    if (typeof first === "string") animPath = join(MODEL_DIR, first);
  } else if (Array.isArray(animDecl) && animDecl.length > 0) {
    animPath = join(MODEL_DIR, animDecl[0]);
  }
} catch { /* 无 ysm.json → 兜底 main.animation.json */ }
if (!animPath) {
  const fallback = join(MODEL_DIR, "animations", "main.animation.json");
  if (existsSync(fallback)) animPath = fallback;
}

let clipName = "静态", clip = null, t = 0;
if (animPath) {
  try {
    const entries = Object.entries(JSON.parse(readFileSync(animPath, "utf8")).animations || {});
    const clipArg = process.argv[2];
    [clipName, clip] = (clipArg ? entries.find(([n]) => n === clipArg) : null) || entries[0] || [null, null];
  } catch { clipName = "静态"; clip = null; }
}
const len = clip?.animation_length || 1;
if (clip) t = process.argv[3] !== undefined ? parseFloat(process.argv[3]) : len / 2;
const params = clip ? buildBoneParams(clip, t) : new Float64Array(bones.length * 12);
const game = gameWorldMats(params);
const ours = ourWorldMats(params);

const TOL = 1e-2;
let failCount = 0, maxPos = 0, maxRot = 0, maxPosBone = "", maxRotBone = "";
const rows = [];
for (let i = 0; i < bones.length; i++) {
  const b = bones[i];
  // 位置：游戏内 = WorldMat·(pivot/16)（pivot 处顶点）；本项目 = WorldMat 平移（骨骼原点=bonePivot）
  const [px, py, pz] = b.pivot;
  const gPos = [
    game.mats[i][12] + game.mats[i][0] * px / 16 + game.mats[i][4] * py / 16 + game.mats[i][8] * pz / 16,
    game.mats[i][13] + game.mats[i][1] * px / 16 + game.mats[i][5] * py / 16 + game.mats[i][9] * pz / 16,
    game.mats[i][14] + game.mats[i][2] * px / 16 + game.mats[i][6] * py / 16 + game.mats[i][10] * pz / 16,
  ];
  const oPos = [ours.mats[i][12], ours.mats[i][13], ours.mats[i][14]];
  const posDelta = v3(gPos, oPos);
  const rotDelta = quatDist(matToQuat(game.mats[i]), matToQuat(ours.mats[i]));
  if (posDelta > maxPos) { maxPos = posDelta; maxPosBone = b.name; }
  if (rotDelta > maxRot) { maxRot = rotDelta; maxRotBone = b.name; }
  const fail = posDelta > TOL || rotDelta > TOL;
  if (fail) failCount++;
  rows.push({ name: b.name, posDelta, rotDelta, fail, gHidden: !game.visible[i], oHidden: !ours.visible[i] });
}

console.log(`════ 真实模型逐骨骼对拍（${basename(MODEL_DIR)} · main.json ${bones.length} 骨骼 · ${clipName === "静态" ? "静态姿态（无动画）" : `clip「${clipName}」t=${t.toFixed(2)}s`}）════\n`);
console.log(`分歧骨骼: ${failCount}/${bones.length}  最大 posΔ=${maxPos.toFixed(4)}（${maxPosBone}） 最大 rotΔ=${maxRot.toFixed(4)}（${maxRotBone}）\n`);
if (failCount > 0) {
  console.log("分歧明细（前 15）:");
  console.log(`${"骨骼".padEnd(28)}| ${"posΔ".padStart(8)} | ${"rotΔ".padStart(8)} | 可见性`);
  console.log("─".repeat(70));
  for (const r of rows.filter((r) => r.fail).slice(0, 15)) {
    console.log(`${r.name.padEnd(28)}| ${r.posDelta.toFixed(4).padStart(8)} | ${r.rotDelta.toFixed(4).padStart(8)} | ${r.gHidden !== r.oHidden ? "⚠ 游戏内隐藏≠本项目" : (r.gHidden ? "双方隐藏" : "可见")}`);
  }
  console.log("─".repeat(70));
}
console.log(`\n结论: ${failCount === 0 ? "PASS ✅ 逐骨骼全绿（层级递归 + 动画应用已对齐游戏内）" : `FAIL ❌ ${failCount} 骨有分歧`}`);
process.exit(failCount === 0 ? 0 : 1);
