// ===== 资源包/光影包 meta 读取（TS 平移 go/packs/mcmeta.go）=====
// 纯解析层：字节 → JSON 字符串，不触碰文件系统/IDB（web-fs.ts 负责
// readWebFile → base64 → 字节 → extractZip → 本文件解析 → binding 装配）。
// 范式对齐 ADR-070 nbt-parse.ts（TS 镜像 Go + 测试锁定）。
//
// 对齐 Go binding 契约（internal/app/resource_bindings.go:34-61）：
//   ReadPackMeta     失败 → "{}"
//   ReadShaderpackLang 失败 → {"name":"","entries":{}}
// 限额对齐 go/packs/mcmeta.go：pack.mcmeta 1MB / pack.png 10MB / lang 1MB。

import { u8ToBase64 } from "./web-common.ts";

// 对齐 go/packs/mcmeta.go maxMcmetaSize / maxPackPng / maxLangSize
const MAX_MCMETA_SIZE = 1 << 20;
const MAX_PACK_PNG = 10 << 20;
const MAX_LANG_SIZE = 1 << 20;

/**
 * zip entries 中按小写名找条目（对齐 go 端 strings.ToLower(f.Name) 匹配——
 * zip 内路径大小写不敏感：PACK.MCMETA / Lang/En_US.Lang 均可命中）。
 * fflate unzipSync 的 key 保留原始大小写，此处只做匹配、用原 key 取数据。
 */
export function findZipEntry(entries: Record<string, Uint8Array>, lowName: string): Uint8Array | null {
  for (const key of Object.keys(entries)) {
    if (key.toLowerCase() === lowName) return entries[key];
  }
  return null;
}

/** 剥离 UTF-8 BOM（PowerShell 写入的 JSON 可能带 EF BB BF 前缀，对齐 go fsutil.StripBOM） */
function stripUtf8Bom(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

/**
 * description 可读文本提取（对齐 go types.descString：string / {text} 对象 /
 * [{text, extra:[{text}]}] 数组；不支持形状返回空串）。
 */
function descText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    let out = "";
    for (const c of value) {
      const comp = c as { text?: unknown; extra?: Array<{ text?: unknown }> };
      if (comp && typeof comp.text === "string" && comp.text) out += comp.text;
      for (const e of comp?.extra ?? []) {
        if (e && typeof e.text === "string" && e.text) out += e.text;
      }
    }
    return out;
  }
  if (value && typeof value === "object") {
    const v = value as { text?: unknown };
    if (typeof v.text === "string") return v.text;
  }
  return "";
}

/**
 * supported_formats/min_format/max_format → [min, max]（对齐 go types.FormatRange.UnmarshalJSON：
 * int / [int] / [int,int] / {min_inclusive,max_inclusive}；解析失败返回 null →
 * Go 侧 json.Unmarshal 整体报错 → binding "{}"）。
 */
function formatRangeToPair(value: unknown): [number, number] | null {
  if (typeof value === "number") {
    return Number.isInteger(value) ? [value, value] : null;
  }
  if (Array.isArray(value)) {
    // 对齐 go：空数组 → 报错；元素非 int → 报错（json.Unmarshal []int 失败）
    if (value.length === 0) return null;
    const allInt = value.every((v) => typeof v === "number" && Number.isInteger(v));
    if (!allInt) return null;
    // go len==1 → min=max；len>=2 → [0] 与 [1]（其余元素忽略）
    return value.length >= 2 ? [value[0], value[1]] : [value[0], value[0]];
  }
  if (value && typeof value === "object") {
    const v = value as Record<string, unknown>;
    // 对齐 go：未知字段忽略；min_inclusive/max_inclusive 缺省 0；已知键值非 int → 报错
    const minRaw = "min_inclusive" in v ? v.min_inclusive : 0;
    const maxRaw = "max_inclusive" in v ? v.max_inclusive : 0;
    if (!Number.isInteger(minRaw as number) || !Number.isInteger(maxRaw as number)) return null;
    return [minRaw as number, maxRaw as number];
  }
  return null; // null / bool / string → Go 三种尝试全失败 → 报错
}

/**
 * pack.mcmeta 字节 → meta 对象（对齐 internal/app ReadPackMeta 的 result 形状：
 * pack_format / description / thumbnail / supported_formats / min_format / max_format）。
 * 解析失败（>1MB / 非 JSON / 字段类型不符）→ null（对齐 Go error → binding "{}"）。
 */
export function parsePackMetaJson(bytes: Uint8Array): Record<string, unknown> | null {
  if (bytes.length > MAX_MCMETA_SIZE) return null;
  const text = stripUtf8Bom(new TextDecoder("utf-8").decode(bytes));
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const pack = parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as { pack?: unknown }).pack
    : undefined;
  const p = pack && typeof pack === "object" && !Array.isArray(pack)
    ? (pack as Record<string, unknown>)
    : {};
  // pack_format 对齐 Go int：存在但非整数 → 整体解析失败（Go json.Unmarshal int 字段报错）
  if ("pack_format" in p && !Number.isInteger(p.pack_format as number)) return null;
  const result: Record<string, unknown> = {
    pack_format: typeof p.pack_format === "number" ? p.pack_format : 0,
    description: descText(p.description),
    thumbnail: "",
  };
  for (const key of ["supported_formats", "min_format", "max_format"]) {
    if (key in p && p[key] != null) {
      const pair = formatRangeToPair(p[key]);
      if (!pair) return null; // 对齐 Go UnmarshalJSON 失败 → 整体解析失败 → "{}"
      result[key] = [pair[0], pair[1]];
    }
  }
  return result;
}

/** pack.png 字节 → data URL base64 缩略图（10MB 限额；空/超限 → ""，对齐 go 截断探测置空） */
export function packPngToThumbnail(png: Uint8Array | null): string {
  if (!png || png.length === 0 || png.length > MAX_PACK_PNG) return "";
  return "data:image/png;base64," + u8ToBase64(png);
}

/**
 * lang/en_US.lang 字节 → {name, entries} JSON 字符串（对齐 go ReadShaderpackLang：
 * >1MB → 空结果；key=value 行、# 注释、TrimSpace；name 取 pack.name / shaderpack.name /
 * title / *.title 首个命中（大小写不敏感，精确匹配防误捕 pack.namespace 等））。
 */
export function parseShaderpackLang(bytes: Uint8Array): string {
  const empty = JSON.stringify({ name: "", entries: {} });
  if (bytes.length > MAX_LANG_SIZE) return empty;
  const text = new TextDecoder("utf-8").decode(bytes);
  const entries: Record<string, string> = {};
  let name = "";
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eqIdx = line.indexOf("=");
    if (eqIdx < 0) continue;
    const key = line.slice(0, eqIdx).trim();
    const val = line.slice(eqIdx + 1).trim();
    if (!key || !val) continue;
    entries[key] = val;
    const lowKey = key.toLowerCase();
    if (
      lowKey === "pack.name" ||
      lowKey === "shaderpack.name" ||
      lowKey === "title" ||
      lowKey.endsWith(".title")
    ) {
      if (!name) name = val;
    }
  }
  return JSON.stringify({ name, entries });
}
