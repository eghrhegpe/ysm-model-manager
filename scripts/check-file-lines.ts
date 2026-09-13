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
    maxLines: 1045,
    adr: "ADR-171 §2.2 / ADR-227",
    why: "983→1047 膨胀后经 preview-shell / session-ledger 抽取降至 1007（ADR-227 P1）；红线随之下调锁死膨胀，超限须沿真缝拆分或发新 ADR 放宽",
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

/**
 * ADR-234 D3 肥膘告警段（独立于 RULES 硬阻断，exit 0 + WARN）：
 * 规则为「目录 glob + 行数阈值 + 软告警」——扫描 scripts/ 与 scripts/_lib/ 顶层 .ts，
 * 超阈值仅 advisories（不阻断、不计入 violations）。设计意图：让「_lib 共享层胖到不可拆」
 * 可见化（当前 contract-tests 589 / check-knowledge-drift 923），驱动后续按告警排拆分，
 * 而非静默膨胀。后续若决定硬阻断，把 ADVISORY_RULES 并入 RULES 循环即可（语义切换）。
 * 与 RULES 区分：RULES = 精确文件 + 超限 exit 1（治理决策 ADR）；ADVISORY = glob + 超限 WARN（排期情报）。
 */
const ADVISORY_RULES: { glob: (rel: string) => boolean; maxLines: number; label: string }[] = [
  {
    // _lib 共享层 > 400 → 失去「薄」特性，须沿真缝拆分
    glob: (rel) => rel.startsWith("scripts/_lib/") && rel.endsWith(".ts") && !rel.endsWith(".test.ts"),
    maxLines: 400,
    label: "_lib 共享层",
  },
  {
    // scripts 顶层 > 700 → 单体脚本肥膘，须拆分或抽 _lib
    glob: (rel) => rel.startsWith("scripts/") && rel.endsWith(".ts") && !rel.startsWith("scripts/_lib/") && !rel.startsWith("scripts/gate-blocks/") && !rel.startsWith("scripts/hooks/"),
    maxLines: 700,
    label: "scripts 顶层",
  },
];

const violations: Violation[] = [];
const advisories: { file: string; lines: number; maxLines: number; label: string }[] = [];
const checked: string[] = [];

// ── RULES（精确文件，超限硬阻断） ──
for (const r of RULES) {
  const lines = countLines(r.file);
  if (lines === null) {
    console.warn(`[check-file-lines] 文件不存在，跳过: ${r.file}`);
    continue;
  }
  checked.push(r.file);
  if (lines > r.maxLines) violations.push({ file: r.file, lines, maxLines: r.maxLines, adr: r.adr, why: r.why });
}

// ── ADVISORY_RULES（glob 扫描，超限软告警，不阻断） ──
function listTsFiles(relDir: string): string[] {
  const abs = path.join(ROOT, relDir);
  if (!fs.existsSync(abs)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith(".ts")) out.push(`${relDir}/${entry.name}`);
  }
  return out;
}
const advisoryFiles = [...listTsFiles("scripts"), ...listTsFiles("scripts/_lib")];
for (const rel of advisoryFiles) {
  for (const ar of ADVISORY_RULES) {
    if (!ar.glob(rel)) continue;
    const lines = countLines(rel);
    if (lines === null) continue;
    if (lines > ar.maxLines) advisories.push({ file: rel, lines, maxLines: ar.maxLines, label: ar.label });
  }
}

if (json) {
  console.log(
    JSON.stringify(
      {
        _summary: {
          rules: RULES.length,
          files: checked.length,
          violations: violations.length,
          // D3：肥膘软告警（不阻断、不计入 violations；gate 读此字段可量化排期）
          advisoryFiles: advisoryFiles.length,
          advisories: advisories.length,
        },
        violations: violations.map((v) => ({ file: v.file, lines: v.lines, maxLines: v.maxLines, adr: v.adr })),
        advisories: advisories.map((a) => ({ file: a.file, lines: a.lines, maxLines: a.maxLines, label: a.label })),
      },
      null,
      2,
    ),
  );
  process.exit(violations.length ? 1 : 0);
}

if (!violations.length) {
  console.log(`[check-file-lines] ✅ ${checked.length} 个受控文件均在红线内`);
}
for (const v of violations) {
  console.error(`❌ ${v.file}: ${v.lines} 行 > 上限 ${v.maxLines}（超 ${v.lines - v.maxLines} 行）`);
  console.error(`   决策依据: ${v.adr}。${v.why}`);
}

// D3 肥膘软告警（非阻断，仅 WARN 列表）
if (advisories.length) {
  console.warn(`[check-file-lines] ⚠️  ${advisories.length} 个文件超肥膘阈值（软告警，不阻断；驱动拆分排期）：`);
  for (const a of advisories) console.warn(`   ${a.label} ${a.file}: ${a.lines} 行 > 阈值 ${a.maxLines}`);
} else {
  console.log(`[check-file-lines] ✅ 肥膘扫描无超限（scripts/_lib ≤400、scripts 顶层 ≤700）`);
}

if (violations.length) {
  console.error("[check-file-lines] 阻断：行数红线违规（修法：沿对应 ADR 真缝拆分，或发新 ADR 放宽上限）");
  process.exit(1);
}
process.exit(0);