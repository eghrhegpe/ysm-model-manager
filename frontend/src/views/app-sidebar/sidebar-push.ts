// ===== app-sidebar 推送编排（sync-flow.ts 拆分出，锐评 P1-2）=====
// 与勾选（sidebar-select）、结果浮层（sidebar-result-panel）、拉取（sidebar-pull）
// 职责分离。本模块只做「按类型循环推送 + 跨批归并 + 汇总文案」，测试无需 mock
// 下拉控制器 / 勾选集合 / esc 监听。

import { t } from "@/core/i18n/t.ts";
import { type DownloadOutcome, downloadMissing } from "@/features/sync/sync.ts";
import { SYNC_OP_TIMEOUT_MS } from "@/utils/async/sync-op-timeout.ts";
import { TimeoutError, withTimeout } from "@/utils/base/primitives/async.ts";
import type { BusyLock } from "@/utils/base/primitives/lock.ts";
import { friendlyError } from "@/utils/dom/errors.ts";
import { toast } from "@/utils/dom/toast.ts";
import { TOAST_MS } from "@/utils/dom/toast-ms.ts";
import { UI_ICONS } from "@/utils/icon/ui-icons.ts";
import { renderSyncResultPanel } from "./sidebar-result-panel.ts";
import { resetButton } from "./sidebar-shared.ts";

/** 失败明细汇总上限（锐评 UX 高项收口，2026-10-14）：各类型内部已限 3 条，
 *  跨类型再限一次防 15 类型累积成超长 toast。 */
const MAX_TOTAL_ERRORS = 5;

/** 失败包点名上限（P1-3）：「A(3)、B(1) 等」比一长串更有指导性 */
const MAX_NAMED_PACKS = 3;

/** 覆盖点名上限（ADR-340-d2）：与包点名同规——前几个足以让用户定位自己改过什么，
 *  全列会把 toast 撑爆（批量推送可覆盖上百个目标）。 */
const MAX_NAMED_OVERWRITES = 3;

/** 浮层每包成功文件明细上限（2026-10-15 推送侧逐文件点名）：浮层可滚动，但单包全列
 *  仍会让清单失控（大整合包一次装几百文件）——前 8 条足以定位，超出记「…另 N」。
 *  与 tpl 侧全清单 100 条总闸（SYNC_RESULT_MAX_FILES）分层设防。 */
const MAX_PANEL_PACK_FILES = 8;

/** 路径末段（**只切显示名**，不参与任何归属/类型判定——前端只读不判的红线只管语义，
 *  不管这点字符串处理；跨盘符/正反斜杠都切）。 */
function baseName(p: string): string {
  return p.split(/[\\/]/).pop() || p;
}

/** 包级累计态（跨类型累加）+ 成功安装项清单（2026-10-15 浮层逐文件点名数据源） */
type PackTotal = { ok: number; fail: number; files: string[] };

/** 推送累计态：文件级计数 + 失败明细 + 包级归因 + 覆盖清单 + skipped 分流 */
interface PushAccum {
  skipped: number;
  blocked: number;
  timedOut: number;
  installOk: number;
  installFail: number;
  errorDetails: string[];
  packTotals: Map<string, PackTotal>;
  /** 本次推送**覆盖实例侧已修改副本**的目标路径（ADR-340-d2；Set 去重，
   *  跨类型/跨包同路径只算一次——覆盖是磁盘事实，不是批次事实） */
  overwrites: Set<string>;
  /** P0 修复（2026-10-16 锐评）：超时早停时**被放弃的类型批次名单**（超时那一类 + 其后未跑的类型）。
   *  原实现只 `timedOut++`，用户只看到「1 个类型批次超时」，不知道是哪几类被丢——
   *  点名让推送结果如实反映「哪些类型没做」。 */
  abortedTypes: string[];
}

/** 单类型批次结果归并：文件级计数 + 失败明细（限 MAX_TOTAL_ERRORS）+ 包级累加 + 覆盖清单 + skipped 归因分流 */
function absorbOutcome(outcome: DownloadOutcome, accum: PushAccum): void {
  accum.installOk += outcome.ok;
  accum.installFail += outcome.fail;
  for (const msg of outcome.errors ?? []) {
    if (accum.errorDetails.length < MAX_TOTAL_ERRORS) accum.errorDetails.push(msg);
  }
  for (const p of outcome.packs ?? []) {
    const cur = accum.packTotals.get(p.name) ?? { ok: 0, fail: 0, files: [] };
    cur.ok += p.ok;
    cur.fail += p.fail;
    if (p.files) cur.files.push(...p.files);
    accum.packTotals.set(p.name, cur);
  }
  for (const p of outcome.overwrites ?? []) accum.overwrites.add(p);
  if (outcome.skipped) {
    // 归因分流：busy = 他页同时在推（直调串行下自撞锁不再可能，仅剩跨页防御位）；
    // config/error 各自有专门 toast（handler 已弹），汇总只如实计「未完成批次」，
    // 不并进「被跳过（上一批同步未结束）」的错误归因文案
    if (outcome.skipReason === "busy") accum.skipped++;
    else accum.blocked++;
  }
}

/** 失败包点名（P1-3）：只点有失败的包，按失败数降序（多类型累积后差距可见） */
function buildFailedPacks(packTotals: Map<string, PackTotal>): Array<[string, PackTotal]> {
  return [...packTotals.entries()]
    .filter(([, v]) => v.fail > 0)
    .sort((a, b) => b[1].fail - a[1].fail);
}

/** 汇总文案分段：安装失败 / 失败包点名（超 MAX_NAMED_PACKS 截断）/ 覆盖点名 / 跳过阻塞超时 / 失败明细 */
function buildPushParts(accum: PushAccum, failedPacks: Array<[string, PackTotal]>): string[] {
  const parts: string[] = [];
  if (accum.installFail > 0) {
    parts.push(t("sidebar.pushInstallFail", { fail: accum.installFail, ok: accum.installOk }));
  }
  if (failedPacks.length > 0) {
    const named = failedPacks
      .slice(0, MAX_NAMED_PACKS)
      .map(([name, v]) => `${name}(${v.fail})`)
      .join("、");
    const more = failedPacks.length > MAX_NAMED_PACKS ? t("import.moreSuffix") : "";
    parts.push(
      t("sidebar.pushPackFailDetail", { n: failedPacks.length, names: `${named}${more}` }),
    );
  }
  // ADR-340-d2：批量推送覆盖实例侧手改是**已完成且不可逆**的动作，必须点名——没有这一段，
  // 用户只能从「推送完成」里读到一句自己没写过的话，而实例侧改了什么都无从知晓。
  if (accum.overwrites.size > 0) {
    const names = [...accum.overwrites].slice(0, MAX_NAMED_OVERWRITES).map(baseName).join("、");
    const more = accum.overwrites.size > MAX_NAMED_OVERWRITES ? t("import.moreSuffix") : "";
    parts.push(t("sidebar.pushOverwrote", { n: accum.overwrites.size, names: `${names}${more}` }));
  }
  if (accum.skipped > 0) parts.push(t("sidebar.packSkipped", { n: accum.skipped }));
  if (accum.blocked > 0) parts.push(t("sidebar.packBlocked", { n: accum.blocked }));
  if (accum.timedOut > 0) parts.push(t("sidebar.packTimedOutStopped", { n: accum.timedOut }));
  // P0 修复（2026-10-16 锐评）：点名被超时放弃的类型批次（不只报个数）
  if (accum.abortedTypes.length > 0)
    parts.push(
      t("sidebar.pushAbortedTypes", {
        n: accum.abortedTypes.length,
        names: accum.abortedTypes.join("、"),
      }),
    );
  // 失败明细点名（锐评 UX 高项收口）：光有「失败 3」用户无从下手，附前若干条缘由
  if (accum.errorDetails.length > 0) parts.push(accum.errorDetails.join("；"));
  return parts;
}

/** 推送结果三分反馈：有异常项 → warn 汇总（MS.normal）；仅覆盖/明细 → warn（MS.verbose）；全成 → success */
function showPushToast(accum: PushAccum, selectedCount: number, parts: string[]): void {
  if (accum.skipped > 0 || accum.blocked > 0 || accum.timedOut > 0 || accum.installFail > 0) {
    toast(t("sidebar.pushDone", { detail: parts.join("，") }), TOAST_MS.normal, "warn");
  } else if (accum.errorDetails.length > 0) {
    // 安装全成功但扫描缓存失效失败——用户仍需知情（装成功却等不到新模型是最困惑的反馈）
    toast(
      t("sidebar.pushDone", { detail: accum.errorDetails.join("；") }),
      TOAST_MS.verbose,
      "warn",
    );
  } else if (accum.overwrites.size > 0) {
    // 覆盖不是失败（推送确实按用户意图完成了），但**不可逆且伤到用户自己的改动**：
    // 绝不能躲进「推送完成：n 个整合包」的纯成功文案里（那正是锐评 P1-6 的病）。
    toast(t("sidebar.pushDone", { detail: parts.join("，") }), TOAST_MS.verbose, "warn");
  } else {
    toast(t("sidebar.pushDoneAll", { n: selectedCount }), TOAST_MS.info, "success");
  }
}

/** 推送主流程：按类型循环，每类型一次批量直调覆盖所有选中包（instanceNames）。
 *  原实现逐包×逐类型串行发事件，每事件触发一次全量状态扫描 → O(包×类型) 次 RPC；
 *  收敛为 O(类型) 次（ADR-310 性能修复 2026-10）；总线回执协议随 ADR-340 退役，
 *  结果 = downloadMissing 的 Promise 返回值（ok/fail 文件级计数、skipped 分类）。
 *  ⚠️ 超时即早停（ADR-340 重定义，治锐评 P1-2 级联）：binding 挂起是唯一超时成因，
 *  续发只会让剩余类型全部撞 busy 假跳过——break 终止循环并把超时如实计入。 */
export async function runPush(
  selected: string[],
  types: string[],
  pushBtn: HTMLButtonElement,
  lock: BusyLock,
  root: ShadowRoot,
): Promise<void> {
  const accum: PushAccum = {
    skipped: 0,
    blocked: 0,
    timedOut: 0,
    installOk: 0,
    installFail: 0,
    errorDetails: [],
    packTotals: new Map(),
    overwrites: new Set(),
    abortedTypes: [],
  };
  try {
    for (let ti = 0; ti < types.length; ti++) {
      const rt = types[ti];
      // P1-3：按类型显示进度（大批量推送不再只干等一个 spinner；按钮 disabled 态保持）
      pushBtn.innerHTML = `${UI_ICONS.refresh} ${t("sidebar.pushProgress", {
        i: ti + 1,
        n: types.length,
      })}`;
      try {
        // 一次直调推所有选中包（instanceNames 批量模式，handler 侧静默不弹结果 toast）
        const outcome = await withTimeout(
          downloadMissing({ instanceNames: selected, rtype: rt }),
          SYNC_OP_TIMEOUT_MS,
          `推送 ${rt}`,
        );
        absorbOutcome(outcome, accum);
      } catch (e) {
        if (e instanceof TimeoutError) {
          accum.timedOut++;
          // P0 修复（2026-10-16 锐评）：记录被放弃的类型批次（超时这一类 + 其后未跑的），
          // 收尾点名——原实现只计超时数，用户不知道哪些类型没做。
          accum.abortedTypes = types.slice(ti);
          break; // 早停：真实计数保留，未跑类型既非成功也非跳过
        }
        // downloadMissing 恒 settle 不 reject；走到这里 = 调用编排自身异常
        throw e;
      }
    }
    showPushToast(
      accum,
      selected.length,
      buildPushParts(accum, buildFailedPacks(accum.packTotals)),
    );
    // 变更明细浮层：把被 toast 截断的明细（覆盖清单/失败包/错误缘由）逐条点名，
    // 用户推送后能看到「到底改了哪些实例的哪些副本」，而非只剩一句计数摘要。
    // 逐文件点名：每包一行「包名: +N」汇总，下挂缩进文件行（每包上限 8 条防浮层无界膨胀，
    // 超出记「…另 N」；tpl 侧另有全清单 100 条总闸兜底）
    const packOkLines: string[] = [];
    for (const [name, v] of accum.packTotals) {
      if (v.ok === 0) continue;
      packOkLines.push(`${name}: +${v.ok}`);
      const shown = v.files.slice(0, MAX_PANEL_PACK_FILES);
      for (const f of shown) packOkLines.push(`  ${baseName(f)}`);
      if (v.files.length > shown.length)
        packOkLines.push(`  …${t("import.moreSuffix")}（${v.files.length - shown.length}）`);
    }
    const notices: string[] = [];
    if (accum.skipped > 0) notices.push(t("sidebar.packSkipped", { n: accum.skipped }));
    if (accum.blocked > 0) notices.push(t("sidebar.packBlocked", { n: accum.blocked }));
    if (accum.timedOut > 0) notices.push(t("sidebar.packTimedOutStopped", { n: accum.timedOut }));
    // P0 修复（2026-10-16 锐评）：面板点名被超时放弃的类型批次
    if (accum.abortedTypes.length > 0)
      notices.push(
        t("sidebar.pushAbortedTypes", {
          n: accum.abortedTypes.length,
          names: accum.abortedTypes.join("、"),
        }),
      );
    renderSyncResultPanel(root, {
      verb: "push",
      okCount: accum.installOk,
      failCount: accum.installFail,
      okFiles: packOkLines,
      failLines: accum.errorDetails,
      overwriteLines: [...accum.overwrites].map(baseName),
      notices,
    });
  } catch (err) {
    toast(t("sidebar.pushFailed", { msg: friendlyError(err) }), TOAST_MS.normal, "error");
  } finally {
    resetButton(pushBtn, "push");
    lock.finish(); // ADR-341：beginSync 抢的锁在此释放（push/pull 共用 _syncLock）
  }
}
