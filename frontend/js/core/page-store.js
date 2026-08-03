import { bus } from "../bus.ts";

let _currentPage = "repository";

export const PageStore = {
  get currentPage() {
    return _currentPage;
  },

  setCurrentPage(page) {
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
