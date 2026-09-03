// @vitest-environment node
// ===== extract.ts 契约测试 =====
// 覆盖：detectContainerType / parseZipCentralDir / extractZip / GBK 解码
import { describe, it, expect } from "vitest";
import {
  detectContainerType,
  parseZipCentralDir,
  extractZip,
} from "./extract.ts";

// --- ZIP 构造工具 ---

/** ZIP entry 的二进制段 */
interface ZipEntryParts {
  lfh: Uint8Array;
  cde: Uint8Array;
  nameBytes: Uint8Array;
  data: Uint8Array;
}

/** 构造单个 ZIP entry 的 LFH + CDE（STORE 压缩） */
function buildZipEntry(
  nameBytes: Uint8Array,
  data: Uint8Array,
  opts: { utf8?: boolean; uncompressedSize?: number; localHeaderOffset?: number } = {},
): ZipEntryParts {
  const gpf = opts.utf8 ? 0x800 : 0;
  const uncompressedSize = opts.uncompressedSize ?? data.length;
  const localHeaderOffset = opts.localHeaderOffset ?? 0;

  // Local File Header (30 + nameLen + extraLen(0) + dataSize)
  const lfh = new Uint8Array(30);
  const lfhDv = new DataView(lfh.buffer);
  lfhDv.setUint32(0, 0x04034b50, true); // signature
  lfhDv.setUint16(4, 20, true); // version needed
  lfhDv.setUint16(6, gpf, true); // gpf
  lfhDv.setUint16(8, 0, true); // compression (STORE)
  lfhDv.setUint16(14, 0, true); // mod time
  lfhDv.setUint16(16, 0, true); // mod date
  lfhDv.setUint32(18, data.length, true); // compressed size
  lfhDv.setUint32(22, uncompressedSize, true); // uncompressed size
  lfhDv.setUint16(26, nameBytes.length, true); // name length
  lfhDv.setUint16(28, 0, true); // extra length

  // Central Directory Entry (46 + nameLen + extraLen(0) + commentLen(0))
  const cde = new Uint8Array(46);
  const cdeDv = new DataView(cde.buffer);
  cdeDv.setUint32(0, 0x02014b50, true); // signature
  cdeDv.setUint16(4, 20, true); // version made by
  cdeDv.setUint16(6, 20, true); // version needed
  cdeDv.setUint16(8, gpf, true); // gpf
  cdeDv.setUint16(10, 0, true); // compression
  cdeDv.setUint16(12, 0, true); // mod time
  cdeDv.setUint16(14, 0, true); // mod date
  cdeDv.setUint32(16, 0, true); // crc32
  cdeDv.setUint32(20, data.length, true); // compressed size
  cdeDv.setUint32(24, uncompressedSize, true); // uncompressed size
  cdeDv.setUint16(28, nameBytes.length, true); // name length
  cdeDv.setUint16(30, 0, true); // extra length
  cdeDv.setUint16(32, 0, true); // comment length
  cdeDv.setUint16(34, 0, true); // disk number
  cdeDv.setUint16(36, 0, true); // internal attrs
  cdeDv.setUint32(38, 0, true); // external attrs
  cdeDv.setUint32(42, localHeaderOffset, true); // local header offset

  return { lfh, cde, nameBytes, data };
}

/** 构造 End of Central Directory（22 bytes） */
function buildEocd(opts: { totalEntries?: number; cdeSize?: number; cdeOffset?: number } = {}): Uint8Array {
  const totalEntries = opts.totalEntries ?? 1;
  const eocd = new Uint8Array(22);
  const eocdDv = new DataView(eocd.buffer);
  eocdDv.setUint32(0, 0x06054b50, true); // signature
  eocdDv.setUint16(4, 0, true); // disk number
  eocdDv.setUint16(6, 0, true); // start disk
  eocdDv.setUint16(8, totalEntries, true); // entries on disk
  eocdDv.setUint16(10, totalEntries, true); // total entries
  eocdDv.setUint32(12, opts.cdeSize ?? 0, true); // CDE size
  eocdDv.setUint32(16, opts.cdeOffset ?? 0, true); // CDE offset
  eocdDv.setUint16(20, 0, true); // comment length
  return eocd;
}

/** 按 ZIP 布局组装：所有 local entries 在前，随后集中写入 central directory，最后 EOCD */
function assembleZip(parts: ZipEntryParts[], eocd: Uint8Array): Uint8Array {
  const total = parts.reduce(
    (sum, p) => sum + p.lfh.length + p.nameBytes.length + p.data.length + p.cde.length + p.nameBytes.length,
    eocd.length,
  );
  const zip = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    zip.set(p.lfh, offset); offset += p.lfh.length;
    zip.set(p.nameBytes, offset); offset += p.nameBytes.length;
    zip.set(p.data, offset); offset += p.data.length;
  }
  for (const p of parts) {
    zip.set(p.cde, offset); offset += p.cde.length;
    zip.set(p.nameBytes, offset); offset += p.nameBytes.length;
  }
  zip.set(eocd, offset);
  return zip;
}

/** 构造最小 ZIP：STORE 压缩，单个 entry */
function buildMinimalZip(name: string, data: Uint8Array, utf8Flag: boolean = false): Uint8Array {
  return buildZipWithNameBytes(new TextEncoder().encode(name), data, { utf8: utf8Flag });
}

/** 构造单 entry ZIP；可传原始文件名字节，或覆盖 uncompressedSize 用于边界测试 */
function buildZipWithNameBytes(
  nameBytes: Uint8Array,
  data: Uint8Array,
  opts: { utf8?: boolean; uncompressedSize?: number } = {},
): Uint8Array {
  const part = buildZipEntry(nameBytes, data, opts);
  const eocd = buildEocd({
    cdeSize: part.cde.length + part.nameBytes.length,
    cdeOffset: part.lfh.length + part.nameBytes.length + part.data.length,
  });
  return assembleZip([part], eocd);
}

/** 构造含多 entry 的 ZIP */
function buildMultiEntryZip(entries: Array<{ name: string; data: Uint8Array; utf8?: boolean }>): Uint8Array {
  const parts: ZipEntryParts[] = [];
  let localHeaderOffset = 0;

  for (const entry of entries) {
    const part = buildZipEntry(new TextEncoder().encode(entry.name), entry.data, {
      ...(entry.utf8 !== undefined ? { utf8: entry.utf8 } : {}),
      localHeaderOffset,
    });
    parts.push(part);
    localHeaderOffset += part.lfh.length + part.nameBytes.length + part.data.length;
  }

  const cdeSize = parts.reduce((sum, p) => sum + p.cde.length + p.nameBytes.length, 0);
  const eocd = buildEocd({
    totalEntries: entries.length,
    cdeSize,
    cdeOffset: localHeaderOffset,
  });
  return assembleZip(parts, eocd);
}

// --- detectContainerType ---

describe("detectContainerType", () => {
  it("含 ysm.json 的 ZIP → ysm", () => {
    const zip = buildMinimalZip("ysm.json", new TextEncoder().encode("{}"));
    expect(detectContainerType(zip)).toBe("ysm");
  });

  it("含 models/ 前缀的 ZIP → ysm", () => {
    const zip = buildMinimalZip("models/main.json", new TextEncoder().encode("{}"));
    expect(detectContainerType(zip)).toBe("ysm");
  });

  it("含 pack.mcmeta 的 ZIP → resourcepack", () => {
    const zip = buildMinimalZip("pack.mcmeta", new TextEncoder().encode("{}"));
    expect(detectContainerType(zip)).toBe("resourcepack");
  });

  it("含 shaders/ 前缀的 ZIP → shaderpack", () => {
    const zip = buildMinimalZip("shaders/minecraft.json", new TextEncoder().encode("{}"));
    expect(detectContainerType(zip)).toBe("shaderpack");
  });

  it("蓝图/投影/MMD/VRC 后缀指纹（ADR-066 web 识别层）", () => {
    expect(detectContainerType(buildMinimalZip("schematics/main.nbt", new TextEncoder().encode("x")))).toBe("blueprint");
    expect(detectContainerType(buildMinimalZip("a/build.schematic", new TextEncoder().encode("x")))).toBe("blueprint");
    expect(detectContainerType(buildMinimalZip("project/a.litematic", new TextEncoder().encode("x")))).toBe("litematic");
    expect(detectContainerType(buildMinimalZip("model/a.pmx", new TextEncoder().encode("x")))).toBe("EntityPlayer");
    expect(detectContainerType(buildMinimalZip("avatar/a.vrm", new TextEncoder().encode("x")))).toBe("EntityPlayer"); // ADR-111: .vrm 是 EntityPlayer 的 variant
  });

  it("无可识别文件的 ZIP → null（识别不出就是识别不出，不假装 YSM）", () => {
    const zip = buildMinimalZip("readme.txt", new Uint8Array([0x52, 0x45, 0x41, 0x44]));
    expect(detectContainerType(zip)).toBeNull();
  });

  it("多 entry 优先命中首个识别特征", () => {
    const zip = buildMultiEntryZip([
      { name: "readme.txt", data: new Uint8Array(4) },
      { name: "ysm.json", data: new Uint8Array(2) },
    ]);
    expect(detectContainerType(zip)).toBe("ysm");
  });
});

// --- parseZipCentralDir ---

describe("parseZipCentralDir", () => {
  it("UTF-8 文件名（gpf bit 11 设）→ fflateKey 正确", () => {
    const zip = buildMinimalZip("ysm.json", new Uint8Array(2), true);
    const metas = parseZipCentralDir(zip);
    expect(metas).toHaveLength(1);
    expect(metas[0].fflateKey).toBe("ysm.json");
    expect(metas[0].gpfUtf8).toBe(true);
  });

  it("Latin-1 文件名（gpf bit 11 未设）→ fflateKey = Latin-1 解码", () => {
    const zip = buildMinimalZip("ysm.json", new Uint8Array(2), false);
    const metas = parseZipCentralDir(zip);
    expect(metas).toHaveLength(1);
    expect(metas[0].fflateKey).toBe("ysm.json");
    expect(metas[0].gpfUtf8).toBe(false);
  });

  it("多 entry 全部解析", () => {
    const zip = buildMultiEntryZip([
      { name: "ysm.json", data: new Uint8Array(2) },
      { name: "models/main.json", data: new Uint8Array(4) },
      { name: "textures/skin.png", data: new Uint8Array(8) },
    ]);
    const metas = parseZipCentralDir(zip);
    expect(metas).toHaveLength(3);
    expect(metas[0].fflateKey).toBe("ysm.json");
    expect(metas[1].fflateKey).toBe("models/main.json");
    expect(metas[2].fflateKey).toBe("textures/skin.png");
  });

  it("无效 ZIP → 空数组（过短）", () => {
    const metas = parseZipCentralDir(new Uint8Array([0, 1, 2, 3]));
    expect(metas).toHaveLength(0);
  });

  it("无效 ZIP → 空数组（≥22B 但无 EOCD 签名，不抛 RangeError）", () => {
    // 60000 字节的垃圾数据，无 0x06054b50 签名 → eocd 递减到 searchStart 以下
    // 修复前：dv.getUint32(-1) 抛 RangeError；修复后：提前返回空数组
    const garbage = new Uint8Array(60000);
    for (let i = 0; i < 60000; i++) garbage[i] = i & 0xff;
    const metas = parseZipCentralDir(garbage);
    expect(metas).toHaveLength(0);
  });

  it("detectContainerType 非 LFH 魔数 → break 终止循环", () => {
    // 构造含非 LFH 魔数的数据：PK\x03\x04 后跟着垃圾字节，第二次读取时签名不匹配
    const data = new Uint8Array(60);
    data[0] = 0x50; data[1] = 0x4b; data[2] = 0x03; data[3] = 0x04;
    // local file header 需要 30 字节 + 文件名，这里故意不填全，第 4 字节后直接垃圾
    for (let i = 4; i < 60; i++) data[i] = 0xff;
    // 第一个 LFH 签名有效，读取 nameLen(0xff00) 后发现 nameStart+nameLen 超出范围 → break
    expect(detectContainerType(data)).toBeNull();
  });

  it("文件名为 shaders（目录形态）→ shaderpack", () => {
    const zip = buildMinimalZip("shaders", new Uint8Array(0));
    expect(detectContainerType(zip)).toBe("shaderpack");
  });
});

// --- parseZipCentralDir 边界分支补测 ---

describe("parseZipCentralDir 边界分支", () => {
  it("EOCD 有效但 totalEntries === 0 → 空数组（空 ZIP）", () => {
    const eocd = new Uint8Array(22);
    const dv = new DataView(eocd.buffer);
    dv.setUint32(0, 0x06054b50, true); // EOCD 签名
    dv.setUint16(10, 0, true); // totalEntries = 0
    dv.setUint32(16, 0, true); // centralDirOffset = 0（即使偏移合法，0 条目也应短路）
    expect(parseZipCentralDir(eocd)).toHaveLength(0);
  });

  it("EOCD 有效但 CD 偏移处非 CDE 签名 → break 终止，返回 []", () => {
    // EOCD 指向的中央目录偏移处是垃圾（非 0x02014b50）→ 循环立即 break
    const bytes = new Uint8Array(30);
    const dv = new DataView(bytes.buffer);
    dv.setUint32(0, 0x06054b50, true); // EOCD 签名
    dv.setUint16(10, 1, true); // totalEntries = 1
    dv.setUint32(16, 0, true); // centralDirOffset = 0（此处是 EOCD 而非 CDE）
    expect(parseZipCentralDir(bytes)).toHaveLength(0);
  });

  it("gpf bit 11 设但文件名为非法 UTF-8 → 降级非致命解码（不抛 RangeError/解码错误）", () => {
    // 构造 gpf=0x800（UTF-8 标志）但文件名是非法 UTF-8 字节 [0xff, 0xfe, 0x41]
    const nameBytes = new Uint8Array([0xff, 0xfe, 0x41]);
    const data = new Uint8Array([0x7b, 0x7d]);
    const zip = buildZipWithNameBytes(nameBytes, data, { utf8: true });

    const metas = parseZipCentralDir(zip);
    expect(metas).toHaveLength(1);
    expect(metas[0].gpfUtf8).toBe(true);
    // 0xff / 0xfe 各替换为 U+FFFD，0x41 = "A"（不抛错即达降级分支）
    expect(metas[0].fflateKey).toBe("\uFFFD\uFFFDA");
  });
});

// --- extractZip ---

describe("extractZip", () => {
  it("正常解压", () => {
    const zip = buildMinimalZip("ysm.json", new Uint8Array([0x7b, 0x7d]));
    const result = extractZip(zip);
    expect(result.entries).toEqual({ "ysm.json": expect.any(Uint8Array) });
    expect(result.entries["ysm.json"]).toEqual(new Uint8Array([0x7b, 0x7d]));
  });

  it("解压后 entries 与 metas 同序", () => {
    const zip = buildMultiEntryZip([
      { name: "ysm.json", data: new Uint8Array([1]) },
      { name: "models/main.json", data: new Uint8Array([2]) },
    ]);
    const result = extractZip(zip);
    expect(result.metas).toHaveLength(2);
    expect(result.entries["ysm.json"]).toBeDefined();
    expect(result.entries["models/main.json"]).toBeDefined();
  });

  it("ZIP 炸弹防护：总大小超限（构造含虚假超大 uncompressedSize 的 ZIP）", () => {
    // 构造一个单 entry ZIP，中央目录中 uncompressedSize 设为 1GB
    // parseZipCentralDir 读到此值 → extractZip 总大小超限
    const nameBytes = new TextEncoder().encode("test.txt");
    const data = new Uint8Array([0x54, 0x45, 0x53, 0x54]);
    const fakeSize = 1024 * 1024 * 1024; // 1GB
    const zip = buildZipWithNameBytes(nameBytes, data, { uncompressedSize: fakeSize });

    expect(() => extractZip(zip)).toThrow("解压后总大小");
  });
  it("UTF-8 中文文件名 → parseZipCentralDir 正确解码", () => {
    // 构造含 UTF-8 中文文件名 "模型.json" 的 ZIP（gpf bit 11 设）
    const utf8Name = new TextEncoder().encode("模型.json");
    const data = new Uint8Array([0x7b, 0x7d]);
    const zip = buildZipWithNameBytes(utf8Name, data, { utf8: true });

    const metas = parseZipCentralDir(zip);
    expect(metas).toHaveLength(1);
    expect(metas[0].fflateKey).toBe("模型.json");
    expect(metas[0].gpfUtf8).toBe(true);
    expect(metas[0].nameBytes).toEqual(utf8Name);
  });

  it("ZIP64：CD 偏移 0xFFFFFFFF → 降级返回空数组", () => {
    // 构造 EOCD 中 centralDirOffset=0xFFFFFFFF（ZIP64 标记）
    // parseZipCentralDir 读到该值后判断 centralDirOffset >= data.length → 返回 []
    const eocd = new Uint8Array(22);
    const dv = new DataView(eocd.buffer);
    dv.setUint32(0, 0x06054b50, true);
    dv.setUint16(10, 1, true);
    dv.setUint32(16, 0xFFFFFFFF, true);
    const result = parseZipCentralDir(eocd);
    expect(result).toHaveLength(0);
  });

  it("ZIP 炸弹防护：条目数超限（构造 10001 个 entry 的合法 ZIP）", () => {
    // 构造 10001 个 STORE entry 的合法 ZIP，触发条目数上限
    const nameBytes = new Uint8Array([0x78]); // "x"
    const data = new Uint8Array([0x01]);
    const entryCount = 10001;

    const lfh = new Uint8Array(30);
    const lfhDv = new DataView(lfh.buffer);
    lfhDv.setUint32(0, 0x04034b50, true);
    lfhDv.setUint16(8, 0, true); // STORE
    lfhDv.setUint32(18, 1, true);
    lfhDv.setUint32(22, 1, true);
    lfhDv.setUint16(26, 1, true);

    const cde = new Uint8Array(46);
    const cdeDv = new DataView(cde.buffer);
    cdeDv.setUint32(0, 0x02014b50, true);
    cdeDv.setUint16(10, 0, true);
    cdeDv.setUint32(20, 1, true);
    cdeDv.setUint32(24, 1, true);
    cdeDv.setUint16(28, 1, true);

    const lfhSize = 30 + 1 + 1; // LFH + name + data
    const cdeSize = 46 + 1; // CDE + name
    const cdeStart = entryCount * lfhSize;
    const cdeLength = entryCount * cdeSize;
    const total = cdeStart + cdeLength + 22;
    const zip = new Uint8Array(total);
    let off = 0;
    for (let i = 0; i < entryCount; i++) {
      zip.set(lfh, off); off += 30;
      zip.set(nameBytes, off); off += 1;
      zip.set(data, off); off += 1;
    }
    for (let i = 0; i < entryCount; i++) {
      zip.set(cde, off); off += 46;
      zip.set(nameBytes, off); off += 1;
    }
    const eocd = new Uint8Array(22);
    const eocdDv = new DataView(eocd.buffer);
    eocdDv.setUint32(0, 0x06054b50, true);
    eocdDv.setUint16(10, entryCount, true);
    eocdDv.setUint32(12, cdeLength, true);
    eocdDv.setUint32(16, cdeStart, true);
    zip.set(eocd, off);

    expect(() => extractZip(zip)).toThrow("条目数");
  });
});

// --- 集成场景 ---

describe("集成：非 UTF-8 中文文件名 ZIP 解压（GBK 字节 → 降级 fflateKey）", () => {
  it("parseZipCentralDir 正确提取 nameBytes → fflateKey Latin-1 降级", () => {
    // 模拟 Windows GBK 文件名 "角色.png" 的原始字节
    // 角: 0xB1D6 (GBK)  色: 0xB4DC (GBK)  .:0x2E  p:0x70  n:0x6E  g:0x47
    const gbkBytes = new Uint8Array([0xB1, 0xD6, 0xB4, 0xDC, 0x2E, 0x70, 0x6E, 0x67]);
    const data = new Uint8Array([0x89, 0x50, 0x4E, 0x47]); // PNG 头
    // 文件名区域直接写入 GBK 原始字节（gpf bit 11 未设）
    const zip = buildZipWithNameBytes(gbkBytes, data);

    const metas = parseZipCentralDir(zip);
    expect(metas).toHaveLength(1);
    // nameBytes 是原始 GBK 字节（保留供调用方自行解码，如引入完整 GBK 码表后还原真名）
    expect(metas[0].nameBytes).toEqual(gbkBytes);
    // gpfUtf8 = false（gpf bit 11 未设）
    expect(metas[0].gpfUtf8).toBe(false);
    // fflateKey 是 Latin-1 解码的乱码（charCode = 字节值）——
    // 前端无 GBK 码表，文件名一律以 fflateKey 原值入库（数据可访问、key 唯一）
    expect(metas[0].fflateKey).toBe(
      String.fromCharCode(0xB1, 0xD6, 0xB4, 0xDC) + ".png"
    );
  });
});