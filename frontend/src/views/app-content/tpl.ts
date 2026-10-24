// ===== app-content 页面模板 =====

import { isViewerMode } from "@/backend/platform.ts";
import { t } from "@/core/i18n/t.ts";
import { UI_ICONS } from "@/utils/icon/ui-icons.ts";
import { readLastTab, renderTabs, type TabSpec } from "./tabs-shell.ts";

// ADR-133 阶段 B：本视图稳定 testid 声明（G-1 钩子单一事实源）。
// 删除/新增对应 data-testid 须同步本数组；契约测试运行期静态聚合本数组为注册表。
// ADR-133 阶段 C+：e2e 定位通道收敛——原用 #id 定位的元素改配同名 data-testid
// （id 保留给 handler / CSS 锚点，testid 独占测试通道，二者同名以消除认知负担）。
export const VIEW_TESTIDS: readonly string[] = [
  // 锐评 P2 收口（2026-10-14）：`content-tab` 原是仓库页四个顶层 tab 的退化 testid
  // （4 tab 共用、正向消费者为零），已删——顶层 tab 用 `data-tab` 定位（.repo-tab[data-tab=...]）。
  // 诊断页顶层 tab 按钮（三个 tab 共用，与仓库页 content-tab 同形；此前诊断页是唯一
  // 没给顶层 tab 留钩子的页，测试只能靠 .repo-tab 的 data-tab 属性去抓 class）
  "diag-tab",
  "diag-log",
  "diag-log-list",
  "diag-runtime",
  // 2026-10-04 补钩债务清账（阶段 C+ 同名约定）：日志工具栏 6 元素原只有 id、无 testid，
  // e2e diagnostics.spec 版面用例走 rect("#id") 落 REVIEW 债——id 保留给 handler / CSS
  // 锚点，testid 独占测试通道，二者同名。
  "diag-log-search",
  "diag-log-filter",
  "diag-log-op-filter",
  "diag-refresh",
  "diag-copy",
  "diag-export",
  "diag-clear",
  // ADR-322 D1：日志通道健康红条（常驻显隐，初始 display:none，由 channel-health.ts
  // 按 GetLogChannelHealth 填充）。留 testid 供 e2e 断言「不健康时出现、健康时隐藏」——
  // 这是唯一能证伪「红条恒显/永不显」的钩子，id 仍为 handler 锚点。
  "diag-log-channel-health",
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
  // 2026-10-15 锐评改进 P0：基准三件套的密度开关（简版收起 / 进阶展开）——
  // e2e 与单测按此断言「收起时勾选归零、进阶态跨会话保留」；id 归 handler / CSS 锚点。
  "diag-perf-density",
  // 2026-10-15 锐评 P1：阶段→加载剖析下钻的「未命中缺席提示行」——
  // 下钻到 trace 但 store 里没有该模型记录时插入，e2e 按它断言「缺席事实被说清」而非静默空态。
  "diag-drill-miss",
  // 2026-10-15 锐评 P1：下钻按钮本身（单模型结果区头）——e2e 用 testid 定位点击，比类名稳。
  "diag-drill-trace",
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
  // C13 #4 护栏收口（2026-10-04）：性能错误横幅钩子（perf-common|errorHTML 单一出处，
  // baselineBannerHTML 亦委托它）——e2e 按此 testid 读横幅，替代同名双产出的 class 锚点
  "diag-perf-error",
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
  // 全部 tab 单点声明（含 desktopOnly）：隐藏收进 renderTabs(viewerMode) 单点，
  // 「要不要藏」写在定义它的地方（ADR-259 同构精神），不再另写远处的选择器名单。
  // 查看器模式（Android/网页版 ADR-049）：回收站/查重/最旧模型依赖本地文件系统
  // 操作（MoveToRecycle/FindDuplicateFiles 等 browser-adapter 未实现）——无条件声明
  // desktopOnly，由 renderTabs(viewerMode) 统一隐藏（声明处即真相）。
  const tabs: TabSpec[] = [
    {
      id: "tree",
      label: `${UI_ICONS.folder} ${t("repo.tab.tree")}`,
      // body 留空：初始挂载全权归 initRepositoryPage.mountTree（localStorage 恢复 rtype/subdir）。
      // 此前模板硬编码 <app-tree root="YSM">，而 init 必然无条件替换 innerHTML——首挂必经历
      // 「app-tree connect（发起扫描 RPC）→ 立即销毁」，模板默认值沦为死的第二真值源
      body: "",
    },
    {
      id: "recycle",
      desktopOnly: true,
      label: `${UI_ICONS.recycle} ${t("recycle.tab")}`,
      body: "",
      panelStyle: "overflow-y:auto",
    },
    {
      id: "dedup",
      desktopOnly: true,
      label: `${UI_ICONS.link} ${t("repo.tab.dedup")}`,
      body: "",
      panelStyle: "overflow-y:auto;padding:var(--sp-3)",
    },
    {
      id: "oldest",
      desktopOnly: true,
      label: `${UI_ICONS.oldest} ${t("repo.tab.oldest")}`,
      body: "",
      panelStyle: "overflow-y:auto;overflow-x:hidden",
    },
  ];
  // tab 结构由 renderTabs 单点产出（ADR-259）：栏与面板**分产**，落位在此决定——
  // 面板组挂 .repo-left（与预览面板并列），故不与 tab 栏相邻
  const { bar, panels, notice } = renderTabs({
    prefix: "repo",
    tabs,
    viewerMode: isViewerMode(),
    // 锐评 P2 #5 收口：恢复上次激活的 tab（语言热切换不再弹回首 tab）
    initialActiveId: readLastTab("repo"),
    // ADR-300 §2.5：查看器「可见缺席」——desktopOnly tab 被隐藏时在 tablist 外告知
    //（与诊断页同构；此前仓库页缺席此告知，网页版三个 tab 静默消失且 tab 栏整块退化缺席）
    viewerNotice: t("repo.viewerDesktopOnlyNotice"),
  });
  // notice 落位在 bar 与 repo-layout 之间（tablist 外，ADR-300 §2.5 / ADR-258 §2.4）
  return (
    '<div class="repo-wrap">' +
    bar +
    notice +
    '<div class="repo-layout">' +
    '<div class="repo-left">' +
    panels +
    "</div>" +
    '<div class="preview-resize-handle" id="preview-resize-handle"></div>' +
    // 宽度真值单点归 init-preview（localStorage 恢复/拖拽持久化）——此处不再写
    // var(--preview-width,240px)（全仓无 producer 的死引用）
    '<app-preview id="app-preview" style="flex-shrink:0;border-left:1px solid var(--bd)"></app-preview>' +
    "</div>" +
    "</div>"
  );
}

export function instancesHTML(): string {
  // ADR-300 §2.5：整合包页对齐「可见缺席」范式——tab 声明 desktopOnly + viewerNotice（锐评 P1-5）
  const { bar, panels, notice } = renderTabs({
    prefix: "ins",
    viewerMode: isViewerMode(),
    initialActiveId: readLastTab("ins"),
    viewerNotice: t("instances.viewerDesktopOnlyNotice"),
    tabs: [
      {
        id: "versions",
        desktopOnly: true,
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
  return `<div class="repo-wrap">${bar}${notice}${panels}</div>`;
}
// recycleHTML 已拆至 tpl-recycle.ts，消费者直接 import 叶文件（P1-6）

// 诊断页模板已拆至 tpl-diagnostics.ts（2026-10 体积收债，561 → 400 线下）。
// 保留本行转发而非改全部消费者：这是**单来源垫片**，不是聚合桶——本文件主体仍是
// repositoryHTML / instancesHTML / githubHTML / workshopHTML + VIEW_TESTIDS。
export { diagnosticsHTML } from "./tpl-diagnostics.ts";

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
    '<div class="ws-toolbar">' +
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
    '<div class="cr-page">' +
    '<div class="cr-right ws-right">' +
    '<div class="cr-right-inner">' +
    '<div class="ws-search-view" id="ws-search-view" data-testid="ws-search-view">' +
    '<div class="ws-search-results" id="ws-search-results" data-testid="ws-search-results">' +
    '<div style="color:var(--muted);font-size:var(--fs-xs);padding:12px 0;text-align:center">' +
    t("common.loading") +
    "</div>" +
    "</div>" +
    "</div>" +
    "</div>" +
    "</div>" +
    '<div class="ws-browser" id="ws-browser">' +
    '<div class="ws-browser-bar">' +
    '<button class="btn-base sm ws-back" id="ws-back">' +
    UI_ICONS.back +
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
    '<iframe class="ws-iframe" id="ws-iframe" sandbox="allow-scripts allow-forms allow-popups allow-same-origin"></iframe>' +
    '<div class="ws-blocked" id="ws-blocked">' +
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
