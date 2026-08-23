// ===== 页面导航状态（类型化版 — ADR-014 P3 组件层）=====
// 治理红线：页面状态唯一来源是 PageStore（AGENTS.md 4.1）
import { bus, type PageName } from "../bus.ts";
import { safeGet } from "../utils/dom/storage.ts";

// 唯一写入点：_currentPage 只允许被 registerPageStore 的 nav:changed listener
// 修改（app-content 完成导航后单向广播）；禁止新增其他写入路径，否则页面
// 状态出现幽灵路径（历史教训：setCurrentPage 曾绕过渲染链路，且 emits 完成
// 事件而非请求事件，被调用即"状态变、内容不渲染"）。

/**
 * 解析启动初始页面（app-nav / app-content / PageStore 三处同源调用）。
 * 优先级：① 设置项「启动默认页面」（ui-default-page，用户显式配置）
 *        ② 上次停留页（nav_page，app-nav 每次切页写入）
 *        ③ 仓库页（repository，兜底）
 * "resources" 为历史页面名，映射回仓库页。
 * 未知值（遗留/损坏的 localStorage）回退 repository，防止 _render 落入
 * default 分支却无对应 init 分发（死页，历史教训：resources 遗留值）。
 */
const VALID_PAGES: PageName[] = [
  "repository", "instances", "workshop", "ysmhub", "github", "diagnostics", "settings",
];

// P3 修复（code_review）：导出白名单供 index.html 内联脚本经 window 桥接复用——
// 原内联脚本硬编码第二份六页列表，新增页时两源漂移 → 内联源（后发射）把新页重置回
// repository，静默启动回归。红线 §3.1 只禁双下划线前缀（window. 后接两个下划线），非 __ 前缀与
// window.applyTheme 同模式合规（app-modules 挂载，见 app-modules.ts）。
export const PAGE_WHITELIST: readonly string[] = VALID_PAGES;

function sanitizePage(v: string | null): PageName {
  if (v === "resources") return "repository"; // 历史页面名映射
  return (VALID_PAGES as string[]).includes(v ?? "") ? (v as PageName) : "repository";
}

// P3 修复（子代理审计）：导出 sanitizePage 供 app-nav 复用——app-nav 的 nav:changed
// handler 直接写 _current 未过白名单（非法页 emit → 高亮静默丢失 + 脏值入 nav_page），
// 与 page-store 已修的同款模式对齐
export { sanitizePage };

export function resolveInitialPage(): PageName {
  const configured = safeGet("ui-default-page");
  if (configured) {
    return sanitizePage(configured);
  }
  const saved = safeGet("nav_page");
  if (saved) {
    return sanitizePage(saved);
  }
  return "repository";
}

let _currentPage: PageName = resolveInitialPage();

export const PageStore = {
  get currentPage(): PageName {
    return _currentPage;
  },
};

/** 注册页面状态同步（由 registerGlobalHandlers 统一调用，bus.on 的 unsub 收集进 unsubs 清理） */
export function registerPageStore(unsubs: Array<() => void>): void {
  unsubs.push(
    bus.on("nav:changed", ({ page }) => {
      // P3 修复：写入前过 sanitizePage 白名单——原注释自述「运行时信任 emit 方类型」，
      // 任何遗留 .js 或未来调用方 emit 非法值会使 _currentPage 脱离 PageName 联合
      const safe = sanitizePage(page ?? null);
      if (safe !== _currentPage) {
        _currentPage = safe;
      }
    }),
  );
}
