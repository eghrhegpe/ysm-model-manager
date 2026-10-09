/**
 * gate-debt.ts — 存量债「到期制」共享层（纯函数，零依赖）。
 *
 * 设计意图（2026-10-09 审核体系锐评 · 第一刀）：
 *   gate-config 的 `blockPolicy: "debt"` 长期是**第三种状态**——既不是「拦」也不是「撤」，
 *   而是「永远只记一笔」。实测代价：16 项 debt 条目里 knip 185（3 周 +45%）、css-token 308
 *   （3 次触碰 0 次收紧）、design-tokens 112（ERROR 108）长期冻结，而体系对外的 KPI 词是
 *   「全绿」——**只减不增的棘轮退化成永久豁免，冻结冒充健康**（第三轮技术债审计头条原话：
 *   「增量维度清除效果优秀，存量维度接近零」）。
 *
 *   本模块给 debt 补上**时间的维度**：每条债必须写明「为什么它是债」（reason）与
 *   「什么时候必须重新决策」（reviewBy）。到期未处置 = 一次显式决策的强制时点，
 *   而不是无限续期：
 *     - 每次门禁运行：覆盖尾行报「最近到期 / 已逾期」计数（可见性，不阻断）；
 *     - debt 项 FAIL 时：note 追加到期状态，让「存量债」带上年龄（不阻断）；
 *     - `doctor --all`（发版前全量、非每次 push）：有逾期债 ⇒ 记一条 hard FAIL
 *       ——刻意不在 push 热路径阻断（存量债与本次变更无关，拿它挡住无关推送者的提交
 *       正是本仓反复吃亏的「假红训练人忽略红灯」；blast radius 收敛到刻意的全量闸）。
 *
 *   与 ADR-256 D5「先观察一轮再议升 hard」的关系：本模块把那句手写意图变成**日期**——
 *   reviewBy 就是「议」的截止日，到期即红灯，续期必须改配置并写理由（留痕在 diff 里）。
 *
 * 依赖：零依赖（仅 Date 内置 API / 类型）。
 *
 * 用法：
 *   import { debtStatus, debtNoteSuffix, summarizeDebt } from './_lib/gate-debt.ts';
 *   const st = debtStatus(entry.debt);                 // null = 非债条目
 *   note += debtNoteSuffix(st);                        // 追加「存量债（reviewBy …，剩 N 天）」
 *   const sum = summarizeDebt([...ALL_STATIC_TOOLS]);  // 尾行 / doctor 逾期盘点
 *
 * 退出码：本模块无独立 CLI（被 gate-config / static-tools / gate-coverage / pre-push-gate import）。
 */

/** 单条存量债的元数据（`blockPolicy: "debt"` 的 GateTool 条目必填）。 */
export interface GateDebt {
  /**
   * 为什么它是「债」而不是「本次引入的缺陷」——一句话，写给人看。
   * 空字符串在契约测试里被拒（禁「无理由债务」）。
   */
  reason: string;
  /**
   * 复审截止日（`YYYY-MM-DD`，UTC 日界）。到期仍未处置 ⇒ `doctor --all` 红灯。
   * 契约测试同时限制**不得超过 MAX_REVIEW_HORIZON_DAYS**——防用 9999 年续期糊过去。
   */
  reviewBy: string;
}

/** 距复审截止日 ≤ 此天数即进入「即将到期」状态（可见性提示，仍不阻断）。 */
export const DUE_SOON_DAYS = 14;

/**
 * 复审截止日的最远视界（天）。契约测试据此拒绝「无限期续期」：
 * 债的管理动作必须周期性发生，一次续期不得超过半年。
 */
export const MAX_REVIEW_HORIZON_DAYS = 180;

export type DebtState = "ok" | "due-soon" | "expired";

export interface DebtStatus {
  state: DebtState;
  /** 原样回传的复审截止日（`YYYY-MM-DD`）。 */
  reviewBy: string;
  /** 距截止日的天数：正数 = 剩余，0 = 当天，负数 = 已逾期。 */
  daysLeft: number;
  reason: string;
  /** 一句话标签：供 note / 尾行 / 报告复用（文案单一事实源）。 */
  label: string;
}

const DAY_MS = 86_400_000;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * 解析 `YYYY-MM-DD` 为 UTC 日界毫秒。非法格式 / 不存在的日期（如 2026-02-31）→ null。
 * 纯函数，UTC 日界保证跨时区判定稳定（本地时区会让「同一天」在 CI 与本机漂移）。
 */
export function parseDebtDate(s: string | undefined): number | null {
  if (!s) return null;
  const m = DATE_RE.exec(s.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const ts = Date.UTC(y, mo - 1, d);
  const back = new Date(ts);
  // 回读比对：拦 2026-02-31 这类被 Date 静默滚动到 3 月的伪日期
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) {
    return null;
  }
  return ts;
}

/** 今日 UTC 日界毫秒（注入 now 使判定可测；同一天内多次调用结果恒定）。 */
function todayUtc(now: number): number {
  return Math.floor(now / DAY_MS) * DAY_MS;
}

/**
 * 计算单条债的到期状态。
 * @param debt 债元数据；undefined/null → 返回 null（非债条目，调用方据此跳过）
 * @param now  当前时刻毫秒（默认 Date.now()；测试注入固定值）
 * @returns 到期状态；reviewBy 非法时同样返回 null（契约测试会在静态层拦非法值，
 *          运行期遇到腐化配置宁可当作「无债」也不抛错——门禁不该因元数据崩掉）
 */
export function debtStatus(debt: GateDebt | undefined | null, now = Date.now()): DebtStatus | null {
  if (!debt) return null;
  const due = parseDebtDate(debt.reviewBy);
  if (due === null) return null;
  const daysLeft = Math.round((due - todayUtc(now)) / DAY_MS);
  const state: DebtState = daysLeft < 0 ? "expired" : daysLeft <= DUE_SOON_DAYS ? "due-soon" : "ok";
  const reason = debt.reason ?? "";
  const label =
    state === "expired"
      ? `存量债·已逾期 ${-daysLeft} 天（reviewBy ${debt.reviewBy}，须处置或续期）`
      : state === "due-soon"
        ? `存量债·即将到期（reviewBy ${debt.reviewBy}，剩 ${daysLeft} 天）`
        : `存量债（reviewBy ${debt.reviewBy}，剩 ${daysLeft} 天）`;
  return { state, reviewBy: debt.reviewBy, daysLeft, reason, label };
}

/** note 追加片段：非债条目返回空串（调用方可直接 `note += debtNoteSuffix(st)`）。 */
export function debtNoteSuffix(status: DebtStatus | null): string {
  return status ? `（${status.label}）` : "";
}

export interface DebtSummary {
  /** 参与盘点的债条目数（同一工具在多张清单重复出现时按工具名去重）。 */
  total: number;
  /** 已逾期条目（按 daysLeft 升序，最逾期在前）。 */
  expired: { tool: string; status: DebtStatus }[];
  /** 即将到期条目（按 daysLeft 升序）。 */
  dueSoon: { tool: string; status: DebtStatus }[];
  /** **最近到期**的债（全部债按 daysLeft 升序取首条，含已逾期），无债时 null。 */
  next: { tool: string; status: DebtStatus } | null;
}

/**
 * 汇总一组清单条目的债状态（尾行计数 / doctor 逾期盘点共用）。
 * 去重口径：同一工具在多张清单（ALL / FRONTEND / GO…）重复声明时只算一次，
 * 且**取最先出现的声明**——与 gate-config「唯一 hard/debt 归属」契约一致。
 */
export function summarizeDebt(
  entries: readonly { tool: string; debt?: GateDebt }[],
  now = Date.now(),
): DebtSummary {
  const byTool = new Map<string, DebtStatus>();
  for (const e of entries) {
    if (byTool.has(e.tool)) continue;
    const st = debtStatus(e.debt, now);
    if (st) byTool.set(e.tool, st);
  }
  const all = [...byTool.entries()].map(([tool, status]) => ({ tool, status }));
  const byDays = all.slice().sort((a, b) => a.status.daysLeft - b.status.daysLeft);
  const expired = byDays.filter((x) => x.status.state === "expired");
  const dueSoon = byDays.filter((x) => x.status.state === "due-soon");
  // 「最近到期」= 全部债里 daysLeft 最小的一条（**不限状态**）：尾行要能报出「下一笔债
  // 什么时候到期」——只在到期前 14 天才显示等于把可见性砍掉一半（本轮锐评第①条：
  // 债的沉默是主要病灶，可见性必须常态存在）。
  const next = byDays.length ? byDays[0]! : null;
  return { total: byTool.size, expired, dueSoon, next };
}

/** record() 的最小结构签名（pre-push-gate 的 ctx.record 直接传入；本模块不依赖 gate-ctx，避免环）。 */
export interface DebtRecorder {
  (
    label: string,
    ok: boolean,
    opts?: { note?: string; tail?: string; blockPolicy?: "hard" | "debt" | "failClosed" },
  ): void;
}

export interface DebtInventoryResult {
  total: number;
  expired: number;
  /** 是否写入了记录（无债时返回 false——不制造空噪音行）。 */
  recorded: boolean;
}

/**
 * 存量债到期盘点（**只有 `doctor --all` 调它**）。
 *
 * 语义（ADR-256-d1 决策 3）：有逾期债 ⇒ record 一条 **hard FAIL**（阻断全量闸，逼一次显式决策：
 * 修 / 升 hard / 带理由改 reviewBy）；无逾期 ⇒ record 一条 OK 如实报出最近复审日；清单里
 * 一条债都没有 ⇒ 不记录（不制造空噪音）。
 *
 * 为什么抽成函数而不是内联在 pre-push-gate：判据（逾期 ⇒ hard、未逾期 ⇒ 可见、无债 ⇒ 静默）
 * 是可测的逻辑，内联在 515 行的 main 里就只能靠跑一次全量闸去验证——那正是「门禁逻辑没有
 * 单测、只能靠整跑观察」的旧病灶形态。此处由 tests/test_gate_debt.ts 直测。
 */
export function recordDebtInventory(
  record: DebtRecorder,
  entries: readonly { tool: string; debt?: GateDebt }[],
  now = Date.now(),
): DebtInventoryResult {
  const sum = summarizeDebt(entries, now);
  if (!sum.total) return { total: 0, expired: 0, recorded: false };
  const label = `存量债到期盘点（debt ${sum.total} 项）`;
  if (sum.expired.length) {
    record(label, false, {
      note: `已逾期 ${sum.expired.length} 项：${sum.expired
        .map((x) => `${x.tool}(逾期 ${-x.status.daysLeft} 天)`)
        .join(" / ")}`,
      tail: sum.expired
        .map(
          (x) =>
            `- ${x.tool}  reviewBy ${x.status.reviewBy}，逾期 ${-x.status.daysLeft} 天｜${x.status.reason}`,
        )
        .join("\n"),
      blockPolicy: "hard",
    });
    return { total: sum.total, expired: sum.expired.length, recorded: true };
  }
  record(label, true, {
    note: sum.next ? `无逾期；最近到期 ${sum.next.tool}（${sum.next.status.label}）` : "无逾期",
  });
  return { total: sum.total, expired: 0, recorded: true };
}
