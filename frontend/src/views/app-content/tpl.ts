// ===== app-content 页面模板 =====

import { isViewerMode } from "@/backend/platform.ts";
import { t } from "@/core/i18n/t.ts";
import { UI_ICONS } from "@/utils/icon/ui-icons.ts";
import { RESOURCE_TYPES } from "@/utils/resource/types.ts";
import { renderSubBar, renderTabs, type TabSpec } from "./tabs-shell.ts";

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
  // ADR-262 D3 修订：目标集选择器（单模型 / 全部类型 / 全库扁平 / registry 各类型）——e2e 用它断言选项来自 registry
  "diag-perf-rtype",
  // ADR-262 D3 修订：排序控件（路径升序 / 体量降序）——与「选谁」正交，故独立成控件而非塞进选择器哨兵
  "diag-perf-order",
  // ADR-262 D3 修订：取样上限——单位 = 目标集的展开单位（标签文案恒为「最多跑几个」，单位只进 title）
  // 标签本身也是 e2e 契约（读它的正文证明「不随模式改义」），故同样给稳定钩子
  "diag-perf-max-label",
  // ADR-278 §2.6：随基准模式改义的标签（迭代次数 / 目标集）——e2e 读它们的正文验证「改义当场说清」
  "diag-perf-iter-label",
  "diag-perf-target-label",
  "diag-perf-max",
  // ADR-262 D8：基准入口三件套（记录 / 对比 / 阈值）——矩阵模式下被禁用
  "diag-perf-baseline-save",
  "diag-perf-baseline-compare",
  "diag-perf-baseline-th",
  // ADR-262 D5：并发基准入口（并发度 / 取样上限 / 运行）——目标集与排序共用上方那一套（ADR-278 §2.2）
  "diag-perf-conc-workers",
  // ADR-278 §2.2：单模型 / 并发**共用**同一套目标集 / 排序控件（即上方登记的 #diag-perf-rtype /
  // #diag-perf-order）——原 diag-perf-conc-target / diag-perf-conc-order 两份 DOM 已删除
  // ADR-300 §2.2（D2）：#diag-perf-mode 下拉退役，模式切换由组内子 pill 承载。
  // 子 pill 钩子 testid 为 `diag-sub-<group>-<id>` **派生**（renderSubBar 单点产出，与 DOM 同源）——
  // 派生值不进步行字面量注册表（test_testid_contract 的收集面只认字面量，先例：app-tree 菜单项），
  // 其契约由 tpl.test.ts 在成品 HTML 上钉（testid + data-sub 双写断言）。
  // ADR-262 D5：性能面板真实载荷渲染断言要能点到运行按钮与结果容器
  "diag-perf-run",
  "diag-perf-model",
  "diag-perf-single",
  "diag-perf-conc-max",
  "diag-perf-conc-run",
  "diag-perf-conc-out",
  // ADR-262 D3：Go/Rust 扫描引擎对照的入口与结果容器（未采集的引擎显示原因而不是 0ms）
  "diag-perf-scan-bench",
  "diag-perf-scan-bench-out",
  // scan-bench 自己的迭代输入框（与 single 模式的 #diag-perf-iter 正交，模式独立参数）
  "diag-perf-scan-iter",
  "diag-perf-scan-iter-label",
  // ADR-288 D2：两个只读扫描的**启动按钮 + 结果区**（两段式：按钮在常驻栏里、结果写结果区）
  "diag-scan-health",
  "diag-health-list",
  "diag-scan-sync-conflict",
  "diag-sync-conflict-list",
];

// settingsHTML 已拆至 settings/tpl-settings.ts，消费者直接 import 叶文件（P1-6）

export function repositoryHTML(): string {
  // 查看器模式（Android/网页版 ADR-049）：回收站/查重/最旧模型依赖本地文件系统
  // 操作（MoveToRecycle/FindDuplicateFiles 等 browser-adapter 未实现）——不再条件 push，
  // 而是无条件声明 desktopOnly 由 renderTabs(viewerMode) 单点隐藏（声明处即真相）
  const tabs: TabSpec[] = [
    {
      id: "tree",
      buttonTestid: "content-tab",
      label: `${UI_ICONS.folder} ${t("repo.tab.tree")}`,
      // 默认 YSM 文件树（预览在外层共享）
      body: `<app-tree root="${RESOURCE_TYPES.YSM}" style="flex:1;min-width:0"></app-tree>`,
    },
  ];
  // 桌面专属 tab（回收站/查重/最旧模型依赖 MoveToRecycle/FindDuplicateFiles 等，
  // browser-adapter 未实现）现在也**无条件声明**：隐藏收进 renderTabs(viewerMode) 单点
  tabs.push(
    {
      id: "recycle",
      desktopOnly: true,
      buttonTestid: "content-tab",
      label: `${UI_ICONS.recycle} ${t("recycle.tab")}`,
      body: "",
      panelStyle: "overflow-y:auto",
    },
    {
      id: "dedup",
      desktopOnly: true,
      buttonTestid: "content-tab",
      label: `${UI_ICONS.link} ${t("repo.tab.dedup")}`,
      body: "",
      panelStyle: "overflow-y:auto;padding:var(--sp-3)",
    },
    {
      id: "oldest",
      desktopOnly: true,
      buttonTestid: "content-tab",
      label: `${UI_ICONS.oldest} ${t("repo.tab.oldest")}`,
      body: "",
      panelStyle: "overflow-y:auto;overflow-x:hidden",
    },
  );
  // tab 结构由 renderTabs 单点产出（ADR-259）：栏与面板**分产**，落位在此决定——
  // 面板组挂 .repo-left（与预览面板并列），故不与 tab 栏相邻
  const { bar, panels } = renderTabs({ prefix: "repo", tabs, viewerMode: isViewerMode() });
  return (
    '<div class="repo-wrap">' +
    bar +
    '<div class="repo-layout" style="flex:1;display:flex;overflow:hidden">' +
    '<div class="repo-left" style="flex:1;display:flex;flex-direction:column;min-width:0">' +
    panels +
    "</div>" +
    '<div class="preview-resize-handle" id="preview-resize-handle" style="width:4px;cursor:col-resize;background:transparent;transition:background var(--tr-fast);flex-shrink:0"></div>' +
    '<app-preview id="app-preview" style="width:var(--preview-width,240px);flex-shrink:0;border-left:1px solid var(--bd)"></app-preview>' +
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

/**
 * 排序选项（ADR-262 D3 修订）：收敛在一个定义里，single / conc 两个控制条共用。
 * 取值域由 Go 冻结（path|size）——第二个副本必然是漂移的起点。
 */
function perfOrderOptionsHTML(): string {
  return (
    `<option value="path">${t("diagnostics.perfOrderPath")}</option>` +
    `<option value="size">${t("diagnostics.perfOrderSize")}</option>`
  );
}

export function diagnosticsHTML(): string {
  // ADR-259：tab 结构改由 renderTabs 单点产出。此前这里是全仓唯一的例外范式——
  // 「一个共享 .tab-body 包 8 个 .diag-panel」，2026-09-17 因漏一个 </div> 使面板被
  // 前一面板吞并，切任何 tab 都只剩空 tab 栏（skills/pitfalls.md #20）。
  // 现与其他页同构：每 tab 一个 .tab-body；panelClass 只保留入场动画钩子。
  const { bar, panels, notice } = renderTabs({
    prefix: "diag",
    panelClass: "diag-panel",
    viewerMode: isViewerMode(),
    // ADR-300 §2.5（D3）：网页版从「沉默消失」变「可见缺席」
    viewerNotice: t("diagnostics.viewerDesktopOnlyNotice"),
    tabs: [
      {
        id: "logs",
        panelTestid: "diag-log",
        // ADR-300 §2.4：顶层名词化，「操作日志」一词还给子 pill（父子同名消解）
        label: `${UI_ICONS.clipboard} ${t("diagnostics.tabLog")}`,
        // ADR-300 §2.1：日志三态（操作/运行时/加载剖析）= 已收集数据的被动查看，全组跨平台
        //（加载剖析读内存 store，ADR-278 §2.5 豁免原样携带）。子 pill 行由 renderSubBar 单点
        // 产出（§2.2）；工具栏与清空按可见集合门控——trace 下工具栏整体退场，clear 只在 op 露面。
        body: `  ${renderSubBar(
          "logs",
          [
            { id: "op", label: t("diagnostics.opsLog") },
            { id: "runtime", label: t("diagnostics.runtimeLog") },
            { id: "trace", label: t("diagnostics.pillTrace") },
          ],
          "op",
        )}
  <div class="diag-log-bar" data-sub-group="logs" data-sub-pane="op runtime">
    <div class="diag-log-row">
      <input id="diag-log-search" class="diag-log-search" placeholder="${t("diagnostics.searchPlaceholder")}">
      <span class="diag-log-bar-spacer"></span>
      <button class="btn-base sm" id="diag-refresh">${t("diagnostics.refresh")}</button>
      <button class="btn-base sm" id="diag-copy" title="${t("diagnostics.copyLog")}">${t("diagnostics.copyLog")}</button>
      <button class="btn-base sm" id="diag-clear" data-sub-group="logs" data-sub-pane="op">${t("diagnostics.clearLog")}</button>
    </div>
    <div class="diag-log-row">
      <div class="diag-log-filter" id="diag-log-filter">
        <button class="diag-log-fbtn active" data-status="all">${t("diagnostics.all")}</button>
        <button class="diag-log-fbtn" data-status="success">${UI_ICONS.success} ${t("diagnostics.success")}</button>
        <button class="diag-log-fbtn" data-status="failed">${UI_ICONS.error} ${t("diagnostics.failed")}</button>
        <button class="diag-log-fbtn" data-status="warn">${UI_ICONS.warning} ${t("diagnostics.warn")}</button>
        <button class="diag-log-fbtn" data-status="skipped">${UI_ICONS.skip} ${t("diagnostics.skipped")}</button>
        <select id="diag-log-op-filter" class="diag-log-op-filter">
          <option value="all">${t("diagnostics.opAll")}</option>
          <option value="import">${t("diagnostics.opImport")}</option>
          <option value="scan">${t("diagnostics.opScan")}</option>
          <option value="download">${t("diagnostics.opDownload")}</option>
          <option value="sync">${t("diagnostics.opSync")}</option>
          <option value="rename">${t("diagnostics.opRename")}</option>
          <option value="delete">${t("diagnostics.opDelete")}</option>
          <option value="ui">${t("diagnostics.opUI")}</option>
        </select>
      </div>
    </div>
  </div>
  <div id="diag-log-list" data-testid="diag-log-list" class="diag-log-scroll" data-sub-group="logs" data-sub-pane="op"><div class="stat-row">${t("diagnostics.noLogs")}</div></div>
  <div id="diag-runtime-list" class="diag-log-scroll" data-testid="diag-runtime" style="display:none" data-sub-group="logs" data-sub-pane="runtime"><div class="stat-row">${t("diagnostics.noRuntimeLogs")}</div></div>
  <div class="diag-sub-pane" data-sub-group="logs" data-sub-pane="trace" style="display:none">
    <div class="diag-log-bar">
      <div class="diag-log-row">
        <button class="btn-base sm" id="diag-perf-refresh-trace">${UI_ICONS.search} ${t("diagnostics.loadTraceRefresh")}</button>
      </div>
    </div>
    <div id="diag-load-trace"></div>
  </div>`,
      },
      {
        id: "bench",
        // ADR-278 §2.5：整 tab 桌面专属——它的每个入口都是 CLI，只藏按钮会留空壳 tab
        desktopOnly: true,
        // ADR-300 §2.4：tab 文案名词化（原 perfRunBench「跑基准」是动宾，动词还给按钮层）
        label: `${UI_ICONS.performance} ${t("diagnostics.tabBench")}`,
        // ADR-300 §2.1（D1 拍板）：引擎对照自顶层平级 tab 迁为本组第三个子 pill——
        // 保留 ADR-278 §2.7 内容判据（自有参数面：仅迭代数，从不触碰目标集/排序，公共区
        // 在 scan 下随 data-perf-mode 整体退场「碰不到 = 诚实」），修订其结构判据。
        // ADR-278 §2.3：取样上限**有意不合并**——单模型深测默认 5 / 并发广度扫默认 20
        // 是两个真实口径（max 仍是两行，各随模式显隐）。
        body: `  <div class="diag-pane">
    ${renderSubBar(
      "bench",
      [
        { id: "single", label: t("diagnostics.perfModeOptSingle") },
        { id: "conc", label: t("diagnostics.perfModeOptConc") },
        { id: "scan", label: t("diagnostics.perfScanBench") },
      ],
      "single",
    )}
    <div class="diag-bar">
      <div class="diag-bar-row" data-perf-mode="single conc">
        <label for="diag-perf-rtype" id="diag-perf-target-label" data-testid="diag-perf-target-label">${t("diagnostics.perfTarget")}</label>
        <select id="diag-perf-rtype" class="diag-config-select" data-testid="diag-perf-rtype">
          <option value="">${t("diagnostics.perfTargetModel")}</option>
        </select>
        <label for="diag-perf-order" id="diag-perf-order-label">${t("diagnostics.perfOrder")}</label>
        <select id="diag-perf-order" class="diag-config-select" data-testid="diag-perf-order">
          ${perfOrderOptionsHTML()}
        </select>
      </div>
      <div class="diag-bar-row" data-perf-mode="single">
        <input id="diag-perf-model" type="text" data-testid="diag-perf-model" placeholder="${t("diagnostics.perfModelPlaceholder")}">
        <label for="diag-perf-baseline-save">${t("diagnostics.perfBaselineSave")}</label>
        <input id="diag-perf-baseline-save" type="checkbox" data-testid="diag-perf-baseline-save">
        <label for="diag-perf-baseline-compare">${t("diagnostics.perfBaselineCompare")}</label>
        <input id="diag-perf-baseline-compare" type="checkbox" data-testid="diag-perf-baseline-compare" title="${t("diagnostics.perfBaselineHint")}">
        <label for="diag-perf-baseline-th">${t("diagnostics.perfBaselineThreshold")}</label>
        <input id="diag-perf-baseline-th" type="number" min="1" step="1" value="50" data-testid="diag-perf-baseline-th">
      </div>
      <div class="diag-bar-row" data-perf-mode="single">
        <button class="btn-base accent" id="diag-perf-run" data-testid="diag-perf-run">${UI_ICONS.performance} ${t("diagnostics.perfRunSingle")}</button>
        <label for="diag-perf-iter" id="diag-perf-iter-label" data-testid="diag-perf-iter-label">${t("diagnostics.perfIterations")}</label>
        <input id="diag-perf-iter" type="number" min="1" step="1" value="3">
        <label for="diag-perf-max" id="diag-perf-max-label" data-testid="diag-perf-max-label" title="${t("diagnostics.perfMaxModelsHint")}">${t("diagnostics.perfMaxModels")}</label>
        <input id="diag-perf-max" type="number" min="1" step="1" value="5" data-testid="diag-perf-max">
      </div>
      <div class="diag-bar-row" data-perf-mode="conc">
        <label for="diag-perf-conc-workers">${t("diagnostics.perfConcurrentWorkers")}</label>
        <input id="diag-perf-conc-workers" type="number" min="1" max="256" step="1" value="4" data-testid="diag-perf-conc-workers">
        <label for="diag-perf-conc-max">${t("diagnostics.perfMaxModels")}</label>
        <input id="diag-perf-conc-max" type="number" min="1" step="1" value="20" data-testid="diag-perf-conc-max" title="${t("diagnostics.perfMaxModelsHint")}">
      </div>
      <div class="diag-bar-row" data-perf-mode="conc">
        <button class="btn-base accent" id="diag-perf-conc-run" data-testid="diag-perf-conc-run">${UI_ICONS.performance} ${t("diagnostics.perfRunConcurrent")}</button>
      </div>
      <div class="diag-bar-row" data-perf-mode="scan">
        <button class="btn-base accent" id="diag-perf-scan-bench" data-testid="diag-perf-scan-bench">${UI_ICONS.performance} ${t("diagnostics.perfScanBenchRun")}</button>
        <label for="diag-perf-scan-iter" id="diag-perf-scan-iter-label" data-testid="diag-perf-scan-iter-label">${t("diagnostics.perfIterations")}</label>
        <input id="diag-perf-scan-iter" type="number" min="1" step="1" value="3" data-testid="diag-perf-scan-iter">
      </div>
      <div class="diag-bar-row" data-perf-mode="scan">
        <div class="diag-bar-hint">${t("diagnostics.perfScanBenchHint")}</div>
      </div>
    </div>
    <div id="diag-perf-single" data-testid="diag-perf-single" data-perf-mode="single"><div class="stat-row" style="padding:var(--sp-vh-block);color:var(--muted);font-size:var(--fs-sm);text-align:center;flex-direction:column;gap:12px">${t("diagnostics.perfIdle")}</div></div>
    <div id="diag-perf-conc-out" data-testid="diag-perf-conc-out" data-perf-mode="conc"><div class="stat-row" style="padding:var(--sp-vh-block);color:var(--muted);font-size:var(--fs-sm);text-align:center;flex-direction:column;gap:12px">${t("diagnostics.perfIdle")}</div></div>
    <div id="diag-perf-scan-bench-out" data-testid="diag-perf-scan-bench-out" data-perf-mode="scan"><div class="stat-row" style="padding:var(--sp-vh-block);color:var(--muted);font-size:var(--fs-sm);text-align:center;flex-direction:column;gap:12px">${t("diagnostics.perfIdle")}</div></div>
  </div>`,
      },
      {
        id: "audit",
        // ADR-300 §2.1：health 与 sync-conflict 是「扫描 → 处置」一对——同触发范式
        //（ADR-288 D2 两段式）、同跨平台属性、同段 CSS 词汇，合组收口；
        // 元素 id 与两段式结构一字不动（历次重构压测试面的成功经验，ADR-278 §3）。
        desktopOnly: true,
        label: `${UI_ICONS.diagnose} ${t("diagnostics.tabAudit")}`,
        body: `  ${renderSubBar(
          "audit",
          [
            { id: "health", label: t("diagnostics.pillHealth") },
            { id: "sync", label: t("diagnostics.syncConflict") },
          ],
          "health",
        )}
  <div class="diag-sub-pane" data-sub-group="audit" data-sub-pane="health">
    <div class="diag-bar" id="diag-health-bar">
      <div class="diag-bar-row">
        <button class="btn-base accent" id="diag-scan-health" data-testid="diag-scan-health">${UI_ICONS.diagnose} ${t("diagnostics.healthRun")}</button>
      </div>
      <div class="diag-bar-row">
        <div class="diag-bar-hint">${t("diagnostics.healthHint")}</div>
      </div>
    </div>
    <div id="diag-health-list" data-testid="diag-health-list"><div class="stat-row" style="padding:var(--sp-vh-block);color:var(--muted);font-size:var(--fs-sm);text-align:center;flex-direction:column;gap:12px">${t("diagnostics.perfIdle")}</div></div>
  </div>
  <div class="diag-sub-pane" data-sub-group="audit" data-sub-pane="sync" style="display:none">
    <div class="diag-bar" id="diag-sync-bar">
      <div class="diag-bar-row">
        <label for="sync-rtype">${UI_ICONS.package} ${t("diagnostics.selectResourceType")}</label>
        <select id="sync-rtype" class="diag-config-select" data-testid="sync-rtype"></select>
        <label for="sync-instance">${UI_ICONS.game} ${t("diagnostics.selectInstance")}</label>
        <select id="sync-instance" class="diag-config-select" data-testid="sync-instance"></select>
        <button class="btn-base accent" id="diag-scan-sync-conflict" data-testid="diag-scan-sync-conflict">${UI_ICONS.search} ${t("diagnostics.scanSyncConflict")}</button>
      </div>
      <div class="diag-bar-row">
        <div class="diag-bar-hint">${t("diagnostics.scanHint")}</div>
      </div>
    </div>
    <div id="diag-sync-conflict-list" data-testid="diag-sync-conflict-list"><div class="stat-row" style="padding:var(--sp-vh-block);color:var(--muted);font-size:var(--fs-sm);text-align:center;flex-direction:column;gap:12px">${t("diagnostics.perfIdle")}</div></div>
  </div>`,
      },
    ],
  });
  // notice 落位在 bar 与 panels 之间（tablist 外，ADR-300 §2.5 / ADR-258 §2.4）
  return `<div class="repo-wrap">${bar}${notice}${panels}</div>`;
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
    '<span style="padding:var(--btn-padding-filter-lg);font-size:var(--fs-sm);color:var(--muted)">' +
    UI_ICONS.refresh +
    " " +
    t("common.loading") +
    "</span>" +
    "</div>" +
    // 站点配置导入/导出工具栏（index.ts ws-export-btn / ws-import-btn 绑定）
    '<div style="display:flex;gap:6px;padding:var(--btn-padding-filter-lg);border-bottom:1px solid var(--bd);flex-shrink:0">' +
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
    '<div style="font-size:var(--fs-xl)">' +
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
