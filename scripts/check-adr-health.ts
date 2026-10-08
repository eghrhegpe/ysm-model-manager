#!/usr/bin/env node
/**
 * check-adr-health.ts — ADR 状态机 / 登记表同步 / 技术债审计。
 *
 * 零依赖（仅 node:fs / node:path / node:url）。
 *
 * 三块检查：
 *   [状态机 status]   文件内 `- **状态**：` 值域合法性（四态归一化）
 *                     已采纳 / 部分采纳 / 已废弃 / 已取代（中英混写均识别）
 *                     非法值 → ERROR
 *   [登记同步 health] 文件状态 vs adr/index.md 登记表状态归一化比对
 *                     不一致 → ERROR
 *   [技术债 debt]     识别「违规未修复 / 不一致未修复 / 部分采纳·进行中」
 *                     输出债清单（ADR | 标题 | 债类型 | 严重度 P1/P2/P3）
 *
 * 用法：
 *   node scripts/check-adr-health.ts              # 全量（默认）
 *   node scripts/check-adr-health.ts --status     # 仅状态机
 *   node scripts/check-adr-health.ts --health     # 仅登记同步
 *   node scripts/check-adr-health.ts --debt       # 仅技术债
 *   node scripts/check-adr-health.ts --suggest    # 仅治理建议（观察模式，不阻断）
 *   node scripts/check-adr-health.ts --json       # JSON（CI 用）
 *
 *  --suggest（2026-10-08 技术债清偿 A1 观察模式）：审计 A1 指出「126/304 已采纳缺 emoji
 *  前缀、213/333 含进度化石字样全靠人肉巡检」。但化石字样多属历史叙述（ADR 体系只记决策
 *  方向不记实施进度），机械升 hard 会误伤噪声爆炸。本模式只摊开两类数据供后续决策：
 *  ① 需 emoji 区分的状态（proposed/partial/deprecated/superseded）缺行首 emoji 前缀；
 *  ② 决策未定 ADR（proposed/partial）正文含进度化石字样且非历史叙述豁免。属 debt 级观察，
 *  不进 gate、不阻断（与审计「先观察一轮」建议一致）。
 *
 * 退出码：发现 ERROR → 1；否则 0（技术债为审计报告，不阻断）。
 * 设计意图：ADR 健康综合检查（状态/债务/格式/关联/连续性）
 */
import fs from "node:fs";
import path from "node:path";
import { ADR_DIR, listAdrFiles, REG_ROW_FULL_RE } from "./_lib/adr-files.ts";
import { normalizeState, STATE_LABEL } from "./_lib/adr-status-categories.ts";
import { parseAdrHeader } from "./_lib/frontmatter.ts";

const REG_FILE = path.join(ADR_DIR, "index.md"); // 登记表已并入 index

const ARGS = new Set(process.argv.slice(2));
const JSON_OUT = ARGS.has("--json");
const ONLY = ["--status", "--health", "--debt"].find((f) => ARGS.has(f)) || null;
const SUGGEST = ARGS.has("--suggest");

const errors: any[] = [];
const warns: any[] = [];
const debts: any[] = [];
const _statusRows: any[] = [];

// ── 技术债提取 ────────────────────────────────────────

/** 从状态字符串提取债类型与严重度。 */
function extractDebt(adrId: string, title: string, raw: string) {
  const debtType: string[] = [];
  // 兼容「违规未修复」与 AGENTS.md 措辞「违规或未修复」（含「或」，code_review P2-2）
  if (/违规未修复|违规或未修复/.test(raw)) debtType.push("违规未修复");
  if (/不一致未修复|不一致，未修复|不一致,未修复|不一致或未修复/.test(raw))
    debtType.push("不一致未修复");
  if (/部分采纳/.test(raw)) {
    if (/进行中|未完成|P2\/P3|P3/.test(raw)) debtType.push("部分采纳·进行中");
    else debtType.push("部分采纳");
  }
  if (/待办|TODO|未落地/.test(raw)) debtType.push("待办");

  for (const t of debtType) {
    let severity = "P3";
    if (t === "违规未修复" || t === "不一致未修复") severity = "P2";
    if (t === "待办") severity = "P1";
    debts.push({ adr: adrId, title, type: t, severity });
  }
}

// ── 检查 1：状态机 ────────────────────────────────────

// [ADR-114 §被补充] 状态解析统一走共享库 parseAdrHeader（_lib/frontmatter.ts）
// + normalizeState（_lib/adr-status-categories.ts），不再各写一套正则口径。

function checkStatus() {
  if (!fs.existsSync(ADR_DIR)) {
    errors.push("[状态机] docs/adr/ 目录不存在");
    return [];
  }
  const files = listAdrFiles(); // 三区：根存量 / architecture/ / decisions/（ADR-320）
  const out: any[] = [];
  for (const ref of files) {
    const hdr = parseAdrHeader(ref.absPath) as any;
    if (hdr.error) {
      // P2-4 修复（code_review）：缺标题/缺状态 ADR 不再静默跳过——该 ADR 完全不进 health 判定=假绿。
      // 口径与 check-doc-drift 一致。
      errors.push(`[状态机] ${ref.relPath} 首部解析失败（${hdr.error}）`);
      continue;
    }
    const { num, sub, title, status: raw } = hdr;
    const id = ref.id; // 与文件名同源（语法一致性由 adr-check ID_MISMATCH 把关）
    const { key } = normalizeState(raw);
    const statusMissing = !raw || raw === "(未标注状态)";

    if (statusMissing) warns.push(`[状态机] ${ref.relPath} 缺少 '- **状态**：' 字段`);
    else if (key === "unknown")
      errors.push(
        `[状态机] ${ref.relPath} 状态值非法: 「${raw}」（应为 提议中/已采纳/部分采纳/已废弃/已取代 之一）`,
      );

    extractDebt(id, title, raw);
    out.push({ file: ref.relPath, id, num, sub, title, raw, key, absPath: ref.absPath });
  }
  return out;
}

// ── 检查 2：登记表同步 ────────────────────────────────

function checkRegistry(statusRowsMap: Record<string, any>) {
  let regText = "";
  try {
    regText = fs.readFileSync(REG_FILE, "utf-8");
  } catch {
    errors.push("[登记同步] adr/index.md 登记表不存在");
    return;
  }
  const regMap: Record<string, any> = {};
  for (const m of regText.matchAll(REG_ROW_FULL_RE)) {
    regMap[m[1]!] = { title: m[2]?.trim(), raw: m[3]?.trim() };
  }
  for (const [id, reg] of Object.entries(regMap)) {
    const file = statusRowsMap[id];
    if (!file) continue; // 幽灵由 adr-check 管
    const { key: fileKey } = normalizeState(file.raw);
    const { key: regKey } = normalizeState(reg.raw);
    if (fileKey === "unknown") continue; // 文件状态非法已由状态机报
    if (fileKey !== regKey) {
      errors.push(
        `[登记同步] ${id} 状态不一致：文件「${STATE_LABEL[fileKey]}」vs 登记表「${STATE_LABEL[regKey]}」`,
      );
    }
  }
}

// ── 检查 3：治理建议（观察模式，不阻断） ───────────────

const EMOJI_FOR_STATE: Record<string, string> = {
  proposed: "📝",
  partial: "🔄",
  deprecated: "🧊",
  superseded: "❌",
};
// 进度化石字样（决策未定状态的正文里出现 = 真待办信号）。
// 仅对 proposed/partial（决策未定）扫描，已采纳/已废弃状态里的"进度"属历史叙述，天然排除。
const PROGRESS_RE = /进度|排期|化石|待办|TODO|未落地|仍在进行|尚未完成|下一步|后续|计划/;

function checkSuggest(statusRows: { id: string; file: string; title: string; raw: string; key: string; absPath: string }[]) {
  const missingEmoji: { id: string; relPath: string; key: string }[] = [];
  let acceptedMissingEmoji = 0; // 已采纳缺 ✅ 前缀（量级大，仅计数不逐条列）
  const lingeringProgress: { id: string; relPath: string; hit: string }[] = [];

  for (const r of statusRows) {
    // ① 需 emoji 区分的状态缺行首前缀（proposed/partial/deprecated/superseded）
    const expected = EMOJI_FOR_STATE[r.key];
    if (expected && !r.raw.trim().startsWith(expected)) {
      missingEmoji.push({ id: r.id, relPath: r.file, key: r.key });
    }
    // ①-b 已采纳缺 ✅ 前缀（格式一致性，与审计 126/304 口径对齐；仅计数）
    if (r.key === "accepted" && !r.raw.trim().startsWith("✅")) {
      acceptedMissingEmoji++;
    }

    // ② 决策未定 ADR（proposed/partial）正文含进度化石字样（真滞留信号，非历史叙述）
    if (r.key === "proposed" || r.key === "partial") {
      let body = "";
      try {
        body = fs.readFileSync(r.absPath, "utf-8");
      } catch {
        continue;
      }
      const m = body.match(PROGRESS_RE);
      if (m) {
        lingeringProgress.push({ id: r.id, relPath: r.file, hit: m[0] });
      }
    }
  }
  return { missingEmoji, acceptedMissingEmoji, lingeringProgress };
}

// ── 主流程 ────────────────────────────────────────────

function main() {
  const rows = checkStatus();
  const statusRowsMap = Object.fromEntries(rows.map((r) => [r.id, r]));

  if (SUGGEST) {
    const { missingEmoji, acceptedMissingEmoji, lingeringProgress } = checkSuggest(rows as any);
    if (JSON_OUT) {
      console.log(JSON.stringify({ missingEmoji, acceptedMissingEmoji, lingeringProgress }, null, 2));
    } else {
      console.log("══════════════════════════════════════");
      console.log(" ADR 治理建议（--suggest 观察模式，不阻断）");
      console.log("══════════════════════════════════════");
      console.log(`\n【①-a 需 emoji 区分的状态缺前缀】 ${missingEmoji.length} 条`);
      for (const e of missingEmoji)
        console.log(`  ${e.id} [${e.key}] ${e.relPath}（建议状态字段加 ${EMOJI_FOR_STATE[e.key]} 前缀）`);
      console.log(`\n【①-b 已采纳缺 ✅ 前缀】 ${acceptedMissingEmoji} 条（格式一致性，建议补 ✅）`);
      console.log(`\n【② 决策未定 ADR 含进度化石】 ${lingeringProgress.length} 条`);
      for (const p of lingeringProgress)
        console.log(`  ${p.id} ${p.relPath}（命中「${p.hit}」，建议迁实施进度到知识卡/issue）`);
      console.log(
        "\n提示：以上为观察数据，确认无历史叙述误伤后可升 debt/hard 检查（pre-push gate 接 check-adr-health --suggest 的输出）。",
      );
    }
    process.exit(0);
    return;
  }

  if (!ONLY || ONLY === "--health") checkRegistry(statusRowsMap);

  if (JSON_OUT) {
    console.log(
      JSON.stringify(
        {
          _summary: { errors: errors.length, warns: warns.length, debts: debts.length },
          errors,
          warns,
          debts,
          statusRows: rows.map((r) => ({
            adr: r.id,
            status: r.raw,
            state: r.key,
          })),
        },
        null,
        2,
      ),
    );
    process.exit(errors.length ? 1 : 0);
    return;
  }

  console.log("══════════════════════════════════════");
  console.log(" ADR 健康审计 (check-adr-health)");
  console.log("══════════════════════════════════════");
  console.log(`ERROR   : ${errors.length}`);
  console.log(`WARN    : ${warns.length}`);
  console.log(`技术债   : ${debts.length} 笔`);
  console.log("──────────────────────────────────────");

  if (warns.length) for (const w of warns) console.log(`⚠ ${w}`);

  if (!ONLY || ONLY === "--status") {
    console.log("\n【状态机】");
    for (const r of rows) {
      console.log(`  ${STATE_LABEL[r.key]}  ${r.id} ${r.title}  (${r.raw})`);
    }
  }

  if (!ONLY || ONLY === "--debt") {
    console.log("\n【技术债清单】");
    if (!debts.length) {
      console.log("  ✅ 无技术债");
    } else {
      console.log("  ADR        | 严重度 | 债类型          | 标题");
      console.log("  -----------|--------|-----------------|------");
      for (const d of debts.sort((a, b) => a.adr.localeCompare(b.adr))) {
        console.log(`  ${d.adr}  | ${d.severity.padEnd(6)} | ${d.type.padEnd(15)} | ${d.title}`);
      }
      const p1 = debts.filter((d) => d.severity === "P1").length;
      const p2 = debts.filter((d) => d.severity === "P2").length;
      const p3 = debts.filter((d) => d.severity === "P3").length;
      console.log(`  （P1=${p1} P2=${p2} P3=${p3}）`);
    }
  }

  if (errors.length) {
    for (const e of errors) console.log(`\n❌ ${e}`);
    console.log(
      "→ 修复: 调整 ADR 文件状态标记与登记表一致，或运行 node scripts/new-adr.ts 更新登记表",
    );
    console.log("\n退出码 1（可接 CI 卡点）。");
    process.exit(1);
  }
  console.log("\n✅ ADR 状态机与登记表同步一致。");
}

main();
