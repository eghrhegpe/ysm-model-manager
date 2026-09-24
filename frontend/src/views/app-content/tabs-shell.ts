// ===== tabs-shell.ts — tab 栏 + 面板容器的单点产出（ADR-259）=====
//
// 背景：`bindTabs()`（init-pages.ts）只标准化了 tab 的**运行期**行为——按
// `${prefix}-tab-${id}` 查面板、切 `display`、统一 ARIA / roving tabindex / 键盘 / 懒加载。
// 而「tab 栏 + 面板容器」的**标记产出**此前由每个页面各手写一遍，无工厂、无约束，
// 于是并存两种结构范式（5 页「每 tab 一个 .tab-body」vs 诊断页「一个共享 .tab-body
// 包 N 个 .diag-panel」）。2026-09-17 诊断页因漏一个 `</div>` 让面板被吞并、切 tab 整片
// 空白——唯一偏离主流的那页正是出事的那页（`skills/pitfalls.md` #20）。
//
// 本模块把该结构收成**单点产出**：结构正确性由代码保证，不由模板作者记忆。
// 与 `bindTabs` 共享同一条 id 规则（`${prefix}-tab-${id}`），两侧不再靠人对齐。
//
// 标准范式（ADR-259 §2.1）：**每个 tab 一个 `.tab-body`**，作为 `.repo-wrap` 的直接子节点；
// 首个面板不写 `display`（回落 `.tab-body` 布局），其余 `display:none`——与 `bindTabs.activate`
// 的 `style.display = "" / "none"` 翻转口径一致。
//
// 纯字符串（零依赖）：可 node 环境单测，也可被任意页面模板复用。

/** 单个 tab 的声明：按钮文案 + 面板内容 + 该面板的差异项 */
export interface TabSpec {
  /** tab 标识。面板 id = `${prefix}-tab-${id}`（与 bindTabs 运行期查找约定同源） */
  id: string;
  /** 按钮 inner HTML（图标 + 文案由调用方拼 UI_ICONS / t()） */
  label: string;
  /** 按钮 data-testid（如仓库页四个 tab 共用 content-tab） */
  buttonTestid?: string;
  /** 面板 inner HTML */
  body: string;
  /** 桌面专属 tab（入口依赖 Go 本地能力 / CLI）：查看器/网页版由 renderTabs **单点隐藏**，
   * 调用方不再另写远处的选择器名单——「要不要藏」写在定义它的地方（ADR-259 同构精神） */
  desktopOnly?: boolean;
  /** 面板额外行内样式。布局基线由 `.tab-body` 提供，此处**只放差异**（如 overflow-y:auto / padding:12px） */
  panelStyle?: string;
  /** 面板 data-testid（稳定的测试钩子，ADR-133） */
  panelTestid?: string;
}

/** tab 壳声明：栏 + 面板组 */
export interface TabsShellSpec {
  /** 面板 id 前缀：面板 id = `${prefix}-tab-${id}` */
  prefix: string;
  /** tab 列表；首个即默认激活项。调用方须保证非空 */
  tabs: readonly TabSpec[];
  /** tab 栏（`.repo-tabs`）的 id */
  barId?: string;
  /** tab 栏的 data-testid */
  barTestid?: string;
  /** 按钮样式类，默认 `repo-tab`（settings 页历史用 `stg-tab`） */
  buttonClass?: string;
  /** 附加到每个面板的类（如诊断页的动画钩子 `diag-panel`） */
  panelClass?: string;
  /** 查看器/网页版（isViewerMode）：带 desktopOnly 的 tab **整 tab 隐藏**（按钮+面板）。
   * 单点在此而非各页 init：避免「远处的选择器名单」与 tpl 声明漂移（ADR-259 §2.1）；
   * 只藏按钮不藏 tab 会留下空壳 tab（pitfalls：满屏引导空态却点不着东西）。 */
  viewerMode?: boolean;
  /** viewerMode 且确有 desktopOnly tab 被隐藏时，在 tab 栏**外**产出的一行告知
   *（ADR-300 §2.5：网页版从「沉默消失」变「可见缺席」）。不传则不产出。
   * ⚠️ 落位在 `.repo-tabs`（role=tablist）之后、面板组之前——tablist 内只应含
   * role=tab 元素（ADR-258 §2.4 ARIA 红线），故告知行由 renderTabs 单独产出、
   * 调用方拼在 bar 与 panels 之间，不得塞进 bar。文案 i18n 归调用方页面键域。 */
  viewerNotice?: string;
}

/**
 * tab 壳的两半：栏与面板组**分别产出**——落位由调用方决定。
 *
 * 为什么不返回拼接好的单串：仓库页的面板嵌在 `.repo-left`（与预览面板并列），
 * 并不紧邻 tab 栏；工厂只保证**单元结构**（每个面板都是独立 `.tab-body`、id 与
 * display 口径正确），**相邻性 / 落位属调用方的布局职责**。
 */
export interface TabsShell {
  /** `.repo-tabs` 栏（含全部按钮，首个 active） */
  bar: string;
  /** 面板组（每个 tab 一个 `.tab-body`，首个可见、其余 display:none） */
  panels: string;
  /** 查看器告知行（ADR-300 §2.5）：仅当 viewerMode 且确有 desktopOnly 被隐藏且调用方
   * 传了 viewerNotice 时非空；落位 = bar 与 panels 之间。其余情形恒为 ""。 */
  notice: string;
}

/** 按声明产出「tab 栏 + 面板组（+ 查看器告知行）」；调用方负责外层容器与落位。 */
export function renderTabs(spec: TabsShellSpec): TabsShell {
  const {
    prefix,
    tabs,
    barId,
    barTestid,
    buttonClass = "repo-tab",
    panelClass,
    viewerMode,
    viewerNotice,
  } = spec;
  // desktopOnly 只在 viewerMode 下生效；首个**可见** tab 才是默认激活项（原语义不变）
  const visible = tabs.filter((t) => !(viewerMode && t.desktopOnly));

  const barAttrs =
    (barId ? ` id="${barId}"` : "") + (barTestid ? ` data-testid="${barTestid}"` : "");
  const bar = `<div class="repo-tabs"${barAttrs}>${visible
    .map(
      (tab, i) =>
        `<button class="${buttonClass}${i === 0 ? " active" : ""}"${tab.buttonTestid ? ` data-testid="${tab.buttonTestid}"` : ""} data-tab="${tab.id}">${tab.label}</button>`,
    )
    .join("")}</div>`;

  const panelCls = panelClass ? `tab-body ${panelClass}` : "tab-body";
  const panels = visible
    .map((tab, i) => {
      // 首个可见：不写 display，回落 `.tab-body{display:flex}`；其余 display:none
      const style = [i === 0 ? "" : "display:none", tab.panelStyle ?? ""].filter(Boolean).join(";");
      const styleAttr = style ? ` style="${style}"` : "";
      const testidAttr = tab.panelTestid ? ` data-testid="${tab.panelTestid}"` : "";
      return `<div class="${panelCls}" id="${prefix}-tab-${tab.id}"${testidAttr}${styleAttr}>${tab.body}</div>`;
    })
    .join("");

  // 告知行只在「真的藏了东西」时产出（ADR-300 §2.5）：全可见的页/桌面模式零噪音
  const notice =
    viewerMode && viewerNotice && visible.length < tabs.length
      ? `<div class="repo-tabs-notice">${viewerNotice}</div>`
      : "";

  return { bar, panels, notice };
}
