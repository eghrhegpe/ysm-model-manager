// ===== 契约测试：Node 契约 runner 的 @/ 别名运行时解析 =====
// 守护目标：契约 runner（scripts/_lib/contract-tests.ts spawn 裸 node）能解析
//   tsconfig paths 登记的 @/<dir>/* 别名——唯一事实源 = frontend/tsconfig.json，
//   经 scripts/_lib/alias-resolve.ts tryResolveAlias 展开（与 check-path-hygiene 同源）。
// 背景：Node 原生 TS 执行不支持 tsconfig paths；a1e76940b 抽离 preview-3d/model/ 后
//   首个 @/preview-3d/model/* 别名 import 进入 cube-mesh.ts 依赖链，runner 报
//   ERR_MODULE_NOT_FOUND（Cannot find package '@/preview-3d'）阻断 pre-push。
// 本测试 = 该基建契约的护栏：若 register 钩子被误删，import 在加载期即崩。
//
// 运行：node tests/test_contract_alias_runtime.ts

import { clamp } from "@/utils/base/pure/clamp.ts";
import { buildCubeMeshData } from "../frontend/src/preview-3d/mesh/cube-mesh.ts";

let failed = 0;
function fail(msg: string): void {
  console.error(`[FAIL] ${msg}`);
  failed++;
}

// ─── 1. 别名直引纯函数（@/utils/base/pure/clamp.ts，零依赖叶） ──────────────
if (clamp(5, 0, 10) !== 5) fail("clamp(5,0,10) !== 5（别名直引失效）");
if (clamp(-3, 0, 10) !== 0) fail("clamp(-3,0,10) !== 0（别名直引失效）");
if (clamp(99, 0, 10) !== 10) fail("clamp(99,0,10) !== 10（别名直引失效）");

// ─── 2. 曾炸断的链路：cube-mesh.ts 内部 @/preview-3d/model/* 别名 import ────
// 最小合法 Cube2D（8×8×8 @ origin，box UV [0,0]，texW=texH=64）——与
// test_cube_uv_quad_vertex.ts 同款构造；此处只断言链路可解析 + 非 null，
// 四角顶点序规格由同族测试专职守护，不重复。
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
const mesh = buildCubeMeshData(cube, { x: 0, y: 0, z: 0 }, 64, 64, "root", 0);
if (!mesh) fail("buildCubeMeshData 返回 null（cube-mesh → @/preview-3d/model/* 别名链解析失败）");

if (failed > 0) {
  console.error(`\n❌ 契约测试失败：${failed} 项`);
  process.exit(1);
}
console.log("✅ 契约 runner @/ 别名运行时解析（tsconfig paths 单一事实源）通过");
