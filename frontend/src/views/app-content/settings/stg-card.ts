// ===== stg-card.ts — 设置页卡片头/外壳统一构造器（ADR-040 收敛自 tpl-settings.ts 手写 header/card）=====
// 背景：设置页此前每个 stg-card-hdr / stg-card 各写各的，复制时把「图标+标题」拆成独立 flex 项，
// 配合 justify-content:space-between 导致标题文字被推到中间、与图标分离（游戏根目录/文件存储卡片即此 bug）。
// 本构造器强制「图标+标题」始终包进同一元素，actions 作为右侧独立项，杜绝再次漂移。
// 纯字符串构建，零依赖（调用方传入 UI_ICONS.* 与 t(...)），引擎无关、可单测。

/** 卡片头选项。 */
export interface StgCardHeaderOpts {
  /** label 关联的控件 id（for 属性）；传入则用 <label>（语义绑定），否则用 <span> 包裹标题组。 */
  forId?: string;
  /** 右侧操作区 HTML（按钮/徽标等），作为独立 flex 项；配 spaceBetween 推到右侧。 */
  actions?: string;
  /** 标题与操作是否两端对齐（justify-content:space-between）。默认 true（标题左、操作右）。 */
  spaceBetween?: boolean;
  /** 标题字号："md"（var(--fs-md)/600，区块标题，默认）或 "base"（沿用 .stg-card-hdr 默认 fs-sm/600）。 */
  titleSize?: "md" | "base";
}

/**
 * 构建统一的 `.stg-card-hdr`：图标+标题合并为单一 flex 项，actions 推到右侧。
 * 返回的 div 自带 display:flex;align-items:center，与 .stg-card-hdr 基类一致且自包含。
 */
export function stgCardHeader(icon: string, title: string, opts: StgCardHeaderOpts = {}): string {
  const { forId, actions = "", spaceBetween = true, titleSize = "md" } = opts;
  const titleStyle = titleSize === "md" ? "font-size:var(--fs-md);font-weight:600" : "";
  const titleInner = `${icon} ${title}`;
  const titleEl = forId
    ? `<label for="${forId}" class="label"${titleStyle ? ` style="${titleStyle}"` : ""}>${titleInner}</label>`
    : `<span class="label"${titleStyle ? ` style="${titleStyle}"` : ""}>${titleInner}</span>`;
  const justify = spaceBetween ? "justify-content:space-between;" : "";
  return `<div class="stg-card-hdr" style="display:flex;align-items:center;${justify}">${titleEl}${actions}</div>`;
}

/** 卡片外壳选项。 */
export interface StgCardOpts {
  /** 透传给 {@link stgCardHeader} 的标题选项（forId / actions / spaceBetween / titleSize）。 */
  header?: StgCardHeaderOpts;
  /** .stg-card 的 id（如 "stg-files-card"，供测试/定位）。 */
  cardId?: string;
  /** 进入动画延迟（ms），与原手写 animation-delay 一致。 */
  delayMs?: number;
  /** 卡片上外边距（px），如存储卡 margin-top:8px。 */
  marginTop?: number;
  /** 透加到 .stg-card 行内 style 的额外片段（不含结尾分号亦可）。 */
  cardStyle?: string;
}

/**
 * 构建统一的 `.stg-card`：外壳 + 调用 {@link stgCardHeader} 生成标题行 + 包一层 `.stg-card-body` 容纳 body 插槽。
 * 与裸写 `<div class="stg-card">…` 等价，但强制 `animation-delay`/`margin-top` 走参数、
 * 标题行走 stgCardHeader（杜绝图标+标题漂移），body 始终被 `.stg-card-body` 包裹。
 */
export function stgCard(icon: string, title: string, body: string, opts: StgCardOpts = {}): string {
  const { header = {}, cardId = "", delayMs, marginTop, cardStyle = "" } = opts;
  const idAttr = cardId ? ` id="${cardId}"` : "";
  const styleParts: string[] = [];
  if (delayMs !== undefined) styleParts.push(`animation-delay:${delayMs}ms`);
  if (marginTop !== undefined) styleParts.push(`margin-top:${marginTop}px`);
  if (cardStyle) styleParts.push(cardStyle);
  const styleAttr = styleParts.length ? ` style="${styleParts.join(";")}"` : "";
  return `<div class="stg-card"${idAttr}${styleAttr}>${stgCardHeader(icon, title, header)}<div class="stg-card-body">${body}</div></div>`;
}

/** 单个 `.setting-row` 的内容：左侧标签 + 右侧控件（两端对齐由 CSS 类自持）。 */
export interface StgRowContent {
  /** 图标（调用方传 UI_ICONS.*，本模块零依赖）。 */
  icon: string;
  /** 标签文案，已 t() 过。 */
  label: string;
  /** 标签关联的控件 id（for 属性）。 */
  forId: string;
  /** 右侧控件 HTML（select / checkbox 等）。 */
  control: string;
}

/** 构建单个 `.setting-row`：图标+标签合并为一个 label，控件作为右侧项。 */
export function stgRow(row: StgRowContent): string {
  return `<div class="setting-row">\n    <label for="${row.forId}" class="label">${row.icon} ${row.label}</label>\n    ${row.control}\n  </div>`;
}

/** `.settings-group` 壳选项（无 hdr，与 .stg-card 是两种壳，勿混用）。 */
export interface StgGroupOpts {
  /** 进入动画延迟（ms）——.settings-group 的行内 animation-delay。 */
  delayMs?: number;
  /** 底部提示行文案（已 t() 过）；省略则不渲染 `.stg-hint`。 */
  hint?: string;
  /** 组下外边距（px），默认 12（与既有手写值一致）。 */
  marginBottom?: number;
}

/**
 * 构建 `.settings-group` 壳（基础设置页的行组，**无卡片头**）：
 * 包住若干 {@link stgRow} 与可选的 `.stg-hint`。
 *
 * 与 {@link stgCard} 的区别：`.settings-group` 是 `padding:0 16px` 的行容器（行自身带
 * `background:var(--surf)`），`.stg-card` 是带 hdr 的整块卡片。两者视觉层级不同，勿互换。
 */
export function stgGroup(rows: string, opts: StgGroupOpts = {}): string {
  const { delayMs, hint, marginBottom = 12 } = opts;
  const anim = "animation:card-in var(--tr-enter) both";
  const delay = delayMs !== undefined ? `;animation-delay:${delayMs}ms` : "";
  const hintHtml = hint ? `\n  <div class="stg-hint">${hint}</div>` : "";
  return `<div class="settings-group" style="margin-bottom:${marginBottom}px;${anim}${delay}">\n${rows}${hintHtml}\n</div>`;
}
