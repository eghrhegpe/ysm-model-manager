// ===== app-sidebar 同步流程层 =====
// 从 index.ts 拆出（P1-3）：勾选状态管理 + push/pull 同步执行链。
// index.ts 保留 Web Component 生命周期与渲染编排；本文件收敛「勾选 → 菜单 → 同步」全链。

import { bus } from "@/bus";
import { t } from "@/core/i18n/t.ts";
import { type DownloadOutcome, downloadMissing } from "@/features/sync/sync.ts";
import { SYNC_OP_TIMEOUT_MS } from "@/utils/async/sync-op-timeout.ts";
import { TimeoutError, withTimeout } from "@/utils/base/primitives/async.ts";
import type { BusyLock } from "@/utils/base/primitives/lock.ts";
import { initDropdown } from "@/utils/dom/dropdown.ts";
import { friendlyError } from "@/utils/dom/errors.ts";
import { toast } from "@/utils/dom/toast.ts";
import { TOAST_MS } from "@/utils/dom/toast-ms.ts";
import { UI_ICONS } from "@/utils/icon/ui-icons.ts";
import { ALL_RESOURCE_TYPES } from "@/utils/resource/types.ts";
import { backendGetApp } from "@/views/backend-deps.ts";
import { type SidebarInstance, SYNC_TYPE_ALL } from "./data.ts";
import { type SyncResultData, syncResultContentHTML } from "./tpl.ts";

// 持久化勾选状态（跨重新渲染保持），按 rtype 隔离避免类型切换串扰
// 通过 getter 注入实例属性，生命周期随组件（见 sync.test.ts）
function checkedSetFor(rtype: string, getCheckedSets: () => Map<string, Set<string>>): Set<string> {
  const checkedSets = getCheckedSets();
  let s = checkedSets.get(rtype);
  if (!s) {
    s = new Set<string>();
    checkedSets.set(rtype, s);
  }
  return s;
}

/** 同步 binding 兜底超时（唯一事实源在 `@/utils/async/sync-op-timeout.ts`，批D 起与
 *  面板行内链共用）：直调下唯一可能的「不收口」是 binding 永久挂起（Go 侧锁/扫描卡死）
 *  ——超时**即终止循环**并如实报告（ADR-340：原总线实现超时后续发下一类型，handler
 *  仍持锁 → 连锁 busy 假跳过，锐评 P1-2 级联；直调 await 天然串行，级联结构性消失，
 *  真挂起时早停是唯一诚实处置）。晚到的结果无人消费（Promise 已 settle 后二次结算为
 *  no-op），错误经 withTimeout 内 swallowError 兜底。 */

/** 失败明细汇总上限（锐评 UX 高项收口，2026-10-14）：各类型内部已限 3 条，
 *  跨类型再限一次防 15 类型累积成超长 toast。 */
const MAX_TOTAL_ERRORS = 5;

/** 失败包点名上限（P1-3）：「A(3)、B(1) 等」比一长串更有指导性 */
const MAX_NAMED_PACKS = 3;

/** 覆盖点名上限（ADR-340-d2）：与包点名同规——前几个足以让用户定位自己改过什么，
 *  全列会把 toast 撑爆（批量推送可覆盖上百个目标）。 */
const MAX_NAMED_OVERWRITES = 3;

/** 路径末段（**只切显示名**，不参与任何归属/类型判定——前端只读不判的红线只管语义，
 *  不管这点字符串处理；跨盘符/正反斜杠都切）。 */
function baseName(p: string): string {
  return p.split(/[\\/]/).pop() || p;
}

// ---------- bindSelectAll ----------
/**
 * 全选勾选框绑定（**只在 connectedCallback 绑一次**，故两个随渲染变化的值必须以
 * getter 注入而非按值捕获——2026-10 修复「全选跨 reload 蒸发」：原实现按值收
 * `rtype`/`instances`，绑定点在 connectedCallback，彼时 `_instances` 还是初始 `[]`，
 * 而 `_reload` 换的是**新数组引用**，捕获的旧引用永远是空数组 → `instances[idx]`
 * 恒 undefined → 全选只改 DOM、从未写入勾选集合，任何一次 reload 后选择即丢；
 * `rtype` 同理：按值捕获会在切换类型后把勾选写进旧类型的集合）。
 */
export function bindSelectAll(
  root: ShadowRoot,
  getRtype: () => string,
  getInstances: () => SidebarInstance[],
  getCheckedSets: () => Map<string, Set<string>>,
): void {
  const cb = root.getElementById("sb-select-all") as HTMLInputElement | null;
  if (!cb) return;
  cb.addEventListener("change", () => {
    const checked = cb.checked;
    const instances = getInstances();
    const set = checkedSetFor(getRtype(), getCheckedSets);
    root.querySelectorAll(".chk").forEach((c) => {
      const input = c as HTMLInputElement;
      input.checked = checked;
      const idx = parseInt(input.dataset.idx || "", 10);
      if (!Number.isNaN(idx) && instances[idx]) {
        if (checked) set.add(instances[idx].name);
        else set.delete(instances[idx].name);
      }
    });
  });
}

// ---------- pruneCheckedSets ----------
/** 修剪勾选集合里的**幽灵名**（P1 修复 2026-10 锐评）：集合按 rtype 存实例名，
 *  实例被删除后名字永远留在集合里——同名实例再现时会被静默勾选，集合也只涨不消。
 *  每次成功 reload 后按最新实例列表修剪。
 *  ⚠️ 保守口径：空列表**不修剪**——`loadInstances` 在 mcRoot 未配置时也返回 []，
 *  那不是「实例全被删了」，剪掉会丢用户的选择（失败态另有 renderLoadError 分流，
 *  根本不走到这里）。 */
export function pruneCheckedSets(
  rtype: string,
  instances: SidebarInstance[],
  getCheckedSets: () => Map<string, Set<string>>,
): void {
  const set = getCheckedSets().get(rtype);
  if (!set || set.size === 0) return;
  if (!instances.length) return;
  const live = new Set(instances.map((i) => i.name));
  set.forEach((name) => {
    if (!live.has(name)) set.delete(name);
  });
}

// ---------- restoreCheckboxes ----------
export function restoreCheckboxes(
  root: ShadowRoot,
  rtype: string,
  instances: SidebarInstance[],
  getCheckedSets: () => Map<string, Set<string>>,
): void {
  const set = checkedSetFor(rtype, getCheckedSets);
  // 恢复勾选状态（从实例属性 checkedSets 读取，支持跨重新挂载恢复）
  root.querySelectorAll(".chk").forEach((c) => {
    const input = c as HTMLInputElement;
    const idx = parseInt(input.dataset.idx || "", 10);
    if (!Number.isNaN(idx) && instances[idx]) {
      input.checked = set.has(instances[idx].name);
      input.addEventListener("change", () => {
        if (input.checked) set.add(instances[idx].name);
        else set.delete(instances[idx].name);
      });
    }
  });
}

// ---------- closeAllMenus ----------
/** 程序化收起两个同步下拉：统一走 dropdown 控制器句柄的 .close()（幂等：已关 no-op，
 *  状态/ARIA 单源留在控制器内——2026-09 收口：原实现手改 display:none + 重置 aria-expanded，
 *  绕过控制器留了状态脱钩后门，ADR-298 D3「收起全权交通用控制器」的漏网，已退役）。
 *  焦点归还不归本函数管：菜单项点击路径的收起已由控制器 onMenuClick close(restoreFocus) 完成。 */
function closeAllMenus(pushClose: () => void, pullClose: () => void): void {
  pushClose();
  pullClose();
}

// ---------- getSelected ----------
function getSelected(root: ShadowRoot, instances: SidebarInstance[]): string[] {
  const sel: string[] = [];
  root.querySelectorAll(".chk:checked").forEach((c) => {
    const input = c as HTMLInputElement;
    const idx = parseInt(input.dataset.idx || "", 10);
    if (!Number.isNaN(idx) && instances[idx]) sel.push(instances[idx].name);
  });
  return sel;
}

// ---------- resolveTypes ----------
function resolveTypes(rt: string): string[] {
  return rt === SYNC_TYPE_ALL ? ALL_RESOURCE_TYPES : [rt];
}

/**
 * beginSync：推送/拉取入闸流程（判空 toast → 原子抢锁 → 关菜单 → 按钮 loading）。
 * `.dd-item` 的定位与 `data-sync-type` 读取都由调用方完成（2026-10 锐评收口：原先本函数与
 * handleSyncMenuClick 各自 `closest(".dd-item")` 一次，同一 target 查两遍）。
 */
function beginSync(
  verb: string,
  root: ShadowRoot,
  instances: SidebarInstance[],
  lock: BusyLock,
  closeAllMenus: () => void,
  btn: HTMLButtonElement,
): string[] | null {
  const selected = getSelected(root, instances);
  if (!selected.length) {
    toast(t("sidebar.selectPackFirst", { verb }), TOAST_MS.success, "info");
    return null;
  }
  // ADR-341 归一：tryStart 原子抢锁（判空提示在前——顺序语义与原实现一致：
  // 空选择在先、busy 拒收在后）。
  // 批D 修正：原实现 busy 时静默 return，注释称「按钮 loading 态就是可见反馈」——
  // 但 loading 赋值发生在本 return **之后**，且锁是 push/pull **共用**的：点另一个按钮
  // 时那个按钮根本不会进 loading，用户只看到「点了没反应」。更糟的是拉取侧原先没有
  // 超时（binding 挂起会把锁永久占住），静默拒收会让整个同步入口看起来彻底坏掉。
  // 故改为如实提示（toast 是唯一能覆盖「两个按钮 + 共用锁」的反馈面）。
  if (!lock.tryStart()) {
    toast(t("sidebar.syncBusy", { verb }), TOAST_MS.normal, "info");
    return null;
  }
  closeAllMenus();
  btn.innerHTML = UI_ICONS.refresh;
  btn.disabled = true;
  return selected;
}

// ---------- 公共类型 / 工具 ----------

type SyncVerb = "push" | "pull";

/** 按钮复位（push/pull finally 块共用）。▾ 指示符由 dropdownBaseCSS 的
 *  `.dd-wrap > button::after` 单源生成（ADR-238），此处不再手拼——手拼会双箭头 */
function resetButton(btn: HTMLButtonElement, verb: SyncVerb): void {
  const iconSvg = verb === "push" ? UI_ICONS.upload : UI_ICONS.download;
  const key = verb === "push" ? "sidebar.pushSelected" : "sidebar.pullSelected";
  btn.innerHTML = `${iconSvg} ${t(key)}`;
  btn.disabled = false;
}

// ---------- handleSyncMenuClick（push/handler 合并） ----------

function handleSyncMenuClick(
  verb: SyncVerb,
  e: Event,
  btn: HTMLButtonElement,
  closeAll: () => void,
  root: ShadowRoot,
  getInstances: () => SidebarInstance[],
  lock: BusyLock,
): void {
  // 命中判定与 syncType 读取都只需要一次 closest（原实现 beginSync 内一次、此处又一次）
  const ddItem = (e.target as HTMLElement | null)?.closest(".dd-item");
  if (!ddItem) return;
  const selected = beginSync(
    verb === "push" ? t("sidebar.verbPush") : t("sidebar.verbPull"),
    root,
    getInstances(),
    lock,
    closeAll,
    btn,
  );
  if (!selected) return;
  const types = resolveTypes((ddItem as HTMLElement).dataset.syncType || SYNC_TYPE_ALL);
  if (verb === "push") {
    void runPush(selected, types, btn, lock, root);
  } else {
    void runPull(selected, types, btn, lock, root);
  }
}

/** 推送累计态：文件级计数 + 失败明细 + 包级归因 + 覆盖清单 + skipped 分流 */
interface PushAccum {
  skipped: number;
  blocked: number;
  timedOut: number;
  installOk: number;
  installFail: number;
  errorDetails: string[];
  packTotals: Map<string, { ok: number; fail: number }>;
  /** 本次推送**覆盖实例侧已修改副本**的目标路径（ADR-340-d2；Set 去重，
   *  跨类型/跨包同路径只算一次——覆盖是磁盘事实，不是批次事实） */
  overwrites: Set<string>;
}

/** 单类型批次结果归并：文件级计数 + 失败明细（限 MAX_TOTAL_ERRORS）+ 包级累加 + 覆盖清单 + skipped 归因分流 */
function absorbOutcome(outcome: DownloadOutcome, accum: PushAccum): void {
  accum.installOk += outcome.ok;
  accum.installFail += outcome.fail;
  for (const msg of outcome.errors ?? []) {
    if (accum.errorDetails.length < MAX_TOTAL_ERRORS) accum.errorDetails.push(msg);
  }
  for (const p of outcome.packs ?? []) {
    const cur = accum.packTotals.get(p.name) ?? { ok: 0, fail: 0 };
    cur.ok += p.ok;
    cur.fail += p.fail;
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
function buildFailedPacks(
  packTotals: Map<string, { ok: number; fail: number }>,
): Array<[string, { ok: number; fail: number }]> {
  return [...packTotals.entries()]
    .filter(([, v]) => v.fail > 0)
    .sort((a, b) => b[1].fail - a[1].fail);
}

/** 汇总文案分段：安装失败 / 失败包点名（超 MAX_NAMED_PACKS 截断）/ 覆盖点名 / 跳过阻塞超时 / 失败明细 */
function buildPushParts(
  accum: PushAccum,
  failedPacks: Array<[string, { ok: number; fail: number }]>,
): string[] {
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
async function runPush(
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
    const packOkLines = [...accum.packTotals.entries()]
      .filter(([, v]) => v.ok > 0)
      .map(([name, v]) => `${name}: +${v.ok}`);
    const notices: string[] = [];
    if (accum.skipped > 0) notices.push(t("sidebar.packSkipped", { n: accum.skipped }));
    if (accum.blocked > 0) notices.push(t("sidebar.packBlocked", { n: accum.blocked }));
    if (accum.timedOut > 0) notices.push(t("sidebar.packTimedOutStopped", { n: accum.timedOut }));
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

/** 拉取主流程：并行拉取各类型资源，计数成功/失败 → 汇总 toast + 刷新统计与树。
 *  ⚠️ 每个整合包一次 withTimeout（批D：原实现**完全无超时**）——binding 挂起会让
 *  `Promise.allSettled` 永不 settle → await 不返回 → finally 不执行 → `_syncLock` 被
 *  **永久占住**，此后所有推送/拉取都被 beginSync 拒收（那条路此前还是静默的）。
 *  超时语义与推送**同口径**（ADR-340：直调下唯一的不收口成因就是 binding 挂起，
 *  续发只会让后续整合包全撞挂起）：早停循环 + 如实计入 timedOut。 */
/** 拉取计数累积器 */
interface PullCounters {
  totalPulled: number;
  failed: number;
  timedOut: number;
  firstError: string;
  /** 成功拉取的文件/目录相对路径清单（逐实例逐类型聚合，供浮层点名） */
  files: string[];
}

/** 汇总一批整合包的结果（批D P1-5：绑定改结构化 `PullSyncResult`——条目级失败不再走 reject，
 *  成功计数不会在途中丢失；reject 只剩前置不满足，如实按「一个类型批次失败」计入） */
function accumulatePullResults(
  results: PromiseSettledResult<{
    ok: number;
    failed: number;
    firstError?: string | null;
    files?: string[] | null;
  }>[],
  counters: PullCounters,
): void {
  for (const r of results) {
    if (r.status === "fulfilled") {
      counters.totalPulled += r.value.ok;
      counters.failed += r.value.failed;
      if (r.value.files) counters.files.push(...r.value.files);
      if (r.value.firstError && !counters.firstError) counters.firstError = r.value.firstError;
    } else {
      counters.failed++;
      if (!counters.firstError) counters.firstError = friendlyError(r.reason);
    }
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

// ---------- 同步变更明细浮层（2026-10-15 UX 补） ----------
// 设计：toast 只给计数摘要；明细走 sidebar shadow 内持久浮层，可滚动、可关闭、
// 点击遮罩空白/ESC 关闭。内容由 runPush/runPull 收尾注入。重渲染（_renderLayout）
// 会重建容器回 hidden 态，故无需在 disconnectedCallback 单独清理。
// ESC 监听挂在 document（浮层覆盖侧栏、焦点未必在面板内），用模块级 escHandler
// 跟踪以便在关闭时精确 remove，避免每次同步叠加匿名监听泄漏。

/** ESC 关闭句柄（模块级跟踪，closeSyncResultPanel 时移除） */
let escHandler: ((e: KeyboardEvent) => void) | null = null;

/** 注入并展示同步变更明细浮层（先清旧监听再建新，天然幂等） */
function renderSyncResultPanel(root: ShadowRoot, data: SyncResultData): void {
  closeSyncResultPanel(root); // 清旧 ESC/点击监听 + 重置容器
  const panel = root.getElementById("sync-result-panel");
  if (!panel) return;
  panel.innerHTML = syncResultContentHTML(data);
  panel.hidden = false;
  // 打开即把焦点移到关闭按钮（键盘可达性：焦点落在界面上，Enter/Tab 可继续操作）
  panel.querySelector<HTMLButtonElement>("[data-sync-result-close]")?.focus();
  // 事件委托：点关闭按钮或点面板自身空白（target 即 panel，bottom-sheet 无全屏遮罩）即关闭；点明细列表不关
  panel.onclick = (e: MouseEvent) => {
    const tgt = e.target as HTMLElement;
    if (tgt.closest("[data-sync-result-close]") || tgt === panel) {
      closeSyncResultPanel(root);
    }
  };
  escHandler = (e: KeyboardEvent) => {
    if (e.key === "Escape") closeSyncResultPanel(root);
  };
  document.addEventListener("keydown", escHandler);
}

/** 关闭浮层（保留容器，下次 push/pull 复用；精确移除 ESC 监听防泄漏） */
function closeSyncResultPanel(root: ShadowRoot): void {
  if (escHandler) {
    document.removeEventListener("keydown", escHandler);
    escHandler = null;
  }
  const panel = root.getElementById("sync-result-panel");
  if (!panel) return;
  panel.hidden = true;
  panel.innerHTML = "";
  panel.onclick = null;
}

async function runPull(
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
      try {
        const results = await withTimeout(
          Promise.allSettled(types.map((rt) => PullResourceFromInstance(rt, insName))),
          SYNC_OP_TIMEOUT_MS,
          `拉取 ${insName}`,
        );
        accumulatePullResults(results, counters);
      } catch (e) {
        if (e instanceof TimeoutError) {
          counters.timedOut++;
          break; // 早停：真实计数保留，未跑整合包既非成功也非失败
        }
        throw e;
      }
    }
    notifyPullOutcome(counters);
    // 变更明细浮层：拉取后用户能看到「从各整合包拉回了哪些文件」，而非只剩计数摘要。
    const notices: string[] = [];
    if (counters.timedOut > 0)
      notices.push(t("sidebar.pullTimedOutStopped", { n: counters.timedOut }));
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

// ---------- bindSyncSelected 主装配 ----------
export function bindSyncSelected(
  root: ShadowRoot,
  getInstances: () => SidebarInstance[],
  /** 下拉控制器 dispose 的归集口（替代原 docClick 单槽存取器对，ADR-298 D3） */
  setDropdownCleanup: (fn: () => void) => void,
  /** 同步在途互斥锁（ADR-341 归一：原 `{ get, set }` 访问器对退役，组件直传 BusyLock） */
  syncLock: BusyLock,
): void {
  const pushBtn = root.querySelector(".sidebar-push-selected") as HTMLButtonElement | null;
  const pushMenu = root.getElementById("sidebar-push-menu");
  const pullBtn = root.querySelector(".sidebar-pull-selected") as HTMLButtonElement | null;
  const pullMenu = root.getElementById("sidebar-pull-menu");
  if (!pushBtn || !pushMenu || !pullBtn || !pullMenu) return;

  // ADR-298 D3：展开/收起/ARIA/键盘/外点关闭/互斥全权交通用控制器——
  // 替代原 bindToggleMenu（手写 display 开关）+ 模块级 document-click 单槽 hack
  // （后者靠 _docClickHandler 存取器传递，且 aria 状态与 display 脱钩）。
  const pushWrap = pushMenu.closest(".dd-wrap") as HTMLElement | null;
  const pullWrap = pullMenu.closest(".dd-wrap") as HTMLElement | null;
  const disposePush = initDropdown(pushWrap);
  const disposePull = initDropdown(pullWrap);
  setDropdownCleanup(() => {
    disposePush();
    disposePull();
  });
  // 程序化收起统一走控制器句柄（closeAllMenus 见上方）：不再手改 display / aria-expanded
  const closeAllMenusBoth = (): void => closeAllMenus(disposePush.close, disposePull.close);

  pushMenu.addEventListener("click", (e) =>
    handleSyncMenuClick("push", e, pushBtn, closeAllMenusBoth, root, getInstances, syncLock),
  );
  pullMenu.addEventListener("click", (e) =>
    handleSyncMenuClick("pull", e, pullBtn, closeAllMenusBoth, root, getInstances, syncLock),
  );
}
