// ===== 预览共享工具纯函数测试 =====
// stripYsgpTextHeader：BOM/hash 检测、YSGP V2/V3 重建、无 BOM/过短/无 hash 原样返回。
// getPrefer3D / setPrefer3D：模块级偏好状态单例。
import { describe, it, expect, beforeEach } from "vitest";
import { stripYsgpTextHeader, getPrefer3D, setPrefer3D } from "./preview-utils.ts";

/** 构造「BOM + <hash> + </ysm> 文本头 + 加密数据」的变体字节流 */
function buildYsgpVariant(encLen = 20): Uint8Array {
  const header = "<hash>" + "a".repeat(32) + "</hash></ysm>";
  const enc = new Uint8Array(encLen).map((_, i) => i + 1);
  const bytes = new Uint8Array(3 + header.length + encLen);
  bytes.set([0xef, 0xbb, 0xbf], 0); // UTF-8 BOM
  bytes.set(new TextEncoder().encode(header), 3);
  bytes.set(enc, 3 + header.length);
  return bytes;
}

describe("stripYsgpTextHeader", () => {
  it("无 BOM 的二进制数据原样返回", () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(stripYsgpTextHeader(bytes)).toBe(bytes);
  });

  it("过短数据（<10 字节）原样返回", () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    expect(stripYsgpTextHeader(bytes)).toBe(bytes);
  });

  it("有 BOM 但无 hash 标签 → 原样返回", () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(stripYsgpTextHeader(bytes)).toBe(bytes);
  });

  it("BOM + hash + </ysm> 文本头 → 重建为 YSGP V2（magic + ver2 + hash 区 + 加密尾）", () => {
    const bytes = buildYsgpVariant(20);
    const out = stripYsgpTextHeader(bytes);
    // magic "YSGP"
    expect(Array.from(out.slice(0, 4))).toEqual([0x59, 0x53, 0x47, 0x50]);
    // version = 2
    expect(Array.from(out.slice(4, 8))).toEqual([0, 0, 0, 2]);
    // 16B hash 区：从 "aa" 十六进制对解析为 0xAA
    expect(Array.from(out.slice(8, 24)).every((b) => b === 0xaa)).toBe(true);
    // 加密数据非空
    expect(out.length).toBeGreaterThan(24);
  });

  it("forceVer=3 → 版本字节为 3 且无独立 hash 区（加密数据更长）", () => {
    const bytes = buildYsgpVariant(20);
    const v2 = stripYsgpTextHeader(bytes);
    const v3 = stripYsgpTextHeader(bytes, 3);
    expect(Array.from(v3.slice(4, 8))).toEqual([0, 0, 0, 3]);
    expect(Array.from(v3.slice(0, 4))).toEqual([0x59, 0x53, 0x47, 0x50]);
    // V3 从 dataStart 直接取加密数据（含 V2 的 hash 区），整体更长
    expect(v3.length).toBeGreaterThan(v2.length);
  });
});

describe("getPrefer3D / setPrefer3D", () => {
  beforeEach(() => setPrefer3D(false));

  it("默认 false", () => {
    expect(getPrefer3D()).toBe(false);
  });

  it("set 后 get 生效", () => {
    setPrefer3D(true);
    expect(getPrefer3D()).toBe(true);
    setPrefer3D(false);
    expect(getPrefer3D()).toBe(false);
  });
});
