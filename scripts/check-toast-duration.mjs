#!/usr/bin/env node
/**
 * check-toast-duration.mjs — toast 时长单一事实源守护（防回流闸）
 *
 * 职责：扫描 frontend/src 生产代码（排除 *.test.ts），捕捉仍写死裸数字的 toast 时长：
 *   1. bus.emit("toast:show", { ... duration: <digit> ... })
 *   2. toast(<msg>, <digit>[, <type>]) helper 调用
 * 任何裸数字均违反 utils/dom/toast-ms.ts 的 TOAST_MS 单一事实源契约（R7）。
 *
 * 行为：仅报告，不阻断（退出码恒 0，输出 [WARN]）。
 *   —— 当前为非阻断观察期：待 rollout 稳定后，可将下方 `process.exit(0)` 翻为
 *      `process.exit(violations.length ? 1 : 0)` 升级为硬闸，与 check-boolean-naming 等对齐。
 *      升级触发条件（R15 P3 #1 时间锚点）：① 观察期 ≥30 天无回归（2026-08-29 起）；
 *      ② 或 `docs/.doc-next-steps.md` 已标记为 debt；③ 或 check-boolean-naming 等同类闸门先升级。
 * 依赖：node:child_process / node:fs / node:path / scripts/_lib/scan-files.ts / scripts/_lib/proc.mjs（零外部依赖）
 *
 * 用法：node scripts/check-toast-duration.mjs
 *
 * 退出码：恒 0（观察期非阻断；升级硬闸的触发条件见上方说明）
 *
 * 设计意图：防止 toast 时长硬编码回流——bus.emit("toast:show") / toast() helper 的
 * duration 参数必须来自 TOAST_MS 单一事实源，裸数字即违规（R7）。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { getRoot } from "./_lib/scan-files.ts";
import { run } from './_lib/proc.ts';

const ROOT = getRoot();
const SRC = path.join(ROOT, "frontend/src");

const MAP = {
  1500: "quick", 2000: "success", 2500: "info", 3000: "normal",
  4000: "verbose", 5000: "long", 10000: "persist", 60000: "sticky",
};

const reEmit = /bus\.emit\(\s*"toast:show"[\s\S]{0,1200}?duration:\s*(\d+)/g;
const reHelper = /(?<![\w.$])toast\(\s*([\s\S]+?)\s*,\s*(\d+)(?:\s*,\s*((?:"(?:\\.|[^"])*"|'(?:\\.|[^'])*'|`(?:\\.|[^`])*`|[\w.$]+)))?\)/g;

let files;
const jsonOut = process.argv.includes("--json");
const r = run('git', ['-C', ROOT, 'ls-files', 'frontend/src'], {});
if (!r.ok) {
  if (jsonOut) console.log(JSON.stringify({ _summary: { ok: true, violations: 0, skipped: true } }));
  else console.log("[WARN] check-toast-duration: 无法列举 frontend/src，跳过");
  process.exit(0);
}
files = r.out.split("\n").filter(Boolean)
  .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
  .map((f) => path.join(ROOT, f));

const violations = [];
for (const file of files) {
  const src = readFileSync(file, "utf8");
  const scan = (re, kind) => {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(src))) {
      const n = m[1];
      const key = MAP[n];
      if (!key) continue; // 不在档位表的裸数字（如未来新增档位前）——跳过，避免误报
      const line = src.slice(0, m.index).split("\n").length;
      violations.push({ file: path.relative(ROOT, file), line, n, key, kind });
    }
  };
  scan(reEmit, "toast:show");
  scan(reHelper, "toast()");
}

if (violations.length === 0) {
  if (jsonOut) console.log(JSON.stringify({ _summary: { ok: true, violations: 0 } }));
  else console.log("[OK] check-toast-duration: 无 toast 裸时长（全部引用 TOAST_MS 单一事实源）");
  process.exit(0);
}

if (jsonOut) {
  console.log(JSON.stringify({ _summary: { ok: true, violations: violations.length }, violations }));
} else {
  console.log(`[WARN] check-toast-duration: 发现 ${violations.length} 处 toast 裸时长（违反 R7 单一事实源）`);
  for (const v of violations) {
    console.log(`  ${v.file}:${v.line}  ${v.kind} 裸 duration: ${v.n} → 应改为 TOAST_MS.${v.key}`);
  }
}
// 非阻断观察期：退出码恒 0。升级硬闸时改此处（触发条件见文件头注释：≥30 天无回归 /
// docs/.doc-next-steps.md 标记 debt / 同类闸门先升级，R15 P3 #1）。
process.exit(0);
