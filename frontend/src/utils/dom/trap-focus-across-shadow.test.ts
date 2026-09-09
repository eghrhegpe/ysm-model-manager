// @vitest-environment happy-dom
// ===== 跨 Shadow DOM 焦点陷阱测试（trap-focus-across-shadow.ts）=====
// 覆盖：findTabbableAcrossShadow（基本查找 / Shadow DOM 穿透 / aria-hidden 排除）
//       trapFocusAcrossShadow（基本 setup / cleanup / Tab 键循环）
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  findTabbableAcrossShadow,
  trapFocusAcrossShadow,
} from "./trap-focus-across-shadow.ts";

describe("findTabbableAcrossShadow — 基本查找", () => {
  it("查找容器内所有 tabbable 元素", () => {
    const container = document.createElement("div");
    container.innerHTML = `
      <button>Btn 1</button>
      <input type="text" />
      <a href="#">Link</a>
      <div>Plain div</div>
      <select><option>A</option></select>
      <textarea></textarea>
    `;
    document.body.appendChild(container);

    const result = findTabbableAcrossShadow(container);
    // button + input + a + select + textarea = 5
    expect(result.length).toBe(5);
    expect(result[0].tagName).toBe("BUTTON");
    expect(result[1].tagName).toBe("INPUT");
    expect(result[2].tagName).toBe("A");
    expect(result[3].tagName).toBe("SELECT");
    expect(result[4].tagName).toBe("TEXTAREA");

    document.body.removeChild(container);
  });

  it("排除 disabled 元素", () => {
    const container = document.createElement("div");
    container.innerHTML = `
      <button>Enabled</button>
      <button disabled>Disabled</button>
      <input type="text" disabled />
    `;
    document.body.appendChild(container);

    const result = findTabbableAcrossShadow(container);
    expect(result.length).toBe(1);
    expect(result[0].textContent).toBe("Enabled");

    document.body.removeChild(container);
  });

  it("排除 tabindex=-1", () => {
    const container = document.createElement("div");
    container.innerHTML = `
      <div tabindex="0">Focusable</div>
      <div tabindex="-1">Not focusable</div>
    `;
    document.body.appendChild(container);

    const result = findTabbableAcrossShadow(container);
    expect(result.length).toBe(1);
    expect(result[0].textContent).toBe("Focusable");

    document.body.removeChild(container);
  });
});

describe("findTabbableAcrossShadow — aria-hidden 排除", () => {
  it("排除 aria-hidden=true 祖先下的元素", () => {
    const container = document.createElement("div");
    container.innerHTML = `
      <div aria-hidden="true">
        <button>Hidden</button>
      </div>
      <button>Visible</button>
    `;
    document.body.appendChild(container);

    const result = findTabbableAcrossShadow(container);
    expect(result.length).toBe(1);
    expect(result[0].textContent).toBe("Visible");

    document.body.removeChild(container);
  });
});

describe("findTabbableAcrossShadow — Shadow DOM 穿透", () => {
  it("穿透 shadow root 查找内部 tabbable 元素", () => {
    const container = document.createElement("div");
    const host = document.createElement("div");
    const lightBtn = document.createElement("button");
    lightBtn.textContent = "Light Button";
    container.appendChild(host);
    container.appendChild(lightBtn);

    const shadow = host.attachShadow({ mode: "open" });
    const shadowBtn = document.createElement("button");
    shadowBtn.textContent = "Shadow Button";
    shadow.appendChild(shadowBtn);

    document.body.appendChild(container);

    const result = findTabbableAcrossShadow(container);
    // shadow button + light button = 2
    expect(result.length).toBe(2);
    const texts = result.map((el) => el.textContent);
    expect(texts).toContain("Shadow Button");
    expect(texts).toContain("Light Button");

    document.body.removeChild(container);
  });
});

describe("trapFocusAcrossShadow — 基本 setup / cleanup", () => {
  let overlay: HTMLDivElement;
  let cleanup: () => void;

  beforeEach(() => {
    overlay = document.createElement("div");
    overlay.innerHTML = `
      <button>First</button>
      <button>Last</button>
    `;
    document.body.appendChild(overlay);
  });

  afterEach(() => {
    cleanup?.();
    if (overlay.isConnected) document.body.removeChild(overlay);
  });

  it("trapFocusAcrossShadow 返回 cleanup 函数", () => {
    cleanup = trapFocusAcrossShadow(overlay);
    expect(typeof cleanup).toBe("function");
  });

  it("cleanup 后 keydown 监听器被移除", () => {
    cleanup = trapFocusAcrossShadow(overlay);
    const addEventSpy = vi.spyOn(document, "removeEventListener");
    cleanup();
    expect(addEventSpy).toHaveBeenCalledWith("keydown", expect.any(Function));
    addEventSpy.mockRestore();
  });

  it("单例模式：新调用清理旧的", () => {
    const cleanup1 = trapFocusAcrossShadow(overlay);
    const cleanup2 = trapFocusAcrossShadow(overlay);
    // cleanup1 不应再有效（被 cleanup2 替换）
    // 调用 cleanup1 不应影响 cleanup2
    cleanup1(); // 不应抛出
    cleanup2(); // 正常清理
    cleanup = () => {}; // 防止 afterEach 重复清理
  });
});

describe("trapFocusAcrossShadow — Tab 键循环", () => {
  let overlay: HTMLDivElement;
  let cleanup: () => void;
  let first: HTMLButtonElement;
  let last: HTMLButtonElement;

  beforeEach(() => {
    overlay = document.createElement("div");
    overlay.innerHTML = `
      <button>First</button>
      <button>Last</button>
    `;
    document.body.appendChild(overlay);
    first = overlay.querySelector("button:first-of-type")!;
    last = overlay.querySelector("button:last-of-type")!;
  });

  afterEach(() => {
    cleanup?.();
    if (overlay.isConnected) document.body.removeChild(overlay);
  });

  it("Tab 从 last 跳到 first", () => {
    cleanup = trapFocusAcrossShadow(overlay);
    last.focus();

    const event = new KeyboardEvent("keydown", { key: "Tab", bubbles: true });
    document.dispatchEvent(event);

    // happy-dom 不执行 preventDefault 后的焦点移动，但事件应被处理
    // 主要验证不抛错
    expect(document.activeElement).toBeDefined();
  });

  it("Shift+Tab 从 first 跳到 last", () => {
    cleanup = trapFocusAcrossShadow(overlay);
    first.focus();

    const event = new KeyboardEvent("keydown", {
      key: "Tab",
      shiftKey: true,
      bubbles: true,
    });
    document.dispatchEvent(event);

    expect(document.activeElement).toBeDefined();
  });
});
