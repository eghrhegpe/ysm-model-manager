// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  createHeaderToggle,
  type HeaderToggleConfig,
} from "./ui-header-toggle.ts";
import { setControlRegistry } from "./control-registry.ts";

// 每次测试前清理全局 control-registry 挂载，防止跨用例污染。
beforeEach(() => setControlRegistry(null));

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

// ===== bind 自更新 =====

describe("bind 自更新", () => {
  it("bind 函数返回最新值，registerControl 被注册", () => {
    const bind = vi.fn(() => true);
    let capturedUpdater: (() => void) | null = null;
    setControlRegistry((fn) => { capturedUpdater = fn; });

    createHeaderToggle(makeConfig({ value: false, bind }));

    // bind 仅在 update() 内调用，createHeaderToggle 阶段不调用
    expect(bind).not.toHaveBeenCalled();
    expect(capturedUpdater).toBeDefined();
  });

  it("bind 返回值与初始值相同 → 不更新", () => {
    const bind = vi.fn(() => false);
    let capturedUpdater: (() => void) | null = null;
    setControlRegistry((fn) => { capturedUpdater = fn; });

    const toggle = createHeaderToggle(makeConfig({ value: false, bind }));
    const input = toggle.querySelector("input") as HTMLInputElement;

    capturedUpdater!();
    expect(bind).toHaveBeenCalledTimes(1);
    // 值未变化，input.checked 保持初始值
    expect(input.checked).toBe(false);
  });

  it("bind 返回值与初始值不同 → input.checked 同步", () => {
    let external = false;
    const bind = () => external;
    let capturedUpdater: (() => void) | null = null;
    setControlRegistry((fn) => { capturedUpdater = fn; });

    const toggle = createHeaderToggle(makeConfig({ value: false, bind }));
    const input = toggle.querySelector("input") as HTMLInputElement;

    expect(input.checked).toBe(false);

    // 外部状态变化
    external = true;
    capturedUpdater!();
    expect(input.checked).toBe(true);

    external = false;
    capturedUpdater!();
    expect(input.checked).toBe(false);
  });

  it("bind 返回非 boolean 被 !! 规范化", () => {
    let val: unknown = 0;
    const bind = () => val as boolean;
    let capturedUpdater: (() => void) | null = null;
    setControlRegistry((fn) => { capturedUpdater = fn; });

    const toggle = createHeaderToggle(makeConfig({ value: false, bind }));
    const input = toggle.querySelector("input") as HTMLInputElement;

    val = "yes";
    capturedUpdater!();
    expect(input.checked).toBe(true);

    val = null;
    capturedUpdater!();
    expect(input.checked).toBe(false);
  });

  it("未设置 bind → registerControl 不被调用", () => {
    let registryCalled = false;
    setControlRegistry(() => { registryCalled = true; });

    createHeaderToggle(makeConfig());
    expect(registryCalled).toBe(false);
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

// ===== 多实例注册（bind 唯一 id + 断连清扫）=====

import {
  clearControls,
  getControlCount,
  iterateControls,
} from "./control-registry.ts";

function countBindEntries(): number {
  return [...iterateControls()].filter(([id]) =>
    id.startsWith("header-toggle-bind"),
  ).length;
}

describe("多实例 bind 注册", () => {
  beforeEach(() => clearControls());

  it("两个带 bind 的 toggle 各自独立注册，互不覆盖", () => {
    let ext1 = false;
    let ext2 = false;
    const t1 = createHeaderToggle(
      makeConfig({ value: false, bind: () => ext1 }),
    );
    const t2 = createHeaderToggle(
      makeConfig({ value: false, bind: () => ext2 }),
    );
    const in1 = t1.querySelector("input") as HTMLInputElement;
    const in2 = t2.querySelector("input") as HTMLInputElement;

    // Map 中存在两条独立条目（旧实现同 id 覆盖 → 只有 1 条）
    expect(countBindEntries()).toBe(2);

    // 各自 updater 只同步自己的 input
    const entries = [...iterateControls()].filter(([id]) =>
      id.startsWith("header-toggle-bind"),
    );
    ext1 = true;
    entries[0][1]();
    expect(in1.checked).toBe(true);
    expect(in2.checked).toBe(false);

    ext2 = true;
    entries[1][1]();
    expect(in2.checked).toBe(true);
  });

  it("断连清扫：连续两轮注册扫描后才注销已断连实例（宽限一轮防误杀未挂载实例）", () => {
    const t1 = createHeaderToggle(
      makeConfig({ value: false, bind: () => true }),
    );
    document.body.appendChild(t1);
    expect(countBindEntries()).toBe(1);

    t1.remove();
    // 第 1 次后续注册：扫描标记 t1 待清（宽限），新实例照常注册
    createHeaderToggle(makeConfig({ value: false, bind: () => true }));
    expect(countBindEntries()).toBe(2);

    // 第 2 次后续注册：t1 连续两轮断连 → 注销；净数量不变（-1 +1）
    createHeaderToggle(makeConfig({ value: false, bind: () => true }));
    expect(countBindEntries()).toBe(2);
  });

  it("跨任务时序：挂载→移除→下一 tick 创建，清扫能识别曾挂载元素", async () => {
    // 1. 挂载并注册
    const t1 = createHeaderToggle(
      makeConfig({ value: false, bind: () => true }),
    );
    document.body.appendChild(t1);
    expect(countBindEntries()).toBe(1);

    // 2. 移除（断连）
    t1.remove();

    // 3. 等一个微任务——真实场景中 MO 记录在此间隙投递
    await Promise.resolve();

    // 4. 后续注册触发清扫：t1 已断连但曾挂载 → 宽限一轮
    createHeaderToggle(makeConfig({ value: false, bind: () => true }));
    expect(countBindEntries()).toBe(2);

    // 5. 再等一个 tick + 再注册：t1 连续两轮断连 → 注销
    await Promise.resolve();
    createHeaderToggle(makeConfig({ value: false, bind: () => true }));
    expect(countBindEntries()).toBe(2); // -1 t1 +1 新
  });

  it("已挂载实例在清扫中始终保留", () => {
    const keep = createHeaderToggle(
      makeConfig({ value: false, bind: () => true }),
    );
    document.body.appendChild(keep);

    for (let i = 0; i < 3; i++) {
      createHeaderToggle(makeConfig({ value: false, bind: () => true }));
    }
    expect(countBindEntries()).toBe(4);
    expect(getControlCount()).toBe(4);
  });
});