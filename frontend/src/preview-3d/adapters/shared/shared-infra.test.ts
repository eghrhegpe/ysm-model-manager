// @vitest-environment node
// ===== adapters/shared/shared-infra — requireSharedInfra 窄化守卫测试 =====
// shared 模式下核心必供 scene/camera/controls/renderer；任一缺失须 fail-fast 报错，
// 把「shared 模式缺基础设施」从运行时崩溃转为明确报错（ADR-066 §5.7）。
import { describe, it, expect } from "vitest";
import { requireSharedInfra } from "./shared-infra.ts";
import type { PreviewBuildCtx } from "@/preview-3d/adapters/mount-preview-core.ts";

const fullCtx = () =>
  ({
    adapterId: "vrm",
    scene: { isScene: true },
    camera: { isCamera: true },
    controls: { isControls: true },
    renderer: { isRenderer: true },
  }) as unknown as PreviewBuildCtx;

describe("requireSharedInfra — 完整基础设施", () => {
  it("返回同一批引用（窄化不拷贝，避免装配层对象漂移）", () => {
    const ctx = fullCtx();
    const infra = requireSharedInfra(ctx);
    expect(infra.scene).toBe(ctx.scene);
    expect(infra.camera).toBe(ctx.camera);
    expect(infra.controls).toBe(ctx.controls);
    expect(infra.renderer).toBe(ctx.renderer);
  });
});

describe("requireSharedInfra — 缺失即 fail-fast", () => {
  it("缺 renderer → 抛错且报错带 adapterId", () => {
    const ctx = { ...fullCtx(), renderer: undefined } as unknown as PreviewBuildCtx;
    expect(() => requireSharedInfra(ctx)).toThrow(/vrm/);
    expect(() => requireSharedInfra(ctx)).toThrow(/scene\/camera\/controls\/renderer/);
  });

  it("缺 scene → 抛错", () => {
    const ctx = { ...fullCtx(), scene: undefined } as unknown as PreviewBuildCtx;
    expect(() => requireSharedInfra(ctx)).toThrow(/scene/);
  });

  it("无 adapterId 时仍报错（降级为 adapter 前缀）", () => {
    const ctx = { scene: {}, camera: {}, controls: {} } as unknown as PreviewBuildCtx;
    expect(() => requireSharedInfra(ctx)).toThrow(/adapter/);
  });

  it("全空 ctx → 抛错（shared 模式契约违约）", () => {
    expect(() => requireSharedInfra({} as unknown as PreviewBuildCtx)).toThrow();
  });
});