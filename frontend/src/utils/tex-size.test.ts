// ===== sniffTexSize 公共单元测试（从 stats-core.test.ts 迁入）=====
// 口径对齐 Go imagePixelArea / wasm.ts，勿单独改。
import { describe, expect, it } from "vitest";
import { sniffTexSize } from "./tex-size.ts";
import { pngBytes, jpgBytes } from "../test-utils/tex-bytes.ts";

describe("utils.tex-size.sniffTexSize（对齐 Go imagePixelArea / wasm.ts 嗅探口径）", () => {
  it("PNG 签名 + IHDR 宽高", () => {
    expect(sniffTexSize(pngBytes(128, 64))).toEqual({ w: 128, h: 64 });
    expect(sniffTexSize(pngBytes(16, 16))).toEqual({ w: 16, h: 16 });
  });

  it("JPEG SOI + SOF0 段宽高", () => {
    expect(sniffTexSize(jpgBytes(512, 256))).toEqual({ w: 512, h: 256 });
  });

  it("非图片 / 空输入返回 null", () => {
    expect(sniffTexSize(new Uint8Array(0))).toBeNull();
    expect(sniffTexSize(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(sniffTexSize(new TextEncoder().encode("not an image at all!"))).toBeNull();
  });
});
