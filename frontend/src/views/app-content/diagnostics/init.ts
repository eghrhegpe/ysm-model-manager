// ===== 诊断页初始化（initDiagnosticsPage 的编排壳，经 _render → PAGE_REGISTRY 调用） =====
// ADR-040 按职责切文件：日志加载（logs.ts）/ 去重（dedup.ts）/ 冲突扫描（conflicts.ts）已拆出；
// 本文件保留 initDiagnostics 编排壳，并 re-export createDedupSession 保持外部 import 路径（./diagnostics/init.ts）不变

import { can } from "@/backend/capabilities.ts";
import { bus } from "@/bus";
import { t } from "@/core/i18n/t.ts";
import { friendlyError } from "@/utils/dom/errors.ts";
import { TOAST_MS } from "@/utils/dom/toast-ms.ts";
import { bindSubBar } from "@/views/app-content/tabs-shell.ts";
import { backendGetApp } from "@/views/backend-deps.ts";
import { initSyncConflictPanel } from "./conflicts.ts";
import { copyWithToast } from "./copy-toast.ts";
import { initHealthPanel } from "./health.ts";
import { type EscFn, loadDiagnosticsLogs, loadRuntimeLogs } from "./logs.ts";
import { applyPerfModeUI, initPerfPanel, renderLoadTraceSection } from "./perf.ts";

// 对外 API 兼容：createDedupSession 已迁至 dedup.ts（外部仍从本文件 import，见 init-pages.ts / init.test.ts）
export { createDedupSession } from "./dedup.ts";

function dgInBindRefreshClear(root: ShadowRoot, esc: EscFn): void {
  root.getElementById("diag-refresh")?.addEventListener("click", () => {
    if (dgInIsRuntimeLog(root)) loadRuntimeLogs(root, esc);
    else loadDiagnosticsLogs(root, esc);
  });
  root.getElementById("diag-clear")?.addEventListener("click", async () => {
    if (!can("ClearImportLogs")) {
      bus.emit("toast:show", {
        msg: t("diagnostics.webNoClearLogs"),
        duration: TOAST_MS.normal,
        type: "warn",
      });
      return;
    }
    try {
      const { ClearImportLogs } = await backendGetApp();
      await ClearImportLogs();
      loadDiagnosticsLogs(root, esc);
      bus.emit("toast:show", {
        msg: `🗑️ ${t("diagnostics.logsCleared")}`,
        duration: TOAST_MS.success,
        type: "info",
      });
    } catch (e) {
      bus.emit("toast:show", {
        msg: `❌ ${friendlyError(e, t("diagnostics.clearFailed"))}`,
        duration: TOAST_MS.verbose,
        type: "error",
      });
    }
  });
}

/** 日志组当前激活子屏（op / runtime / trace）。
 *  ⚠️ 读取**限定在 logs 组 pill 行内**——ADR-300 §2.2 后 .diag-sub-tab 是三组共享类，
 *  全局查第一个 .active 会串线到 bench/audit 组（原 data-log 私有属性随单点语法退役）。 */
function dgInLogsActiveSub(root: ShadowRoot): string {
  const active = root.querySelector<HTMLElement>(
    '.diag-sub-bar[data-sub-bar="logs"] .diag-sub-tab.active',
  );
  return active?.dataset.sub ?? "op";
}

/** 当前日志子屏是否运行时日志（决定刷新/复制取哪个列表；清空可见性已声明进 data-sub-pane="op"） */
function dgInIsRuntimeLog(root: ShadowRoot): boolean {
  return dgInLogsActiveSub(root) === "runtime";
}

/**
 * 三组子 pill 接线（ADR-300 §2.2 单点语法）：显隐机制在 bindSubBar（tabs-shell），
 * 这里只登记各组激活副作用——
 *  - logs：切屏即拉数据（进屏即渲染，与 trace 的进入语义同口径）；
 *  - bench：模式源已收口 data-active-sub，切 pill = 重放行门控/门禁/标签（applyPerfModeUI）；
 *  - audit：纯显隐（两段式面板各自 init 常驻，无需副作用）。
 */
function dgInBindSubBars(root: ShadowRoot, esc: EscFn): void {
  bindSubBar(root, "logs", (id) => {
    if (id === "runtime") loadRuntimeLogs(root, esc);
    else if (id === "trace") renderLoadTraceSection(root, esc);
    else loadDiagnosticsLogs(root, esc);
  });
  bindSubBar(root, "bench", () => applyPerfModeUI(root));
  bindSubBar(root, "audit");
}

/** 复制当前激活日志列表文本（op / runtime 二选一） */
function dgInCopyActiveLog(root: ShadowRoot): void {
  const list = root.getElementById(dgInIsRuntimeLog(root) ? "diag-runtime-list" : "diag-log-list");
  const clone = list?.cloneNode(true) as HTMLElement | null;
  clone?.querySelectorAll(".log-copy").forEach((b) => {
    b.remove();
  });
  // 空态/错误态（列表内没有任何 .log-row）不得被当成日志复制：那行是占位文案
  // （「暂无日志」/「无匹配日志」/「加载失败」），照抄并弹「已复制」= 复制了一段假日志。
  // 2026-09 实测：noLogsToCopy 兜底因占位文案非空而生产不可达（只有列表元素整个缺失才走到）。
  const rows = clone?.querySelectorAll(".log-row");
  const text = rows && rows.length > 0 ? (clone?.textContent ?? "").trim() : "";
  if (!text) {
    bus.emit("toast:show", {
      msg: `📋 ${t("diagnostics.noLogsToCopy")}`,
      duration: TOAST_MS.success,
      type: "info",
    });
    return;
  }
  // 曾经这里无条件弹「已复制」，而 catch 里的降级本身也会失败——失败时界面在撒谎。
  // 现在回执由 copyWithToast 按 copyText 的真实结果给（整份日志带隐私提示）。
  void copyWithToast(text, "diagnostics.copiedLogPrivacy");
}
function dgInBindCopyPanel(root: ShadowRoot): void {
  root.getElementById("diag-copy")?.addEventListener("click", () => dgInCopyActiveLog(root));
}

function dgInCopyRowLog(row: HTMLElement): void {
  const msgEl = row.querySelector<HTMLElement>(".log-msg");
  const text = (msgEl?.textContent ?? "").trim();
  if (!text) return;
  // 单行日志仍用不带隐私提示的文案（复制一行与复制整份日志的暴露面不同，保持既有措辞）；
  // 失败分支原先还标成 success 类型——那是把失败画成成功，现已随单点消失。
  void copyWithToast(text, "diagnostics.copiedLog");
}

function dgInBindCopyRows(root: ShadowRoot): void {
  ["diag-log-list", "diag-runtime-list"].forEach((listId) => {
    root.getElementById(listId)?.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>(".log-copy");
      if (!btn) return;
      const row = btn.closest<HTMLElement>(".log-row");
      if (row) dgInCopyRowLog(row);
    });
  });
}

/**
 * 初始化两个只读扫描的**常驻参数栏**（ADR-288 D2/D3）：进 tab 即有参数与按钮，
 * 扫描仍显式点击触发（「进 tab 不跑进程」口径不变，ADR-278 §2.5）。
 * 栏与结果区是两段式——结果只写结果区，按钮不再住在结果容器内（旧形态的 dead-end 见 ADR-288 §1）。
 * sync-conflict 栏为异步：读配置 + 列实例（两次轻量 Go 读，与 log tab 进即 GetImportLogs 同级）；
 * 失败/不可用态由该函数内部落结果区 + 禁用按钮，故此处 void 调用。
 */
function dgInInitScanPanels(root: ShadowRoot, esc: EscFn): void {
  void initSyncConflictPanel(
    root.getElementById("diag-sync-bar"),
    root.getElementById("diag-sync-conflict-list"),
    esc,
  );
  initHealthPanel(
    root.getElementById("diag-health-bar"),
    root.getElementById("diag-health-list"),
    esc,
  );
}

function dgInBindLogFilter(root: ShadowRoot, esc: EscFn): void {
  root.querySelectorAll(".diag-log-fbtn").forEach((btn) => {
    btn.addEventListener("click", () => {
      root.querySelectorAll(".diag-log-fbtn").forEach((b) => {
        b.classList.remove("active");
      });
      btn.classList.add("active");
      // ADR-289：运行时日志的 Level 已由 Go 捕获层推断，chips 在运行时子 tab 下也**真正生效**
      // （此前无 Status 可筛，点击只更新选中态）。两个分支都只重渲染当前子 tab 的列表，
      // 互不回落拉取对方的日志（运行时子 tab 永不触发 GetImportLogs）。
      if (dgInIsRuntimeLog(root)) loadRuntimeLogs(root, esc);
      else loadDiagnosticsLogs(root, esc);
    });
  });
}

/**
 * 操作类型（纵向）筛选下拉：与状态 chips（横向）正交叠加，二者 AND 交集。
 * 与 chips 同口径——只作用于操作日志，运行时子 tab 下仅更新选中态、不回落拉列表。
 */
function dgInBindLogOpFilter(root: ShadowRoot, esc: EscFn): void {
  const sel = root.getElementById("diag-log-op-filter") as HTMLSelectElement | null;
  if (!sel) return;
  sel.addEventListener("change", () => {
    if (!dgInIsRuntimeLog(root)) loadDiagnosticsLogs(root, esc);
  });
}

function dgInBindLogSearch(root: ShadowRoot, esc: EscFn): void {
  const logSearch = root.getElementById("diag-log-search") as HTMLInputElement | null;
  if (logSearch) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    logSearch.addEventListener("input", () => {
      clearTimeout(timer);
      // 搜索按当前子 tab 分派：操作日志匹配模型名/报错/路径/操作，运行时日志匹配 Message
      timer = setTimeout(() => {
        if (dgInIsRuntimeLog(root)) loadRuntimeLogs(root, esc);
        else loadDiagnosticsLogs(root, esc);
      }, 300);
    });
  }
}

/**
 * trace 面板的**进入语义**（2026-09 补齐）：进 tab 即渲染，不要求用户先手点刷新。
 *
 * 为什么不登记进 `bindTabs` 的 `TAB_INIT` 懒加载表：那张表是「**首次**切换只跑一次」语义
 * （`if (!inited[tab] && tab !== ids[0])`），而加载剖析的数据由 3D 适配器**随时**写入内存 store
 * （`getLoadTraces()`），用户每次从 3D 预览回来都该看到**最新**的一份。
 * 不这么做的后果（2026-09 实测）：该面板是裸空 div，唯一提示写着「加载模型后自动记录，点击刷新
 * 查看」——用户得先去 3D 预览转一圈、再回本页手点刷新，才看得到自己刚触发的加载开销。
 */
function dgInBindTraceTab(root: ShadowRoot, esc: EscFn): void {
  // 初始化即渲染：语言切换重建面板后同样能恢复（本函数由 initDiagnostics 统一调用）
  renderLoadTraceSection(root, esc);
  // ADR-300 §2.6 红线：record 降级为 logs 组第三 pill 后，原 `.repo-tab[data-tab="record"]`
  // 选择器会 optional-chain 成静默失灵。pill 内的进入重渲染已归 bindSubBar("logs") 的
  // onSwitch；这里承接的是另一半——trace 已选中时再点 logs 顶层 tab（数据在背后被 3D 预览
  // 刷新过，重进要看得到最新一份）。
  root.querySelector<HTMLElement>('.repo-tab[data-tab="logs"]')?.addEventListener("click", () => {
    if (dgInLogsActiveSub(root) === "trace") renderLoadTraceSection(root, esc);
  });
}

/**
 * 初始化诊断页所有功能
 * @param root - 组件 shadow root
 * @param esc - HTML 转义函数
 */

export function initDiagnostics(root: ShadowRoot, esc: EscFn): void {
  dgInBindRefreshClear(root, esc);
  dgInBindCopyPanel(root);
  dgInBindCopyRows(root);
  dgInInitScanPanels(root, esc);
  initPerfPanel(root, esc);
  dgInBindTraceTab(root, esc);
  dgInBindSubBars(root, esc);
  loadDiagnosticsLogs(root, esc);
  dgInBindLogFilter(root, esc);
  dgInBindLogOpFilter(root, esc);
  dgInBindLogSearch(root, esc);
}

/** 👴 资历最深 + 📊 仓库评分 + 🎲 每日推荐 + 热力图（已迁移到 features/maintenance/oldest-models.ts） */
