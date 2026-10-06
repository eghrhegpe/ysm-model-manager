#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { finish, ok, runScript } from "./_lib.mts";

// check-knowledge-drift 检查 5.16「卡内 source_files 包含冗余」契约。
// 背景（2026-10-06）：同一张卡既列目录条目、又列其中具体文件条目 = 对同一覆盖双重登记。
// 实证：app-content-diagnostics.md 曾列 11 个 diagnostics/*.ts + 装着它们的 diagnostics/ 目录；
// 此类冗余一度被 35 张卡携带共 99 条。覆盖不受影响（--affected 的 covers() 走 startsWith
// 展开目录条目），纯 frontmatter 膨胀 + 登记重复劳动。
// 与 5.15 互补：5.15 管跨卡重复认领，本检查管单卡内部重复登记。
// 隔离策略：临时卡 + --kc-dir（同 check-knowledge-* 家族范式）。

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "ysm-contain-"));
const NAME = "认领包含冗余契约临时卡";

function writeCard(kind: string, sources: string[]) {
  const fm = [
    "---",
    `kind: ${kind}`,
    `name: ${NAME}`,
    "tier: leaf",
    "category: utils",
    "source_files:",
    ...sources.map((s) => `  - ${s}`),
    "use_when:",
    "  - 包含冗余护栏",
    "---",
    "",
    `# ${NAME}`,
    "",
  ].join("\r\n");
  fs.writeFileSync(path.join(TMP_DIR, `${kind}.md`), fm, "utf8");
}

function runCheck() {
  const r = runScript("check-knowledge-drift.ts", "--json", "--kc-dir", TMP_DIR);
  return (r.stdout ? JSON.parse(r.stdout) : { errors: [], warns: [] }) as { errors: string[]; warns: string[] };
}

function warned(out: { warns: string[] }, kind: string) {
  return out.warns.some((w) => w.includes(`${kind}.md`) && w.includes("吞掉"));
}

console.log("=== 知识卡卡内 source_files 包含冗余契约 ===");

try {
  // 1. 目录 + 其内具体文件 → WARN（app-content-diagnostics 实证形态）
  writeCard("zzz-cn-a", [
    "frontend/src/views/app-content/diagnostics/",
    "frontend/src/views/app-content/diagnostics/init.ts",
    "frontend/src/views/app-content/diagnostics/health.ts",
    "frontend/src/utils/health-report.ts",
  ]);
  let out = runCheck();
  ok(
    "目录 + 其内文件 → WARN 并点名被吞条数",
    out.warns.some((w) => w.includes("zzz-cn-a") && w.includes("2 条") && w.includes("frontend/src/views/app-content/diagnostics/")),
    `warns=${out.warns.filter((w) => w.includes("zzz-cn-a")).join().slice(0, 300)}`,
  );

  // 2. 目录 + 目录外文件 → 不鸣笛（合法组合：目录认领 + 独立文件）
  writeCard("zzz-cn-b", ["frontend/src/views/app-content/diagnostics/", "frontend/src/utils/health-report.ts"]);
  out = runCheck();
  ok("目录 + 目录外文件 → 不鸣笛", !warned(out, "zzz-cn-b"), `warns=${out.warns.filter((w) => w.includes("zzz-cn-b")).join()}`);

  // 3. 纯文件无目录 → 不鸣笛
  writeCard("zzz-cn-c", [
    "frontend/src/views/app-content/diagnostics/init.ts",
    "frontend/src/views/app-content/diagnostics/health.ts",
    "frontend/src/utils/health-report.ts",
  ]);
  out = runCheck();
  ok("纯文件无目录 → 不鸣笛", !warned(out, "zzz-cn-c"), `warns=${out.warns.filter((w) => w.includes("zzz-cn-c")).join()}`);

  // 4. 嵌套目录条目（go-types 实证：go/types/registry/ + go/types/）→ 内层被外层吞掉
  writeCard("zzz-cn-d", [
    "go/types/",
    "go/types/registry/",
    "resource_types.json",
  ]);
  out = runCheck();
  ok("嵌套目录条目 → WARN 点名内层目录被吞", warned(out, "zzz-cn-d"), `warns=${out.warns.filter((w) => w.includes("zzz-cn-d")).join()}`);

  // 5. 嵌套目录不算跨卡重复，不误报 5.15（两检查独立）
  ok("不串扰 5.15 跨卡认领检查", !out.warns.some((w) => w.includes("zzz-cn-d") && w.includes("0 条独占")), `warns=${out.warns.filter((w) => w.includes("zzz-cn-d")).join()}`);
} finally {
  if (fs.existsSync(TMP_DIR)) fs.rmSync(TMP_DIR, { recursive: true, force: true });
}

finish("知识卡卡内 source_files 包含冗余契约全过");
