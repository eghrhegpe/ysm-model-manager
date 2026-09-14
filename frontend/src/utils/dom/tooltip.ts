// ===== 悬浮提示组件（3D overlay 控制层配套，单例 light DOM） =====
// 用途：替代原生 title 的迟缓黄气泡（~1s 延迟、样式不可控）；毛玻璃风格对齐
// 3D HUD（fab.ts .ysm-3d-popup 同族）。tooltip 节点挂 document.body，
// position:fixed + getBoundingClientRect 定位——监听器直接挂目标元素，跨 Shadow DOM 边界可用。
// 消费方：createIconButton（fab.ts）、preview-menu 图标按钮、app-preview 面板 FAB。
//
// 不变量：生产环境只使用默认实例 defaultManager，保证「同一时刻至多一个 tooltip 可见」语义。
// 测试/HMR 场景可创建隔离实例。

const TOOLTIP_STYLE_ID = "ysw-tooltip-styles";

export const YSW_TOOLTIP_CSS = `
.ysw-tooltip{position:fixed;z-index:calc(var(--z-fullscreen, 9999) + 1);max-width:240px;padding:4px 8px;border-radius:var(--radius-md);background:rgba(27,28,36,.95);border:1px solid rgba(255,255,255,.12);box-shadow:0 4px 14px rgba(0,0,0,.35);color:rgba(255,255,255,.9);font-size:var(--fs-sm);font-family:inherit;line-height:1.4;pointer-events:none;white-space:pre-line;opacity:0;transition:opacity .12s ease}
.ysw-tooltip--show{opacity:1}
`;

/** 幂等注入 tooltip 全局样式（默认 head；target 可指定 shadow root 等宿主）
 *  不依赖模块级布尔标记：DOM 实时检查，HMR/样式被外部移除后能自动恢复。
 *  document.head 目标走 id 去重；shadow root 目标每次宿主重建都需重注入
 *  （shadow root 是新树，document.getElementById 查不到，自然走注入路径）。 */
export function ensureTooltipStyles(target?: HTMLElement | ShadowRoot): void {
  if (typeof document === "undefined") return;
  const docTarget = target ?? document.head;
  // head 目标：DOM 实时检查，已存在则跳过
  if (docTarget === document.head) {
    if (document.getElementById(TOOLTIP_STYLE_ID)) return;
  }
  const style = document.createElement("style");
  style.id = TOOLTIP_STYLE_ID;
  style.textContent = YSW_TOOLTIP_CSS;
  docTarget.appendChild(style);
}

export interface TooltipOptions {
  /** 显示延迟 ms（默认 350，避免扫过按钮频闪；0 立即显示） */
  delayMs?: number;
}

/** Tooltip 管理器接口 */
export interface TooltipManager {
  /** 给元素挂悬浮提示，返回 cleanup 函数（摘除全部监听并隐藏） */
  attachTooltip(
    el: HTMLElement,
    getText: string | (() => string),
    opts?: TooltipOptions,
  ): () => void;
  /** 把元素上的原生 title 升级为自定义 tooltip */
  promoteTitle(el: HTMLElement): () => void;
  /** promoteTitle + 空值守卫 */
  promoteTitleIfPresent(el: HTMLElement | null): () => void;
  /** 清理全部监听 + observer + scroll handler（HMR/测试场景） */
  dispose(): void;
}

interface TooltipState {
  el: HTMLDivElement | null;
  target: HTMLElement | null;
  timer: ReturnType<typeof setTimeout> | null;
}

const EDGE_MARGIN = 8;
const GAP = 6;

/**
 * 创建独立的 Tooltip 管理器实例。
 * 生产环境应只使用默认实例（defaultManager），保证「同一时刻至多一个 tooltip 可见」。
 * 测试/HMR 场景可创建隔离实例。
 */
export function createTooltipManager(): TooltipManager {
  const st: TooltipState = { el: null, target: null, timer: null };
  let observer: MutationObserver | null = null;
  let scrollHandler: (() => void) | null = null;
  let scrollRef = 0;

  function ensureTooltipEl(): HTMLDivElement {
    if (!st.el?.isConnected) {
      st.el = document.createElement("div");
      st.el.className = "ysw-tooltip";
      st.el.setAttribute("role", "tooltip");
      document.body.appendChild(st.el);
    }
    // biome-ignore lint/style/noNonNullAssertion: 确定性断言(构建期不变量/窄化逃生)
    return st.el!;
  }

  /** 目标元素脱离 DOM 时兜底隐藏（菜单整体重建时 mouseleave 不触发） */
  function ensureObserver(): MutationObserver | null {
    if (typeof MutationObserver === "undefined") return null;
    if (!observer) {
      observer = new MutationObserver(() => {
        if (st.target && !st.target.isConnected) hide();
      });
    }
    return observer;
  }

  /** 页面滚动时提示会飘离锚点，捕获阶段统一隐藏（原生 title 同行为）。 */
  function ensureScrollHandler(): void {
    if (typeof document === "undefined") return;
    if (scrollRef === 0) {
      scrollHandler = () => {
        if (st.timer !== null || st.target) hide();
      };
      document.addEventListener("scroll", scrollHandler, true);
    }
    scrollRef++;
  }

  function decrementScrollRef(): void {
    if (scrollRef > 0) scrollRef--;
    if (scrollRef === 0 && scrollHandler && typeof document !== "undefined") {
      document.removeEventListener("scroll", scrollHandler, true);
      scrollHandler = null;
    }
  }

  function cancelTimer(): void {
    if (st.timer !== null) {
      clearTimeout(st.timer);
      st.timer = null;
    }
  }

  /** 定位：目标上方水平居中，上方放不下翻到下方；水平夹在视口内 */
  function place(target: HTMLElement): void {
    // biome-ignore lint/style/noNonNullAssertion: 确定性断言(构建期不变量/窄化逃生)
    const tip = st.el!;
    const r = target.getBoundingClientRect();
    const tw = tip.offsetWidth;
    const th = tip.offsetHeight;
    let x = r.left + r.width / 2 - tw / 2;
    x = Math.max(EDGE_MARGIN, Math.min(x, window.innerWidth - tw - EDGE_MARGIN));
    const below = r.top < th + GAP + 4;
    const y = below ? r.bottom + GAP : r.top - th - GAP;
    tip.style.left = `${Math.round(Math.max(0, x))}px`;
    tip.style.top = `${Math.round(y)}px`;
  }

  function show(target: HTMLElement, text: string): void {
    ensureTooltipStyles();
    const tip = ensureTooltipEl();
    tip.textContent = text;
    tip.classList.add("ysw-tooltip--show");
    place(target);
    st.target = target;
    // 仅观察目标父节点的子列表变化（目标被移除时触发），避免全量观察 document.body
    const parent = target.parentElement;
    if (parent) {
      ensureObserver()?.observe(parent, { childList: true, subtree: false });
    }
  }

  function hide(): void {
    cancelTimer();
    if (st.el) st.el.classList.remove("ysw-tooltip--show");
    st.target = null;
    observer?.disconnect();
  }

  function attachTooltip(
    el: HTMLElement,
    getText: string | (() => string),
    opts: TooltipOptions = {},
  ): () => void {
    const delayMs = opts.delayMs ?? 350;
    const onEnter = (): void => {
      cancelTimer();
      st.timer = setTimeout(() => {
        st.timer = null;
        if (!el.isConnected) return;
        const text = typeof getText === "function" ? getText() : getText;
        if (!text) return;
        show(el, text);
      }, delayMs);
    };
    const onLeave = (): void => {
      cancelTimer();
      if (st.target === el || st.timer !== null) hide();
    };
    el.addEventListener("mouseenter", onEnter);
    el.addEventListener("mouseleave", onLeave);
    el.addEventListener("blur", onLeave);
    ensureScrollHandler();
    return () => {
      cancelTimer();
      if (st.target === el) hide();
      el.removeEventListener("mouseenter", onEnter);
      el.removeEventListener("mouseleave", onLeave);
      el.removeEventListener("blur", onLeave);
      decrementScrollRef();
    };
  }

  function promoteTitle(el: HTMLElement): () => void {
    const title = el.getAttribute("title");
    if (!title) return () => {};
    el.removeAttribute("title");
    if (!el.getAttribute("aria-label")) el.setAttribute("aria-label", title);
    return attachTooltip(el, title);
  }

  function promoteTitleIfPresent(el: HTMLElement | null): () => void {
    if (!el) return () => {};
    return promoteTitle(el);
  }

  function dispose(): void {
    cancelTimer();
    hide();
    observer?.disconnect();
    observer = null;
    // 清理 scroll handler（ref 归零）
    while (scrollRef > 0) {
      decrementScrollRef();
    }
    // 移除 tooltip DOM 节点（隔离实例互不干扰）
    if (st.el?.isConnected) {
      st.el.remove();
    }
    st.el = null;
  }

  return { attachTooltip, promoteTitle, promoteTitleIfPresent, dispose };
}

// ── 默认实例（生产环境唯一）──────────────────────────

/** 默认 Tooltip 管理器实例——生产环境应只使用此实例 */
const defaultManager = createTooltipManager();

/**
 * 给元素挂悬浮提示，返回 cleanup 函数（摘除全部监听并隐藏）。
 * @param getText 文案或惰性 getter（显示时刻求值，适配 i18n 运行时切换）
 */
export function attachTooltip(
  el: HTMLElement,
  getText: string | (() => string),
  opts: TooltipOptions = {},
): () => void {
  return defaultManager.attachTooltip(el, getText, opts);
}

/**
 * 把元素上的原生 title 升级为自定义 tooltip（模板里已写 title 的按钮一行接入）。
 * 摘除原生 title 防双气泡；aria-label 缺失时用 title 文本补齐可达性。
 * @returns cleanup 函数（摘除监听 + 递减 scroll ref-count）；调用方应在元素离文档时调用
 */
export function promoteTitle(el: HTMLElement): () => void {
  return defaultManager.promoteTitle(el);
}

/**
 * promoteTitle + 空值守卫（querySelector 结果可能为 null 的绑定点一行接入）。
 * @returns cleanup 函数；可推入 ctx.unsubs 等生命周期收集器
 */
export function promoteTitleIfPresent(el: HTMLElement | null): () => void {
  return defaultManager.promoteTitleIfPresent(el);
}

/** 清理默认实例的全部资源（向后兼容，供测试/HMR cleanup 调用）。
 * 推荐直接调 defaultManager.dispose()。 */
export function disposeTooltipCore(): void {
  defaultManager.dispose();
}

// HMR 安全：模块重执行时清理默认实例
if (typeof import.meta.hot !== "undefined") {
  import.meta.hot.dispose(() => {
    defaultManager.dispose();
  });
}
