// ===== ZIP 解压 + 类型检测 + 中央目录预解析（ADR-049 Phase 2：网页版 .zip 全能化）=====
//
// 三件套：
//   1. parseZipCentralDir — 预解析 ZIP 中央目录，算出每个 entry 的 fflateKey（对齐 unzipSync 返回的 key）
//      与 gpf bit 11 状态。中文 Windows GBK 文件名（gpf 未设）经 fflate Latin-1 解码后乱码，
//      本函数提供 fflateKey → 原始字节 的反查，供调用方做 GBK 解码回真名。
//   2. extractZip — unzipSync 全量解压 + ZIP 炸弹防护（条目数/总大小上限）
//   3. detectContainerType — 扫描 ZIP local file header 文件名段（不解压数据）识别资源类型
//      （Go DetectContainerType 的 TS 平移，go/importer/importer_file.go:122-151）
//
// 安全护栏：
//   - MAX_ZIP_ENTRIES: 10000（防 zip bomb 条目膨胀）
//   - MAX_ZIP_TOTAL_BYTES: 512MB（解压后总大小上限，对齐 go/avatar/readLimitedModel 50MB 的宽松版）
//   - MAX_ZIP_FILE_BYTES: 100MB（单文件上限，与 MAX_IMPORT_BYTES 对齐）

import { unzipSync } from "fflate";
import { matchZipEntryTS, RESOURCE_TYPES } from "../utils/resource/types.ts";

// --- ZIP 格式常量 ---
const EOCD_SIG = 0x06054b50; // End of Central Directory
const CDE_SIG = 0x02014b50; // Central Directory Entry
const LFLH_SIG = 0x04034b50; // Local File Header

// --- ZIP 炸弹防护阈值 ---
const MAX_ZIP_ENTRIES = 10_000;
const MAX_ZIP_TOTAL_BYTES = 512 * 1024 * 1024;
const MAX_ZIP_FILE_BYTES = 100 * 1024 * 1024;

// --- gpf bit 11：UTF-8 文件名标志 ---
const GPF_UTF8 = 0x800;

/** ZIP 中央目录条目元数据（pre-parse 产物） */
export interface ZipEntryMeta {
  /** fflate unzipSync 返回的 key（gpf bit 11 未设时可能为 Latin-1 解码的乱码） */
  fflateKey: string;
  /** 文件名原始字节（供调用方 GBK/Shift-JIS 解码取真名） */
  nameBytes: Uint8Array;
  /** gpf bit 11 状态（true=文件名 UTF-8 编码，fflateKey 已正确） */
  gpfUtf8: boolean;
  /** 压缩方法（0=STORE, 8=DEFLATE） */
  compression: number;
  /** 压缩后大小 */
  compressedSize: number;
  /** 解压后大小 */
  uncompressedSize: number;
}

/** extractZip 返回值 */
export interface ExtractResult {
  entries: Record<string, Uint8Array>;
  metas: ZipEntryMeta[];
  /** 所有 entry 中 gpf bit 11 均设了 → 无需 GBK 回退 */
  allUtf8: boolean;
}

/** detectContainerType 返回值 */
// ADR-111：VRM 已合并进 EntityPlayer 的 variants，ZipType 不再含独立 VRM
export type ZipType = typeof RESOURCE_TYPES.YSM | typeof RESOURCE_TYPES.PACK | typeof RESOURCE_TYPES.SHADER | typeof RESOURCE_TYPES.BLUEPRINT | typeof RESOURCE_TYPES.LITEMATIC | typeof RESOURCE_TYPES.MMD | null;

// --- 中央目录预解析（fflateKey 对齐，处理 gpf bit 11 / 中文文件名）---

/** 解析 ZIP 中央目录，返回每个 entry 的 fflateKey + 原始文件名字节 */
export function parseZipCentralDir(data: Uint8Array): ZipEntryMeta[] {
  const metas: ZipEntryMeta[] = [];
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);

  // 1. 定位 End of Central Directory（从文件末尾倒数，最多扫 65535 字节）
  if (data.length < 22) return metas; // 太短，不可能是 ZIP
  let eocd = data.length - 22;
  const searchStart = Math.max(data.length - 65557, 0);
  while (eocd >= searchStart) {
    if (dv.getUint32(eocd, true) === EOCD_SIG) {
      break;
    }
    eocd--;
  }
  // 未找到 EOCD：eocd 已递减到 searchStart 以下（甚至 -1），dv 读取抛 RangeError → 提前返回
  if (eocd < searchStart || dv.getUint32(eocd, true) !== EOCD_SIG) {
    return metas; // 非标准 ZIP，无中央目录
  }

  // 2. 读中央目录偏移 + 条目数
  const totalEntries = dv.getUint16(eocd + 10, true);
  const centralDirOffset = dv.getUint32(eocd + 16, true);
  if (totalEntries === 0 || centralDirOffset >= data.length) {
    return metas;
  }

  let offset = centralDirOffset;
  for (let i = 0; i < totalEntries; i++) {
    if (offset + 46 > data.length) break;
    if (dv.getUint32(offset, true) !== CDE_SIG) break;

    const gpf = dv.getUint16(offset + 8, true);
    const compression = dv.getUint16(offset + 10, true);
    const compressedSize = dv.getUint32(offset + 20, true);
    const uncompressedSize = dv.getUint32(offset + 24, true);
    const nameLen = dv.getUint16(offset + 28, true);
    const extraLen = dv.getUint16(offset + 30, true);
    const commentLen = dv.getUint16(offset + 32, true);

    const nameStart = offset + 46;
    if (nameStart + nameLen > data.length) break;

    // 提取文件名原始字节
    const nameBytes = data.subarray(nameStart, nameStart + nameLen);

    // fflateKey = fflate 对文件名按 gpf bit 11 解码后的结果
    // gpf bit 11 设 → UTF-8 解码（strFromU8(dat, false)）
    // gpf bit 11 未设 → Latin-1 解码（strFromU8(dat, true)）
    const gpfUtf8 = (gpf & GPF_UTF8) !== 0;
    let fflateKey: string;
    if (gpfUtf8) {
      // UTF-8 解码
      fflateKey = utf8DecodeBytes(nameBytes);
    } else {
      // Latin-1 解码（逐字节映射到同值 Unicode code point）
      fflateKey = latin1DecodeBytes(nameBytes);
    }

    metas.push({
      fflateKey,
      nameBytes,
      gpfUtf8,
      compression,
      compressedSize,
      uncompressedSize,
    });

    offset = nameStart + nameLen + extraLen + commentLen;
  }

  return metas;
}

// --- 解压（unzipSync + ZIP 炸弹防护）---

/**
 * 解压 ZIP 数据，返回 {entries, metas}。
 * ZIP 炸弹防护：条目数 ≤ MAX_ZIP_ENTRIES，单文件 ≤ MAX_ZIP_FILE_BYTES，总大小 ≤ MAX_ZIP_TOTAL_BYTES。
 */
export function extractZip(data: Uint8Array): ExtractResult {
  // 预解析中央目录做 ZIP 炸弹防护（不解压先判断）
  const metas = parseZipCentralDir(data);
  const totalUncompressed = metas.reduce((sum, m) => sum + m.uncompressedSize, 0);

  if (metas.length > MAX_ZIP_ENTRIES) {
    throw new Error(`ZIP 炸弹防护：条目数 ${metas.length} 超过上限 ${MAX_ZIP_ENTRIES}`);
  }
  if (totalUncompressed > MAX_ZIP_TOTAL_BYTES) {
    throw new Error(`ZIP 炸弹防护：解压后总大小超过上限 ${MAX_ZIP_TOTAL_BYTES} bytes`);
  }

  // unzipSync 解压（fflate ~8KB，同步 API，3-5x 快于 JSZip）
  const rawEntries = unzipSync(data, {
    filter(file) {
      // 跳过超大文件（ZIP 炸弹：单个 entry 膨胀）
      return file.originalSize <= MAX_ZIP_FILE_BYTES;
    },
  });

  // 组装 entries（unzipSync 返回 {path: Uint8Array}）
  const entries: Record<string, Uint8Array> = {};
  for (const key of Object.keys(rawEntries)) {
    entries[key] = rawEntries[key];
  }

  const allUtf8 = metas.length > 0 && metas.every((m) => m.gpfUtf8);

  return { entries, metas, allUtf8 };
}

/**
 * detectContainerType：扫描 ZIP local file header 文件名段（不解压数据），
 * 识别资源类型。Go DetectContainerType 的 1:1 TS 平移
 * （go/importer/importer_file.go:122-151）。
 * 只读 local file header 区（每 entry 约 30+nameLen 字节），
 * 不读压缩数据，O(n) 遍历 local headers 即可。
 *
 * 消费方：web-fs.ts DetectResourceType（歧义 .zip/.7z 容器路由到内容指纹）——
 * 与 Go DetectResourceType/zipEntries 同语义（pack.mcmeta/shaders/ysm.json/类型后缀）。
 */
export function detectContainerType(data: Uint8Array): ZipType {
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let idx = 0;
  while (idx + 30 <= data.length) {
    // Local File Header 魔数 PK\x03\x04
    if (dv.getUint32(idx, true) !== LFLH_SIG) {
      break;
    }

    const nameLen = dv.getUint16(idx + 26, true);
    const extraLen = dv.getUint16(idx + 28, true);
    const nameStart = idx + 30;
    if (nameStart + nameLen > data.length) {
      break;
    }

    // 读文件名字节（按 Latin-1 处理，大小写折叠仅影响 ASCII）
    const nameLow = lowerLatin1(data.subarray(nameStart, nameStart + nameLen));

    // ADR-082 S4：注册表驱动指纹（matchZipEntryTS，与 Go types.MatchZipEntry 同构——
    // 任意层级段后缀语义，pack.mcmeta/shaders/ysm.json/类型后缀命中任意层级，
    // 新增类型只改 resource_types.json）。原硬编码 if 链删除防前后端漂移。
    const rtype = matchZipEntryTS(nameLow);
    if (rtype) return rtype as ZipType;

    // 跳到下一个 entry（跳过压缩数据）
    const compSize = dv.getUint32(idx + 18, true);
    idx += 30 + nameLen + extraLen + compSize;
  }
  return null; // 无特征返回 null（识别不出就是识别不出，不假装 YSM，与 Go DetectContainerType 对齐）
}

// --- 编码工具函数 ---

/** UTF-8 字节序列解码为字符串 */
function utf8DecodeBytes(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    // 非严格 UTF-8（含非法字节序列）→ 降级用 replace 策略
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  }
}

/** Latin-1 字节序列解码（逐字节 → 同值 Unicode code point） */
function latin1DecodeBytes(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) {
    s += String.fromCharCode(bytes[i]);
  }
  return s;
}

/** Latin-1 字节序列小写化（仅影响 ASCII 范围） */
function lowerLatin1(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) {
    const c = bytes[i];
    s += c >= 0x41 && c <= 0x5a ? String.fromCharCode(c + 0x20) : String.fromCharCode(c);
  }
  return s;
}