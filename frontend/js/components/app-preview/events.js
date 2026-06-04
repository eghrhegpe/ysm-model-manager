// ===== preview 事件层 =====
import { bus } from "../../bus.js";

export function bindActions(root) {
  // ===== 全局操作栏（管辖范围：已选中的整合包） =====
  const btnImport = root.getElementById("dp-btn-import-all");
  const btnUpload = root.getElementById("dp-btn-upload-all");
  const btnSync = root.getElementById("dp-btn-sync-all");

  // 初始状态：无选中包时禁用
  setGlobalButtonsEnabled(root, false);

  console.log(
    "[preview] bindActions, btnImport:",
    !!btnImport,
    "btnUpload:",
    !!btnUpload,
    "btnSync:",
    !!btnSync,
  );
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
  if (logToggle && logList) {
    let logExpanded = false;
    logToggle.onclick = () => {
      logExpanded = !logExpanded;
      logList.style.maxHeight = logExpanded ? "none" : "72px";
      logToggle.textContent = logExpanded ? "收起 ▾" : "展开 ▸";
      if (logExpanded) bus.emit("logs:refresh");
    };
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

  // ===== 状态卡片点击展开详情列表 =====
  const missingCard = root.getElementById("dp-card-missing");
  const missingDetail = root.getElementById("dp-detail-missing");
  if (missingCard && missingDetail) {
    let missingOpen = false;
    missingCard.onclick = () => {
      missingOpen = !missingOpen;
      missingDetail.style.display = missingOpen ? "" : "none";
    };
  }

  const extraCard = root.getElementById("dp-card-extra");
  const extraDetail = root.getElementById("dp-detail-extra");
  if (extraCard && extraDetail) {
    let extraOpen = false;
    extraCard.onclick = () => {
      extraOpen = !extraOpen;
      extraDetail.style.display = extraOpen ? "" : "none";
    };
  }
}

/** 启用/禁用手动作业栏的三个按钮 */
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

/** 更新预览面板显示整合包详情 */
export function showPackageDetail(root, pkg) {
  const body = root.getElementById("dp-body");
  const placeholder = root.getElementById("dp-placeholder");
  if (!body || !placeholder) return;

  if (!pkg) {
    body.style.display = "none";
    placeholder.style.display = "";
    setGlobalButtonsEnabled(root, false);
    return;
  }

  placeholder.style.display = "none";
  body.style.display = "";
  setGlobalButtonsEnabled(root, true);

  // 头部：包名 + 状态指示灯
  const nameEl = root.getElementById("dp-name");
  const statusEl = root.getElementById("dp-status");
  if (nameEl) nameEl.textContent = `📦 ${pkg.name}`;
  if (statusEl) {
    if (pkg.status === "complete") {
      statusEl.textContent = "";
      statusEl.style.cssText =
        "width:8px;height:8px;border-radius:50%;background:#a6e3a1;flex-shrink:0;display:inline-block;vertical-align:middle";
    } else if (pkg.status === "missing") {
      statusEl.textContent = "";
      statusEl.style.cssText =
        "width:8px;height:8px;border-radius:50%;background:#f38ba8;flex-shrink:0;display:inline-block;vertical-align:middle";
    } else if (pkg.status === "extra") {
      statusEl.textContent = "";
      statusEl.style.cssText =
        "width:8px;height:8px;border-radius:50%;background:#f9a826;flex-shrink:0;display:inline-block;vertical-align:middle";
    } else {
      statusEl.style.cssText = "display:none";
    }
  }

  // 三张状态卡片（纯展示）
  const syncedNum = root.getElementById("dp-card-synced-num");
  const missingNum = root.getElementById("dp-card-missing-num");
  const extraNum = root.getElementById("dp-card-extra-num");
  if (syncedNum) syncedNum.textContent = pkg.synced || 0;
  if (missingNum) missingNum.textContent = pkg.missing || 0;
  if (extraNum) extraNum.textContent = pkg.extra || 0;

  // 填充缺失/额外展开列表
  const missingDetail = root.getElementById("dp-detail-missing");
  if (missingDetail) {
    const items = pkg.items?.missing || [];
    missingDetail.innerHTML = items.length
      ? items
          .map((it) => `<div class="dp-detail-item">⬇️ ${esc(it.name)}</div>`)
          .join("")
      : '<div class="dp-detail-empty">无缺失</div>';
    missingDetail.style.display = "none";
  }

  const extraDetail = root.getElementById("dp-detail-extra");
  if (extraDetail) {
    const items = pkg.items?.extra || [];
    extraDetail.innerHTML = items.length
      ? items
          .map((it) => `<div class="dp-detail-item">📤 ${esc(it.name)}</div>`)
          .join("")
      : '<div class="dp-detail-empty">无额外</div>';
    extraDetail.style.display = "none";
  }

  // 恢复全局按钮状态
  resetGlobalButtons(root);
}

/** 恢复全局按钮文字和启用状态 */
function resetGlobalButtons(root) {
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

export function bindBusUpdates(root, unsubs) {
  unsubs.push(
    bus.on("package:selected", (pkg) => {
      showPackageDetail(root, pkg);
    }),
  );

  // 操作完成后恢复按钮
  [
    "sync:download-complete",
    "sync:upload-complete",
    "sync:toggle-complete",
  ].forEach((evt) => {
    unsubs.push(
      bus.on(evt, () => {
        console.log("[preview] 收到", evt, "→ resetGlobalButtons");
        resetGlobalButtons(root);
      }),
    );
  });
}

/** 加载日志到预览面板 */
export function loadLogsPreview(root, logs) {
  const list = root.getElementById("dp-log-list");
  if (!list) return;
  if (!logs || !logs.length) {
    list.innerHTML =
      '<div class="stat-row" style="font-size:10px;color:#6c7086">暂无日志</div>';
    return;
  }
  const items = logs
    .slice(-50)
    .reverse()
    .map((l) => {
      const status =
        l.Status === "success" ? "✅" : l.Status === "failed" ? "❌" : "⏭️";
      const time = l.Timestamp
        ? new Date(l.Timestamp).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
          })
        : "";
      const msg = l.ModelName + (l.ErrorMsg ? ": " + l.ErrorMsg : "");
      return `<div class="log-entry"><span>${status}</span><span class="log-msg">${esc(msg)}</span><span class="log-time">${time}</span></div>`;
    })
    .join("");
  list.innerHTML = items;
}

function esc(s) {
  return (s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
