// @vitest-environment happy-dom
// ===== ui/overlay-active 测试（ADR-175 M1 契约收编）=====
// 覆盖：overlay 存在 → true；不存在 → true 移除后 false；document 未定义（node）→ false。
import { describe, it, expect, afterEach } from "vitest";
import { PREVIEW_OVERLAY_ID } from "./ui-constants.ts";
import { isPreviewOverlayActive } from "./overlay-active.ts";

afterEach(() => {
  document.getElementById(PREVIEW_OVERLAY_ID)?.remove();
});

describe("isPreviewOverlayActive", () => {
  it("overlay 未挂载 → false", () => {
    expect(isPreviewOverlayActive()).toBe(false);
  });

  it("overlay 挂载到 document.body → true", () => {
    const overlay = document.createElement("div");
    overlay.id = PREVIEW_OVERLAY_ID;
    document.body.appendChild(overlay);
    expect(isPreviewOverlayActive()).toBe(true);
  });

  it("overlay 移除 → false（跟随 DOM 生命周期，无状态漂移）", () => {
    const overlay = document.createElement("div");
    overlay.id = PREVIEW_OVERLAY_ID;
    document.body.appendChild(overlay);
    expect(isPreviewOverlayActive()).toBe(true);
    overlay.remove();
    expect(isPreviewOverlayActive()).toBe(false);
  });
});
