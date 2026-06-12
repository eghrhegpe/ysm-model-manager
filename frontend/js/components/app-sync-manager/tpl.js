// ===== app-sync-manager 模板 =====

/**
 * 容器骨架
 */
export function containerHTML() {
  return (
    '<div class="sm-wrap" style="display:flex;flex-direction:column;height:100%;overflow:hidden">' +
    // 类型标签栏
    '<div class="sm-tabs" style="display:flex;gap:2px;padding:2px 8px 0;flex-shrink:0;border-bottom:1px solid var(--bd);overflow-x:auto"></div>' +
    // 统计摘要栏
    '<div class="sm-summary" style="display:flex;align-items:center;gap:8px;padding:2px 8px;flex-shrink:0;border-bottom:1px solid var(--bd);font-size:var(--fs-xs)"></div>' +
    // 筛选栏
    '<div class="sm-filter" style="display:flex;align-items:center;gap:4px;padding:3px 8px;flex-shrink:0;border-bottom:1px solid var(--bd);font-size:var(--fs-xs)">' +
    '<input class="sm-search" type="text" placeholder="🔍 搜索文件名..." style="flex:1;min-width:0;padding:2px 6px;font-size:var(--fs-sm);border:1px solid var(--bd);border-radius:3px;background:var(--bg);color:var(--txt);outline:none;font-family:inherit">' +
    '<select class="sm-status-filter" style="padding:2px 4px;font-size:var(--fs-sm);border:1px solid var(--bd);border-radius:3px;background:var(--bg);color:var(--txt);outline:none;font-family:inherit">' +
    '<option value="all">全部</option>' +
    '<option value="synced">✅ 已同步</option>' +
    '<option value="missing">待推送</option>' +
    '<option value="optional">可拉取</option>' +
    "</select>" +
    '<button class="sm-push-all-btn" style="display:none;padding:1px 6px;border-radius:3px;border:1px solid var(--accent);background:transparent;color:var(--accent);cursor:pointer;font-size:var(--fs-xs)">推送全部</button>' +
    '<button class="sm-pull-all-btn" style="display:none;padding:1px 6px;border-radius:3px;border:1px solid #f9a826;background:transparent;color:#f9a826;cursor:pointer;font-size:var(--fs-xs)">拉取全部</button>' +
    "</div>" +
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
    '" style="padding:3px 10px;border-radius:3px 3px 0 0;border:none;background:' +
    (active ? "var(--surf)" : "transparent") +
    ";color:" +
    (active ? "var(--accent)" : "var(--muted)") +
    ';cursor:pointer;font-family:inherit;font-size:var(--fs-sm);white-space:nowrap">' +
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
 * 统计摘要 HTML
 * @param {{synced:number, missing:number, optional:number}} counts
 */
export function summaryHTML(counts) {
  const parts = [];
  if (counts.synced > 0)
    parts.push(
      '<span style="color:var(--sz-green)">✅ ' +
        counts.synced +
        " 已同步</span>",
    );
  if (counts.missing > 0)
    parts.push(
      '<span style="color:var(--accent)">' + counts.missing + " 待推送</span>",
    );
  if (counts.optional > 0)
    parts.push(
      '<span style="color:#f9a826">' + counts.optional + " 可拉取</span>",
    );
  if (parts.length === 0)
    return '<span style="color:var(--muted)">🔄 全部已同步</span>';
  return parts.join('<span style="color:var(--bd)"> | </span>');
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
  const statusIcon = item.status === "synced" ? "✅" : "·";
  const statusColor =
    item.status === "synced"
      ? "var(--sz-green)"
      : item.status === "missing"
        ? "var(--accent)"
        : "#f9a826";
  const sizeStr = item.size > 0 ? formatSize(item.size) : "";
  return (
    '<div class="sm-item" data-path="' +
    esc(item.path) +
    '" data-status="' +
    item.status +
    '" data-type="' +
    item.type +
    '" style="display:flex;align-items:center;gap:4px;padding:2px 8px;font-size:var(--fs-sm);border-bottom:1px solid var(--bd);cursor:default">' +
    '<span style="flex-shrink:0;width:14px;text-align:center;color:' +
    statusColor +
    '">' +
    statusIcon +
    "</span>" +
    '<span style="flex-shrink:0;font-size:11px">' +
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
    "</div>"
  );
}

/**
 * 空状态 HTML
 * @param {string} msg
 */
export function emptyHTML(msg) {
  return (
    '<div style="display:flex;align-items:center;justify-content:center;flex-direction:column;gap:6px;height:100%;color:var(--muted);font-size:11px">' +
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
  return '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--muted);font-size:10px">⏳ 加载中...</div>';
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + "B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + "KB";
  return (bytes / (1024 * 1024)).toFixed(1) + "MB";
}
