/**
 * _lib/tool-bin.ts 行为契约（ADR-244 同族：CI 只在 frontend/ 装依赖）。
 *
 * 回归背景：pre-push-gate 的 scripts typecheck 曾硬编码「根 node_modules/.bin/tsc.cmd」，
 * 而 CI 只在 `frontend/` 跑 `pnpm install` ⇒ 该路径不存在 ⇒ cmd 报
 * `The system cannot find the path specified.` ⇒ hard 阻断整步（且此前被前序失败步骤
 * skip，长期潜伏）。本契约的头号断言即「候选集必须覆盖 frontend/.bin」——防复发。
 *
 * 同族第二例（2026-09-15，TS2688）：**二进制**解析修好后，**类型**解析仍踩同一坑——
 * `scripts/tsconfig.json` 的 `types: ["node"]` 依赖 `typeRoots` 默认向上走到
 * `<ROOT>/node_modules/@types`，CI 无根 node_modules ⇒
 * `error TS2688: Cannot find type definition file for 'node'` ⇒ scripts typecheck 再次 hard 阻断
 * （34990867684 / 34988991645 等连续红）。故本契约同时钉住 **typeRoots 双根**（见 §6）——
 * 修一处不等于修一族，二进制与类型两层都要覆盖双安装点。
 *
 * 运行：node tests/test_tool_bin.ts
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "../scripts/_lib/scan-files.ts";
import { resolveToolBin, TOOL_BIN_DIRS, toolBinCandidates } from "../scripts/_lib/tool-bin.ts";

const ROOT_BIN = path.join(ROOT, "node_modules", ".bin");
const FRONTEND_BIN = path.join(ROOT, "frontend", "node_modules", ".bin");

// ── 1. 探测目录：根 + frontend 两处，根优先 ──
{
  assert.deepEqual(
    TOOL_BIN_DIRS,
    [ROOT_BIN, FRONTEND_BIN],
    "探测目录须为「根 + frontend」且根优先",
  );
  console.log("  ✓ TOOL_BIN_DIRS：根 + frontend 两处，根优先");
}

// ── 2. 候选形状：win32 优先 .cmd，跨全部探测目录，顺序稳定 ──
{
  const dirs = ["/a", "/b"];
  assert.deepEqual(toolBinCandidates("tsc", "win32", dirs), [
    path.join("/a", "tsc.cmd"),
    path.join("/a", "tsc"),
    path.join("/a", "tsc.ps1"),
    path.join("/b", "tsc.cmd"),
    path.join("/b", "tsc"),
    path.join("/b", "tsc.ps1"),
  ]);
  assert.deepEqual(toolBinCandidates("tsc", "linux", dirs), [
    path.join("/a", "tsc"),
    path.join("/a", "tsc.ps1"),
    path.join("/b", "tsc"),
    path.join("/b", "tsc.ps1"),
  ]);
  assert.deepEqual(toolBinCandidates("knip", "darwin", dirs), [
    path.join("/a", "knip"),
    path.join("/a", "knip.ps1"),
    path.join("/b", "knip"),
    path.join("/b", "knip.ps1"),
  ]);
  console.log("  ✓ toolBinCandidates：win32 优先 .cmd / 跨全部目录 / 顺序稳定");
}

// ── 3. 回归守卫：默认候选集必须覆盖 frontend/.bin（只探根 = 本次 CI 红的根因）──
{
  const cands = toolBinCandidates("tsc");
  const inRoot = cands.filter((c) => c.startsWith(ROOT_BIN));
  const inFrontend = cands.filter((c) => c.startsWith(FRONTEND_BIN));
  assert.ok(inRoot.length > 0, "候选集必须包含根 node_modules/.bin");
  assert.ok(
    inFrontend.length > 0,
    "候选集必须包含 frontend/node_modules/.bin（CI 唯一安装点；缺失即复发「本地绿 CI 红」）",
  );
  assert.equal(inRoot.length, inFrontend.length, "两组候选须等量（同一扩展名序列）");
  assert.ok(
    cands.findIndex((c) => c.startsWith(ROOT_BIN)) <
      cands.findIndex((c) => c.startsWith(FRONTEND_BIN)),
    "根优先于 frontend（npm hoist 语义）",
  );
  console.log(`  ✓ 回归守卫：候选集 ${cands.length} 条覆盖双根，frontend 在列且根优先`);
}

// ── 4. resolveToolBin：不存在 → null（不抛异常、不猜路径）──
{
  assert.equal(resolveToolBin("__ysm_absent_tool__"), null, "不存在的工具须返回 null");
  console.log("  ✓ resolveToolBin：缺失工具 → null（不抛 / 不猜）");
}

// ── 5. resolveToolBin：命中时必落在受控 .bin 目录内且真实存在 ──
{
  const hit = resolveToolBin("tsc");
  if (hit === null) {
    console.log("  · resolveToolBin(tsc)：本环境两处 .bin 均无 tsc（跳过落点断言）");
  } else {
    assert.ok(
      TOOL_BIN_DIRS.some((d) => hit.startsWith(d)),
      `解析结果须落在受控 .bin 目录内，实得 ${hit}`,
    );
    console.log(`  ✓ resolveToolBin(tsc)：命中受控落点 ${path.relative(ROOT, hit)}`);
  }
}

// ── 6. 回归守卫（同族第二例）：scripts/tsconfig.json 的 typeRoots 必须双根 ──
// 二进制走 tool-bin 探测，类型走 tsconfig typeRoots——两条独立解析链，各自都要覆盖
// 「根 + frontend」两安装点。缺 frontend 根即复发 TS2688（本地绿、CI 红）。
{
  const TSCONFIG = path.join(ROOT, "scripts", "tsconfig.json");
  const raw = fs.readFileSync(TSCONFIG, "utf8");
  const cfg = JSON.parse(raw) as { compilerOptions?: { types?: string[]; typeRoots?: string[] } };
  const typeRoots = cfg.compilerOptions?.typeRoots;
  assert.ok(
    Array.isArray(typeRoots) && typeRoots.length > 0,
    "scripts/tsconfig.json 必须显式声明 compilerOptions.typeRoots（默认向上走只命中根 ⇒ CI 无根 node_modules 即 TS2688）",
  );
  // 路径相对 scripts/ 解析后应精确落在两处 @types（顺序 = 根优先，与 TOOL_BIN_DIRS 同款口径）。
  const abs = typeRoots.map((r) => path.resolve(path.join(ROOT, "scripts"), r));
  const ROOT_TYPES = path.join(ROOT, "node_modules", "@types");
  const FRONTEND_TYPES = path.join(ROOT, "frontend", "node_modules", "@types");
  assert.ok(abs.includes(ROOT_TYPES), `typeRoots 须含根 @types（实得 ${abs.join(" , ")}）`);
  assert.ok(
    abs.includes(FRONTEND_TYPES),
    "typeRoots 须含 frontend/node_modules/@types（CI 唯一安装点；缺失即复发 TS2688「本地绿 CI 红」）",
  );
  assert.ok(
    abs.indexOf(ROOT_TYPES) < abs.indexOf(FRONTEND_TYPES),
    "根优先于 frontend（与 TOOL_BIN_DIRS 同款 npm hoist 语义）",
  );
  // types 仍须含 node——否则本契约在 typeRoots 被清空时反而恒绿（自毁风险）。
  assert.ok(cfg.compilerOptions?.types?.includes("node"), "compilerOptions.types 须仍含 'node'");
  console.log("  ✓ 回归守卫（第二例）：scripts/tsconfig.json typeRoots 覆盖双根且根优先");
}

console.log(
  "\nOK: _lib/tool-bin 契约（双根探测 / 根优先 / win32 .cmd 优先 / frontend 在列 / 缺失 → null / typeRoots 双根）",
);
