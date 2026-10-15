// ===== tabs-runtime.ts — tab 栏运行期引擎（与 tabs-shell 结构 / tabs-a11y 可访问性并列）=====
//
// 背景：`bindTabs`（init-pages.ts）把两件正交的事捆在一起（ADR-259 运行期半边 + 各页
// init 内容编排）。2026-09 已把「结构产出」收进 tabs-shell、「可访问性」收进 tabs-a11y，
// 唯独「运行期引擎」（面板显隐翻转 + 懒初始化分发 + 缺面板告警）仍压在 init-pages.ts 内、
// 且其 `TAB_INIT` 懒加载表把三个页面专属的 init 函数硬编码进引擎——引擎反向依赖页面。
//
// 本模块完成三件套收口：引擎与页面解耦，init 表由调用方注入，runtime 不再 import 任何
// initXxxTab。新增带懒初始化 tab 的页面，只需在调用点提供一个 `{ [data-tab]: initFn }` 表，
// 引擎行为（真值源 / 懒加载 / 告警 / 重试）零改动。
//
// 分层：本文件是 app-content 内部 views 层引擎（依赖 tabs-a11y 原语与 AppContentHost 契约），
// 与 tabs-shell / tabs-a11y 同族（结构/行为原语，非组件），故不触 HTML 字面量红线、不进桶。

import { t } from "@/core/i18n/t.ts";
import { logWarn } from "@/utils/base/primitives/log.ts";
import { safeSet } from "@/utils/base/primitives/storage.ts";
import { friendlyError } from "@/utils/dom/errors.ts";
import { toast } from "@/utils/dom/toast.ts";
import { TOAST_MS } from "@/utils/dom/toast-ms.ts";
import type { AppContentHost } from "./host.ts";
import { bindTabA11y } from "./tabs-a11y.ts";

/** 懒初始化函数返回值双形态：cleanup 函数（历史契约）或 { cleanup?, onShow? } 对象。
 *  onShow 是「每次激活」副作用句柄（与懒初始化「仅一次」正交），随初始化闭包落位、随面板世代消亡。
 *  ⚠️ 刻意**不导出**：外部消费者的类型锚点是下面的 `TabInitFn`（写 init 函数只需标注它），
 *  本联合类型无第二处引用，导出即 knip 死导出（2026-10-13 静态治理闸实证阻断）。 */
type TabInitResult = (() => void) | null | { cleanup?: (() => void) | null; onShow?: () => void };
/** 懒初始化函数签名：持有宿主与面板容器，返回 TabInitResult（可 async） */
export type TabInitFn = (h: AppContentHost, c: HTMLElement) => Promise<TabInitResult>;

/**
 * onBound 逐按钮：补面板侧静态语义——按钮 id（供 aria-labelledby）、panel role、
 * 非首个面板初始 hidden；缺面板响亮告警（按钮在但内容区必空白）。
 */
function preparePanelSemantics(
  root: ShadowRoot,
  prefix: string,
  panelId: (id: string) => string,
  btn: HTMLElement,
): void {
  const id = btn.dataset.tab ?? "";
  btn.id = `${prefix}-tab-btn-${id}`;
  const panel = root.getElementById(panelId(id));
  if (!panel) {
    logWarn("tabs", `${prefix}: 缺面板 #${panelId(id)}（按钮在但内容区将空白）`);
    return;
  }
  panel.setAttribute("role", "tabpanel");
  panel.setAttribute("aria-labelledby", btn.id);
  // 锐评 P2 #5 收口：尊重 renderTabs 已标定的激活项（按钮的 `.active` 类）。原 `i !== 0`
  // 硬隐藏非首面板，会覆盖 initialActiveId（语言热切换恢复）标记的 tab，把它也藏起来。
  if (!btn.classList.contains("active")) {
    panel.style.display = "none";
    panel.setAttribute("hidden", "");
  }
}

/** onActivate ①：翻转全部面板 display/hidden——激活项显示，其余隐藏 */
function activateTabPanels(
  root: ShadowRoot,
  panelId: (id: string) => string,
  tab: string,
  ids: string[],
): void {
  ids.forEach((id) => {
    const el = root.getElementById(panelId(id));
    if (!el) return;
    if (id === tab) {
      el.style.display = "";
      el.removeAttribute("hidden");
    } else {
      el.style.display = "none";
      el.setAttribute("hidden", "");
    }
  });
}

/** 应用懒初始化返回值：cleanup 函数（历史契约）或 { cleanup?, onShow? } 对象 */
function applyInitResult(
  host: AppContentHost,
  result: TabInitResult,
  showFns: Record<string, () => void>,
  tab: string,
): void {
  if (typeof result === "function") {
    host.subs.addPage(result as () => void);
  } else if (result && typeof result === "object") {
    if (typeof result.cleanup === "function") host.subs.addPage(result.cleanup);
    if (typeof result.onShow === "function") showFns[tab] = result.onShow;
  }
}

/**
 * 执行一次懒初始化（仅 once）：先置 inited 防并发重复初始化，catch 复位允许重试并 toast。
 * onShow 是「每次激活」副作用（与懒初始化「仅一次」正交），随初始化闭包落位。
 */
function runTabInitOnce(opts: {
  host: AppContentHost;
  container: HTMLElement;
  tabInit: Record<string, TabInitFn>;
  inited: Record<string, boolean>;
  showFns: Record<string, () => void>;
  tab: string;
}): void {
  const { host, container, tabInit, inited, showFns, tab } = opts;
  inited[tab] = true;
  void (async (): Promise<void> => {
    try {
      const initFn = tabInit[tab];
      if (initFn) {
        const result = await initFn(host, container);
        applyInitResult(host, result, showFns, tab);
      }
    } catch (e) {
      inited[tab] = false;
      toast(friendlyError(e, t("common.loadFailed")), TOAST_MS.verbose, "error");
    }
  })();
  // 注意：resourcepacks/shaderpacks/blueprint/MMD/VRC/LITEMATIC 六个
  // initResourcePacks 分支已删除（P2 审计：tpl 无对应 repo-tab 按钮与容器 id，
  // 双重复死不可达；资源类型切换改由 app-nav 资源切换器重渲染 <app-tree>）。
}

/** onActivate ③：首次切到非默认 tab 时懒初始化（仅一次）。 */
function lazyInitIfNeeded(opts: {
  host: AppContentHost;
  root: ShadowRoot;
  panelId: (id: string) => string;
  tabInit: Record<string, TabInitFn>;
  inited: Record<string, boolean>;
  showFns: Record<string, () => void>;
  tab: string;
  ids: string[];
}): void {
  const { host, root, panelId, tabInit, inited, showFns, tab, ids } = opts;
  // 已初始化 tab 的每次激活副作用（onShow）由 runTabInitOnce 落位，首次激活不触发
  if (inited[tab] || tab === ids[0]) return;
  const container = root.getElementById(panelId(tab));
  if (!container) return;
  // P3 修复（审核，陷阱 #3）：懒初始化是 async 链（动态 import / 业务 init），
  // 原在 await 前就置 inited=true 且无 try/catch——动态导入失败或 init 抛错时
  // tab 永久卡死（重试被 inited 拦截）且无用户反馈（ADR-044 ①：async 最外层必有 catch）。
  runTabInitOnce({ host, container, tabInit, inited, showFns, tab });
}

/**
 * 绑定一页的 tab 壳：ARIA（tablist/tab/tabpanel）+ roving tabindex + 键盘导航 + 懒初始化 + 面板切换。
 * 按钮选择器与内容卡前缀解耦（样式类可复用，语义前缀独立）：
 *   bindTabRuntime(host, { tabSelector: ".repo-tab", prefix: "ins" }) —— 按钮用 repo-tab 样式类，内容卡 id 为 ins-tab-<data-tab>
 *
 * **真值源 = 按钮自身的 `data-tab`**（由 `renderTabs` 工厂保证与面板 id 同源）。
 * 本函数**不接受调用方手传的 id 白名单**——白名单是第二份手工真值，新增 tab 时漏同步就是
 * 「按钮在、点了没反应、内容区空白」且**不报错**（2026-09 设置页新增「操作」tab 的真实事故）。
 * 新增 tab 只需改模板一处；契约违例（按钮缺 data-tab / 面板缺失）在此响亮告警，不静默。
 *
 * @param host 组件宿主（提供 shadow root 与订阅桶）
 * @param tabSelector tab 按钮选择器（如 `.repo-tab` / `.stg-tab`）
 * @param prefix 面板 id 前缀：面板 id = `${prefix}-tab-${data-tab}`
 * @param tabInit 懒初始化表（可选）：data-tab → init 函数；未登记的 tab 仅做显隐翻转。
 *   引擎不反向依赖页面，init 函数由调用方注入（与 app-preview 的 PREVIEW_HANDLERS 同构模式）。
 */
export function bindTabRuntime(
  host: AppContentHost,
  tabSelector: string,
  prefix: string,
  tabInit: Record<string, TabInitFn> = {},
): void {
  const root = host.state.root;
  const panelId = (id: string): string => `${prefix}-tab-${id}`;

  const inited: Record<string, boolean> = {};
  // 已初始化 tab 的每次激活副作用（tab → onShow 句柄）：懒初始化完成后落位
  const showFns: Record<string, () => void> = {};
  // 去重后的 tab id 列表：onBound 每次 attach 回填，供面板 display 翻转与懒初始化使用。
  let ids: string[] = [];

  // 可访问性半边（tablist/tab 语义 + roving tabindex + 键盘导航 + 点击分派）委托共享原语
  // tabs-a11y；此处只保留静态页专属的面板侧契约（tabpanel 语义 + display/hidden 翻转 + 懒初始化 + 缺面板告警）。
  bindTabA11y({
    root,
    tabSelector,
    panelId,
    validate: true,
    // 每次绑定后为「去重后的按钮集合」补面板侧静态语义
    onBound: (nav, boundIds) => {
      ids = boundIds;
      nav.forEach((btn) => {
        preparePanelSemantics(root, prefix, panelId, btn);
      });
      // 锐评 P1-A（2026-10-16）：`onActivate` 只由点击/键盘（tabs-a11y activate）触发，
      // attach 时**不**触发。语言热切换/重启后 renderTabs 用 initialActiveId 恢复的激活
      // tab 若是非首 tab（回收站/去重/资历），面板由 preparePanelSemantics 显示、按钮带
      // `.active`，但懒初始化链从未启动 → 内容区空白且不报错。此处补一次首屏懒初始化：
      // 真值源仍是 renderTabs 预置的 `.active`（与 pickInitialTab 同口径），
      // runTabInitOnce 由 inited 幂等，故每次 attach 都调也安全。
      const activeBtn = nav.find((b) => b.classList.contains("active"));
      const activeTab = activeBtn?.dataset.tab ?? "";
      if (activeTab && activeTab !== boundIds[0]) {
        lazyInitIfNeeded({
          host,
          root,
          panelId,
          tabInit,
          inited,
          showFns,
          tab: activeTab,
          ids: boundIds,
        });
      }
    },
    // 激活副作用：翻面板 display/hidden + 首次切到非默认 tab 时懒初始化（原 activate 的 ②③）。
    // 按钮 active 类 / aria-selected / roving tabindex 的互斥迁移已由原语在 activate 前统一处理。
    onActivate: (_btn, tab) => {
      // 锐评 P2 #5 收口：激活即持久化，语言热切换全量重建（clearPanels + _render）后由
      // renderTabs 读回 initialActiveId 恢复。safeSet 隐私模式静默降级（safe* 契约）。
      safeSet(`ysm-tabs-last-${prefix}`, tab);
      activateTabPanels(root, panelId, tab, ids);
      if (inited[tab]) showFns[tab]?.();
      lazyInitIfNeeded({ host, root, panelId, tabInit, inited, showFns, tab, ids });
    },
  });
}
