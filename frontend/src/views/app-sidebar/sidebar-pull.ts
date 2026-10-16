// ===== app-sidebar 拉取编排（sync-flow.ts 拆分出，锐评 P1-2）=====
// 与勾选 / 结果浮层 / 推送职责分离。本模块只做「逐包并行拉取 + 计数汇总 + 汇总文案」。

import { bus } from "@/bus";
import { t } from "@/core/i18n/t.ts";
import { SYNC_OP_TIMEOUT_MS } from "@/utils/async/sync-op-timeout.ts";
import { TimeoutError, withTimeout } from "@/utils/base/primitives/async.ts";
import type { BusyLock } from "@/utils/base/primitives/lock.ts";
import { friendlyError } from "@/utils/dom/errors.ts";
import { toast } from "@/utils/dom/toast.ts";
import { TOAST_MS } from "@/utils/dom/toast-ms.ts";
import { UI_ICONS } from "@/utils/icon/ui-icons.ts";
import { backendGetApp } from "@/views/backend-deps.ts";
import { renderSyncResultPanel } from "./sidebar-result-panel.ts";
import { resetButton } from "./sidebar-shared.ts";

/** 拉取计数累积器 */
interface PullCounters {
  totalPulled: number;
  failed: number;
  timedOut: number;
  firstError: string;
  /** 成功拉取的文件/目录相对路径清单（逐实例逐类型聚合，供浮层点名） */
  files: string[];
  /** P0 修复（2026-10-16 锐评）：超时早停时**被放弃的整合包**（超时那一包 + 其后未跑的包）。
   *  原实现只 `timedOut++`，用户不知道哪些包没拉。 */
  abortedPacks: string[];
}

/** 单类型拉取结果（P0 修复：类型级超时独立标记，与失败区分——超时不入 failed、不计文件） */
type PullPerType =
  | {
      kind: "done";
      value: { ok: number; failed: number; firstError?: string | null; files?: string[] | null };
    }
  | { kind: "timeout" };

/** 汇总一批整合包的结果（批D P1-5：绑定改结构化 `PullSyncResult`——条目级失败不再走 reject，
 *  成功计数不会在途中丢失；reject 只剩前置不满足，如实按「一个类型批次失败」计入）。
 *  P0 修复：超时是 `kind:"timeout"` 独立分支——不入 failed、不误计文件、只增 timedOut。 */
function accumulatePullResults(
  results: PromiseSettledResult<PullPerType>[],
  counters: PullCounters,
): void {
  for (const r of results) {
    if (r.status === "rejected") {
      counters.failed++;
      if (!counters.firstError) counters.firstError = friendlyError(r.reason);
      continue;
    }
    if (r.value.kind === "timeout") {
      counters.timedOut++;
      continue;
    }
    const v = r.value.value;
    counters.totalPulled += v.ok;
    counters.failed += v.failed;
    if (v.files) counters.files.push(...v.files);
    if (v.firstError && !counters.firstError) counters.firstError = v.firstError;
  }
}

/** 拉取收尾 toast 分派（failed/timedOut → warn，全成功 → success，无内容 → info） */
function notifyPullOutcome(counters: PullCounters): void {
  const { totalPulled, failed, timedOut, firstError } = counters;
  if (failed > 0 || timedOut > 0) {
    const parts = [t("sidebar.pullDone", { pulled: totalPulled, failed })];
    if (firstError) parts.push(t("sidebar.pullFirstError", { msg: firstError }));
    if (timedOut > 0) parts.push(t("sidebar.pullTimedOutStopped", { n: timedOut }));
    toast(parts.join("，"), TOAST_MS.normal, "warn");
  } else if (totalPulled > 0) {
    toast(t("sidebar.pullDoneAll", { n: totalPulled }), TOAST_MS.info, "success");
  } else {
    toast(t("sidebar.pullNothing"), TOAST_MS.info, "info");
  }
}

/** 拉取主流程：并行拉取各类型资源，计数成功/失败 → 汇总 toast + 刷新统计与树。
 *  ⚠️ 每个整合包一次 withTimeout（批D：原实现**完全无超时**）——binding 挂起会让
 *  `Promise.allSettled` 永不 settle → await 不返回 → finally 不执行 → `_syncLock` 被
 *  **永久占住**，此后所有推送/拉取都被 beginSync 拒收（那条路此前还是静默的）。
 *  超时语义与推送**同口径**（ADR-340：直调下唯一的不收口成因就是 binding 挂起，
 *  续发只会让后续整合包全撞挂起）：早停循环 + 如实计入 timedOut。 */
export async function runPull(
  selected: string[],
  types: string[],
  pullBtn: HTMLButtonElement,
  lock: BusyLock,
  root: ShadowRoot,
): Promise<void> {
  const counters: PullCounters = {
    totalPulled: 0,
    failed: 0,
    timedOut: 0,
    firstError: "",
    files: [],
    abortedPacks: [],
  };
  try {
    const { PullResourceFromInstance } = await backendGetApp();
    for (let ii = 0; ii < selected.length; ii++) {
      const insName = selected[ii];
      // P1-3：按整合包显示拉取进度（大批量不再只干等 spinner）
      pullBtn.innerHTML = `${UI_ICONS.refresh} ${t("sidebar.pullProgress", {
        i: ii + 1,
        n: selected.length,
      })}`;
      // P0 修复（2026-10-16 锐评）：超时下探到**类型级**。原实现 `withTimeout(allSettled)` 只要
      // 本包任一类型挂起，整包 allSettled 被 TimeoutError 打断，**同包内已 settle 的其余类型
      // 结果全部丢弃**（锐评 P0「超时丢半结果」）。现每类型独立 withTimeout：单个类型挂起
      // 只放弃那一类，同包其余类型结果照常归并；再按「本包出现超时」早停后续包
      //（保留 ADR-340 早停防级联——续发会让后续包再等一整轮超时）。
      const perType: PromiseSettledResult<PullPerType>[] = await Promise.allSettled(
        types.map((rt) =>
          withTimeout(
            PullResourceFromInstance(rt, insName),
            SYNC_OP_TIMEOUT_MS,
            `拉取 ${insName}/${rt}`,
          )
            .then((value): PullPerType => ({ kind: "done", value }))
            .catch((e): PullPerType => {
              if (e instanceof TimeoutError) return { kind: "timeout" };
              throw e;
            }),
        ),
      );
      const before = counters.timedOut;
      accumulatePullResults(perType, counters);
      if (counters.timedOut > before) {
        // 早停：真实计数保留，未跑整合包既非成功也非失败；点名被放弃的包
        counters.abortedPacks = selected.slice(ii);
        break;
      }
    }
    notifyPullOutcome(counters);
    // 变更明细浮层：拉取后用户能看到「从各整合包拉回了哪些文件」，而非只剩计数摘要。
    const notices: string[] = [];
    if (counters.timedOut > 0)
      notices.push(t("sidebar.pullTimedOutStopped", { n: counters.timedOut }));
    // P0 修复（2026-10-16 锐评）：面板点名被超时早停放弃的整合包
    if (counters.abortedPacks.length > 0)
      notices.push(
        t("sidebar.pullAbortedPacks", {
          n: counters.abortedPacks.length,
          names: counters.abortedPacks.join("、"),
        }),
      );
    renderSyncResultPanel(root, {
      verb: "pull",
      okCount: counters.totalPulled,
      failCount: counters.failed,
      okFiles: counters.files,
      failLines: counters.firstError ? [counters.firstError] : [],
      overwriteLines: [],
      notices,
    });
    bus.emit("stats:refresh");
    bus.emit("tree:reload");
  } catch (err) {
    toast(t("sidebar.pullFailed", { msg: friendlyError(err) }), TOAST_MS.normal, "error");
  } finally {
    resetButton(pullBtn, "pull");
    lock.finish(); // 批D：超时也必须走到这里（原无超时时 binding 挂起 = 锁永久占用）
  }
}
