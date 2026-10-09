#!/usr/bin/env node
/**
 * debt-report.ts — 存量债到期报告（只读呈现，非闸）。
 *
 * 设计意图（2026-10-09 审核体系锐评 · 到期制收口）：
 *   ADR-256-d1 给 debt 装了到期日（`gate-config` 类型强制 reason/reviewBy），硬处置点在
 *   `doctor --all`（recordDebtInventory，逾期 ⇒ hard FAIL）。但那条硬红灯要到**有人跑全量**
 *   才看得见——高频路径（push/CI）只有尾行一行字带过。本脚本把到期状态变成**独立、可被
 *   CI 汇总页消费的一页表**：谁欠着、什么时候到期/逾期几天、为什么欠着（reason）、下一步
 *   该干什么——让「债的沉默」在远端也有常态可见性，而不必等谁手动跑 --all。
 *
 * 为什么不是 `check-*.ts` 命名：`gate-coverage.ts` 按 `check-` 前缀动态枚举进「门禁覆盖
 *   口径」分母——本脚本**不是一道闸**（纯呈现，不判定不阻断），故意避开该前缀，
 *   防止「报告」混进「44 道闸」的计数里（本轮锐评数过的那笔口径债正是这类混淆）。
 *
 * 用法（仓库根运行）：
 *   node scripts/debt-report.ts            # 人读文本
 *   node scripts/debt-report.ts --md       # markdown（GITHUB_STEP_SUMMARY 消费）
 *   node scripts/debt-report.ts --json     # 结构化（CI / 子代理消费，含 _summary）
 *   node scripts/debt-report.ts --strict   # 有逾期 ⇒ exit 1（默认恒 exit 0——报告不是闸）
 *
 * 退出码：0 = 报告已生成（含「有逾期」的正常情形）；--strict 且有逾期 = 1；
 *         2 = 用法错误。判定语义与 blockPolicy 无关——本脚本不改任何门禁行为。
 * 依赖：_lib/gate-config.ts（清单事实源）/ _lib/gate-debt.ts（到期判据）/
 *       _lib/parse-args.ts / _lib/scan-files.ts。
 */
import { flattenGateTools } from "./_lib/gate-config.ts";
import { debtStatus, type DebtStatus } from "./_lib/gate-debt.ts";
import { parseArgs } from "./_lib/parse-args.ts";
import { toPosix } from "./_lib/to-posix.ts";

interface DebtRow {
  tool: string;
  state: DebtStatus["state"];
  reviewBy: string;
  daysLeft: number;
  reason: string;
}

interface DebtReport {
  date: string;
  total: number;
  expired: DebtRow[];
  dueSoon: DebtRow[];
  ok: DebtRow[];
}

/** 收集到期报告（纯函数，now 注入可测）。条目取 flattenGateTools 的去重首条声明。 */
export function buildDebtReport(now = Date.now()): DebtReport {
  const rows: DebtRow[] = [];
  const seen = new Set<string>();
  for (const t of flattenGateTools()) {
    if (t.blockPolicy !== "debt" || seen.has(t.tool)) continue;
    seen.add(t.tool);
    const st = debtStatus(t.debt, now);
    if (!st) continue;
    rows.push({
      tool: t.tool,
      state: st.state,
      reviewBy: st.reviewBy,
      daysLeft: st.daysLeft,
      reason: st.reason,
    });
  }
  const by = (s: DebtStatus["state"]) =>
    rows.filter((r) => r.state === s).sort((a, b) => a.daysLeft - b.daysLeft);
  return {
    date: new Date(now).toISOString().slice(0, 10),
    total: rows.length,
    expired: by("expired"),
    dueSoon: by("due-soon"),
    ok: by("ok"),
  };
}

/** markdown 渲染（CI 汇总页消费）。空档不渲染小节（不制造「0 项」噪音行）。 */
export function renderMarkdown(rep: DebtReport): string {
  const L: string[] = [];
  const head = rep.expired.length
    ? `## 存量债到期 — **已逾期 ${rep.expired.length} 项**（共 ${rep.total} 项 debt）`
    : `## 存量债到期 — 无逾期（共 ${rep.total} 项 debt）`;
  L.push(head, "");
  const table = (title: string, rows: DebtRow[], col: string) => {
    if (!rows.length) return;
    L.push(`### ${title}`, "", `| 工具 | ${col} | 复审日 | 欠债原因 |`, "|---|---|---|---|");
    for (const r of rows)
      L.push(
        `| \`${r.tool}\` | ${r.daysLeft < 0 ? `**逾期 ${-r.daysLeft} 天**` : `剩 ${r.daysLeft} 天`} | ${r.reviewBy} | ${r.reason} |`,
      );
    L.push("");
  };
  table("已逾期（`doctor --all` 将阻断，须处置或续期）", rep.expired, "状态");
  table("即将到期（≤14 天）", rep.dueSoon, "剩余");
  if (!rep.expired.length && !rep.dueSoon.length) {
    // 「最近复审」= 全部在期债里 daysLeft 最小的一条（升序首条），不是最后一条
    const next = rep.ok[0];
    L.push(
      next
        ? `最近复审：\`${next.tool}\`（${next.reviewBy}，剩 ${next.daysLeft} 天）——全部 ${rep.total} 项均在期内`
        : `全部 ${rep.total} 项均在期内`,
    );
    L.push("");
  }
  L.push(
    "> 到期制 = ADR-256-d1；硬处置在 `node scripts/doctor.ts`（--all）。续期须改 `gate-config.ts` 的 reviewBy 并在提交说明写理由。",
  );
  return L.join("\n");
}

/** 人读文本渲染。 */
export function renderText(rep: DebtReport): string {
  const L: string[] = [`存量债到期报告（${rep.date}）：共 ${rep.total} 项 debt`, ""];
  const sec = (title: string, rows: DebtRow[]) => {
    if (!rows.length) return;
    L.push(`${title}（${rows.length}）`);
    for (const r of rows)
      L.push(
        `  ${r.tool.padEnd(32)} ${r.daysLeft < 0 ? `逾期 ${-r.daysLeft} 天` : `剩 ${r.daysLeft} 天`}（${r.reviewBy}） ${r.reason}`,
      );
    L.push("");
  };
  sec("🔴 已逾期（doctor --all 将阻断）", rep.expired);
  sec("🟡 即将到期（≤14 天）", rep.dueSoon);
  sec("🟢 在期", rep.ok);
  return L.join("\n");
}

function main(): number {
  const args = parseArgs(process.argv.slice(2), {
    bools: ["md", "json", "strict"],
    strings: [],
  });
  if (args.unknown.length) {
    console.error(`[debt-report] 未知参数: ${args.unknown.join(", ")}`);
    return 2;
  }
  const rep = buildDebtReport();
  const summary = {
    _summary: {
      ok: rep.expired.length === 0,
      total: rep.total,
      expired: rep.expired.length,
      dueSoon: rep.dueSoon.length,
      date: rep.date,
    },
    ...rep,
  };
  if (args.json) console.log(JSON.stringify(summary, null, 2));
  else if (args.md) console.log(renderMarkdown(rep));
  else console.log(renderText(rep));
  return args.strict && rep.expired.length > 0 ? 1 : 0;
}

// CLI 判定用仓内既有 idiom（同 commit-blocks/smart-stage.ts）：endsWith 自身文件名，
// 契约测试 import 本模块不触发 main。
if (process.argv[1] && toPosix(process.argv[1]).endsWith("scripts/debt-report.ts")) {
  process.exit(main());
}
