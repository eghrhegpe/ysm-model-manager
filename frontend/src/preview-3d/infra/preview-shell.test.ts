// @vitest-environment happy-dom
// ===== 预览外壳宿主契约（infra 轮点名：resetRefs / body 兜底补建 / 权威引用回传无独立锁）=====
// ensureOverlayShell / ensureViewContainer / PreviewShellHost.resetRefs 是外壳装配的
// 单例原语：注释自陈「overlay 在则 body 必在」「body 兜底必须在此处」「调用方须用返回值
// 而非入参」——此前仅由 mount3D 集成测试（mount-preview-core.test.ts）间接覆盖，本文件
// 单元级直测。
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  previewShell,
  ensureOverlayShell,
  ensureViewContainer,
  type OverlayShellDeps,
} from "./preview-shell.ts";
import { PREVIEW_OVERLAY_ID } from "./ui-constants.ts";

function makeDeps(overrides: Partial<OverlayShellDeps> = {}): OverlayShellDeps {
  return {
    styleSheets: [],
    ariaLabel: "3D 预览",
    setStyleTarget: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  previewShell.resetRefs();
  document.body.innerHTML = "";
});

afterEach(() => {
  vi.restoreAllMocks();
  previewShell.resetRefs();
  document.body.innerHTML = "";
});

describe("PreviewShellHost.resetRefs", () => {
  it("overlay/body/viewContainer 三字段同置 null", () => {
    previewShell.overlay = document.createElement("div");
    previewShell.body = document.createElement("div");
    previewShell.viewContainer = document.createElement("div");
    previewShell.resetRefs();
    expect(previewShell.overlay).toBeNull();
    expect(previewShell.body).toBeNull();
    expect(previewShell.viewContainer).toBeNull();
  });
});

describe("ensureOverlayShell 首建", () => {
  it("创建 overlay（id/role/aria-modal/aria-label）+ body 进 root，host 记录引用，样式目标切到 shadow root", () => {
    const deps = makeDeps();
    const { overlay, body, root } = ensureOverlayShell(deps);

    expect(overlay.id).toBe(PREVIEW_OVERLAY_ID);
    expect(overlay.className).toContain("mpc-overlay");
    expect(overlay.getAttribute("role")).toBe("dialog");
    expect(overlay.getAttribute("aria-modal")).toBe("true");
    expect(overlay.getAttribute("aria-label")).toBe("3D 预览");
    expect(document.getElementById(PREVIEW_OVERLAY_ID)).toBe(overlay);
    expect(root).toBe(overlay.shadowRoot);
    expect(body.className).toContain("mpc-body");
    // body 的父是 ShadowRoot（非 Element）——parentElement 语义上不适用，用 parentNode
    expect(body.parentNode).toBe(overlay.shadowRoot);
    expect(previewShell.overlay).toBe(overlay);
    expect(previewShell.body).toBe(body);
    expect(deps.setStyleTarget).toHaveBeenCalledWith(overlay.shadowRoot);
  });

  it("attachShadow 缺失 → 降级 light DOM（root = overlay 本体）", () => {
    vi.spyOn(HTMLElement.prototype, "attachShadow").mockImplementation(
      () => null as unknown as ShadowRoot,
    );
    const deps = makeDeps();
    const { overlay, root } = ensureOverlayShell(deps);
    expect(root).toBe(overlay);
  });
});

describe("ensureOverlayShell 复用", () => {
  it("二次调用不重建：同一 overlay / root = 既有 shadowRoot，外壳仅一份", () => {
    const first = ensureOverlayShell(makeDeps());
    const second = ensureOverlayShell(makeDeps());
    expect(second.overlay).toBe(first.overlay);
    expect(second.root).toBe(first.root);
    // 外壳内容在 shadow root 内（document.querySelectorAll 不穿透 shadow 边界）
    const shadow = second.overlay.shadowRoot as unknown as HTMLElement;
    expect(shadow.querySelectorAll(".mpc-overlay")).toHaveLength(0); // 本体在 document 树
    expect(shadow.querySelectorAll(".mpc-body")).toHaveLength(1);
    expect(document.querySelectorAll(".mpc-overlay")).toHaveLength(1);
  });
});

describe("ensureViewContainer", () => {
  it("body 兜底补建：body=null → 补建 .mpc-body 进 root、host 记录、返回权威引用（用返回值而非入参）", () => {
    const { root } = ensureOverlayShell(makeDeps());
    // 模拟「overlay 在而调用方手头 body 引用丢失（null）」的异常态——注释自陈的兜底分支
    const { viewContainer, body } = ensureViewContainer(null, root);
    expect(body.className).toContain("mpc-body");
    expect(body.isConnected).toBe(true);
    expect(viewContainer.className).toBe("preview-view-container mpc-view");
    expect(viewContainer.parentElement).toBe(body);
    expect(previewShell.body).toBe(body); // host 已记录补建
    expect(previewShell.viewContainer).toBe(viewContainer);
  });

  it("复用：viewContainer 已建 → 同一引用、body 不重复创建", () => {
    const { root } = ensureOverlayShell(makeDeps());
    const first = ensureViewContainer(previewShell.body, root);
    const second = ensureViewContainer(previewShell.body, root);
    expect(second.viewContainer).toBe(first.viewContainer);
    // 内容在 shadow root 内（document.querySelectorAll 不穿透 shadow 边界）
    const shadow = root as unknown as HTMLElement;
    expect(shadow.querySelectorAll(".preview-view-container")).toHaveLength(1);
    expect(shadow.querySelectorAll(".mpc-body")).toHaveLength(1);
  });
});
