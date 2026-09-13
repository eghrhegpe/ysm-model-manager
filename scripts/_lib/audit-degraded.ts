#!/usr/bin/env node
/**
 * audit-degraded.ts — 门禁审计对账的退化判定（ADR-232 D3：数据源退化不误报）。
 *
 * 背景：gate-audit-reconcile 以远端跟踪 reflog 的 `update by push` 条目为推送事件锚点。
 * 远端跟踪 reflog 会随 git 过期策略衰减（默认 90 天 GC 清空、clone 不带、fetch 滚动），
 * 窗口内 reflog 缺失时旧版把「正常 GC / 新 clone」误报成「--no-verify 缺口」。
 *
 * 退化条件（满足任一即 degraded）：
 *   1. 审计日志不存在（首次运行 / .git 被重置）；
 *   2. 审计日志存在但窗口内无任何 SKIPPED/PUSH 行（数据源尚未积累）；
 *   3. 远端 reflog 窗口内无 `update by push` 条目（GC 过期 / 新 clone 无 push 历史）。
 *
 * 消费侧（gate-audit-reconcile）退化时：
 *   - 不报缺口（避免误判），输出 `[DEGRADED]` 说明；
 *   - 退出码 0（reconcile 是观测工具非门禁判定，数据退化不构成推送阻断理由）；
 *   - `--json` 输出 `degraded: true` 供消费方区分「真缺口」与「数据缺失」。
 *
 * 非退化时行为完全不变（缺口 = FAIL exit 1，既有契约测试不回归）。
 *
 * 可测性：纯判定函数，输入为「可观测事实」集合（文件存在性 / 行内容 / reflog 条目），
 * 由调用方从 git / fs 读取后注入，模块自身零 git 依赖。
 *
 * 依赖：零（纯函数，node:无）
 */

/** 推送事件锚点（从远端 reflog 解析出的 `update by push` 条目）。 */
export interface PushEvent {
  oid: string;
  ref: string;
  at: string;
}

/** 审计日志可观测事实（由调用方读取后注入，模块不读盘）。 */
export interface AuditFacts {
  /** 审计日志文件是否存在。 */
  auditLogExists: boolean;
  /** 窗口内 PUSH/SKIPPED/SKIPPED_PRECOMMIT 行数（0 = 数据源未积累）。 */
  windowedAuditLines: number;
}

export interface DegradedInput {
  /** 远端跟踪 reflog 窗口内解析出的推送事件（0 = GC/新 clone 退化）。 */
  pushEvents: PushEvent[];
  /** 审计日志可观测事实。 */
  facts: AuditFacts;
}

export interface DegradedVerdict {
  /** 是否退化（退化时 reconcile 不报缺口、exit 0、打 [DEGRADED]）。 */
  degraded: boolean;
  /** 退化原因（供 [DEGRADED] 行说明 / --json 消费）。 */
  reason: string;
}

/**
 * 判定 reconcile 是否处于退化态。
 * 任一退化条件命中即 degraded；全不命中 → degraded=false（走正常缺口判定）。
 */
export function isReconcileDegraded(input: DegradedInput): DegradedVerdict {
  const { pushEvents, facts } = input;
  if (!facts.auditLogExists) {
    return { degraded: true, reason: "audit-log-missing" };
  }
  if (facts.windowedAuditLines === 0) {
    return { degraded: true, reason: "audit-log-empty-window" };
  }
  if (pushEvents.length === 0) {
    return { degraded: true, reason: "reflog-gc-or-clone" };
  }
  return { degraded: false, reason: "" };
}
