// ===== 静态文档层可达性标签 i18n（a11y 普及 2026 收口）=====
// index.html 的静态可达性标签（skip-link 文案/aria-label、app-nav、#main-content、<title>）
// 是**无 JS 兜底值**（zh-CN 字面量）。i18n 是 t() 单一出口，静态 HTML 不另立翻译源——
// 启动链在 initI18n 之后经本模块覆写为当前语言。语言切换（setLang）不经本模块：
// 这些标签只在启动时解析一次，切换语言需刷新窗口（与既有静态文本行为一致）。
// 层属：src 根装配层叶子（同 startup-reveal.ts 姿势），核心逻辑无顶层副作用，可直测。
import { t } from "@/core/i18n/t.ts";

/** 把 index.html 静态可达性标签覆写为当前 i18n 语言（幂等：每次调用以当前 t() 为准）。 */
export function localizeStaticA11yLabels(): void {
  document.title = t("a11y.appTitle");
  const skip = document.querySelector(".skip-link");
  if (skip) {
    skip.textContent = t("a11y.skipNav");
    skip.setAttribute("aria-label", t("a11y.skipNavAria"));
  }
  document.querySelector("app-nav")?.setAttribute("aria-label", t("a11y.mainNav"));
  document.getElementById("main-content")?.setAttribute("aria-label", t("a11y.mainContent"));
}
