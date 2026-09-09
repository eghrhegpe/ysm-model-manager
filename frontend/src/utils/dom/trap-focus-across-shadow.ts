// ===== 跨 Shadow DOM 的焦点陷阱（无障碍 Tab 循环）=====
// 与 dialog-modal.ts trapFocus 同语义，但跨 Shadow DOM 边界找可聚焦元素。
// 适用于 3D overlay（内含 createSlideMenu 阴影根）等场景。
//
// 监听 document 级（不是 overlay 级）——焦点在 body / 其它子树上按 Tab 时
// 也能拦截（防逃出 3D 全屏到背后树面板等）。单例模式：多次调用时清理旧的。
// 消费方：preview-3d mount-preview-core 等。

/** 可聚焦元素选择器（与 dialog-modal.ts trapFocus 同源，排除 disabled 与 tabindex=-1） */
const TABBABLE_SEL =
  "button:not([disabled]),input:not([disabled]),select:not([disabled])," +
  'textarea:not([disabled]),[tabindex]:not([tabindex="-1"]),a[href],summary';

/** 元素祖先链上是否存在 aria-hidden="true"（命中则视为不可达）
 *  跨 Shadow 边界跳到 host 时必须跟随「当前节点」的 root（node.getRootNode()）——
 *  旧实现固定 el.getRootNode()：shadow 内 el 走到 host 的 parentElement=null 后又跳回
 *  同一 host，无限循环冻结主线程（已探针实证 200ms 320 万步）。node 跟随版：shadow 内
 *  顶元素 parentElement=null → 取该节点 root 的 host 跳出；到 document 层 root 非
 *  ShadowRoot → 循环正常终止。多层嵌套 shadow 同理逐层跳出。 */
function hasAriaHiddenAncestor(el: Element): boolean {
  let node: Element | null = el;
  while (node) {
    if (node.getAttribute && node.getAttribute("aria-hidden") === "true") return true;
    const next: Element | null = node.parentElement;
    if (!next && node.getRootNode() instanceof ShadowRoot) {
      node = (node.getRootNode() as ShadowRoot).host as Element;
    } else {
      node = next;
    }
  }
  return false;
}

/** 在 root 子树（含 Shadow DOM）内收集 tabbable 元素；保持 DOM 顺序（含跨 shadow 顺序） */
export function findTabbableAcrossShadow(root: Element | ShadowRoot | Document): HTMLElement[] {
  const out: HTMLElement[] = [];
  const visited = new WeakSet<Node>();
  const visit = (node: Element | ShadowRoot | Document): void => {
    if (visited.has(node)) return;
    visited.add(node);
    // 当前节点是 Element 且自身是 shadow host → 优先递归其 shadow root
    // （querySelectorAll 不会穿透 Shadow 边界，需要手动下钻）
    if (node instanceof Element && node.shadowRoot) {
      visit(node.shadowRoot);
    }
    node.querySelectorAll<HTMLElement>(TABBABLE_SEL).forEach((el) => {
      if (hasAriaHiddenAncestor(el)) return;
      out.push(el);
    });
    // 用 children 遍历后代元素（避开 querySelectorAll("*") 在 happy-dom 下对
    // shadow host 的反复递归陷阱——见 docstring）
    const children =
      node instanceof Element
        ? Array.from(node.children)
        : Array.from(node.querySelectorAll<HTMLElement>("*"));
    children.forEach((el) => {
      if (el.shadowRoot) visit(el.shadowRoot);
    });
  };
  visit(root);
  return out;
}

/**
 * 跨 Shadow DOM 的焦点陷阱：Tab 键在 overlay 子树内可聚焦元素间循环。
 * @returns cleanup 函数（移除 document keydown 监听器 + 清空单例）
 */
let _activeCleanup: (() => void) | null = null;

export function trapFocusAcrossShadow(overlay: HTMLElement): () => void {
  if (_activeCleanup) {
    _activeCleanup();
    _activeCleanup = null;
  }
  // 缓存 tabbable 列表 + Set（includes → Set.has 优化，防每次 Tab 全树 O(n) 扫描）
  let cachedTabbable: HTMLElement[] = [];
  let cachedTabbableSet = new Set<HTMLElement>();
  const refreshTabbable = (): void => {
    cachedTabbable = findTabbableAcrossShadow(overlay);
    cachedTabbableSet = new Set(cachedTabbable);
  };
  refreshTabbable();
  // MutationObserver 监听 overlay 子树变化时刷新缓存。
  // attributes 必须监听：disabled/hidden/tabindex/class/style 变化不触发 childList，
  // 只盯 childList 会让「trap 打开后按钮被 disable」的缓存永久过期（Tab 落到
  // 不可聚焦元素上）——code_review b6a85ec9e P2。
  // 注：shadow root 内部变化 host 侧 observer 看不见，由 handler 的缓存未命中
  // 回退重扫兜底（深焦解析后 active 不在缓存但仍在 overlay 内 → 重扫一次）。
  const observer = new MutationObserver(() => {
    refreshTabbable();
  });
  observer.observe(overlay, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["disabled", "hidden", "tabindex", "class", "style"],
  });
  const handler = (e: KeyboardEvent): void => {
    if (e.key !== "Tab") return;
    const tabbable = cachedTabbable;
    if (tabbable.length === 0) return;
    // biome-ignore lint/style/noNonNullAssertion: 确定性断言(构建期不变量/窄化逃生)
    const first = tabbable[0]!;
    // biome-ignore lint/style/noNonNullAssertion: 确定性断言(构建期不变量/窄化逃生)
    const last = tabbable[tabbable.length - 1]!;
    // 深焦解析：document.activeElement 对 shadow 内聚焦元素做 retargeting，
    // 返回的是 host 而非内层元素——沿 shadowRoot.activeElement 下钻到真实聚焦元素，
    // 否则 Set.has(active) 对 shadow 恒为 false，Tab 退化成 first/last 乒乓。
    let active: Element | null = document.activeElement as Element | null;
    while (active?.shadowRoot?.activeElement) {
      active = active.shadowRoot.activeElement;
    }
    // 焦点落在 tabbable 元素上（含 shadow 内，深焦解析后）才允许浏览器自然 Tab 循环；
    // 否则（overlay 背景 / overlay 外）一律收拢回 first/last——防焦点逃出 overlay。
    // 缓存未命中但焦点仍在 overlay 子树内 → 可能是 shadow 内部新增了可聚焦元素
    // （host 侧 observer 看不见 shadow 内变化），回退重扫一次再判定。
    let onTabbable = cachedTabbableSet.has(active as HTMLElement);
    if (!onTabbable && active instanceof HTMLElement && overlay.contains(active)) {
      refreshTabbable();
      onTabbable = cachedTabbableSet.has(active);
    }
    if (e.shiftKey) {
      if (active === first || !onTabbable) {
        e.preventDefault();
        last.focus();
      }
    } else if (active === last || !onTabbable) {
      e.preventDefault();
      first.focus();
    }
  };
  document.addEventListener("keydown", handler);
  const cleanup = (): void => {
    document.removeEventListener("keydown", handler);
    observer.disconnect();
  };
  _activeCleanup = cleanup;
  // 身份守卫：只清自己那一份（旧实现无条件执行 _activeCleanup，A 建立→B 建立→
  // A close 会误删 B 的监听——单例靠「最后写入闭包」而非身份标识的语义瑕疵）
  return (): void => {
    if (_activeCleanup === cleanup) {
      _activeCleanup();
      _activeCleanup = null;
    }
  };
}
