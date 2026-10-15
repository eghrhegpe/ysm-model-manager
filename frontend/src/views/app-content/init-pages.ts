// ===== 页面初始化函数集合（为 app-content/index.ts 减负，ADR-040）=====

import { bus } from "@/bus";
import { t } from "@/core/i18n/t.ts";
import { loadOldestModel } from "@/features/maintenance/oldest-models.ts";
import { initRecycleBin } from "@/features/maintenance/recycle-bin.ts";
import { currentRepoType, useCurrentResourceType } from "@/features/repo/repo-rtype.ts";
import { logError, logWarn } from "@/utils/base/primitives/log.ts";
import { safeGet } from "@/utils/base/primitives/storage.ts";
import { friendlyError } from "@/utils/dom/errors.ts";
import { toast } from "@/utils/dom/toast.ts";
import { TOAST_MS } from "@/utils/dom/toast-ms.ts";
import { esc, escUnknown } from "@/utils/html/html.ts";
import { createDedupSession } from "@/views/app-content/diagnostics/dedup.ts";
import { initDiagnostics } from "@/views/app-content/diagnostics/init.ts";
import { initSettings } from "@/views/app-content/settings/init.ts";
import { cleanupKeymap } from "@/views/app-content/settings/keymap.ts";
import type { AppContentHost } from "./host.ts";
import { bindTabRuntime } from "./tabs-runtime.ts";

/**
 * 初始化诊断页
 * 顶部 tab 走全站统一 bindTabs 范式（ARIA/键盘/懒加载），与仓库页同构。
 * ADR-300 S2：六 tab 收口为三个意图组（logs 日志 / bench 基准 / audit 体检），
 * 组内子屏走 tabs-shell 的统一 pill 语法（renderSubBar/bindSubBar）——
 *   logs(操作/运行时/加载剖析) / bench(单模型/批量并发/引擎对照) / audit(仓库健康/同步冲突)
 * （更早的左栏分段→顶 tab 演进见 ADR-258，模式轴重划见 ADR-278。）
 */
export function initDiagnosticsPage(host: AppContentHost): void {
  bindTabRuntime(host, ".repo-tab", "diag");
  // 返回的清理入页面订阅桶：lang:changed 全量重建 / disconnectedCallback 时退订
  // package:selected 订阅（漏接 = 每次切语言多一个写游离 DOM 的幽灵订阅，P0-2②）
  host.subs.addPage(initDiagnostics(host.state.root, escUnknown));
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
  bindTabRuntime(host, ".repo-tab", "ins");

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
  bindTabRuntime(host, ".repo-tab", "repo", {
    recycle: initRecycleTab,
    dedup: initDedupTab,
    oldest: initOldestTab,
  });

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
    if (!treeBody) {
      // 与 bindTabs 缺面板同款「响亮告警」：模板结构变更导致 #repo-tab-tree 缺失时，
      // 静默不渲染且无反馈会让仓库树永久空白且不报错——此处钉成可观测
      logWarn("repo", "仓库页缺挂载点 #repo-tab-tree（模板结构可能已变更），文件树未挂载");
      return;
    }
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

  // 初始挂载：从 localStorage 恢复（app-nav 已在连接时初始化切换器并落盘）。
  // rtype 初值经 currentRepoType() 单一事实源读取（与 app-nav 切换器落盘同源，
  // 不再手拼 safeGet("repo_rtype") || RESOURCE_TYPES.YSM——避免仓库页内第二份字面量真值）
  mountTree(currentRepoType(), safeGet("repo_subdir") || "");
}

/**
 * 初始化回收站 tab（懒加载 tpl-recycle + 绑定回收站逻辑），返回清理函数 + onShow
 * 感知性绑定（锐评 2026-10-13 P1-2）：与 dedup/oldest 对齐，面板隐藏时的类型切换
 * 只记脏账不发 Go RPC，切进面板时由 onShow 补扫。
 */
async function initRecycleTab(
  host: AppContentHost,
  container: HTMLElement,
): Promise<{ cleanup: () => void; onShow: () => void }> {
  const { recycleHTML, renderRecycleListHtml } = await import("./tpl-recycle.ts");
  container.innerHTML = recycleHTML();
  // ADR-190 D1a：列表条目渲染属 views 职责，经 deps 注入 features 编排层
  const recycleHandle = initRecycleBin(
    { _root: host.state.root },
    { renderListHtml: renderRecycleListHtml },
    container,
  );
  return { cleanup: recycleHandle.cleanup, onShow: recycleHandle.onShow };
}

/**
 * 初始化去重组 tab：配置面板 + 开始去重按钮 + 全局类型切换自动复扫。
 * 返回 { cleanup, onShow }：cleanup = 组件卸载时执行的清理（bus 订阅取消）；
 * onShow = 每次激活面板时的补扫校验（bindTabs showFns 落位，激活是重复事件）。
 * P3 修复：配置面板独立容器，扫描结果只写 result-list，不被 innerHTML 覆盖销毁。
 * P2-2 收债（感知性绑定）：自动复扫只在面板**可见**时触发——隐藏面板的全价 SHA256
 * 扫描（go/dedup 无指纹缓存，每次全库读盘+哈希）是零价值纯成本；不可见时只更新
 * dedupType，补扫由 onShow 在用户切进面板时按需发起（看得见进度）。
 * 锐评 P2 收口（2026-10-14）：**可见**面板下快速连切类型（被 dedup.start 的 busy 守卫
 * 拦截）的补扫不再靠「下次激活」兜底——那路径在可见面板下不触发（dirty 只在隐藏分支
 * 置位）。改由 dedup 会话内部的 pending 机制自愈：busy 拦截记最新类型，扫描结束后按
 * pending 重跑（见 diagnostics/dedup.ts|createDedupSession）。此处 onShow 只管隐藏分支。
 */
async function initDedupTab(
  _host: AppContentHost,
  container: HTMLElement,
): Promise<{ cleanup: () => void; onShow: () => void }> {
  // 每宿主一个去重会话：busy/exec 重入守卫与去重配置收进会话闭包，跨 tab 开关/类型切换复用同一配置
  const dedup = createDedupSession();
  // 订阅全局资源类型切换，与 recycle/oldest 同款原语（useCurrentResourceType：初值 +
  // 同值去重 + cleanup 入桶）。感知性绑定：面板隐藏时只记脏账不扫盘（go/dedup 无指纹
  // 缓存，每次全库 SHA256 是零价值纯成本），切进面板时由 onShow 按需补扫
  let dirty = false;
  const { get: getCurrentType, cleanup: cleanupRtype } = useCurrentResourceType(() => {
    if (container.hidden) {
      dirty = true;
      return;
    }
    doDedup();
  });
  // ADR-190 D1a：面板 DOM 模板经动态导入的 tpl-dedup.ts 产出（与 recycle/oldest 同构，
  // 抽到叶模板使 Vite 按功能拆分 chunk，且消除易漏闭合标签的内联拼接）
  const { dedupPanelHTML } = await import("./tpl-dedup.ts");
  container.innerHTML = dedupPanelHTML();
  const panel = container.querySelector("#dedup-config-panel") as HTMLElement | null;
  if (panel) dedup.initConfig(panel);
  const doDedup = (): void => {
    const listEl = container.querySelector("#dedup-result-list");
    if (listEl) dedup.start(listEl as HTMLElement, escUnknown, getCurrentType());
  };
  container.querySelector("#dedup-start-btn")?.addEventListener("click", doDedup);
  // 每次激活的补扫校验：面板里显示的结果必须属于当前类型。
  // 从未扫过（lastScannedType null）不自动开跑——维持现状「进入面板手动开始」的语义，
  // 只消除「扫过 A 后切到 B 再切回看到 A 的旧结果」的误导
  const onShow = (): void => {
    if (!dirty) return;
    dirty = false;
    const scanned = dedup.lastScannedType();
    if (scanned !== null && getCurrentType() !== scanned) doDedup();
  };
  return {
    cleanup: () => {
      cleanupRtype();
    },
    onShow,
  };
}

/**
 * 初始化「最近/最旧模型」tab，返回 { cleanup, onShow }：
 * cleanup = 组件卸载清理；onShow = 补渲染隐藏期间被脏账记账跳过的类型切换
 * （感知性绑定，对接锐评②——隐藏面板不触发全库 SHA256 体检，切进面板时按需补）
 */
async function initOldestTab(
  _host: AppContentHost,
  container: HTMLElement,
): Promise<{ cleanup: () => void; onShow: () => void }> {
  // ADR-190 D1a：整页 DOM 模板由 views 提供（tpl-oldest.ts），features 只做数据编排
  const { renderOldestPage } = await import("./tpl-oldest.ts");
  return loadOldestModel(container, (s) => esc(s), {
    renderPage: renderOldestPage,
  });
}

/**
 * 初始化设置页
 */
export async function initSettingsPage(host: AppContentHost): Promise<void> {
  bindTabRuntime(host, ".stg-tab", "stg");
  try {
    await initSettings(host.state.root);
    // 组件卸载/切页时移除 document keydown 捕获监听，防全局劫持泄漏
    host.subs.addPage(cleanupKeymap);
  } catch (e) {
    logError("settings", "初始化失败", e);
    toast(friendlyError(e, t("content.settingsInitFailed")), TOAST_MS.long, "error");
  }
}

// initWorkshopPage / initGithubPage 转发壳已删除（P1-2）——
// page-registry 直接引用 init-workshop.ts / init-github.ts 的实现函数。

// 最近选中模型路径（rememberModelPath / getLastModelPath / __resetLastModelPathForTest）
// 已迁出至 core/model-path-store.ts（ADR-221：跨视图共享态归位 core，断开三个视图域的越权边）。
