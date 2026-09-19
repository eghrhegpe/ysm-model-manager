// ===== 诊断页初始化（initDiagnosticsPage 的编排壳，经 _render → PAGE_REGISTRY 调用） =====
// ADR-040 按职责切文件：日志加载（logs.ts）/ 去重（dedup.ts）/ 冲突扫描（conflicts.ts）已拆出；
// 本文件保留 initDiagnostics 编排壳，并 re-export createDedupSession 保持外部 import 路径（./diagnostics/init.ts）不变

import { can } from "@/backend/capabilities.ts";
import { isViewerMode } from "@/backend/platform.ts";
import { bus } from "@/bus";
import { t } from "@/core/i18n/t.ts";
import { friendlyError } from "@/utils/dom/errors.ts";
import { TOAST_MS } from "@/utils/dom/toast-ms.ts";
import { backendGetApp } from "@/views/backend-deps.ts";
import { scanConflicts, scanSyncConflicts } from "./conflicts.ts";
import { copyWithToast } from "./copy-toast.ts";
import { runHealthAudit } from "./health.ts";
import { type EscFn, loadDiagnosticsLogs, loadRuntimeLogs } from "./logs.ts";
import { initPerfPanel } from "./perf.ts";

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

/** 当前日志子 tab 是否运行时日志（决定刷新/复制取哪个列表、清空是否可见） */
function dgInIsRuntimeLog(root: ShadowRoot): boolean {
  const active = root.querySelector(".diag-sub-tab.active") as HTMLElement | null;
  return active?.dataset.log === "runtime";
}

/** 切换日志子 tab（op / runtime）：显隐两个列表 + 控制清空按钮可见性 */
function dgInBindLogSubTabs(root: ShadowRoot, esc: EscFn): void {
  root.querySelectorAll(".diag-sub-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      root.querySelectorAll(".diag-sub-tab").forEach((b) => {
        b.classList.toggle("active", b === btn);
      });
      const isRuntime = (btn as HTMLElement).dataset.log === "runtime";
      const opList = root.getElementById("diag-log-list");
      const rtList = root.getElementById("diag-runtime-list");
      if (opList) opList.style.display = isRuntime ? "none" : "";
      if (rtList) rtList.style.display = isRuntime ? "" : "none";
      const clearBtn = root.getElementById("diag-clear");
      if (clearBtn) clearBtn.style.display = isRuntime ? "none" : "";
      if (isRuntime) loadRuntimeLogs(root, esc);
      else loadDiagnosticsLogs(root, esc);
    });
  });
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

function dgInBindScanBtns(root: ShadowRoot, esc: EscFn): void {
  root
    .getElementById("diag-scan-conflict")
    ?.addEventListener("click", () => scanConflicts(root, esc));
  root.getElementById("diag-scan-sync-conflict")?.addEventListener("click", () => {
    const list = root.getElementById("diag-sync-conflict-list");
    if (list) scanSyncConflicts(list, esc);
  });
  root.getElementById("diag-scan-health")?.addEventListener("click", async () => {
    const list = root.getElementById("diag-health-list");
    if (!list) return;
    await runHealthAudit(list, esc);
  });
}

/** 查看器/网页版：隐藏依赖 Go 本地能力或 CLI 的诊断 tab，避免“可见但不可用” */
function dgInHideDesktopOnly(root: ShadowRoot): void {
  if (!isViewerMode()) return;
  for (const tab of root.querySelectorAll<HTMLElement>(
    '.repo-tab[data-tab="conflict"], .repo-tab[data-tab="health"], .repo-tab[data-tab="sync-conflict"]',
  )) {
    tab.style.display = "none";
  }
  for (const id of [
    "diag-scan-conflict",
    "diag-scan-health",
    "diag-scan-sync-conflict",
    "diag-perf-run",
    "diag-perf-gui",
    "diag-perf-log",
    "diag-perf-refresh-trace",
    // ADR-262 D3：引擎对照同样靠 Go 扫描引擎，查看器/网页版一并隐藏
    "diag-perf-scan-bench",
  ]) {
    const el = root.getElementById(id);
    if (el) el.style.display = "none";
  }
}
function dgInBindLogFilter(root: ShadowRoot, esc: EscFn): void {
  root.querySelectorAll(".diag-log-fbtn").forEach((btn) => {
    btn.addEventListener("click", () => {
      root.querySelectorAll(".diag-log-fbtn").forEach((b) => {
        b.classList.remove("active");
      });
      btn.classList.add("active");
      // 状态 chips 只作用于操作日志（运行时日志无 Status，恒为 info）；运行时子 tab 下仅更新选中态，
      // 不回落拉操作日志列表——避免白跑一次 GetImportLogs（切回「操作」子 tab 时按新条件重载）。
      if (!dgInIsRuntimeLog(root)) loadDiagnosticsLogs(root, esc);
    });
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
 * 初始化诊断页所有功能
 * @param root - 组件 shadow root
 * @param esc - HTML 转义函数
 */
export function initDiagnostics(root: ShadowRoot, esc: EscFn): void {
  dgInHideDesktopOnly(root);
  dgInBindRefreshClear(root, esc);
  dgInBindCopyPanel(root);
  dgInBindCopyRows(root);
  dgInBindScanBtns(root, esc);
  initPerfPanel(root, esc);
  dgInBindLogSubTabs(root, esc);
  loadDiagnosticsLogs(root, esc);
  dgInBindLogFilter(root, esc);
  dgInBindLogSearch(root, esc);
}

/** 👴 资历最深 + 📊 仓库评分 + 🎲 每日推荐 + 热力图（已迁移到 features/maintenance/oldest-models.ts） */
