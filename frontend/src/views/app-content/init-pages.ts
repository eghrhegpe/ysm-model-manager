// ===== 页面初始化函数集合（为 app-content/index.ts 减负，ADR-040）=====
import { TOAST_MS } from "../../utils/dom/toast-ms.ts";
import { bus } from "../../bus.ts";
import { initDiagnostics } from "./diagnostics/init.ts";
import { initSettings } from "./settings/init.ts";
import { initRecycleBin } from "../../features/recycle-bin.ts";
import { loadOldestModel } from "../../features/oldest-models.ts";
import { createDedupSession } from "./diagnostics/dedup.ts";
import { RESOURCE_TYPES } from "../../utils/resource/types.ts";
import { safeGet } from "../../utils/dom/storage.ts";
import { esc } from "../../utils/dom/html.ts";
import { t } from "../../core/i18n/t.ts";
import { friendlyError } from "../../utils/dom/errors.ts";
import { initWorkshopPage as _initWorkshopPage } from "./init-workshop.ts";
import { initGithubPage as _initGithubPage } from "./init-github.ts";
import type { AppContentHost } from "./init-workshop.ts";

/**
 * 初始化诊断页
 */
export function initDiagnosticsPage(host: AppContentHost): void {
  initDiagnostics(host._root, (s) => esc(String(s || "")));
}

/**
 * 初始化实例页
 */
export function initInstancesPage(host: AppContentHost): void {
  bindTabs(host, ".repo-tab", "ins", ["versions"]);

  // 只注册一次，避免重复监听
  const insKey = "_insListenerReg";
  if ((host as unknown as Record<string, unknown>)[insKey]) return;
  (host as unknown as Record<string, unknown>)[insKey] = true;

  host._unsubs.push(
    bus.on("package:selected", (pkg) => {
      const content = host._root.getElementById("ins-content");
      if (!content) return;
      // P1 修复：去掉 || RESOURCE_TYPES.YSM 静默兜底。
      // 发射点（app-sidebar/events.ts）已拦空 rtype，这里防御性 return。
      if (!pkg.rtype) return;
      const insName = pkg.name || "";
      const defaultType = pkg.rtype;
      content.innerHTML =
        '<app-sync-manager instance="' +
        String(insName).replace(/"/g, "&quot;") +
        '" default-type="' +
        defaultType +
        '" style="display:flex;flex-direction:column;flex:1;overflow:hidden;height:100%"></app-sync-manager>';
    }),
  );
}

/**
 * 初始化仓库页
 */
export function initRepositoryPage(host: AppContentHost): void {
  bindTabs(host, ".repo-tab", "repo", ["tree", "recycle", "dedup", "oldest"]);

  // 资源类型由导航栏全局切换器驱动（app-nav 双下拉 → repo:rtype-changed + repo_rtype/repo_subdir 落盘）。
  // 仓库页不再持有本地 subtabs，只订阅全局事件重建文件树（单一入口，ADR-092/094 收敛）。
  const root = host._root;
  const treeBody = root.getElementById("repo-tab-tree");

  // 重建文件树：按 rtype + 可选 subdir（mmd 子目录）挂载 app-tree
  const mountTree = (rtype: string, subdir: string): void => {
    if (!treeBody) return;
    treeBody.innerHTML =
      '<app-tree root="' +
      rtype +
      '"' +
      (subdir ? ' subdir="' + subdir + '"' : "") +
      ' style="flex:1;min-width:0"></app-tree>';
  };

  // 全局 rtype 变化 → 重建文件树（app-nav 切换器 emit；subdir 从 localStorage 读）
  host._unsubs.push(
    bus.on("repo:rtype-changed", (rt) => {
      mountTree(rt, safeGet("repo_subdir") || "");
    }),
  );

  // 初始挂载：从 localStorage 恢复（app-nav 已在连接时初始化切换器并落盘）
  const savedRtype = safeGet("repo_rtype") || RESOURCE_TYPES.YSM;
  mountTree(savedRtype, safeGet("repo_subdir") || "");
}

/**
 * 绑定 tab 按钮切换。按钮选择器与内容卡前缀解耦（样式类可复用，语义前缀独立）：
 *   bindTabs(host, ".repo-tab", "ins", ["versions"]) —— 按钮用 repo-tab 样式类，内容卡 id 为 ins-tab-versions
 */
function bindTabs(
  host: AppContentHost,
  tabSelector: string,
  prefix: string,
  ids: string[],
): void {
  const tabs = Array.from(host._root.querySelectorAll<HTMLElement>(tabSelector));
  if (!tabs.length) return;

  // ARIA 语义化：tablist + tab + tabpanel（一次性注入，避免重复 setAttribute）
  const tabList = tabs[0].parentElement;
  if (tabList && tabList.getAttribute("role") !== "tablist") {
    tabList.setAttribute("role", "tablist");
  }
  tabs.forEach((btn, i) => {
    const tabId = btn.dataset.tab || ids[i] || "";
    const panelId = prefix + "-tab-" + tabId;
    btn.setAttribute("role", "tab");
    btn.setAttribute("id", prefix + "-tab-btn-" + tabId);
    btn.setAttribute("aria-controls", panelId);
    btn.setAttribute("tabindex", i === 0 ? "0" : "-1"); // roving tabindex
    const panel = host._root.getElementById(panelId);
    if (panel) {
      panel.setAttribute("role", "tabpanel");
      panel.setAttribute("aria-labelledby", btn.id);
      if (i !== 0) panel.setAttribute("hidden", "");
    }
  });

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
      const el = host._root.getElementById(prefix + "-tab-" + id);
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
        const container = host._root.getElementById(prefix + "-tab-" + tab);
        if (!container) return;
        // P3 修复（审核，陷阱 #3）：懒初始化是 async 链（动态 import / 业务 init），
        // 原在 await 前就置 inited=true 且无 try/catch——动态导入失败或 init 抛错时
        // tab 永久卡死（重试被 inited 拦截）且无用户反馈。先置位防并发重复初始化，
        // catch 中复位以允许重试并 toast 提示（ADR-044 ①：async handler 最外层必有 catch）。
        inited[tab] = true;
        try {
          if (tab === "recycle") {
            const recycleCleanup = await initRecycleTab(host, container);
            if (recycleCleanup) host._unsubs.push(recycleCleanup);
          } else if (tab === "dedup") {
            const unsub = await initDedupTab(host, container);
            if (unsub) host._unsubs.push(unsub);
          } else if (tab === "oldest") {
            const oldestCleanup = await initOldestTab(host, container);
            if (oldestCleanup) host._unsubs.push(oldestCleanup);
          }
        } catch (e) {
          inited[tab] = false;
          bus.emit("toast:show", {
            msg: "❌ " + friendlyError(e, t("common.loadFailed")),
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
      const idx = tabs.indexOf(btn);
      let next: HTMLElement | undefined;
      if (e.key === "ArrowRight") {
        e.preventDefault();
        next = tabs[(idx + 1) % tabs.length];
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        next = tabs[(idx - 1 + tabs.length) % tabs.length];
      } else if (e.key === "Home") {
        e.preventDefault();
        next = tabs[0];
      } else if (e.key === "End") {
        e.preventDefault();
        next = tabs[tabs.length - 1];
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
async function initRecycleTab(host: AppContentHost, container: HTMLElement): Promise<(() => void) | null> {
  const { recycleHTML } = await import("./tpl-recycle.ts");
  container.innerHTML = recycleHTML();
  const recycleCleanup = initRecycleBin(host);
  return recycleCleanup;
}

/**
 * 初始化去重组 tab：配置面板 + 开始去重按钮 + 全局类型切换自动复扫。
 * 返回组件卸载时需执行的清理函数（bus 订阅取消）。
 * P3 修复：配置面板独立容器，扫描结果只写 result-list，不被 innerHTML 覆盖销毁。
 */
async function initDedupTab(_host: AppContentHost, container: HTMLElement): Promise<(() => void) | null> {
  // 每宿主一个去重会话：busy/exec 重入守卫与去重配置收进会话闭包，跨 tab 开关/类型切换复用同一配置
  const dedup = createDedupSession();
  let dedupType = safeGet("repo_rtype") || RESOURCE_TYPES.YSM;
  container.innerHTML =
    '<div style="display:flex;flex-direction:column;height:100%">' +
    '<div style="display:flex;align-items:center;gap:8px;padding:4px 12px;border-bottom:1px solid var(--bd)">' +
    '<span style="flex:1;font-size:var(--fs-sm);color:var(--muted)">📌 ' + t("dedup.sha256Hint") + '</span>' +
    '<button class="btn-base accent" id="dedup-start-btn">🔗 ' + t("dedup.startDedup") + '</button>' +
    "</div>" +
    '<div id="dedup-config-panel" style="padding:4px 12px;border-bottom:1px solid var(--bd)"></div>' +
    '<div id="dedup-result-list" style="flex:1;overflow-y:auto;padding:8px 0"></div>' +
    "</div>";
  const panel = container.querySelector("#dedup-config-panel") as HTMLElement | null;
  if (panel) dedup.initConfig(panel);
  const doDedup = (): void => {
    const listEl = container.querySelector("#dedup-result-list");
    if (listEl)
      dedup.start(
        listEl as HTMLElement,
        (s: unknown) => esc(String(s || "")),
        dedupType,
      );
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
async function initOldestTab(_host: AppContentHost, container: HTMLElement): Promise<(() => void) | null> {
  const oldestCleanup = await loadOldestModel(container, (s) => esc(s));
  return oldestCleanup;
}

/**
 * 初始化设置页
 */
export async function initSettingsPage(host: AppContentHost): Promise<void> {
  bindTabs(host, ".stg-tab", "stg", ["basic", "ui", "parser", "about", "credits"]);
  try {
    await initSettings(host._root);
  } catch (e) {
    console.error("[settings] 初始化失败:", e);
    bus.emit("toast:show", { msg: "❌ " + friendlyError(e, t("content.settingsInitFailed")), duration: TOAST_MS.long, type: "error" });
  }
}

/**
 * 初始化创意工坊页（转发壳：实现见 ./init-workshop.ts）。
 * init-pages 是页面 init 的统一集合点，page-registry / app-content 单文件取齐全部
 * 页面，此转发避免误判为与 init-workshop.ts 的同名重复。
 */
export function initWorkshopPage(host: AppContentHost): void {
  _initWorkshopPage(host);
}

/**
 * 初始化 GitHub 页（转发壳：实现见 ./init-github.ts）。
 * init-pages 是页面 init 的统一集合点，page-registry / app-content 单文件取齐全部
 * 页面，此转发避免误判为与 init-github.ts 的同名重复。
 */
export function initGithubPage(host: AppContentHost): void {
  _initGithubPage(host);
}

// ===== 最近选中模型（供导航栏 3D 一键跳转复用；app-tree 在 model:select 时写入）=====
let _lastModelPath: string | null = null;

/** 记住最后选中的模型路径（供文件树等外部调用） */
export function rememberModelPath(path: string | null): void {
  _lastModelPath = path;
}

export function getLastModelPath(): string | null {
  return _lastModelPath;
}
