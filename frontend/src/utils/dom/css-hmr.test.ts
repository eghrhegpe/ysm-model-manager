// ===== css-hmr 测试（纯 DOM：happy-dom 真实 CSSStyleSheet + ShadowRoot）=====
// 覆盖：refreshAdoptedStyleSheets——undefined 跳过、命中元素替换 adoptedStyleSheets、
// 无 shadowRoot / 未命中选择器的元素不受影响、重复刷新替换为新样式表实例。
import { describe, it, expect, vi } from "vitest";
import { refreshAdoptedStyleSheets } from "./css-hmr.ts";

describe("refreshAdoptedStyleSheets", () => {
  it("cssText undefined（Vite HMR 可能传 undefined）→ 直接返回，不查 DOM 不建样式表", () => {
    const qsa = vi.spyOn(document, "querySelectorAll");
    expect(() => refreshAdoptedStyleSheets(undefined, "app-sidebar")).not.toThrow();
    expect(qsa).not.toHaveBeenCalled();
    qsa.mockRestore();
  });

  it("命中选择器且带 shadowRoot 的元素被替换 adoptedStyleSheets；无 shadowRoot 的元素静默跳过", () => {
    const withShadow = document.createElement("div");
    withShadow.className = "hmr-hit";
    const root = withShadow.attachShadow({ mode: "open" });
    const withoutShadow = document.createElement("div");
    withoutShadow.className = "hmr-hit";
    document.body.append(withShadow, withoutShadow);

    expect(() => refreshAdoptedStyleSheets(".a { color: red; }", ".hmr-hit")).not.toThrow();

    expect(root.adoptedStyleSheets).toHaveLength(1);
    const sheet = root.adoptedStyleSheets[0];
    expect(sheet).toBeInstanceOf(CSSStyleSheet);
    // replaceSync 真正解析了传入的 CSS 文本
    expect(sheet!.cssRules.length).toBe(1);

    withShadow.remove();
    withoutShadow.remove();
  });

  it("一次刷新所有命中元素共享同一张样式表实例；未命中选择器的元素 shadowRoot 保持原样", () => {
    const hit1 = document.createElement("div");
    hit1.className = "hmr-multi";
    const root1 = hit1.attachShadow({ mode: "open" });
    const hit2 = document.createElement("div");
    hit2.className = "hmr-multi";
    const root2 = hit2.attachShadow({ mode: "open" });
    const miss = document.createElement("div");
    miss.className = "hmr-other";
    const rootMiss = miss.attachShadow({ mode: "open" });
    document.body.append(hit1, hit2, miss);

    refreshAdoptedStyleSheets(".b { color: blue; }", ".hmr-multi");

    expect(root1.adoptedStyleSheets).toHaveLength(1);
    expect(root2.adoptedStyleSheets).toHaveLength(1);
    expect(root2.adoptedStyleSheets[0]).toBe(root1.adoptedStyleSheets[0]);
    expect(rootMiss.adoptedStyleSheets).toHaveLength(0);

    hit1.remove();
    hit2.remove();
    miss.remove();
  });

  it("重复刷新：替换为新样式表实例（旧实例被顶掉），长度保持 1", () => {
    const el = document.createElement("div");
    el.className = "hmr-re";
    const root = el.attachShadow({ mode: "open" });
    document.body.append(el);

    refreshAdoptedStyleSheets(".v1 { color: red; }", ".hmr-re");
    const first = root.adoptedStyleSheets[0];
    refreshAdoptedStyleSheets(".v2 { color: blue; }", ".hmr-re");

    expect(root.adoptedStyleSheets).toHaveLength(1);
    expect(root.adoptedStyleSheets[0]).not.toBe(first);

    el.remove();
  });
});
