// ===== 页面导航状态（类型化版 — ADR-014 P3 组件层）=====
// 治理红线：页面状态唯一来源是 PageStore（AGENTS.md 4.1）
import { bus, type PageName } from "../bus.ts";

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
 */
export function resolveInitialPage(): PageName {
  const configured = localStorage.getItem("ui-default-page");
  if (configured) {
    return configured === "resources" ? "repository" : (configured as PageName);
  }
  const saved = localStorage.getItem("nav_page");
  if (saved && saved !== "repository") {
    return saved === "resources" ? "repository" : (saved as PageName);
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
      if (page !== _currentPage) {
        _currentPage = page;
      }
    }),
  );
}
