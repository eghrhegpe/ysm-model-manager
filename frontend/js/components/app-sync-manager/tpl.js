// ===== app-sync-manager 模板 =====
import { renderFormattedText } from "../../utils/mc-format.js";

/**
 * 容器骨架
 */
export function containerHTML() {
  return (
    "<style>" +
    ".sm-item{display:flex;align-items:center;gap:4px;padding:4px 10px;font-size:var(--fs-sm);border-bottom:1px solid var(--bd);cursor:default;transition:background .12s}" +
    ".sm-item:hover{background:var(--hover)}" +
    ".sm-item-btn{padding:var(--pad-btn-secondary) 8px;border-radius:4px;background:transparent;cursor:pointer;flex-shrink:0;font-size:var(--fs-btn-secondary);transition:background .12s,border-color .12s,color .12s}" +
    ".sm-item-btn:hover{background:var(--hover)}" +
    ".sm-tab{transition:all .12s}" +
    ".sm-status-tab{transition:background .12s,color .12s,border-color .12s}" +
    ".sm-empty{animation:fade-in .2s ease}" +
    ".sm-list{animation:fade-in .15s ease}" +
    ".sm-loading{display:flex;flex-direction:column;gap:8px;padding:12px}" +
    ".sm-shimmer{height:12px;border-radius:6px;background:linear-gradient(90deg,var(--bd) 25%,var(--hover) 50%,var(--bd) 75%);background-size:200% 100%;animation:sk-shimmer 1.5s infinite}" +
    ".sm-shimmer-w80{width:80%}" +
    ".sm-shimmer-w60{width:60%}" +
    ".sm-shimmer-w70{width:70%}" +
    "@keyframes sm-item-in{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}" +
    "@keyframes fade-in{from{opacity:0}to{opacity:1}}" +
    "@keyframes sk-shimmer{from{background-position:-200% 0}to{background-position:200% 0}}" +
    "</style>" +
    '<div class="sm-wrap" style="display:flex;flex-direction:column;height:100%;overflow:hidden">' +
    // 类型标签栏
    '<div class="sm-tabs" style="display:flex;gap:2px;padding:2px 8px 0;flex-shrink:0;border-bottom:1px solid var(--bd);overflow-x:auto"></div>' +
    '<div class="sm-status-tabs" style="display:flex;gap:2px;padding:3px 8px;flex-shrink:0;border-bottom:1px solid var(--bd);font-size:var(--fs-xs)"></div>' +
    // 摘要栏
    '<div class="sm-summary" style="display:flex;align-items:center;gap:8px;padding:2px 8px;flex-shrink:0;border-bottom:1px solid var(--bd);font-size:var(--fs-xs)"></div>' +
    // 列表容器
    '<div class="sm-list" style="flex:1;overflow-y:auto;padding:2px 0"></div>' +
    "</div>"
  );
}

/**
 * 状态筛选标签 HTML
 * @param {string} id - 筛选 ID (all/synced/missing/disabled/optional)
 * @param {string} label - 标签文字
 * @param {number} count - 数量
 * @param {boolean} active - 是否选中
 */
export function statusTabHTML(id, label, count, active) {
  const cls = active ? " active" : "";
  const showCount = count > 0 ? " (" + count + ")" : "";
  return (
    '<button class="sm-status-tab' +
    cls +
    '" data-status="' +
    id +
    '" style="padding:var(--pad-filter) 12px;border-radius:4px;border:1px solid transparent;background:' +
    (active ? "var(--accent)" : "transparent") +
    ";color:" +
    (active ? "#fff" : "var(--muted)") +
    ';cursor:pointer;font-family:inherit;font-size:var(--fs-filter);white-space:nowrap">' +
    label +
    showCount +
    "</button>"
  );
}

/**
 * 列表项 HTML
 * @param {{path:string, name:string, status:string, type:string, icon:string, size:number}} item
 */
export function itemHTML(item, index) {
  const esc = (s) =>
    String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  const statusIcon =
    item.status === "synced" ? "✅" : item.status === "legacy" ? "🔗" : "·";
  const statusColor =
    item.status === "synced"
      ? "var(--sz-green)"
      : item.status === "missing"
        ? "var(--accent)"
        : item.status === "legacy"
          ? "var(--muted)"
          : "var(--sm-optional)";
  const sizeStr = item.size > 0 ? formatSize(item.size) : "";
  let actionBtn = "";
  if (item.status === "missing") {
    actionBtn =
      '<button class="sm-item-btn" data-action="push" style="border:1px solid var(--accent);color:var(--accent)">推送</button>';
  } else if (item.status === "optional") {
    actionBtn =
      '<button class="sm-item-btn" data-action="pull" style="border:1px solid var(--sm-optional);color:var(--sm-optional)">拉取</button>';
  } else if (item.status === "legacy") {
    actionBtn =
      '<button class="sm-item-btn" data-action="pull" style="border:1px solid var(--muted);color:var(--muted);font-size:var(--fs-tiny)">拉取到此仓库</button>';
  }
  return (
    '<div class="sm-item" data-path="' +
    esc(item.path) +
    '" data-status="' +
    item.status +
    '" data-type="' +
    item.type +
    '" style="animation:sm-item-in .2s ease both;animation-delay:' +
    Math.min((index || 0) * 30, 300) +
    'ms">' +
    '<span style="flex-shrink:0;width:14px;text-align:center;color:' +
    statusColor +
    '">' +
    statusIcon +
    "</span>" +
    '<span style="flex-shrink:0;font-size:var(--fs-base)">' +
    (item.icon || "📦") +
    "</span>" +
    '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--txt)">' +
    renderFormattedText(item.name) +
    "</span>" +
    (sizeStr
      ? '<span style="flex-shrink:0;color:var(--muted);font-size:var(--fs-tiny)">' +
        sizeStr +
        "</span>"
      : "") +
    actionBtn +
    "</div>"
  );
}

/**
 * 空状态 HTML
 * @param {string} msg
 */
export function emptyHTML(msg) {
  return (
    '<div class="sm-empty" style="display:flex;align-items:center;justify-content:center;flex-direction:column;gap:6px;height:100%;color:var(--muted);font-size:var(--fs-base)">' +
    '<div style="font-size:20px">📭</div>' +
    "<div>" +
    msg +
    "</div>" +
    "</div>"
  );
}

/**
 * 加载中
 */
export function loadingHTML() {
  return (
    '<div class="sm-loading">' +
    '<div class="sm-shimmer sm-shimmer-w80"></div>' +
    '<div class="sm-shimmer sm-shimmer-w60"></div>' +
    '<div class="sm-shimmer sm-shimmer-w70"></div>' +
    "</div>"
  );
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + "B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + "KB";
  return (bytes / (1024 * 1024)).toFixed(1) + "MB";
}
