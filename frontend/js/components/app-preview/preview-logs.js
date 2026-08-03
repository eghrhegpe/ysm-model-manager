// ===== 导入日志渲染 =====
// 从 events.js 拆分：loadLogsPreview
import { renderDisplayName } from "../../utils/display.js";

const esc = (s) =>
  (s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** 加载日志到预览面板（含筛选和搜索） */
export function loadLogsPreview(root, logs) {
  const list = root.getElementById("dp-log-list");
  if (!list) return;
  if (!logs || !logs.length) {
    list.innerHTML =
      '<div class="stat-row" style="color:#6c7086">暂无日志</div>';
    return;
  }
  // 读取筛选状态
  const activeBtn = root.querySelector(".dp-log-fbtn.active");
  const filter = activeBtn ? activeBtn.dataset.status : "all";
  const search = (root.getElementById("dp-log-search")?.value || "")
    .trim()
    .toLowerCase();

  const opLabels = { import: "📥", download: "⬇️", scan: "🔍", sync: "🔄", rename: "✏️", delete: "🗑️" };
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
      const opIcon = opLabels[l.Operation] || "📋";
      const nameHtml = l.ModelName
        ? renderDisplayName(l.ModelName)
        : esc(l.SourcePath || l.TargetDir || "-");
      const errHtml = l.ErrorMsg
        ? '<span class="ysm-log-error">: ' +
          esc(l.ErrorMsg).replace(
            /\s+(问题描述|操作|源路径|目标路径|解决建议)[：:]?/g,
            "<br>$1：",
          ) +
          "</span>"
        : "";
      return `<div class="log-entry"><span>${opIcon}${status}</span><span class="log-msg">${nameHtml}${errHtml}</span><span class="log-time">${time}</span></div>`;
    })
    .join("");
  list.innerHTML =
    items ||
    '<div class="stat-row" style="font-size:10px;color:#6c7086">无匹配日志</div>';
}
