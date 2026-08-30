import * as THREE from "three";
import { describe, expect, it, vi, afterEach } from "vitest";
import { AlphaIndex } from "./alpha-index.ts";
import { getTextureAlphaInfo, getTextureAlphaMode } from "./texture-alpha.ts";

function rgbaTexture(pixels: number[][]): THREE.DataTexture {
  const data = new Uint8Array(pixels.length * 4);
  pixels.forEach((px, i) => data.set(px, i * 4));
  return new THREE.DataTexture(data, pixels.length, 1);
}

describe("getTextureAlphaMode", () => {
  it("classifies fully opaque textures as opaque", () => {
    const tex = rgbaTexture([
      [10, 20, 30, 255],
      [40, 50, 60, 255],
      [70, 80, 90, 255],
      [0, 0, 0, 255],
    ]);
    expect(getTextureAlphaMode(tex)).toBe("opaque");
  });

  it("classifies binary alpha with holes as cutout", () => {
    const tex = rgbaTexture([
      [10, 20, 30, 255],
      [40, 50, 60, 0],
      [70, 80, 90, 255],
      [0, 0, 0, 255],
    ]);
    expect(getTextureAlphaMode(tex)).toBe("cutout");
  });

  it("classifies dense semi-transparent textures as blend", () => {
    const tex = rgbaTexture([
      [10, 20, 30, 128],
      [40, 50, 60, 128],
      [70, 80, 90, 128],
      [0, 0, 0, 255],
    ]);
    expect(getTextureAlphaMode(tex)).toBe("blend");
  });

  it("treats stray semi-transparent noise under threshold as cutout", () => {
    const tex = rgbaTexture(
      Array.from({ length: 512 }, (_, i) =>
        i === 0
          ? [10, 20, 30, 128]
          : i % 8 === 7
            ? [40, 50, 60, 0]
            : [0, 0, 0, 255],
      ),
    );
    expect(getTextureAlphaMode(tex)).toBe("cutout");
  });

  it("keeps blend when semi-transparent ratio exceeds threshold", () => {
    const tex = rgbaTexture(
      Array.from({ length: 50 }, (_, i) =>
        i < 4 ? [10, 20, 30, 128] : [0, 0, 0, 255],
      ),
    );
    // 4/50 = 8% 半透明 > 5% 阈值 → blend
    expect(getTextureAlphaMode(tex)).toBe("blend");
  });

  it("caches the classification in userData", () => {
    const tex = rgbaTexture([
      [10, 20, 30, 255],
      [40, 50, 60, 255],
    ]);
    expect(getTextureAlphaMode(tex)).toBe("opaque");
    (tex.image as { data: Uint8Array }).data.fill(128);
    expect(getTextureAlphaMode(tex)).toBe("opaque");
  });
});

describe("getTextureAlphaInfo", () => {
  it("returns mode plus face-query index for RGBA data textures", () => {
    const tex = rgbaTexture([
      [10, 20, 30, 0],
      [40, 50, 60, 128],
    ]);
    const info = getTextureAlphaInfo(tex);
    expect(info.mode).toBe("blend");
    expect(info.index).toBeInstanceOf(AlphaIndex);
    expect(info.width).toBe(2);
    expect(info.height).toBe(1);
  });

  it("returns null index when pixels are unreadable", () => {
    const tex = new THREE.DataTexture(new Uint8Array(16), 2, 2);
    (tex as unknown as { format: THREE.PixelFormat }).format = THREE.RGBFormat;
    const info = getTextureAlphaInfo(tex);
    expect(info.index).toBeNull();
    // 像素不可读回退 opaque：避免 taint/跨域源整模型被误判全透明（导致硬实部件丢失）
    expect(info.mode).toBe("opaque");
  });

  it("caches one info object per texture", () => {
    const tex = rgbaTexture([
      [10, 20, 30, 255],
      [40, 50, 60, 0],
    ]);
    expect(getTextureAlphaInfo(tex)).toBe(getTextureAlphaInfo(tex));
  });
});

// ===== 覆盖率补强：非 DataTexture 路径（image null / canvas 2d 采样 / 容错）=====
describe("getTextureAlphaMode — readRgbaPixels 非 data 路径", () => {
  it("image 缺失 → 像素不可读回退 opaque（index null）", () => {
    const tex = new THREE.Texture(); // image 默认 undefined
    const info = getTextureAlphaInfo(tex);
    expect(info.mode).toBe("opaque");
    expect(info.index).toBeNull();
  });

  function stubCanvas(
    getImageData: () => { data: Uint8ClampedArray; width: number; height: number } | never,
    opts: { ctxNull?: boolean; drawThrows?: boolean } = {},
  ): void {
    const ctx = {
      drawImage: () => {
        if (opts.drawThrows) throw new Error("tainted");
      },
      getImageData,
    };
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => (opts.ctxNull ? null : ctx),
    };
    // 捕获原始 createElement（审核修复）：spy 替换后 fallback 若调 document.createElement
    // 会递归进 mock 自身直到栈溢出（当前 SUT 只请求 canvas 故潜伏）——对齐
    // environment-capability / vrm-adapter 既有 stub 的安全模式。
    const origCreate = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation(((tag: string) => {
      if (tag === "canvas") return canvas as unknown as HTMLCanvasElement;
      return origCreate(tag as keyof HTMLElementTagNameMap);
    }) as typeof document.createElement);
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("HTMLImage 形态 image → canvas 2d 缩小采样并按像素分类（blend）", () => {
    stubCanvas(() => ({
      // 2x2：3 个不透明 + 1 个半透明 → 25% > 5% → blend
      data: new Uint8ClampedArray([
        10, 20, 30, 255, 40, 50, 60, 255,
        70, 80, 90, 255, 0, 0, 0, 128,
      ]),
      width: 2,
      height: 2,
    }));
    const tex = new THREE.Texture();
    tex.image = { naturalWidth: 1024, naturalHeight: 1024 } as unknown as HTMLImageElement;
    expect(getTextureAlphaMode(tex)).toBe("blend");
    // 采样封顶 256px
    const info = getTextureAlphaInfo(tex)!;
    expect(info.width).toBe(256);
    expect(info.height).toBe(256);
  });

  it("canvas getContext 返回 null → 回退 opaque", () => {
    stubCanvas((() => ({})) as unknown as Parameters<typeof stubCanvas>[0], { ctxNull: true });
    const tex = new THREE.Texture();
    tex.image = { naturalWidth: 64, naturalHeight: 64 } as unknown as HTMLImageElement;
    expect(getTextureAlphaMode(tex)).toBe("opaque");
  });

  it("drawImage 抛错（tainted）→ catch 回退 opaque（保持渲染）", () => {
    stubCanvas((() => ({})) as unknown as Parameters<typeof stubCanvas>[0], { drawThrows: true });
    const tex = new THREE.Texture();
    tex.image = { naturalWidth: 64, naturalHeight: 64 } as unknown as HTMLImageElement;
    expect(getTextureAlphaMode(tex)).toBe("opaque");
  });
});
