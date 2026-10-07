// ===== openModel3DFullscreen 路由兜底链 + 失败留痕测试 =====
// 补测此前零覆盖的一条主链（认知复杂度战役第 4b 批的特征测试前置）：
//   opener 兜底链（直查 routeKey → 扩展名变体兜底 → 容器默认适配器兜底）与
//   「未注册类型」失败出口（toast 带探测现场 + AddOpLog fail 留痕，日志失败不阻断）。
// 契约要点：兜底链是 `??` 短路——直查未注册时**必须继续下探**，不能提前返回 undefined。
import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  getAppMock: vi.fn(),
  switchPreview: vi.fn().mockResolvedValue(undefined),
  hasActivePreview: vi.fn().mockReturnValue(false),
  cleanupPreview: vi.fn(),
  toast: vi.fn(),
  resolveSiblingsForRoute: vi.fn().mockResolvedValue([]),
  logWarn: vi.fn(),
}));

vi.mock("@/backend/app.ts", () => ({ getApp: mocks.getAppMock }));
vi.mock("@/preview-3d/adapters/mount-preview-core.ts", () => ({
  switchPreview: mocks.switchPreview,
  hasActivePreview: mocks.hasActivePreview,
  cleanupPreview: mocks.cleanupPreview,
}));
vi.mock("@/utils/dom/toast.ts", () => ({ toast: mocks.toast }));
vi.mock("@/utils/base/primitives/log.ts", () => ({
  logWarn: mocks.logWarn,
  logError: vi.fn(),
}));
vi.mock("./siblings.ts", () => ({ resolveSiblingsForRoute: mocks.resolveSiblingsForRoute }));

import { openModel3DFullscreen, registerReRoute } from "./preview-library.ts";
import { sceneRegistry } from "@/preview-3d/infra/scene-registry.ts";

beforeEach(() => {
  sceneRegistry.reset();
  vi.clearAllMocks();
  mocks.hasActivePreview.mockReturnValue(false);
  mocks.resolveSiblingsForRoute.mockResolvedValue([]);
});

/** 取一个「本测试专属」的探测结果 + 日志绑定 */
function appWith(rtype: string, addOpLog?: ReturnType<typeof vi.fn>) {
  return {
    DetectResourceType: vi.fn(async () => rtype),
    AddOpLog: addOpLog ?? vi.fn().mockResolvedValue(undefined),
  };
}

describe("openModel3DFullscreen — 早退与后端不可用", () => {
  it("path 为空 → 立即返回（不取 App、不 toast）", async () => {
    await openModel3DFullscreen("");
    expect(mocks.getAppMock).not.toHaveBeenCalled();
    expect(mocks.toast).not.toHaveBeenCalled();
  });

  it("backendGetApp 拒绝 → 错误 toast + 不抛（不留下 unhandled rejection）", async () => {
    mocks.getAppMock.mockRejectedValue(new Error("bridge down"));
    await expect(openModel3DFullscreen("/repo/a.pmx")).resolves.toBeUndefined();
    expect(mocks.logWarn).toHaveBeenCalledWith("preview-3d", "后端不可用，无法打开 3D", expect.anything());
    expect(mocks.toast).toHaveBeenCalledTimes(1);
    expect(String(mocks.toast.mock.calls[0][0])).toContain("后端");
    expect(mocks.toast.mock.calls[0][2]).toBe("error");
  });

  it("显式 rtype 透传 → 不调 DetectResourceType（避免歧义扩展名重复探测）", async () => {
    const detect = vi.fn(async () => "SHOULD_NOT_BE_CALLED");
    mocks.getAppMock.mockResolvedValue({ DetectResourceType: detect, AddOpLog: vi.fn() });
    const opener = vi.fn().mockResolvedValue(undefined);
    registerReRoute("ysm", opener);
    await openModel3DFullscreen("/repo/a.zzz", { rtype: "ysm" });
    expect(detect).not.toHaveBeenCalled();
    expect(opener).toHaveBeenCalledWith("/repo/a.zzz", undefined);
  });

  it("DetectResourceType 抛错 → 不弹「后端不可用」，rtype 空串继续路由（扩展名兜底仍生效）", async () => {
    mocks.getAppMock.mockResolvedValue({
      DetectResourceType: vi.fn(async () => {
        throw new Error("detect failed");
      }),
      AddOpLog: vi.fn(),
    });
    const mmd = vi.fn().mockResolvedValue(undefined);
    const mmdScene = vi.fn().mockResolvedValue(undefined);
    registerReRoute("mmd", mmd);
    registerReRoute("mmd-scene", mmdScene);
    await openModel3DFullscreen("/repo/a.pmx");
    expect(mocks.toast).not.toHaveBeenCalled();
    expect(mmd).toHaveBeenCalledTimes(1); // 扩展名兜底取「首个声明 .pmx 者」= mmd
    expect(mmdScene).not.toHaveBeenCalled();
  });
});

describe("openModel3DFullscreen — opener 兜底链（?? 短路语义）", () => {
  it("扩展名兜底：routeKey 未注册（other）→ 按 .pmx 变体落 mmd opener", async () => {
    mocks.getAppMock.mockResolvedValue(appWith("other"));
    const mmd = vi.fn().mockResolvedValue(undefined);
    registerReRoute("mmd", mmd);
    await openModel3DFullscreen("/repo/a.pmx");
    expect(mmd).toHaveBeenCalledWith("/repo/a.pmx", undefined);
    expect(mocks.toast).not.toHaveBeenCalled();
  });

  it("容器兜底：routeKey=EntityPlayer（无 .zip 变体）→ 落该 rtype 默认预览适配器（mmd）", async () => {
    mocks.getAppMock.mockResolvedValue(appWith("EntityPlayer"));
    // 生产实况：EntityPlayer 从不注册 opener（routeKey 直查必落空），兜底靠 rtype 默认适配器。
    const byDefault = vi.fn().mockResolvedValue(undefined);
    const firstPmxOwner = vi.fn().mockResolvedValue(undefined);
    registerReRoute("mmd", byDefault); // resolveDefaultPreviewKey("EntityPlayer") = mmd
    registerReRoute("mmd-scene", firstPmxOwner); // .pmx 的扩展名兜底目标——本路径不该用
    await openModel3DFullscreen("/repo/pack.zip");
    expect(byDefault).toHaveBeenCalledWith("/repo/pack.zip", undefined);
    expect(firstPmxOwner).not.toHaveBeenCalled();
    expect(mocks.toast).not.toHaveBeenCalled();
  });

  it("分支顺序：routeKey 为空串时先走扩展名兜底，不再下探容器默认适配器", async () => {
    mocks.getAppMock.mockResolvedValue(appWith(""));
    const emptyKey = vi.fn().mockResolvedValue(undefined);
    const byDefault = vi.fn().mockResolvedValue(undefined);
    registerReRoute("", emptyKey); // resolvePreviewKeyByExt(".zip") = ""（.zip 无任何变体声明者）
    registerReRoute("mmd", byDefault);
    await openModel3DFullscreen("/repo/pack.zip");
    expect(emptyKey).toHaveBeenCalledTimes(1); // 扩展名兜底先命中（?? 链短路）
    expect(byDefault).not.toHaveBeenCalled(); // 容器兜底未被触及
  });

  it("直查命中即用，不再下探兜底（routeKey 已注册）", async () => {
    mocks.getAppMock.mockResolvedValue(appWith("vrm"));
    const direct = vi.fn().mockResolvedValue(undefined);
    const byExt = vi.fn().mockResolvedValue(undefined);
    registerReRoute("vrm", direct);
    registerReRoute("mmd", byExt);
    await openModel3DFullscreen("/repo/a.pmx"); // .pmx 的扩展名兜底是 mmd，但 rtype 直查 vrm 命中
    expect(direct).toHaveBeenCalledTimes(1);
    expect(byExt).not.toHaveBeenCalled();
  });
});

describe("openModel3DFullscreen — 未注册类型失败出口", () => {
  it("无任何 opener → warn toast（带探测现场）+ AddOpLog fail 留痕", async () => {
    const addOpLog = vi.fn().mockResolvedValue(undefined);
    mocks.getAppMock.mockResolvedValue(appWith("unknown", addOpLog));
    await openModel3DFullscreen("/repo/a.xyzzy");
    expect(mocks.toast).toHaveBeenCalledTimes(1);
    const [msg, ms, kind] = mocks.toast.mock.calls[0];
    expect(String(msg)).toContain("3D 预览暂不支持该类型");
    expect(String(msg)).toContain("探测类型=unknown");
    expect(String(msg)).toContain("路由key=unknown");
    expect(String(msg)).toContain("扩展名=.xyzzy");
    expect(kind).toBe("warn");
    expect(ms).toBeDefined();
    expect(addOpLog).toHaveBeenCalledWith(
      "preview-3d-route",
      "a.xyzzy",
      "/repo/a.xyzzy",
      "",
      0,
      "fail",
      expect.stringContaining("探测类型=unknown"),
    );
  });

  it("无扩展名路径 → 探测现场标「(无扩展名)」", async () => {
    mocks.getAppMock.mockResolvedValue(appWith("unknown"));
    await openModel3DFullscreen("/repo/Makefile");
    expect(String(mocks.toast.mock.calls[0][0])).toContain("扩展名=(无扩展名)");
  });

  it("AddOpLog 抛错 → 静默吞掉，不阻断（失败留痕尽力而为）", async () => {
    const addOpLog = vi.fn().mockRejectedValue(new Error("log rpc down"));
    mocks.getAppMock.mockResolvedValue(appWith("unknown", addOpLog));
    await expect(openModel3DFullscreen("/repo/a.xyzzy")).resolves.toBeUndefined();
    expect(addOpLog).toHaveBeenCalledTimes(1);
  });

  it("AddOpLog 缺失（旧绑定）→ 可选链兜底，不抛", async () => {
    mocks.getAppMock.mockResolvedValue({ DetectResourceType: vi.fn(async () => "unknown") });
    await expect(openModel3DFullscreen("/repo/a.xyzzy")).resolves.toBeUndefined();
    expect(mocks.toast).toHaveBeenCalledTimes(1);
  });
});

describe("openModel3DFullscreen — siblings 自算兜底（ADR-253 D1）", () => {
  it("调用方未表态 + 兜底有候选 → 自算 siblings 并透传", async () => {
    mocks.getAppMock.mockResolvedValue(appWith("vrm"));
    mocks.resolveSiblingsForRoute.mockResolvedValue(["/repo/b.vrm"]);
    const opener = vi.fn().mockResolvedValue(undefined);
    registerReRoute("vrm", opener);
    await openModel3DFullscreen("/repo/a.vrm");
    expect(mocks.resolveSiblingsForRoute).toHaveBeenCalledWith("vrm", "vrm");
    expect(opener).toHaveBeenCalledWith("/repo/a.vrm", { siblings: ["/repo/b.vrm"] });
  });

  it("兜底无候选（空数组）→ 不下发 siblings 字段（退化为下拉不渲染）", async () => {
    mocks.getAppMock.mockResolvedValue(appWith("vrm"));
    mocks.resolveSiblingsForRoute.mockResolvedValue([]);
    const opener = vi.fn().mockResolvedValue(undefined);
    registerReRoute("vrm", opener);
    await openModel3DFullscreen("/repo/a.vrm");
    expect(opener).toHaveBeenCalledWith("/repo/a.vrm", undefined);
  });
});
