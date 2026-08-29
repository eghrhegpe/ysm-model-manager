// ===== 焦点记忆 / 恢复 + 跨 Shadow DOM 焦点陷阱（无障碍统一入口）=====
// 用途：
// - rememberTrigger / returnFocus 配对：打开模态/浮层/全屏前记下当前 activeElement，
//   关闭时把焦点还给触发器（弹窗/3D overlay/上下文菜单统一受益）。
// - trapFocusAcrossShadow：与 dialog-modal.ts trapFocus 同语义，但跨 Shadow DOM
//   边界找可聚焦元素。注：3D overlay 当前整链是 light DOM（createSlideMenu 无
//   attachShadow），跨 shadow 逻辑属防御性兜底——overlay 内将来若挂入带可聚焦
//   子树的 shadow 组件，Tab 循环依然覆盖得到。
//
// 单一事实源：所有模态/浮层走 rememberTrigger + returnFocus + trapFocus
// （或 trapFocusAcrossShadow），避免各组件重复实现焦点恢复 / Tab 循环。

/** 可聚焦元素选择器（与 dialog-modal.ts trapFocus 同源，排除 disabled 与 tabindex=-1） */
const TABBABLE_SEL =
  "button:not([disabled]),input:not([disabled]),select:not([disabled])," +
  "textarea:not([disabled]),[tabindex]:not([tabindex=\"-1\"]),a[href],summary";

// ────────────────────────────────────────────────────────────────────
// 焦点记忆 / 恢复
// ────────────────────────────────────────────────────────────────────

let _lastTrigger: HTMLElement | null = null;

/**
 * 记住当前聚焦元素作为后续 returnFocus 的目标。
 * 调用时机：模态/浮层/全屏预览打开前（同步执行，确保捕获到触发按钮）。
 * 多次调用会覆盖（适合单实例浮层；多实例场景由调用方用闭包变量管理）。
 * Node 测试环境无 HTMLElement 全局，duck-typing 容错。
 */
export function rememberTrigger(): void {
  const el = document.activeElement;
  // duck-typing 避免在 node 测试环境（无 HTMLElement 全局）下 ReferenceError
  if (el && typeof (el as HTMLElement).focus === "function") {
    _lastTrigger = el as HTMLElement;
  } else {
    _lastTrigger = null;
  }
}

/**
 * 把焦点还给 rememberTrigger 记住的元素；若元素已离文档 / 不可聚焦则跳过（不抛错）。
 * @returns true 表示成功恢复焦点
 */
export function returnFocus(): boolean {
  const el = _lastTrigger;
  _lastTrigger = null;
  if (!el) return false;
  if (!el.isConnected) return false;
  if (typeof el.focus !== "function") return false;
  try {
    el.focus();
    return true;
  } catch {
    return false;
  }
}

/** 显式清除记忆（用于测试或主动取消打开） */
export function clearTrigger(): void {
  _lastTrigger = null;
}

/** 测试钩子：读取当前记忆（业务代码不应调用） */
export function __getTriggerForTest(): HTMLElement | null {
  return _lastTrigger;
}

// ────────────────────────────────────────────────────────────────────
// 输入阻断栈（菜单/弹窗接管键盘时，相机等外层停止消费 WASD/方向键）
// ────────────────────────────────────────────────────────────────────

/** 栈：push 后 isInputBlocked()=true，pop 后恢复 */
const _inputBlockStack: string[] = [];

/** 挂起外层键盘消费（菜单弹出时调用，id 唯一标识阻断源） */
export function pushInputBlock(id: string): void {
  _inputBlockStack.push(id);
}

/** 解除挂起（菜单关闭时传同一 id） */
export function popInputBlock(id: string): void {
  const idx = _inputBlockStack.lastIndexOf(id);
  if (idx >= 0) _inputBlockStack.splice(idx, 1);
}

/** 外层键盘消费（相机 WASD 等）是否应暂停 */
export function isInputBlocked(): boolean {
  return _inputBlockStack.length > 0;
}

// ────────────────────────────────────────────────────────────────────
// 跨 Shadow DOM 的可聚焦查找
// ────────────────────────────────────────────────────────────────────

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
    const children = node instanceof Element
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
 * 与 dialog-modal.ts trapFocus 语义一致，但跨 Shadow 边界找可聚焦元素，
 * 适用于 3D overlay（内含 createSlideMenu 阴影根）等场景。
 *
 * 监听 document 级（不是 overlay 级）——焦点在 body / 其它子树上按 Tab 时
 * 也能拦截（防逃出 3D 全屏到背后树面板等）。单例模式：多次调用时清理旧的。
 * 弹窗叠加时仅一个 trap 生效，关闭 trap 后下一个 trap 接管。
 * @returns cleanup 函数（移除 document keydown 监听器 + 清空单例）
 */
let _activeCleanup: (() => void) | null = null;

export function trapFocusAcrossShadow(overlay: HTMLElement): () => void {
  if (_activeCleanup) {
    _activeCleanup();
    _activeCleanup = null;
  }
  const handler = (e: KeyboardEvent): void => {
    if (e.key !== "Tab") return;
    const tabbable = findTabbableAcrossShadow(overlay);
    if (tabbable.length === 0) return;
    const first = tabbable[0]!;
    const last = tabbable[tabbable.length - 1]!;
    // 深焦解析：document.activeElement 对 shadow 内聚焦元素做 retargeting，
    // 返回的是 host 而非内层元素——沿 shadowRoot.activeElement 下钻到真实聚焦元素，
    // 否则 tabbable.includes(active) 对 shadow 恒为 false，Tab 退化成 first/last 乒乓。
    let active: Element | null = document.activeElement as Element | null;
    while (active && active.shadowRoot && active.shadowRoot.activeElement) {
      active = active.shadowRoot.activeElement;
    }
    // 焦点落在 tabbable 元素上（含 shadow 内，深焦解析后）才允许浏览器自然 Tab 循环；
    // 否则（overlay 背景 / overlay 外）一律收拢回 first/last——防焦点逃出 overlay。
    const onTabbable = tabbable.includes(active as HTMLElement);
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