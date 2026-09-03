// @vitest-environment happy-dom
// ===== utils/dom/tooltip 测试 =====
// 覆盖：ensureTooltipStyles 幂等注入、attachTooltip 显示/隐藏/延迟/动态文案/
// 定位（上方优先/下方翻转）、cleanup 摘除监听与隐藏、元素脱离 DOM 兜底隐藏。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type * as TooltipModule from "./tooltip.ts";

/** 获取全新 tooltip 模块实例（重置模块级单例状态，测试相互隔离） */
async function freshTooltip(): Promise<typeof TooltipModule> {
  vi.resetModules();
  return await import("./tooltip.ts");
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  document.getElementById("ysw-tooltip-styles")?.remove();
  document.querySelectorAll(".ysw-tooltip").forEach((n) => n.remove());
});

describe("ensureTooltipStyles — 全局样式幂等注入", () => {
  it("注入 <style id=ysw-tooltip-styles> 到 head，内容含 .ysw-tooltip 规则", async () => {
    const mod = await freshTooltip();
    mod.ensureTooltipStyles();
    const el = document.getElementById("ysw-tooltip-styles");
    expect(el).not.toBeNull();
    expect(el!.tagName).toBe("STYLE");
    expect(el!.textContent).toContain(".ysw-tooltip");
  });

  it("幂等：重复调用不产生第二个节点", async () => {
    const mod = await freshTooltip();
    mod.ensureTooltipStyles();
    mod.ensureTooltipStyles();
    expect(document.querySelectorAll("#ysw-tooltip-styles").length).toBe(1);
  });

  it("head 已有同 id 样式元素时短路不重复注入", async () => {
    const style = document.createElement("style");
    style.id = "ysw-tooltip-styles";
    document.head.appendChild(style);
    const before = document.querySelectorAll("#ysw-tooltip-styles").length;
    const mod = await freshTooltip();
    mod.ensureTooltipStyles();
    expect(document.querySelectorAll("#ysw-tooltip-styles").length).toBe(before);
  });

  it("document 未定义（无 DOM 环境）时静默返回", async () => {
    const mod = await freshTooltip();
    try {
      vi.stubGlobal("document", undefined);
      expect(() => mod.ensureTooltipStyles()).not.toThrow();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("attachTooltip — 悬停显示/离开隐藏", () => {
  it("mouseenter 后经延迟显示：body 出现 .ysw-tooltip 且含文案 + --show 类", async () => {
    const { attachTooltip } = await freshTooltip();
    const btn = document.createElement("button");
    document.body.appendChild(btn);
    attachTooltip(btn, "关闭预览", { delayMs: 300 });
    btn.dispatchEvent(new Event("mouseenter"));
    expect(document.querySelector(".ysw-tooltip")).toBeNull();
    vi.advanceTimersByTime(350);
    const tip = document.querySelector<HTMLElement>(".ysw-tooltip")!;
    expect(tip).not.toBeNull();
    expect(tip.textContent).toBe("关闭预览");
    expect(tip.classList.contains("ysw-tooltip--show")).toBe(true);
  });

  it("mouseleave 立即隐藏（不等延迟）", async () => {
    const { attachTooltip } = await freshTooltip();
    const btn = document.createElement("button");
    document.body.appendChild(btn);
    attachTooltip(btn, "提示", { delayMs: 100 });
    btn.dispatchEvent(new Event("mouseenter"));
    vi.advanceTimersByTime(150);
    expect(document.querySelector(".ysw-tooltip--show")).not.toBeNull();
    btn.dispatchEvent(new Event("mouseleave"));
    expect(document.querySelector(".ysw-tooltip--show")).toBeNull();
  });

  it("动态文案 getter 在显示时刻求值", async () => {
    const { attachTooltip } = await freshTooltip();
    const btn = document.createElement("button");
    document.body.appendChild(btn);
    let text = "初始";
    attachTooltip(btn, () => text, { delayMs: 100 });
    text = "更新后";
    btn.dispatchEvent(new Event("mouseenter"));
    vi.advanceTimersByTime(150);
    expect(document.querySelector<HTMLElement>(".ysw-tooltip")!.textContent).toBe("更新后");
  });

  it("文案为空字符串则不显示", async () => {
    const { attachTooltip } = await freshTooltip();
    const btn = document.createElement("button");
    document.body.appendChild(btn);
    attachTooltip(btn, "", { delayMs: 100 });
    btn.dispatchEvent(new Event("mouseenter"));
    vi.advanceTimersByTime(200);
    expect(document.querySelector(".ysw-tooltip--show")).toBeNull();
  });

  it("单例复用：悬停第二个按钮替换文案，不产生第二个节点", async () => {
    const { attachTooltip } = await freshTooltip();
    const a = document.createElement("button");
    const b = document.createElement("button");
    document.body.append(a, b);
    attachTooltip(a, "甲", { delayMs: 0 });
    attachTooltip(b, "乙", { delayMs: 0 });
    a.dispatchEvent(new Event("mouseenter"));
    vi.advanceTimersByTime(50);
    b.dispatchEvent(new Event("mouseenter"));
    vi.advanceTimersByTime(50);
    const tips = document.querySelectorAll(".ysw-tooltip");
    expect(tips.length).toBe(1);
    expect(tips[0].textContent).toBe("乙");
  });

  it("blur 时隐藏", async () => {
    const { attachTooltip } = await freshTooltip();
    const btn = document.createElement("button");
    document.body.appendChild(btn);
    attachTooltip(btn, "提示", { delayMs: 0 });
    btn.dispatchEvent(new Event("mouseenter"));
    vi.advanceTimersByTime(50);
    expect(document.querySelector(".ysw-tooltip--show")).not.toBeNull();
    btn.dispatchEvent(new Event("blur"));
    expect(document.querySelector(".ysw-tooltip--show")).toBeNull();
  });
});

describe("attachTooltip — 定位", () => {
  function mockRect(el: HTMLElement, rect: Partial<DOMRect>): void {
    vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
      x: 0, y: 0, width: 40, height: 30, top: 0, left: 0, right: 0, bottom: 0,
      toJSON: () => rect,
      ...rect,
    } as DOMRect);
  }

  it("默认放目标上方水平居中", async () => {
    const { attachTooltip } = await freshTooltip();
    const btn = document.createElement("button");
    document.body.appendChild(btn);
    // 视口中部：上方空间充足
    mockRect(btn, { top: 400, bottom: 430, left: 500, right: 540, width: 40, height: 30 });
    attachTooltip(btn, "提示", { delayMs: 0 });
    btn.dispatchEvent(new Event("mouseenter"));
    vi.advanceTimersByTime(50);
    const tip = document.querySelector<HTMLElement>(".ysw-tooltip")!;
    // happy-dom 无真实布局：offsetWidth/Height 为 0 → y = top - 0 - 6
    expect(parseFloat(tip.style.top)).toBeLessThan(400);
    expect(parseFloat(tip.style.left)).toBeCloseTo(500 + 20, 0);
  });

  it("上方空间不足时翻转到下方", async () => {
    const { attachTooltip } = await freshTooltip();
    const btn = document.createElement("button");
    document.body.appendChild(btn);
    mockRect(btn, { top: 4, bottom: 34, left: 100, right: 140, width: 40, height: 30 });
    attachTooltip(btn, "提示", { delayMs: 0 });
    btn.dispatchEvent(new Event("mouseenter"));
    vi.advanceTimersByTime(50);
    const tip = document.querySelector<HTMLElement>(".ysw-tooltip")!;
    expect(parseFloat(tip.style.top)).toBeGreaterThan(34);
  });
});

describe("attachTooltip — cleanup 与兜底", () => {
  it("cleanup 后不再响应 hover，且正在显示时立即隐藏", async () => {    const { attachTooltip } = await freshTooltip();
    const btn = document.createElement("button");
    document.body.appendChild(btn);
    const off = attachTooltip(btn, "提示", { delayMs: 0 });
    btn.dispatchEvent(new Event("mouseenter"));
    vi.advanceTimersByTime(50);
    expect(document.querySelector(".ysw-tooltip--show")).not.toBeNull();
    off();
    expect(document.querySelector(".ysw-tooltip--show")).toBeNull();
    btn.dispatchEvent(new Event("mouseenter"));
    vi.advanceTimersByTime(100);
    expect(document.querySelector(".ysw-tooltip--show")).toBeNull();
  });

  it("延迟触发前元素已脱离 DOM → 不显示", async () => {
    const { attachTooltip } = await freshTooltip();
    const btn = document.createElement("button");
    document.body.appendChild(btn);
    attachTooltip(btn, "提示", { delayMs: 100 });
    btn.dispatchEvent(new Event("mouseenter"));
    btn.remove();
    vi.advanceTimersByTime(200);
    expect(document.querySelector(".ysw-tooltip--show")).toBeNull();
  });

  it("已显示后元素被移除 DOM → MutationObserver 兜底隐藏", async () => {
    const { attachTooltip } = await freshTooltip();
    const btn = document.createElement("button");
    document.body.appendChild(btn);
    attachTooltip(btn, "提示", { delayMs: 0 });
    btn.dispatchEvent(new Event("mouseenter"));
    vi.advanceTimersByTime(50);
    expect(document.querySelector(".ysw-tooltip--show")).not.toBeNull();
    btn.remove();
    await Promise.resolve(); // MutationObserver 回调走微任务
    await Promise.resolve();
    expect(document.querySelector(".ysw-tooltip--show")).toBeNull();
  });

  it("显示中页面滚动 → 模块级单例监听统一隐藏", async () => {
    const { attachTooltip } = await freshTooltip();
    const btn = document.createElement("button");
    document.body.appendChild(btn);
    attachTooltip(btn, "提示", { delayMs: 0 });
    btn.dispatchEvent(new Event("mouseenter"));
    vi.advanceTimersByTime(50);
    expect(document.querySelector(".ysw-tooltip--show")).not.toBeNull();
    document.dispatchEvent(new Event("scroll"));
    expect(document.querySelector(".ysw-tooltip--show")).toBeNull();
  });

  it("延迟触发前页面滚动 → pending timer 被取消，不显示", async () => {
    const { attachTooltip } = await freshTooltip();
    const btn = document.createElement("button");
    document.body.appendChild(btn);
    attachTooltip(btn, "提示", { delayMs: 100 });
    btn.dispatchEvent(new Event("mouseenter"));
    document.dispatchEvent(new Event("scroll"));
    vi.advanceTimersByTime(200);
    expect(document.querySelector(".ysw-tooltip--show")).toBeNull();
  });

  it("cleanup 后滚动不再有副作用（单例监听常驻但空操作）", async () => {
    const { attachTooltip } = await freshTooltip();
    const btn = document.createElement("button");
    document.body.appendChild(btn);
    const off = attachTooltip(btn, "提示", { delayMs: 0 });
    btn.dispatchEvent(new Event("mouseenter"));
    vi.advanceTimersByTime(50);
    off();
    document.dispatchEvent(new Event("scroll"));
    expect(document.querySelector(".ysw-tooltip--show")).toBeNull();
  });
});

describe("promoteTitle — 原生 title 升级为自定义 tooltip", () => {
  it("有 title → 摘除原生属性 + 补 aria-label + hover 显示 tooltip", async () => {
    const { promoteTitle } = await freshTooltip();
    const btn = document.createElement("button");
    btn.setAttribute("title", "进入 3D");
    document.body.appendChild(btn);
    promoteTitle(btn);
    expect(btn.hasAttribute("title")).toBe(false);
    expect(btn.getAttribute("aria-label")).toBe("进入 3D");
    btn.dispatchEvent(new Event("mouseenter"));
    vi.advanceTimersByTime(500);
    const tip = document.querySelector<HTMLElement>(".ysw-tooltip")!;
    expect(tip.textContent).toBe("进入 3D");
    expect(tip.classList.contains("ysw-tooltip--show")).toBe(true);
  });

  it("已有 aria-label 时保留原值不覆盖", async () => {
    const { promoteTitle } = await freshTooltip();
    const btn = document.createElement("button");
    btn.setAttribute("title", "提示");
    btn.setAttribute("aria-label", "朗读文本");
    document.body.appendChild(btn);
    promoteTitle(btn);
    expect(btn.getAttribute("aria-label")).toBe("朗读文本");
  });

  it("无 title → no-op 不挂监听不报错", async () => {
    const { promoteTitle } = await freshTooltip();
    const btn = document.createElement("button");
    document.body.appendChild(btn);
    expect(() => promoteTitle(btn)).not.toThrow();
    btn.dispatchEvent(new Event("mouseenter"));
    vi.advanceTimersByTime(600);
    expect(document.querySelector(".ysw-tooltip--show")).toBeNull();
  });
});
