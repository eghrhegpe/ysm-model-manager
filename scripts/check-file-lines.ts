#!/usr/bin/env node
/**
 * @file check-file-lines.ts — ADR 级文件行数红线门禁。
 * 设计意图：把「超大文件治理」从情报型预警（line-counter，恒 exit 0）升级为硬门禁——
 * 受控文件超过红线行数即阻断（exit 1），须走 ADR 流程（沿真缝拆分 / 发新 ADR 放宽）
 * 而非静默膨胀。与 line-counter 分工：后者按需诊断；本脚本规则表驱动、违规阻断，
 * 挂 pre-push-gate FRONTEND_STATIC_TOOLS（前端域 push 即守，doctor --all 再全量兜底）。
 * 用法：
 *   node scripts/check-file-lines.ts            # 默认：检查全部规则，违规 exit 1
 *   node scripts/check-file-lines.ts --json     # JSON（_summary 契约，gate/CI 消费）
 * 退出码：0 = 全部在红线内；1 = 存在超限（hard 阻断）。
 * 依赖：node:fs / node:path / _lib/parse-args.ts / _lib/scan-files.ts（零外部依赖）。
 */
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "./_lib/parse-args.ts";
import { getRoot } from "./_lib/scan-files.ts";

const ROOT = getRoot();

/**
 * 行数红线规则表（治理决策，新增条目须在对应 ADR/知识卡登记）。
 * file: 仓库根相对路径；maxLines: 上限；adr: 决策依据；why: 触发时的修复指引。
 */
const RULES: { file: string; maxLines: number; adr: string; why: string }[] = [
  {
    file: "frontend/src/preview-3d/adapters/mount-preview-core.ts",
    maxLines: 1050,
    adr: "ADR-171 §2.2 / ADR-227",
    why: "983→1047 膨胀后经 preview-shell 抽取降至 1012（ADR-227 P1）；红线随之下调锁死膨胀，超限须沿真缝拆分或发新 ADR 放宽",
  },
];

const flags = parseArgs(process.argv.slice(2), { bools: ["json"] });
if (flags.unknown?.length) {
  console.error(`❌ 未知参数: ${flags.unknown.join(", ")}（--help 查看用法）`);
  process.exit(1);
}
const json = flags.json as boolean;

/** 统计文件行数（与 wc -l 一致：末尾换行不另计） */
function countLines(rel: string): number | null {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) return null;
  const s = fs.readFileSync(abs, "utf8");
  return s.split("\n").length - (s.endsWith("\n") ? 1 : 0);
}

type Violation = { file: string; lines: number; maxLines: number; adr: string; why: string };

const violations: Violation[] = [];
const checked: string[] = [];
for (const r of RULES) {
  const lines = countLines(r.file);
  if (lines === null) {
    console.warn(`[check-file-lines] 文件不存在，跳过: ${r.file}`);
    continue;
  }
  checked.push(r.file);
  if (lines > r.maxLines) violations.push({ file: r.file, lines, maxLines: r.maxLines, adr: r.adr, why: r.why });
}

if (json) {
  console.log(
    JSON.stringify(
      {
        _summary: { rules: RULES.length, files: checked.length, violations: violations.length },
        violations: violations.map((v) => ({ file: v.file, lines: v.lines, maxLines: v.maxLines, adr: v.adr })),
      },
      null,
      2,
    ),
  );
  process.exit(violations.length ? 1 : 0);
}

if (!violations.length) {
  console.log(`[check-file-lines] ✅ ${checked.length} 个受控文件均在红线内`);
  process.exit(0);
}
for (const v of violations) {
  console.error(`❌ ${v.file}: ${v.lines} 行 > 上限 ${v.maxLines}（超 ${v.lines - v.maxLines} 行）`);
  console.error(`   决策依据: ${v.adr}。${v.why}`);
}
console.error("[check-file-lines] 阻断：行数红线违规（修法：沿对应 ADR 真缝拆分，或发新 ADR 放宽上限）");
process.exit(1);