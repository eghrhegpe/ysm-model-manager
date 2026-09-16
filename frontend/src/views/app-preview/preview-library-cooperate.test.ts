// ===== cooperate 跨类型守卫测试（审核 P3-4）=====
// 旧问题：cooperate=true（同台追加）遇到与活跃会话不同类型的目标时，
// 仍直接 switchPreview({keepInScene:true}) → 复用活跃会话适配器 build 错误类型。
// 修复：比对活跃会话 rtype 与新路径路由 rtype，不一致时降级为「关旧开新」+ toast。

import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  getAppMock: vi.fn(),
  switchPreview: vi.fn().mockResolvedValue(undefined),
  hasActivePreview: vi.fn().mockReturnValue(false),
  cleanupPreview: vi.fn(),
}));
vi.mock("@/backend/app.ts", () => ({ getApp: mocks.getAppMock }));
vi.mock("@/preview-3d/adapters/mount-preview-core.ts", () => ({
  switchPreview: mocks.switchPreview,
  hasActivePreview: mocks.hasActivePreview,
  cleanupPreview: mocks.cleanupPreview,
}));

import { openModel3DFullscreen, registerReRoute } from "./preview-library.ts";
import { sceneRegistry } from "@/preview-3d/infra/scene-registry.ts";

const opener = vi.fn().mockResolvedValue(undefined);

beforeEach(() => {
  sceneRegistry.reset();
  vi.clearAllMocks();
  registerReRoute("vrm", opener);
  registerReRoute("ysm", opener);
  mocks.getAppMock.mockResolvedValue({
    DetectResourceType: vi.fn(async () => "vrm"),
  });
});

/** 注册活跃会话记录（指定 rtype） */
function setActiveSession(rtype: string): void {
  sceneRegistry.register({
    path: "current.glb",
    rtype,
    roots: [],
    content: { dispose: vi.fn() } as never,
  });
}

describe("openModel3DFullscreen cooperate 跨类型守卫（审核 P3-4）", () => {
  it("cooperate 同类型 → 走 switchPreview keepInScene，不调 opener（不破坏同台语义）", async () => {
    setActiveSession("vrm");
    mocks.hasActivePreview.mockReturnValue(true);
    await openModel3DFullscreen("new.vrm", { cooperate: true });
    expect(mocks.switchPreview).toHaveBeenCalledWith("new.vrm", { keepInScene: true });
    expect(opener).not.toHaveBeenCalled();
  });

  it("cooperate 跨类型 → 降级关旧开新：cleanupPreview + opener，不走 switchPreview", async () => {
    // 注意 .vrm 是 EntityPlayer 的 variants（.vrm→vrm），同类型；真正跨类型用 ysm
    setActiveSession("EntityPlayer");
    mocks.hasActivePreview.mockReturnValue(true);
    mocks.getAppMock.mockResolvedValue({
      DetectResourceType: vi.fn(async () => "ysm"),
    });
    await openModel3DFullscreen("new.ysm", { cooperate: true });
    expect(mocks.switchPreview).not.toHaveBeenCalled();
    expect(mocks.cleanupPreview).toHaveBeenCalledTimes(1); // 关旧
    expect(opener).toHaveBeenCalledWith("new.ysm", undefined); // 无 siblings/entry → undefined（向后兼容）
  });

  it("cooperate 但无活跃会话 → 直接 opener（原行为）", async () => {
    mocks.hasActivePreview.mockReturnValue(false);
    await openModel3DFullscreen("new.vrm", { cooperate: true });
    expect(opener).toHaveBeenCalledWith("new.vrm", undefined);
    expect(mocks.cleanupPreview).not.toHaveBeenCalled();
  });

  it("类型探测失败（rtype 空）→ cooperate 仍走 switchPreview（保持旧行为不误伤）", async () => {
    setActiveSession("vrm");
    mocks.hasActivePreview.mockReturnValue(true);
    mocks.getAppMock.mockResolvedValue({
      DetectResourceType: vi.fn(async () => ""),
    });
    await openModel3DFullscreen("new.vrm", { cooperate: true });
    expect(mocks.switchPreview).toHaveBeenCalledWith("new.vrm", { keepInScene: true });
  });
});

describe("openModel3DFullscreen entry / siblings 透传（ADR-253 D6）", () => {
  it("entry 透传到 opener 的 opts（资源包容器内初始条目）", async () => {
    mocks.hasActivePreview.mockReturnValue(false);
    await openModel3DFullscreen("p.zip", { entry: "assets/minecraft/models/block/door.json" });
    expect(opener).toHaveBeenCalledWith("p.zip", {
      entry: "assets/minecraft/models/block/door.json",
    });
  });

  it("siblings + entry 同时透传（互不覆盖）", async () => {
    mocks.hasActivePreview.mockReturnValue(false);
    await openModel3DFullscreen("p.zip", { siblings: ["/a.pmx"], entry: "e.json" });
    expect(opener).toHaveBeenCalledWith("p.zip", { siblings: ["/a.pmx"], entry: "e.json" });
  });

  it("显式传空 siblings 数组 → 仍透传（调用方显式意图优先，不被兜底改写）", async () => {
    mocks.hasActivePreview.mockReturnValue(false);
    await openModel3DFullscreen("p.zip", { siblings: [] });
    // 空数组是「显式无候选」，非 undefined → 不触发 rtype 自算兜底
    expect(opener).toHaveBeenCalledWith("p.zip", { siblings: [] });
  });
});
