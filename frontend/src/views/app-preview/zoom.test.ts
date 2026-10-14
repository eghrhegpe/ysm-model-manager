// ===== openFullPreview 测试：全屏放大预览 =====
// 覆盖：overlay 挂载/渲染、滚轮缩放、拖拽旋转、ESC/点空白关闭、关闭幂等、
//       对话框语义（role/aria-modal/焦点移入）与关闭后焦点归还
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { BedrockGeometry } from "@/preview-3d/decoder/geometry.ts";

const { renderModel2D } = vi.hoisted(() => ({
  renderModel2D: vi.fn(),
}));

vi.mock("./model2d/model2d.ts", () => ({
  renderModel2D,
}));

import { openFullPreview } from "./zoom.ts";

const model = {
  name: "test",
  uv: "string-form",
} as unknown as BedrockGeometry;

function findOverlay(): HTMLElement | null {
  // overlay 内的放大 canvas 固定 600×600，src canvas 未设宽度——以其父元素定位 overlay
  const canvas = Array.from(document.querySelectorAll("canvas")).find((c) => c.width === 600);
  return canvas?.parentElement ?? null;
}

beforeEach(() => {
  document.body.innerHTML = "";
  renderModel2D.mockClear();
});

afterEach(() => {
  // 关闭残留 overlay，移除 window/document 监听，避免跨测试泄漏
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  window.dispatchEvent(new PointerEvent("pointerup"));
  document.body.innerHTML = "";
});

describe("openFullPreview", () => {
  it("挂载 overlay + 大 canvas + 提示，并首次渲染", async () => {
    const src = document.createElement("canvas");
    await openFullPreview(src, model, null, true);

    const overlay = findOverlay();
    expect(overlay).not.toBeNull();
    const big = overlay?.querySelector("canvas");
    expect(big?.width).toBe(600);
    expect(renderModel2D).toHaveBeenCalledTimes(1);
    expect(renderModel2D.mock.calls[0][3]).toMatchObject({ showLabels: true, zoom: 1, rotation: 0 });
  });

  it("overlay 具备对话框语义：role=dialog + aria-modal + 可访问名，且焦点移入（WCAG A 级）", async () => {
    const src = document.createElement("canvas");
    await openFullPreview(src, model, null, false);

    const overlay = findOverlay()!;
    expect(overlay.getAttribute("role")).toBe("dialog");
    expect(overlay.getAttribute("aria-modal")).toBe("true");
    expect(overlay.getAttribute("aria-label")).toBeTruthy();
    expect(overlay.getAttribute("tabindex")).toBe("-1");
    expect(document.activeElement).toBe(overlay);
  });

  it("关闭后焦点归还触发元素（WCAG 2.4.3）", async () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    const src = document.createElement("canvas");
    await openFullPreview(src, model, null, false);
    expect(document.activeElement).not.toBe(opener);

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(document.activeElement).toBe(opener);
  });

  // 锐评（2026-10-14）：aria-modal 承诺了模态就必须有焦点陷阱。此前本 overlay 只做
  // 「焦点移入 + 关闭归还」，Tab 能走到背后页面——同 site/events.ts P0-3 修的病，此处漏网。
  // overlay 内无可聚焦元素，陷阱退化为「Tab / Shift+Tab 一律拉回自身」。
  it("焦点陷阱：Tab / Shift+Tab 拉回 overlay 自身（Tab 不逃到背后页面）", async () => {
    const src = document.createElement("canvas");
    await openFullPreview(src, model, null, false);
    const overlay = findOverlay()!;
    // 模拟焦点逃到 body（点背景/程序移焦）
    (document.activeElement as HTMLElement | null)?.blur?.();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    expect(document.activeElement).toBe(overlay);
    (document.activeElement as HTMLElement | null)?.blur?.();
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Tab", bubbles: true, shiftKey: true }),
    );
    expect(document.activeElement).toBe(overlay);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  });

  it("关闭后释放焦点陷阱（spy 断言 cleanup 被调用）", async () => {
    // 判别力说明：陷阱是 document 级**单例**，且「后开的 trapFocusAcrossShadow 会先清掉
    // 先前的」——故「关闭后另一个浮层还能装上陷阱」这种黑盒断言**恒成立**（无论 zoom 是否
    // 释放），是假绿。此处改用 spy 直接断言 releaseTrap 被执行：把 trapFocusAcrossShadow
    // mock 成返回可观察的 cleanup 桩，验证 close 路径调用了它。
    const { trapFocusAcrossShadow: realTrap } = await import("@/utils/dom/trap-focus-across-shadow.ts");
    const releaseSpy = vi.fn();
    const trapSpy = vi
      .spyOn(await import("@/utils/dom/trap-focus-across-shadow.ts"), "trapFocusAcrossShadow")
      .mockImplementation((o: HTMLElement) => {
        realTrap(o);
        return releaseSpy;
      });
    const src = document.createElement("canvas");
    await openFullPreview(src, model, null, false);
    expect(trapSpy).toHaveBeenCalledTimes(1);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(releaseSpy).toHaveBeenCalledTimes(1);
    trapSpy.mockRestore();
  });

  it("滚轮缩放：deltaY>0 缩小、deltaY<0 放大，并重新渲染", async () => {
    const src = document.createElement("canvas");
    await openFullPreview(src, model, null, false);
    const overlay = findOverlay()!;
    const big = overlay.querySelector("canvas")!;

    big.dispatchEvent(new WheelEvent("wheel", { deltaY: 100, cancelable: true }));
    big.dispatchEvent(new WheelEvent("wheel", { deltaY: -100, cancelable: true }));
    big.dispatchEvent(new WheelEvent("wheel", { deltaY: -100, cancelable: true }));

    // 首次 + 3 次缩放（比例式：±deltaY 各一次 → 净 exp(0.1)）
    expect(renderModel2D).toHaveBeenCalledTimes(4);
    const lastZoom = renderModel2D.mock.calls.at(-1)?.[3].zoom;
    expect(lastZoom).toBeCloseTo(Math.exp(0.1), 4);
  });

  it("拖拽旋转：pointerdown + pointermove 更新 rotation", async () => {
    const src = document.createElement("canvas");
    await openFullPreview(src, model, null, false);
    const overlay = findOverlay()!;
    const big = overlay.querySelector("canvas")!;

    big.dispatchEvent(new PointerEvent("pointerdown", { clientX: 100 }));
    window.dispatchEvent(new PointerEvent("pointermove", { clientX: 220 }));

    const lastRotation = renderModel2D.mock.calls.at(-1)?.[3].rotation;
    expect(lastRotation).toBe((220 - 100) * 0.5 % 360);
  });

  it("未拖拽时 pointermove 不旋转", async () => {
    const src = document.createElement("canvas");
    await openFullPreview(src, model, null, false);

    window.dispatchEvent(new PointerEvent("pointermove", { clientX: 500 }));
    expect(renderModel2D).toHaveBeenCalledTimes(1); // 仅初始渲染
  });

  it("ESC 关闭并清理监听，重复关闭幂等", async () => {
    const src = document.createElement("canvas");
    await openFullPreview(src, model, null, false);
    expect(findOverlay()).not.toBeNull();

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(findOverlay()).toBeNull();

    // 再次 ESC / 再次点击不抛错
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    window.dispatchEvent(new PointerEvent("pointermove", { clientX: 1 }));
  });

  it("点击 overlay 空白区域关闭", async () => {
    const src = document.createElement("canvas");
    await openFullPreview(src, model, null, false);
    const overlay = findOverlay()!;

    // 点击子元素（canvas）不关闭
    const big = overlay.querySelector("canvas")!;
    big.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(findOverlay()).not.toBeNull();

    // 点击 overlay 自身（target === overlay）关闭
    overlay.click();
    expect(findOverlay()).toBeNull();
  });

  it("缩放有界 [0.2, 10]：猛缩/猛放不越界", async () => {
    const src = document.createElement("canvas");
    await openFullPreview(src, model, null, false);
    const big = findOverlay()!.querySelector("canvas")!;

    // 猛缩小（deltaY 巨大正值 → factor → 0）
    for (let i = 0; i < 30; i++) {
      big.dispatchEvent(new WheelEvent("wheel", { deltaY: 5000, cancelable: true }));
    }
    let last = renderModel2D.mock.calls.at(-1)![3].zoom;
    expect(last).toBeGreaterThanOrEqual(0.1999);
    expect(last).toBeLessThan(0.3);

    // 猛放大
    for (let i = 0; i < 30; i++) {
      big.dispatchEvent(new WheelEvent("wheel", { deltaY: -5000, cancelable: true }));
    }
    last = renderModel2D.mock.calls.at(-1)![3].zoom;
    expect(last).toBeLessThanOrEqual(10);
    expect(last).toBeGreaterThan(9);
  });

  it("pointercancel → dragging 复位，后续 pointermove 不再旋转", async () => {
    const src = document.createElement("canvas");
    await openFullPreview(src, model, null, false);
    const big = findOverlay()!.querySelector("canvas")!;

    big.dispatchEvent(new PointerEvent("pointerdown", { clientX: 100 }));
    window.dispatchEvent(new PointerEvent("pointercancel"));
    renderModel2D.mockClear(); // 清初始渲染
    window.dispatchEvent(new PointerEvent("pointermove", { clientX: 300 }));
    // pointercancel 已复位 dragging → pointermove 不触发渲染
    expect(renderModel2D).not.toHaveBeenCalled();
  });

  it("非左键 pointerdown → 不进入拖拽（右键守卫）", async () => {
    const src = document.createElement("canvas");
    await openFullPreview(src, model, null, false);
    const big = findOverlay()!.querySelector("canvas")!;

    big.dispatchEvent(new PointerEvent("pointerdown", { button: 2, clientX: 100 }));
    renderModel2D.mockClear(); // 清初始渲染
    window.dispatchEvent(new PointerEvent("pointermove", { clientX: 400 }));
    // 右键不置 dragging → pointermove 不触发渲染
    expect(renderModel2D).not.toHaveBeenCalled();
  });
});
