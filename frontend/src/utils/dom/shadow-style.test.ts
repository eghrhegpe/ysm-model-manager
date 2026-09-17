// ===== shadow-style 测试（纯 DOM：happy-dom 真实 CSSStyleSheet + ShadowRoot）=====
// 覆盖：createShadowStyle 建表并打标记、无 CSSStyleSheet 环境降级不崩、
//       acceptHmr 注册与回调替换、selector 隔离（不误伤其它根的 sheet）。
import { describe, it, expect, vi } from "vitest";
import { createShadowStyle } from "./shadow-style.ts";
import { refreshAdoptedStyleSheets } from "./css-hmr.ts";

describe("createShadowStyle", () => {
  it("建出真实 CSSStyleSheet 且解析了传入 CSS", () => {
    const s = createShadowStyle(".a { color: red; }", "app-test");
    expect(s.sheet).toBeInstanceOf(CSSStyleSheet);
    expect(s.sheet.cssRules.length).toBe(1);
    expect(s.cssText).toBe(".a { color: red; }");
    expect(s.selector).toBe("app-test");
  });

  it("无 CSSStyleSheet 环境（node/happy-dom 边界）降级为占位对象，replaceSync 不抛", () => {
    const real = globalThis.CSSStyleSheet;
    // @ts-expect-error 故意移除全局以模拟无 CSSStyleSheet 环境
    delete globalThis.CSSStyleSheet;
    try {
      const s = createShadowStyle(".a { color: red; }", "app-test");
      expect(() => s.sheet.replaceSync(".b { color: blue; }")).not.toThrow();
    } finally {
      globalThis.CSSStyleSheet = real;
    }
  });

  it("打上归属标记：HMR 刷新能替换它（不洗掉同根其它 sheet）", () => {
    const host = document.createElement("div");
    host.className = "ss-hit";
    const root = host.attachShadow({ mode: "open" });
    document.body.append(host);

    const other = new CSSStyleSheet();
    other.replaceSync(".other { display: block; }");

    const style = createShadowStyle(".mine { color: red; }", ".ss-hit");
    root.adoptedStyleSheets = [other, style.sheet];

    // 同 selector 触发 HMR 刷新 → 只替换打标记的那张，other 保留
    refreshAdoptedStyleSheets(".mine { color: blue; }", ".ss-hit");

    expect(root.adoptedStyleSheets).toHaveLength(2);
    expect(root.adoptedStyleSheets[0]).toBe(other);
    expect(root.adoptedStyleSheets[1]).not.toBe(style.sheet);
    expect(root.adoptedStyleSheets[1].cssRules[0].cssText).toContain("blue");

    host.remove();
  });
});

describe("acceptHmr", () => {
  it("注册到指定 path；回调用新 CSS 文本刷新对应选择器的 shadow 根", () => {
    const host = document.createElement("div");
    host.className = "ss-hmr";
    const root = host.attachShadow({ mode: "open" });
    document.body.append(host);

    const style = createShadowStyle(".x { color: red; }", ".ss-hmr");
    root.adoptedStyleSheets = [style.sheet];

    let cb: ((m: Record<string, unknown> | undefined) => void) | undefined;
    const hot = {
      accept: vi.fn((_path: string, fn: (m: Record<string, unknown> | undefined) => void) => {
        cb = fn;
      }),
    };
    style.acceptHmr(hot as unknown as ImportMeta["hot"], "./some-css.ts", "someCSS");

    expect(hot.accept).toHaveBeenCalledWith("./some-css.ts", expect.any(Function));
    cb?.({ someCSS: ".x { color: green; }" });
    expect(root.adoptedStyleSheets[0].cssRules[0].cssText).toContain("green");

    host.remove();
  });

  it("回调载荷缺失或非字符串时静默跳过（Vite HMR 可能传 undefined）", () => {
    const style = createShadowStyle(".x { color: red; }", ".ss-miss");
    let cb: ((m: Record<string, unknown> | undefined) => void) | undefined;
    const hot = {
      accept: vi.fn((_p: string, fn: (m: Record<string, unknown> | undefined) => void) => {
        cb = fn;
      }),
    };
    style.acceptHmr(hot as unknown as ImportMeta["hot"], "./x.ts", "xCss");
    expect(() => cb?.(undefined)).not.toThrow();
    expect(() => cb?.({ other: 123 })).not.toThrow();
  });

  it("hot 为 undefined（生产构建）时不抛", () => {
    const style = createShadowStyle(".x { color: red; }", ".ss-nohot");
    expect(() => style.acceptHmr(undefined, "./x.ts", "xCss")).not.toThrow();
  });
});
