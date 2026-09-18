// ===== app-content 页面模板 =====

import { isViewerMode } from "@/backend/platform.ts";
import { t } from "@/core/i18n/t.ts";
import { UI_ICONS } from "@/utils/icon/ui-icons.ts";
import { RESOURCE_TYPES } from "@/utils/resource/types.ts";
import { renderTabs, type TabSpec } from "./tabs-shell.ts";

// ADR-133 阶段 B：本视图稳定 testid 声明（G-1 钩子单一事实源）。
// 删除/新增对应 data-testid 须同步本数组；契约测试运行期静态聚合本数组为注册表。
// ADR-133 阶段 C+：e2e 定位通道收敛——原用 #id 定位的元素改配同名 data-testid
// （id 保留给 handler / CSS 锚点，testid 独占测试通道，二者同名以消除认知负担）。
export const VIEW_TESTIDS: readonly string[] = [
  "content-tab",
  "diag-log",
  "diag-log-list",
  "diag-runtime",
  "ins-content",
  "ws-tabs",
  "ws-search-view",
  "ws-search-results",
  // ADR-262 D3：性能 tab 的类型选择器（矩阵入口，e2e 用它断言选项来自 registry）
  "diag-perf-rtype",
  // ADR-262 D3：目标集条数入口——矩阵模式下是「每类上限」，前 N 大模式下是「N」（同一控件，语义随模式变）
  "diag-perf-max",
  // ADR-262 D8：基准入口三件套（记录 / 对比 / 阈值）——矩阵模式下被禁用
  "diag-perf-baseline-save",
  "diag-perf-baseline-compare",
  "diag-perf-baseline-th",
  // ADR-262 D5：并发基准入口（并发度 / 每类上限 / 运行）
  "diag-perf-conc-workers",
  // ADR-262 D5：性能面板真实载荷渲染断言要能点到运行按钮与结果容器
  "diag-perf-run",
  "diag-perf-model",
  "diag-perf-single",
  "diag-perf-gui-run",
  "diag-perf-gui-out",
  "diag-perf-conc-max",
  "diag-perf-conc-run",
  "diag-perf-conc-out",
  // ADR-262 D3：Go/Rust 扫描引擎对照的入口与结果容器（未采集的引擎显示原因而不是 0ms）
  "diag-perf-scan-bench",
  "diag-perf-scan-bench-out",
];

// settingsHTML 已拆至 settings/tpl-settings.ts，消费者直接 import 叶文件（P1-6）

export function repositoryHTML(): string {
  // 查看器模式（Android/网页版 ADR-049）：回收站/查重/最旧模型依赖本地文件系统
  // 操作（MoveToRecycle/FindDuplicateFiles 等 browser-adapter 未实现），隐藏对应 tab
  const tabs: TabSpec[] = [
    {
      id: "tree",
      buttonTestid: "content-tab",
      label: `${UI_ICONS.folder} ${t("repo.tab.tree")}`,
      // 默认 YSM 文件树（预览在外层共享）
      body: `<app-tree root="${RESOURCE_TYPES.YSM}" style="flex:1;min-width:0"></app-tree>`,
    },
  ];
  if (!isViewerMode()) {
    tabs.push(
      {
        id: "recycle",
        buttonTestid: "content-tab",
        label: `${UI_ICONS.recycle} ${t("recycle.tab")}`,
        body: "",
        panelStyle: "overflow-y:auto",
      },
      {
        id: "dedup",
        buttonTestid: "content-tab",
        label: `${UI_ICONS.link} ${t("repo.tab.dedup")}`,
        body: "",
        panelStyle: "overflow-y:auto;padding:12px",
      },
      {
        id: "oldest",
        buttonTestid: "content-tab",
        label: `${UI_ICONS.oldest} ${t("repo.tab.oldest")}`,
        body: "",
        panelStyle: "overflow-y:auto;overflow-x:hidden",
      },
    );
  }
  // tab 结构由 renderTabs 单点产出（ADR-259）：栏与面板**分产**，落位在此决定——
  // 面板组挂 .repo-left（与预览面板并列），故不与 tab 栏相邻
  const { bar, panels } = renderTabs({ prefix: "repo", tabs });
  return (
    '<div class="repo-wrap">' +
    bar +
    '<div class="repo-layout" style="flex:1;display:flex;overflow:hidden">' +
    '<div class="repo-left" style="flex:1;display:flex;flex-direction:column;min-width:0">' +
    panels +
    "</div>" +
    '<div class="preview-resize-handle" id="preview-resize-handle" style="width:4px;cursor:col-resize;background:transparent;transition:background var(--tr-fast);flex-shrink:0"></div>' +
    '<app-preview id="app-preview" style="width:var(--preview-width,220px);flex-shrink:0;border-left:1px solid var(--bd)"></app-preview>' +
    "</div>" +
    "</div>"
  );
}

export function instancesHTML(): string {
  const { bar, panels } = renderTabs({
    prefix: "ins",
    tabs: [
      {
        id: "versions",
        label: `${UI_ICONS.game} ${t("instances.tab.versions")}`,
        body: `<div class="repo-layout">
<app-sidebar class="ins-sidebar"></app-sidebar>
<div class="ins-content" id="ins-content" data-testid="ins-content" style="display:flex;flex-direction:column;overflow:hidden">
<div class="placeholder-box">
<div class="big">${UI_ICONS.pointerLeft}</div>
<div>${t("instances.emptyHint")}</div>
</div>
</div>
</div>`,
      },
    ],
  });
  return `<div class="repo-wrap">${bar}${panels}</div>`;
}
// recycleHTML 已拆至 tpl-recycle.ts，消费者直接 import 叶文件（P1-6）

export function diagnosticsHTML(): string {
  // ADR-259：tab 结构改由 renderTabs 单点产出。此前这里是全仓唯一的例外范式——
  // 「一个共享 .tab-body 包 8 个 .diag-panel」，2026-09-17 因漏一个 </div> 使面板被
  // 前一面板吞并，切任何 tab 都只剩空 tab 栏（skills/pitfalls.md #20）。
  // 现与其他页同构：每 tab 一个 .tab-body；panelClass 只保留入场动画钩子。
  const { bar, panels } = renderTabs({
    prefix: "diag",
    panelClass: "diag-panel",
    tabs: [
      {
        id: "log",
        panelTestid: "diag-log",
        label: `${UI_ICONS.clipboard} ${t("diagnostics.opsLog")}`,
        body: `  <div class="diag-log-bar">
    <div class="diag-log-row">
      <div class="diag-log-subtabs">
        <button class="diag-sub-tab active" data-log="op">${t("diagnostics.opsLog")}</button>
        <button class="diag-sub-tab" data-log="runtime">${t("diagnostics.runtimeLog")}</button>
      </div>
      <span class="diag-log-bar-spacer"></span>
      <button class="btn-base sm" id="diag-refresh">${t("diagnostics.refresh")}</button>
      <button class="btn-base sm" id="diag-copy" title="${t("diagnostics.copyLog")}">${t("diagnostics.copyLog")}</button>
      <button class="btn-base sm" id="diag-clear">${t("diagnostics.clearLog")}</button>
    </div>
    <div class="diag-log-row">
      <div class="diag-log-filter" id="diag-log-filter">
        <button class="diag-log-fbtn active" data-status="all">${t("diagnostics.all")}</button>
        <button class="diag-log-fbtn" data-status="success">${UI_ICONS.success} ${t("diagnostics.success")}</button>
        <button class="diag-log-fbtn" data-status="failed">${UI_ICONS.error} ${t("diagnostics.failed")}</button>
        <button class="diag-log-fbtn" data-status="skipped">${UI_ICONS.performance} ${t("diagnostics.skipped")}</button>
        <input id="diag-log-search" placeholder="${t("diagnostics.searchPlaceholder")}">
      </div>
    </div>
  </div>
  <div id="diag-log-list" data-testid="diag-log-list" class="diag-log-scroll"><div class="stat-row">${t("diagnostics.noLogs")}</div></div>
  <div id="diag-runtime-list" class="diag-log-scroll" data-testid="diag-runtime" style="display:none"><div class="stat-row">${t("diagnostics.noRuntimeLogs")}</div></div>`,
      },
      {
        id: "single",
        label: `${UI_ICONS.clock} ${t("diagnostics.perfRunSingle")}`,
        body: `  <div class="perf-wrap">
    <div class="perf-controls">
      <button class="btn-base accent" id="diag-perf-run" data-testid="diag-perf-run">${UI_ICONS.performance} ${t("diagnostics.perfRunSingle")}</button>
      <input id="diag-perf-model" type="text" data-testid="diag-perf-model" placeholder="${t("diagnostics.perfModelPlaceholder")}">
      <label for="diag-perf-iter">${t("diagnostics.perfIterations")}</label>
      <input id="diag-perf-iter" type="number" min="1" step="1" value="3">
      <label for="diag-perf-rtype">${t("diagnostics.perfRtype")}</label>
      <select id="diag-perf-rtype" class="diag-config-select" data-testid="diag-perf-rtype">
        <option value="">${t("diagnostics.perfRtypeSingle")}</option>
      </select>
      <label for="diag-perf-max" id="diag-perf-max-label">${t("diagnostics.perfMaxModels")}</label>
      <input id="diag-perf-max" type="number" min="1" step="1" value="5" data-testid="diag-perf-max">
      <label for="diag-perf-baseline-save">${t("diagnostics.perfBaselineSave")}</label>
      <input id="diag-perf-baseline-save" type="checkbox" data-testid="diag-perf-baseline-save">
      <label for="diag-perf-baseline-compare">${t("diagnostics.perfBaselineCompare")}</label>
      <input id="diag-perf-baseline-compare" type="checkbox" data-testid="diag-perf-baseline-compare" title="${t("diagnostics.perfBaselineHint")}">
      <label for="diag-perf-baseline-th">${t("diagnostics.perfBaselineThreshold")}</label>
      <input id="diag-perf-baseline-th" type="number" min="1" step="1" value="50" data-testid="diag-perf-baseline-th">
      <button class="btn-base" id="diag-perf-scan-bench" data-testid="diag-perf-scan-bench" title="${t("diagnostics.perfScanBenchHint")}">${UI_ICONS.performance} ${t("diagnostics.perfScanBenchRun")}</button>
    </div>
    <div id="diag-perf-single" data-testid="diag-perf-single"></div>
    <div id="diag-perf-scan-bench-out" data-testid="diag-perf-scan-bench-out"></div>
  </div>`,
      },
      {
        id: "gui",
        label: `${UI_ICONS.diagnose} ${t("diagnostics.perfRunGui")}`,
        body: `  <div class="perf-wrap">
    <div class="perf-controls">
      <button class="btn-base" id="diag-perf-gui" data-testid="diag-perf-gui-run">${UI_ICONS.diagnose} ${t("diagnostics.perfRunGui")}</button>
    </div>
    <div id="diag-perf-gui-out" data-testid="diag-perf-gui-out"></div>
  </div>`,
      },
      {
        // ADR-262 D5：串行 vs 并行的加速比（第一手压测数据）——判决由 Go 单点给出，前端只渲染
        id: "conc",
        label: `${UI_ICONS.performance} ${t("diagnostics.perfRunConcurrent")}`,
        body: `  <div class="perf-wrap">
    <div class="perf-controls">
      <button class="btn-base" id="diag-perf-conc-run" data-testid="diag-perf-conc-run">${UI_ICONS.performance} ${t("diagnostics.perfRunConcurrent")}</button>
      <label for="diag-perf-conc-workers">${t("diagnostics.perfConcurrentWorkers")}</label>
      <input id="diag-perf-conc-workers" type="number" min="1" max="256" step="1" value="4" data-testid="diag-perf-conc-workers">
      <label for="diag-perf-conc-max">${t("diagnostics.perfMaxModels")}</label>
      <input id="diag-perf-conc-max" type="number" min="1" step="1" value="20" data-testid="diag-perf-conc-max" title="${t("diagnostics.perfConcurrentHint")}">
    </div>
    <div id="diag-perf-conc-out" data-testid="diag-perf-conc-out"></div>
  </div>`,
      },
      {
        id: "hist",
        label: `${UI_ICONS.note} ${t("diagnostics.perfPerfLog")}`,
        body: `  <div class="perf-wrap">
    <div class="perf-controls">
      <button class="btn-base" id="diag-perf-log">${UI_ICONS.note} ${t("diagnostics.perfPerfLog")}</button>
    </div>
    <div id="diag-perf-hist"></div>
  </div>`,
      },
      {
        id: "trace",
        label: `${UI_ICONS.search} ${t("diagnostics.loadTraceTitle")}`,
        body: `  <div class="perf-wrap">
    <div class="perf-controls">
      <button class="btn-base" id="diag-perf-refresh-trace">${UI_ICONS.search} ${t("diagnostics.loadTraceRefresh")}</button>
    </div>
    <div id="diag-load-trace"></div>
  </div>`,
      },
      {
        id: "conflict",
        label: `${UI_ICONS.performance} ${t("diagnostics.conflict")}`,
        body: `  <div id="diag-conflict-list"><div class="stat-row" style="padding:24px 12px;color:var(--muted);font-size:var(--fs-sm);text-align:center;flex-direction:column;gap:12px">${t("diagnostics.scanHint")}
  <button class="btn-base accent" id="diag-scan-conflict" style="margin-top:4px">${UI_ICONS.performance} ${t("diagnostics.startScan")}</button>
  </div></div>`,
      },
      {
        id: "health",
        label: `${UI_ICONS.diagnose} ${t("diagnostics.healthTitle")}`,
        body: `  <div id="diag-health-list"><div class="stat-row" style="padding:24px 12px;color:var(--muted);font-size:var(--fs-sm);text-align:center;flex-direction:column;gap:12px">${t("diagnostics.healthHint")}
  <button class="btn-base accent" id="diag-scan-health" style="margin-top:4px">${UI_ICONS.diagnose} ${t("diagnostics.healthRun")}</button>
  </div></div>`,
      },
      {
        id: "sync-conflict",
        label: `${UI_ICONS.refresh} ${t("diagnostics.syncConflict")}`,
        body: `  <div id="diag-sync-conflict-list"><div class="stat-row" style="padding:24px 12px;color:var(--muted);font-size:var(--fs-sm);text-align:center;flex-direction:column;gap:12px">${t("diagnostics.scanHint")}
  <button class="btn-base accent" id="diag-scan-sync-conflict" style="margin-top:4px">${UI_ICONS.search} ${t("diagnostics.scanSyncConflict")}</button>
  </div></div>`,
      },
    ],
  });
  return `<div class="repo-wrap">${bar}${panels}</div>`;
}

/* ===== GitHub 仓库页面 ===== */

export function githubHTML(): string {
  // ADR-259：tab 壳走 renderTabs。按钮 data-tab 由 "github" 校正为 "repos"，
  // 与面板 id `gh-tab-repos` 对齐（原二者不一致，且无消费者依赖旧值）。
  const { bar, panels } = renderTabs({
    prefix: "gh",
    tabs: [
      {
        id: "repos",
        label: `${UI_ICONS.github} ${t("workshop.title")}`,
        body: `  <div class="gh-page" id="gh-page">
  <div class="gh-left" id="gh-left">
  <div class="gh-left-head">
  <span class="gh-left-head-label">${t("gh.leftHead")}</span>
  <span class="gh-left-head-spacer"></span>
  </div>
  <div class="gh-grid" id="gh-grid">
  <div class="gh-loading-placeholder">${UI_ICONS.refresh} ${t("common.loading")}</div>
  </div>
  <div class="gh-left-foot">${t("gh.sourceInfo")}: <span id="gh-source-info">-</span></div>
  </div>
  <div class="gh-right" id="gh-right">
  <div class="gh-right-inner" id="gh-right-inner">
  <div id="gh-results">
  <div id="gh-results-body">
  <div class="gh-initial-hint">${t("gh.initialHint")}</div>
  </div></div></div></div></div>`,
      },
    ],
  });
  return `<div class="repo-wrap">${bar}${panels}</div>`;
}

export function workshopHTML(): string {
  // 站点 Tab 由 initWorkshopPage 动态生成，此处只放容器
  return (
    '<div class="repo-wrap">' +
    '<div class="repo-tabs" id="ws-tabs" data-testid="ws-tabs">' +
    '<span style="padding:4px 12px;font-size:var(--fs-sm);color:var(--muted)">' +
    UI_ICONS.refresh +
    " " +
    t("common.loading") +
    "</span>" +
    "</div>" +
    // 站点配置导入/导出工具栏（index.ts ws-export-btn / ws-import-btn 绑定）
    '<div style="display:flex;gap:6px;padding:4px 12px;border-bottom:1px solid var(--bd);flex-shrink:0">' +
    '<button class="btn-base sm" id="ws-export-btn" title="' +
    t("workshop.exportSiteTitle") +
    '">' +
    UI_ICONS.upload +
    " " +
    t("workshop.exportSite") +
    "</button>" +
    '<button class="btn-base sm" id="ws-import-btn" title="' +
    t("workshop.importSiteTitle") +
    '">' +
    UI_ICONS.import +
    " " +
    t("workshop.importSite") +
    "</button>" +
    "</div>" +
    '<div class="tab-body" id="cr-tab-creators">' +
    '<div class="cr-page" id="ws-page">' +
    '<div class="cr-right" style="width:100%;flex:1;display:flex;flex-direction:column;overflow:hidden" id="ws-right">' +
    '<div class="cr-right-inner" id="ws-right-inner">' +
    '<div id="ws-search-view" data-testid="ws-search-view" style="flex:1;display:flex;flex-direction:column;overflow:hidden">' +
    '<div id="ws-search-results" data-testid="ws-search-results" style="flex:1;overflow-y:auto;padding:0 12px 8px">' +
    '<div style="color:var(--muted);font-size:var(--fs-xs);padding:12px 0;text-align:center">' +
    t("common.loading") +
    "</div>" +
    "</div>" +
    "</div>" +
    '<div id="ws-creator-view" style="display:none;flex:1;flex-direction:column;overflow:hidden">' +
    '<div style="padding:8px 12px;display:flex;align-items:center;gap:6px;border-bottom:1px solid var(--bd)">' +
    '<span style="font-size:var(--fs-base);font-weight:600;color:var(--txt)" id="ws-cr-title">' +
    UI_ICONS.appearance +
    " " +
    t("workshop.activeCreators") +
    "</span>" +
    '<span style="font-size:var(--fs-micro);color:var(--muted);margin-left:auto">creators/</span>' +
    "</div>" +
    '<div class="ws-creators-list" id="ws-cr-list"></div>' +
    "</div>" +
    "</div>" +
    "</div>" +
    '<div id="ws-browser" style="display:none;flex:1;flex-direction:column;overflow:hidden;position:absolute;inset:0;z-index:10;background:var(--bg)">' +
    '<div class="ws-browser-bar">' +
    '<button class="btn-base sm ws-back" id="ws-back">' +
    UI_ICONS.navigate +
    " " +
    t("common.back") +
    "</button>" +
    '<span class="ws-url" id="ws-url"></span>' +
    '<button class="btn-base sm ws-btn-txt" id="ws-win-open" title="' +
    t("workshop.openWindow") +
    '">' +
    UI_ICONS.window +
    "</button>" +
    '<button class="btn-base sm ws-open-btn" id="ws-open">' +
    UI_ICONS.external +
    " " +
    t("workshop.openBrowser") +
    "</button>" +
    "</div>" +
    // [ADR-077] allow-same-origin 必需：缺此标记时 iframe origin 被强制为 null（opaque origin），
    // 登录站 SPA（如模之屋 aplaybox）的 fetch/XHR 会被浏览器 CORS 拦截白屏；
    // 父窗口(wails://)与 iframe(外部真实域)本就不同源，补此标记不会让 iframe 反向访问父窗口。
    '<iframe id="ws-iframe" style="flex:1;border:none;background:var(--bg)" sandbox="allow-scripts allow-forms allow-popups allow-same-origin"></iframe>' +
    '<div id="ws-blocked" style="display:none;flex:1;align-items:center;justify-content:center;flex-direction:column;gap:8px;color:var(--muted);font-size:var(--fs-base)">' +
    '<div style="font-size:32px">' +
    UI_ICONS.blocked +
    "</div>" +
    "<div>" +
    t("workshop.noEmbed") +
    "</div>" +
    '<button class="btn-base accent" id="ws-open-fallback">' +
    UI_ICONS.external +
    " " +
    t("workshop.openExternal") +
    "</button>" +
    "</div>" +
    "</div>" +
    "</div>" +
    "</div>" +
    "</div>"
  );
}
