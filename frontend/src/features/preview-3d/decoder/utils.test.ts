// @vitest-environment node
// ===== YSM 解码子系统共享工具纯函数测试（ADR-137 第五刀随实现迁至 decoder）=====
// stripYsgpTextHeader：BOM/hash 检测、YSGP V2/V3 重建、无 BOM/过短/无 hash 原样返回。
import { describe, it, expect } from "vitest";
import { stripYsgpTextHeader } from "./utils.ts";

/** 构造「BOM + 行式文本头（含 <hash> + === 终止）+ 16B hash 区 + 加密数据」的 V2/V3 变体 */
function buildYsgpVariant(encLen = 20, sep = "==="): Uint8Array {
  const header =
    "YSGP\n--- [Metadata]\n<hash>" +
    "a".repeat(32) +
    "</hash>\n" +
    (sep === "===" ? "===\n" : sep + "\n");
  const enc = new Uint8Array(encLen).map((_, i) => i + 1);
  const bytes = new Uint8Array(3 + header.length + 16 + encLen);
  bytes.set([0xef, 0xbb, 0xbf], 0); // UTF-8 BOM
  bytes.set(new TextEncoder().encode(header), 3);
  bytes.fill(0xaa, 3 + header.length, 3 + header.length + 16); // V2 独立 16B hash 区
  bytes.set(enc, 3 + header.length + 16);
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

  it("BOM + 行式文本头 + === 终止 → 重建为 YSGP V2（magic + ver2 + hash 区 + 加密尾）", () => {
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

  it("P2 回归：加密载荷不含文本头（=== 标记后正确切分）", () => {
    const bytes = buildYsgpVariant(20);
    const out = stripYsgpTextHeader(bytes);
    // dataStart = 文本头 + `===\n` 之后；V2 再跳过 16B hash 区 → 载荷应恰为 [1..20]
    expect(Array.from(out.slice(24))).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
  });

  it("forceVer=3 → 版本字节为 3 且无独立 hash 区（加密数据更长）", () => {
    const bytes = buildYsgpVariant(20);
    const v2 = stripYsgpTextHeader(bytes);
    const v3 = stripYsgpTextHeader(bytes, 3);
    expect(Array.from(v3.slice(4, 8))).toEqual([0, 0, 0, 3]);
    expect(Array.from(v3.slice(0, 4))).toEqual([0x59, 0x53, 0x47, 0x50]);
    // V3 从 dataStart 直接取加密数据（含 V2 的 hash 区），整体更长
    expect(v3.length).toBeGreaterThan(v2.length);
    // V3 载荷 = hash 区(0xaa×16) + 原加密数据
    expect(Array.from(v3.slice(24))).toEqual([
      ...new Array(16).fill(0xaa),
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
    ]);
  });

  it("连续 ---（无 [，≥10 字符）分隔行终止文本头 → 同样正确重建", () => {
    const bytes = buildYsgpVariant(20, "-".repeat(12));
    const out = stripYsgpTextHeader(bytes);
    expect(Array.from(out.slice(0, 4))).toEqual([0x59, 0x53, 0x47, 0x50]);
    expect(Array.from(out.slice(24))).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
  });

  it("有 BOM + hash 但为纯文本（无终止标记也无二进制控制字节）→ 原样返回不重建", () => {
    const header = "YSGP\n--- [Metadata]\n<hash>" + "a".repeat(32) + "</hash>\n";
    const bytes = new Uint8Array(3 + header.length);
    bytes.set([0xef, 0xbb, 0xbf], 0);
    bytes.set(new TextEncoder().encode(header), 3);
    expect(stripYsgpTextHeader(bytes)).toBe(bytes);
  });
});
