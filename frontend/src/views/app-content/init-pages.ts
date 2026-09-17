// ===== 页面初始化函数集合（为 app-content/index.ts 减负，ADR-040）=====

import { bus } from "@/bus";
import { t } from "@/core/i18n/t.ts";
import { loadOldestModel } from "@/features/maintenance/oldest-models.ts";
import { initRecycleBin } from "@/features/maintenance/recycle-bin.ts";
import { logError, logWarn } from "@/utils/base/primitives/log.ts";
import { safeGet } from "@/utils/base/primitives/storage.ts";
import { friendlyError } from "@/utils/dom/errors.ts";
import { TOAST_MS } from "@/utils/dom/toast-ms.ts";
import { esc } from "@/utils/html/html.ts";
import { UI_ICONS } from "@/utils/icon/ui-icons.ts";
import { RESOURCE_TYPES } from "@/utils/resource/types.ts";
import { createDedupSession } from "@/views/app-content/diagnostics/dedup.ts";
import { initDiagnostics } from "@/views/app-content/diagnostics/init.ts";
import { initSettings } from "@/views/app-content/settings/init.ts";
import { cleanupKeymap } from "@/views/app-content/settings/keymap.ts";
import type { AppContentHost } from "./host.ts";

/**
 * 初始化诊断页
 */
/**
 * 初始化诊断页
 * 顶部 tab 走全站统一 bindTabs 范式（ARIA/键盘/懒加载），与仓库页同构。
 * 左栏分段已在 ADR-258 收敛为顶部 repo-tab：
 *   log(日志,含op/runtime子tab) / single / gui / hist / trace / conflict / health / sync-conflict
 */
export function initDiagnosticsPage(host: AppContentHost): void {
  bindTabs(host, ".repo-tab", "diag");
  initDiagnostics(host.state.root, (s) => esc(String(s || "")));
}

/**
 * 初始化实例页
 */
export function initInstancesPage(host: AppContentHost): void {
  bindTabs(host, ".repo-tab", "ins");

  // 只注册一次，避免重复监听
  if (host.state.insListenerReg) return;
  host.state.insListenerReg = true;

  host.subs.addPage(
    bus.on("package:selected", (pkg) => {
      const content = host.state.root.getElementById("ins-content");
      if (!content) return;
      // P1 修复：去掉 || RESOURCE_TYPES.YSM 静默兜底。
      // 发射点（app-sidebar/events.ts）已拦空 rtype，这里防御性 return。
      if (!pkg.rtype) return;
      const insName = pkg.name || "";
      const defaultType = pkg.rtype;
      content.innerHTML =
        '<app-sync-manager instance="' +
        esc(insName) +
        '" default-type="' +
        esc(defaultType) +
        '" style="display:flex;flex-direction:column;flex:1;overflow:hidden;height:100%"></app-sync-manager>';
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
  const mountTree = (rtype: string, subdir: string): void => {
    if (!treeBody) return;
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
  const tabs = Array.from(host.state.root.querySelectorAll<HTMLElement>(tabSelector));
  if (!tabs.length) return;

  // 真值源 = 按钮自身的 data-tab（由 renderTabs 工厂保证与面板 id 同源）。
  // 无 data-tab 的按钮切不出任何面板——静默跳过等于埋一个「点了没反应」的哑按钮，故响亮告警。
  const ids: string[] = [];
  for (const btn of tabs) {
    const id = btn.dataset.tab ?? "";
    if (!id) {
      logWarn("tabs", `${prefix}: tab 按钮缺 data-tab，已跳过（该按钮不可切换）`, btn);
      continue;
    }
    ids.push(id);
    if (!host.state.root.getElementById(`${prefix}-tab-${id}`)) {
      logWarn("tabs", `${prefix}: 缺面板 #${prefix}-tab-${id}（按钮在但内容区将空白）`);
    }
  }
  if (!ids.length) return;

  // ARIA 语义化：tablist + tab + tabpanel（一次性注入，避免重复 setAttribute）
  const tabList = tabs[0].parentElement;
  if (tabList && tabList.getAttribute("role") !== "tablist") {
    tabList.setAttribute("role", "tablist");
  }
  tabs.forEach((btn, i) => {
    const tabId = btn.dataset.tab ?? "";
    if (!tabId) return; // 缺 data-tab：派生循环已告警，此处跳过
    const panelId = `${prefix}-tab-${tabId}`;
    btn.setAttribute("role", "tab");
    btn.setAttribute("id", `${prefix}-tab-btn-${tabId}`);
    btn.setAttribute("aria-controls", panelId);
    btn.setAttribute("tabindex", i === 0 ? "0" : "-1"); // roving tabindex
    const panel = host.state.root.getElementById(panelId);
    if (panel) {
      panel.setAttribute("role", "tabpanel");
      panel.setAttribute("aria-labelledby", btn.id);
      if (i !== 0) panel.setAttribute("hidden", "");
    }
  });

  // P3 收敛（审核）：tab 懒初始化分发由查表替代 if/else-if 链，与 app-preview 的 PREVIEW_HANDLERS 同构模式对齐
  type TabInitFn = (h: AppContentHost, c: HTMLElement) => Promise<unknown>;
  const TAB_INIT: Record<string, TabInitFn> = {
    recycle: initRecycleTab,
    dedup: initDedupTab,
    oldest: initOldestTab,
  };

  const inited: Record<string, boolean> = {};

  /** 切 tab 核心逻辑（click/keyboard 共用） */
  const activate = async (targetBtn: HTMLElement): Promise<void> => {
    const tab = targetBtn.dataset.tab || "";
    // 切换按钮态
    tabs.forEach((t, _i) => {
      const isActive = t === targetBtn;
      t.classList.toggle("active", isActive);
      t.setAttribute("aria-selected", String(isActive));
      t.setAttribute("tabindex", isActive ? "0" : "-1"); // roving tabindex
    });
    // 切换内容卡
    ids.forEach((id) => {
      const el = host.state.root.getElementById(`${prefix}-tab-${id}`);
      if (!el) return;
      if (id === tab) {
        el.style.display = "";
        el.removeAttribute("hidden");
      } else {
        el.style.display = "none";
        el.setAttribute("hidden", "");
      }
    });
    // 首次切换到非默认 tab 时初始化内容
    if (!inited[tab] && tab !== ids[0]) {
      const container = host.state.root.getElementById(`${prefix}-tab-${tab}`);
      if (!container) return;
      // P3 修复（审核，陷阱 #3）：懒初始化是 async 链（动态 import / 业务 init），
      // 原在 await 前就置 inited=true 且无 try/catch——动态导入失败或 init 抛错时
      // tab 永久卡死（重试被 inited 拦截）且无用户反馈。先置位防并发重复初始化，
      // catch 中复位以允许重试并 toast 提示（ADR-044 ①：async handler 最外层必有 catch）。
      inited[tab] = true;
      try {
        const initFn = TAB_INIT[tab];
        if (initFn) {
          const cleanup = await initFn(host, container);
          if (typeof cleanup === "function") host.subs.addPage(cleanup as () => void);
        }
      } catch (e) {
        inited[tab] = false;
        bus.emit("toast:show", {
          msg: `❌ ${friendlyError(e, t("common.loadFailed"))}`,
          duration: TOAST_MS.verbose,
          type: "error",
        });
      }
      // 注意：resourcepacks/shaderpacks/blueprint/MMD/VRC/LITEMATIC 六个
      // initResourcePacks 分支已删除（P2 审计：tpl 无对应 repo-tab 按钮与容器 id，
      // 双重复死不可达；资源类型切换改由 app-nav 资源切换器重渲染 <app-tree>）。
      // wrapper（features/resource-packs.ts）保留作兼容层，见 resource-packs 知识卡。
    }
  };

  tabs.forEach((btn) => {
    btn.addEventListener("click", () => {
      btn.focus();
      void activate(btn);
    });
    // WAI-ARIA Tabs 键盘模式
    btn.addEventListener("keydown", (e) => {
      const vis = tabs.filter((t) => t.style.display !== "none");
      const vIdx = Math.max(0, vis.indexOf(btn));
      let next: HTMLElement | undefined;
      if (e.key === "ArrowRight") {
        e.preventDefault();
        next = vis[(vIdx + 1) % vis.length];
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        next = vis[(vIdx - 1 + vis.length) % vis.length];
      } else if (e.key === "Home") {
        e.preventDefault();
        next = vis[0];
      } else if (e.key === "End") {
        e.preventDefault();
        next = vis[vis.length - 1];
      } else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        void activate(btn);
        return;
      }
      if (next) {
        next.focus();
        // 自动激活（WAI-ARIA automatic activation 模式：切 tab 即切换内容）
        void activate(next);
      }
    });
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
 * 返回组件卸载时需执行的清理函数（bus 订阅取消）。
 * P3 修复：配置面板独立容器，扫描结果只写 result-list，不被 innerHTML 覆盖销毁。
 */
async function initDedupTab(
  _host: AppContentHost,
  container: HTMLElement,
): Promise<(() => void) | null> {
  // 每宿主一个去重会话：busy/exec 重入守卫与去重配置收进会话闭包，跨 tab 开关/类型切换复用同一配置
  const dedup = createDedupSession();
  let dedupType = safeGet("repo_rtype") || RESOURCE_TYPES.YSM;
  container.innerHTML =
    '<div style="display:flex;flex-direction:column;height:100%">' +
    '<div style="display:flex;align-items:center;gap:8px;padding:4px 12px;border-bottom:1px solid var(--bd)">' +
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
    '<div id="dedup-config-panel" style="padding:4px 12px;border-bottom:1px solid var(--bd)"></div>' +
    '<div id="dedup-result-list" style="flex:1;overflow-y:auto;padding:8px 0"></div>' +
    "</div>";
  const panel = container.querySelector("#dedup-config-panel") as HTMLElement | null;
  if (panel) dedup.initConfig(panel);
  const doDedup = (): void => {
    const listEl = container.querySelector("#dedup-result-list");
    if (listEl) dedup.start(listEl as HTMLElement, (s: unknown) => esc(String(s || "")), dedupType);
  };
  container.querySelector("#dedup-start-btn")?.addEventListener("click", doDedup);
  // 全局类型切换时自动复扫
  const unsub = bus.on("repo:rtype-changed", (rt) => {
    if (rt !== dedupType) {
      dedupType = rt;
      doDedup();
    }
  });
  return unsub;
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
      msg: `❌ ${friendlyError(e, t("content.settingsInitFailed"))}`,
      duration: TOAST_MS.long,
      type: "error",
    });
  }
}

// initWorkshopPage / initGithubPage 转发壳已删除（P1-2）——
// page-registry 直接引用 init-workshop.ts / init-github.ts 的实现函数。

// 最近选中模型路径（rememberModelPath / getLastModelPath / __resetLastModelPathForTest）
// 已迁出至 core/model-path-store.ts（ADR-221：跨视图共享态归位 core，断开三个视图域的越权边）。
