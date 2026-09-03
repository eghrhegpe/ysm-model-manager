// ===== web-fs Bedrock 预览 fallback 链（ADR-040 拆分延续，自 web-fs.ts #5 拆出）=====
// FindPreviewImage / ExtractPreviewTexture / AnalyzeBedrockModel / AnalyzeBedrockModelEntry
// 的 web 实现：.zip 读 IDB → 解包 → 找 geometry JSON → 复用前端解析器
// （parseBedrockGeometryFromJSON / parseYsmJsonDirect，preview-3d/decoder）；.json 扫模型组文件。
// 共享读取装配与路径反解（readWebFile / readWebZipEntries / listWebModelDirFiles）来自
// web-fs-read.ts 叶子——断对 web-fs.ts 主文件的循环依赖。

import { base64ToBytes, u8ToBase64 } from "./web-common.ts";
import { extractZip } from "../parsers/extract.ts";
import { safeErrorMessage } from "../utils/safe-error-msg.ts";
import { parseBedrockGeometryFromJSON, type BedrockGeometry } from "../preview-3d/decoder/geometry.ts";
import { parseYsmJsonDirect } from "../preview-3d/decoder/parse-ysm-json.ts";
import { readWebFile, listWebModelDirFiles } from "./web-fs-read.ts";

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
    return meta && meta.modelFiles?.length ? meta : null;
  } catch (err) {
    // 静默吞异常曾导致 ysm.json 结构不符时无任何线索（69ab1f03 code review）；
    // 此处留 warn 便于排查，null 语义不变（降级走单 geometry 路径）
    console.warn("[web-fs] parseYsmManifestMeta 解析失败，降级单 geometry:", safeErrorMessage(err));
    return null;
  }
}

/**
 * 按 ysm.json manifest 声明序合并多 geometry（对齐 wasm.ts mdWsHandleYsmJsonSpec 的合并规则）。
 * @param meta parseYsmJsonDirect 输出的 _ysmMeta（texFiles 已按 default_texture 置首）
 * @param readFile 相对路径读取器；zip 用 entries 查表，解压目录用 IDB 读文件
 */
async function mergeBedrockFromManifest(
  meta: YsmManifestMeta,
  readFile: (rel: string) => Promise<Uint8Array | null>,
): Promise<BedrockGeometry | null> {
  const allBones: BedrockGeometry["bones"] = [];
  let boneCount = 0;
  let cubeCount = 0;
  let maxTexW = 0;
  let maxTexH = 0;
  const processed = new Set<string>();

  for (const mf of meta.modelFiles || []) {
    const raw = typeof mf === "string" ? mf : (mf as { path?: string })?.path || "";
    if (!raw || processed.has(raw)) continue;
    processed.add(raw);
    const rel = raw.startsWith("models/") || raw.startsWith("models\\")
      ? raw
      : "models/" + raw;
    // 兼容 manifest 里只写 baseName（如 "main"）而磁盘上是 main.json / main.geo.json
    const candidates = [rel, raw, rel + ".json", rel + ".geo.json", raw + ".json", raw + ".geo.json"];
    let bytes: Uint8Array | null = null;
    for (const c of candidates) {
      bytes = await readFile(c);
      if (bytes) break;
    }
    if (!bytes) continue;
    const parsed = parseBedrockGeometryFromJSON(new TextDecoder("utf-8").decode(bytes));
    if (!parsed?.bones?.length) continue;
    allBones.push(...parsed.bones);
    boneCount += parsed.boneCount;
    cubeCount += parsed.cubeCount;
    maxTexW = Math.max(maxTexW, parsed.texWidth);
    maxTexH = Math.max(maxTexH, parsed.texHeight);
  }

  if (!allBones.length) return null;

  const textures: string[] = [];
  const textureNames: string[] = [];
  for (const tf of meta.texFiles || []) {
    const raw = typeof tf === "string" ? tf : (tf as { uv?: string })?.uv || "";
    if (!raw) continue;
    const rel = raw.startsWith("textures/") || raw.startsWith("textures\\")
      ? raw
      : "textures/" + raw;
    const candidates = [rel, raw, rel + ".png", rel + ".jpg", raw + ".png", raw + ".jpg"];
    let bytes: Uint8Array | null = null;
    for (const c of candidates) {
      bytes = await readFile(c);
      if (bytes) break;
    }
    if (!bytes) continue;
    textures.push(imageDataUri(bytes, imageMimeOfPath(raw)));
    textureNames.push(raw.split(/[/\\]/).pop()?.replace(/\.[^.]+$/, "") || "");
  }

  return {
    bones: allBones,
    boneCount,
    cubeCount,
    texWidth: maxTexW,
    texHeight: maxTexH,
    textures,
    textureNames,
  };
}

/** 找模型同目录候选预览图（对齐 fileops.FindPreviewImage 的候选顺序） */
export async function webFindPreviewImage(modelPath: string): Promise<string> {
  const slash = modelPath.lastIndexOf("/");
  if (slash <= 0) return "";
  const dir = modelPath.slice(0, slash);
  const files = await listWebModelDirFiles(dir);
  if (!files.length) return "";
  const base = modelPath.slice(slash + 1).replace(/\.[^.]+$/, "") || "";
  const candidates = [
    `${base}.png`,
    `${base}.jpg`,
    "preview.png",
    "cover.png",
    "thumbnail.png",
  ];
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
function firstPngFromEntries(entries: Record<string, Uint8Array>): { key: string; data: Uint8Array } | null {
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
  const maxProbe = 1 << 20; // 1MB 探测上限，避免超大 JSON 全量解码
  for (const key of Object.keys(entries)) {
    if (!/\.json$/i.test(key)) continue;
    const data = entries[key].subarray(0, maxProbe);
    try {
      if (new TextDecoder().decode(data).includes('"minecraft:geometry"')) return key;
    } catch {
      continue;
    }
  }
  return null;
}

/** 收集 zip entries 里的全部纹理 data URI + 文件名（按 key 排序，对齐“同序”消费） */
function collectTexturesFromEntries(entries: Record<string, Uint8Array>): { textures: string[]; textureNames: string[] } {
  const keys = Object.keys(entries).filter((k) => /\.png$/i.test(k)).sort((a, b) => a.localeCompare(b));
  const textures: string[] = [];
  const textureNames: string[] = [];
  for (const k of keys) {
    textures.push(imageDataUri(entries[k], imageMimeOfPath(k)));
    textureNames.push(k.split(/[/\\]/).pop()?.replace(/\.[^.]+$/, "") ?? "");
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

/** web AnalyzeBedrockModel：.zip 读 IDB→解包→找 geometry JSON→复用户内解析器；.json 扫模型组文件 */
export async function webAnalyzeBedrockModel(modelPath: string): Promise<Record<string, unknown>> {
  const dot = modelPath.lastIndexOf(".");
  const ext = dot >= 0 ? modelPath.slice(dot).toLowerCase() : "";
  if (ext === ".ysm") return {}; // .ysm 仍由前端 WASM 主路径负责，不重复实现二进制解析
  const b64 = await readWebFile(modelPath);
  if (!b64) return {};
  const bytes = base64ToBytes(b64);
  if (!bytes) return {};

  let geo: BedrockGeometry | null = null;
  let textures: string[] = [];
  let textureNames: string[] = [];
  let animations: string[] = [];

  try {
    if (ext === ".zip") {
      const { entries } = extractZip(bytes);
      // 先尝试 ysm.json manifest：按声明序合并多角色 geometry + 纹理
      const ysmBytes = findEntryByRel(entries, "ysm.json");
      const manifestMeta = ysmBytes ? parseYsmManifestMeta(ysmBytes) : null;
      if (manifestMeta) {
        geo = await mergeBedrockFromManifest(manifestMeta, async (rel) => findEntryByRel(entries, rel));
        if (geo) {
          textures = geo.textures || [];
          textureNames = geo.textureNames || [];
        }
      }
      if (!geo?.bones?.length) {
        const geoKey = findGeometryEntryKey(entries);
        if (geoKey) geo = parseBedrockGeometryFromJSON(new TextDecoder().decode(entries[geoKey]));
        const tex = collectTexturesFromEntries(entries);
        textures = tex.textures;
        textureNames = tex.textureNames;
      }
      animations = Object.keys(entries)
        .filter((k) => /\.animation\.json$/i.test(k))
        .map((k) => new TextDecoder().decode(entries[k]));
    } else if (ext === ".json") {
      const slash = modelPath.lastIndexOf("/");
      const dir = slash > 0 ? modelPath.slice(0, slash) : "";
      const files = dir ? await listWebModelDirFiles(dir) : [];
      // 当前文件若是 ysm.json 且带 manifest → 按声明序合并
      const manifestMeta = parseYsmManifestMeta(bytes);
      if (manifestMeta) {
        geo = await mergeBedrockFromManifest(manifestMeta, async (rel) => {
          const p = `${dir}/${rel}`;
          const b64 = await readWebFile(p);
          return b64 ? base64ToBytes(b64) : null;
        });
        if (geo) {
          textures = geo.textures || [];
          textureNames = geo.textureNames || [];
        }
      }
      // 无 manifest 或 manifest 未命中 → 回退“找第一个 geometry”
      if (!geo?.bones?.length) {
        for (const p of files) {
          if (!/\.json$/i.test(p)) continue;
          const fb64 = await readWebFile(p);
          if (!fb64) continue;
          const fbytes = base64ToBytes(fb64);
          if (!fbytes) continue;
          try {
            const text = new TextDecoder().decode(fbytes.subarray(0, 1 << 20));
            if (text.includes('"minecraft:geometry"')) {
              const parsed = parseBedrockGeometryFromJSON(text);
              if (parsed?.bones?.length) { geo = parsed; break; }
            }
          } catch {
            continue;
          }
        }
      }
      if (textures.length === 0) {
        for (const p of files) {
          if (!/\.png$/i.test(p)) continue;
          const uri = await readImageDataUri(p);
          if (uri) {
            textures.push(uri);
            textureNames.push(p.split(/[/\\]/).pop()?.replace(/\.[^.]+$/, "") ?? "");
          }
        }
      }
    }
  } catch {
    return {};
  }

  if (!geo?.bones?.length) return {};
  return toBedrockModelContract(geo, {
    textures,
    textureNames,
    animations,
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
    const hitKey = Object.keys(entries).find((k) => k.toLowerCase().replace(/\\/g, "/") === sp)
      ?? Object.keys(entries).find((k) => k.toLowerCase().replace(/\\/g, "/").endsWith("/" + sp))
      ?? Object.keys(entries).find((k) => {
          const base = k.split(/[/\\]/).pop()?.toLowerCase() ?? "";
          const want = sp.split("/").pop() ?? "";
          return base === want || base.replace(/\.geo\.json$/, "").replace(/\.json$/, "") === want.replace(/\.geo\.json$/, "").replace(/\.json$/, "");
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
