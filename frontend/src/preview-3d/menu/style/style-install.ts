// 🥉 ui-helpers — 样式注入原语（零依赖叶子）。
// 为 ui-components-styles / ui-slide-menu-styles 提供统一的 CSSStyleSheet 构建 + document.head 注入能力，
// 消除两文件间逐字节同构的 20 行脚手架重复。

export interface InstallableStyles {
  /** CSSStyleSheet（shadow DOM 用），无 CSSStyleSheet 支持的环境为 null */
  sheet: CSSStyleSheet | null;
  /** 幂等注入 document.head（全局/light-DOM 场景） */
  install(doc?: Document): void;
}

/**
 * 构建可注入的样式对象。
 * @param css CSS 字符串
 * @param dataAttr data-* 属性名（注入 style 标签时标记来源）
 * @param label 错误日志标签
 */
export function createInstallableStyles(
  css: string,
  dataAttr: string,
  label: string,
): InstallableStyles {
  let sheet: CSSStyleSheet | null = null;
  try {
    if (typeof CSSStyleSheet !== "undefined") {
      sheet = new CSSStyleSheet();
      sheet.replaceSync(css);
    }
  } catch (e) {
    console.error(`[${label}] CSS 解析失败`, e);
  }

  let installed = false;
  return {
    sheet,
    install(doc: Document = document): void {
      if (installed) return;
      const st = doc.createElement("style");
      st.setAttribute(dataAttr, "");
      st.textContent = css;
      doc.head.appendChild(st);
      installed = true;
    },
  };
}
