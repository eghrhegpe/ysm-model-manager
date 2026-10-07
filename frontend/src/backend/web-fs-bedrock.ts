// ===== web-fs Bedrock 预览 fallback 链（ADR-040 拆分延续，自 web-fs.ts #5 拆出）=====
// FindPreviewImage / ExtractPreviewTexture / AnalyzeBedrockModel / AnalyzeBedrockModelEntry
// 的 web 实现：.zip 读 IDB → 解包 → 找 geometry JSON → 复用前端解析器
// （parseBedrockGeometryFromJSON / parseYsmJsonDirect，已下沉 @/parsers）；.json 扫模型组文件。
// 共享读取装配与路径反解（readWebFile / readWebZipEntries / listWebModelDirFiles）来自
// web-fs-read.ts 叶子——断对 web-fs.ts 主文件的循环依赖。

import { type BedrockGeometry, parseBedrockGeometryFromJSON } from "@/parsers/bedrock-geometry.ts";
import { extractZip } from "@/parsers/extract.ts";
import { parseYsmJsonDirect } from "@/parsers/ysm-json.ts";
import { safeErrorMessage } from "@/utils/base/pure/safe-error-msg.ts";
import { base64ToBytes, u8ToBase64 } from "./web-common.ts";
import { listWebModelDirFiles, readWebFile } from "./web-fs-read.ts";

function imageMimeOfPath(p: string): string {
  return /\.jpe?g$/i.test(p) ? "image/jpeg" : "image/png";
}

function imageDataUri(bytes: Uint8Array, mime = "image/png"): string {
  return `data:${mime};base64,${u8ToBase64(bytes)}`;
}

/** 从 IDB 读一个图片文件并转 data URI；不存在/读取失败返回 "" */
async function readImageDataUri(p: string): Promise<string> {
  const b64 = await readWebFile(p);
  if (!b64) return "";
  const bytes = base64ToBytes(b64);
  if (!bytes) return "";
  return imageDataUri(bytes, imageMimeOfPath(p));
}

/** ysm.json manifest 元数据（parseYsmJsonDirect 塞在 BedrockGeometry._ysmMeta） */
interface YsmManifestMeta {
  modelFiles?: unknown[];
  texFiles?: unknown[];
  defaultTexture?: string | null;
}

/** 按相对路径（可带反斜杠/大小写差异）在 zip entries 中找字节 */
function findEntryByRel(entries: Record<string, Uint8Array>, rel: string): Uint8Array | null {
  const norm = rel.replace(/\\/g, "/").toLowerCase();
  for (const key of Object.keys(entries)) {
    if (key.replace(/\\/g, "/").toLowerCase() === norm) return entries[key];
  }
  return null;
}

/** 解析 ysm.json 字节 → manifest 元数据（没有 ysm.json 规范结构返回 null） */
function parseYsmManifestMeta(bytes: Uint8Array): YsmManifestMeta | null {
  try {
    const json = JSON.parse(new TextDecoder("utf-8").decode(bytes)) as unknown;
    const decoded = parseYsmJsonDirect(json);
    if (!decoded?.geometry) return null;
    const meta = (decoded.geometry as { _ysmMeta?: YsmManifestMeta })._ysmMeta;
    return meta?.modelFiles?.length ? meta : null;
  } catch (err) {
    // 静默吞异常曾导致 ysm.json 结构不符时无任何线索（69ab1f03 code review）；
    // 此处留 warn 便于排查，null 语义不变（降级走单 geometry 路径）
    console.warn("[web-fs] parseYsmManifestMeta 解析失败，降级单 geometry:", safeErrorMessage(err));
    return null;
  }
}

/**
 * 按 ysm.json manifest 声明序合并多 geometry（对齐 wasm.ts handleYsmJsonSpec 的合并规则）。
 * @param meta parseYsmJsonDirect 输出的 _ysmMeta（texFiles 已按 default_texture 置首）
 * @param readFile 相对路径读取器；zip 用 entries 查表，解压目录用 IDB 读文件
 */
async function mergeBedrockFromManifest(
  meta: YsmManifestMeta,
  readFile: (rel: string) => Promise<Uint8Array | null>,
): Promise<BedrockGeometry | null> {
  const geo = await mergeManifestGeometry(meta, readFile);
  if (!geo.bones.length) return null;
  const tex = await mergeManifestTextures(meta, readFile);
  return {
    bones: geo.bones,
    boneCount: geo.boneCount,
    cubeCount: geo.cubeCount,
    texWidth: geo.texWidth,
    texHeight: geo.texHeight,
    textures: tex.textures,
    textureNames: tex.textureNames,
  };
}

/** manifest 条目取声明路径：字符串本身，或 {path}/{uv} 对象字段；缺省 "" */
function manifestPathOf(v: unknown, key: "path" | "uv"): string {
  if (typeof v === "string") return v;
  return ((v as Record<string, unknown>)?.[key] as string) || "";
}

/** 依序读第一个命中的候选路径（zip entries 查表 / IDB 读文件均可能全部落空） */
async function readFirstAvailable(
  readFile: (rel: string) => Promise<Uint8Array | null>,
  candidates: string[],
): Promise<Uint8Array | null> {
  for (const c of candidates) {
    const bytes = await readFile(c);
    if (bytes) return bytes;
  }
  return null;
}

/** geometry 候选路径：缺 models/ 前缀则补。
 *  兼容 manifest 里只写 baseName（如 "main"）而磁盘上是 main.json / main.geo.json */
function geomCandidatesOf(raw: string): string[] {
  const rel = raw.startsWith("models/") || raw.startsWith("models\\") ? raw : `models/${raw}`;
  return [rel, raw, `${rel}.json`, `${rel}.geo.json`, `${raw}.json`, `${raw}.geo.json`];
}

/** 纹理候选路径：缺 textures/ 前缀则补（png/jpg 双格式探测） */
function texCandidatesOf(raw: string): string[] {
  const rel = raw.startsWith("textures/") || raw.startsWith("textures\\") ? raw : `textures/${raw}`;
  return [rel, raw, `${rel}.png`, `${rel}.jpg`, `${raw}.png`, `${raw}.jpg`];
}

/** 末段去扩展名的显示名（无段 / 无扩展名 → ""） */
function basenameNoExt(p: string): string {
  return (
    p
      .split(/[/\\]/)
      .pop()
      ?.replace(/\.[^.]+$/, "") || ""
  );
}

/** manifest 声明的 model 文件按序读取 + 解析，累加骨骼/立方体/纹理尺寸（无骨骼条目跳过） */
async function mergeManifestGeometry(
  meta: YsmManifestMeta,
  readFile: (rel: string) => Promise<Uint8Array | null>,
): Promise<{
  bones: BedrockGeometry["bones"];
  boneCount: number;
  cubeCount: number;
  texWidth: number;
  texHeight: number;
}> {
  const bones: BedrockGeometry["bones"] = [];
  let boneCount = 0;
  let cubeCount = 0;
  let texWidth = 0;
  let texHeight = 0;
  const processed = new Set<string>();

  for (const mf of meta.modelFiles || []) {
    const raw = manifestPathOf(mf, "path");
    if (!raw || processed.has(raw)) continue;
    processed.add(raw);
    const bytes = await readFirstAvailable(readFile, geomCandidatesOf(raw));
    if (!bytes) continue;
    const parsed = parseBedrockGeometryFromJSON(new TextDecoder("utf-8").decode(bytes));
    if (!parsed?.bones?.length) continue;
    bones.push(...parsed.bones);
    boneCount += parsed.boneCount;
    cubeCount += parsed.cubeCount;
    texWidth = Math.max(texWidth, parsed.texWidth);
    texHeight = Math.max(texHeight, parsed.texHeight);
  }
  return { bones, boneCount, cubeCount, texWidth, texHeight };
}

/** manifest 声明的 texture 文件按序读取 → data URI + 去扩展名显示名 */
async function mergeManifestTextures(
  meta: YsmManifestMeta,
  readFile: (rel: string) => Promise<Uint8Array | null>,
): Promise<{ textures: string[]; textureNames: string[] }> {
  const textures: string[] = [];
  const textureNames: string[] = [];
  for (const tf of meta.texFiles || []) {
    const raw = manifestPathOf(tf, "uv");
    if (!raw) continue;
    const bytes = await readFirstAvailable(readFile, texCandidatesOf(raw));
    if (!bytes) continue;
    textures.push(imageDataUri(bytes, imageMimeOfPath(raw)));
    textureNames.push(basenameNoExt(raw));
  }
  return { textures, textureNames };
}

/** 找模型同目录候选预览图（对齐 fileops.FindPreviewImage 的候选顺序） */
export async function webFindPreviewImage(modelPath: string): Promise<string> {
  const slash = modelPath.lastIndexOf("/");
  if (slash <= 0) return "";
  const dir = modelPath.slice(0, slash);
  const files = await listWebModelDirFiles(dir);
  if (!files.length) return "";
  const base = modelPath.slice(slash + 1).replace(/\.[^.]+$/, "") || "";
  const candidates = [`${base}.png`, `${base}.jpg`, "preview.png", "cover.png", "thumbnail.png"];
  for (const c of candidates) {
    const low = c.toLowerCase();
    const hit = files.find((p) => p.split(/[/\\]/).pop()?.toLowerCase() === low);
    if (hit) {
      const uri = await readImageDataUri(hit);
      if (uri) return uri;
    }
  }
  return "";
}

/** 从 zip entries 中取首个 PNG（偏好 textures/ 目录，再回退任意根层 PNG） */
function firstPngFromEntries(
  entries: Record<string, Uint8Array>,
): { key: string; data: Uint8Array } | null {
  const keys = Object.keys(entries);
  const tex = keys.find((k) => /^textures\//i.test(k) && /\.png$/i.test(k));
  const any = keys.find((k) => /\.png$/i.test(k));
  const hit = tex ?? any;
  return hit ? { key: hit, data: entries[hit] } : null;
}

/** 提取 zip/7z/json 的首张预览纹理（对齐 fileops.ExtractPreviewTexture 语义，7z 网页版不支持） */
export async function webExtractPreviewTexture(modelPath: string): Promise<string> {
  const dot = modelPath.lastIndexOf(".");
  const ext = dot >= 0 ? modelPath.slice(dot).toLowerCase() : "";
  if (ext === ".zip") {
    const b64 = await readWebFile(modelPath);
    if (!b64) return "";
    const bytes = base64ToBytes(b64);
    if (!bytes) return "";
    try {
      const { entries } = extractZip(bytes);
      const hit = firstPngFromEntries(entries);
      return hit ? imageDataUri(hit.data, imageMimeOfPath(hit.key)) : "";
    } catch {
      return "";
    }
  }
  if (ext === ".json") {
    const slash = modelPath.lastIndexOf("/");
    const dir = slash > 0 ? modelPath.slice(0, slash) : "";
    const files = dir ? await listWebModelDirFiles(dir) : [];
    for (const p of files) {
      if (!/\.png$/i.test(p)) continue;
      const uri = await readImageDataUri(p);
      if (uri) return uri;
    }
  }
  return "";
}

/** 从 zip entries 挑第一个含 minecraft:geometry 的 JSON key */
function findGeometryEntryKey(entries: Record<string, Uint8Array>): string | null {
  const keys = Object.keys(entries);
  // 优先文件名含 geometry 的条目（Bedrock 命名惯例：geometry.xxx.json）
  const preferredKeys = keys.filter((k) => /geometry/i.test(k));
  // 其次 .geo.json 后缀（Bedrock 压缩 geometry 命名）
  const geoJsonKeys = keys.filter((k) => /\.geo\.json$/i.test(k));
  // 合并优先级队列（preferred → geoJson → 全部 .json）
  const candidates = [
    ...preferredKeys,
    ...geoJsonKeys.filter((k) => !preferredKeys.includes(k)),
    ...keys.filter(
      (k) => /\.json$/i.test(k) && !preferredKeys.includes(k) && !geoJsonKeys.includes(k),
    ),
  ];
  const maxProbe = 1 << 20; // 1MB 探测上限，避免超大 JSON 全量解码
  for (const key of candidates) {
    const data = entries[key].subarray(0, maxProbe);
    try {
      // 快速首字节过滤：Bedrock geometry JSON 以 "{" 开头，先排除明显非 JSON 的二进制。
      // code_review 64749809 #12：须跳过 UTF-8 BOM（EF BB BF，Windows 工具/导出器常见）
      // 与前导空白（20/09/0A/0D）再判首字节——否则合法 BOM/空行前缀 JSON 被静默跳过，
      // geometry 解析失败 fallthrough geo=null（此前按 "minecraft:geometry" 标记全量匹配不受影响）
      let i = 0;
      if (data.length >= 3 && data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf) i = 3;
      while (
        i < data.length &&
        (data[i] === 0x20 || data[i] === 0x09 || data[i] === 0x0a || data[i] === 0x0d)
      ) {
        i++;
      }
      if (data[i] !== 0x7b) continue;
      if (new TextDecoder().decode(data).includes('"minecraft:geometry"')) return key;
    } catch {}
  }
  return null;
}

/** 收集 zip entries 里的全部纹理 data URI + 文件名（按 key 排序，对齐“同序”消费） */
function collectTexturesFromEntries(entries: Record<string, Uint8Array>): {
  textures: string[];
  textureNames: string[];
} {
  const keys = Object.keys(entries)
    .filter((k) => /\.png$/i.test(k))
    .sort((a, b) => a.localeCompare(b));
  const textures: string[] = [];
  const textureNames: string[] = [];
  for (const k of keys) {
    textures.push(imageDataUri(entries[k], imageMimeOfPath(k)));
    textureNames.push(
      k
        .split(/[/\\]/)
        .pop()
        ?.replace(/\.[^.]+$/, "") ?? "",
    );
  }
  return { textures, textureNames };
}

/** 从 BedrockGeometry 组装 Go 契约形状的 BedrockModel（公共字段） */
function toBedrockModelContract(
  geo: BedrockGeometry,
  extras: { textures?: string[]; textureNames?: string[]; animations?: string[] } = {},
): Record<string, unknown> {
  const textures = extras.textures?.length ? extras.textures : undefined;
  return {
    boneCount: geo.boneCount,
    cubeCount: geo.cubeCount,
    texWidth: geo.texWidth,
    texHeight: geo.texHeight,
    bones: geo.bones,
    texture: textures?.[0],
    textures,
    textureNames: extras.textureNames?.length ? extras.textureNames : undefined,
    animations: extras.animations?.length ? extras.animations : undefined,
  };
}

/** 单文件 geometry 嗅探（前 1MB 解码 + "minecraft:geometry" 标记预筛）；不命中 → null */
function probeGeometryBytes(fbytes: Uint8Array): BedrockGeometry | null {
  try {
    const text = new TextDecoder().decode(fbytes.subarray(0, 1 << 20));
    if (!text.includes('"minecraft:geometry"')) return null;
    const parsed = parseBedrockGeometryFromJSON(text);
    return parsed?.bones?.length ? parsed : null;
  } catch {
    return null;
  }
}

/** 同目录扫第一个含 geometry 的 .json（列举顺序；无命中 → null） */
async function findFirstGeometryInDir(files: string[]): Promise<BedrockGeometry | null> {
  for (const p of files) {
    if (!/\.json$/i.test(p)) continue;
    const fb64 = await readWebFile(p);
    if (!fb64) continue;
    const fbytes = base64ToBytes(fb64);
    if (!fbytes) continue;
    const parsed = probeGeometryBytes(fbytes);
    if (parsed) return parsed;
  }
  return null;
}

/** 同目录 PNG → data URI + 去扩展名显示名（按目录列举顺序） */
async function collectDirPngTextures(
  files: string[],
): Promise<{ textures: string[]; textureNames: string[] }> {
  const textures: string[] = [];
  const textureNames: string[] = [];
  for (const p of files) {
    if (!/\.png$/i.test(p)) continue;
    const uri = await readImageDataUri(p);
    if (!uri) continue;
    textures.push(uri);
    textureNames.push(basenameNoExt(p));
  }
  return { textures, textureNames };
}

/** 目录相对路径读字节（manifest 声明的关联文件；读不到 → null） */
async function readWebRelBytes(dir: string, rel: string): Promise<Uint8Array | null> {
  const b64 = await readWebFile(`${dir}/${rel}`);
  return b64 ? base64ToBytes(b64) : null;
}

/** 解析产出三态：geo 未命中即 null；textures/textureNames/animations 缺省为空数组 */
interface BedrockAnalyzeResult {
  geo: BedrockGeometry | null;
  textures: string[];
  textureNames: string[];
  animations: string[];
}

/** 非 .zip/.json 扩展名的空产出（geo null → 上游 return {}） */
const EMPTY_BEDROCK_ANALYZE: BedrockAnalyzeResult = {
  geo: null,
  textures: [],
  textureNames: [],
  animations: [],
};

/** .zip 分支：ysm.json manifest 优先（按声明序合并多角色），未命中回退「首个 geometry」+ 全量纹理 */
async function analyzeZipBedrock(bytes: Uint8Array): Promise<BedrockAnalyzeResult> {
  const { entries } = extractZip(bytes);
  // 先尝试 ysm.json manifest：按声明序合并多角色 geometry + 纹理
  const ysmBytes = findEntryByRel(entries, "ysm.json");
  const manifestMeta = ysmBytes ? parseYsmManifestMeta(ysmBytes) : null;
  let geo = manifestMeta
    ? await mergeBedrockFromManifest(manifestMeta, async (rel) => findEntryByRel(entries, rel))
    : null;
  let textures: string[] = geo?.textures || [];
  let textureNames: string[] = geo?.textureNames || [];
  if (!geo?.bones?.length) {
    const geoKey = findGeometryEntryKey(entries);
    if (geoKey) geo = parseBedrockGeometryFromJSON(new TextDecoder().decode(entries[geoKey]));
    const tex = collectTexturesFromEntries(entries);
    textures = tex.textures;
    textureNames = tex.textureNames;
  }
  const animations = Object.keys(entries)
    .filter((k) => /\.animation\.json$/i.test(k))
    .map((k) => new TextDecoder().decode(entries[k]));
  return { geo, textures, textureNames, animations };
}

/**
 * .json 主文件分支：同目录 ysm.json manifest 优先（按声明序读关联文件合并）。
 * 无 manifest 或 manifest 未命中 → 回退“找第一个 geometry”；纹理独立兜底——
 * manifest 未带纹理时仍扫同目录 PNG。
 */
async function analyzeJsonBedrock(
  bytes: Uint8Array,
  modelPath: string,
): Promise<BedrockAnalyzeResult> {
  const slash = modelPath.lastIndexOf("/");
  const dir = slash > 0 ? modelPath.slice(0, slash) : "";
  const files = dir ? await listWebModelDirFiles(dir) : [];
  // 当前文件若是 ysm.json 且带 manifest → 按声明序合并
  const manifestMeta = parseYsmManifestMeta(bytes);
  const manifestGeo = manifestMeta
    ? await mergeBedrockFromManifest(manifestMeta, (rel) => readWebRelBytes(dir, rel))
    : null;
  const geo = manifestGeo?.bones?.length ? manifestGeo : await findFirstGeometryInDir(files);
  let textures: string[] = manifestGeo?.textures || [];
  let textureNames: string[] = manifestGeo?.textureNames || [];
  if (!textures.length) {
    const tex = await collectDirPngTextures(files);
    textures = tex.textures;
    textureNames = tex.textureNames;
  }
  return { geo, textures, textureNames, animations: [] };
}

/** 按扩展名分派解析分支（.ysm 已在 webAnalyzeBedrockModel 上游短路） */
function analyzeBedrockByExt(
  ext: string,
  bytes: Uint8Array,
  modelPath: string,
): Promise<BedrockAnalyzeResult> | BedrockAnalyzeResult {
  if (ext === ".zip") return analyzeZipBedrock(bytes);
  if (ext === ".json") return analyzeJsonBedrock(bytes, modelPath);
  return EMPTY_BEDROCK_ANALYZE;
}

/** web AnalyzeBedrockModel：.zip 读 IDB→解包→找 geometry JSON→复用户内解析器；.json 扫模型组文件 */
export async function webAnalyzeBedrockModel(modelPath: string): Promise<Record<string, unknown>> {
  const dot = modelPath.lastIndexOf(".");
  const ext = dot >= 0 ? modelPath.slice(dot).toLowerCase() : "";
  if (ext === ".ysm") return {}; // .ysm 仍由前端 WASM 主路径负责，不重复实现二进制解析
  const b64 = await readWebFile(modelPath);
  if (!b64) return {};
  const bytes = base64ToBytes(b64);
  if (!bytes) return {};

  let result: BedrockAnalyzeResult;
  try {
    result = await analyzeBedrockByExt(ext, bytes, modelPath);
  } catch {
    return {};
  }

  if (!result.geo?.bones?.length) return {};
  return toBedrockModelContract(result.geo, {
    textures: result.textures,
    textureNames: result.textureNames,
    animations: result.animations,
  });
}

/** web AnalyzeBedrockModelEntry：按 subPath 从 zip 中定位单角色 geometry（未命中返回空模型） */
export async function webAnalyzeBedrockModelEntry(
  modelPath: string,
  subPath: string,
): Promise<Record<string, unknown>> {
  if (!subPath) return {};
  const dot = modelPath.lastIndexOf(".");
  const ext = dot >= 0 ? modelPath.slice(dot).toLowerCase() : "";
  if (ext !== ".zip") return {};
  const b64 = await readWebFile(modelPath);
  if (!b64) return {};
  const bytes = base64ToBytes(b64);
  if (!bytes) return {};
  try {
    const { entries } = extractZip(bytes);
    const sp = subPath.toLowerCase().replace(/\\/g, "/");
    const hitKey =
      Object.keys(entries).find((k) => k.toLowerCase().replace(/\\/g, "/") === sp) ??
      Object.keys(entries).find((k) => k.toLowerCase().replace(/\\/g, "/").endsWith(`/${sp}`)) ??
      Object.keys(entries).find((k) => {
        const base = k.split(/[/\\]/).pop()?.toLowerCase() ?? "";
        const want = sp.split("/").pop() ?? "";
        return (
          base === want ||
          base.replace(/\.geo\.json$/, "").replace(/\.json$/, "") ===
            want.replace(/\.geo\.json$/, "").replace(/\.json$/, "")
        );
      });
    if (!hitKey || !/\.json$/i.test(hitKey)) return {};
    const geo = parseBedrockGeometryFromJSON(new TextDecoder().decode(entries[hitKey]));
    if (!geo?.bones?.length) return {};
    const tex = collectTexturesFromEntries(entries);
    return toBedrockModelContract(geo, { textures: tex.textures, textureNames: tex.textureNames });
  } catch {
    return {};
  }
}
