// ===== CSS Shadow Sheet HMR 热刷新（治理：消除 CSS 动态 import 的 as any 模板重复；调用侧仍有个别 as Element 强转，因 HTMLElement.shadowRoot 类型需要）=====
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
/** WeakMap 存储 sheet → selector 标记（不阻止 GC，旧 sheet 被替换后自动释放） */
const sheetMarker = new WeakMap<CSSStyleSheet, string>();

export function refreshAdoptedStyleSheets(cssText: string | undefined, selector: string): void {
  if (cssText === undefined) return;
  const style = new CSSStyleSheet();
  style.replaceSync(cssText);
  // 标记归属：分 sheet 替换时用于定位目标，WeakMap 不阻止 GC
  sheetMarker.set(style, selector);
  document.querySelectorAll(selector).forEach((el) => {
    const root = (el as Element).shadowRoot;
    if (!root) return;
    const sheets = [...root.adoptedStyleSheets];
    // 找旧的同标记 sheet，只替换那一个，保留其他 sheet 不被洗掉
    const idx = sheets.findIndex((s) => sheetMarker.get(s) === selector);
    if (idx >= 0) {
      sheets[idx] = style;
    } else {
      sheets.push(style);
    }
    root.adoptedStyleSheets = sheets;
  });
}
