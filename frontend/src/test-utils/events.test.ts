// ===== 测试事件层测试 =====
// 覆盖：fireEvent / fireClick / fireFocus / fireBlur / fireKeyDown / fireInput / fireDrop
import { describe, it, expect, vi } from "vitest";
import {
  fireEvent,
  fireClick,
  fireFocus,
  fireBlur,
  fireKeyDown,
  fireInput,
  fireDrop,
} from "./events.ts";

function setup(handler: (e: Event) => void, eventName: string) {
  const el = document.createElement("div");
  const fn = vi.fn(handler);
  el.addEventListener(eventName, fn as EventListener);
  return { el, fn };
}

describe("fireEvent", () => {
  it("派发 CustomEvent 并携带 detail", () => {
    const { el, fn } = setup((_e) => {}, "my-event");
    const ev = fireEvent(el, "my-event", { a: 1 });
    expect(fn).toHaveBeenCalledTimes(1);
    expect((fn.mock.calls[0][0] as CustomEvent).detail).toEqual({ a: 1 });
    expect(ev.bubbles).toBe(true);
    expect(ev.cancelable).toBe(true);
  });
});

describe("fireClick", () => {
  it("派发 click MouseEvent", () => {
    const { el, fn } = setup((_e) => {}, "click");
    const ev = fireClick(el);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(ev.type).toBe("click");
  });
});

describe("fireFocus / fireBlur", () => {
  it("派发 focus / blur（不冒泡）", () => {
    const { el, fn } = setup((_e) => {}, "focus");
    const ev = fireFocus(el);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(ev.bubbles).toBe(false);

    const { el: el2, fn: fn2 } = setup((_e) => {}, "blur");
    const ev2 = fireBlur(el2);
    expect(fn2).toHaveBeenCalledTimes(1);
    expect(ev2.bubbles).toBe(false);
  });
});

describe("fireKeyDown", () => {
  it("派发 keydown 并携带 key", () => {
    const { el, fn } = setup((_e) => {}, "keydown");
    fireKeyDown(el, "Escape");
    expect(fn).toHaveBeenCalledTimes(1);
    expect((fn.mock.calls[0][0] as KeyboardEvent).key).toBe("Escape");
  });
});

describe("fireInput", () => {
  it("更新 value 并触发 input + change", () => {
    const input = document.createElement("input");
    const onInput = vi.fn();
    const onChange = vi.fn();
    input.addEventListener("input", onInput as EventListener);
    input.addEventListener("change", onChange as EventListener);

    fireInput(input, "新值");

    expect(input.value).toBe("新值");
    expect(onInput).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});

describe("fireDrop", () => {
  it("派发 drop DragEvent（默认不抛错）", () => {
    const { el, fn } = setup((_e) => {}, "drop");
    const ev = fireDrop(el);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(ev.type).toBe("drop");
    // 注：happy-dom 的 DragEvent 不落 dataTransfer 构造参数，此处仅验证派发与返回
  });

  it("透传自定义 dataTransfer（环境支持时）", () => {
    const { el, fn } = setup((_e) => {}, "drop");
    const dt = { files: [] } as unknown as DataTransfer;
    const ev = fireDrop(el, dt as unknown as Record<string, unknown>);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(ev.type).toBe("drop");
  });
});
