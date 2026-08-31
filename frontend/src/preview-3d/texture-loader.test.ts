// @vitest-environment node
// ===== 纹理加载器测试（ADR-136 第四刀随实现迁至 preview-3d）=====
// 覆盖：loadTextures（成功/失败 null 占位保索引）、纹理缓存池复用
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as THREE from "three";

import { FakeImage } from "../test-utils/fake-image.ts";

const { fakeTextureCache } = vi.hoisted(() => ({
  fakeTextureCache: {
    acquire: (_url: string, make: (u: string) => import("three").Texture) => make(_url),
    release: () => {},
    invalidate: vi.fn(),
    disposeAll: () => {},
  },
}));

vi.mock("./texture-cache.ts", () => ({
  textureCache: fakeTextureCache,
}));

import { loadTextures } from "./texture-loader.ts";

beforeEach(() => {
  vi.clearAllMocks();
  delete (globalThis as Record<string, unknown>)["__YSM_BACKEND__"];
});

describe("loadTextures", () => {
  it("空/无 urls → 空数组", async () => {
    expect(await loadTextures([])).toEqual([]);
    expect(await loadTextures(undefined)).toEqual([]);
  });

  it("全部加载成功 → THREE.Texture 数组（flipY=false、userData 尺寸）", async () => {
    vi.stubGlobal("Image", FakeImage);
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
      _failUrls = ["b.png"];
    }
    vi.stubGlobal("Image", PartialImage);
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

  it("失败纹理 → invalidate 触发（缓存池清理失败项）", async () => {
    class FailImage extends FakeImage {
      _failUrls = ["bad.png"];
    }
    vi.stubGlobal("Image", FailImage);
    try {
      const texArr = await loadTextures(["bad.png"]);
      expect(texArr[0]).toBeNull();
      expect(fakeTextureCache.invalidate).toHaveBeenCalledWith("bad.png");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
