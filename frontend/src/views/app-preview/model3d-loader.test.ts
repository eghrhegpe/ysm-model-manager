// @vitest-environment node
// ===== 3D 模型加载器测试 =====
// 覆盖：fetchSpec LRU 缓存、preloadModel R1 纹理序契约校验（texArrOrder vs textureNames 不一致 warn）
// loadTextures 单测已随 ADR-136 第四刀迁至 preview-3d/texture-loader.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as THREE from "three";

const { getAppMock, specMock, buildSpecMock, isViewerModeMock, isWebPlatformMock, decodeWasmMock, tsSpecBuilderMock, fakeTextureCache } = vi.hoisted(() => ({
  getAppMock: vi.fn(),
  specMock: vi.fn(),
  buildSpecMock: vi.fn(),
  isViewerModeMock: vi.fn().mockReturnValue(false),
  isWebPlatformMock: vi.fn().mockReturnValue(false),
  decodeWasmMock: vi.fn(),
  tsSpecBuilderMock: vi.fn(),
  fakeTextureCache: {
    acquire: (_url: string, make: (u: string) => import("three").Texture) => make(_url),
    release: () => {},
    invalidate: vi.fn(),
    disposeAll: () => {},
  },
}));

vi.mock("../../backend/app.ts", () => ({
  getApp: getAppMock,
}));
vi.mock("../../utils/dom/android-bridge.ts", () => ({
  isViewerMode: isViewerModeMock,
}));
vi.mock("../../backend/platform-web.ts", () => ({
  isWebPlatform: isWebPlatformMock,
}));
vi.mock("../../preview-3d/decoder/wasm-decode.ts", () => ({
  decodeYsmViaWasm: decodeWasmMock,
}));
vi.mock("../../preview-3d/spec-builder.ts", () => ({
  buildSpecFromGeometryJSON: tsSpecBuilderMock,
}));

vi.mock("../../preview-3d/texture-cache.ts", () => ({
  textureCache: fakeTextureCache,
}));

import { preloadModel } from "./model3d-loader.ts";
import { getLoadTraces, clearLoadTraces } from "../../preview-3d/load-trace.ts";
import { FakeImage } from "../../test-utils/fake-image.ts";

beforeEach(() => {
  vi.clearAllMocks();
  isWebPlatformMock.mockReturnValue(false);
  isViewerModeMock.mockReturnValue(false);
  delete (globalThis as Record<string, unknown>)["__YSM_BACKEND__"];
  getAppMock.mockResolvedValue({
    GetModel3DSpec: specMock,
    Build3DSpecFromGeometryJSON: buildSpecMock,
  });
});

describe("preloadModel / fetchSpec", () => {
  const spec = (texArrOrder?: string[]) => ({
    models: [{ meshGroups: [{ boneId: "root", positions: [0, 0, 0], normals: [], uvs: [], indices: [] }] }],
    texArrOrder,
  });

  it("同一路径二次调用 → GetModel3DSpec 只调一次（LRU 缓存命中）", async () => {
    specMock.mockResolvedValue(spec());
    const model = { _modelPath: "/m/lru.ysm", texture: "t.png" };
    vi.stubGlobal("Image", FakeImage);
    try {
      const r1 = await preloadModel(model);
      const r2 = await preloadModel(model);
      expect(r1.spec.models?.length).toBe(1);
      expect(r2.spec.models?.length).toBe(1);
      expect(specMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("R1 契约：texArrOrder 与 textureNames 不一致 → console.warn", async () => {
    specMock.mockResolvedValue(spec(["a.png", "X.png"]));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("Image", FakeImage);
    try {
      await preloadModel({
        _modelPath: "/m/r1-mismatch.ysm",
        textureNames: ["a.png", "b.png"],
        texture: "a.png",
      });
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("[model3d] R1 纹理缺失"),
      );
    } finally {
      warn.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it("R1 契约：共享槽位（arm 钳制贴 skin）→ 存在性校验不误报", async () => {
    // 02_new_year 回归：1 张声明纹理 skin + 组件 main/arm/arrow。
    // Go 端 arm 钳制到 skin（texArrOrder=[skin,skin,arrow]），texArr 实际 = [skin, arrow]，
    // 索引比对会误报；存在性比对（每个期望名都在已加载清单中）应通过。
    specMock.mockResolvedValue(spec(["skin", "skin", "arrow"]));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("Image", FakeImage);
    try {
      await preloadModel({
        _modelPath: "/m/shared-slot.ysm",
        textureNames: ["skin", "arrow"],
        textures: ["u1", "u2"],
      });
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it("ADR-114：spec.componentTextures → componentTexMap（perComponent 数据源统一）", async () => {
    // wine_fox 根因修复：GetModel3DSpec 注入 componentTextures，前端按组件名取图，
    // 未声明组件（arrow 等）不再依赖全局 texArr 槽位。
    // 键 = SourceName（如 "main"/"arrow"），对齐 spec.models[i].name；
    // 前端 ysm-object.ts 以 mg.name || mg.id 查表，SourceName 直连命中。
    specMock.mockResolvedValue(
      {
        models: [
          { id: "comp_0", name: "main", meshGroups: [{ boneId: "root", positions: [0, 0, 0], normals: [], uvs: [], indices: [] }] },
          { id: "comp_1", name: "arrow", meshGroups: [{ boneId: "root", positions: [0, 0, 0], normals: [], uvs: [], indices: [] }] },
        ],
        componentTextures: { arrow: ["data:image/png;base64,QUJD"] },
      },
    );
    vi.stubGlobal("Image", FakeImage);
    try {
      const r = await preloadModel({ _modelPath: "/m/comptex.json", textures: ["skin.png"] });
      const arr = r.componentTexMap.get("arrow"); // 键 = SourceName（spec.models[i].name）
      expect(arr).toHaveLength(1);
      expect(arr?.[0]).toBeInstanceOf(THREE.Texture);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("R1 契约：顺序一致 → 不 warn", async () => {
    specMock.mockResolvedValue(spec(["a.png", "b.png"]));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("Image", FakeImage);
    try {
      await preloadModel({
        _modelPath: "/m/r1-match.ysm",
        textureNames: ["a.png", "b.png"],
        texture: "a.png",
      });
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it("texArr 用全量纹理清单，不被 texArrOrder（组件序，长度=组件数）截断", async () => {
    // 魔法酒狐回归：ysm.json 声明 6 张纹理，组件只有 3 个（main/arm/arrow），
    // texArrOrder = [magic winefox ice]。texArr 必须以全量 6 张为槽位——
    // 之前 de09164a 用 texArrOrder 当槽位清单，面板只显示「纹理 (3)」且 arrow
    // texSlot=6 越界品红。
    specMock.mockResolvedValue(spec(["magic", "winefox", "ice"]));
    vi.stubGlobal("Image", FakeImage);
    try {
      const r = await preloadModel({
        _modelPath: "/m/fox.ysm",
        textures: ["u1", "u2", "u3", "u4", "u5", "u6"],
        textureNames: ["magic", "winefox", "ice", "flower", "blood", "water"],
      });
      expect(r.texArr).toHaveLength(6);
      expect(r.texArr.every((t) => t !== null)).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("全量纹理清单中的空槽必须保留，避免后续 texIdx 错位成紫色", async () => {
    specMock.mockResolvedValue(spec());
    vi.stubGlobal("Image", FakeImage);
    try {
      const r = await preloadModel({
        _modelPath: "/m/texture-hole.ysm",
        textures: ["u1", "", "u3"],
        textureNames: ["base", "", "overlay"],
      });
      expect(r.texArr).toHaveLength(3);
      expect(r.texArr[0]).toBeInstanceOf(THREE.Texture);
      expect(r.texArr[1]).toBeNull();
      expect(r.texArr[2]).toBeInstanceOf(THREE.Texture);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("只有 textures[0] 而没有 texture 字段时仍加载首纹理", async () => {
    specMock.mockResolvedValue(spec());
    vi.stubGlobal("Image", FakeImage);
    try {
      const r = await preloadModel({
        _modelPath: "/m/array-only-texture.ysm",
        textures: ["skin.png"],
        textureNames: ["skin"],
      });
      expect(r.texArr).toHaveLength(1);
      expect(r.texArr[0]).toBeInstanceOf(THREE.Texture);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("spec 无 models → 抛错（fetchSpec 空 spec 守卫）", async () => {
    specMock.mockResolvedValue({ models: [] });
    await expect(
      preloadModel({ _modelPath: "/m/empty.ysm", texture: "t.png" }),
    ).rejects.toThrow("3D spec 为空");
  });

  it("Android spec 空 → WASM 兜底成功（fetchSpecViaWasmFallback 构建 spec）", async () => {
    isViewerModeMock.mockReturnValue(true);
    specMock.mockResolvedValue({ models: [] }); // Go 恒空（无 Node 通道）
    buildSpecMock.mockResolvedValue(
      { models: [{ meshGroups: [{ boneId: "root", positions: [0, 0, 0], normals: [], uvs: [], indices: [] }] }] },
    );
    decodeWasmMock.mockResolvedValue({ geometryRaw: '{"geometry":"x"}' });
    vi.stubGlobal("Image", FakeImage); // 纹理加载需同步 onload 的 Image mock
    try {
      const r = await preloadModel({ _modelPath: "/m/android.ysm", texture: "t.png" });
      expect(r.spec.models?.length).toBe(1);
      expect(buildSpecMock).toHaveBeenCalledWith('{"geometry":"x"}');
      expect(decodeWasmMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("Android WASM 兜底解码失败 → 仍抛 3D spec 为空（不吞错）", async () => {
    isViewerModeMock.mockReturnValue(true);
    specMock.mockResolvedValue({ models: [] });
    decodeWasmMock.mockResolvedValue(null); // 解码失败
    await expect(
      preloadModel({ _modelPath: "/m/android-fail.ysm", texture: "t.png" }),
    ).rejects.toThrow("3D spec 为空");
  });

  it("Android Go binding 返回 null（无数据）→ 兜底 null → 抛 3D spec 为空", async () => {
    isViewerModeMock.mockReturnValue(true);
    specMock.mockResolvedValue({ models: [] });
    decodeWasmMock.mockResolvedValue({ geometryRaw: '{"geometry":"x"}' });
    buildSpecMock.mockResolvedValue(null); // Go binding 无数据
    try {
      await expect(
        preloadModel({ _modelPath: "/m/android-empty.ysm", texture: "t.png" }),
      ).rejects.toThrow("3D spec 为空");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("网页版（__YSM_BACKEND__=browser）spec 空 → WASM 兜底成功（P2-2 闭环：纯 TS 移植）", async () => {
    isViewerModeMock.mockReturnValue(true);
    isWebPlatformMock.mockReturnValue(true);
    specMock.mockResolvedValue({ models: [] });
    tsSpecBuilderMock.mockReturnValue(
      JSON.stringify({ models: [{ meshGroups: [{ boneId: "root", positions: [0, 0, 0], normals: [], uvs: [], indices: [] }] }] }),
    );
    decodeWasmMock.mockResolvedValue({ geometryRaw: '{"geometry":"x"}' });
    vi.stubGlobal("Image", FakeImage); // 纹理加载需同步 onload 的 Image mock
    try {
      const r = await preloadModel({ _modelPath: "/m/web.ysm", texture: "t.png" });
      expect(r.spec.models?.length).toBe(1);
      expect(tsSpecBuilderMock).toHaveBeenCalledWith('{"geometry":"x"}'); // 走纯 TS 移植
      expect(buildSpecMock).not.toHaveBeenCalled(); // 网页版不走 Go binding
      expect(decodeWasmMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("网页版 WASM 兜底解码失败 → 仍抛 3D spec 为空（镜像 Android 失败用例）", async () => {
    isViewerModeMock.mockReturnValue(true);
    isWebPlatformMock.mockReturnValue(true);
    specMock.mockResolvedValue({ models: [] });
    decodeWasmMock.mockResolvedValue(null); // 解码失败
    try {
      await expect(
        preloadModel({ _modelPath: "/m/web-fail.ysm", texture: "t.png" }),
      ).rejects.toThrow("3D spec 为空");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("网页版纯 TS 返回 {}（无数据）→ 兜底 null → 抛 3D spec 为空", async () => {
    isViewerModeMock.mockReturnValue(true);
    isWebPlatformMock.mockReturnValue(true);
    specMock.mockResolvedValue({ models: [] });
    decodeWasmMock.mockResolvedValue({ geometryRaw: '{"geometry":"x"}' });
    tsSpecBuilderMock.mockReturnValue("{}"); // 纯 TS 移植无数据
    try {
      await expect(
        preloadModel({ _modelPath: "/m/web-empty.ysm", texture: "t.png" }),
      ).rejects.toThrow("3D spec 为空");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("网页版 WASM 兜底 geometryRaw 为空（\"\"/undefined）→ 兜底 null → 抛 3D spec 为空", async () => {
    isViewerModeMock.mockReturnValue(true);
    isWebPlatformMock.mockReturnValue(true);
    specMock.mockResolvedValue({ models: [] });
    try {
      for (const [i, empty] of (["", undefined] as const).entries()) {
        decodeWasmMock.mockResolvedValue({ geometryRaw: empty });
        await expect(
          preloadModel({ _modelPath: `/m/web-empty-geo-${i}.ysm`, texture: "t.png" }),
        ).rejects.toThrow("3D spec 为空");
      }
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("WASM 路径无 texArrOrder → 契约校验整体跳过，不 warn", async () => {
    specMock.mockResolvedValue(spec()); // texArrOrder undefined（WASM 路径）
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("Image", FakeImage);
    try {
      await preloadModel({
        _modelPath: "/m/wasm.ysm",
        textureNames: ["a.png"],
        texture: "a.png",
      });
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it("成功加载后 → recordLoadTrace 写入 store（3 段：读取/解析/纹理加载）", async () => {
    specMock.mockResolvedValue(spec());
    const model = { _modelPath: "/m/trace.ysm", textures: ["u1.png", "u2.png"], textureNames: ["u1", "u2"], texture: "u1.png" };
    vi.stubGlobal("Image", FakeImage);
    try {
      clearLoadTraces();
      await preloadModel(model);
      const traces = getLoadTraces();
      expect(traces).toHaveLength(1);
      expect(traces[0]!.path).toBe("/m/trace.ysm");
      expect(traces[0]!.format).toBe("other");
      expect(traces[0]!.ok).toBe(true);
      expect(traces[0]!.stages).toHaveLength(3);
      expect(traces[0]!.stages![0]!.name).toBe("读取");
      expect(traces[0]!.stages![1]!.name).toBe("解析");
      expect(traces[0]!.stages![2]!.name).toBe("纹理加载");
      expect(traces[0]!.assets!.textures).toBe(2);
    } finally {
      vi.unstubAllGlobals();
      clearLoadTraces();
    }
  });

  it("LRU：满员（>20）淘汰最久未用首项，被淘汰路径再次访问重新走 GetModel3DSpec", async () => {
    // 兜底 SPEC_CACHE_MAX=20：第 21 个不同路径入缓存时，cacheSpec 淘汰 Map 首项（最久未用）
    specMock.mockResolvedValue(spec());
    vi.stubGlobal("Image", FakeImage);
    try {
      const first = "/m/lru-evict-0.ysm";
      await preloadModel({ _modelPath: first, texture: "t.png" }); // 入缓存（spec 调用 1）
      for (let i = 1; i <= 20; i++) {
        await preloadModel({ _modelPath: `/m/lru-evict-${i}.ysm`, texture: "t.png" }); // 第 21 次触发淘汰首项
      }
      expect(specMock.mock.calls.filter((c) => c[0] === first).length).toBe(1); // 尚未重访
      await preloadModel({ _modelPath: first, texture: "t.png" }); // 已淘汰 → 重新请求
      expect(specMock.mock.calls.filter((c) => c[0] === first).length).toBe(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("LRU：高频命中刷新访问序，重访项不被后续冷数据挤出", async () => {
    // getCachedSpec 读命中 delete+set 刷新到最近 → hot 项在满员后仍存活
    specMock.mockResolvedValue(spec());
    vi.stubGlobal("Image", FakeImage);
    try {
      const hot = "/m/lru-hot.ysm";
      await preloadModel({ _modelPath: hot, texture: "t.png" }); // 入缓存
      for (let i = 1; i <= 19; i++) {
        await preloadModel({ _modelPath: `/m/lru-cold-${i}.ysm`, texture: "t.png" }); // 填满 20
      }
      await preloadModel({ _modelPath: hot, texture: "t.png" }); // 命中 → 刷新到最近
      await preloadModel({ _modelPath: "/m/lru-cold-20.ysm", texture: "t.png" }); // 第 21 次：淘汰最旧冷项，非 hot
      await preloadModel({ _modelPath: hot, texture: "t.png" }); // 仍命中
      expect(specMock.mock.calls.filter((c) => c[0] === hot).length).toBe(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
