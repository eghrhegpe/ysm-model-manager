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

// ===== 页面级编排：有序单元表按声明顺序自动派生档位（2026-10 方案 A 落地）=====
// 病（锐评 P2 深化）：此前编排档由三套机制各算各的（STG_BAND 行组 / stgCards 卡组
// startMs / 单卡 delayMs），互不感知 → appearance「主题自动 60」与「字体组首卡 60」
// 同刻、about「intro 第三卡 120」与「guide 首卡 120」同刻。命名档表（STG_*_DELAY）
// 只治「裸字面量」，未治「两套步长 + 手填档位」。
// 治：本编排器接管——每 tab 一张有序单元表，按声明顺序自动累加槽位：
//   单元起始 = 前序累计；单卡/行组占 1 槽（+step），卡组占 (n-1)×cardStep+step 槽
//   （组内末卡之后恒留 step 空隙给下一组，故任何卡数都零撞车）。
//   加卡/加组 = 表里加一项，顺序即档位——零思考、零手算、零撞车。
// 统一步长：组间恒 step（默认 60，即旧 STG_GROUP_STEP_MS）；组内步长由卡组自声
// （默认 30，旧 STG_CARD_STEP_MS；大卡组可声明 60——语义「卡组内视觉节奏」，与组间 60 不混）。

/** 编排单元声明：render 接收本单元（组）的起始延迟（ms），返回该单元 HTML。 */
export interface StgUnitSpec {
  /** 渲染本单元：接收派生好的起始延迟，内部对行组写 animation-delay / 对卡组作 stgCards startMs。 */
  render: (startMs: number) => string;
  /** 卡组卡数（组内序号 × cardStep 派生）；行组/单卡省略（按 1 槽）。 */
  cardCount?: number;
  /** 卡组组内步长（默认 30）；仅当 cardCount 声明时有效。 */
  cardStep?: number;
}

/**
 * 按声明顺序派生出每个单元的起始延迟并渲染。
 * 槽位规则：起始 = 前序累计；单卡/行组推进 step；卡组推进 (n-1)×cardStep + step。
 * 返回各单元 HTML 以换行拼接（与手写模板的换行形态一致）。
 */
export function stgUnits(units: readonly StgUnitSpec[], opts: { step?: number } = {}): string {
  const step = opts.step ?? 60;
  let startMs = 0;
  const parts: string[] = [];
  for (const u of units) {
    parts.push(u.render(startMs));
    const n = u.cardCount ?? 1;
    const cardStep = u.cardStep ?? STG_CARD_STEP_MS;
    startMs += (n - 1) * cardStep + step;
  }
  return parts.join("\n");
}
