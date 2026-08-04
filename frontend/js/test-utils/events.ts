// ===== 测试事件层（test-utils/events）=====
// 统一的事件模拟接口，覆盖常用交互。所有事件使用原生 Event / MouseEvent / KeyboardEvent，
// 兼容 jsdom 与浏览器，不依赖第三方库。

/** 构造一个基础 CustomEvent 并 dispatch */
export function fireEvent(
  el: Element,
  eventName: string,
  detail?: Record<string, unknown>,
): CustomEvent {
  const ev = new CustomEvent(eventName, { detail, bubbles: true, cancelable: true });
  el.dispatchEvent(ev);
  return ev;
}

/** 模拟鼠标点击 */
export function fireClick(el: Element): MouseEvent {
  const ev = new MouseEvent("click", { bubbles: true, cancelable: true });
  el.dispatchEvent(ev);
  return ev;
}

/** 模拟焦点 */
export function fireFocus(el: Element): FocusEvent {
  const ev = new FocusEvent("focus", { bubbles: false, cancelable: true });
  el.dispatchEvent(ev);
  return ev;
}

/** 模拟失焦 */
export function fireBlur(el: Element): FocusEvent {
  const ev = new FocusEvent("blur", { bubbles: false, cancelable: true });
  el.dispatchEvent(ev);
  return ev;
}

/** 模拟键盘按下 */
export function fireKeyDown(el: Element, key: string): KeyboardEvent {
  const ev = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  el.dispatchEvent(ev);
  return ev;
}

/** 模拟输入变化（更新 input.value 并触发 input + change 事件） */
export function fireInput(el: Element, value: string): Event {
  (el as HTMLInputElement | HTMLTextAreaElement).value = value;
  const inputEv = new Event("input", { bubbles: true, cancelable: true });
  const changeEv = new Event("change", { bubbles: true, cancelable: true });
  el.dispatchEvent(inputEv);
  el.dispatchEvent(changeEv);
  return inputEv;
}

/** 模拟拖拽：构造 DragEvent（使用 test-setup.ts 的 polyfill） */
export function fireDrop(el: Element, dataTransfer?: Record<string, unknown>): DragEvent {
  const dt = (dataTransfer ?? {}) as unknown as DataTransfer;
  const ev = new (globalThis.DragEvent as new (type: string, init?: DragEventInit) => DragEvent)(
    "drop",
    { bubbles: true, cancelable: true, dataTransfer: dt },
  );
  el.dispatchEvent(ev);
  return ev;
}
