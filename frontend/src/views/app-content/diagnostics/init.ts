// ===== 诊断页初始化（为 _initDiagnostics 减负） =====
// ADR-040 按职责切文件：日志加载（logs.ts）/ 去重（dedup.ts）/ 冲突扫描（conflicts.ts）已拆出；
// 本文件保留 initDiagnostics 编排壳，并 re-export startDedup 保持外部 import 路径（./diagnostics/init.ts）不变
import { TOAST_MS } from "../../../utils/dom/toast-ms.ts";
import { t } from "../../../core/i18n/t.ts";
import { bus } from "../../../bus.ts";
import { getApp } from "../../../backend/app.ts";
import { can } from "../../../utils/dom/capabilities.ts";
import { friendlyError } from "../../../utils/dom/errors.ts";
import { loadDiagnosticsLogs, loadRuntimeLogs, type EscFn } from "./logs.ts";
import { scanConflicts, scanSyncConflicts } from "./conflicts.ts";
import { initPerfPanel, renderLoadTraceSection } from "./perf.ts";
import { runHealthAudit } from "./health.ts";

// 对外 API 兼容：startDedup 已迁至 dedup.ts（外部仍从本文件 import，见 init-pages.ts / init.test.ts）
export { startDedup, getDedupConfig, resetDedupConfig } from "./dedup.ts";

function dgInCopyTextFallback(text: string): void {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  document.execCommand("copy");
  document.body.removeChild(ta);
}

function dgInBindRefreshClear(root: ShadowRoot, esc: EscFn): void {
  root
    .getElementById("diag-refresh")
    ?.addEventListener("click", () => {
      const active = root.querySelector(".diag-btn[data-diag].active") as HTMLElement | null;
      const name = active?.dataset.diag;
      if (name === "runtime") loadRuntimeLogs(root, esc);
      else loadDiagnosticsLogs(root, esc);
    });
  root.getElementById("diag-clear")?.addEventListener("click", async () => {
    if (!can("ClearImportLogs")) {
      bus.emit("toast:show", {
        msg: "网页版不支持清除日志",
        duration: TOAST_MS.normal,
        type: "warn",
      });
      return;
    }
    try {
      const { ClearImportLogs } = await getApp();
      await ClearImportLogs();
      loadDiagnosticsLogs(root, esc);
      bus.emit("toast:show", {
        msg: "🗑️ " + t("diagnostics.logsCleared"),
        duration: TOAST_MS.success,
        type: "info",
      });
    } catch (e) {
      bus.emit("toast:show", {
        msg: "❌ " + friendlyError(e, t("diagnostics.clearFailed")),
        duration: TOAST_MS.verbose,
        type: "error",
      });
    }
  });
}

function dgInBindCopyPanel(root: ShadowRoot): void {
  root.getElementById("diag-copy")?.addEventListener("click", async () => {
    const active = root.querySelector(".diag-btn[data-diag].active") as HTMLElement | null;
    const name = active?.dataset.diag ?? "log";
    const list = root.getElementById(`diag-${name}`) as HTMLElement | null;
    const clone = list?.cloneNode(true) as HTMLElement | null;
    clone?.querySelectorAll(".log-copy").forEach((b) => b.remove());
    const text = (clone?.textContent ?? "").trim();
    if (!text) {
      bus.emit("toast:show", {
        msg: "📋 当前无日志可复制",
        duration: TOAST_MS.success,
        type: "info",
      });
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      dgInCopyTextFallback(text);
    }
    bus.emit("toast:show", {
      msg: "📋 " + t("diagnostics.copiedLogPrivacy"),
      duration: TOAST_MS.normal,
      type: "info",
    });
  });
}

function dgInCopyRowLog(row: HTMLElement): void {
  const msgEl = row.querySelector<HTMLElement>(".log-msg");
  const text = (msgEl?.textContent ?? "").trim();
  if (!text) return;
  navigator.clipboard
    .writeText(text)
    .then(() => {
      bus.emit("toast:show", {
        msg: "📋 " + t("diagnostics.copiedLogPrivacy"),
        duration: TOAST_MS.normal,
        type: "info",
      });
    })
    .catch(() => {
      dgInCopyTextFallback(text);
      bus.emit("toast:show", {
        msg: "📋 " + t("diagnostics.copiedLog"),
        duration: TOAST_MS.success,
        type: "success",
      });
    });
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
  root
    .getElementById("diag-scan-sync-conflict")
    ?.addEventListener("click", () => {
      const list = root.getElementById("diag-sync-conflict-list") as HTMLElement | null;
      if (list) scanSyncConflicts(list, esc);
    });
  root.getElementById("diag-scan-health")?.addEventListener("click", async () => {
    const list = root.getElementById("diag-health-list") as HTMLElement | null;
    if (!list) return;
    await runHealthAudit(list, esc);
  });
}

function dgInBindTabSwitcher(root: ShadowRoot, esc: EscFn): void {
  root.querySelectorAll(".diag-btn[data-diag]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const name = (btn as HTMLElement).dataset.diag;
      root
        .querySelectorAll(".diag-btn[data-diag]")
        .forEach((b) => b.classList.toggle("active", b === btn));
      const logPanel = root.getElementById("diag-log") as HTMLElement | null;
      const runtimePanel = root.getElementById("diag-runtime") as HTMLElement | null;
      const conflictPanel = root.getElementById("diag-conflict") as HTMLElement | null;
      const perfPanel = root.getElementById("diag-perf") as HTMLElement | null;
      const healthPanel = root.getElementById("diag-health") as HTMLElement | null;
      const syncConflictPanel = root.getElementById("diag-sync-conflict") as HTMLElement | null;
      if (logPanel) logPanel.style.display = name === "log" ? "" : "none";
      if (runtimePanel) runtimePanel.style.display = name === "runtime" ? "" : "none";
      if (conflictPanel) conflictPanel.style.display = name === "conflict" ? "" : "none";
      if (perfPanel) perfPanel.style.display = name === "perf" ? "" : "none";
      if (healthPanel) healthPanel.style.display = name === "health" ? "" : "none";
      if (syncConflictPanel) syncConflictPanel.style.display = name === "sync-conflict" ? "" : "none";
      const activePanel =
        name === "log" ? logPanel : name === "runtime" ? runtimePanel : name === "conflict" ? conflictPanel : name === "perf" ? perfPanel : name === "health" ? healthPanel : syncConflictPanel;
      if (activePanel) {
        activePanel.style.animation = "none";
        void activePanel.offsetHeight;
        activePanel.style.animation = "";
      }
      if (name === "log") loadDiagnosticsLogs(root, esc);
      if (name === "runtime") loadRuntimeLogs(root, esc);
      if (name === "perf") renderLoadTraceSection(root, esc);
    });
  });
}

function dgInBindLogFilter(root: ShadowRoot, esc: EscFn): void {
  root.querySelectorAll(".diag-log-fbtn").forEach((btn) => {
    btn.addEventListener("click", () => {
      root
        .querySelectorAll(".diag-log-fbtn")
        .forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      loadDiagnosticsLogs(root, esc);
    });
  });
}

function dgInBindLogSearch(root: ShadowRoot, esc: EscFn): void {
  const logSearch = root.getElementById("diag-log-search") as HTMLInputElement | null;
  if (logSearch) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    logSearch.addEventListener("input", () => {
      clearTimeout(timer);
      timer = setTimeout(() => loadDiagnosticsLogs(root, esc), 300);
    });
  }
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
  dgInBindScanBtns(root, esc);
  initPerfPanel(root, esc);
  dgInBindTabSwitcher(root, esc);
  loadDiagnosticsLogs(root, esc);
  dgInBindLogFilter(root, esc);
  dgInBindLogSearch(root, esc);
}

/** 👴 资历最深 + 📊 仓库评分 + 🎲 每日推荐 + 热力图（已迁移到 features/oldest-models.ts） */
