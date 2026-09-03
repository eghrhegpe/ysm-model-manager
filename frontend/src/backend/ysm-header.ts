// ===== 网页版 YSM 头部/摘要解析（ExtractYSMHeader / ExtractYSMHeaderFromBase64 / ExtractYsmSummary）=====
// 纯 TS 平移 go/ysm/header.go（scanHeader / AnalyzeYSMHeader / detectYSGPHeader / hasTextHeader）
// + go/ysm/summary.go（ExtractYsmSummary 的 YSGP / zip 内 ysm.json / 裸 ysm.json / zip 降级扫描口径）。
// 范式对齐 ADR-070 nbt-parse.ts（TS 镜像 Go + 测试锁定；I/O 与 binding 装配留在 web-fs.ts，
// 本文件零依赖 web-fs，避免循环引用）。
//
// 消费方（此前三个 binding fail-fast → 静默降级，本实现恢复）：
// - import-queue-data.ts:278  ExtractYSMHeaderFromBase64 → authorName/tips 预填
// - rename.ts:92             ExtractYSMHeader → tips/作者 展示
// - detail.ts:58-62          ExtractYsmSummary + ExtractYSMHeader → 详情卡（stats/license）
// - loader.ts:140            ExtractYsmSummary → 作者兜底
//
// 契约：返回对象（对齐 Wails binding 运行时 JSON.parse 后的形状——YSMHeader / YsmSummary），
// 失败不 reject：头部返回全空 YSMHeader，摘要返回最小空 YsmSummary（对齐 Go internal/app
// app_model.go:41-65 的单返回值签名：错误被吞、返回最小结构，消费方容错）。

import { extractZip } from "./extract.ts";
import { RESOURCE_TYPES } from "../utils/resource/types.ts";

// --- 魔数 / 常量（对齐 header.go:13 ysgpMagic 与 summary.go 各分支）---
const YSGP_MAGIC = "YSGP";
const UTF8_BOM_0 = 0xef;
const UTF8_BOM_1 = 0xbb;
const UTF8_BOM_2 = 0xbf;
/** 头部字节扫描上限（对齐 AnalyzeYSMHeaderFromBytes:326 len>4096 截断） */
const MAX_HEADER_BYTES = 4096;
/** scanHeader 行数上限（对齐 header.go:54 limit < 200） */
const MAX_HEADER_LINES = 200;
/** 几何 JSON 探测上限（对齐 summary.go zip 降级分支 maxGeoJSON 5MB） */
const MAX_GEO_JSON = 5 << 20;
/** 纹理尺寸钳制上限（对齐 go/ysm/texsize.go clampTexDim） */
const MAX_TEX_DIM = 65536;

// ===== 类型（字段名对齐 bindings/ysm-model-manager/go/ysm/models.ts）=====

/** YSMHeader（对齐 go/ysm/header.go:17 YSMHeader json tag） */
export interface YsmHeaderShape {
  isYsm: boolean;
  isFree: boolean;
  hasFree: boolean;
  hash?: string;
  name: string;
  license?: string;
  authorName?: string;
  authorRole?: string;
  authorBilibili?: string;
  authorAfdian?: string;
  linkHome?: string;
  linkUpdate?: string;
  format?: number;
  crypto?: number;
  tips?: string;
}

/** YsmSummary（对齐 go/ysm/summary.go:48 YsmSummary json tag；animGroups/configMenus 一并平移） */
export interface YsmSummaryShape {
  schema: string;
  source: string;
  name: string;
  tips?: string;
  license?: string;
  authors?: Array<{ name: string; roles?: string; bilibili?: string }>;
  links?: { home?: string; donate?: string };
  spec: number;
  format: string;
  size: number;
  stats: { textures: number; models: number; animations: number; texWidth: number; texHeight: number };
  animGroups?: Array<{ id: string; name: string; items: string[] }>;
  configMenus?: Array<{ id: string; name: string; controls: string[] }>;
  preview: { hasGui: boolean; defaultTexture?: string; heightScale?: number; widthScale?: number };
}

/** 空 YSMHeader（对齐 Go YSMHeader{} JSON 形状：isYsm/isFree/hasFree/name 恒输出） */
export function emptyYsmHeader(): YsmHeaderShape {
  return { isYsm: false, isFree: false, hasFree: false, name: "" };
}

/** 最小空 YsmSummary（对齐 Go app 层失败返回 {schema, source} 的最小结构 + 消费方零值容错） */
export function emptyYsmSummary(source: string, size = 0): YsmSummaryShape {
  return {
    schema: "ysm-summary/v1",
    source,
    name: "",
    format: RESOURCE_TYPES.YSM,
    size,
    spec: 0,
    stats: { textures: 0, models: 0, animations: 0, texWidth: 0, texHeight: 0 },
    preview: { hasGui: false },
  };
}

// ===== 文本头部扫描（TS 平移 go/ysm/header.go:46-169 scanHeader）=====

/**
 * 从字节解析 YSM 头部（对齐 AnalyzeYSMHeaderFromBytes + AnalyzeYSMHeader 的 YSGP 合并）：
 * - 超 4096 字节截断（头部在文件开头）
 * - 非 YSGP → scanHeader 纯文本扫描
 * - YSGP（V2）→ isYsm=true + format=2；带文本头部特征时合并文本段非空字段
 *   （YSGP 二进制深度解析按任务要求简化为 isYsm=true + 文本段合并）
 */
export function parseYsmHeaderFromBytes(input: Uint8Array): YsmHeaderShape {
  const bytes = input.length > MAX_HEADER_BYTES ? input.subarray(0, MAX_HEADER_BYTES) : input;
  const rich = scanHeaderFromText(utf8Decode(bytes));
  if (!isYSGPBytes(bytes)) return rich;
  const h: YsmHeaderShape = { ...emptyYsmHeader(), isYsm: true, format: 2 };
  // 纯二进制 YSGP（无文本头部特征）→ 只回基础信息（对齐 AnalyzeYSMHeader:174-222 hasTextHeader 门）
  if (!hasTextHeaderBytes(bytes)) return h;
  mergeHeaderFields(h, rich);
  return h;
}

/** 合并文本段非空字段到 YSGP 头部（对齐 AnalyzeYSMHeader:182-218 合并清单；hash 一并合并——
 *  Go 不合并 hash 系因 detectYSGPHeader 基准不含 hash（顺带丢失文本段 hash），
 *  web 统一路径下保留文本段 hash 更完整，记为与 Go 的差异点） */
function mergeHeaderFields(h: YsmHeaderShape, rich: YsmHeaderShape): void {
  if (rich.name) h.name = rich.name;
  if (rich.hash) h.hash = rich.hash;
  if (rich.license) h.license = rich.license;
  if (rich.authorName) h.authorName = rich.authorName;
  if (rich.authorRole) h.authorRole = rich.authorRole;
  if (rich.authorBilibili) h.authorBilibili = rich.authorBilibili;
  if (rich.authorAfdian) h.authorAfdian = rich.authorAfdian;
  if (rich.linkHome) h.linkHome = rich.linkHome;
  if (rich.linkUpdate) h.linkUpdate = rich.linkUpdate;
  if (rich.tips) h.tips = rich.tips;
  if (rich.format != null && rich.format > 0) h.format = rich.format;
  if (rich.crypto != null && rich.crypto > 0) h.crypto = rich.crypto;
  if (rich.hasFree) {
    h.hasFree = true;
    h.isFree = rich.isFree;
  }
}

/** YSGP 魔数检测（支持 BOM，对齐 summary.go:651 isYSGP） */
function isYSGPBytes(bytes: Uint8Array): boolean {
  let offset = 0;
  if (bytes.length >= 3 && bytes[0] === UTF8_BOM_0 && bytes[1] === UTF8_BOM_1 && bytes[2] === UTF8_BOM_2) {
    offset = 3;
  }
  if (bytes.length < offset + 4) return false;
  return (
    String.fromCharCode(bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]) === YSGP_MAGIC
  );
}

/** 前 512 字节是否含文本头部特征（对齐 header.go:233 hasTextHeader） */
function hasTextHeaderBytes(input: Uint8Array): boolean {
  if (input.length < 16) return false;
  let data = input;
  if (data[0] === UTF8_BOM_0 && data[1] === UTF8_BOM_1 && data[2] === UTF8_BOM_2) data = data.subarray(3);
  let start = 0;
  if (data.length >= 4 && String.fromCharCode(data[0], data[1], data[2], data[3]) === YSGP_MAGIC) {
    start = 4;
  }
  const rest = utf8Decode(data.subarray(start, start + 512)).toLowerCase();
  return rest.includes("--- [") || rest.includes("<name>") || rest.includes("<free>") || rest.includes("metadata");
}

/** scanHeader：逐行扫描文本头部（1:1 平移 header.go:46-169，含注释前缀清理 → tips） */
function scanHeaderFromText(text: string): YsmHeaderShape {
  const h = emptyYsmHeader();
  let currentSection = "";
  const tipsLines: string[] = [];
  const preambleLines: string[] = [];
  let limit = 0;
  const lines = text.split(/\r\n|\n|\r/);
  let i = 0;
  while (i < lines.length && limit < MAX_HEADER_LINES) {
    limit++;
    // 对齐 strings.TrimLeft(line, "\uFEFF")：去除前导 BOM
    const line = lines[i++].replace(/^\uFEFF+/, "");

    if (line === YSGP_MAGIC) {
      h.isYsm = true;
      continue;
    }
    // 段头：--- [Metadata] / [Tips] / [Export] / [Codec] / [SHA-256|Source]
    if (line.startsWith("---") && line.includes("[")) {
      if (line.includes("Metadata")) currentSection = "metadata";
      else if (line.includes("Tips")) currentSection = "tips";
      else if (line.includes("Export")) currentSection = "export";
      else if (line.includes("Codec")) currentSection = "codec";
      else if (line.includes("SHA-256") || line.includes("Source")) currentSection = "source";
      else currentSection = "";
      continue;
    }
    if (line.startsWith("===")) break;
    // 连续的 ---（无 [，len>=10）是段结束分隔符，之后是二进制数据
    if (line.startsWith("---") && !line.includes("[") && line.length >= 10) {
      while (i < lines.length && lines[i].trim() === "") i++;
      break;
    }
    if (line.startsWith("<")) {
      const idx = line.indexOf(">");
      if (idx > 0) {
        const tag = line.slice(1, idx).trim();
        const value = stripClosingTag(line.slice(idx + 1).trim());
        switch (currentSection) {
          case "metadata":
            switch (tag.toLowerCase()) {
              case "name":
                h.name = value;
                break;
              case "free":
                h.isFree = value === "true";
                h.hasFree = true;
                break;
              case "hash":
                h.hash = value;
                break;
              case "license":
                if (value === "") break; // 对齐 Go continue：空值跳过
                h.license = value;
                break;
              case "link-home":
                h.linkHome = value;
                break;
              case "link-update":
              case "link_update":
                h.linkUpdate = value;
                break;
            }
            break;
          case "export":
            break;
          case "codec":
            switch (tag) {
              case "format":
                h.format = parseHeaderInt(value);
                break;
              case "crypto":
                h.crypto = parseHeaderInt(value);
                break;
            }
            break;
        }
      }
      if (currentSection !== "") continue;
    }
    if (currentSection === "tips" && line.trim() !== "") {
      tipsLines.push(line.trim());
    }
    // 段外的 <name>/<role>/<contact-*> 属作者信息（对齐 header.go:132-150）
    if (line.trim().startsWith("<") && line.includes(">")) {
      const trimmed = line.trim();
      const idx = trimmed.indexOf(">");
      if (idx > 0) {
        const tag = trimmed.slice(1, idx).toLowerCase();
        const value = stripClosingTag(trimmed.slice(idx + 1).trim());
        switch (tag) {
          case "name":
            // 对齐 Go `if h.AuthorName == ""`：undefined 视为空（首位作者优先）
            if (!h.authorName) h.authorName = value;
            break;
          case "role":
            h.authorRole = value;
            break;
          case "contact-bilibili":
          case "contact_bilibili":
          case "contactbilibili":
            h.authorBilibili = value;
            break;
          case "contact-afdian":
          case "contact_afdian":
          case "contactafdian":
            h.authorAfdian = value;
            break;
        }
      }
    }
    if (currentSection === "" && line.trim() !== "") {
      preambleLines.push(line);
    }
  }

  if (tipsLines.length > 0) {
    h.tips = tipsLines.join("\n");
  } else if (preambleLines.length > 0) {
    // 无 Tips 段时用前导注释行作 tips，清理 // # ; 前缀（对齐 header.go:158-167）
    h.tips = preambleLines
      .map((l) => {
        let c = l.trim();
        if (c.startsWith("//")) c = c.slice(2);
        else if (c.startsWith("#")) c = c.slice(1);
        else if (c.startsWith(";")) c = c.slice(1);
        return c.trim();
      })
      .join("\n");
  }
  return h;
}

/** 剥离值中的闭合标签： "TestModel</name>" → "TestModel"（对齐 header.go:361 stripClosingTag） */
function stripClosingTag(v: string): string {
  const idx = v.indexOf("</");
  if (idx >= 0) return v.slice(0, idx).trim();
  return v;
}

/** Go-style 严格整数解析（对齐 header.go:332 parseInt：非数字字符 → 0，浮点 "3.14" → 0） */
function parseHeaderInt(s: string): number {
  s = s.trim();
  if (!s) return 0;
  let neg = false;
  let start = 0;
  if (s[0] === "-") {
    neg = true;
    start = 1;
  } else if (s[0] === "+") {
    start = 1;
  }
  let n = 0;
  for (let i = start; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 48 && c <= 57) n = n * 10 + (c - 48);
    else return 0;
  }
  return neg ? -n : n;
}

// ===== 摘要提取（TS 平移 go/ysm/summary.go:135-371 ExtractYsmSummary）=====

/**
 * 从字节提取 YsmSummary（source 为原始文件名）。
 * 分支顺序对齐 Go：YSGP（V2）→ 裸 ysm.json（source 以 .json 结尾）→ zip（PK 头）→ 文本头部。
 * zip 内 ysm.json 解析失败 → throw（web-fs 装配层 catch → 最小空摘要，对齐 Go app 层失败契约）。
 */
export function extractYsmSummaryFromBytes(bytes: Uint8Array, source: string): YsmSummaryShape {
  const out = emptyYsmSummary(source, bytes.length);

  // YSGP（V2）加密二进制 — 无法直接读取内容，返回基本摘要（对齐 summary.go:150-155）
  if (isYSGPBytes(bytes)) {
    out.name = stripExt(source);
    out.spec = 2;
    return out;
  }

  // 裸 ysm.json（解压后的 YSM 模型文件）：直接解析 JSON（对齐 summary.go:158-210）
  if (source.toLowerCase().endsWith(".json")) {
    return bareJsonSummary(bytes, out);
  }

  // ZIP 容器（.ysm / .zip）
  if (isZipBytes(bytes)) {
    return zipSummary(bytes, out);
  }

  // 非 zip → 文本头部 → 基本摘要（网页版增强：Go 对非 zip 走 OpenZipPath 报错）
  const h = scanHeaderFromText(utf8Decode(bytes));
  fillSummaryFromHeader(h, out);
  return out;
}

/** 从文本头部填充基本摘要 */
function fillSummaryFromHeader(h: YsmHeaderShape, out: YsmSummaryShape): void {
  if (h.name) out.name = h.name;
  if (h.tips) out.tips = h.tips;
  if (h.license) out.license = h.license;
  if (h.authorName) {
    const author: { name: string; roles?: string; bilibili?: string } = { name: h.authorName };
    if (h.authorRole) author.roles = h.authorRole;
    if (h.authorBilibili) author.bilibili = h.authorBilibili;
    out.authors = [author];
  }
  if (h.linkHome || h.linkUpdate) {
    const links: { home?: string; donate?: string } = {};
    if (h.linkHome) links.home = h.linkHome;
    out.links = links;
  }
  if (out.name === "") out.name = stripExt(out.source);
}

/** ZIP 魔数检测：PK\x03\x04 / PK\x05\x06（空归档）/ PK\x07\x08（spanned） */
function isZipBytes(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07)
  );
}

/** 裸 ysm.json 分支（对齐 summary.go:158-210：tips 不截断、spec 用解析值） */
function bareJsonSummary(bytes: Uint8Array, out: YsmSummaryShape): YsmSummaryShape {
  const root = parseYsmJsonRoot(bytes);
  out.format = RESOURCE_TYPES.YSM;
  out.spec = toInt(root["spec"]);
  fillSummaryFromRoot(root, out, false);
  if (out.name === "") out.name = stripExt(out.source);
  const properties = asRecord(root["properties"]);
  if (properties) {
    fillPreviewFromProperties(properties, out);
    appendAnimGroupsAndConfigs(properties, out);
  }
  const { stats } = extractFileStats(root["files"]);
  out.stats = stats;
  return out;
}

/** zip 分支（对齐 summary.go:212-370：找 ysm.json/model.json → 解析；无则降级扫描） */
function zipSummary(bytes: Uint8Array, out: YsmSummaryShape): YsmSummaryShape {
  let entries: Record<string, Uint8Array>;
  try {
    entries = extractZip(bytes).entries;
  } catch {
    // 非标准 zip（无中央目录）→ 降级文本扫描（对齐 expandZipFiles 的降级思路）
    const h = scanHeaderFromText(utf8Decode(bytes));
    fillSummaryFromHeader(h, out);
    return out;
  }

  // 查找 ysm.json / model.json（对齐 summary.go:220-227：basename 匹配，大小写不敏感）
  let ysmKey = "";
  for (const key of Object.keys(entries)) {
    const base = (key.split(/[/\\]/).pop() || "").toLowerCase();
    if (base === "ysm.json" || base === "model.json") {
      ysmKey = key;
      break;
    }
  }

  if (!ysmKey) {
    // 无 ysm.json 的 ZIP → 降级扫描生成基本摘要（对齐 summary.go:228-269）
    out.format = "zip";
    out.name = stripExt(out.source);
    out.stats = scanZipFallback(entries);
    return out;
  }

  const root = parseYsmJsonRoot(entries[ysmKey]);
  out.spec = toInt(root["spec"]);
  fillSummaryFromRoot(root, out, true);
  // zip 分支 Name 空值兜底（对齐 summary.go:325-327）
  if (out.name === "") out.name = stripExt(out.source);
  const properties = asRecord(root["properties"]);
  if (properties) {
    fillPreviewFromProperties(properties, out);
    appendAnimGroupsAndConfigs(properties, out);
  }
  // Stats 统计不依赖 properties；纹理尺寸需 properties 存在（对齐 summary.go:338-367）
  const { stats, geoFiles } = extractFileStats(root["files"]);
  if (properties && geoFiles.length > 0) {
    for (const geoPath of geoFiles) {
      const entry = findEntryBySuffix(entries, geoPath);
      if (!entry) continue;
      const { w, h } = extractTexSizeFromGeometryJson(entry);
      if (w > 0 && h > 0) {
        stats.texWidth = w;
        stats.texHeight = h;
        break;
      }
    }
  }
  out.stats = stats;
  return out;
}

/** 解析 ysm.json 根对象；非对象/JSON 畸形 → throw（装配层 catch → 最小空摘要） */
function parseYsmJsonRoot(data: Uint8Array): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(utf8Decode(data));
  } catch {
    throw new Error("ysm.json 解析失败");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("ysm.json 根不是对象");
  }
  return parsed as Record<string, unknown>;
}

/** metadata/properties 提取（zip 与裸 json 分支共用；truncateTips 对齐 zip 分支 200 截断） */
function fillSummaryFromRoot(root: Record<string, unknown>, out: YsmSummaryShape, truncateTips: boolean): void {
  const metadata = asRecord(root["metadata"]);
  if (!metadata) return;
  if (typeof metadata["name"] === "string") out.name = metadata["name"];
  if (typeof metadata["tips"] === "string") {
    out.tips = truncateTips ? truncate(metadata["tips"], 200) : metadata["tips"];
  }
  const license = asRecord(metadata["license"]);
  if (license && typeof license["type"] === "string") out.license = license["type"];
  const authors = metadata["authors"];
  if (Array.isArray(authors)) {
    const list: Array<{ name: string; roles?: string; bilibili?: string }> = [];
    for (const a of authors) {
      if (typeof a !== "object" || a === null) continue;
      const aa = a as Record<string, unknown>;
      const author: { name: string; roles?: string; bilibili?: string } = {
        name: typeof aa["name"] === "string" ? aa["name"] : "",
      };
      if (typeof aa["role"] === "string" && aa["role"] !== "") author.roles = aa["role"];
      const contact = asRecord(aa["contact"]);
      if (contact && typeof contact["bilibili"] === "string" && contact["bilibili"] !== "") {
        author.bilibili = contact["bilibili"];
      }
      list.push(author);
    }
    if (list.length > 0) out.authors = list;
  }
  const link = asRecord(metadata["link"]);
  if (link) {
    const links: { home?: string; donate?: string } = {};
    if (typeof link["home"] === "string" && link["home"] !== "") links.home = link["home"];
    if (typeof link["donate"] === "string" && link["donate"] !== "") links.donate = link["donate"];
    out.links = links;
  }
}

/** properties → preview（对齐 summary.go:330-337） */
function fillPreviewFromProperties(properties: Record<string, unknown>, out: YsmSummaryShape): void {
  const preview: YsmSummaryShape["preview"] = { hasGui: false };
  if (typeof properties["default_texture"] === "string") preview.defaultTexture = properties["default_texture"];
  if (typeof properties["height_scale"] === "number") preview.heightScale = properties["height_scale"];
  if (typeof properties["width_scale"] === "number") preview.widthScale = properties["width_scale"];
  out.preview = preview;
}

/** files.player 统计 + 几何体路径收集（TS 平移 summary.go:473-548 extractFileStats） */
function extractFileStats(filesRaw: unknown): { stats: YsmSummaryShape["stats"]; geoFiles: string[] } {
  const stats: YsmSummaryShape["stats"] = { textures: 0, models: 0, animations: 0, texWidth: 0, texHeight: 0 };
  const geoFiles: string[] = [];
  const files = asRecord(filesRaw);
  if (!files) return { stats, geoFiles };
  const player = asRecord(files["player"]);
  if (!player) return { stats, geoFiles };

  // textures
  const tex = player["texture"];
  if (Array.isArray(tex)) stats.textures = tex.length;

  // animation（对象或数组）
  const anim = player["animation"];
  if (Array.isArray(anim)) stats.animations = anim.length;
  else if (typeof anim === "object" && anim !== null) stats.animations = Object.keys(anim as object).length;

  // model — 同时收集路径（{path} 数组 / 对象 / 字符串数组 / 单字符串，对齐 Go 四种形态）
  const model = player["model"];
  if (Array.isArray(model)) {
    stats.models = model.length;
    if (model.length > 0 && typeof model[0] === "object" && model[0] !== null) {
      for (const m of model) {
        const mp = (m as { path?: unknown }).path;
        if (typeof mp === "string" && mp !== "") geoFiles.push(mp);
      }
    } else if (model.length > 0 && typeof model[0] === "string") {
      for (const s of model) if (s !== "") geoFiles.push(s);
    }
  } else if (typeof model === "object" && model !== null) {
    stats.models = Object.keys(model as object).length;
  } else if (typeof model === "string" && model !== "") {
    stats.models = 1;
    geoFiles.push(model);
  }

  return { stats, geoFiles };
}

/** 无 ysm.json 的 ZIP 降级扫描（TS 平移 summary.go:230-268：几何 JSON / 动画 / 贴图计数） */
function scanZipFallback(entries: Record<string, Uint8Array>): YsmSummaryShape["stats"] {
  const stats: YsmSummaryShape["stats"] = { textures: 0, models: 0, animations: 0, texWidth: 0, texHeight: 0 };
  for (const key of Object.keys(entries)) {
    const low = key.toLowerCase();
    if (low.endsWith(".json")) {
      // 几何体 JSON（含 minecraft:geometry）→ modelCount（5MB 探测上限，对齐 Go）
      const data = entries[key].subarray(0, MAX_GEO_JSON);
      if (utf8Decode(data).includes('"minecraft:geometry"')) {
        stats.models++;
        continue;
      }
      if (low.includes("animation") || low.includes("controller")) stats.animations++;
    } else if (low.endsWith(".png") || low.endsWith(".jpg") || low.endsWith(".jpeg")) {
      stats.textures++;
    }
  }
  return stats;
}

/** 按完整路径后缀找 zip entry（对齐 summary.go:343-345 HasSuffix 匹配） */
function findEntryBySuffix(entries: Record<string, Uint8Array>, suffix: string): Uint8Array | null {
  const suf = suffix.toLowerCase();
  for (const key of Object.keys(entries)) {
    if (key.toLowerCase().endsWith(suf)) return entries[key];
  }
  return null;
}

/** 从几何体 JSON 提取纹理尺寸（TS 平移 summary.go:457-470 extractTexSizeFromGeometry） */
function extractTexSizeFromGeometryJson(data: Uint8Array): { w: number; h: number } {
  try {
    const root = JSON.parse(utf8Decode(data)) as Record<string, unknown>;
    const geom = root["minecraft:geometry"];
    if (!Array.isArray(geom) || geom.length === 0) return { w: 0, h: 0 };
    const desc = asRecord(asRecord(geom[0])?.["description"]);
    if (!desc) return { w: 0, h: 0 };
    const w = clampTexDim(typeof desc["texture_width"] === "number" ? desc["texture_width"] : NaN);
    const h = clampTexDim(typeof desc["texture_height"] === "number" ? desc["texture_height"] : NaN);
    return { w, h };
  } catch {
    return { w: 0, h: 0 };
  }
}

/** 纹理尺寸钳制（对齐 go/ysm/texsize.go clampTexDim：[0, 65536] + NaN/Inf → 0） */
function clampTexDim(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v <= 0) return 0;
  if (v >= MAX_TEX_DIM) return MAX_TEX_DIM;
  return Math.trunc(v);
}

/** 动画分组 + 配置菜单（TS 平移 summary.go:376-452 appendAnimGroupsAndConfigs） */
function appendAnimGroupsAndConfigs(properties: Record<string, unknown>, out: YsmSummaryShape): void {
  const classify = properties["extra_animation_classify"];
  if (Array.isArray(classify)) {
    for (const g of classify) {
      if (typeof g !== "object" || g === null) continue;
      const gg = g as Record<string, unknown>;
      let name = typeof gg["name"] === "string" ? gg["name"] : "";
      const extraAnim = gg["extra_animation"];
      // name 为空时从 properties.extra_animation 按 #id 查找（对齐 summary.go:385-394）
      if (!name && extraAnim !== undefined) {
        const eaMap = asRecord(extraAnim);
        const v = eaMap?.["#" + (typeof gg["id"] === "string" ? gg["id"] : "")];
        if (typeof v === "string") name = v;
      }
      // 用 extra_animation 的 value（中文名）替换 raw id（对齐 summary.go:396-399）
      const displayItems = extractDisplayValues(extraAnim);
      if (displayItems.length === 0) continue; // 全是内部引用（#开头）时跳过整组
      out.animGroups = out.animGroups || [];
      out.animGroups.push({ id: typeof gg["id"] === "string" ? gg["id"] : "", name, items: displayItems });
    }
  }

  // 兜底：extra_animation 中未被分类的直接动画（对齐 summary.go:411-441）
  const extraAnim = properties["extra_animation"];
  if (extraAnim !== undefined) {
    const eaMap = asRecord(extraAnim);
    if (eaMap) {
      const classifiedItems = new Set<string>();
      if (Array.isArray(classify)) {
        for (const g of classify) {
          const ge = asRecord(asRecord(g)?.["extra_animation"]);
          if (ge) for (const k of Object.keys(ge)) classifiedItems.add(k);
        }
      }
      const looseAnims: string[] = [];
      for (const [k, v] of Object.entries(eaMap)) {
        if (typeof v === "string" && v !== "" && !v.startsWith("#")) {
          if (k.startsWith("#")) continue; // 组名跳过
          if (!classifiedItems.has(k)) looseAnims.push(v);
        }
      }
      if (looseAnims.length > 0) {
        out.animGroups = out.animGroups || [];
        out.animGroups.push({ id: "_loose", name: "其他动画", items: looseAnims });
      }
    }
  }

  // 配置菜单（extra_animation_buttons → 模型配置/自定义表情，对齐 summary.go:443-451）
  const buttons = properties["extra_animation_buttons"];
  if (Array.isArray(buttons)) {
    for (const b of buttons) {
      if (typeof b !== "object" || b === null) continue;
      const bb = b as Record<string, unknown>;
      out.configMenus = out.configMenus || [];
      out.configMenus.push({
        id: typeof bb["id"] === "string" ? bb["id"] : "",
        name: typeof bb["name"] === "string" ? bb["name"] : "",
        controls: extractControlTypes(bb["config_forms"]),
      });
    }
  }
}

/** 从 extra_animation map 提取非 # 引用的中文显示名（对齐 summary.go:578-598） */
function extractDisplayValues(raw: unknown): string[] {
  const obj = asRecord(raw);
  if (!obj) return [];
  const result: string[] = [];
  for (const v of Object.values(obj)) {
    if (typeof v === "string" && v !== "" && !v.startsWith("#")) result.push(v);
  }
  return result;
}

/** 从 config_forms 提取控件类型摘要（对齐 summary.go:616-639） */
function extractControlTypes(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const types: string[] = [];
  for (const f of raw) {
    const m = asRecord(f);
    if (!m) continue;
    const t = typeof m["type"] === "string" ? m["type"] : "";
    types.push(t === "" ? "unknown" : t);
  }
  return types;
}

// ===== 工具函数 =====

const _utf8 = new TextDecoder("utf-8");

function utf8Decode(bytes: Uint8Array): string {
  try {
    return _utf8.decode(bytes);
  } catch {
    return "";
  }
}

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
}

/** 对齐 Go int：number 取整，非数字 → 0 */
function toInt(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : 0;
}

/** 去扩展名（对齐 Go strings.TrimSuffix(source, filepath.Ext(source))） */
function stripExt(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

/** 按 rune 截断（对齐 summary.go:642 truncate：超长补 "..."，避免中文按字节截断乱码） */
function truncate(s: string, max: number): string {
  const runes = [...s];
  if (runes.length <= max) return s;
  return runes.slice(0, max).join("") + "...";
}
