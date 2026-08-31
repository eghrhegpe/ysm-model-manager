// ===== 契约测试：cube-mesh.ts expandBoxUV 四角顶点序 =====
// 守护目标：b62f5913 修复的 Go 端 expandBoxUV/parseFaceUV 四角顶点序
//   [u0,v0, u1,v0, u0,v1, u1,v1]
// 必须与前端 cube-mesh.ts buildCubeMeshData → expandBoxUV 输出一致。
// 对角重复 [u0,v0, u1,v1, u0,v0, u1,v1] 会导致每面 UV 退化为对角线性渐变
// （纹理被压成一条对角线）——此测试捕获该回归。
//
// 运行：npx tsx tests/test_cube_uv_quad_vertex.mjs

import { buildCubeMeshData } from "../frontend/src/preview-3d/cube-mesh.ts";

let failed = 0;
function fail(msg) {
  console.error(`[FAIL] ${msg}`);
  failed++;
}

// ─── 构造最小合法 Cube2D ────────────────────────────────────────────────────
// cube 8×8×8 @ origin[0,0,0]，box UV [0,0]，texW=texH=64
// East 面（expandBoxUV uvData[0]）：fu=0, fv=8, fw=8, fh=8
//   期望四角（归一化后）：
//     [0]=u0=0/64=0       [1]=v0=8/64=0.125
//     [2]=u1=8/64=0.125    [3]=v0=0.125（与 [1] 同行）
//     [4]=u0=0             [5]=v1=16/64=0.25
//     [6]=u1=0.125         [7]=v1=0.25
const cube = {
  origin: [0, 0, 0],
  size: [8, 8, 8],
  pivot: [0, 0, 0],
  pivotSet: false,
  uv: [0, 0],
  faceUV: "",
  rotation: [0, 0, 0],
  texSlot: 0,
  inflate: 0,
  mirror: false,
  cubeTexW: 0,
  cubeTexH: 0,
};
const bonePivot = { x: 0, y: 0, z: 0 };
const mesh = buildCubeMeshData(cube, bonePivot, 64, 64, "root", 0);
if (!mesh) {
  fail("buildCubeMeshData 返回 null");
  console.error("\n❌ 契约测试失败");
  process.exit(1);
}

// ─── 1. East 面四角显式断言 ─────────────────────────────────────────────────
// faceDefs[0] = East，是 expandBoxUV 写入的第一面
// uvs 布局：6 面 × 4 顶点 × 2 分量 = 48
// East 面 UV 在 uvs[0..7]
const eastUV = mesh.uvs.slice(0, 8);
const wantEast = [0, 0.125, 0.125, 0.125, 0, 0.25, 0.125, 0.25];
for (let i = 0; i < 8; i++) {
  if (Math.abs(eastUV[i] - wantEast[i]) > 1e-9) {
    fail(`East face uvs[${i}] = ${eastUV[i]}, 期望 ${wantEast[i]} (四角顶点序 [u0,v0,u1,v0,u0,v1,u1,v1])`);
  }
}

// ─── 2. 全 6 面四角不变量 ───────────────────────────────────────────────────
// 每面 8 个 UV 分量，布局：[u0,v0, u1,v0, u0,v1, u1,v1]
// 不变量：
//   顶点 0、1 同 v0 行 → uvs[1] === uvs[3]
//   顶点 2、3 同 v1 行 → uvs[5] === uvs[7]
//   顶点 0、2 同 u0 列 → uvs[0] === uvs[4]
//   顶点 1、3 同 u1 列 → uvs[2] === uvs[6]
// 对角重复 bug 下 uvs[1] !== uvs[3]（v0 vs v1）→ 此断言捕获回归
const faceNames = ["East", "West", "Up", "Down", "South", "North"];
for (let fi = 0; fi < 6; fi++) {
  const base = fi * 8;
  const f = mesh.uvs.slice(base, base + 8);
  // 顶点 0、1 同 v0 行
  if (f[1] !== f[3]) {
    fail(`${faceNames[fi]} face: 顶点 0、1 的 v 不同 (${f[1]} vs ${f[3]})——对角重复回归`);
  }
  // 顶点 2、3 同 v1 行
  if (f[5] !== f[7]) {
    fail(`${faceNames[fi]} face: 顶点 2、3 的 v 不同 (${f[5]} vs ${f[7]})——对角重复回归`);
  }
  // 顶点 0、2 同 u0 列
  if (f[0] !== f[4]) {
    fail(`${faceNames[fi]} face: 顶点 0、2 的 u 不同 (${f[0]} vs ${f[4]})——列对齐破坏`);
  }
  // 顶点 1、3 同 u1 列
  if (f[2] !== f[6]) {
    fail(`${faceNames[fi]} face: 顶点 1、3 的 u 不同 (${f[2]} vs ${f[6]})——列对齐破坏`);
  }
}

// ─── 3. mirror 标志下 UV 水平翻转不变量 ─────────────────────────────────────
// mirror 交换 [0]↔[2]、[4]↔[6]（u0↔u1），v 不变
// 不变量：mirror 后顶点 0、1 仍同 v 行；顶点 2、3 仍同 v 行
// 对角重复 bug 下 mirror 交换会破坏 v 行对齐 → 此断言捕获回归
const mirrorCube = { ...cube, mirror: true };
const mirrorMesh = buildCubeMeshData(mirrorCube, bonePivot, 64, 64, "root", 0);
if (!mirrorMesh) {
  fail("mirror cube buildCubeMeshData 返回 null");
} else {
  for (let fi = 0; fi < 6; fi++) {
    const base = fi * 8;
    const f = mirrorMesh.uvs.slice(base, base + 8);
    if (f[1] !== f[3]) {
      fail(`mirror ${faceNames[fi]} face: 顶点 0、1 的 v 不同 (${f[1]} vs ${f[3]})——mirror + 对角重复回归`);
    }
    if (f[5] !== f[7]) {
      fail(`mirror ${faceNames[fi]} face: 顶点 2、3 的 v 不同 (${f[5]} vs ${f[7]})——mirror + 对角重复回归`);
    }
  }
}

// ─── 结果 ────────────────────────────────────────────────────────────────────
if (failed > 0) {
  console.error(`\n❌ 契约测试失败：${failed} 项`);
  process.exit(1);
}
console.log("✅ cube-mesh.ts expandBoxUV 四角顶点序契约测试通过");
