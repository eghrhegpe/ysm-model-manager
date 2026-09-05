// @vitest-environment happy-dom
// ===== utils/dom/fab 测试（ADR-057 悬浮控制层）=====
// 覆盖：ensureFabStyles 幂等注入（无重复节点/既有元素短路/document 未定义静默）、
// createIconButton 工厂（className/title+aria-label/Unicode emoji 与 CSS 类名两种
// icon 形态/label/onClick 绑定）。
import { describe, it, expect, vi, afterEach } from "vitest";
import { createIconButton } from "./fab.ts";
import type * as FabModule from "./fab.ts";

afterEach(() => {
  document.getElementById("ysw-fab-styles")?.remove();
  vi.unstubAllGlobals();
});

/** 获取全新 fab 模块实例（重置 _fabInjected 模块级状态，测试相互隔离） */
async function freshFab(): Promise<typeof FabModule> {
  vi.resetModules();
  return await import("./fab.ts");
}

describe("ensureFabStyles — overlay 全局样式幂等注入", () => {
  it("注入 <style id=ysw-fab-styles> 到 head，内容含 overlay 规则", async () => {
    const fab = await freshFab();
    fab.ensureFabStyles();
    const el = document.getElementById("ysw-fab-styles");
    expect(el).not.toBeNull();
    expect(el!.tagName).toBe("STYLE");
    expect(el!.textContent).toContain(".ysm-ovl-btn");
  });

  it("幂等：重复调用不产生第二个节点", async () => {
    const fab = await freshFab();
    fab.ensureFabStyles();
    fab.ensureFabStyles();
    fab.ensureFabStyles();
    expect(document.querySelectorAll("#ysw-fab-styles").length).toBe(1);
  });

  it("head 已有同 id 样式元素时短路不重复注入", async () => {
    const style = document.createElement("style");
    style.id = "ysw-fab-styles";
    document.head.appendChild(style);
    const before = document.querySelectorAll("#ysw-fab-styles").length;
    const fab = await freshFab();
    fab.ensureFabStyles();
    expect(document.querySelectorAll("#ysw-fab-styles").length).toBe(before);
  });

  it("document 未定义（无 DOM 环境）时静默返回，恢复后可正常注入", async () => {
    const fab = await freshFab();
    try {
      vi.stubGlobal("document", undefined);
      expect(() => fab.ensureFabStyles()).not.toThrow();
    } finally {
      vi.unstubAllGlobals();
    }
    fab.ensureFabStyles();
    expect(document.getElementById("ysw-fab-styles")).not.toBeNull();
  });
});

describe("createIconButton — 图标按钮工厂", () => {
  it("默认 className 为 ysm-ovl-btn", () => {
    const btn = createIconButton({});
    expect(btn.tagName).toBe("BUTTON");
    expect(btn.className).toBe("ysm-ovl-btn");
  });

  it("自定义 className 生效", () => {
    const btn = createIconButton({ className: "my-btn" });
    expect(btn.className).toBe("my-btn");
  });

  it("title → aria-label + 自定义 tooltip（不设原生 title 防双气泡）", async () => {
    vi.useFakeTimers();
    try {
      const btn = createIconButton({ title: "关闭" });
      document.body.appendChild(btn);
      expect(btn.getAttribute("aria-label")).toBe("关闭");
      expect(btn.title).toBe("");
      btn.dispatchEvent(new Event("mouseenter"));
      vi.advanceTimersByTime(500);
      const tip = document.querySelector<HTMLElement>(".ysw-tooltip")!;
      expect(tip).not.toBeNull();
      expect(tip.textContent).toBe("关闭");
      expect(tip.classList.contains("ysw-tooltip--show")).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("Unicode emoji icon → .preview-ic textContent 形态（不走 CSS 类）", () => {
    const btn = createIconButton({ icon: "✕" });
    const ic = btn.querySelector(".preview-ic");
    expect(ic).not.toBeNull();
    expect(ic!.textContent).toBe("✕");
    expect(ic!.classList.contains("preview-ic--✕")).toBe(false);
  });

  it("多码元 emoji icon → textContent 形态", () => {
    const btn = createIconButton({ icon: "\u{1F4F7}" });
    const ic = btn.querySelector(".preview-ic");
    expect(ic!.textContent).toBe("\u{1F4F7}");
    expect(ic!.classList.contains("preview-ic--\u{1F4F7}")).toBe(false);
  });

  it("CSS 类名 icon（cam）→ 注入 preview-ic--cam，不写 textContent", () => {
    const btn = createIconButton({ icon: "cam" });
    const ic = btn.querySelector(".preview-ic");
    expect(ic!.classList.contains("preview-ic--cam")).toBe(true);
    expect(ic!.textContent).toBe("");
  });

  it("非纯类名字符串 icon → 降级 textContent（防误注入 CSS 类）", () => {
    const btn = createIconButton({ icon: "cam x" });
    const ic = btn.querySelector(".preview-ic");
    expect(ic!.textContent).toBe("cam x");
    expect(ic!.classList.contains("preview-ic--cam")).toBe(false);
  });

  it("label → 追加文本 span", () => {
    const btn = createIconButton({ label: "拍照" });
    expect(btn.textContent).toBe("拍照");
  });

  it("onClick → 绑定到 onclick，点击触发", () => {
    const fn = vi.fn();
    const btn = createIconButton({ onClick: fn });
    btn.click();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("无任何选项 → 仅按钮本体，无子节点", () => {
    const btn = createIconButton({});
    expect(btn.children.length).toBe(0);
    expect(btn.title).toBe("");
  });

  it("icon + label + title 组合齐全", () => {
    const btn = createIconButton({ icon: "close", label: "关闭", title: "关闭预览" });
    expect(btn.querySelector(".preview-ic--close")).not.toBeNull();
    expect(btn.textContent).toBe("关闭");
    expect(btn.getAttribute("aria-label")).toBe("关闭预览");
  });

  it("title tooltip 挂载点在 document.body（跨 Shadow DOM 可用）", async () => {
    vi.useFakeTimers();
    try {
      const btn = createIconButton({ title: "提示" });
      document.body.appendChild(btn);
      btn.dispatchEvent(new Event("mouseenter"));
      vi.advanceTimersByTime(500);
      const tip = document.querySelector<HTMLElement>(".ysw-tooltip");
      expect(tip).not.toBeNull();
      expect(document.body.contains(tip!)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
