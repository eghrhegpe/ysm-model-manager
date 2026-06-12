// ===== 预览面板操作按钮绑定 =====
// 从 events.js 拆分：bindActions + 按钮状态管理
import { bus } from "../../bus.js";

/** 设置全局按钮启用/禁用 */
function setGlobalButtonsEnabled(root, enabled) {
  const btns = root.querySelectorAll(
    "#dp-btn-import-all, #dp-btn-upload-all, #dp-btn-sync-all",
  );
  btns.forEach((btn) => {
    btn.disabled = !enabled;
    btn.style.opacity = enabled ? "1" : "0.4";
    btn.style.cursor = enabled ? "pointer" : "not-allowed";
  });
}

/** 恢复全局按钮文字和启用状态 */
export function resetGlobalButtons(root) {
  const btnImport = root.getElementById("dp-btn-import-all");
  const btnUpload = root.getElementById("dp-btn-upload-all");
  const btnSync = root.getElementById("dp-btn-sync-all");
  if (btnImport) {
    btnImport.disabled = false;
    btnImport.textContent = "⬇️ 导入仓库模型";
  }
  if (btnUpload) {
    btnUpload.disabled = false;
    btnUpload.textContent = "📤 上传新模型";
  }
  if (btnSync) {
    btnSync.disabled = false;
    btnSync.textContent = "🔄 同步状态";
  }
}

/** 绑定预览面板操作按钮（导入/上传/同步/日志/卡片） */
export function bindActions(root) {
  // ===== 全局操作栏 =====
  const btnImport = root.getElementById("dp-btn-import-all");
  const btnUpload = root.getElementById("dp-btn-upload-all");
  const btnSync = root.getElementById("dp-btn-sync-all");

  setGlobalButtonsEnabled(root, false);

  btnImport?.addEventListener("click", () => {
    console.log("[preview] ⬇️ 导入 按钮点击");
    btnImport.disabled = true;
    btnImport.textContent = "⬇️ 导入中...";
    bus.emit("sync:download-missing");
  });
  btnUpload?.addEventListener("click", () => {
    console.log("[preview] 📤 上传 按钮点击");
    btnUpload.disabled = true;
    btnUpload.textContent = "📤 上传中...";
    bus.emit("stats:upload");
  });
  btnSync?.addEventListener("click", () => {
    console.log("[preview] 🔄 同步 按钮点击");
    btnSync.disabled = true;
    btnSync.textContent = "🔄 同步中...";
    bus.emit("sync:toggle-status");
  });

  // ===== 日志展开/折叠 =====
  const logToggle = root.getElementById("dp-log-toggle");
  const logList = root.getElementById("dp-log-list");
  const logFilter = root.getElementById("dp-log-filter");
  if (logToggle && logList) {
    let logExpanded = false;
    logToggle.onclick = () => {
      logExpanded = !logExpanded;
      logList.style.maxHeight = logExpanded ? "300px" : "72px";
      logFilter.style.display = logExpanded ? "flex" : "none";
      logToggle.textContent = logExpanded ? "收起 ▾" : "展开 ▸";
      if (logExpanded) bus.emit("logs:refresh");
    };
  }

  // 日志筛选按钮
  root.querySelectorAll(".dp-log-fbtn").forEach((btn) => {
    btn.addEventListener("click", () => {
      root
        .querySelectorAll(".dp-log-fbtn")
        .forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      bus.emit("logs:refresh");
    });
  });

  // 日志搜索
  const logSearch = root.getElementById("dp-log-search");
  if (logSearch) {
    let searchTimer;
    logSearch.addEventListener("input", () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => bus.emit("logs:refresh"), 300);
    });
  }

  // 清空日志
  root
    .getElementById("dp-btn-clear-logs")
    ?.addEventListener("click", async () => {
      const { ClearImportLogs } =
        await import("../../../wailsjs/go/main/App.js");
      await ClearImportLogs();
      bus.emit("logs:refresh");
      bus.emit("toast:show", {
        msg: "🗑️ 日志已清空",
        duration: 2000,
        type: "info",
      });
    });

  // ===== 三张状态卡片点击展开详情列表 =====
  [
    { card: "dp-card-synced", detail: "dp-detail-synced" },
    { card: "dp-card-missing", detail: "dp-detail-missing" },
    { card: "dp-card-extra", detail: "dp-detail-extra" },
  ].forEach(({ card, detail }) => {
    const c = root.getElementById(card);
    const d = root.getElementById(detail);
    if (c && d) {
      let open = false;
      c.onclick = () => {
        open = !open;
        d.classList.toggle("dp-detail-hidden", !open);
      };
    }
  });
}
