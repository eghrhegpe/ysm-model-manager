// ===== app-sync-manager 模板 =====

/**
 * 容器骨架
 */
export function containerHTML() {
  return (
    "<style>.sm-item:hover{background:var(--hover)}.sm-item-btn{padding:var(--pad-btn-secondary) 8px;border-radius:4px;background:transparent;cursor:pointer;flex-shrink:0;font-size:var(--fs-btn-secondary)}</style>" +
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
 * 类型标签 HTML
 * @param {string} id
 * @param {string} icon
 * @param {string} label
 * @param {number} count
 * @param {boolean} active
 */
export function tabHTML(id, icon, label, count, active) {
  const cls = active ? " active" : "";
  return (
    '<button class="sm-tab' +
    cls +
    '" data-type="' +
    id +
    '" style="padding:var(--pad-tab) 14px;border-radius:5px 5px 0 0;border:none;background:' +
    (active ? "var(--surf)" : "transparent") +
    ";color:" +
    (active ? "var(--accent)" : "var(--muted)") +
    ';cursor:pointer;font-family:inherit;font-size:var(--fs-tab);white-space:nowrap">' +
    icon +
    " " +
    label +
    (count > 0
      ? ' <span style="font-size:var(--fs-tiny);opacity:0.7">(' +
        count +
        ")</span>"
      : "") +
    "</button>"
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
 * 统计摘要 HTML
 * @param {{synced:number, missing:number, optional:number, legacy:number}} counts
 */
export function summaryHTML(counts) {
  // 状态标签已展示统计，摘要栏留空
  return "";
}

/**
 * 列表项 HTML
 * @param {{path:string, name:string, status:string, type:string, icon:string, size:number}} item
 */
export function itemHTML(item) {
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
    '" style="display:flex;align-items:center;gap:4px;padding:4px 10px;font-size:var(--fs-sm);border-bottom:1px solid var(--bd);cursor:default">' +
    '<span style="flex-shrink:0;width:14px;text-align:center;color:' +
    statusColor +
    '">' +
    statusIcon +
    "</span>" +
    '<span style="flex-shrink:0;font-size:var(--fs-base)">' +
    (item.icon || "📦") +
    "</span>" +
    '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--txt)">' +
    esc(item.name) +
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
    '<div style="display:flex;align-items:center;justify-content:center;flex-direction:column;gap:6px;height:100%;color:var(--muted);font-size:var(--fs-base)">' +
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
  return '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--muted);font-size:var(--fs-sm)">⏳ 加载中...</div>';
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + "B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + "KB";
  return (bytes / (1024 * 1024)).toFixed(1) + "MB";
}
