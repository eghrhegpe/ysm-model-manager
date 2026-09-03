// ===== web-fs pack/shaderpack meta 读取（ADR-040 拆分延续，自 web-fs.ts §7 拆出）=====
// 资源包/光影包详情 binding 的 TS 平移实现（go/packs/mcmeta.go ReadPackMeta /
// ReadShaderpackLang + ListPackModels* / ReadPackEntry）。读 IDB → base64 → 字节 →
// extractZip → pack-meta.ts 纯解析 → binding 结果形状。
// 失败契约对齐 Go binding：ReadPackMeta → "{}"；ReadShaderpackLang → {"name":"","entries":{}}
// ListPackModels → "[]"；ReadPackEntry → ""。共享读取装配来自 web-fs-read.ts 叶子。

import { base64ToBytes, u8ToBase64 } from "./web-common.ts";
import { extractZip } from "../parsers/extract.ts";
import { findZipEntry, parsePackMetaJson, parseShaderpackLang, packPngToThumbnail } from "../parsers/pack-meta.ts";
import { readWebFile, readWebZipEntries } from "./web-fs-read.ts";

/**
 * 资源包详情 binding 公共骨架（TS 平移 go/packs/mcmeta.go ReadPackMeta + internal/app
 * resource_bindings.go:34 的 result 装配）。读 IDB → base64 → 字节 → extractZip →
 * 找 pack.mcmeta（1MB 限额）→ JSON 解析 → 找 pack.png（10MB 限额）→ base64 缩略图。
 * 任何一步失败（文件缺失 / 非 zip / 无 mcmeta / 超限 / 解析失败）→ "{}"（对齐 Go
 * binding 契约：ReadPackMeta error → "{}"）。
 */
export async function readPackMetaJson(path: string): Promise<Record<string, unknown> | null> {
  try {
    const b64 = await readWebFile(path);
    if (!b64) return null;
    const bytes = base64ToBytes(b64);
    if (!bytes) return null;
    const { entries } = extractZip(bytes);
    const mcmeta = findZipEntry(entries, "pack.mcmeta");
    if (!mcmeta) return null;
    const meta = parsePackMetaJson(mcmeta);
    if (!meta) return null;
    // pack.png → base64 缩略图（10MB 限额，超限置空——对齐 go zip 分支 LimitReader+1 截断探测）
    meta.thumbnail = packPngToThumbnail(findZipEntry(entries, "pack.png"));
    return meta;
  } catch {
    return null;
  }
}

/**
 * 光影包详情 binding（TS 平移 go/packs/mcmeta.go ReadShaderpackLang）。读 IDB → base64 →
 * 字节 → extractZip → 找 lang/en_US.lang（大小写不敏感，1MB 限额）→ key=value 解析 →
 * {name, entries}。任何一步失败 → {name:"",entries:{}}（对齐 Go binding 契约）。
 */
export async function readShaderpackLangJson(path: string): Promise<{ name: string; entries: Record<string, string> }> {
  try {
    const b64 = await readWebFile(path);
    if (!b64) return { name: "", entries: {} };
    const bytes = base64ToBytes(b64);
    if (!bytes) return { name: "", entries: {} };
    const { entries } = extractZip(bytes);
    const lang = findZipEntry(entries, "lang/en_us.lang");
    if (!lang) return { name: "", entries: {} };
    const parsed = JSON.parse(parseShaderpackLang(lang)) as { name: string; entries: Record<string, string> };
    return parsed;
  } catch {
    return { name: "", entries: {} };
  }
}

/** 资源包 3D：ListPackModels 枚举 zip 内条目（对齐 Go ListPackModels 契约，返回 string[]） */
export async function listWebPackModels(path: string): Promise<string[]> {
  try {
    const entries = await readWebZipEntries(path);
    if (!entries) return [];
    return Object.keys(entries);
  } catch {
    return [];
  }
}

/** 资源包模型 entry 判定（镜像 Go packModelEntryMatch：assets/<ns>/models/{block,item}/**\/*.json） */
function webPackModelEntryMatch(name: string): boolean {
  const n = name.toLowerCase();
  if (!n.startsWith("assets/") || !n.endsWith(".json")) return false;
  const idx = n.indexOf("/models/");
  if (idx < 0) return false;
  const rest = n.slice(idx + "/models/".length);
  return rest.startsWith("block/") || rest.startsWith("item/");
}

/**
 * 资源包模型清单：ListPackModelsDetail 镜像（对齐 Go 绑定契约）——
 * 返回 {models:[{path,cubes}],total:N}，cubes = JSON elements 数组长度，
 * 封顶前 200 条（防大包），total 全量。失败返回空结构（详情卡清单区降级）。
 */
export async function listWebPackModelsDetail(path: string): Promise<{ models: Array<{ path: string; cubes: number }>; total: number }> {
  const empty = () => ({ models: [], total: 0 });
  try {
    const b64 = await readWebFile(path);
    if (!b64) return empty();
    const bytes = base64ToBytes(b64);
    if (!bytes) return empty();
    const { entries } = extractZip(bytes);
    const keys = Object.keys(entries).filter((k) => webPackModelEntryMatch(k)).sort();
    const total = keys.length;
    const capped = keys.slice(0, 200);
    const models = capped.map((k) => {
      const bytes = entries[k];
      let cubes = 0;
      try {
        const parsed = JSON.parse(new TextDecoder().decode(bytes)) as { elements?: unknown[] };
        cubes = Array.isArray(parsed.elements) ? parsed.elements.length : 0;
      } catch { /* 单条目 JSON 异常 → cubes 0（对齐 Go packModelElementsCount） */ }
      return { path: k, cubes };
    });
    return { models, total };
  } catch {
    return empty();
  }
}

/** 资源包 3D：ReadPackEntry 读取 zip 内指定条目并返回 base64（对齐 Go 契约） */
export async function readWebPackEntry(path: string, entry: string): Promise<string> {
  try {
    const b64 = await readWebFile(path);
    if (!b64) return "";
    const bytes = base64ToBytes(b64);
    if (!bytes) return "";
    const { entries } = extractZip(bytes);
    const raw = findZipEntry(entries, entry);
    return raw ? u8ToBase64(raw) : "";
  } catch {
    return "";
  }
}
