// ===== 诊断页模板（从 tpl.ts 拆出，2026-10 体积收债）=====
//
// 拆出理由 = **文件体积**，不是格式外迁：tpl.ts 曾 561 行，越了知识卡
// `docs/knowledge/ui-format-partition.md` B 组的「单 tpl.ts > 400 行」触发线。
// 按该卡 C 组顺序，体积问题的正确动作是**拆子模板**（同族先例：tpl-workshop.ts /
// tpl-oldest.ts / tpl-recycle.ts / tpl-dedup.ts），HTML/CSS/SVG 仍是 TS 字符串、
// 不引入任何模板引擎——A 组根框架不变量不变。
//
// 内容逐段 verbatim 搬自 tpl.ts 的 `perfOrderOptionsHTML` + `diagnosticsHTML`，未重排、未改写
// （唯一改动是 `lastTabOf` → `readLastTab` 的调用名，随函数上提）。
// 注意本文件**不在** scripts/check-redlines.ts 的 `/tpl.ts$` 硬编码颜色豁免名单内
// （该豁免按文件名精确匹配）——此处新增颜色字面量会被判红，样式一律走 CSS 变量。

import { isViewerMode } from "@/backend/platform.ts";
import { t } from "@/core/i18n/t.ts";
import { UI_ICONS } from "@/utils/icon/ui-icons.ts";
import { OP_META } from "@/views/app-content/diagnostics/logs.ts";
import { readLastTab, renderSubBar, renderTabs } from "./tabs-shell.ts";

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
    initialActiveId: readLastTab("diag"),
    // ADR-300 §2.5（D3）：网页版从「沉默消失」变「可见缺席」
    viewerNotice: t("diagnostics.viewerDesktopOnlyNotice"),
    tabs: [
      {
        id: "logs",
        buttonTestid: "diag-tab",
        panelTestid: "diag-log",
        // ADR-300 §2.4：顶层名词化，「操作日志」一词还给子 pill（父子同名消解）
        label: `${UI_ICONS.clipboard} ${t("diagnostics.tabLog")}`,
        // ADR-300 §2.1：日志三态（操作/运行时/加载剖析）= 已收集数据的被动查看，全组跨平台
        //（加载剖析读内存 store，ADR-278 §2.5 豁免原样携带）。子 pill 行由 renderSubBar 单点
        // 产出（§2.2）；工具栏与清空按可见集合门控——trace 下工具栏整体退场，clear 只在 op 露面。
        body: `  <div class="diag-pane">
    ${renderSubBar(
      "logs",
      [
        { id: "op", label: t("diagnostics.opsLog") },
        { id: "runtime", label: t("diagnostics.runtimeLog") },
        { id: "trace", label: t("diagnostics.pillTrace") },
      ],
      "op",
      t("diagnostics.subBarLogs"),
    )}
    <div class="diag-bar" data-sub-group="logs" data-sub-pane="op runtime">
      <div class="diag-bar-row">
        <input id="diag-log-search" data-testid="diag-log-search" class="diag-log-search" placeholder="${t("diagnostics.searchPlaceholder")}">
        <span class="diag-bar-spacer"></span>
        <button class="btn-base sm" id="diag-refresh" data-testid="diag-refresh">${t("diagnostics.refresh")}</button>
        <button class="btn-base sm" id="diag-copy" data-testid="diag-copy" title="${t("diagnostics.copyLog")}">${t("diagnostics.copyLog")}</button>
        <button class="btn-base sm" id="diag-export" data-testid="diag-export" title="${t("diagnostics.exportLog")}">${t("diagnostics.exportLog")}</button>
        <button class="btn-base sm" id="diag-clear" data-testid="diag-clear" data-sub-group="logs" data-sub-pane="op">${t("diagnostics.clearLog")}</button>
      </div>
      <div class="diag-bar-row">
        <div class="diag-log-filter" id="diag-log-filter" data-testid="diag-log-filter">
        <button class="diag-log-fbtn active" data-status="all">${t("diagnostics.all")}</button>
        <button class="diag-log-fbtn" data-status="success">${UI_ICONS.success} ${t("diagnostics.success")}</button>
        <button class="diag-log-fbtn" data-status="failed">${UI_ICONS.error} ${t("diagnostics.failed")}</button>
        <button class="diag-log-fbtn" data-status="warn">${UI_ICONS.warning} ${t("diagnostics.warn")}</button>
        <button class="diag-log-fbtn" data-status="skipped">${UI_ICONS.skip} ${t("diagnostics.skipped")}</button>
        <select id="diag-log-op-filter" data-testid="diag-log-op-filter" class="diag-log-op-filter" data-sub-group="logs" data-sub-pane="op">
          <!-- data-sub-pane="op"（2026-10-12）：操作类型只对操作日志成立——types.RuntimeLog
               没有 Operation 字段（只有 Message/Level/Tag/Time），运行时子屏下这个下拉的
               change 处理器是**空操作**（init.ts 的 dgInBindLogOpFilter 只在非 runtime 时
               重载列表）。与其留一个「看得见、点不动」的控件，不如按声明式门控整项退场
               （同 diag-clear）。顺带消掉跨屏状态污染：此前在 runtime 屏误选的值会残留，
               切回 op 屏直接把操作日志筛窄，用户只看到「日志怎么变少了」。chips 不受
               影响——ADR-289 已让它在 runtime 下按 Level 真正生效，筛选能力不丢。
               ⚠️ 本注释位于模板字符串内，反引号会提前闭合字符串（知识卡已记过同类坑）。 -->
          <option value="all">${t("diagnostics.opAll")}</option>
          ${
            /* 选项集 = OP_META 键集派生（2026-10-13 收口：原七个 option 手写镜像，注释自称
             「与 logs.ts|OP_META 同源」实为零机器连线；新增操作类型现只改 OP_META 一处） */
            Object.entries(OP_META)
              .map(([id, m]) => `<option value="${id}">${t(m.labelKey)}</option>`)
              .join("")
          }
        </select>
        </div>
      </div>
    </div>
    <div class="diag-channel-health" id="diag-log-channel-health" data-testid="diag-log-channel-health" data-sub-group="logs" data-sub-pane="op runtime" style="display:none"></div>
    <div class="diag-result" id="diag-log-list" data-testid="diag-log-list" data-sub-group="logs" data-sub-pane="op"><div class="stat-row">${t("diagnostics.noLogs")}</div></div>
    <div class="diag-result" id="diag-runtime-list" data-testid="diag-runtime" style="display:none" data-sub-group="logs" data-sub-pane="runtime"><div class="stat-row">${t("diagnostics.noRuntimeLogs")}</div></div>
    <div class="diag-pane" data-sub-group="logs" data-sub-pane="trace" style="display:none">
      <div class="diag-bar">
        <div class="diag-bar-row">
          <button class="btn-base sm" id="diag-trace-refresh">${UI_ICONS.search} ${t("diagnostics.loadTraceRefresh")}</button>
        </div>
      </div>
      <div class="diag-result" id="diag-load-trace"></div>
    </div>
  </div>`,
      },
      {
        id: "bench",
        buttonTestid: "diag-tab",
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
      t("diagnostics.subBarBench"),
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
      <div class="diag-param-group">   <!-- ADR-332 D3：参数组① = 单模型路径框（外层容器，行本身不加 class 以保 perf-mode 门禁字面量） -->
        <div class="diag-bar-row" data-perf-mode="single">
          <input id="diag-perf-model" type="text" data-testid="diag-perf-model" placeholder="${t("diagnostics.perfModelPlaceholder")}">
        </div>
      </div>
      <!-- 密度开关（2026-10-15 锐评改进 P0）：只切「基准三件套可见性」这一个维度——控件一份不复制、
           既有 id 全部保留（singleBenchRead* 读路径与 perf.test 断言面一字不动）。
           收起的只有基准组：迭代/上限有合理默认且属「跑一次」的必需单位语义，收起它们会让
           读路径继续吃不可见的值（本卡 2026-10-12「看得见、点不动」同族的反向病），故不入进阶档。
           文案与 aria-pressed 由 perf-density.ts 随态改写；切简版时基准两勾选归零（不可见不生效）。 -->
      <div class="diag-bar-row" data-perf-mode="single">
        <button class="diag-perf-density" id="diag-perf-density" data-testid="diag-perf-density" type="button" aria-pressed="false">${UI_ICONS.settings} <span data-perf-density-label>${t("diagnostics.perfDensityMore")}</span></button>
      </div>
      <div class="diag-param-group" data-perf-mode="single" data-perf-density="advanced">   <!-- ADR-332 D3：参数组② = 基准三件套（记录 / 对比 / 阈值），与路径组形成可见边界；归进阶档。双维度显隐：data-perf-mode 管「哪个基准模式」（conc/scan 整组退场，防空壳边框）、data-perf-density 管「参数密度」（简版收起），两 class 各自独立、任一判隐即隐藏 -->
        <div class="diag-bar-row" data-perf-mode="single">
          <label for="diag-perf-baseline-save">${t("diagnostics.perfBaselineSave")}</label>
          <input id="diag-perf-baseline-save" type="checkbox" data-testid="diag-perf-baseline-save">
          <label for="diag-perf-baseline-compare">${t("diagnostics.perfBaselineCompare")}</label>
          <input id="diag-perf-baseline-compare" type="checkbox" data-testid="diag-perf-baseline-compare" title="${t("diagnostics.perfBaselineHint")}">
          <label for="diag-perf-baseline-th">${t("diagnostics.perfBaselineThreshold")}</label>
          <input id="diag-perf-baseline-th" type="number" min="1" step="1" value="50" data-testid="diag-perf-baseline-th" class="diag-config-num">
        </div>
      </div>
      <div class="diag-bar-row" data-perf-mode="single">
        <label for="diag-perf-iter" id="diag-perf-iter-label" data-testid="diag-perf-iter-label">${t("diagnostics.perfIterations")}</label>
        <input id="diag-perf-iter" type="number" min="1" step="1" value="3" class="diag-config-num">
        <label for="diag-perf-max" id="diag-perf-max-label" data-testid="diag-perf-max-label" title="${t("diagnostics.perfMaxModelsHint")}">${t("diagnostics.perfMaxModels")}</label>
        <input id="diag-perf-max" type="number" min="1" step="1" value="5" data-testid="diag-perf-max" class="diag-config-num">
      </div>
      <!-- 主 CTA 独占一行（2026-10-12）：原先「跑基准」与「迭代次数/取样上限」同行，
           主按钮被两个数字参数夹住、视觉重量被稀释；conc 屏本就是独占行，三屏待遇不一致。
           抽成独立行后与 conc 同款（参数在前、执行在末行），用户动线即「填参数 → 点运行」。
           ⚠️ 两条纪律：① 不要给行加额外 class —— perf-mode.test.ts 按「行开标签字面量 +
           div 配平」反查控件的行归属，加 class 会让那道门禁失配；② 本注释里也不得出现
           行开标签的字面量 —— tpl-structure.test.ts 数 div 时不排除 HTML 注释，会凭空
           多出一个开标签（本次即踩到，配平报 expected 55 to be 56）。 -->
      <div class="diag-bar-row" data-perf-mode="single">
        <button class="btn-base accent" id="diag-perf-run" data-testid="diag-perf-run">${UI_ICONS.performance} ${t("diagnostics.perfRunSingle")}</button>
      </div>
      <div class="diag-bar-row" data-perf-mode="conc">
        <label for="diag-perf-conc-workers">${t("diagnostics.perfConcurrentWorkers")}</label>
        <input id="diag-perf-conc-workers" type="number" min="1" max="256" step="1" value="4" data-testid="diag-perf-conc-workers" class="diag-config-num">
        <label for="diag-perf-conc-max">${t("diagnostics.perfMaxModels")}</label>
        <input id="diag-perf-conc-max" type="number" min="1" step="1" value="20" data-testid="diag-perf-conc-max" title="${t("diagnostics.perfMaxModelsHint")}" class="diag-config-num">
      </div>
      <div class="diag-bar-row" data-perf-mode="conc">
        <button class="btn-base accent" id="diag-perf-conc-run" data-testid="diag-perf-conc-run">${UI_ICONS.performance} ${t("diagnostics.perfRunConcurrent")}</button>
      </div>
      <div class="diag-bar-row" data-perf-mode="scan">
        <label for="diag-perf-scan-iter" id="diag-perf-scan-iter-label" data-testid="diag-perf-scan-iter-label">${t("diagnostics.perfIterations")}</label>
        <input id="diag-perf-scan-iter" type="number" min="1" step="1" value="3" data-testid="diag-perf-scan-iter" class="diag-config-num">
      </div>
      <!-- 同上（2026-10-12）：引擎对照的「运行」按钮原本与迭代次数同行，一并抽成独立行，
           使 bench 三屏的主 CTA 待遇一致（同 conc / single）。 -->
      <div class="diag-bar-row" data-perf-mode="scan">
        <button class="btn-base accent" id="diag-perf-scan-bench" data-testid="diag-perf-scan-bench">${UI_ICONS.performance} ${t("diagnostics.perfScanBenchRun")}</button>
      </div>
      <div class="diag-bar-row" data-perf-mode="scan">
        <div class="diag-bar-hint">${t("diagnostics.perfScanBenchHint")}</div>
      </div>
    </div>
    <div class="diag-result" id="diag-perf-single" data-testid="diag-perf-single" data-perf-mode="single"><div class="stat-row stat-row-idle">${t("diagnostics.perfIdle")}</div></div>
    <div class="diag-result" id="diag-perf-conc-out" data-testid="diag-perf-conc-out" data-perf-mode="conc"><div class="stat-row stat-row-idle">${t("diagnostics.perfIdle")}</div></div>
    <div class="diag-result" id="diag-perf-scan-bench-out" data-testid="diag-perf-scan-bench-out" data-perf-mode="scan"><div class="stat-row stat-row-idle">${t("diagnostics.perfIdle")}</div></div>
  </div>`,
      },
      {
        id: "audit",
        buttonTestid: "diag-tab",
        // ADR-300 §2.1：health 与 sync-conflict 是「扫描 → 处置」一对——同触发范式
        //（ADR-288 D2 两段式）、同跨平台属性、同段 CSS 词汇，合组收口；
        // 元素 id 与两段式结构一字不动（历次重构压测试面的成功经验，ADR-278 §3）。
        desktopOnly: true,
        label: `${UI_ICONS.diagnose} ${t("diagnostics.tabAudit")}`,
        body: `  <div class="diag-pane">
    ${renderSubBar(
      "audit",
      [
        { id: "health", label: t("diagnostics.pillHealth") },
        { id: "sync", label: t("diagnostics.syncConflict") },
      ],
      "health",
      t("diagnostics.subBarAudit"),
    )}
    <div class="diag-pane" data-sub-group="audit" data-sub-pane="health">
      <div class="diag-bar" id="diag-health-bar">
        <div class="diag-bar-row">
          <button class="btn-base accent" id="diag-scan-health" data-testid="diag-scan-health">${UI_ICONS.diagnose} ${t("diagnostics.healthRun")}</button>
        </div>
        <div class="diag-bar-row">
          <div class="diag-bar-hint">${t("diagnostics.healthHint")}</div>
        </div>
      </div>
      <div class="diag-result" id="diag-health-list" data-testid="diag-health-list"><div class="stat-row stat-row-idle">${t("diagnostics.auditIdle")}</div></div>
    </div>
    <div class="diag-pane" data-sub-group="audit" data-sub-pane="sync" style="display:none">
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
      <div class="diag-result" id="diag-sync-conflict-list" data-testid="diag-sync-conflict-list"><div class="stat-row stat-row-idle">${t("diagnostics.auditIdle")}</div></div>
    </div>
  </div>`,
      },
    ],
  });
  // notice 落位在 bar 与 panels 之间（tablist 外，ADR-300 §2.5 / ADR-258 §2.4）
  return `<div class="repo-wrap">${bar}${notice}${panels}</div>`;
}
