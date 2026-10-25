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
  {
    // ADR-315 D3：水能力沿真缝拆三刀（分派表→water-params.ts / 倒影子系统→water-reflect.ts /
    // 类体留水 cap，原 4 组导出经 re-export 垫片保持消费者 import 零改动）后实测 845 行。
    // 2026-10-05 后续收口：倒影子系统 / 锐评注释使文件回弹至 931 行超限，故把最大真缝
    // 「波浪 shader 注入」再拆至 water-shader.ts（纯函数 + GLSL 注入串 + 六锚点守卫，
    // 实例量经 WaterShaderCtx 惰性传入，行为零变更）→ 实测 649 行。
    // 红线 655 = 实测 + ~1% 余量（防后续注释增补自然回弹），扩肥须沿真缝再拆或发新 ADR。
    file: "frontend/src/preview-3d/caps/water-capability.ts",
    maxLines: 655,
    adr: "ADR-315 D1/D3（+2026-10-05 行数红线收口）",
    why: "1132→845→931（回弹超限）→649 行；波浪 shader 注入沿真缝再拆至 water-shader.ts 后锁红；超限须沿真缝拆分或发新 ADR",
  },
  {
    // ADR-315 D3：VRM 适配器沿真缝拆三刀（动作通道→vrm-motion.ts / 感知层→vrm-perception.ts /
    // 菜单工厂→vrm-menu.ts，解析/meta/build 编排留主文件，原导出经 re-export 垫片保持
    // 30+ 消费者 import 零改动）后实测 767 行。红线 790 = 实测 + ~3% 余量。
    file: "frontend/src/preview-3d/adapters/vrm/vrm-adapter.ts",
    maxLines: 790,
    adr: "ADR-315 D2/D3",
    why: "1401 行巨型文件沿真缝拆三刀（动作 vrm-motion / 感知 vrm-perception / 菜单 vrm-menu）降至 767；红线锁死再膨胀，超限须沿真缝拆分或发新 ADR",
  },
];

/**
 * `_lib` 共享层 glob 硬红线（400 行）+ **祖父条款**豁免集。
 *
 * 设计意图（2026-10-14 补网）：`ADVISORY_RULES` 的 `_lib ≤400` 是**软告警**，实测 15 条
 * 告警长期共存、无人拆——「情报驱动排期」被证明不驱动。故本规则把它升为**硬阻断**，
 * 但只对新文件与未豁免者生效：存量超限者进 `LIB_GRANDFATHERED`（各自按实测锁进 RULES），
 * **不回溯追责**（一次性把 63 个文件全红只会逼出 `--no-verify`）。
 *
 * 为什么是 400：`_lib` 是共享层，超 400 即失去「薄」特性、难沿缝拆（原软告警口径）。
 * 为什么曾需要祖父条款：直接硬断会把存量三巨头变成红灯，与「只减不增」原则冲突——
 * 存量冻结在新红线、新文件受限，才是不给肥胖发执照又不炸当场的正确口径。
 *
 * ⚠️ 现状（2026-10-25）：`LIB_GRANDFATHERED` **已清空**——最后一个存量超限者
 * `scripts/_lib/design-tokens.ts`（1391 行）沿真缝拆为八文件（入口 + token-types /
 * token-tables / token-suggest / token-transition / token-glyph / token-style / token-fix /
 * token-emoji，逐段 verbatim 搬移、零行为改写，`check-design-tokens` 全量基线逐条相同），
 * 入口降至 ~150 行。集合清空即达成本规则立项时写下的退出条件：**本规则现为无豁免的
 * 纯 glob 红线**，`_lib` 下任何非测试 .ts 超 400 行即硬阻断。
 * 若未来再出现确属存量的超限者，按同一流程登记（RULES 冻结条目 + 本集合加名）——
 * 但「只减不增」不变：能拆就拆，冻结是临时止血不是执照。
 */
const LIB_GRANDFATHERED: ReadonlySet<string> = new Set();
/** `_lib` 共享层行数上限（glob 硬红线；祖父条款见上）。 */
const LIB_MAX_LINES = 400;

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
 * 可见化，驱动后续按告警排拆分，而非静默膨胀。
 * ⚠️ 本段**刻意不写「当前最胖是谁/多少行」**——数字随收债漂移且无人维护（ADR-162 去行号
 * 精神 + AGENTS.md 瘦身纪律）。权威实况每次运行由本脚本自己的 WARN 列表打印。
 * 后续若决定硬阻断，把 ADVISORY_RULES 并入 RULES 循环即可（语义切换）。
 * 与 RULES 区分：RULES = 精确文件 + 超限 exit 1（治理决策 ADR）；ADVISORY = glob + 超限 WARN（排期情报）。
 * ⚠️ `_lib 共享层` 曾在本表（软告警 ≤400），2026-10-14 已**升为硬红线**并移出本表
 * （见上方 LIB_GRANDFATHERED / LIB_MAX_LINES）——同一事实不留两个真相源。
 */
const ADVISORY_RULES: { glob: (rel: string) => boolean; maxLines: number; label: string }[] = [
  {
    // scripts 顶层 > 700 → 单体脚本肥膘，须拆分或抽 _lib
    glob: (rel) =>
      rel.startsWith("scripts/") &&
      rel.endsWith(".ts") &&
      !rel.startsWith("scripts/_lib/") &&
      !rel.startsWith("scripts/gate-blocks/") &&
      !rel.startsWith("scripts/hooks/"),
    maxLines: 700,
    label: "scripts 顶层",
  },
  {
    // 2026-10-06 补登（技术债审计 docs/archive/tech-debt-audit-2026-10-06.md §4.2）：
    // ADR-034 拆掉 site-view.ts 后，债务迁至 preview-3d/caps/ 与 backend —— 而旧 RULES 只
    // 登记 3 个文件，caps 族 900+ 行完全脱管（sky-capability 1068 已超 mount-preview-core 的
    // 红线值 1045 却无人拦截，属「拆 A 长 B」打地鼠）。此规则把前端生产层纳入软告警，
    // 让 >900 行大文件可见化、驱动拆分排期。阈值 900 取 mount-preview-core 红线 1045 的
    // 「预警水位」—— 未到硬红线但已进入拆分视野，避免「到 1045 才猛然硬断」。
    // 硬红线（RULES）逐文件登记见本文件规则表自身（单一事实源）；拆到 ≤900 后本条不再告警。
    glob: (rel) =>
      (rel.startsWith("frontend/src/preview-3d/") || rel.startsWith("frontend/src/backend/")) &&
      rel.endsWith(".ts") &&
      !rel.endsWith(".test.ts"),
    maxLines: 900,
    label: "前端生产层（preview-3d/backend）",
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
  if (lines > r.maxLines)
    violations.push({ file: r.file, lines, maxLines: r.maxLines, adr: r.adr, why: r.why });
}

// ── `_lib` 共享层 glob 硬红线（2026-10-14 补网：软告警升硬，带祖父条款） ──
// 见上方 LIB_GRANDFATHERED / LIB_MAX_LINES 的设计注释。此处只做扫描与登记：
// 非测试 .ts + 前缀 scripts/_lib/ + 未在祖父条款内 + 超 LIB_MAX_LINES → violation。
for (const rel of listTsFiles("scripts/_lib")) {
  if (rel.endsWith(".test.ts")) continue;
  if (LIB_GRANDFATHERED.has(rel)) continue;
  const lines = countLines(rel);
  if (lines === null) continue;
  if (lines > LIB_MAX_LINES) {
    violations.push({
      file: rel,
      lines,
      maxLines: LIB_MAX_LINES,
      adr: "ADR-234 D3（_lib 共享层硬红线，2026-10-14 补网）",
      why: `_lib 是共享薄层，超 ${LIB_MAX_LINES} 行即难沿缝拆；新写大文件请拆多文件或下沉到 scripts/ 顶层。若确属存量超限，按祖父条款流程登记（RULES 冻结条目 + LIB_GRANDFATHERED 除名清单同步）`,
    });
  }
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
/** 递归版（覆盖 preview-3d 等多层目录；ADR-315 D3 口径：非测试 .ts） */
function walkTsFiles(relDir: string): string[] {
  const abs = path.join(ROOT, relDir);
  if (!fs.existsSync(abs)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = `${relDir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...walkTsFiles(rel));
    else if (entry.isFile() && entry.name.endsWith(".ts")) out.push(rel);
  }
  return out;
}
const advisoryFiles = [
  ...listTsFiles("scripts"),
  ...listTsFiles("scripts/_lib"),
  ...walkTsFiles("frontend/src/preview-3d"),
  ...walkTsFiles("frontend/src/backend"),
];
for (const rel of advisoryFiles) {
  for (const ar of ADVISORY_RULES) {
    if (!ar.glob(rel)) continue;
    const lines = countLines(rel);
    if (lines === null) continue;
    if (lines > ar.maxLines)
      advisories.push({ file: rel, lines, maxLines: ar.maxLines, label: ar.label });
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
        violations: violations.map((v) => ({
          file: v.file,
          lines: v.lines,
          maxLines: v.maxLines,
          adr: v.adr,
        })),
        advisories: advisories.map((a) => ({
          file: a.file,
          lines: a.lines,
          maxLines: a.maxLines,
          label: a.label,
        })),
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
  console.error(
    `❌ ${v.file}: ${v.lines} 行 > 上限 ${v.maxLines}（超 ${v.lines - v.maxLines} 行）`,
  );
  console.error(`   决策依据: ${v.adr}。${v.why}`);
}

// D3 肥膘软告警（非阻断，仅 WARN 列表）
if (advisories.length) {
  console.warn(
    `[check-file-lines] ⚠️  ${advisories.length} 个文件超肥膘阈值（软告警，不阻断；驱动拆分排期）：`,
  );
  for (const a of advisories)
    console.warn(`   ${a.label} ${a.file}: ${a.lines} 行 > 阈值 ${a.maxLines}`);
} else {
 // 阈值不写死：从规则表实时派生（硬写「_lib ≤400」这类数字必腐，且 _lib 已升硬红线移出本表）
  console.log(
    `[check-file-lines] ✅ 肥膘扫描无超限（${ADVISORY_RULES.map((r) => `${r.label} ≤${r.maxLines}`).join("、")}）`,
  );
}

// ── 报错即文档（ADR-315 执行 3）：违规/告警各附可执行的下一步指引，
//    新人 / AI 会话读报错即知修法，不必先翻 AGENTS.md 再找对应章节 ──
if (violations.length) {
  console.error(
    `[check-file-lines] 阻断：行数红线违规。
   修复指引（二选一，须拍板后动手）：
   ① 沿真缝拆分（默认路径，零行为变更）：按模块内「纯表 / 独立子系统 / 类体」边界
      抽 2-3 个同目录 seam 文件，原导出经 re-export 垫片保持消费者 import 零改动；
      先查该文件的 ADR 历史（why 字段的「决策依据」）确认既有真缝，勿另开平行模块。
      参考先例：ADR-227（mount-preview-core 拆 preview-shell / session-ledger）、
      ADR-315（water-capability 拆 water-params / water-reflect；vrm-adapter 拆
      vrm-motion / vrm-perception / vrm-menu）。
   ② 发新 ADR 放宽上限：node scripts/new-adr.ts "<标题>" 占号 → 正文写清「为何放宽 +
      拆分为何不可行 / 排期」→ 本文件 RULES 条目 adr/why 同步登记新 ADR 编号。
   拆分后同步：RULES maxLines 按实测 + ~2% 余量下调锁红（防再膨胀），
   并跑 node scripts/check-file-lines.ts 验证绿。
   知识卡同步铁律：改完代码同步知识卡（check-knowledge-drift 钩子兜底）。`,
  );
  process.exit(1);
}
if (advisories.length) {
  console.error(
    `[check-file-lines] 肥膘排期情报（软告警不阻断）：
   处理入口：按「_lib 共享层 / scripts 顶层」标签分组排期，优先拆「超阈值幅度最大」者
   （超限实况见上方 WARN 列表，本处刻意不写死文件名与行数——数字必腐）。
   入口源码沿真缝抽「纯表 / 纯函数簇 / 格式化输出」，原出口保留 re-export 垫片
   （同 ADR-315 D3 口径）；⚠️ 逐段 verbatim 搬移，**禁止夹带行为改写**，
   搬迁后跑 check-design-tokens 基线比对确认零行为变更。
   排期登记：拆分排期写入对应知识卡（check-knowledge-drift 自动检测），勿写 ADR
   （ADR 只记决策方向，不记实施进度——AGENTS.md 铁律）。`,
  );
}
process.exit(0);
