#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { finish, ok, runScript } from "./_lib.mts";

// 5.11 契约：卡间引用断链（卡正文 markdown 相对链接 + 标记性反引号卡名）。
// 隔离策略同 body-line-refs：临时卡 + --kc-dir；docs/archive 用仓库真目录（ROOT 固定）。
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "ysm-cardref-contract-"));
const CARD_STEM = "zzz-card-refs-tmp";
const TMP_CARD = path.join(TMP_DIR, `${CARD_STEM}.md`);
const TMP_TARGET = path.join(TMP_DIR, "zzz-card-target.md");

function writeCards(bodyLines: string[], extraTarget = false) {
  const mk = (stem: string) =>
    [
      "---",
      `kind: ${stem}`,
      "name: 卡间引用契约临时卡",
      "tier: leaf",
      "category: utils",
      "source_files:",
      "  - frontend/src/utils/base/pure/array.ts",
      "use_when:",
      "  - 临时测试",
      "---",
      "",
      `# 卡间引用契约临时卡`,
      "",
      "## 概览",
      "",
      "契约测试用临时卡，测完即删。",
      ...bodyLines,
      "",
    ].join("\r\n");
  fs.writeFileSync(TMP_CARD, mk(CARD_STEM), "utf8");
  if (extraTarget) fs.writeFileSync(TMP_TARGET, mk("zzz-card-target"), "utf8");
}

function runDrift() {
  const r = runScript("check-knowledge-drift.ts", "--json", "--kc-dir", TMP_DIR);
  let out = { errors: [], warns: [] };
  try {
    out = r.stdout ? JSON.parse(r.stdout) : out;
  } catch {
    /* 解析失败保持空 */
  }
  return { status: r.status, out };
}

console.log("=== 知识卡卡间引用断链契约（检查 5.11）===");

try {
  // 1. 干净卡（相关节空）→ 无 WARN
  writeCards([]);
  let { status, out } = runDrift();
  ok(
    "干净卡无 WARN",
    !out.warns.some((x) => x.includes(CARD_STEM)),
    `不应出现 WARN: ${out.warns.join("; ").slice(0, 200)}`,
  );
  ok("干净卡退出码 0", status === 0, `status=${status}`);

  // 2. 相关链接指向存在的卡（临时目录内）→ 无 WARN
  writeCards(["- 相关卡：[目标](./zzz-card-target.md)"], true);
  ({ status, out } = runDrift());
  ok(
    "相关链接指向存在的卡 → 无 WARN",
    !out.warns.some((x) => x.includes(CARD_STEM)),
    `不应出现 WARN: ${out.warns.join("; ").slice(0, 200)}`,
  );

  // 3. 相关链接指向不存在的卡 → WARN
  writeCards(["- 相关卡：[幽灵](./zzz-no-such.md)"]);
  ({ status, out } = runDrift());
  ok(
    "相关链接指向不存在的卡 → WARN",
    !!out.warns.some((x) => x.includes(CARD_STEM) && x.includes("zzz-no-such.md")),
    `期望断链 WARN: ${out.warns.join("; ").slice(0, 300)}`,
  );

  // 4. 标记性反引号卡名命中存在的卡 → 无 WARN（兄弟卡：`zzz-card-target`）
  writeCards(["- 兄弟卡：`zzz-card-target`"], true);
  ({ status, out } = runDrift());
  ok(
    "兄弟卡反引号命中 → 无 WARN",
    !out.warns.some((x) => x.includes(CARD_STEM)),
    `不应出现 WARN: ${out.warns.join("; ").slice(0, 200)}`,
  );

  // 5. 标记性反引号卡名在 knowledge/archive 均未命中 → WARN
  writeCards(["- 兄弟卡：`zzz-ghost-name`"]);
  ({ status, out } = runDrift());
  ok(
    "兄弟卡反引号悬空 → WARN",
    !!out.warns.some((x) => x.includes(CARD_STEM) && x.includes("zzz-ghost-name")),
    `期望悬空 WARN: ${out.warns.join("; ").slice(0, 300)}`,
  );

  // 6. ADR 链接指向不存在的 ADR → WARN（docs/adr 为仓库真目录）
  writeCards(["- 参见 ADR 文档 [ADR-999](../adr/ADR-999.md)"]);
  ({ status, out } = runDrift());
  ok(
    "ADR 链接指向不存在的 ADR → WARN",
    !!out.warns.some((x) => x.includes(CARD_STEM) && x.includes("ADR-999")),
    `期望 ADR 断链 WARN: ${out.warns.join("; ").slice(0, 300)}`,
  );
} finally {
  if (fs.existsSync(TMP_DIR)) fs.rmSync(TMP_DIR, { recursive: true, force: true });
}

finish("知识卡卡间引用断链契约全过");
