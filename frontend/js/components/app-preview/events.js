// ===== preview 事件层 =====
import { bus } from "../../bus.js";
import { renderDisplayName } from "../../utils/display.js";

export function bindActions(root) {
  // ===== 全局操作栏（管辖范围：已选中的整合包） =====
  const btnImport = root.getElementById("dp-btn-import-all");
  const btnUpload = root.getElementById("dp-btn-upload-all");
  const btnSync = root.getElementById("dp-btn-sync-all");

  // 初始状态：无选中包时禁用
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

  // 三张状态卡片（带数字跳动）
  const syncedNum = root.getElementById("dp-card-synced-num");
  const missingNum = root.getElementById("dp-card-missing-num");
  const extraNum = root.getElementById("dp-card-extra-num");
  animateCount(syncedNum, pkg.synced || 0);
  animateCount(missingNum, pkg.missing || 0);
  animateCount(extraNum, pkg.extra || 0);

  // 填充三个展开列表（仅显示文件名，完整路径放 title）
  [
    { id: "dp-detail-synced", items: pkg.items?.synced || [], icon: "✅" },
    { id: "dp-detail-missing", items: pkg.items?.missing || [], icon: "⬇️" },
    { id: "dp-detail-extra", items: pkg.items?.extra || [], icon: "📤" },
  ].forEach(({ id, items, icon }) => {
    const el = root.getElementById(id);
    if (!el) return;
    el.innerHTML = items.length
      ? items
          .map((it) => {
            const display = renderDisplayName(it.displayName || it.name || "");
            const fullPath = it.name || "";
            return `<div class="dp-detail-item" title="${esc(fullPath)}">${icon} ${display}</div>`;
          })
          .join("")
      : `<div class="dp-detail-empty">无</div>`;
    el.classList.add("dp-detail-hidden");
  });

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

/** 加载日志到预览面板（含筛选和搜索） */
export function loadLogsPreview(root, logs) {
  const list = root.getElementById("dp-log-list");
  if (!list) return;
  if (!logs || !logs.length) {
    list.innerHTML =
      '<div class="stat-row" style="font-size:10px;color:#6c7086">暂无日志</div>';
    return;
  }
  // 读取筛选状态
  const activeBtn = root.querySelector(".dp-log-fbtn.active");
  const filter = activeBtn ? activeBtn.dataset.status : "all";
  const search = (root.getElementById("dp-log-search")?.value || "")
    .trim()
    .toLowerCase();

  const items = logs
    .slice(-100)
    .reverse()
    .filter((l) => {
      if (filter !== "all" && l.Status !== filter) return false;
      if (search && !l.ModelName.toLowerCase().includes(search)) return false;
      return true;
    })
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
      const nameHtml = renderDisplayName(l.ModelName);
      const errHtml = l.ErrorMsg
        ? '<span class="ysm-log-error">: ' +
          esc(l.ErrorMsg).replace(
            /\s+(问题描述|操作|源路径|目标路径|解决建议)[：:]?/g,
            "<br>$1：",
          ) +
          "</span>"
        : "";
      return `<div class="log-entry"><span>${status}</span><span class="log-msg">${nameHtml}${errHtml}</span><span class="log-time">${time}</span></div>`;
    })
    .join("");
  list.innerHTML =
    items ||
    '<div class="stat-row" style="font-size:10px;color:#6c7086">无匹配日志</div>';
}

function esc(s) {
  return (s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// animateCount 数字跳动动画
function animateCount(el, target) {
  if (!el) return;
  const from = parseInt(el.textContent) || 0;
  if (from === target) {
    el.textContent = target;
    return;
  }
  const diff = target - from;
  const steps = Math.min(Math.abs(diff), 20);
  const interval = Math.max(30, 200 / steps);
  let i = 0;
  const timer = setInterval(() => {
    i++;
    const current = Math.round(from + (diff * i) / steps);
    el.textContent = current;
    if (i >= steps) {
      el.textContent = target;
      clearInterval(timer);
    }
  }, interval);
}

/** 全窗放大预览（独立函数，不依赖组件实例） */
export async function openFullPreview(canvas, model, textureImg, labelsOn) {
  const { renderModel2D } = await import("../../utils/model2d.js");
  const overlay = document.createElement("div");
  overlay.style.cssText =
    "position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center;flex-direction:column";
  const bigCanvas = document.createElement("canvas");
  bigCanvas.width = 600;
  bigCanvas.height = 600;
  bigCanvas.style.cssText =
    "max-width:90vw;max-height:80vh;border-radius:8px;background:rgba(0,0,0,.2)";
  overlay.appendChild(bigCanvas);
  const hint = document.createElement("div");
  hint.style.cssText = "font-size:11px;color:var(--muted);margin-top:6px";
  hint.textContent = "🖱️ 拖拽旋转 · 滚轮缩放 · ESC 关闭";
  overlay.appendChild(hint);
  let zoom = 1,
    rotation = 0;
  const doRender = () =>
    renderModel2D(bigCanvas, model, textureImg, {
      showLabels: labelsOn,
      zoom,
      rotation,
    });
  doRender();
  bigCanvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      zoom = Math.max(0.2, Math.min(10, zoom + (e.deltaY > 0 ? -0.3 : 0.3)));
      doRender();
    },
    { passive: false },
  );
  let dragging = false,
    lastX = 0;
  bigCanvas.addEventListener("mousedown", (e) => {
    dragging = true;
    lastX = e.clientX;
  });
  window.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    rotation = (rotation + (e.clientX - lastX) * 0.5) % 360;
    lastX = e.clientX;
    doRender();
  });
  window.addEventListener("mouseup", () => {
    dragging = false;
  });
  const close = () => {
    if (overlay.parentNode) document.body.removeChild(overlay);
  };
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) close();
  });
  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Escape") close();
    },
    { once: true },
  );
  document.body.appendChild(overlay);
}
