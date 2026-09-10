// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import {
  createHeaderToggle,
  type HeaderToggleConfig,
} from "./ui-header-toggle.ts";

function makeConfig(overrides: Partial<HeaderToggleConfig> = {}): HeaderToggleConfig {
  return {
    value: false,
    onChange: vi.fn(),
    ...overrides,
  };
}

// ===== 基本渲染 =====

describe("基本 DOM 结构", () => {
  it("返回 <label class='toggle header-toggle'> 容器", () => {
    const toggle = createHeaderToggle(makeConfig());
    expect(toggle.tagName.toLowerCase()).toBe("label");
    expect(toggle.className).toBe("toggle header-toggle");
  });

  it("包含 <input type='checkbox'> 和 <span class='slider'>", () => {
    const toggle = createHeaderToggle(makeConfig());
    const input = toggle.querySelector("input");
    const slider = toggle.querySelector("span");
    expect(input).not.toBeNull();
    expect(input!.type).toBe("checkbox");
    expect(slider).not.toBeNull();
    expect(slider!.className).toBe("slider");
  });

  it("子节点顺序为 [input, slider]", () => {
    const toggle = createHeaderToggle(makeConfig());
    expect(toggle.children.length).toBe(2);
    expect(toggle.children[0].tagName.toLowerCase()).toBe("input");
    expect(toggle.children[1].tagName.toLowerCase()).toBe("span");
  });
});

// ===== 初始值 =====

describe("初始值", () => {
  it("value=true 时 input.checked 为 true", () => {
    const toggle = createHeaderToggle(makeConfig({ value: true }));
    expect(toggle.querySelector("input")!.checked).toBe(true);
  });

  it("value=false 时 input.checked 为 false", () => {
    const toggle = createHeaderToggle(makeConfig({ value: false }));
    expect(toggle.querySelector("input")!.checked).toBe(false);
  });
});

// ===== onChange 回调 =====

describe("onChange 回调", () => {
  it("点击 label 触发 onChange，传递新状态", () => {
    const onChange = vi.fn();
    const toggle = createHeaderToggle(makeConfig({ value: false, onChange }));
    const input = toggle.querySelector("input") as HTMLInputElement;

    expect(onChange).not.toHaveBeenCalled();
    expect(input.checked).toBe(false);

    // 点击 label 本体（非 input）— 触发 handler
    toggle.click();
    expect(onChange).toHaveBeenCalledWith(true);
    expect(input.checked).toBe(true);
  });

  it("连续点击：状态翻转", () => {
    const onChange = vi.fn();
    const toggle = createHeaderToggle(makeConfig({ value: false, onChange }));

    toggle.click();
    expect(onChange).toHaveBeenLastCalledWith(true);
    toggle.click();
    expect(onChange).toHaveBeenLastCalledWith(false);
    toggle.click();
    expect(onChange).toHaveBeenLastCalledWith(true);
  });

  it("点击 input 本身（synthetic click）被去重：onChange 不触发，但浏览器原生切换仍生效", () => {
    const onChange = vi.fn();
    const toggle = createHeaderToggle(makeConfig({ value: false, onChange }));
    const input = toggle.querySelector("input") as HTMLInputElement;

    // 用 dispatchEvent 模拟浏览器 label→input 的二次派发：target 为 input
    input.dispatchEvent(new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
    }));
    // handler 内 e.target===input 分支直接 return，不调用 onChange，
    // 也不 preventDefault — 浏览器原生切换仍会把 checked 翻转（与真实浏览器一致）
    expect(onChange).not.toHaveBeenCalled();
    expect(input.checked).toBe(true);
  });
});

// ===== disabled 状态 =====

describe("disabled 状态", () => {
  it("disabled=true → toggle 有 toggle-disabled class", () => {
    const toggle = createHeaderToggle(makeConfig({ disabled: true }));
    expect(toggle.classList.contains("toggle-disabled")).toBe(true);
    expect(toggle.className).toBe("toggle header-toggle toggle-disabled");
  });

  it("disabled=true → input.disabled=true 且不响应点击", () => {
    const onChange = vi.fn();
    const toggle = createHeaderToggle(makeConfig({
      value: false,
      disabled: true,
      onChange,
    }));
    const input = toggle.querySelector("input") as HTMLInputElement;

    expect(input.disabled).toBe(true);

    toggle.click();
    expect(onChange).not.toHaveBeenCalled();
    expect(input.checked).toBe(false);
  });

  it("disabled=false（默认）→ 无 toggle-disabled class，input 可用", () => {
    const toggle = createHeaderToggle(makeConfig());
    expect(toggle.classList.contains("toggle-disabled")).toBe(false);
    expect(toggle.querySelector("input")!.disabled).toBe(false);
  });

  it("disabled + onDisabledClick → 点击触发 onDisabledClick", () => {
    const onDisabledClick = vi.fn();
    const toggle = createHeaderToggle(makeConfig({
      disabled: true,
      onDisabledClick,
    }));

    expect(onDisabledClick).not.toHaveBeenCalled();
    toggle.click();
    expect(onDisabledClick).toHaveBeenCalledTimes(1);
  });

  it("disabled 且无 onDisabledClick → 点击无副作用", () => {
    const onChange = vi.fn();
    const toggle = createHeaderToggle(makeConfig({
      disabled: true,
      onChange,
    }));

    // 不抛异常
    expect(() => toggle.click()).not.toThrow();
    expect(onChange).not.toHaveBeenCalled();
  });
});

// ===== 样式/类名 =====

describe("样式与类名", () => {
  it("基础类名固定为 'toggle header-toggle'", () => {
    const toggle = createHeaderToggle(makeConfig());
    expect(toggle.className).toBe("toggle header-toggle");
  });

  it("禁用态追加 'toggle-disabled'", () => {
    const toggle = createHeaderToggle(makeConfig({ disabled: true }));
    expect(toggle.className).toBe("toggle header-toggle toggle-disabled");
  });

  it("slider span 类名为 'slider'", () => {
    const toggle = createHeaderToggle(makeConfig());
    expect(toggle.querySelector("span")!.className).toBe("slider");
  });
});

// ===== forceToggle（程序化翻转；整行点击能力自 addToggleRow 下沉后由 cap 栈消费）=====

describe("forceToggle", () => {
  it("正常态：翻转 input.checked 并触发 onChange（新值）", () => {
    const onChange = vi.fn();
    const toggle = createHeaderToggle(makeConfig({ value: false, onChange }));
    const input = toggle.querySelector("input") as HTMLInputElement;

    toggle.forceToggle();
    expect(input.checked).toBe(true);
    expect(onChange).toHaveBeenCalledWith(true);

    toggle.forceToggle();
    expect(input.checked).toBe(false);
    expect(onChange).toHaveBeenLastCalledWith(false);
  });

  it("disabled 且无 onDisabledClick：no-op（checked 不变、onChange 不触发）", () => {
    const onChange = vi.fn();
    const toggle = createHeaderToggle(
      makeConfig({ value: true, disabled: true, onChange }),
    );
    const input = toggle.querySelector("input") as HTMLInputElement;

    toggle.forceToggle();
    expect(input.checked).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("disabled 且有 onDisabledClick：触发 onDisabledClick，不翻转", () => {
    const onDisabledClick = vi.fn();
    const onChange = vi.fn();
    const toggle = createHeaderToggle(
      makeConfig({ value: true, disabled: true, onChange, onDisabledClick }),
    );
    const input = toggle.querySelector("input") as HTMLInputElement;

    toggle.forceToggle();
    expect(onDisabledClick).toHaveBeenCalledTimes(1);
    expect(input.checked).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
  });
});
