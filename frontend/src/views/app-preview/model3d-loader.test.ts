// ===== 3D 模型加载器测试 =====
// 覆盖：loadTextures（成功/失败 null 占位保索引）、fetchSpec LRU 缓存、
// preloadModel R1 纹理序契约校验（texArrOrder vs textureNames 不一致 warn）
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as THREE from "three";

const { getAppMock, specMock } = vi.hoisted(() => ({
  getAppMock: vi.fn(),
  specMock: vi.fn(),
}));

vi.mock("../../wails/app.ts", () => ({
  getApp: getAppMock,
}));

import { loadTextures, preloadModel } from "./model3d-loader.ts";

/** 可控 Image：src setter 同步触发 onload/onerror（happy-dom 无真实网络） */
class FakeImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  naturalWidth = 64;
  naturalHeight = 32;
  _src = "";
  _fail = false;
  set src(u: string) {
    this._src = u;
    if (this._fail) this.onerror?.();
    else this.onload?.();
  }
  get src(): string {
    return this._src;
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  getAppMock.mockResolvedValue({ GetModel3DSpec: specMock });
});

describe("loadTextures", () => {
  it("空/无 urls → 空数组", async () => {
    expect(await loadTextures([])).toEqual([]);
    expect(await loadTextures(undefined)).toEqual([]);
  });

  it("全部加载成功 → THREE.Texture 数组（flipY=false、userData 尺寸）", async () => {
    vi.stubGlobal("Image", FakeImage as never);
    try {
      const texArr = await loadTextures(["a.png", "b.png"]);
      expect(texArr).toHaveLength(2);
      expect(texArr[0]).toBeInstanceOf(THREE.Texture);
      expect(texArr[0]!.flipY).toBe(false);
      expect(texArr[0]!.userData.imgWidth).toBe(64);
      expect(texArr[1]).toBeInstanceOf(THREE.Texture);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("部分失败 → null 占位且索引不压缩（后续组件贴纹理不错位）", async () => {
    class PartialImage extends FakeImage {
      // b.png 加载失败
      set src(u: string) {
        this._src = u;
        if (u === "b.png") this.onerror?.();
        else this.onload?.();
      }
    }
    vi.stubGlobal("Image", PartialImage as never);
    try {
      const texArr = await loadTextures(["a.png", "b.png", "c.png"]);
      expect(texArr).toHaveLength(3);
      expect(texArr[0]).toBeInstanceOf(THREE.Texture);
      expect(texArr[1]).toBeNull(); // 失败占位，不 filter
      expect(texArr[2]).toBeInstanceOf(THREE.Texture);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("preloadModel / fetchSpec", () => {
  const spec = (texArrOrder?: string[]) =>
    JSON.stringify({
      models: [{ meshGroups: [{ boneId: "root", positions: [0, 0, 0], normals: [], uvs: [], indices: [] }] }],
      texArrOrder,
    });

  it("同一路径二次调用 → GetModel3DSpec 只调一次（LRU 缓存命中）", async () => {
    specMock.mockResolvedValue(spec());
    const model = { _modelPath: "/m/lru.ysm", texture: "t.png" };
    vi.stubGlobal("Image", FakeImage as never);
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
    vi.stubGlobal("Image", FakeImage as never);
    try {
      await preloadModel({
        _modelPath: "/m/r1-mismatch.ysm",
        textureNames: ["a.png", "b.png"],
        texture: "a.png",
      });
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("[model3d] R1 纹理序不一致"),
      );
    } finally {
      warn.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it("R1 契约：顺序一致 → 不 warn", async () => {
    specMock.mockResolvedValue(spec(["a.png", "b.png"]));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("Image", FakeImage as never);
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

  it("spec 无 models → 抛错（fetchSpec 空 spec 守卫）", async () => {
    specMock.mockResolvedValue(JSON.stringify({ models: [] }));
    await expect(
      preloadModel({ _modelPath: "/m/empty.ysm", texture: "t.png" }),
    ).rejects.toThrow("3D spec 为空");
  });

  it("WASM 路径无 texArrOrder → 契约校验整体跳过，不 warn", async () => {
    specMock.mockResolvedValue(spec()); // texArrOrder undefined（WASM 路径）
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("Image", FakeImage as never);
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
});
