// @vitest-environment node
// ===== 纹理加载器测试（ADR-136 第四刀随实现迁至 preview-3d）=====
// 覆盖：loadTextures（成功/失败 null 占位保索引）、纹理缓存池复用
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as THREE from "three";

import { FakeImage } from "../test-utils/fake-image.ts";

const { fakeTextureCache } = vi.hoisted(() => ({
  fakeTextureCache: {
    acquire: (_url: string, make: (u: string) => import("three").Texture) => make(_url),
    release: vi.fn(),
    invalidate: vi.fn(),
    disposeAll: () => {},
  },
}));

vi.mock("./texture-cache.ts", () => ({
  textureCache: fakeTextureCache,
}));

import { loadTextures, releaseTextureUrls } from "./texture-loader.ts";

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
      override _failUrls = ["b.png"];
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
      override _failUrls = ["bad.png"];
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

// 审核 C1：loadTextures 的配对释放器——引用归还语义（此前 YSM/女仆路径直接 dispose 纹理，
// 留下 refs 恒 ≥1 的僵尸条目，LRU 淘汰永久失效）。
describe("releaseTextureUrls（审核 C1 引用归还）", () => {
  it("逐 URL 归还引用，空/假值跳过（与 acquire 的 null 占位对称）", () => {
    releaseTextureUrls(["a.png", "", null, undefined, "b.png"]);
    expect(fakeTextureCache.release).toHaveBeenCalledTimes(2);
    expect(fakeTextureCache.release).toHaveBeenNthCalledWith(1, "a.png");
    expect(fakeTextureCache.release).toHaveBeenNthCalledWith(2, "b.png");
  });

  it("重复 URL 按出现次数归还（acquire N 次须 release N 次才能归零）", () => {
    // 多组件共享同一纹理是常态（arm 与 main 共享 skin）：去重会导致 refs 残留
    releaseTextureUrls(["shared.png", "other.png", "shared.png"]);
    expect(fakeTextureCache.release).toHaveBeenCalledTimes(3);
    expect(
      fakeTextureCache.release.mock.calls.filter((c) => c[0] === "shared.png"),
    ).toHaveLength(2);
  });

  it("空清单 / undefined → 不调 release（幂等无副作用）", () => {
    releaseTextureUrls([]);
    releaseTextureUrls(undefined);
    expect(fakeTextureCache.release).not.toHaveBeenCalled();
  });

  it("与 loadTextures 同清单配对 → 引用计数归零（泄漏回归哨兵）", async () => {
    vi.stubGlobal("Image", FakeImage);
    try {
      const urls = ["a.png", "b.png", "a.png"]; // a.png 出现 2 次 = acquire 2 次
      await loadTextures(urls);
      releaseTextureUrls(urls);
      const released = fakeTextureCache.release.mock.calls.map((c) => c[0]);
      expect(released.sort()).toEqual(["a.png", "a.png", "b.png"]);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
