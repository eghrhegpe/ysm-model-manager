// ===== bind-roving.ts — Roving Tabindex 列表键盘原语（ADR-308 D2）=====
// spec → 键盘操作：单个 keydown 委托挂在 container 上，管理 roving tabindex +
// ARIA 状态位（list/tab → aria-selected，radio → aria-checked）+ 焦点移动 +
// onMove/onActivate 回调。消费方模板负责结构 role（listbox/option/radiogroup 等），
// 本原语只管「交互状态」——与 tabs-a11y bindTabA11y / sync-manager radio-group
// 同构（spec-driven 声明式原语，仓内 6 处同构键盘实现收敛的第二站）。
//
// 现状消费方：app-sidebar 整合包卡片列表（preset "list"，垂直，移动即激活——
// 激活 = 派发到既有点击委托路径，高亮/涟漪/去重/持久化零复制）。
// 后续收敛对象：tabs-shell bindSubBar / sync-manager radio-group /
// slide-menu smBindKeyboardNav / app-nav / dropdown（按 ADR-308 D2 接入顺序拍板后推进）。

export type RovingPreset = "radio" | "tab" | "list";

export interface RovingSpec {
  /** 作用域（ShadowRoot / document）：container 选择器在此范围内解析 */
  root: ShadowRoot | Document;
  /** 容器：字符串 = root 内选择器；元素 = 直接挂监听 */
  container: string | Element;
  /** 可聚焦 item 选择器（每次按键实时查询，重渲染换血不脱钩） */
  itemSelector: string;
  /** radio：移动即激活 + aria-checked；tab：移动只聚焦，Enter/Space 激活 + aria-selected；
   *  list：移动即激活 + aria-selected（默认） */
  preset?: RovingPreset;
  /** vertical → ArrowUp/Down；horizontal → ArrowLeft/Right；both → 四向（默认 "both"） */
  orientation?: "vertical" | "horizontal" | "both";
  /** 默认 false（端点 clamp）；true 首尾回绕 */
  cyclic?: boolean;
  /** 默认 true：Home/End 跳端 */
  homeEnd?: boolean;
  /** 默认 0 */
  initialIndex?: number;
  /** 放行门控：返回 false 跳过本次事件（同 key-router when 让路语义） */
  when?: (e: KeyboardEvent) => boolean;
  /** 方向键/Home/End 移动后回调（item 为新焦点项） */
  onMove?: (item: HTMLElement, index: number) => void;
  /** 激活回调：preset radio/list 移动即触发 + Enter/Space 触发；tab 仅 Enter/Space */
  onActivate?: (item: HTMLElement, index: number) => void;
}

export interface RovingHandle {
  /** 对齐外部选区（restore/高亮）：更新 roving tabindex + 状态位，不夺焦 */
  syncIndex(index: number): void;
  /** 程序化激活当前项 */
  activate(): void;
  dispose(): void;
}

const stateAttrOf = (preset: RovingPreset): "aria-checked" | "aria-selected" =>
  preset === "radio" ? "aria-checked" : "aria-selected";

export function bindRoving(spec: RovingSpec): RovingHandle {
  const preset: RovingPreset = spec.preset ?? "list";
  const orientation = spec.orientation ?? "both";
  const cyclic = spec.cyclic === true;
  const homeEnd = spec.homeEnd !== false;
  const stateAttr = stateAttrOf(preset);
  const container =
    typeof spec.container === "string"
      ? (spec.root.querySelector(spec.container) as Element | null)
      : spec.container;

  let stateIndex = spec.initialIndex ?? 0;
  let disposed = false;

  const itemsOf = (): HTMLElement[] =>
    container ? (Array.from(container.querySelectorAll(spec.itemSelector)) as HTMLElement[]) : [];

  /** roving tabindex + 状态位铺满（active 项 0/true，其余 -1/false）；越界 clamp */
  const layout = (items: HTMLElement[]): number => {
    const len = items.length;
    const idx = len ? Math.min(Math.max(stateIndex, 0), len - 1) : 0;
    items.forEach((el, i) => {
      el.tabIndex = i === idx ? 0 : -1;
      el.setAttribute(stateAttr, i === idx ? "true" : "false");
    });
    return idx;
  };

  /** target 落在哪个 item 内（直接命中或后代）；-1 = 不在任何 item 内 */
  const indexOfTarget = (items: HTMLElement[], target: EventTarget | null): number => {
    if (!(target instanceof Node)) return -1;
    for (let i = 0; i < items.length; i++) if (items[i].contains(target)) return i;
    return -1;
  };

  const isEditable = (el: HTMLElement | null): boolean =>
    el instanceof HTMLElement &&
    (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);

  let onKeydown: ((e: KeyboardEvent) => void) | null = null;
  /** 实注册监听：Element 的 addEventListener 无泛型 EventMap 重载（仅字符串版收
   *  EventListener），故包一层 Event→KeyboardEvent 窄化；dispose 移除同一包装对象 */
  let keyListener: ((e: Event) => void) | null = null;

  if (container) {
    onKeydown = (e: KeyboardEvent): void => {
      if (disposed) return;
      if (spec.when && !spec.when(e)) return;
      // 修饰键方向键让路给全局组合键（key-router 管 Ctrl+F 之类，本原语只管裸导航键）
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const items = itemsOf();
      if (!items.length) return;

      const target = e.target instanceof HTMLElement ? e.target : (null as HTMLElement | null);
      if (isEditable(target)) return; // 输入中不接管（与 app-tree 裸键让路同口径）

      // 基准：焦点在 item 内 → 该 item；否则（焦点在 container 上）→ stateIndex 位序
      const cur = indexOfTarget(items, e.target);
      const base = cur >= 0 ? cur : Math.min(Math.max(stateIndex, 0), items.length - 1);

      let next: number | null = null;
      switch (e.key) {
        case "Home":
          if (homeEnd) next = 0;
          break;
        case "End":
          if (homeEnd) next = items.length - 1;
          break;
        case "ArrowDown":
        case "ArrowRight": {
          // 前进键：vertical 认 Down、horizontal 认 Right、both 双认
          const fwd =
            orientation === "both" ||
            (orientation === "vertical" && e.key === "ArrowDown") ||
            (orientation === "horizontal" && e.key === "ArrowRight");
          if (fwd) next = cyclic ? (base + 1) % items.length : Math.min(base + 1, items.length - 1);
          break;
        }
        case "ArrowUp":
        case "ArrowLeft": {
          const bwd =
            orientation === "both" ||
            (orientation === "vertical" && e.key === "ArrowUp") ||
            (orientation === "horizontal" && e.key === "ArrowLeft");
          if (bwd) next = cyclic ? (base - 1 + items.length) % items.length : Math.max(base - 1, 0);
          break;
        }
        case "Enter":
        case " ":
        case "Space":
          e.preventDefault();
          spec.onActivate?.(items[base], base);
          return;
        default:
          return;
      }
      if (next === null) return;
      e.preventDefault();
      if (next === base) return; // 端点不动：不回调、不重排（幂等连按安全）
      stateIndex = next;
      layout(items);
      items[next].focus();
      spec.onMove?.(items[next], next);
      if (preset !== "tab") spec.onActivate?.(items[next], next);
    };
    keyListener = (e: Event) => onKeydown?.(e as KeyboardEvent);
    container.addEventListener("keydown", keyListener);
  }

  // 初始布局（items 可能尚未渲染——_reload 异步补卡后由实时查询兜底）
  layout(itemsOf());

  const handle: RovingHandle = {
    syncIndex(index: number): void {
      stateIndex = index;
      layout(itemsOf());
    },
    activate(): void {
      const items = itemsOf();
      if (!items.length || disposed) return;
      spec.onActivate?.(
        items[Math.min(stateIndex, items.length - 1)],
        Math.min(stateIndex, items.length - 1),
      );
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      if (container && keyListener) container.removeEventListener("keydown", keyListener);
      keyListener = null;
      onKeydown = null;
    },
  };
  return handle;
}
