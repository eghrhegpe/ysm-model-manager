// @vitest-environment happy-dom
// ===== focus-restore.ts 焦点记忆 / 恢复 / 跨 Shadow 焦点陷阱 测试 =====
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  rememberTrigger,
  returnFocus,
  clearTrigger,
  __getTriggerForTest,
  findTabbableAcrossShadow,
  trapFocusAcrossShadow,
} from "../focus-restore.ts";

beforeEach(() => {
  document.body.innerHTML = "";
  clearTrigger();
  // 清理可能残留的 trapFocus 监听（单例）
  const dummyOverlay = document.createElement("div");
  document.body.appendChild(dummyOverlay);
  const cleanup = trapFocusAcrossShadow(dummyOverlay);
  cleanup();
  dummyOverlay.remove();
});

describe("rememberTrigger / returnFocus 配对", () => {
  it("默认无触发器 → returnFocus 静默返回 false", () => {
    expect(returnFocus()).toBe(false);
  });

  it("记住当前 activeElement → returnFocus 恢复焦点 + 返回 true", () => {
    const btn = document.createElement("button");
    btn.id = "trigger";
    document.body.appendChild(btn);
    btn.focus();
    expect(document.activeElement).toBe(btn);

    rememberTrigger();
    document.body.focus();
    expect(document.activeElement).not.toBe(btn);

    expect(returnFocus()).toBe(true);
    expect(document.activeElement).toBe(btn);
  });

  it("多次 rememberTrigger 取最后一次", () => {
    const a = document.createElement("button");
    a.id = "a";
    const b = document.createElement("button");
    b.id = "b";
    document.body.append(a, b);

    a.focus();
    rememberTrigger();
    b.focus();
    rememberTrigger();

    returnFocus();
    expect(document.activeElement).toBe(b);
  });

  it("returnFocus 后记忆清空 → 第二次静默", () => {
    const btn = document.createElement("button");
    document.body.appendChild(btn);
    btn.focus();
    rememberTrigger();
    expect(returnFocus()).toBe(true);
    expect(__getTriggerForTest()).toBeNull();
    expect(returnFocus()).toBe(false);
  });

  it("触发器已离文档 → returnFocus 跳过（不抛错）", () => {
    const btn = document.createElement("button");
    document.body.appendChild(btn);
    btn.focus();
    rememberTrigger();
    btn.remove();
    expect(returnFocus()).toBe(false);
  });

  it("clearTrigger 显式清除", () => {
    const btn = document.createElement("button");
    document.body.appendChild(btn);
    btn.focus();
    rememberTrigger();
    clearTrigger();
    expect(__getTriggerForTest()).toBeNull();
  });
});

describe("findTabbableAcrossShadow", () => {
  it("基础 light DOM：收集 button / input / [tabindex] / a[href]", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <button id="b1">B1</button>
      <input id="i1" />
      <div tabindex="0" id="d1">D1</div>
      <div tabindex="-1" id="d2">D2</div>
      <button id="b2" disabled>B2</button>
      <a id="a1" href="#x">A1</a>
    `;
    document.body.appendChild(root);
    const tabbable = findTabbableAcrossShadow(root);
    const ids = tabbable.map((el) => el.id);
    expect(ids).toEqual(["b1", "i1", "d1", "a1"]);
  });

  it("aria-hidden 祖先下的可聚焦元素被跳过", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <button id="visible">可见</button>
      <div aria-hidden="true">
        <button id="hidden-aria">被跳过</button>
      </div>
    `;
    document.body.appendChild(root);
    const tabbable = findTabbableAcrossShadow(root);
    const ids = tabbable.map((el) => el.id);
    expect(ids).toEqual(["visible"]);
  });
});

describe("trapFocusAcrossShadow Tab 循环", () => {
  function dispatchTab(target: Element | Document, shift = false): KeyboardEvent {
    const ev = new KeyboardEvent("keydown", {
      key: "Tab",
      code: "Tab",
      bubbles: true,
      cancelable: true,
      shiftKey: shift,
    });
    target.dispatchEvent(ev);
    return ev;
  }

  it("Tab 在 last 焦点上 → 跳回 first", () => {
    const overlay = document.createElement("div");
    overlay.id = "overlay";
    overlay.innerHTML = `<button id="first">F</button><button id="last">L</button>`;
    document.body.appendChild(overlay);
    const cleanup = trapFocusAcrossShadow(overlay);
    try {
      const last = overlay.querySelector<HTMLElement>("#last")!;
      last.focus();
      const ev = dispatchTab(document, false);
      expect(ev.defaultPrevented).toBe(true);
    } finally {
      cleanup();
    }
  });

  it("Shift+Tab 在 first 焦点上 → 跳到 last", () => {
    const overlay = document.createElement("div");
    overlay.innerHTML = `<button id="first">F</button><button id="last">L</button>`;
    document.body.appendChild(overlay);
    const cleanup = trapFocusAcrossShadow(overlay);
    try {
      const first = overlay.querySelector<HTMLElement>("#first")!;
      first.focus();
      const ev = dispatchTab(document, true);
      expect(ev.defaultPrevented).toBe(true);
    } finally {
      cleanup();
    }
  });

  it("焦点在 overlay 之外 → Tab 拉回 first", () => {
    const overlay = document.createElement("div");
    overlay.innerHTML = `<button id="first">F</button><button id="last">L</button>`;
    document.body.appendChild(overlay);
    const outside = document.createElement("button");
    outside.id = "outside";
    document.body.appendChild(outside);
    outside.focus();

    const cleanup = trapFocusAcrossShadow(overlay);
    try {
      const ev = dispatchTab(document, false);
      expect(ev.defaultPrevented).toBe(true);
    } finally {
      cleanup();
    }
  });

  it("非 Tab 键不拦截", () => {
    const overlay = document.createElement("div");
    overlay.innerHTML = `<button id="first">F</button>`;
    document.body.appendChild(overlay);
    const cleanup = trapFocusAcrossShadow(overlay);
    try {
      const ev = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
      document.dispatchEvent(ev);
      expect(ev.defaultPrevented).toBe(false);
    } finally {
      cleanup();
    }
  });
});