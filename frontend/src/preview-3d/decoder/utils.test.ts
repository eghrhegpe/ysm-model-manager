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

// ===== 特征基线（认知复杂度战役 第 3 批）=====
// 补测前实测（istanbul 分支）：≥20B 但无 BOM 的守卫（L51）零命中、
// BOM 有但无 <hash>（L55）零命中（旧用例实际只命中「<20B」长度守卫）、
// 无终止标记时的控制字节扫描命中路径（L79-81）零命中、
// 载荷过短守卫（L91，历史 bug 修复点）零命中、
// 「=== 与 --- 同时存在」的优先级短路（L72 第三操作数）从未求值。
// 本组钉「终止标记优先级 + 载荷切分字节」——切错不崩，只是解密产物错位。
describe("stripYsgpTextHeader 特征基线 — 文本头切分判定（补测前零命中分支）", () => {
  const BOM = [0xef, 0xbb, 0xbf];
  const HASH = "a".repeat(32);
  const ENC = Array.from({ length: 20 }, (_, i) => i + 1);

  /** BOM + [前缀] + 16B hash 区(0xaa) + 加密数据(1..20) */
  function variant(prefix: string): Uint8Array {
    const head = new TextEncoder().encode(prefix);
    const bytes = new Uint8Array(3 + head.length + 16 + ENC.length);
    bytes.set(BOM, 0);
    bytes.set(head, 3);
    bytes.fill(0xaa, 3 + head.length, 3 + head.length + 16);
    bytes.set(ENC, 3 + head.length + 16);
    return bytes;
  }

  it("≥20B 但无 BOM → 原样返回（BOM 守卫，不被长度守卫抢跑）", () => {
    const bytes = new Uint8Array(30).fill(0x41);
    expect(stripYsgpTextHeader(bytes)).toBe(bytes);
  });

  it("BOM + 无 <hash> 标签（≥20B）→ 原样返回", () => {
    const text = "YSGP\n--- [Metadata]\nno hash tag here, just text padding\n";
    const bytes = new Uint8Array(3 + text.length);
    bytes.set(BOM, 0);
    bytes.set(new TextEncoder().encode(text), 3);
    expect(bytes.length).toBeGreaterThan(20);
    expect(stripYsgpTextHeader(bytes)).toBe(bytes);
  });

  it("`===` 早于 `---` → 取 `===`（第一个终止标记胜出），其后 16B 当 hash 区跳过", () => {
    const bytes = variant(`YSGP\n--- [Meta]\n<hash>${HASH}</hash>\n===\n--- [Next]\n------------\n`);
    const out = stripYsgpTextHeader(bytes);
    expect(Array.from(out.slice(0, 4))).toEqual([0x59, 0x53, 0x47, 0x50]);
    const payload = Array.from(out.slice(24));
    // 切点在 `===` 行末：其后的 "--- [Next]\n"（11B）+ 5 个连字符共 16B 被当 hash 区跳过，
    // 故载荷前段残留头部尾文本 → 若错取 `---` 行末，载荷首字节应是 0xaa（hash 区）
    expect(payload.slice(0, 7)).toEqual(new Array(7).fill(0x2d));
    expect(payload[7]).toBe(0x0a);
    expect(payload.slice(8, 24)).toEqual(new Array(16).fill(0xaa));
    expect(payload.slice(24)).toEqual(ENC);
  });

  it("`---` 早于 `===` → 取 `---`（先出现者终止文本头）", () => {
    const bytes = variant(`YSGP\n<hash>${HASH}</hash>\n--- [Meta]\n------------\n===\n`);
    const out = stripYsgpTextHeader(bytes);
    // 切点在 `---` 行末：其后 "===\n"（4B）先被 hash 区窗口吞掉，故载荷前 4B 落在 hash 区
    expect(Array.from(out.slice(24))).toEqual([...new Array(4).fill(0xaa), ...ENC]);
  });

  it("无终止标记但存在二进制控制字节 → 以该字节为载荷起点（含该字节后的 16B hash 区）", () => {
    const head = new TextEncoder().encode(`YSGP\n<hash>${HASH}</hash>\nno terminator\n`);
    const bytes = new Uint8Array(3 + head.length + 1 + 16 + ENC.length);
    bytes.set(BOM, 0);
    bytes.set(head, 3);
    bytes[3 + head.length] = 0x01; // 控制字节 → dataStart 命中
    bytes.fill(0xaa, 3 + head.length + 1, 3 + head.length + 17);
    bytes.set(ENC, 3 + head.length + 17);
    const out = stripYsgpTextHeader(bytes);
    // dataStart = 控制字节所在偏移；V2 跳过其后 16B（15B hash 区 + 末 1B）
    expect(Array.from(out.slice(24))).toEqual([0xaa, ...ENC]);
  });

  it("载荷不足 16B（hash 区都不够）→ 守卫拒绝重建，原样返回（历史 bug 修复点）", () => {
    const head = new TextEncoder().encode(`YSGP\n--- [Meta]\n<hash>${HASH}</hash>\n===\n`);
    const bytes = new Uint8Array(3 + head.length + 10);
    bytes.set(BOM, 0);
    bytes.set(head, 3);
    bytes.set(ENC.slice(0, 10), 3 + head.length);
    expect(stripYsgpTextHeader(bytes)).toBe(bytes);
  });
});
