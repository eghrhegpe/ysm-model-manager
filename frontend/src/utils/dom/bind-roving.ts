// ===== bind-roving.ts — Roving Tabindex 列表键盘原语（ADR-308 D2）=====
// spec → 键盘操作：单个 keydown 委托挂在 container 上，管理 roving tabindex +
// ARIA 状态位（list/tab → aria-selected，radio → aria-checked）+ 焦点移动 +
// onMove/onActivate 回调。消费方模板负责结构 role（listbox/option/radiogroup 等），
// 本原语只管「交互状态」——与 tabs-a11y bindTabA11y / sync-manager radio-group
// 同构（spec-driven 声明式原语，仓内 6 处同构键盘实现收敛的第二站）。
//
// 现状消费方：app-sidebar 整合包卡片列表（preset "list"，垂直，移动即激活——
// 激活 = 派发到既有点击委托路径，高亮/涟漪/去重/持久化零复制）；
// 3D slide-menu（preset "tab"，垂直，cyclic + activeElementBase + itemsOf +
// stateAttr:null——无 role 容器不写 ARIA 位；外壳语义 Escape 保留独立监听）；
// app-nav 顶部导航（preset "tab" + cyclic + stateAttr:null，容器级键派发 +
// activeElementBase；SELECT 可编辑守卫让路）；
// tabs-shell 子栏（preset "radio" + cyclic + homeEnd:false + stateAttr:null，
// focusin 三路同步退役，独立 Home/End 小监听只移焦点不激活）；
// dropdown 菜单（preset "tab" + cyclic + activeElementBase + stateAttr:null，
// itemsOf 实时菜单项，独立 Escape 小监听关闭回焦）；
// sync-manager 状态筛选 radio（preset "radio" + cyclic + homeEnd:false +
// stateAttr:null，容器=组件根委托式挂点 + when 门控重渲染自愈）。

export type RovingPreset = "radio" | "tab" | "list";

export interface RovingSpec {
  /** 作用域（ShadowRoot / document）：container 选择器在此范围内解析 */
  root: ShadowRoot | Document;
  /** 容器：字符串 = root 内选择器；元素 = 直接挂监听 */
  container: string | Element;
  /** 可聚焦 item 选择器（每次按键实时查询，重渲染换血不脱钩）。
   *  仅在 `itemsOf` 缺省时使用——与 `itemsOf` **二选一（至少其一）**；两者皆缺会在
   *  首次取 items 时 fail-loud 抛 TypeError（此前 itemSelector 必填，「传 itemsOf 仍要塞
   *  占位选择器」是 API 反模式，2026-10 战评审气味修复） */
  itemSelector?: string;
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
  /** 移动/激活基准：true = 实际焦点（root.activeElement，不在 items 内时回退 stateIndex）；
   *  false（默认）= e.target（含 item 后代，否则回退 stateIndex）。
   *  slide-menu 冻结契约 = 键派发到容器 + 焦点项为基准 → 需置 true */
  activeElementBase?: boolean;
  /** 自定义 item 提供器（如 slide-menu 的可见直接子元素 offsetParent 过滤）；
   *  缺省 = 每次按键实时 container.querySelectorAll(itemSelector) */
  itemsOf?: (container: Element) => HTMLElement[];
  /** ARIA 状态位：null = 不写任何属性（无 role 容器专用，写了即 ARIA 非法）；
   *  缺省按 preset 派生（radio→aria-checked，tab/list→aria-selected） */
  stateAttr?: "aria-selected" | "aria-checked" | null;
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

/** 归一后的朝向（spec.orientation 缺省 "both"） */
type RovingOrientation = "vertical" | "horizontal" | "both";

/**
 * roving 运行时上下文：键处理提到顶层具名函数后，闭包状态（stateIndex/disposed/layout/
 * itemsOf）经此显式传递。提到顶层是刻意的——扫描器递归函数体 AST，传给 addEventListener
 * 的箭头回调不重置嵌套深度，写在 if 里的事件体要按外层 depth 逐条计分。
 */
interface RovingRuntime {
  spec: RovingSpec;
  root: ShadowRoot | Document;
  preset: RovingPreset;
  orientation: RovingOrientation;
  cyclic: boolean;
  homeEnd: boolean;
  activeElementBase: boolean;
  itemsOf: () => HTMLElement[];
  layout: (items: HTMLElement[]) => number;
  getStateIndex: () => number;
  setStateIndex: (index: number) => void;
  isDisposed: () => boolean;
}

/** target 落在哪个 item 内（直接命中或后代）；-1 = 不在任何 item 内 */
function indexOfTarget(items: HTMLElement[], target: EventTarget | null): number {
  if (!(target instanceof Node)) return -1;
  for (let i = 0; i < items.length; i++) if (items[i].contains(target)) return i;
  return -1;
}

/** 可编辑目标守卫：输入中不接管方向键（与 app-tree 裸键让路同口径） */
function isEditable(el: HTMLElement | null): boolean {
  return (
    el instanceof HTMLElement &&
    (el.tagName === "INPUT" ||
      el.tagName === "TEXTAREA" ||
      el.tagName === "SELECT" ||
      el.isContentEditable)
  );
}

/**
 * 方向键轴向判定：+1 前进 / -1 后退 / 0 该键在此朝向无效。
 * 前进键：vertical 认 Down、horizontal 认 Right、both 双认（后退键同构：vertical 认 Up、
 * horizontal 认 Left）。与原 switch 两 case 体逐键等价：Down/Right 与 Up/Left 键名互斥，
 * 合并判定不改变任何分支可达性。
 */
function rovingStepOf(orientation: RovingOrientation, key: string): number {
  const isFwd = key === "ArrowDown" || key === "ArrowRight";
  const isBwd = key === "ArrowUp" || key === "ArrowLeft";
  if (!isFwd && !isBwd) return 0;
  if (orientation === "both") return isFwd ? 1 : -1;
  const wantFwd = orientation === "vertical" ? "ArrowDown" : "ArrowRight";
  const wantBwd = orientation === "vertical" ? "ArrowUp" : "ArrowLeft";
  if (key === wantFwd) return 1;
  if (key === wantBwd) return -1;
  return 0;
}

/**
 * 移动基准（已在 items 位序内 clamp）。
 * 基准：activeElementBase → 实际焦点项（slide-menu 冻结契约：键派发到容器时
 * 焦点项才是移动基准）；缺省 → e.target 所在 item（后代命中同认）；
 * 均落空 → stateIndex 位序（clamp）。
 */
function rovingBaseIndexOf(
  rt: RovingRuntime,
  items: HTMLElement[],
  target: EventTarget | null,
): number {
  const clampState = (): number => Math.min(Math.max(rt.getStateIndex(), 0), items.length - 1);
  if (!rt.activeElementBase) {
    const cur = indexOfTarget(items, target);
    return cur >= 0 ? cur : clampState();
  }
  const ae = rt.root.activeElement as HTMLElement | null;
  const ai = ae ? items.indexOf(ae) : -1;
  return ai >= 0 ? ai : clampState();
}

/**
 * 单键 → 目标位序（无效键/被门控 → null）：Home/End 受 homeEnd 门控，
 * 方向键受朝向门控；cyclic 首尾回绕，否则端点 clamp。
 */
function rovingNextIndexOf(
  rt: RovingRuntime,
  key: string,
  base: number,
  len: number,
): number | null {
  if (key === "Home") return rt.homeEnd ? 0 : null;
  if (key === "End") return rt.homeEnd ? len - 1 : null;
  const step = rovingStepOf(rt.orientation, key);
  if (step === 0) return null;
  if (step > 0) return rt.cyclic ? (base + 1) % len : Math.min(base + 1, len - 1);
  return rt.cyclic ? (base - 1 + len) % len : Math.max(base - 1, 0);
}

/** 单次 keydown 委托体（挂在 container 上唯一监听；顶层具名 → 不吃消费方嵌套深度） */
function rovingOnKeydown(rt: RovingRuntime, e: KeyboardEvent): void {
  if (rt.isDisposed()) return;
  if (rt.spec.when && !rt.spec.when(e)) return;
  // 修饰键方向键让路给全局组合键（key-router 管 Ctrl+F 之类，本原语只管裸导航键）
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const items = rt.itemsOf();
  if (!items.length) return;

  const target = e.target instanceof HTMLElement ? e.target : (null as HTMLElement | null);
  if (isEditable(target)) return;

  const base = rovingBaseIndexOf(rt, items, e.target);

  // 激活键先于移动仲裁（键名与 Home/End/Arrow* 互斥，短路顺序等价原 switch case 组）
  if (e.key === "Enter" || e.key === " " || e.key === "Space") {
    e.preventDefault();
    rt.spec.onActivate?.(items[base], base);
    return;
  }

  const next = rovingNextIndexOf(rt, e.key, base, items.length);
  if (next === null) return;
  e.preventDefault();
  if (next === base) return; // 端点不动：不回调、不重排（幂等连按安全）
  rt.setStateIndex(next);
  rt.layout(items);
  items[next].focus();
  rt.spec.onMove?.(items[next], next);
  if (rt.preset !== "tab") rt.spec.onActivate?.(items[next], next);
}

export function bindRoving(spec: RovingSpec): RovingHandle {
  const preset: RovingPreset = spec.preset ?? "list";
  const orientation: RovingOrientation = spec.orientation ?? "both";
  const cyclic = spec.cyclic === true;
  const homeEnd = spec.homeEnd !== false;
  const activeElementBase = spec.activeElementBase === true;
  const stateAttr = spec.stateAttr === undefined ? stateAttrOf(preset) : spec.stateAttr;
  const itemsProvider =
    spec.itemsOf ??
    ((c: Element): HTMLElement[] => {
      if (!spec.itemSelector) {
        // fail-loud：itemsOf 与 itemSelector 必须至少提供一个（未来调用传了 itemsOf
        // 而漏 itemSelector 属类型违约的反面——可选化后两者皆缺是静默失效，
        // 空匹配只会让键盘原语无声不响应，比报错更难查）。
        throw new TypeError("bindRoving: itemsOf 与 itemSelector 必须至少提供一个");
      }
      return Array.from(c.querySelectorAll(spec.itemSelector)) as HTMLElement[];
    });
  const container =
    typeof spec.container === "string"
      ? (spec.root.querySelector(spec.container) as Element | null)
      : spec.container;

  let stateIndex = spec.initialIndex ?? 0;
  let disposed = false;

  const itemsOf = (): HTMLElement[] => (container ? itemsProvider(container) : []);

  /** roving tabindex + 状态位铺满（active 项 0/true，其余 -1/false）；越界 clamp */
  const layout = (items: HTMLElement[]): number => {
    const len = items.length;
    const idx = len ? Math.min(Math.max(stateIndex, 0), len - 1) : 0;
    items.forEach((el, i) => {
      el.tabIndex = i === idx ? 0 : -1;
      if (stateAttr) el.setAttribute(stateAttr, i === idx ? "true" : "false");
    });
    return idx;
  };

  const rt: RovingRuntime = {
    spec,
    root: spec.root,
    preset,
    orientation,
    cyclic,
    homeEnd,
    activeElementBase,
    itemsOf,
    layout,
    getStateIndex: () => stateIndex,
    setStateIndex: (index: number): void => {
      stateIndex = index;
    },
    isDisposed: () => disposed,
  };

  let onKeydown: ((e: KeyboardEvent) => void) | null = null;
  /** 实注册监听：Element 的 addEventListener 无泛型 EventMap 重载（仅字符串版收
   *  EventListener），故包一层 Event→KeyboardEvent 窄化；dispose 移除同一包装对象 */
  let keyListener: ((e: Event) => void) | null = null;

  if (container) {
    onKeydown = (e: KeyboardEvent): void => rovingOnKeydown(rt, e);
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
