// ===== Shadow 根样式装配原语 =====
//
// 解决的问题：Shadow DOM 的 CSS 隔离。全局 <link>/<style> 的**规则**进不了 shadow 树
// （只有 `var()` 自定义属性能穿透），所以每个自定义元素的 shadow 根必须自带样式表：
//
//   root.adoptedStyleSheets = [由 CSS 文本构建的 CSSStyleSheet]
//
// 此前 4 个视图（app-sidebar / app-tree / app-content / app-preview）各自手抄同一段
// 12 行样板：
//
//   const appXxxStyle: CSSStyleSheet = (() => {
//     if (typeof CSSStyleSheet === "undefined") {
//       return { replaceSync: () => {} } as unknown as CSSStyleSheet;
//     }
//     const sheet = new CSSStyleSheet();
//     sheet.replaceSync(xxxCSS);
//     return sheet;
//   })();
//   export { appXxxStyle };
//
// 以及各自的 HMR accept 回调。本文件把两半收成一处：
// 「建 sheet（含环境守卫）→ 装到 shadow 根 → 注册 HMR 热替换」。
//
// ⚠️ 环境守卫必须保留：happy-dom/vitest 等环境无 `CSSStyleSheet`，
//    直接 `new CSSStyleSheet()` 会让 **import 即崩**，连带所有 import 该视图的测试失败。
//
// 相关：`utils/dom/css-hmr.ts`（HMR 侧的 sheet 替换细节）、
//       `utils/dom/css.ts`（跨 shadow 复用的共享 CSS 串：wsIconCSS / dropdownBaseCSS / metaTagCSS）。
//       —— 共享串的机制是「每个根各自 adopt 同一份文本」，
//       因为 CSS 规则无法穿透 shadow 边界，只能把同一份喂给每个根。
import { attachStyleSheetMarker, refreshAdoptedStyleSheets } from "./css-hmr.ts";

/** 目标元素的 shadow 根持有着色表；由 {@link createShadowStyle} 装配。 */
export interface ShadowStyle {
  /** 构建好的样式表；无 `CSSStyleSheet` 支持的环境为占位对象（replaceSync 为 no-op） */
  readonly sheet: CSSStyleSheet;
  readonly cssText: string;
  readonly selector: string;
  /**
   * 注册本视图的 CSS HMR：源文件变更时替换 shadow 根上的**同标记** sheet。
   *
   * 收编此前 4 处逐字同构的回调：
   * ```ts
   * import.meta.hot?.accept("./sidebar-css.ts", (m) => {
   *   refreshAdoptedStyleSheets(m?.sidebarCSS, "app-sidebar");
   * });
   * ```
   * @param hot        `import.meta.hot`
   * @param path       被监听的 CSS 模块路径（相对当前文件）
   * @param exportName 该模块导出的 CSS 字符串名（如 `"treeCSS"`）
   */
  acceptHmr(hot: ImportMeta["hot"], path: string, exportName: string): void;
}

/**
 * 由 CSS 文本构建 shadow 根样式表（含无 `CSSStyleSheet` 环境守卫）。
 *
 * @param cssText  样式文本（通常来自 `*.ts` 里的 CSS 字符串导出）
 * @param selector 宿主元素选择器（如 `"app-tree"`），供 HMR 定位目标
 *
 * @example
 * ```ts
 * export const appTreeStyle = createShadowStyle(treeCSS, "app-tree");
 * // 组件内： this._root.adoptedStyleSheets = [appTreeStyle.sheet];
 * // HMR：    appTreeStyle.acceptHmr(import.meta.hot, "./app-tree-styles.ts", "treeCSS");
 * ```
 */
export function createShadowStyle(cssText: string, selector: string): ShadowStyle {
  let sheet: CSSStyleSheet;
  if (typeof CSSStyleSheet === "undefined") {
    // 占位对象：测试环境（node/happy-dom）无 CSSStyleSheet。
    // 只在 import 期不崩；adoptedStyleSheets 在这些环境不会被真正消费。
    sheet = { replaceSync: () => {} } as unknown as CSSStyleSheet;
  } else {
    sheet = new CSSStyleSheet();
    sheet.replaceSync(cssText);
  }
  attachStyleSheetMarker(sheet, selector);
  return {
    sheet,
    cssText,
    selector,
    /** 见 {@link ShadowStyle.acceptHmr} */
    acceptHmr(hot: ImportMeta["hot"], path: string, exportName: string): void {
      hot?.accept(path, (newCssMod: Record<string, unknown> | undefined) => {
        const cssText = newCssMod?.[exportName];
        if (typeof cssText !== "string") return;
        refreshAdoptedStyleSheets(cssText, selector);
      });
    },
  };
}
