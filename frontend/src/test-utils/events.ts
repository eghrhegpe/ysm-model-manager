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

/** 模拟拖拽 drop：构造 DragEvent 并注入 dataTransfer（happy-dom 忽略 DragEvent init 参数，需 defineProperty） */
export function fireDrop(el: EventTarget, dataTransfer?: Record<string, unknown>): DragEvent {
  const dt = (dataTransfer ?? {}) as unknown as DataTransfer;
  const ev = new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt });
  Object.defineProperty(ev, "dataTransfer", { value: dt, configurable: true });
  el.dispatchEvent(ev);
  return ev;
}
// fireDrag（任意拖拽事件类型）已于 2026-09-11 删除：check-orphan-exports 修复 export *
// 与包装函数两处漏检后，全仓零消费者的真孤儿浮现（同文件 fireDrop 14 处消费者对照）。
// 需要 dragstart/dragover 事件时直接 new DragEvent(type, {...}) 或复用 fireDrop 模式。
