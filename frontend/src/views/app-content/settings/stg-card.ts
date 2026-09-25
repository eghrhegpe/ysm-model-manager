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
  const titleInner = icon ? `${icon} ${title}` : title;
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

// ===== 同族卡片组：入场延迟按序号派生（2026-09 锐评 P2）=====
// 问题：此前每张卡的 delayMs 都是调用方手填的字面量，全页散落
// 0/60/60/90/120/150/180/210/240/270/300 十一档，两套步长（组内 30、路径组 60）混用，
// 而鸣谢两组却用 `60 * (i + 1)` 自动派生——同一件事两条标准。新增第七张卡时
// 「下一个填多少」无规则可循，是典型的自动新增漂移点。
// 分界：**组内延迟 = 序号派生**（本函数）；**页面级编排延迟 = 显式 delayMs**
// （如存储卡 180 / 语言卡 240，那是「这一组整体何时入场」的编排决策，不属于组序号）。

/** 同族卡片组默认入场延迟步长（ms）。 */
const STG_CARD_STEP_MS = 30;

/** 组内单张卡的声明（供 {@link stgCards} 批量产出）。 */
export interface StgCardSpec extends Omit<StgCardOpts, "delayMs" | "marginTop"> {
  icon: string;
  title: string;
  body: string;
}

/** 批量产出一族卡片：animation-delay 由「起始 + 序号 × 步长」派生，调用方不再手填阶梯。 */
export function stgCards(
  items: readonly StgCardSpec[],
  opts: { startMs?: number; step?: number } = {},
): string {
  const { startMs = 0, step = STG_CARD_STEP_MS } = opts;
  return items
    .map(({ icon, title, body, ...rest }, i) =>
      stgCard(icon, title, body, { ...rest, delayMs: startMs + i * step }),
    )
    .join("");
}
