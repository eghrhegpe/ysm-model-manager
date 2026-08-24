// ===== app-content 页面模板 =====
import { RESOURCE_TYPES } from "../../utils/resource/types.ts";
import { t } from "../../core/i18n/t.ts";
export { ysmHubHTML } from "./tpl-ysmhub.ts";
import { isViewerMode } from "../../utils/dom/android-bridge.ts";

// P1 修复（ADR-040）：settingsHTML 已拆至 tpl-settings.ts，此处 re-export 兼容
export { settingsHTML } from "./tpl-settings.ts";

export function repositoryHTML(): string {
  // 查看器模式（Android/网页版 ADR-049）：回收站/查重/最旧模型依赖本地文件系统
  // 操作（MoveToRecycle/FindDuplicateFiles 等 browser-adapter 未实现），隐藏对应 tab
  const viewerExtras = isViewerMode()
    ? ""
    : '<button class="repo-tab" data-testid="content-tab" data-tab="recycle">♻️ ' +
      t("recycle.tab") +
      "</button>" +
      '<button class="repo-tab" data-testid="content-tab" data-tab="dedup">🔗 ' +
      t("repo.tab.dedup") +
      "</button>" +
      '<button class="repo-tab" data-testid="content-tab" data-tab="oldest">👴 ' +
      t("repo.tab.oldest") +
      "</button>";
  return (
    '<div class="repo-wrap">' +
    // 第一栏：操作
    '<div class="repo-tabs">' +
    '<button class="repo-tab active" data-testid="content-tab" data-tab="tree">📁 ' + t("repo.tab.tree") + '</button>' +
    viewerExtras +
    "</div>" +
    '<div class="repo-layout" style="flex:1;display:flex;overflow:hidden">' +
    '<div class="repo-left" style="flex:1;display:flex;flex-direction:column;min-width:0">' +
    '<div class="repo-tab-body" id="repo-tab-tree" style="flex:1;display:flex;flex-direction:column;overflow:hidden">' +
    // 默认 YSM 文件树（预览在外层共享）
    '<app-tree root="' + RESOURCE_TYPES.YSM + '" style="flex:1;min-width:0"></app-tree>' +
    "</div>" +
    '<div class="repo-tab-body" id="repo-tab-recycle" style="display:none;flex:1;overflow-y:auto"></div>' +
    '<div class="repo-tab-body" id="repo-tab-dedup" style="display:none;flex:1;overflow-y:auto;padding:12px"></div>' +
    '<div class="repo-tab-body" id="repo-tab-oldest" style="display:none;flex:1;overflow-y:auto;overflow-x:hidden"></div>' +
    "</div>" +
    '<div class="preview-resize-handle" id="preview-resize-handle" style="width:4px;cursor:col-resize;background:transparent;transition:background var(--tr-fast);flex-shrink:0"></div>' +
    '<app-preview id="app-preview" style="width:var(--preview-width,220px);flex-shrink:0;border-left:1px solid var(--bd)"></app-preview>' +
    "</div>" +
    "</div>"
  );
}

export function instancesHTML(): string {
  return (
    '<div class="repo-wrap">' +
    '<div class="repo-tabs">' +
    '<button class="repo-tab active" data-tab="versions">🎮 ' + t("instances.tab.versions") + '</button>' +
    "</div>" +
    '<div class="repo-tab-body" id="ins-tab-versions">' +
    '<div class="repo-layout">' +
    '<app-sidebar class="ins-sidebar"></app-sidebar>' +
    '<div class="ins-content" id="ins-content" style="display:flex;flex-direction:column;overflow:hidden">' +
    '<div class="dp-placeholder" style="flex:1;display:flex;align-items:center;justify-content:center;flex-direction:column;color:var(--muted);font-size:12px;gap:8px">' +
    '<div style="font-size:24px">👈</div>' +
    "<div>" + t("instances.emptyHint") + "</div>" +
    "</div>" +
    "</div>" +
    "</div>" +
    "</div>" +
    "</div>"
  );
}
// P2 修复（chunk 实效）：recycleHTML 已拆至 tpl-recycle.ts
export { recycleHTML } from "./tpl-recycle.ts";

export function diagnosticsHTML(): string {
  return `<div class="repo-wrap">
<div class="repo-tabs">
<button class="repo-tab active" data-tab="diagnostics">🛠️ ${t("diagnostics.title")}</button>
</div>
<div class="repo-tab-body">
<div class="diag-wrapper">
<div class="diag-left">
<button class="diag-btn active" data-diag="log">
<span class="diag-btn-icon">📋</span>
<span>${t("diagnostics.opsLog")}</span>
</button>
<button class="diag-btn" data-diag="runtime">
<span class="diag-btn-icon">🕹️</span>
<span>${t("diagnostics.runtimeLog")}</span>
</button>
<button class="diag-btn" data-diag="conflict">
<span class="diag-btn-icon">⚡</span>
<span>${t("diagnostics.conflict")}</span>
</button>
<button class="diag-btn" data-diag="perf">
<span class="diag-btn-icon">⏱️</span>
<span>${t("diagnostics.perfTitle")}</span>
</button>
<button class="diag-btn" data-diag="health">
<span class="diag-btn-icon">🩺</span>
<span>${t("diagnostics.healthTitle")}</span>
</button>
<button class="diag-btn" data-diag="sync-conflict">
<span class="diag-btn-icon">🔄</span>
<span>${t("diagnostics.syncConflict")}</span>
</button>
<div class="diag-left-spacer"></div>
<button class="diag-btn diag-btn-action" id="diag-copy" title="${t("diagnostics.copyLog")}">
<span>${t("diagnostics.copyLog")}</span>
</button>
<button class="diag-btn diag-btn-action" id="diag-refresh">
<span>${t("diagnostics.refresh")}</span>
</button>
<button class="diag-btn diag-btn-action" id="diag-clear">
<span>${t("diagnostics.clearLog")}</span>
</button>
</div>
<div class="diag-right">
<div class="diag-panel" id="diag-log">
<div class="diag-log-filter" style="display:flex;gap:4px;padding:3px 12px;overflow:hidden">
<button class="diag-log-fbtn active" data-status="all">${t("diagnostics.all")}</button>
<button class="diag-log-fbtn" data-status="success">✅ ${t("diagnostics.success")}</button>
<button class="diag-log-fbtn" data-status="failed">❌ ${t("diagnostics.failed")}</button>
<button class="diag-log-fbtn" data-status="skipped">⏭️ ${t("diagnostics.skipped")}</button>
<input id="diag-log-search" placeholder="🔍 ${t("diagnostics.searchPlaceholder")}" style="width:130px;font-size:var(--fs-sm);padding:2px 8px;border-radius:4px;border:1px solid var(--bd);background:var(--bg);color:var(--txt);margin-left:auto">
</div>
<div id="diag-log-list" style="overflow-y:auto;flex:1"><div class="stat-row" style="padding:12px;color:var(--muted);font-size:var(--fs-sm)">${t("diagnostics.noLogs")}</div></div>
</div>
<div class="diag-panel" id="diag-runtime" style="display:none">
<div id="diag-runtime-list" style="overflow-y:auto;flex:1"><div class="stat-row" style="padding:12px;color:var(--muted);font-size:var(--fs-sm)">${t("diagnostics.noRuntimeLogs")}</div></div>
</div>
<div class="diag-panel" id="diag-conflict" style="display:none">
<div id="diag-conflict-list"><div class="stat-row" style="padding:24px 12px;color:var(--muted);font-size:var(--fs-sm);text-align:center;flex-direction:column;gap:12px">${t("diagnostics.scanHint")}
<button class="btn-base accent" id="diag-scan-conflict" style="margin-top:4px">⚡ ${t("diagnostics.startScan")}</button>
</div></div></div>
<div class="diag-panel" id="diag-perf" style="display:none">
<div class="perf-wrap" style="overflow-y:auto;flex:1;padding:10px 12px">
<div class="perf-controls" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:4px 0 10px;border-bottom:1px solid var(--bd)">
<button class="btn-base accent" id="diag-perf-run">⚡ ${t("diagnostics.perfRunSingle")}</button>
<input id="diag-perf-model" type="text" placeholder="📁 ${t("diagnostics.perfModelPlaceholder")}" style="flex:1;min-width:150px;font-size:var(--fs-sm);padding:4px 8px;border-radius:4px;border:1px solid var(--bd);background:var(--bg);color:var(--txt)">
<label for="diag-perf-iter" style="font-size:var(--fs-sm);color:var(--muted)">${t("diagnostics.perfIterations")}</label>
<input id="diag-perf-iter" type="number" min="1" step="1" value="3" style="width:56px;font-size:var(--fs-sm);padding:4px 6px;border-radius:4px;border:1px solid var(--bd);background:var(--bg);color:var(--txt)">
<button class="btn-base" id="diag-perf-gui">🩺 ${t("diagnostics.perfRunGui")}</button>
<button class="btn-base" id="diag-perf-log">🗒️ ${t("diagnostics.perfPerfLog")}</button>
<button class="btn-base" id="diag-perf-refresh-trace">🔍 ${t("diagnostics.loadTraceRefresh")}</button>
</div>
<div id="diag-perf-single"></div>
<div id="diag-perf-gui-out"></div>
<div id="diag-perf-hist"></div>
<div id="diag-load-trace"></div>
</div>
</div>
<div class="diag-panel" id="diag-oldest" style="display:none">
<div class="diag-panel-header">
<span>👴 ${t("repo.tab.oldest")}</span>
<button class="btn-base" id="diag-oldest-refresh">🔄</button>
</div>
<div id="diag-oldest-list"><div class="stat-row" style="padding:12px;color:var(--muted);font-size:var(--fs-sm)">${t("diagnostics.refreshHint")}</div></div>
</div>
<div class="diag-panel" id="diag-health" style="display:none">
<div id="diag-health-list"><div class="stat-row" style="padding:24px 12px;color:var(--muted);font-size:var(--fs-sm);text-align:center;flex-direction:column;gap:12px">${t("diagnostics.healthHint")}
<button class="btn-base accent" id="diag-scan-health" style="margin-top:4px">🩺 ${t("diagnostics.healthRun")}</button>
</div></div></div>
<div class="diag-panel" id="diag-sync-conflict" style="display:none">
<div id="diag-sync-conflict-list"><div class="stat-row" style="padding:24px 12px;color:var(--muted);font-size:var(--fs-sm);text-align:center;flex-direction:column;gap:12px">${t("diagnostics.scanHint")}
<button class="btn-base accent" id="diag-scan-sync-conflict" style="margin-top:4px">🔍 ${t("diagnostics.scanSyncConflict")}</button>
</div></div></div>
</div>
</div>
</div>
</div>`;
}

/* ===== GitHub 仓库页面 ===== */

export function githubHTML(): string {
  return (
    '<div class="repo-wrap">' +
    '<div class="repo-tabs">' +
    '<button class="repo-tab active" data-tab="github">🐙 ' + t("workshop.title") + '</button>' +
    "</div>" +
    '<div class="repo-tab-body" id="gh-tab-repos">' +
    '<div class="gh-page" id="gh-page">' +
    '<div class="gh-left" id="gh-left">' +
    '<div class="gh-left-head">' +
    '<span class="gh-left-head-label">' + t("gh.leftHead") + '</span>' +
    '<span class="gh-left-head-spacer"></span>' +
    "</div>" +
    '<div class="gh-grid" id="gh-grid">' +
    '<div class="gh-loading-placeholder">⏳ ' + t("common.loading") + '</div>' +
    "</div>" +
    '<div class="gh-left-foot">' +
    t("gh.sourceInfo") + ': <span id="gh-source-info">-</span>' +
    "</div>" +
    "</div>" +
    '<div class="gh-right" id="gh-right">' +
    '<div class="gh-right-inner" id="gh-right-inner">' +
    '<div id="gh-results">' +
    '<div id="gh-results-body">' +
    '<div class="gh-initial-hint">' + t("gh.initialHint") + "</div>" +
    "</div></div></div></div></div>" +
    "</div>" +
    "</div>"
  );
}

export function workshopHTML(): string {
  // 站点 Tab 由 _initWorkshop 动态生成，此处只放容器
  return (
    '<div class="repo-wrap">' +
    '<div class="repo-tabs" id="ws-tabs">' +
    '<span style="padding:4px 12px;font-size:var(--fs-sm);color:var(--muted)">⏳ ' + t("common.loading") + '</span>' +
    "</div>" +
    // 站点配置导入/导出工具栏（index.ts ws-export-btn / ws-import-btn 绑定）
    '<div style="display:flex;gap:6px;padding:4px 12px;border-bottom:1px solid var(--bd);flex-shrink:0">' +
    '<button class="btn-base sm" id="ws-export-btn" title="' + t("workshop.exportSiteTitle") + '">📤 ' + t("workshop.exportSite") + '</button>' +
    '<button class="btn-base sm" id="ws-import-btn" title="' + t("workshop.importSiteTitle") + '">📥 ' + t("workshop.importSite") + '</button>' +
    "</div>" +
    '<div class="repo-tab-body" id="cr-tab-creators">' +
    '<div class="cr-page" id="ws-page">' +
    '<div class="cr-right" style="width:100%;flex:1;display:flex;flex-direction:column;overflow:hidden" id="ws-right">' +
    '<div class="cr-right-inner" id="ws-right-inner">' +
    '<div id="ws-search-view" style="flex:1;display:flex;flex-direction:column;overflow:hidden">' +
    '<div id="ws-search-results" style="flex:1;overflow-y:auto;padding:0 12px 8px">' +
    '<div style="color:var(--muted);font-size:10px;padding:12px 0;text-align:center">' + t("common.loading") + '</div>' +
    "</div>" +
    "</div>" +
    '<div id="ws-creator-view" style="display:none;flex:1;display:none;flex-direction:column;overflow:hidden">' +
    '<div style="padding:8px 12px;display:flex;align-items:center;gap:6px;border-bottom:1px solid var(--bd)">' +
    '<span style="font-size:12px;font-weight:600;color:var(--txt)" id="ws-cr-title">🎨 ' + t("workshop.activeCreators") + '</span>' +
    '<span style="font-size:9px;color:var(--muted);margin-left:auto">creators/</span>' +
    "</div>" +
    '<div class="ws-creators-list" id="ws-cr-list"></div>' +
    "</div>" +
    "</div>" +
    "</div>" +
    '<div id="ws-browser" style="display:none;flex:1;flex-direction:column;overflow:hidden;position:absolute;inset:0;z-index:10;background:var(--bg)">' +
    '<div class="ws-browser-bar">' +
    '<button class="btn-base sm ws-back" id="ws-back">← ' + t("common.back") + '</button>' +
    '<span class="ws-url" id="ws-url"></span>' +
    '<button class="btn-base sm ws-btn-txt" id="ws-win-open" title="' + t("workshop.openWindow") + '">🖥️</button>' +
    '<button class="btn-base sm ws-open-btn" id="ws-open">↗ ' + t("workshop.openBrowser") + '</button>' +
    "</div>" +
    // [ADR-077] allow-same-origin 必需：缺此标记时 iframe origin 被强制为 null（opaque origin），
    // 登录站 SPA（如模之屋 aplaybox）的 fetch/XHR 会被浏览器 CORS 拦截白屏；
    // 父窗口(wails://)与 iframe(外部真实域)本就不同源，补此标记不会让 iframe 反向访问父窗口。
    '<iframe id="ws-iframe" style="flex:1;border:none;background:var(--bg)" sandbox="allow-scripts allow-forms allow-popups allow-same-origin"></iframe>' +
    '<div id="ws-blocked" style="display:none;flex:1;align-items:center;justify-content:center;flex-direction:column;gap:8px;color:var(--muted);font-size:12px">' +
    '<div style="font-size:32px">🚫</div>' +
    "<div>" + t("workshop.noEmbed") + "</div>" +
    '<button class="btn-base accent" id="ws-open-fallback">↗ ' + t("workshop.openExternal") + '</button>' +
    "</div>" +
    "</div>" +
    "</div>" +
    "</div>" +
    "</div>"
  );
}
