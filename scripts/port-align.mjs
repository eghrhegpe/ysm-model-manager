#!/usr/bin/env node
/**
 * port-align.mjs — cube/spec 坐标端口「多样性对齐」校验工具
 *
 * 定位：手动工具（非门禁）。坐标系代码半年才动一次，平时不跑；
 *       需要时用 `npm run verify:port` 一次性全 corpus 对拍，数据收敛争论。
 *
 * 作用：把"事件驱动的一次性 analyze-*.mjs"升级为常驻的、带多样性覆盖的回归比对。
 *   - 内嵌 **Blockbench 权威 oracle**（独立于咱们的 TS 实现，从 bedrock.js 口径复刻）
 *   - 用 esbuild 打包真实 TS 端口（cube-mesh.ts / quaternion.ts）后动态导入，**真跑**咱们的代码
 *   - 生成多样性 corpus（pivotSet / inflate / origin 符号 / rotation 轴数 / size 零厚度 笛卡尔积）
 *   - 每个 case 比对：8 角几何 + localPosition + localRotation
 *   - 另对 eulerToQuaternion 纯函数单独扫一遍（覆盖骨骼调用点，不仅是 cube）
 *   - 输出：覆盖矩阵（可见盲区）+ 分歧报告；退出码 0=全绿 / 1=有分歧
 *
 * 不依赖任何外部 fixture（wine_fox 等），纯合成 corpus → 无幽灵路径、可移植。
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { run } from './_lib/proc.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..');
const CUBE_MESH_TS = resolve(REPO_ROOT, 'frontend/src/utils/3d/cube-mesh.ts');

// esbuild 解析：port-align.mjs 在仓库根，从 frontend/ 向上走 Node 模块解析，
// 找到 esbuild/bin/esbuild。不硬编码 node_modules 路径，兼容 hoisting。
const require = createRequire(join(REPO_ROOT, 'frontend', 'package.json'));
const ESBUILD_PKG = require.resolve('esbuild/package.json');
const ESBUILD_BIN = resolve(dirname(ESBUILD_PKG), 'bin', 'esbuild');

const TOL = 1e-3; // 几何/位置/四元数对照容差（吸收零厚度 0.001 微调；真实分歧 ≥ 1.0）

// ============================================================
// 1. 打包并导入真实 TS 端口
// ============================================================
async function loadTsPort() {
  const tmp = mkdtempSync(join(tmpdir(), 'port-align-'));
  const outfile = join(tmp, 'cube-mesh.bundle.mjs');
  try {
    const r = run(process.execPath, [
      ESBUILD_BIN,
      CUBE_MESH_TS,
      '--bundle',
      '--format=esm',
      '--platform=node',
      `--outfile=${outfile}`,
    ], {});
    if (!r.ok) {
      // r.out 失败时含真实 esbuild 诊断（stdout+stderr 合并），r.err 只是通用「执行失败」；
      // 不打印 r.out 会把打包错误文本吞掉，用户只能看到裸 rc（code review 004563ce P3）。
      console.error('[port-align] esbuild 打包 TS 端口失败：', r.out.trim() || r.err || `rc=${r.rc}`);
      rmSync(tmp, { recursive: true, force: true });
      process.exit(2);
    }
    const mod = await import(pathToFileURL(outfile).href);
    return { mod, cleanup: () => rmSync(tmp, { recursive: true, force: true }) };
  } catch (e) {
    rmSync(tmp, { recursive: true, force: true });
    throw e;
  }
}

// ============================================================
// 2. Blockbench 权威 oracle（独立于 TS 实现）
// ============================================================

// ZYX intrinsic = Rz × Ry × Rx（对齐 bedrock.js / Three.js 'ZYX' 分支，逐元素核对）
function eulerToMatrixZYX(rxDeg, ryDeg, rzDeg) {
  const rx = (rxDeg * Math.PI) / 180;
  const ry = (ryDeg * Math.PI) / 180;
  const rz = (rzDeg * Math.PI) / 180;
  const cx = Math.cos(rx), sx = Math.sin(rx);
  const cy = Math.cos(ry), sy = Math.sin(ry);
  const cz = Math.cos(rz), sz = Math.sin(rz);
  return [
    cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx,
    sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx,
    -sy, cy * sx, cy * cx,
  ];
}

// 3x3 旋转矩阵 → 四元数 [qx,qy,qz,qw]（标准 THREE.Matrix4 口径，row-major 输入）
function matrixToQuat(m) {
  const [m00, m01, m02, m10, m11, m12, m20, m21, m22] = m;
  const trace = m00 + m11 + m22;
  let qx, qy, qz, qw;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    qw = 0.25 / s;
    qx = (m21 - m12) * s;
    qy = (m02 - m20) * s;
    qz = (m10 - m01) * s;
  } else if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    qw = (m21 - m12) / s;
    qx = 0.25 * s;
    qy = (m01 + m10) / s;
    qz = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
    qw = (m02 - m20) / s;
    qx = (m01 + m10) / s;
    qy = 0.25 * s;
    qz = (m12 + m21) / s;
  } else {
    const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
    qw = (m10 - m01) / s;
    qx = (m02 + m20) / s;
    qy = (m12 + m21) / s;
    qz = 0.25 * s;
  }
  return [qx, qy, qz, qw];
}

// 零厚度 clamp（对齐 cube-mesh.ts THICKNESS_EPSILON = CUBE_EPS = 0.001）
const EPS = 0.001;
const clampThick = (v) => (v < EPS ? EPS : v);

// 给定归一化 spec，产出权威预期：8 角几何(相对 cube pivot) + cp + localPosition
// 完全按 bedrock.js parseCube 口径复刻，不引用任何咱们的 TS 代码。
function oracleCube(s, bonePivot) {
  // parseCube: L656-657 rotation X/Y 翻号（Z 不变）→ 喂给 eulerToQuaternion 的正是这串
  const bbRot = [-s.rotation[0], -s.rotation[1], s.rotation[2]];

  // L659: origin[0] *= -1（cube 旋转中心 X 翻号）；L662: from[0] = -(from[0]+size[0])
  let ox = -(s.origin[0] + s.size[0]);
  let oy = s.origin[1];
  let oz = s.origin[2];
  let sx = s.size[0], sy = s.size[1], sz = s.size[2];

  // inflate（L706-708）：from 各轴 -i，size 各轴 +2i
  const inflate = s.inflate ?? 0;
  if (inflate !== 0) {
    ox -= inflate; oy -= inflate; oz -= inflate;
    sx += 2 * inflate; sy += 2 * inflate; sz += 2 * inflate;
  }
  sx = clampThick(sx); sy = clampThick(sy); sz = clampThick(sz);

  // cube 旋转中心 cp：L659 X 翻号；无 pivotSet 用 cube 中心（center-fallback 为本项目保留口径）
  let cp = [s.pivot[0], s.pivot[1], s.pivot[2]];
  cp[0] = -cp[0];
  if (!s.pivotSet) {
    cp = [ox + sx * 0.5, oy + sy * 0.5, oz + sz * 0.5];
  }

  // updateGeometry: from/to 各轴减去 cube origin(=cp)
  let fx = ox, fy = oy, fz = oz;
  let tx = ox + sx, ty = oy + sy, tz = oz + sz;
  fx -= cp[0]; fy -= cp[1]; fz -= cp[2];
  tx -= cp[0]; ty -= cp[1]; tz -= cp[2];
  if (fx === tx) tx += EPS;
  if (fy === ty) ty += EPS;
  if (fz === tz) tz += EPS;

  // 8 角（lx/hx × ly/hy × lz/hz）
  const corners = [
    [fx, fy, fz], [tx, fy, fz], [fx, ty, fz], [tx, ty, fz],
    [fx, fy, tz], [tx, fy, tz], [fx, ty, tz], [tx, ty, tz],
  ];

  // mesh localPosition（轴非对称，对齐 cube-mesh.ts:206 + computeMeshLocalPos）：
  //   X: bonePivot[0] + cp[0]  — cp[0] 已 X 翻号(=-pivot[0])，+ cp[0] = bonePivot.x - pivot.x
  //   Y: cp[1] - bonePivot[1]  — Y 不翻号
  //   Z: cp[2] - bonePivot[2]  — Z 不翻号
  const localPosition = [
    bonePivot[0] + cp[0],
    cp[1] - bonePivot[1],
    cp[2] - bonePivot[2],
  ];

  // cube 旋转四元数（喂 bbRot 给 eulerToQuaternion 的权威结果）
  const localRotation = matrixToQuat(eulerToMatrixZYX(bbRot[0], bbRot[1], bbRot[2]));

  return { corners, localPosition, localRotation };
}

// 纯函数 eulerToQuaternion 的权威预期（直接喂 (rx,ry,rz)，不翻号）
function oracleEuler(rx, ry, rz) {
  return matrixToQuat(eulerToMatrixZYX(rx, ry, rz));
}

// ============================================================
// 3. 比对工具
// ============================================================
const r4 = (v) => Math.round(v * 1e4) / 1e4;

function cornersFromPositions(positions) {
  const map = new Map();
  for (let i = 0; i < positions.length; i += 3) {
    const k = `${r4(positions[i])},${r4(positions[i + 1])},${r4(positions[i + 2])}`;
    if (!map.has(k)) map.set(k, [positions[i], positions[i + 1], positions[i + 2]]);
  }
  return [...map.values()];
}

function matchCorners(actual, expected) {
  if (actual.length !== expected.length) return `角数不符(实际${actual.length}/期望${expected.length})`;
  // 角点当点集比对：每个期望角必须能在实际角集中找到 ≤TOL 的最近邻。
  // 用包含式（非 1:1 双射）以兼容零厚度薄板的 ±epsilon 镜像退化维度
  // （双射贪心会在 ±0.0005 这一对踩 TOL 边界误报，几何两侧其实完全一致）。
  for (const e of expected) {
    let best = Infinity;
    for (const a of actual) {
      const d = Math.max(
        Math.abs(a[0] - e[0]),
        Math.abs(a[1] - e[1]),
        Math.abs(a[2] - e[2]),
      );
      if (d < best) best = d;
    }
    if (best > TOL) return `角 ${e.map(r4)} 无匹配(最近 Δ=${r4(best)})`;
  }
  return null;
}

// 四元数带符号归一（q 与 -q 等价）→ 比绝对值
function matchQuat(actual, expected) {
  const norm = (q) => (q[3] < 0 ? q.map((v) => -v) : q);
  const a = norm(actual), e = norm(expected);
  const d = Math.max(...a.map((v, i) => Math.abs(v - e[i])));
  return d <= TOL ? null : `四元数 ${a.map(r4)} vs ${e.map(r4)} (Δ=${r4(d)})`;
}

function matchVec3(actual, expected, name) {
  const d = Math.max(...actual.map((v, i) => Math.abs(v - expected[i])));
  return d <= TOL ? null : `${name} ${actual.map(r4)} vs ${expected.map(r4)} (Δ=${r4(d)})`;
}

// ============================================================
// 4. 多样性 corpus
// ============================================================
const PIVOT_SET = [true, false];
const INFLATE = [0, 1.5, -1];
const ORIGINS = [
  [2, 3, 4],      // 全正
  [-2, -3, -4],   // 全负
  [0, 0, 0],      // 零（边界）
  [5, -3, 2],     // 混合
];
const ROTATIONS = [
  [0, 0, 0],       // 0 轴
  [90, 0, 0],      // 1 轴 X
  [0, 90, 0],      // 1 轴 Y
  [0, 0, 90],      // 1 轴 Z
  [90, 90, 0],     // 2 轴
  [-90, -90, 0],   // 2 轴负（本次回归触发点）
  [45, 30, 15],    // 3 轴
  [-30, 60, -90],  // 3 轴负
];
const SIZES = [
  [4, 4, 4],  // 正常
  [4, 4, 0],  // Z 零厚度（触发 clamp）
];

const BONE_PIVOT = [10, -5, 3];
const TEX = 64;

function makeSpec(pivotSet, inflate, origin, rotation, size) {
  return {
    origin: [...origin],
    size: [...size],
    pivot: [1, 2, -1],
    pivotSet,
    rotation: [...rotation],
    inflate,
    mirror: false,
    cubeTexW: 0,
    cubeTexH: 0,
    faceUV: '',
    uv: [],
    texSlot: 0,
  };
}

// ============================================================
// 5. 主流程
// ============================================================
console.log('╔══════════════════════════════════════════════════════════╗');
console.log('║ port-align — cube/spec 坐标端口多样性对齐校验（手动工具） ║');
console.log('╚══════════════════════════════════════════════════════════╝');

const { mod, cleanup } = await loadTsPort();
const buildCubeMeshData = mod.buildCubeMeshData;
const eulerToQuaternion = mod.eulerToQuaternion;
if (typeof buildCubeMeshData !== 'function' || typeof eulerToQuaternion !== 'function') {
  console.error('[port-align] TS 端口导入异常：buildCubeMeshData / eulerToQuaternion 缺失');
  cleanup();
  process.exit(2);
}

const failures = [];
let cubeCases = 0;
let cubePass = 0;

console.log('\n── Phase 1: cube 几何 + localPosition + localRotation ──');
for (const pivotSet of PIVOT_SET) {
  for (const inflate of INFLATE) {
    for (const origin of ORIGINS) {
      for (const rotation of ROTATIONS) {
        for (const size of SIZES) {
          cubeCases++;
          const s = makeSpec(pivotSet, inflate, origin, rotation, size);
          const md = buildCubeMeshData(s, { x: BONE_PIVOT[0], y: BONE_PIVOT[1], z: BONE_PIVOT[2] }, TEX, TEX, 'bone', 0);
          if (!md) {
            failures.push({ phase: 'cube', label: `pivot=${pivotSet} infl=${inflate} o=${origin} r=${rotation} sz=${size}`, why: 'buildCubeMeshData 返回 null' });
            continue;
          }
          const exp = oracleCube(s, BONE_PIVOT);
          const actualCorners = cornersFromPositions(md.positions);
          const cErr = matchCorners(actualCorners, exp.corners);
          const pErr = matchVec3(md.localPosition, exp.localPosition, 'localPos');
          const qErr = matchQuat(md.localRotation, exp.localRotation);
          if (cErr || pErr || qErr) {
            const dbg = process.env.PORT_ALIGN_DEBUG
              ? `\n    actual=${JSON.stringify(cornersFromPositions(md.positions))}\n    expect=${JSON.stringify(exp.corners)}`
              : '';
            failures.push({
              phase: 'cube',
              label: `pivot=${pivotSet} infl=${inflate} o=${origin} r=${rotation} sz=${size}`,
              why: [cErr, pErr, qErr].filter(Boolean).join(' | ') + dbg,
            });
          } else {
            cubePass++;
          }
        }
      }
    }
  }
}

// Phase 2: eulerToQuaternion 纯函数扫（覆盖骨骼调用点，不依赖 cube 几何）
console.log('\n── Phase 2: eulerToQuaternion 纯函数扫（骨骼调用点）──');
let eulerCases = 0;
let eulerPass = 0;
for (const rotation of ROTATIONS) {
  eulerCases++;
  const actual = eulerToQuaternion(rotation[0], rotation[1], rotation[2]);
  const expected = oracleEuler(rotation[0], rotation[1], rotation[2]);
  const err = matchQuat(actual, expected);
  if (err) {
    failures.push({ phase: 'euler', label: `r=${rotation}`, why: err });
  } else {
    eulerPass++;
  }
}

// ============================================================
// 6. 覆盖矩阵 + 分歧报告
// ============================================================
console.log('\n── 覆盖矩阵（多样性可见度）──');
const axisCount = (r) => r.filter((v) => Math.abs(v) > 1e-6).length;
const axisBuckets = { '0轴': 0, '1轴': 0, '2轴': 0, '3轴': 0 };
for (const r of ROTATIONS) axisBuckets[`${axisCount(r)}轴`]++;
console.log(`  pivotSet:        ${PIVOT_SET.length} 取值 (${PIVOT_SET.join('/')})`);
console.log(`  inflate:         ${INFLATE.length} 取值 (${INFLATE.join('/')})`);
console.log(`  origin 符号:     ${ORIGINS.length} 组 (正/负/零/混合)`);
console.log(`  rotation 轴数:   ${ROTATIONS.length} 向量 → ${JSON.stringify(axisBuckets)}`);
console.log(`  size 零厚度:     ${SIZES.length} 组 (正常 / Z=0 clamp)`);
console.log(`  cube 组合数:     ${cubeCases}`);
console.log(`  euler 扫点数:    ${eulerCases}`);

const exitCode = failures.length === 0 ? 0 : 1;
if (failures.length > 0) {
  console.log(`\n── 分歧报告（${failures.length} 项）──`);
  for (const f of failures) {
    console.log(`  ❌ [${f.phase}] ${f.label}`);
    console.log(`       ↳ ${f.why}`);
  }
} else {
  console.log('\n✅ 全绿：合成 corpus 下 TS 端口与 Blockbench 权威 oracle 完全一致。');
}

console.log(`\n汇总: cube ${cubePass}/${cubeCases} 通过, euler ${eulerPass}/${eulerCases} 通过, 分歧 ${failures.length}`);
cleanup();
process.exit(exitCode);
