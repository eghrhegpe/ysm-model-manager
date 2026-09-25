// ===== 页面初始化函数集合（为 app-content/index.ts 减负，ADR-040）=====

import { bus } from "@/bus";
import { t } from "@/core/i18n/t.ts";
import { loadOldestModel } from "@/features/maintenance/oldest-models.ts";
import { initRecycleBin } from "@/features/maintenance/recycle-bin.ts";
import { logError, logWarn } from "@/utils/base/primitives/log.ts";
import { safeGet } from "@/utils/base/primitives/storage.ts";
import { friendlyError } from "@/utils/dom/errors.ts";
import { TOAST_MS } from "@/utils/dom/toast-ms.ts";
import { esc, escUnknown } from "@/utils/html/html.ts";
import { UI_ICONS } from "@/utils/icon/ui-icons.ts";
import { RESOURCE_TYPES } from "@/utils/resource/types.ts";
import { createDedupSession } from "@/views/app-content/diagnostics/dedup.ts";
import { initDiagnostics } from "@/views/app-content/diagnostics/init.ts";
import { initSettings } from "@/views/app-content/settings/init.ts";
import { cleanupKeymap } from "@/views/app-content/settings/keymap.ts";
import type { AppContentHost } from "./host.ts";
import { bindTabA11y } from "./tabs-a11y.ts";

/**
 * 初始化诊断页
 * 顶部 tab 走全站统一 bindTabs 范式（ARIA/键盘/懒加载），与仓库页同构。
 * ADR-300 S2：六 tab 收口为三个意图组（logs 日志 / bench 基准 / audit 体检），
 * 组内子屏走 tabs-shell 的统一 pill 语法（renderSubBar/bindSubBar）——
 *   logs(操作/运行时/加载剖析) / bench(单模型/批量并发/引擎对照) / audit(仓库健康/同步冲突)
 * （更早的左栏分段→顶 tab 演进见 ADR-258，模式轴重划见 ADR-278。）
 */
export function initDiagnosticsPage(host: AppContentHost): void {
  bindTabs(host, ".repo-tab", "diag");
  initDiagnostics(host.state.root, escUnknown);
}

/**
 * 挂载 / 复用同步面板（整合包管理页内容区）。
 *
 * 2026-09 修复：原每次 `package:selected` 都 `innerHTML` 全量重建 `<app-sync-manager>`，
 * 组件实例连同视图状态（目录展开态 / 状态筛选 / 子类型 / 在途集合）一起被丢弃——
 * 切整合包闪烁，且「跨包复用同一实例」的诉求被架构层面否决。组件本就实现了
 * `attributeChangedCallback` 支持 instance 变更（能力已有、接线没用），故改为**复用 + 改属性**：
 *   - instance 变更 → 组件内部 `_init()` 重载，并先走 `_resetViewState()` 复位视图状态；
 *   - 同值 setAttribute 会被 `oldVal === newVal` 拦下，重复 emit 零成本（不再依赖
 *     app-sidebar 的去重状态机来「防丢状态」）。
 */
function mountSyncManager(content: HTMLElement, instance: string, defaultType: string): void {
  let el = content.querySelector<HTMLElement>("app-sync-manager");
  if (!el) {
    content.innerHTML =
      '<app-sync-manager style="display:flex;flex-direction:column;flex:1;overflow:hidden;height:100%"></app-sync-manager>';
    el = content.querySelector<HTMLElement>("app-sync-manager");
    if (!el) return;
  }
  // 先置 default-type 再置 instance：instance 变更即触发组件 _init，届时 default-type 已就位
  el.setAttribute("default-type", defaultType);
  el.setAttribute("instance", instance);
}

/**
 * 初始化实例页
 */
export function initInstancesPage(host: AppContentHost): void {
  bindTabs(host, ".repo-tab", "ins");

  // 幂等注册（ADR-261）：原先靠 `state.insListenerReg` 布尔标志 + index.ts 在 lang:changed 手工复位。
  // 该标志的复位时机必须与面板世代同步，却横跨两处——现交给订阅桶的 addPageOnce：
  // key 与页面级订阅同寿命，drainPage() 清空订阅时一并清 key，世代重建后天然可再注册。

  host.subs.addPageOnce(
    "instances:package-selected",
    // 工厂形式（ADR-264）：订阅只在 key 真正认领时创建
    () =>
      bus.on("package:selected", (pkg) => {
        const content = host.state.root.getElementById("ins-content");
        if (!content) return;
        // P1 修复：去掉 || RESOURCE_TYPES.YSM 静默兜底。
        // 发射点（app-sidebar/events.ts）已拦空 rtype，这里防御性 return。
        if (!pkg.rtype) return;
        mountSyncManager(content, pkg.name || "", pkg.rtype);
      }),
  );
}

/**
 * 初始化仓库页
 */
export function initRepositoryPage(host: AppContentHost): void {
  bindTabs(host, ".repo-tab", "repo");

  // 资源类型由导航栏全局切换器驱动（app-nav 双下拉 → repo:rtype-changed + repo_rtype/repo_subdir 落盘）。
  // 仓库页不再持有本地 subtabs，只订阅全局事件重建文件树（单一入口，ADR-092/094 收敛）。
  const root = host.state.root;
  const treeBody = root.getElementById("repo-tab-tree");

  // 重建文件树：按 rtype + 可选 subdir（mmd 子目录）挂载 app-tree
  // 复用优先（2026-09 收债，同 mountSyncManager 范式）：app-tree 的
  // attributeChangedCallback 负责属性变更重载（含清扫描缓存 + 代际守卫），
  // 树内搜索词/排序/选择/滚动状态跨类型切换存活；旧 innerHTML 整体重建
  // 每次丢弃全部视图状态，且让组件的属性机制沦为无生产调用点的防御性死代码。
  // 同值 setAttribute 被 oldVal === newVal 拦下——repo:rtype-changed 的同值重放零成本
  // （「强制刷新」语义已改走 tree:reload，见 settings/init.ts）。
  const mountTree = (rtype: string, subdir: string): void => {
    if (!treeBody) return;
    const existing = treeBody.querySelector("app-tree");
    if (existing) {
      existing.setAttribute("root", rtype);
      if (subdir) existing.setAttribute("subdir", subdir);
      else existing.removeAttribute("subdir");
      return;
    }
    treeBody.innerHTML =
      '<app-tree root="' +
      esc(rtype) +
      '"' +
      (subdir ? ` subdir="${esc(subdir)}"` : "") +
      ' style="flex:1;min-width:0"></app-tree>';
  };

  // 全局 rtype 变化 → 重建文件树（app-nav 切换器 emit；subdir 从 localStorage 读）
  host.subs.addPage(
    bus.on("repo:rtype-changed", (rt) => {
      mountTree(rt, safeGet("repo_subdir") || "");
    }),
  );

  // 初始挂载：从 localStorage 恢复（app-nav 已在连接时初始化切换器并落盘）
  const savedRtype = safeGet("repo_rtype") || RESOURCE_TYPES.YSM;
  mountTree(savedRtype, safeGet("repo_subdir") || "");
}

/**
 * 绑定一页的 tab 壳：ARIA（tablist/tab/tabpanel）+ roving tabindex + 键盘导航 + 懒初始化 + 面板切换。
 * 按钮选择器与内容卡前缀解耦（样式类可复用，语义前缀独立）：
 *   bindTabs(host, ".repo-tab", "ins") —— 按钮用 repo-tab 样式类，内容卡 id 为 ins-tab-<data-tab>
 *
 * **真值源 = 按钮自身的 `data-tab`**（由 `renderTabs` 工厂保证与面板 id 同源）。
 * 本函数**不接受调用方手传的 id 白名单**——白名单是第二份手工真值，新增 tab 时漏同步就是
 * 「按钮在、点了没反应、内容区空白」且**不报错**（2026-09 设置页新增「操作」tab 的真实事故）。
 * 新增 tab 只需改模板一处；契约违例（按钮缺 data-tab / 面板缺失）在此响亮告警，不静默。
 *
 * @param tabSelector tab 按钮选择器（如 `.repo-tab` / `.stg-tab`）
 * @param prefix 面板 id 前缀：面板 id = `${prefix}-tab-${data-tab}`
 */
export function bindTabs(host: AppContentHost, tabSelector: string, prefix: string): void {
  const root = host.state.root;
  const panelId = (id: string): string => `${prefix}-tab-${id}`;

  // P3 收敛（审核）：tab 懒初始化分发由查表替代 if/else-if 链，与 app-preview 的 PREVIEW_HANDLERS 同构模式对齐
  // initFn 返回值双形态：cleanup 函数（历史契约）或 { cleanup?, onShow? } 对象——onShow 是
  // 「每次激活」副作用句柄（与懒初始化「仅一次」正交），随初始化闭包落位、随面板世代消亡
  type TabInitResult = (() => void) | null | { cleanup?: (() => void) | null; onShow?: () => void };
  type TabInitFn = (h: AppContentHost, c: HTMLElement) => Promise<TabInitResult>;
  const TAB_INIT: Record<string, TabInitFn> = {
    recycle: initRecycleTab,
    dedup: initDedupTab,
    oldest: initOldestTab,
  };
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
    // 每次绑定后为「去重后的按钮集合」补面板侧静态语义：按钮 id（供 aria-labelledby）、
    // panel role、非首个面板初始 hidden；缺面板响亮告警（按钮在但内容区必空白）。
    onBound: (nav, boundIds) => {
      ids = boundIds;
      nav.forEach((btn, i) => {
        const id = btn.dataset.tab ?? "";
        btn.id = `${prefix}-tab-btn-${id}`;
        const panel = root.getElementById(panelId(id));
        if (!panel) {
          logWarn("tabs", `${prefix}: 缺面板 #${panelId(id)}（按钮在但内容区将空白）`);
          return;
        }
        panel.setAttribute("role", "tabpanel");
        panel.setAttribute("aria-labelledby", btn.id);
        if (i !== 0) {
          panel.style.display = "none";
          panel.setAttribute("hidden", "");
        }
      });
    },
    // 激活副作用：翻面板 display/hidden + 首次切到非默认 tab 时懒初始化（原 activate 的 ②③）。
    // 按钮 active 类 / aria-selected / roving tabindex 的互斥迁移已由原语在 activate 前统一处理。
    onActivate: (_btn, tab) => {
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
      // 已初始化 tab 的每次激活副作用（onShow）：与「仅一次」的懒初始化正交——
      // 激活是重复事件，showFns 随初始化落位，首次激活（懒初始化路径）不触发
      if (inited[tab]) showFns[tab]?.();
      if (!inited[tab] && tab !== ids[0]) {
        const container = root.getElementById(panelId(tab));
        if (!container) return;
        // P3 修复（审核，陷阱 #3）：懒初始化是 async 链（动态 import / 业务 init），
        // 原在 await 前就置 inited=true 且无 try/catch——动态导入失败或 init 抛错时
        // tab 永久卡死（重试被 inited 拦截）且无用户反馈。先置位防并发重复初始化，
        // catch 中复位以允许重试并 toast 提示（ADR-044 ①：async handler 最外层必有 catch）。
        inited[tab] = true;
        void (async (): Promise<void> => {
          try {
            const initFn = TAB_INIT[tab];
            if (initFn) {
              const result = await initFn(host, container);
              if (typeof result === "function") {
                host.subs.addPage(result as () => void);
              } else if (result && typeof result === "object") {
                if (typeof result.cleanup === "function") host.subs.addPage(result.cleanup);
                if (typeof result.onShow === "function") showFns[tab] = result.onShow;
              }
            }
          } catch (e) {
            inited[tab] = false;
            bus.emit("toast:show", {
              msg: friendlyError(e, t("common.loadFailed")),
              duration: TOAST_MS.verbose,
              type: "error",
            });
          }
        })();
        // 注意：resourcepacks/shaderpacks/blueprint/MMD/VRC/LITEMATIC 六个
        // initResourcePacks 分支已删除（P2 审计：tpl 无对应 repo-tab 按钮与容器 id，
        // 双重复死不可达；资源类型切换改由 app-nav 资源切换器重渲染 <app-tree>）。
      }
    },
  });
}

/**
 * 初始化回收站 tab（懒加载 tpl-recycle + 绑定回收站逻辑），返回清理函数
 */
async function initRecycleTab(
  host: AppContentHost,
  container: HTMLElement,
): Promise<(() => void) | null> {
  const { recycleHTML, renderRecycleListHtml } = await import("./tpl-recycle.ts");
  container.innerHTML = recycleHTML();
  // ADR-190 D1a：列表条目渲染属 views 职责，经 deps 注入 features 编排层
  const recycleCleanup = initRecycleBin(
    { _root: host.state.root },
    { renderListHtml: renderRecycleListHtml },
  );
  return recycleCleanup;
}

/**
 * 初始化去重组 tab：配置面板 + 开始去重按钮 + 全局类型切换自动复扫。
 * 返回 { cleanup, onShow }：cleanup = 组件卸载时执行的清理（bus 订阅取消）；
 * onShow = 每次激活面板时的补扫校验（bindTabs showFns 落位，激活是重复事件）。
 * P3 修复：配置面板独立容器，扫描结果只写 result-list，不被 innerHTML 覆盖销毁。
 * P2-2 收债（感知性绑定）：自动复扫只在面板**可见**时触发——隐藏面板的全价 SHA256
 * 扫描（go/dedup 无指纹缓存，每次全库读盘+哈希）是零价值纯成本；不可见时只更新
 * dedupType，补扫由 onShow 在用户切进面板时按需发起（看得见进度）。快速连切被 busy
 * 拦截的扫描由下次激活兜底（lastScannedType 记账在 start 内部，拦截不覆盖）。
 */
async function initDedupTab(
  _host: AppContentHost,
  container: HTMLElement,
): Promise<{ cleanup: () => void; onShow: () => void }> {
  // 每宿主一个去重会话：busy/exec 重入守卫与去重配置收进会话闭包，跨 tab 开关/类型切换复用同一配置
  const dedup = createDedupSession();
  let dedupType = safeGet("repo_rtype") || RESOURCE_TYPES.YSM;
  container.innerHTML =
    '<div style="display:flex;flex-direction:column;height:100%">' +
    '<div style="display:flex;align-items:center;gap:8px;padding:var(--btn-padding-filter-lg);border-bottom:1px solid var(--bd)">' +
    '<span style="flex:1;font-size:var(--fs-sm);color:var(--muted)">' +
    UI_ICONS.pin +
    " " +
    t("dedup.sha256Hint") +
    "</span>" +
    '<button class="btn-base accent" id="dedup-start-btn">' +
    UI_ICONS.link +
    " " +
    t("dedup.startDedup") +
    "</button>" +
    "</div>" +
    '<div id="dedup-config-panel" style="padding:var(--btn-padding-filter-lg);border-bottom:1px solid var(--bd)"></div>' +
    '<div id="dedup-result-list" style="flex:1;overflow-y:auto;padding:var(--pad-v-8)"></div>' +
    "</div>";
  const panel = container.querySelector("#dedup-config-panel") as HTMLElement | null;
  if (panel) dedup.initConfig(panel);
  const doDedup = (): void => {
    const listEl = container.querySelector("#dedup-result-list");
    if (listEl) dedup.start(listEl as HTMLElement, escUnknown, dedupType);
  };
  container.querySelector("#dedup-start-btn")?.addEventListener("click", doDedup);
  // 全局类型切换时自动复扫——感知性绑定：仅面板可见时（bindTabs 以 hidden 属性翻转可见性）
  const unsub = bus.on("repo:rtype-changed", (rt) => {
    if (rt !== dedupType) {
      dedupType = rt;
      if (!container.hidden) doDedup();
    }
  });
  // 每次激活的补扫校验：面板里显示的结果必须属于当前类型。
  // 从未扫过（lastScannedType null）不自动开跑——维持现状「进入面板手动开始」的语义，
  // 只消除「扫过 A 后切到 B 再切回看到 A 的旧结果」的误导
  const onShow = (): void => {
    const scanned = dedup.lastScannedType();
    if (scanned !== null && dedupType !== scanned) doDedup();
  };
  return { cleanup: unsub, onShow };
}

/**
 * 初始化「最近/最旧模型」tab，返回清理函数
 */
async function initOldestTab(
  _host: AppContentHost,
  container: HTMLElement,
): Promise<(() => void) | null> {
  // ADR-190 D1a：整页 DOM 模板由 views 提供（tpl-oldest.ts），features 只做数据编排
  const { renderOldestPage } = await import("./tpl-oldest.ts");
  const oldestCleanup = await loadOldestModel(container, (s) => esc(s), {
    renderPage: renderOldestPage,
  });
  return oldestCleanup;
}

/**
 * 初始化设置页
 */
export async function initSettingsPage(host: AppContentHost): Promise<void> {
  bindTabs(host, ".stg-tab", "stg");
  try {
    await initSettings(host.state.root);
    // 组件卸载/切页时移除 document keydown 捕获监听，防全局劫持泄漏
    host.subs.addPage(cleanupKeymap);
  } catch (e) {
    logError("settings", "初始化失败", e);
    bus.emit("toast:show", {
      // ADR-267：状态图标由 type 驱动，msg 不带 ❌ 前缀
      msg: friendlyError(e, t("content.settingsInitFailed")),
      duration: TOAST_MS.long,
      type: "error",
    });
  }
}

// initWorkshopPage / initGithubPage 转发壳已删除（P1-2）——
// page-registry 直接引用 init-workshop.ts / init-github.ts 的实现函数。

// 最近选中模型路径（rememberModelPath / getLastModelPath / __resetLastModelPathForTest）
// 已迁出至 core/model-path-store.ts（ADR-221：跨视图共享态归位 core，断开三个视图域的越权边）。
