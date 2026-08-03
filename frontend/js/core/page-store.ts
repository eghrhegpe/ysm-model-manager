// ===== 页面导航状态（类型化版 — ADR-014 P3 组件层）=====
// 治理红线：页面状态唯一来源是 PageStore（AGENTS.md 4.1）
import { bus } from "../bus.ts";

let _currentPage = "repository";

/** 页面名（宽松字符串，核心页见 AGENTS.md TERMINOLOGY） */
export type PageName = string;

export const PageStore = {
  get currentPage(): PageName {
    return _currentPage;
  },

  setCurrentPage(page: PageName): void {
    if (_currentPage === page) return;
    _currentPage = page;
    bus.emit("nav:changed", { page });
  },
};

// 初始化：监听外部 nav:changed（来自 app-content 的导航切换）
bus.on("nav:changed", ({ page }) => {
  if (page && page !== _currentPage) {
    _currentPage = page;
  }
});
