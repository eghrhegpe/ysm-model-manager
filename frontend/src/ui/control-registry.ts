// 🥉 ui-helpers 组件库 — 控件自更新注册表（替代 MikuMikuAR 的 render-context）。
//
// MikuMikuAR 原通过 getCurrentRenderingContext()?.registerControl(update) 把控件注册进
// 渲染上下文以实现「菜单重渲染时自动同步」。该上下文与 MikuMikuAR 强耦合，本库解耦为
// 可选注入：默认 registerControl 为 no-op（控件仍保留「bind 即时初始化」能力，由各自
// initControl 在挂载时立即调用一次 update），只有调用方通过 setControlRegistry 接入
// ysm 的响应式/重渲染系统时，持续自更新才会生效。

export type ControlUpdater = () => void;

// id → updater 的内部注册表（提供 get / unregister / iterate / clear 能力）。
const _controls = new Map<string, ControlUpdater>();

// 外部更新系统钩子（如 ysm 的响应式链路）：register 时同步转发，便于触发初次或后续重渲染。
let _registry: ((fn: ControlUpdater) => void) | null = null;

/**
 * 接入外部控件更新系统。传入 null 可取消接入（内部注册表不受影响）。
 */
export function setControlRegistry(fn: ((fn: ControlUpdater) => void) | null): void {
  _registry = fn;
}

/**
 * 注册一个控件更新回调（需唯一 id）。
 * - 已存在同 id 时静默替换（幂等覆盖，不抛错）。
 * - 若已接入外部系统，同时转发 fn 供其触发同步。
 */
export function registerControl(id: string, fn: ControlUpdater): void {
  _controls.set(id, fn);
  _registry?.(fn);
}

/** 按 id 获取已注册的更新回调，未注册返回 undefined。 */
export function getControl(id: string): ControlUpdater | undefined {
  return _controls.get(id);
}

/** 按 id 移除已注册的更新回调，成功返回 true，未命中返回 false（重复 unregister 不抛错）。 */
export function unregisterControl(id: string): boolean {
  return _controls.delete(id);
}

/** 遍历所有已注册控件，返回 entries 快照迭代器（迭代开始瞬间拍快照，外部增删不影响当前迭代）。 */
export function* iterateControls(): IterableIterator<[string, ControlUpdater]> {
  const snapshot = [..._controls.entries()];
  for (const entry of snapshot) {
    yield entry;
  }
}

/** 清空所有已注册的控件。不取消外部系统接入。 */
export function clearControls(): void {
  _controls.clear();
}

/** 当前已注册控件数量。 */
export function getControlCount(): number {
  return _controls.size;
}

// ===================================================================
// registerControlWithElement — DOM 断连自动清扫（防内存泄漏）
// ===================================================================

// 元素 → 控件 id 集合（一个元素可挂多个控件）。
const _elementControls = new Map<Element, Set<string>>();

// 共享 MutationObserver：监听 document.body 子树变化，断连时自动清扫。
let _gcObserver: MutationObserver | null = null;

function _ensureGcObserver(): void {
  if (_gcObserver) {
    return;
  }
  _gcObserver = new MutationObserver(() => {
    // 遍历所有跟踪的元素，检查是否仍连接 DOM。
    for (const [el, ids] of _elementControls) {
      if (!el.isConnected) {
        for (const id of ids) {
          _controls.delete(id);
        }
        _elementControls.delete(el);
      }
    }
  });
  // 监听 body 子树变化（childList + subtree 覆盖所有节点增删）。
  if (typeof document !== "undefined" && document.body) {
    _gcObserver.observe(document.body, { childList: true, subtree: true });
  }
}

/**
 * 注册控件并关联 DOM 元素。元素断连（从 DOM 移除）时自动 unregister。
 * 用于替代裸 registerControl，防止菜单重渲染后旧控件残留注册表。
 *
 * @param id   唯一控件 id
 * @param fn   更新回调
 * @param el   关联的 DOM 元素（行/滑块/开关等）
 */
export function registerControlWithElement(id: string, fn: ControlUpdater, el: Element): void {
  // 先注册到主表
  registerControl(id, fn);

  // 记录元素 → id 映射
  const existing = _elementControls.get(el);
  if (existing) {
    existing.add(id);
  } else {
    _elementControls.set(el, new Set([id]));
  }

  // 确保 observer 已启动
  _ensureGcObserver();
}
