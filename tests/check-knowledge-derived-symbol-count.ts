#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { finish, ok, runScript } from "./_lib.mts";

// check-knowledge-drift 检查 5.14「派生元数据体量护栏」契约。
// 背景（2026-10-06）：auto_fields.symbols_with_lines 由 gen 从 source_files 派生，但全仓
// 零信息消费者（仅 gen 生产、check-knowledge-drift 校验格式、_lib/machine-diff 用其形状
// 做脏文件分类不读值）——只膨胀 frontmatter、不产信息。181/193 张卡带派生符号，≥100 个的
// 7 张此前全靠人翻 tag 撞见（实证 model3d 1013 个 / frontmatter 1064 行）。
// 阈值 100：分布上 118 与 99 之间存在自然断层。
// 隔离策略：临时卡 + --kc-dir（同 check-knowledge-* 家族范式）。

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "ysm-symcount-"));
const CARD = "zzz-symcount-tmp.md";

/** 生成带 n 个派生符号的临时卡。 */
function writeCard(n: number) {
  const sym = Array.from({ length: n }, (_, i) => `    - Symbol${i}`);
  const fm = [
    "---",
    "kind: zzz-symcount-tmp",
    "name: 派生体量契约临时卡",
    "tier: leaf",
    "category: utils",
    "source_files:",
    "  - frontend/src/utils/base/pure/array.ts",
    "use_when:",
    "  - 派生体量护栏",
    "auto_fields:",
    "  symbols_with_lines:",
    ...sym,
    "---",
    "",
    "# 派生体量契约临时卡",
    "",
  ].join("\r\n");
  fs.writeFileSync(path.join(TMP_DIR, CARD), fm, "utf8");
}

function runCheck() {
  const r = runScript("check-knowledge-drift.ts", "--json", "--kc-dir", TMP_DIR);
  return {
    status: r.status,
    out: (r.stdout ? JSON.parse(r.stdout) : { errors: [], warns: [] }) as { errors: string[]; warns: string[] },
  };
}

console.log("=== 知识卡派生元数据体量护栏契约 ===");

try {
  // 1. 恰好 100 个 → WARN（阈值闭区间）且不阻断
  writeCard(100);
  let { status, out } = runCheck();
  ok(
    "100 个派生符号 → WARN 且点名个数",
    out.warns.some((w) => w.includes(CARD) && w.includes("派生符号 100")),
    `warns=${out.warns.filter((w) => w.includes(CARD)).join(" / ").slice(0, 200)}`,
  );
  ok("WARN 不阻断 → 退出码 0", status === 0, `status=${status}`);

  // 2. 99 个 → 阈值下不鸣笛
  writeCard(99);
  ({ status, out } = runCheck());
  ok(
    "99 个派生符号 → 无 WARN",
    !out.warns.some((w) => w.includes(CARD)),
    `warns=${out.warns.filter((w) => w.includes(CARD)).join(" / ").slice(0, 200)}`,
  );

  // 3. 无 auto_fields → 无 WARN
  fs.writeFileSync(
    path.join(TMP_DIR, CARD),
    [
      "---",
      "kind: zzz-symcount-tmp",
      "name: 派生体量契约临时卡",
      "tier: leaf",
      "category: utils",
      "source_files:",
      "  - frontend/src/utils/base/pure/array.ts",
      "use_when:",
      "  - 派生体量护栏",
      "---",
      "",
      "# 派生体量契约临时卡",
      "",
    ].join("\r\n"),
    "utf8",
  );
  ({ status, out } = runCheck());
  ok(
    "无 auto_fields → 无 WARN",
    !out.warns.some((w) => w.includes(CARD)),
    `warns=${out.warns.filter((w) => w.includes(CARD)).join(" / ").slice(0, 200)}`,
  );

  // 4. 1013 个（model3d 实测值）→ WARN 给出可执行建议
  writeCard(1013);
  ({ status, out } = runCheck());
  ok(
    "1013 个 → WARN 含收窄 source_files 建议",
    out.warns.some((w) => w.includes(CARD) && w.includes("收窄 source_files")),
    `warns=${out.warns.filter((w) => w.includes(CARD)).join(" / ").slice(0, 200)}`,
  );
} finally {
  if (fs.existsSync(TMP_DIR)) fs.rmSync(TMP_DIR, { recursive: true, force: true });
}

finish("知识卡派生元数据体量护栏契约全过");
