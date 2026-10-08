#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { finish, ok, runScript } from "./_lib.mts";

const ROOT = process.cwd();

// 隔离策略：临时卡写入系统临时目录（mkdtempSync），而非 docs/knowledge/。
// 否则 gen-vitepress-sidebar / gen-knowledge-index 等生成器会 glob 到该卡，
// 把它收进 sidebar.gen.mjs → 污染生成物、在 git 里反复出现。
// 通过 check-knowledge-drift.ts --kc-dir 指向此临时目录实现隔离扫描。
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "ysm-topkeys-contract-"));
const TMP_CARD = path.join(TMP_DIR, "zzz-topkeys-contract-tmp.md");

/** 生成临时测试卡 frontmatter（extraLines 注入要测的键行）。 */
function writeTmpCard(extraLines: string[]) {
  const fm = [
    "---",
    "kind: zzz-topkeys-contract-tmp",
    "name: 顶层键白名单契约测试临时卡",
    "tier: leaf",
    "category: utils",
    "source_files:",
    "  - frontend/src/utils/base/pure/array.ts",
    "use_when:",
    "  - 临时测试",
    ...extraLines,
    "---",
    "",
    "# 顶层键白名单契约测试临时卡",
    "",
    "## 概览",
    "",
    "契约测试用临时卡，测完即删。",
    "",
  ].join("\r\n");
  fs.writeFileSync(TMP_CARD, fm, "utf8");
}

function runDrift() {
  const r = runScript("check-knowledge-drift.ts", "--json", "--kc-dir", TMP_DIR);
  let out: { errors: string[]; warns: string[] } = { errors: [], warns: [] };
  try {
    out = r.stdout ? JSON.parse(r.stdout) : out;
  } catch {
    /* 解析失败保持空 */
  }
  return { status: r.status, out };
}

console.log("=== 知识卡顶层键白名单契约 ===");

try {
  // 1. 白名单内键（含收编的 last_verified）→ 放行
  writeTmpCard([
    "status: active",
    "adr:",
    "  - ADR-001",
    "affected: false",
    "last_verified: 2026-10-08",
    "perf:",
    "  - cpu-bound",
  ]);
  let { status, out } = runDrift();
  ok(
    "白名单键无 ERROR",
    !out.errors.some((e) => e.includes("顶层键")),
    `不应出现顶层键 ERROR: ${out.errors.filter((e) => e.includes("顶层键")).join("; ").slice(0, 300)}`,
  );
  ok("退出码 0", status === 0, `status=${status}`);

  // 2. schema 外键 → ERROR 且点名键名 + 提示收编入口
  writeTmpCard(["banana_field: 123"]);
  ({ status, out } = runDrift());
  ok("schema 外键退出码 1", status === 1, `status=${status}`);
  ok(
    "schema 外键报 ERROR 含键名+收编提示",
    out.errors.some(
      (e) =>
        e.includes("顶层键") && e.includes("banana_field") && e.includes("CARD_TOP_KEYS"),
    ),
    `期望 ERROR 含键名+收编入口: ${out.errors.join("; ").slice(0, 300)}`,
  );

  // 3. 曾清理的野字段不得回流（created/updated/related_adrs/reference_files/supersedes/description）
  const cleaned: Array<{ label: string; lines: string[] }> = [
    { label: "created", lines: ["created: 2026-08-xx"] },
    { label: "updated", lines: ["updated: 2026-08-xx"] },
    { label: "related_adrs", lines: ["related_adrs:", "  - ADR-001"] },
    { label: "reference_files", lines: ["reference_files:", "  - x.md"] },
    { label: "supersedes", lines: ["supersedes: foo"] },
    { label: "description", lines: ["description: 一句话"] },
  ];
  for (const { label, lines } of cleaned) {
    writeTmpCard(lines);
    ({ status, out } = runDrift());
    ok(
      `清理过的野字段「${label}」回流 → ERROR`,
      status === 1 && out.errors.some((e) => e.includes("顶层键")),
      `期望 ERROR: ${out.errors.join("; ").slice(0, 200)}`,
    );
  }

  // 4. auto_fields 子键不误伤（子键是块内缩进，不属于顶层键）
  writeTmpCard([
    "auto_fields:",
    "  symbols_with_lines:",
    "    - someSymbol",
    "  reference_files:",
    "    - someFile.ts",
  ]);
  ({ status, out } = runDrift());
  ok(
    "auto_fields 子键不误伤顶层键白名单",
    !out.errors.some((e) => e.includes("顶层键")),
    `不应出现顶层键 ERROR: ${out.errors.filter((e) => e.includes("顶层键")).join("; ").slice(0, 300)}`,
  );
} finally {
  if (fs.existsSync(TMP_DIR)) fs.rmSync(TMP_DIR, { recursive: true, force: true });
}

finish("知识卡顶层键白名单契约全过");
