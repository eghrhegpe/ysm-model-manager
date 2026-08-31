// ===== KTX2 直载纹理 loader 单元测试 =====
// 覆盖：缓存命中→KTX2 直载、未命中/读取失败/KTX2 解码失败→回退原 loader、toon 排除、占位纹理一致性。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as THREE from "three";
import { Ktx2TextureLoader, type Ktx2TextureLoaderDeps } from "./mmd-ktx2-texture-loader.ts";

function makeDeps(overrides: Partial<Ktx2TextureLoaderDeps> = {}): Ktx2TextureLoaderDeps & {
  fallbackLoad: ReturnType<typeof vi.fn>;
  ktx2LoadAsync: ReturnType<typeof vi.fn>;
  getCached: ReturnType<typeof vi.fn>;
  resolveHash: (url: string) => string | undefined;
} {
  const fallbackLoad = vi.fn((_url: string, onLoad?: (t: THREE.Texture) => void) => {
    const t = new THREE.Texture();
    t.image = { width: 4, height: 4 }; // 模拟 PNG 解码后的 image（默认 null，合并断言需要）
    if (onLoad) onLoad(t);
    return t;
  });
  const ktx2LoadAsync = vi.fn().mockResolvedValue(new THREE.CompressedTexture([], 0, 0));
  const getCached = vi.fn().mockResolvedValue("a2t4a2t4a2t4a2t4a2t4a2t4a2t4a2t4a2t4a2t4a2t4a2t4a2t4a2t4a2t4"); // 假 base64
  const resolveHash = vi.fn((url: string) => (url.includes("ziyan_body") ? "hash123" : undefined));
  return {
    resolveHash,
    getCachedTextureByHash: getCached,
    ktx2Loader: { loadAsync: ktx2LoadAsync },
    fallbackLoader: { load: fallbackLoad } as unknown as THREE.TextureLoader,
    fallbackLoad,
    ktx2LoadAsync,
    getCached,
    ...overrides,
  };
}

describe("Ktx2TextureLoader", () => {
  beforeEach(() => {
    // URL.createObjectURL mock（浏览器外不可用）
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn(() => "blob:mock-ktx2"),
      revokeObjectURL: vi.fn(),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("resolveHash 命中 + 缓存存在 → KTX2 直载（onLoad 收到 CompressedTexture）", async () => {
    const deps = makeDeps();
    const loader = new Ktx2TextureLoader(deps);
    const onLoad = vi.fn();

    loader.load("textures/ziyan_body.png", onLoad);
    await vi.waitFor(() => expect(deps.ktx2LoadAsync).toHaveBeenCalled());

    expect(deps.getCached).toHaveBeenCalledWith("hash123");
    expect(deps.ktx2LoadAsync).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(onLoad).toHaveBeenCalled());
    const tex = onLoad.mock.calls[0][0] as THREE.CompressedTexture;
    expect(tex.isCompressedTexture).toBe(true);
    // 直载路径不触碰 fallback
    expect(deps.fallbackLoad).not.toHaveBeenCalled();
  });

  it("resolveHash 未命中 → 回退原 loader", () => {
    const deps = makeDeps();
    const loader = new Ktx2TextureLoader(deps);
    const onLoad = vi.fn();

    const tex = loader.load("textures/ziyan_hair.png", onLoad);

    expect(deps.fallbackLoad).toHaveBeenCalledTimes(1);
    expect(deps.getCached).not.toHaveBeenCalled();
    // fallback 返回原 Texture（非压缩纹理：isCompressedTexture 不是 true）
    expect((tex as THREE.CompressedTexture).isCompressedTexture).not.toBe(true);
  });

  it("缓存读取返回 null → 回退且合并进占位（onLoad 与 load 返回值同一对象）", async () => {
    const deps = makeDeps({ getCachedTextureByHash: vi.fn().mockResolvedValue(null) });
    const loader = new Ktx2TextureLoader(deps);
    const onLoad = vi.fn();

    const returned = loader.load("textures/ziyan_body.png", onLoad);
    await vi.waitFor(() => expect(onLoad).toHaveBeenCalled());

    expect(deps.ktx2LoadAsync).not.toHaveBeenCalled();
    // 关键：回退结果合并进占位，材质 map（load 返回值）始终是有数据的同一对象
    const loaded = onLoad.mock.calls[0][0] as THREE.Texture;
    expect(returned).toBe(loaded);
    expect((loaded as unknown as { isCompressedTexture: boolean }).isCompressedTexture).toBe(false);
    expect(loaded.image).toBeTruthy(); // PNG 数据已合并
  });

  it("KTX2 解码失败 → 回退且合并进占位", async () => {
    const decodeFail = vi.fn().mockRejectedValue(new Error("decode fail"));
    const deps = makeDeps({ ktx2Loader: { loadAsync: decodeFail } });
    const loader = new Ktx2TextureLoader(deps);
    const onLoad = vi.fn();

    const returned = loader.load("textures/ziyan_body.png", onLoad);
    await vi.waitFor(() => expect(onLoad).toHaveBeenCalled());

    expect(decodeFail).toHaveBeenCalledTimes(1);
    expect(deps.fallbackLoad).toHaveBeenCalledTimes(1);
    // 回退结果合并进占位：onLoad 与 load 返回值同一对象，材质 map 不悬空
    const loaded = onLoad.mock.calls[0][0] as THREE.Texture;
    expect(returned).toBe(loaded);
    expect(loaded.image).toBeTruthy();
  });

  it("toon 路径不直载（resolveHash 返回 undefined 即回退）", () => {
    const deps = makeDeps({
      // toon 由 resolveHash 排除：返回 undefined
      resolveHash: vi.fn(() => undefined),
    });
    const loader = new Ktx2TextureLoader(deps);

    loader.load("toon/cloth.png", vi.fn());

    expect(deps.fallbackLoad).toHaveBeenCalledTimes(1);
    expect(deps.getCached).not.toHaveBeenCalled();
  });

  it("直载时占位纹理与 onLoad 同一对象（材质引用一致性）", async () => {
    const deps = makeDeps();
    const loader = new Ktx2TextureLoader(deps);
    const onLoad = vi.fn();

    const returned = loader.load("textures/ziyan_body.png", onLoad);
    await vi.waitFor(() => expect(onLoad).toHaveBeenCalled());

    const loaded = onLoad.mock.calls[0][0] as THREE.Texture;
    expect(returned).toBe(loaded);
  });
});
