#!/usr/bin/env node
/**
 * 契约测试：scripts/_lib/gate-config.ts 静态工具清单配置漂移守护。
 *
 * 背景（ADR-088）：pre-push-gate 曾长期内联 4 个工具清单，新增/改名工具时清单与
 * gate 调度逻辑双处维护极易漂移。清单已下沉本模块单点维护，本测试锁死其自洽：
 *   1. 每个引用的工具文件真实存在（脚本改名/归档后清单漏改 → 立即浮出）
 *   2. 单清单内无重复工具引用
 *   3. DOC_STATIC_TOOLS 是 ALL_STATIC_TOOLS 的子集（文档域 ⊆ 全量域）
 *   4. SCRIPTS_TYPECHECK 容忍 rc=2（TS18003 无输入，见模块注释）
 *   5. scopedFiles 声明与实现一致：声明 scopedFiles:true 的脚本必须真接入
 *      _lib/changed-scope.ts 的 --files/--changed 裁剪（2026-09-13 接线）
 *   6. 三档位阈值扫描器在 baseline 比对落地前必须为 debt（防误升 hard 误阻断）
 *
 * 零依赖（仅 node:assert / node:fs / node:path）。
 */
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ALL_STATIC_TOOLS,
  DOC_EXTRA_SCRIPTS,
  DOC_STATIC_TOOLS,
  FRONTEND_STATIC_TOOLS,
  GO_STATIC_TOOLS,
  SCRIPTS_TYPECHECK,
} from "../scripts/_lib/gate-config.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** 把条目规范化为工具名（string → 自身；object → .tool）。 */
function toolName(e: string | { tool: string; [k: string]: unknown }): string {
  return typeof e === "string" ? e : e.tool;
}

/** 断言清单每个工具引用都存在对应脚本文件（tsc 等外部可执行豁免）。 */
function assertToolsExist(
  list: readonly (string | { tool: string; [k: string]: unknown })[],
  label: string,
) {
  for (const e of list) {
    const name = toolName(e);
    if (name === "tsc") continue; // 外部可执行，非 scripts/ 下脚本
    const p = path.join(
      ROOT,
      "scripts",
      name.endsWith(".ts") || name.endsWith(".mjs") ? name : `${name}.ts`,
    );
    assert.ok(fs.existsSync(p), `[gate-config] ${label} 引用不存在的工具脚本: ${name}（${p}）`);
  }
}

/** 断言清单内无重复工具引用。 */
function assertNoDuplicate(
  list: readonly (string | { tool: string; [k: string]: unknown })[],
  label: string,
) {
  const seen = new Set<string>();
  for (const e of list) {
    const name = toolName(e);
    assert.ok(!seen.has(name), `[gate-config] ${label} 重复引用工具: ${name}`);
    seen.add(name);
  }
}

assertToolsExist(ALL_STATIC_TOOLS, "ALL_STATIC_TOOLS");
assertToolsExist(DOC_STATIC_TOOLS, "DOC_STATIC_TOOLS");
assertToolsExist(FRONTEND_STATIC_TOOLS, "FRONTEND_STATIC_TOOLS");
assertToolsExist(GO_STATIC_TOOLS, "GO_STATIC_TOOLS");
assertToolsExist(DOC_EXTRA_SCRIPTS, "DOC_EXTRA_SCRIPTS");

assertNoDuplicate(ALL_STATIC_TOOLS, "ALL_STATIC_TOOLS");
assertNoDuplicate(DOC_STATIC_TOOLS, "DOC_STATIC_TOOLS");
assertNoDuplicate(FRONTEND_STATIC_TOOLS, "FRONTEND_STATIC_TOOLS");
assertNoDuplicate(GO_STATIC_TOOLS, "GO_STATIC_TOOLS");
assertNoDuplicate(DOC_EXTRA_SCRIPTS, "DOC_EXTRA_SCRIPTS");

// 文档域清单应是全量域清单的子集（按工具名，doc 工具不该出现在 all 之外）。
const allNames = new Set(ALL_STATIC_TOOLS.map(toolName));
for (const e of DOC_STATIC_TOOLS) {
  const name = toolName(e);
  assert.ok(
    allNames.has(name),
    `[gate-config] DOC_STATIC_TOOLS 含不在 ALL_STATIC_TOOLS 的工具: ${name}`,
  );
}

// SCRIPTS_TYPECHECK 必须容忍 rc=2（无输入时 tsc 返回 TS18003）。
assert.equal(
  typeof SCRIPTS_TYPECHECK === "object" && SCRIPTS_TYPECHECK.allowRc2,
  true,
  "SCRIPTS_TYPECHECK 应 allowRc2=true",
);

// 结构性：object 条目必须带字符串 tool。
for (const list of [
  ALL_STATIC_TOOLS,
  DOC_STATIC_TOOLS,
  FRONTEND_STATIC_TOOLS,
  GO_STATIC_TOOLS,
  DOC_EXTRA_SCRIPTS,
]) {
  for (const e of list) {
    if (typeof e !== "string") {
      assert.equal(
        typeof e.tool,
        "string",
        `[gate-config] object 条目缺 tool: ${JSON.stringify(e)}`,
      );
    }
  }
}

// ── 5. scopedFiles 声明 ↔ 实现一致（2026-09-13 增量裁剪接线） ──────────────
// 声明 scopedFiles:true 会让 pre-push-gate 的 runTools 改走数组式 procRun 传 `--files`。
// 若脚本其实没接入裁剪，后果是双向的：
//   - 未识别 --files → parseArgs 报「未知参数」→ exit 1 → 门禁误阻断；
//   - 静默忽略 --files → 继续全库扫描 → 存量债淹没本次变更（接线失效且无声）。
// 故断言：声明了就必须在源码里出现 resolveChangedScope（_lib/changed-scope.ts 的唯一入口）。
const ALL_LISTS = [
  ALL_STATIC_TOOLS,
  DOC_STATIC_TOOLS,
  FRONTEND_STATIC_TOOLS,
  GO_STATIC_TOOLS,
  DOC_EXTRA_SCRIPTS,
];
const scopedTools = ALL_LISTS.flat().filter(
  (e): e is { tool: string; scopedFiles?: boolean } =>
    typeof e !== "string" && (e as { scopedFiles?: boolean }).scopedFiles === true,
);
for (const e of scopedTools) {
  const src = fs.readFileSync(path.join(ROOT, "scripts", e.tool), "utf8");
  assert.ok(
    src.includes("resolveChangedScope"),
    `[gate-config] ${e.tool} 声明 scopedFiles:true 但未接入 _lib/changed-scope.ts 的 resolveChangedScope`,
  );
  assert.ok(
    src.includes("--files"),
    `[gate-config] ${e.tool} 声明 scopedFiles:true 但源码未解析 --files`,
  );
}
assert.ok(
  scopedTools.length > 0,
  "[gate-config] 应至少有一个 scopedFiles 工具——增量裁剪接线不可被无声移除",
);
console.log(`  ✓ scopedFiles 契约：${scopedTools.length} 个工具已接入 --files/--changed 裁剪`);

// ── 6. 三档位阈值扫描器：baseline 比对落地前必须 debt（防误升 hard） ─────────
// 它们是「全库阈值 + 增量裁剪」：--files 只收敛扫描范围，被触碰的存量红档文件仍会计入
// 命中（改一行注释也会红）。升 hard 前必须先落 baseline「仅新增违规」口径；那时会改本
// 断言——这是有意识的决策而非漂移。
const THRESHOLD_SCANNERS = ["check-complexity.ts", "check-params.ts", "check-type-safety.ts"];
for (const tool of THRESHOLD_SCANNERS) {
  const e = FRONTEND_STATIC_TOOLS.find(
    (x): x is { tool: string; blockPolicy: string; scopedFiles?: boolean } =>
      typeof x !== "string" && x.tool === tool,
  );
  assert.ok(e, `[gate-config] FRONTEND_STATIC_TOOLS 应含阈值扫描器 ${tool}`);
  assert.equal(
    e.blockPolicy,
    "debt",
    `[gate-config] ${tool} 在 baseline 比对落地前须为 debt（存量红档被触碰即命中，hard 会误阻断）`,
  );
  assert.equal(e.scopedFiles, true, `[gate-config] ${tool} 应声明 scopedFiles:true`);
}
console.log(`  ✓ 阈值扫描器策略：${THRESHOLD_SCANNERS.length} 项均为 debt + scopedFiles`);

console.log(
  "OK: gate-config 静态工具清单自洽（引用存在 / 无重复 / 子集关系 / rc2 容忍 / scopedFiles 一致 / 阈值扫描器 debt）",
);
