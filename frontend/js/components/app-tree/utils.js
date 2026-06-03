// ===== app-tree 特有工具函数 =====

// 按钮闪烁反馈
export function flashBtn(el) {
  if (!el) return;
  el.classList.add("flash");
  setTimeout(() => el.classList.remove("flash"), 400);
}

// —— 以下委托到全局工具 ——
// 文件大小/日期格式化 → js/utils/fmt.js
// HTML 转义/高亮 → js/utils/dom.js
// 文件图标 → js/utils/icon.js
//
// 但为了避免循环 import 问题，这些工具直接在 render.js 中 import。
// 这里只放 tree 组件特有的工具。
