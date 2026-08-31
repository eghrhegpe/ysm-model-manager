// ===== openFullPreview 测试：全屏放大预览 =====
// 覆盖：overlay 挂载/渲染、滚轮缩放、拖拽旋转、ESC/点空白关闭、关闭幂等
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { BedrockGeometry } from "../../features/preview-3d/decoder/geometry.ts";

const { renderModel2D } = vi.hoisted(() => ({
  renderModel2D: vi.fn(),
}));

vi.mock("../../features/preview-3d/model2d.ts", () => ({
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
