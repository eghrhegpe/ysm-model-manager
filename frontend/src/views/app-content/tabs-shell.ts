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

/** 单个 tab 的声明：按钮文案 + 面板内容 + 该面板的差异项。
 *  @typeParam Id tab id 的字面量联合（调用方可传 `"general" | "about"` 等，让漏同步的
 *  id 在编译期报错；不传回落 `string`，与既有调用方全兼容）。 */
export interface TabSpec<Id extends string = string> {
  /** tab 标识。面板 id = `${prefix}-tab-${id}`（与 bindTabs 运行期查找约定同源）。
   *  ⚠️ id 必须与按钮显示文案同义：它是 DOM `data-tab` 与面板 id 的唯一锚点（测试钩子、
   *  未来的深链接都抓它），留历史妥协名 = 把 ADR-305 治理过的命名脱钩病换个载体重犯。 */
  id: Id;
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
export interface TabsShellSpec<Id extends string = string> {
  /** 面板 id 前缀：面板 id = `${prefix}-tab-${id}` */
  prefix: string;
  /** tab 列表；首个即默认激活项。调用方须保证非空 */
  tabs: readonly TabSpec<Id>[];
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
export function renderTabs<Id extends string = string>(spec: TabsShellSpec<Id>): TabsShell {
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

// ===== 组内二级导航（ADR-300 §2.2：全页子切换只有一种 pill 语法）=====
//
// 与 renderTabs/bindTabs 同一分工：本文件管**产出与激活机制**，页面 init 只管接线与副作用。
// 立因：诊断页曾并存两套「页内再分屏」语法（log 组 pill 按钮 vs bench 组 select 模式轴），
// 用户在同一页要学两遍；pill 是唯一升格形态，select 退役（ADR-300 D2）。

/** 子 pill 声明（文案不带图标——顶层 tab 独享图标预算，ADR-300 §2.3） */
export interface SubTabSpec {
  /** 子面板标识，落为按钮 `data-sub="<id>"`；面板侧以 `data-sub-pane="<id>[ …]"` 认领 */
  id: string;
  /** pill 文案（纯文本，i18n 由调用方解析后传入） */
  label: string;
}

/**
 * 产出一条子 pill 行（组内二级导航的**唯一**标记出口）。
 *
 * - 稳定测试钩子由 `group + id` 派生：`data-testid="diag-sub-<group>-<id>"`——同 renderTabs
 *   的 id 规则一样，模板与测试两侧不再靠人肉对齐。
 * - `data-active-sub` 初始化为激活项：bench 组读它作为运行模式源（ADR-300 §2.2 三读点收口）。
 * - **不套 `role="tablist"`**：顶层 tabbar 已是 tablist，嵌套双 tablist 是 ARIA 反模式。
 *   采纳 ADR-300 §3 遗留点名的第一种姿势——`.diag-sub-bar` 为 `role="toolbar"` +
 *   `aria-label="{group} 子切换"`，每个 pill 为 `role="radio"` + `aria-checked`
 *   （互斥单选，非 tab 语义）；当前项 `tabindex="0"`（roving tabindex 基座），其余 `-1`。
 *   键盘化由此处（bindSubBar）单点实现，见下方函数。
 */
export function renderSubBar(
  group: string,
  items: readonly SubTabSpec[],
  activeId: string,
): string {
  const barLabel = `subbar-${group}`;
  return `<div class="diag-sub-bar" data-sub-bar="${group}" data-active-sub="${activeId}" role="toolbar" aria-label="${barLabel}">${items
    .map(
      (t) =>
        `<button class="diag-sub-tab${t.id === activeId ? " active" : ""}" data-sub="${t.id}" data-testid="diag-sub-${group}-${t.id}" role="radio" aria-checked="${t.id === activeId ? "true" : "false"}"${t.id === activeId ? ' tabindex="0"' : ' tabindex="-1"'}>${t.label}</button>`,
    )
    .join("")}</div>`;
}

/**
 * 接线一条子 pill 行：点击 → 迁移 active、写 `data-active-sub`、按集合显隐组内面板、跑副作用。
 *
 * 面板显隐约定（与 bindTabs 的 display 翻转口径同源）：
 *  - 组内元素带 `data-sub-group="<group>" data-sub-pane="<id>[ <id2> …]"`；
 *  - `data-sub-pane` 是**可见集合**——一个元素可在多个子态下常驻（如日志工具栏
 *    `"op runtime"`），单项即普通面板（`"trace"`）；初始态由模板 inline `display:none`
 *    表达，激活置空回落 CSS，非激活置 none。
 *  - bench 组的行显隐**不走**本机制（那是 `.perf-mode-off` + `[data-perf-mode]` 的既有领地，
 *    ADR-278 §2.4——两套机制不互相覆盖）；bench 的 onSwitch 只负责触发 `applyPerfModeUI`。
 *
 * 键盘化（ADR-300 §3 遗留，2026 接线）：bar 具 `role="toolbar"`（renderSubBar 产出）时，
 * 挂 roving tabindex + 方向键（ArrowLeft/Right 循环、Home/End 首尾、Enter/Space 激活）。
 * 兼容：手写夹具/旧模板的 `.diag-sub-bar` 无 role 属性 → 自动跳过键盘增强，仅保留点击。
 *
 * 与页面级监听同理不做注销 API：pill 与面板同属 shadow 树生命周期，语言切换整页重建后重绑。
 */
export function bindSubBar(root: ShadowRoot, group: string, onSwitch?: (id: string) => void): void {
  const bar = root.querySelector<HTMLElement>(`.diag-sub-bar[data-sub-bar="${group}"]`);
  if (!bar) return;
  const pills = [...bar.querySelectorAll<HTMLElement>(".diag-sub-tab")];
  if (!pills.length) return;

  /** 迁移 active 选中态 + aria-checked + roving tabindex + 写 data-active-sub + 显隐/副作用 */
  const activate = (pill: HTMLElement): void => {
    const id = pill.dataset.sub ?? "";
    pills.forEach((b) => {
      const on = b === pill;
      b.classList.toggle("active", on);
      b.setAttribute("aria-checked", on ? "true" : "false");
      b.tabIndex = on ? 0 : -1;
    });
    bar.dataset.activeSub = id;
    root
      .querySelectorAll<HTMLElement>(`[data-sub-group="${group}"][data-sub-pane]`)
      .forEach((pane) => {
        const set = (pane.dataset.subPane ?? "").split(/\s+/);
        pane.style.display = set.includes(id) ? "" : "none";
      });
    onSwitch?.(id);
  };

  pills.forEach((pill) => {
    pill.addEventListener("click", () => activate(pill));
  });

  // —— 键盘导航（仅当 bar 具 renderSubBar 产出的 role="toolbar" 时启用；手写夹具跳过）——
  if (bar.getAttribute("role") !== "toolbar") return;

  // 可导航 pill（排除 aria-disabled="true"）——roving 圈在可用项内
  const navPills = pills.filter((p) => p.getAttribute("aria-disabled") !== "true");
  if (!navPills.length) return;

  // 焦点索引自维护：`document.activeElement` 对 shadow 内聚焦元素会 retarget 回 host
  // （规范行为），读它取到的是 host/容器而非 pill——恒失准。用 focusin（bar 级委托）
  // 单写点 + activate 同步 + keydown 的 target 兜底三路把 focusIdx 保持为「真实当前项」。
  let focusIdx = navPills.findIndex((p) => p.classList.contains("active"));
  bar.addEventListener("focusin", (e) => {
    const idx = navPills.indexOf(e.target as HTMLElement);
    if (idx !== -1) focusIdx = idx;
  });

  const focusIndex = (idx: number): void => {
    const target = navPills[idx];
    if (!target) return;
    focusIdx = idx;
    target.focus();
  };

  // 方向键移动 = 激活（radio 语义：移动即选中）同步聚焦
  const moveTo = (idx: number): void => {
    const target = navPills[(idx + navPills.length) % navPills.length];
    if (!target) return;
    activate(target);
    focusIdx = navPills.indexOf(target);
    target.focus();
  };

  bar.addEventListener("keydown", (e: KeyboardEvent) => {
    // 真实键盘路径：e.target 是聚焦 pill；测试直接派发到 bar 时回落 focusIdx
    const targetIdx = navPills.indexOf(e.target as HTMLElement);
    const curIdx = targetIdx !== -1 ? targetIdx : focusIdx;
    if (curIdx === -1) return; // 焦点从未落进本 bar（外部误触）→ 不接管
    switch (e.key) {
      case "ArrowRight":
      case "ArrowDown":
        e.preventDefault();
        moveTo(curIdx + 1);
        return;
      case "ArrowLeft":
      case "ArrowUp":
        e.preventDefault();
        moveTo(curIdx - 1);
        return;
      case "Home":
        e.preventDefault();
        focusIndex(0); // radiogroup 规范：Home/End 只移焦点、不改选中
        return;
      case "End":
        e.preventDefault();
        focusIndex(navPills.length - 1);
        return;
      default:
        return;
    }
  });
}
