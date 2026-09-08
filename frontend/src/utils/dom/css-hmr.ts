// ===== CSS Shadow Sheet HMR 热刷新（治理：消除 CSS 动态 import 的 as any 模板重复）=====
// 四个视图组件（sidebar / tree / content / preview）各自的 CSS HMR accept 回调
// 模式完全同构（new CSSStyleSheet → replaceSync → adoptedStyleSheets），
// 此前每处都写一遍，且因 Vite 无 .css.ts 的类型声明不得不 (newCssMod as any).xxxCSS。
// 本文件把模板收敛到一个函数，让 HMR 闭包内只需一行调用。

/**
 * 热刷指定自定义元素的 Shadow DOM 样式表。
 * @param cssText   新 CSS 文本（来自 CSS 模块的导出值），undefined 时跳过
 * @param selector  目标元素选择器，如 "app-sidebar"
 * @note 调用侧用 `newCssMod?.xxxCSS` 防御 undefined（Vite HMR 可能传 undefined）
 */
/** 自定义标记：用于在 adoptedStyleSheets 数组中定位本函数管理的 sheet，实现分 sheet 替换 */
const HMR_MARKER = "__hmrSelector";

export function refreshAdoptedStyleSheets(cssText: string | undefined, selector: string): void {
  if (cssText === undefined) return;
  const style = new CSSStyleSheet();
  style.replaceSync(cssText);
  // 标记归属：分 sheet 替换时用于定位目标，不污染 adoptedStyleSheets 数组里的其他 sheet
  (style as CSSStyleSheet & { [HMR_MARKER]?: string })[HMR_MARKER] = selector;
  document.querySelectorAll(selector).forEach((el) => {
    const root = (el as Element).shadowRoot;
    if (!root) return;
    const sheets = [...root.adoptedStyleSheets];
    // 找旧的同标记 sheet，只替换那一个，保留其他 sheet 不被洗掉
    const idx = sheets.findIndex(
      (s) => (s as CSSStyleSheet & { [HMR_MARKER]?: string })[HMR_MARKER] === selector,
    );
    if (idx >= 0) {
      sheets[idx] = style;
    } else {
      sheets.push(style);
    }
    root.adoptedStyleSheets = sheets;
  });
}
