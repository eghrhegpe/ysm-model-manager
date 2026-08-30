// ===== 网页版文件系统职责（ADR-040 拆分：browser-adapter.ts 职责切分产物）=====
// 文件系统类操作：IndexedDB 虚拟根 /web 的扫描/读写/删除/重命名/子目录映射。
// 被 web-store（标签聚合扫描）与 web-community（作者扫描/仓库索引）复用；
// browser-adapter.ts 从本文件 import 组装 webImpls。
// 共享原语（WebUnsupportedError / WEB_ROOT / MAX_IMPORT_BYTES / arrayBufferToBase64）
// 见 web-common.ts。拆分子模块（本文件门面 re-export 保持公共 API 原路径不变）：
//   - web-fs-shared.ts   key 规约 + 主文件优先级（叶子，断 auth↔import↔主文件 循环）
//   - web-fs-import.ts   导入分组（§15：zip 展平 / 粗细分组 / 写入回滚）
//   - web-fs-auth.ts     FSA 授权本地仓库（§3：句柄持久化 / 授权态 / 重扫入库）
//
// ┌─ 快速跳转 ───────────────────────────────────────────────────────────────────┐
// │  §1  key 规约 + 主文件优先级 → web-fs-shared.ts                               │
// │  §3  FSA 授权持久化      → web-fs-auth.ts                                    │
// │  §4  模型库扫描           → 下文    scanWebModels / scanAllWebModels           │
// │  §5  文件读取            → 下文    readWebFile                                 │
// │  §6  NBT/体素 meta 读取   → 下文    readVoxelJson / readNbtMetaJson           │
// │  §7  pack/shaderpack 读取 → 下文    readPackMetaJson / readShaderpackLangJson │
// │  §8  路径解析            → 下文    parseWebModelPath / parseWebModelDir       │
// │  §9  列表                → 下文    listWebModelDirFiles                       │
// │  §10 搜索                → 下文    searchWebModels                            │
// │  §11 重命名              → 下文    assertValidRenameName / renameWebDir/File  │
// │  §12 删除               → 下文    deleteWebModel                              │
// │  §13 移动/复制          → 下文    rekeyWebModelGroup / moveOrCopyWebModel    │
// │  §14 子目录映射          → 下文    getWebSubDirMap / collectAllWebEntries     │
// │  §15 导入分组            → web-fs-import.ts                                   │
// │  §16 binding 装配        → 下文    webFsBindings（Top 6 注册表驱动）           │
// └──────────────────────────────────────────────────────────────────────────────┘
import { idbGet, idbSet, idbKeys, idbDel } from "./idb.ts";
import { safeErrorMessage } from "../utils/safe-error-msg.ts";
import { t } from "../core/i18n/t.ts";
import type { ModelEntry } from "../../bindings/ysm-model-manager/go/types/models.ts";
// 复用 dnd-shared 的导入白名单（.json 仅放行 ysm.json，其余须 ALL_EXTS 成员），
// 避免 browser-adapter 另起一套扩展名校验导致漂移
import resourceTypesJson from "../../../resource_types.json" with { type: "json" };
// rtype 魔法字符串统一走 RESOURCE_TYPES 常量（治理红线 R7）
import { RESOURCE_TYPES, resolveTypeSafe } from "../utils/resource/types.ts";
import { arrayBufferToBase64, base64ToBytes, parseWebPath, parseWebDirPath, webDirType, isWebPath, WEB_ROOT, MAX_IMPORT_BYTES } from "./web-common.ts";
// R2 导入增强：detectZipType 供 DetectResourceType 歧义容器内容指纹（ADR-066 web 识别层）
import { extractZip, detectZipType } from "./extract.ts";
// ADR-070 M1：蓝图/投影 meta 读取（NBT 解析 + 三个视图提取，TS 平移 go/litematic/parser.go）
import { parseNbtRoot, litematicMetaView, nbtStructureView, schematicSummaryView } from "./nbt-parse.ts";
// ADR-070 M2：蓝图/投影 voxel 读取（TS 平移 go/litematic/voxel.go；parseNbtRootExact 提供
// LongArray 精确 64 位——BlockStates 打包位解码必需，number 归一会丢低 10 位）
import { parseNbtRootExact } from "./nbt-parse.ts";
import { litematicVoxelView, nbtVoxelView, schematicVoxelView, decodeVoxelNbt, type VoxelData } from "./voxel-parse.ts";
// 资源包/光影包详情 meta 读取（TS 平移 go/packs/mcmeta.go 的解析层；binding 装配见下方
// webFsBindings 的 ReadPackMeta/ReadShaderpackLang 条目——读 IDB → 解 zip → 本文件纯解析）
import { findZipEntry, parsePackMetaJson, parseShaderpackLang, packPngToThumbnail } from "./pack-meta.ts";
// #5：Bedrock 纯解析复用（geometry.ts 是完全前端的 JSON→BedrockGeometry 解析器）
import { parseBedrockGeometryFromJSON, type BedrockGeometry } from "../views/app-preview/geometry.ts";
import { parseYsmJsonDirect } from "../views/app-preview/parse-ysm-json.ts";
// YSM 头部/摘要 binding web 实现（TS 平移 go/ysm/header.go + summary.go；纯解析在
// ysm-header.ts，本文件只做 IDB 读取装配。消费方：import-queue-data.ts:278 作者/tips
// 预填、rename.ts:92 重命名 tips、detail.ts:58-62 详情 stats/license、loader.ts:140 作者兜底）
import {
  parseYsmHeaderFromBytes,
  extractYsmSummaryFromBytes,
  emptyYsmHeader,
  emptyYsmSummary,
} from "./ysm-header.ts";
// ADR-071 #6：SearchModels 数值条件的统计来源 —— Web Worker 批量统计
// （Worker 内独立加载 WASM + open IndexedDB，主线程零解析负载；不可用/失败降级）
import { batchStatsWebModels, type WebModelStats } from "./web-stats.ts";
// 拆分子模块（ADR-040 职责切分延续）
import { dirKey, fileKey, mainFileRank, MAIN_FILE_RANK_NONE, MAIN_FILE_RANK_TYPE } from "./web-fs-shared.ts";
import { getFsaAuthState, reauthorizeFsaRoot, rescanFsaRoot, selectLocalRepo } from "./web-fs-auth.ts";

// 公共 API 原路径透出（browser-adapter / web-store / web-community 消费面零改动）：
// importWebFiles 主文件不再直接消费（FSA 入库走 web-fs-auth），仅门面转出
export { importWebFiles } from "./web-fs-import.ts";
export { getFsaAuthState, reauthorizeFsaRoot, rescanFsaRoot, selectLocalRepo } from "./web-fs-auth.ts";

// ===== §1 key 规约 → web-fs-shared.ts =====

/** 从 /web/<type>/... 提取类型段（ScanModelEntries 参数语义） */
export function typeFromWebDir(dir: string): string {
  return webDirType(dir) || RESOURCE_TYPES.YSM;
}

// ===== §4 模型库扫描 =====
// --- 模型库扫描（IDB dir: 前缀 → ModelEntry 列表）---
// 与 Go ScanModelEntries 对齐：dir 可以是仓库根（/web/<type>），也可以是仓库内的
// 子目录/模型组目录。根目录按模型组返回主文件条目（网页版既有语义）；非根目录
// 递归列出该目录下主文件，避免批量重命名等消费方拿到全库条目。
export async function scanWebModels(dir: string): Promise<ModelEntry[]> {
  const type = typeFromWebDir(dir);
  const normalized = dir.replace(/\/+$/, "") || dir;
  if (normalized === `${WEB_ROOT}/${type}`) {
    return scanWebModelGroups(type, normalized);
  }
  return scanWebModelFilesInDir(normalized);
}

/** 根目录扫描：每个模型组收敛为一条主文件 ModelEntry */
async function scanWebModelGroups(type: string, root: string): Promise<ModelEntry[]> {
  const keys = await idbKeys("files", `dir:${type}/`);
  const entries: ModelEntry[] = [];
  for (const k of keys) {
    const meta = await idbGet<{ name: string; addedAt: number }>("files", k);
    const name = meta?.name ?? k.slice(`dir:${type}/`.length, -1);
    // 汇总该模型全部文件大小；Path/Name 指向主文件（含扩展名，与桌面
    // scanner.go:136 Name=filepath.Base(p) 含扩展名、Ext=原扩展名一致——
    // 否则 loader.ts 的 name.endsWith(ext) 过滤会恒失败使列表为空）。
    // 主文件优先选 .ysm/.zip/.json，避免多文件模型误选首文件（如 a_tex.png）
    // 导致解码失败；孤儿 dir key（文件被删）无主文件则跳过，避免 Path 以 / 结尾。
    const fileKeys = await idbKeys("files", `file:${type}/${name}/`);
    let size = 0;
    let mainRel = "";
    let mainRank = 0;
    for (const fk of fileKeys) {
      const f = await idbGet<{ size: number }>("files", fk);
      size += f?.size ?? 0;
      const rel = fk.slice(`file:${type}/${name}/`.length);
      // 嵌套 rel（含 /，如 tex/face.png）不参与主文件竞争：主文件必须在模型组根层
      // （对齐桌面目录模型：组根放 ysm.json/main.json，子目录为纹理/附属资源）
      const rank = rel.includes("/") ? MAIN_FILE_RANK_NONE : mainFileRank(rel);
      if (rank > mainRank) {
        mainRank = rank;
        mainRel = rel;
      }
    }
    // 仅 .ysm / ysm.json 可作主文件（对齐桌面 IsYsmEntryJSON 白名单）；其余（如 a.json 动作文件）
    // 不得当主文件，避免多文件模型误选导致预览解码失败
    if (mainRank < MAIN_FILE_RANK_TYPE) continue;
    // Ext 与桌面一致：小写化 + 无点号保护（lastIndexOf=-1 时 slice(-1) 会取 "E" 之类的字符）
    const dot = mainRel.lastIndexOf(".");
    const ext = dot > 0 ? mainRel.slice(dot).toLowerCase() : "";
    // ADR-096：subdir 仅作元数据保留，不参与 Path 拼接。
    // 网页版 name 已含子目录路径（如 "SceneModel/角色A"），无需额外提取。
    const nameParts = name.split("/");
    const subDir = nameParts.length > 1 ? nameParts[0] : "";
    entries.push({
      Name: mainRel,
      Size: size,
      Path: `${root}/${name}/${mainRel}`,
      Ext: ext,
      Hash: "",
      ModTime: meta?.addedAt ?? Date.now(),
      HasTags: false,
      subdir: subDir,
    });
  }
  // 与桌面扫描一致：按名称排序，稳定输出
  entries.sort((a, b) => a.Name.localeCompare(b.Name, "zh-CN"));
  return entries;
}

/** 非根目录扫描：列出该目录内（含子目录）主文件条目，供子目录/批量重命名等场景使用 */
async function scanWebModelFilesInDir(dir: string): Promise<ModelEntry[]> {
  const files = await listWebModelDirFiles(dir);
  const entries: ModelEntry[] = [];
  for (const p of files) {
    const pm = await parseWebModelPath(p);
    if (!pm) continue;
    const fk = fileKey(pm.type, pm.name, pm.rel);
    const f = await idbGet<{ size: number }>("files", fk);
    if (mainFileRank(pm.rel) < MAIN_FILE_RANK_TYPE) continue;
    const dot = pm.rel.lastIndexOf(".");
    const ext = dot > 0 ? pm.rel.slice(dot).toLowerCase() : "";
    const meta = await idbGet<{ addedAt: number }>("files", dirKey(pm.type, pm.name));
    entries.push({
      Name: p.split(/[/\\]/).pop() || pm.rel,
      Size: f?.size ?? 0,
      Path: p,
      Ext: ext,
      Hash: "",
      ModTime: meta?.addedAt ?? Date.now(),
      HasTags: false,
    });
  }
  entries.sort((a, b) => a.Name.localeCompare(b.Name, "zh-CN"));
  return entries;
}

// ===== §5 文件读取（readWebFile）=====
/** 读文件（/web/<type>/<rest> → IDB → base64；wasm.ts 解码链零改动复用）
 *  模型组 name 与组内 rel 在 file key 中无缝拼接（file:<type>/<name>/<rel>），
 *  多段 name（目录树，如 /web/ysm/分类1/狐狸/狐狸.ysm）无需拆分边界：
 *  直接以 <type> 后全部路径段作 key（对齐 MikuMikuAR dir key 匹配模式）。 */
export async function readWebFile(path: string): Promise<string | null> {
  const pm = parseWebPath(path);
  if (!pm) return null;
  const f = await idbGet<{ data: ArrayBuffer }>("files", `file:${pm.type}/${pm.rest}`);
  if (!f) return null;
  return arrayBufferToBase64(f.data);
}

/**
 * ADR-070 M2：蓝图/投影 voxel binding 公共读取骨架（TS 平移 go/litematic/voxel.go 的
 * openGzRoot + BuildVoxelData/BuildNbtVoxelData/BuildSchematicVoxelData + internal/app
 * marshalVoxelData）。读 IDB → base64 → 字节 → parseNbtRootExact → voxelView → JSON 字符串。
 * 任何一步失败（文件缺失 / 畸形 NBT / 视图判定无效）→ "{}"（对齐 Go binding 契约：
 * marshalVoxelData error → "{}"）。
 * 体素渲染上限对齐 internal/app/resource_bindings.go voxelMaxBlocks 默认 200000
 * （网页版无 AppConfig，直接用默认值）。
 */
const VOXEL_MAX_BLOCKS = 200000;

async function readVoxelJson(
  path: string,
  view: (root: Record<string, unknown>, maxBlocks: number) => VoxelData | null,
): Promise<string> {
  try {
    const b64 = await readWebFile(path);
    if (!b64) return voxelErrorJson("文件读取失败或不存在");
    // IO（读文件）与解码（b64 → NBT root）解耦：decodeVoxelNbt 为纯函数
    // （voxel-parse.ts），此处只做装配——读文件 → 纯解码 → 纯视图 → 契约化 JSON
    return voxelToJson(b64, view);
  } catch (err) {
    // 对齐 Go marshalVoxelData 的 {error} 契约：失败带具体原因，
    // 前端可区分「解析失败」与「空数据」，不再吞成 "{}"
    return voxelErrorJson(safeErrorMessage(err));
  }
}

/** 体素失败契约 JSON：{"error": string}（对齐 Go internal/app voxelErrorJSON） */
function voxelErrorJson(msg: string): string {
  try {
    return JSON.stringify({ error: msg });
  } catch {
    return '{"error":"json stringify failed"}';
  }
}

/** 体素装配：b64 → 解码 → 视图 → 契约化 JSON（readVoxelJson / readWebVoxelInContainer 共用段）。
 *  失败返回 {"error"} 契约（解码失败 / 视图判定无效），消除两处重复（jscpd）。 */
function voxelToJson(
  b64: string,
  view: (root: Record<string, unknown>, maxBlocks: number) => VoxelData | null,
): string {
  const root = decodeVoxelNbt(b64);
  if (!root) return voxelErrorJson("文件解码失败");
  const data = view(root, VOXEL_MAX_BLOCKS);
  if (!data) return voxelErrorJson("无法解析为有效的体素结构（格式不支持或字段缺失）");
  return JSON.stringify(data);
}

/** zip 容器读取装配：readWebFile → base64 → extractZip（失败返回 null，调用方转 "[]"）。
 *  listWebContainerEntries / listWebPackModels 共用前缀，消除重复（jscpd）。 */
async function readWebZipEntries(path: string): Promise<ReturnType<typeof extractZip>["entries"] | null> {
  const b64 = await readWebFile(path);
  if (!b64) return null;
  const bytes = base64ToBytes(b64);
  if (!bytes) return null;
  return extractZip(bytes).entries;
}
// ===== §6.5 容器内条目枚举 + 体素读取（ADR-132 遗留 1：蓝图/litematic zip 多 nbt 预览）=====
// 镜像 Go internal/app/container_entries.go 的 ListContainerEntries / GetVoxelDataInContainer：
// 读 IDB → base64 → 字节 → extractZip → 按扩展名白名单过滤（ListContainerEntries）；
// 容器内条目 → findZipEntry → 字节 → decodeVoxelNbt → voxelView（GetVoxelDataInContainer）。
// 失败契约对齐 Go：枚举失败 → "[]"；体素失败 → {"error": string}。

/** 容器内条目扩展名白名单（对齐 litematic-3d.ts CONTAINER_VOXEL_EXTS） */
const CONTAINER_VOXEL_EXTS = new Set([".nbt", ".litematic", ".schematic"]);

/** 镜像 Go parseContainerExts：逗号分隔扩展名白名单（无点前缀自动补；空 → 放行全部） */
function webParseContainerExts(exts: string): Set<string> {
  const out = new Set<string>();
  for (const e of exts.split(",")) {
    const e2 = e.trim().toLowerCase();
    if (!e2) continue;
    out.add(e2.startsWith(".") ? e2 : "." + e2);
  }
  return out;
}

/** 镜像 Go containerExtMatch：条目名扩展名是否在白名单内（大小写不敏感） */
function webContainerExtMatch(name: string, exts: Set<string>): boolean {
  if (exts.size === 0) return true;
  const i = name.lastIndexOf(".");
  if (i < 0) return false;
  return exts.has(name.slice(i).toLowerCase());
}

/** 镜像 Go containerEntrySafe：禁 .. / 反斜杠 / 绝对路径（防穿越） */
function webContainerEntrySafe(name: string): boolean {
  if (!name) return false;
  if (name.startsWith("/")) return false;
  return !name.includes("..") && !name.includes("\\");
}

/** 容器内条目枚举：ListContainerEntries 镜像（exts 逗号分隔；失败 → "[]"） */
async function listWebContainerEntries(path: string, exts: string): Promise<string> {
  try {
    const entries = await readWebZipEntries(path);
    if (!entries) return "[]";
    const extSet = webParseContainerExts(exts);
    const out = Object.keys(entries)
      .filter((k) => !k.endsWith("/") && webContainerEntrySafe(k) && webContainerExtMatch(k, extSet))
      .sort();
    return JSON.stringify(out);
  } catch {
    return "[]";
  }
}

/** 容器内体素读取：GetVoxelDataInContainer 镜像（entry 为 zip 内条目路径，ext 决定视图分派） */
async function readWebVoxelInContainer(
  path: string,
  entry: string,
  ext: string,
  view: (root: Record<string, unknown>, maxBlocks: number) => VoxelData | null,
): Promise<string> {
  try {
    if (!webContainerEntrySafe(entry)) return voxelErrorJson("非法条目路径");
    const b64 = await readWebFile(path);
    if (!b64) return voxelErrorJson("文件读取失败或不存在");
    const bytes = base64ToBytes(b64);
    if (!bytes) return voxelErrorJson("文件解码失败");
    const { entries } = extractZip(bytes);
    const raw = findZipEntry(entries, entry);
    if (!raw) return voxelErrorJson("容器内不存在该条目");
    return voxelToJson(zipEntryToBase64(raw), view);
  } catch (err) {
    return voxelErrorJson(safeErrorMessage(err));
  }
}

// ===== §6 NBT/体素 meta 读取（ADR-070 M1/M2）=====
/**
 * ADR-070 M1：蓝图/投影 meta binding 公共读取骨架（TS 平移 go/litematic/parser.go 的
 * openGzRoot + 视图提取）。读 IDB → base64 → 字节 → parseNbtRoot → 视图提取 → JSON 字符串。
 * 任何一步失败（文件缺失 / 非 gzip / 畸形 NBT / 视图判定无效）→ "{}"（对齐 Go binding
 * 契约：ParseMeta error / ParseSchematicSummary|ParseNbtStructure nil → "{}"）。
 */
async function readNbtMetaJson(
  path: string,
  extract: (root: Record<string, unknown>) => Record<string, unknown> | null,
): Promise<string> {
  try {
    const b64 = await readWebFile(path);
    if (!b64) return "{}";
    const bytes = base64ToBytes(b64);
    if (!bytes) return "{}";
    const root = parseNbtRoot(bytes);
    const view = extract(root);
    if (!view) return "{}";
    return JSON.stringify(view);
  } catch {
    return "{}";
  }
}

// ===== §7 pack/shaderpack meta 读取 =====
/**
 * 资源包详情 binding 公共骨架（TS 平移 go/packs/mcmeta.go ReadPackMeta + internal/app
 * resource_bindings.go:34 的 result 装配）。读 IDB → base64 → 字节 → extractZip →
 * 找 pack.mcmeta（1MB 限额）→ JSON 解析 → 找 pack.png（10MB 限额）→ base64 缩略图。
 * 任何一步失败（文件缺失 / 非 zip / 无 mcmeta / 超限 / 解析失败）→ "{}"（对齐 Go
 * binding 契约：ReadPackMeta error → "{}"）。
 */
async function readPackMetaJson(path: string): Promise<string> {
  try {
    const b64 = await readWebFile(path);
    if (!b64) return "{}";
    const bytes = base64ToBytes(b64);
    if (!bytes) return "{}";
    const { entries } = extractZip(bytes);
    const mcmeta = findZipEntry(entries, "pack.mcmeta");
    if (!mcmeta) return "{}";
    const meta = parsePackMetaJson(mcmeta);
    if (!meta) return "{}";
    // pack.png → base64 缩略图（10MB 限额，超限置空——对齐 go zip 分支 LimitReader+1 截断探测）
    meta.thumbnail = packPngToThumbnail(findZipEntry(entries, "pack.png"));
    return JSON.stringify(meta);
  } catch {
    return "{}";
  }
}

/**
 * 光影包详情 binding（TS 平移 go/packs/mcmeta.go ReadShaderpackLang）。读 IDB → base64 →
 * 字节 → extractZip → 找 lang/en_US.lang（大小写不敏感，1MB 限额）→ key=value 解析 →
 * {name, entries}。任何一步失败 → {"name":"","entries":{}}（对齐 Go binding 契约）。
 */
async function readShaderpackLangJson(path: string): Promise<string> {
  try {
    const b64 = await readWebFile(path);
    if (!b64) return '{"name":"","entries":{}}';
    const bytes = base64ToBytes(b64);
    if (!bytes) return '{"name":"","entries":{}}';
    const { entries } = extractZip(bytes);
    const lang = findZipEntry(entries, "lang/en_us.lang");
    if (!lang) return '{"name":"","entries":{}}';
    return parseShaderpackLang(lang);
  } catch {
    return '{"name":"","entries":{}}';
  }
}
/** Uint8Array → base64（fllate entry 可能共享底层 buffer，先拷贝再编码） */
function zipEntryToBase64(bytes: Uint8Array): string {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return arrayBufferToBase64(copy.buffer);
}

/** 资源包 3D：ListPackModels 枚举 zip 内条目 JSON 字符串（对齐 Go ListPackModels 契约） */
async function listWebPackModels(path: string): Promise<string> {
  try {
    const entries = await readWebZipEntries(path);
    if (!entries) return "[]";
    return JSON.stringify(Object.keys(entries));
  } catch {
    return "[]";
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
 * 返回 {"models":[{path,cubes}],"total":N}，cubes = JSON elements 数组长度，
 * 封顶前 200 条（防大包），total 全量。失败返回合法空结构（详情卡清单区降级）。
 */
async function listWebPackModelsDetail(path: string): Promise<string> {
  const empty = () => JSON.stringify({ models: [], total: 0 });
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
    return JSON.stringify({ models, total });
  } catch {
    return empty();
  }
}

/** 资源包 3D：ReadPackEntry 读取 zip 内指定条目并返回 base64（对齐 Go 契约） */
async function readWebPackEntry(path: string, entry: string): Promise<string> {
  try {
    const b64 = await readWebFile(path);
    if (!b64) return "";
    const bytes = base64ToBytes(b64);
    if (!bytes) return "";
    const { entries } = extractZip(bytes);
    const raw = findZipEntry(entries, entry);
    return raw ? zipEntryToBase64(raw) : "";
  } catch {
    return "";
  }
}
// ===== #5 Bedrock 预览 fallback 链（FindPreviewImage / ExtractPreviewTexture / AnalyzeBedrockModel）=====

function imageMimeOfPath(p: string): string {
  return /\.jpe?g$/i.test(p) ? "image/jpeg" : "image/png";
}

function imageDataUri(bytes: Uint8Array, mime = "image/png"): string {
  return `data:${mime};base64,${zipEntryToBase64(bytes)}`;
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
async function webFindPreviewImage(modelPath: string): Promise<string> {
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
async function webExtractPreviewTexture(modelPath: string): Promise<string> {
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
async function webAnalyzeBedrockModel(modelPath: string): Promise<Record<string, unknown>> {
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
async function webAnalyzeBedrockModelEntry(
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

// ===== §8 路径解析（parseWebModelPath / parseWebModelDir）=====
/**
 * /web/<type>/<name>/<rel> → 三段解析（多段 name 支持）。
 * name 与 rel 均可含 /，边界无法靠正则无歧义拆分——枚举 dir:<type>/ 前缀
 * 反向匹配「最长 dir name 前缀」（MikuMikuAR ListDirRecursive 两轮匹配模式）。
 * rel 允许为空串（目录形态路径，如删除整组）。非 /web/ 前缀直接 null。
 */
async function parseWebModelPath(p: string): Promise<{ type: string; name: string; rel: string } | null> {
  const pm = parseWebPath(p);
  if (!pm) return null;
  const { type, rest } = pm;
  const prefix = `dir:${type}/`;
  const dirKeys = await idbKeys("files", prefix);
  let best = "";
  for (const dk of dirKeys) {
    const name = dk.slice(prefix.length, -1); // 去尾 ':'
    if (name && (rest === name || rest.startsWith(`${name}/`)) && name.length > best.length) {
      best = name;
    }
  }
  if (!best) return null;
  return { type, name: best, rel: rest.slice(best.length + 1) };
}
/** /web/<type>/<name> → 类型+模型名（目录形态；name 可含多段路径） */
function parseWebModelDir(p: string): { type: string; name: string } | null {
  return parseWebDirPath(p);
}

/**
 * 递归列出指定 /web 目录下全部文件完整路径（对齐桌面 ListAllFilePaths：
 * 递归完整路径、不限制扩展名）。支持多段 name（目录树）与组内子目录（rel 含 /）。
 * 目录形态路径（/web/<type>/<name> 或 /web/<type>/<name>/<subdir>）经
 * parseWebModelPath 反解出 {type, name, rel}，再枚举 file:<type>/<name>/ 前缀，
 * 过滤 rel.startsWith(目录rel + "/") 归入该子树。非 /web 路径返回 []。
 */
async function listWebModelDirFiles(p: string): Promise<string[]> {
  const pm = await parseWebModelPath(p);
  if (!pm) return [];
  const { type, name, rel } = pm;
  const prefix = `file:${type}/${name}/`;
  const keys = await idbKeys("files", prefix);
  const out: string[] = [];
  // 目录 rel 为空 = 整个模型组；否则只取 rel 子树（rel 或其子目录）
  const dirPrefix = rel ? `${rel}/` : "";
  for (const k of keys) {
    const fileRel = k.slice(prefix.length);
    if (!dirPrefix || fileRel === rel || fileRel.startsWith(dirPrefix)) {
      out.push(`${WEB_ROOT}/${type}/${name}/${fileRel}`);
    }
  }
  return out;
}

// ===== §9 列表（递归列出 /web 目录全部文件路径）=====
/** 扫描全部资源类型的模型（供标签聚合 / 子目录映射等全库操作） */
export async function scanAllWebModels(): Promise<Array<{ type: string; name: string; path: string }>> {
  const rts = (resourceTypesJson as { resourceTypes?: Array<{ id: string }> }).resourceTypes ?? [];
  const out: Array<{ type: string; name: string; path: string }> = [];
  for (const r of rts) {
    const entries = await scanWebModels(`${WEB_ROOT}/${r.id}`);
    for (const e of entries) {
      const pm = await parseWebModelPath(e.Path);
      out.push({ type: pm?.type ?? r.id, name: pm?.name ?? e.Name, path: e.Path });
    }
  }
  return out;
}

// ===== §10 搜索（关键词 + 数值范围，Worker 批量统计）=====
// --- 搜索（关键词匹配 + 数值范围条件，数值统计走 Web Worker 批量分析）---
// 对齐桌面 internal/app/app_scan.go SearchModels：kw 匹配 name OR path；
// 数值参数 [minBones,maxBones,minCubes,maxCubes,minTex,maxTex]，>0 才参与过滤：
//   minBones>0 && BoneCount<minBones → 排除（骨骼 ≥ N）
//   maxBones>0 && BoneCount>maxBones → 排除
//   minCubes>0 && CubeCount<minCubes → 排除（立方体 ≥ N）
//   maxCubes>0 && CubeCount>maxCubes → 排除
//   minTex>0 && (TexWidth<minTex || TexHeight<minTex) → 排除（纹理宽/高 ≥ N）
//   maxTex>0 && (TexWidth>maxTex || TexHeight>maxTex) → 排除
// 统计来源：Worker 批量统计（大库后台跑不卡 UI）；Worker 不可用/失败 → 降级返回
// 关键词匹配（数值 0 + hasError:false，toolbar-search 经 consumeWebSearchDegraded 提示）。
// 返回形状对齐 go types.SearchResult {name,path,boneCount,cubeCount,texWidth,texHeight,hasError}。
interface WebSearchResult {
  name: string;
  path: string;
  boneCount: number;
  cubeCount: number;
  texWidth: number;
  texHeight: number;
  hasError: boolean;
}

/** 搜索降级映射：无数值条件快路径 / stats 不可用时的关键词匹配结果（数值 0 + hasError:false）。
 *  两处共用，消除重复（jscpd）。 */
function webDegradedMatches(matched: ModelEntry[]): WebSearchResult[] {
  return matched.map((e) => ({
    name: e.Name,
    path: e.Path,
    boneCount: 0,
    cubeCount: 0,
    texWidth: 0,
    texHeight: 0,
    hasError: false,
  }));
}

async function searchWebModels(
  filesRoot: string,
  keyword: string,
  minBones = 0,
  maxBones = 0,
  minCubes = 0,
  maxCubes = 0,
  minTex = 0,
  maxTex = 0,
): Promise<WebSearchResult[]> {
  const type = typeFromWebDir(filesRoot);
  const entries = await scanWebModels(`${WEB_ROOT}/${type}`);
  // 对齐桌面 app_scan.go SearchModels：kw = strings.ToLower(strings.TrimSpace(keyword))
  const kw = (keyword || "").trim().toLowerCase();
  // 对齐桌面 app_scan.go SearchModels：匹配 name OR path（搜索目录名/作者路径段可命中）
  const matched = entries.filter(
    (e) => !kw || e.Name.toLowerCase().includes(kw) || e.Path.toLowerCase().includes(kw),
  );
  const hasNumeric =
    minBones > 0 || maxBones > 0 || minCubes > 0 || maxCubes > 0 || minTex > 0 || maxTex > 0;
  // 无数值条件 → 快路径：关键词匹配即可（保持既有行为，不做批量解码）
  if (!hasNumeric) {
    return webDegradedMatches(matched);
  }
  // Worker 批量统计；不可用/失败 → 返回 null（web-stats 内部已吞错并整批降级，
  // 「不向上抛」契约由 web-stats.test.ts「runner 抛错 → 降级（不向上抛）」锁定）。
  // 审核修复：保留外层 catch 作边界防御——callee 契约之外的任何拒绝路径（如
  // worker 构造 / IDB 键枚举异常）同样降级为关键词匹配（数值 0），而非向调用方
  // 抛错让数值过滤搜索直接 throw；防御分支近乎不可达但成本为零。
  let stats: WebModelStats[] | null;
  try {
    stats = await batchStatsWebModels(matched.map((e) => e.Path));
  } catch {
    stats = null;
  }
  if (!stats) {
    return webDegradedMatches(matched);
  }
  const out: WebSearchResult[] = [];
  matched.forEach((e, i) => {
    const s = stats[i];
    // 对齐 Go：统计失败（BoneCount==0 等价 hasError）在数值条件下直接排除
    if (!s || s.hasError) return;
    if (minBones > 0 && s.boneCount < minBones) return;
    if (maxBones > 0 && s.boneCount > maxBones) return;
    if (minCubes > 0 && s.cubeCount < minCubes) return;
    if (maxCubes > 0 && s.cubeCount > maxCubes) return;
    if (minTex > 0 && (s.texWidth < minTex || s.texHeight < minTex)) return;
    if (maxTex > 0 && (s.texWidth > maxTex || s.texHeight > maxTex)) return;
    out.push({
      name: e.Name,
      path: e.Path,
      boneCount: s.boneCount,
      cubeCount: s.cubeCount,
      texWidth: s.texWidth,
      texHeight: s.texHeight,
      hasError: false,
    });
  });
  return out;
}

// ===== §11 重命名校验 =====
// --- 重命名校验（对齐桌面 fileops.RenameDir/RenameFile：非法字符/空名/穿越拒绝）---
// 缺校验的后果：newName 含 / 或为空会制造坏 key（dir:ysm/a/b:），scanWebModels 仍能扫到，
// 但 parseWebModelDir 三段解析失败 → 该模型变成幽灵（无法删除/再次重命名），且重命名到
// 已存在模型名会静默覆盖 dir key 合并数据（桌面 os.Rename 对目标已存在报错，web 必须对齐）
const INVALID_NAME_CHARS = /[\\/:*?"<>|]/;

/** 校验重命名目标名（对齐桌面 fileops.go 非法字符 + 空名 + 路径段校验，非法则抛错） */
function assertValidRenameName(newName: string, kind: "目录" | "文件"): void {
  const kindLabel = kind === "目录" ? t("webFs.kindDir") : t("webFs.kindFile");
  const n = (newName || "").trim();
  if (!n) throw new Error(t("webFs.renameEmptyName", { kind: kindLabel }));
  if (INVALID_NAME_CHARS.test(n)) throw new Error(t("webFs.renameInvalidChars", { kind: kindLabel }));
  if (n === "." || n === "..") throw new Error(t("webFs.renameInvalidPathSegment", { kind: kindLabel }));
}

// ===== §12 删除模型组 =====
// --- 删除模型组（dir + 所有 file + 元数据标记）---
async function deleteWebModel(type: string, name: string): Promise<void> {
  await idbDel("files", dirKey(type, name));
  const fks = await idbKeys("files", `file:${type}/${name}/`);
  for (const k of fks) await idbDel("files", k);
  // 清理 ban/tags 标记（best-effort）
  for (const prefix of ["ban:", "tags:"]) {
    const keys = await idbKeys("config", `${prefix}/web/${type}/${name}/`);
    for (const k of keys) await idbDel("config", k);
  }
}

// --- 重命名模型目录（dir + file + 标记整组 rekey）---
// 校验（目标已存在 / 源缺失）后复用 rekeyWebModelGroup 原语完成整组 rekey，
// 消除与 moveOrCopy 重复的内联 rekey 循环（dir + 全部 file + ban/tags，两阶段事务性）。
async function renameWebDir(oldPath: string, newName: string): Promise<void> {
  const di = parseWebModelDir(oldPath);
  if (!di) throw new Error(t("webFs.renameInvalidPath", { path: oldPath }));
  const { type, name } = di;
  assertValidRenameName(newName, "目录");
  const finalName = newName.trim();
  // P-A 多段 name：重命名只替换末段，保留父路径（分类1/狐狸 → 分类1/大猫）
  const parent = name.includes("/") ? name.slice(0, name.lastIndexOf("/") + 1) : "";
  const newNameFull = parent + finalName;
  // 目标已存在（含重命名为同名）：对齐桌面「目标已存在」拒绝，防静默覆盖合并两模型数据
  if ((await idbGet("files", dirKey(type, newNameFull))) !== undefined) {
    throw new Error(t("webFs.renameTargetExists", { path: `${WEB_ROOT}/${type}/${newNameFull}` }));
  }
  // 旧模型必须存在（对齐桌面 os.Rename 源不存在报错，拒绝静默 no-op）
  if ((await idbGet("files", dirKey(type, name))) === undefined) {
    throw new Error(t("webFs.renameModelMissing", { path: oldPath }));
  }
  await rekeyWebModelGroup(type, name, newNameFull, true);
}

// --- 重命名单个文件（模型组内某文件 rekey，保留 .ban 后缀语义由调用方负责）---
async function renameWebFile(oldPath: string, newName: string): Promise<void> {
  const pm = await parseWebModelPath(oldPath);
  if (!pm) throw new Error(t("webFs.renameInvalidPath", { path: oldPath }));
  const { type, name, rel } = pm;
  assertValidRenameName(newName, "文件");
  const finalName = newName.trim();
  // ysm.json 是模型目录清单（游戏按目录名识别模型）：禁止单文件改名，
  // 否则 scanWebModels 主文件 rank 从 2 掉到 0 → 模型从列表中消失（对齐桌面 fileops.RenameFile ADR-038 D3）
  if (rel.toLowerCase() === "ysm.json") {
    throw new Error(t("webFs.renameYsmJsonForbidden"));
  }
  const oldKey = fileKey(type, name, rel);
  // P-A 组内 rel 可含子目录：重命名只替换 rel 末段文件名，保留目录前缀（tex/face.png → tex/eye.png）
  const relDir = rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/") + 1) : "";
  const newKey = fileKey(type, name, `${relDir}${finalName}`);
  // 同名（含 trim 归一后）：无事可做，直接返回——不得走下方 idbSet+idbDel（同 key 自删 = 数据丢失回归）
  if (newKey === oldKey) return;
  // 目标已存在：对齐桌面「目标已存在」拒绝，防静默覆盖目标文件内容
  if ((await idbGet("files", newKey)) !== undefined) {
    throw new Error(t("webFs.renameTargetExists", { path: `${WEB_ROOT}/${type}/${name}/${finalName}` }));
  }
  // 旧文件必须存在（对齐桌面 RenameFile 源不存在报错，拒绝静默 no-op）
  // 单次读取兼作「存在校验 + rekey 取值」，消除同 key 双读
  const val = await idbGet("files", oldKey);
  if (val === undefined) throw new Error(t("webFs.renameModelMissing", { path: oldPath }));
  await idbSet("files", newKey, val);
  await idbDel("files", oldKey);
  // 移动按全路径 key 的 ban/tags 标记
  const newPath = oldPath.replace(/\/[^/]+$/, `/${finalName}`);
  for (const prefix of ["ban:", "tags:"]) {
    const oldMk = `${prefix}${oldPath}`;
    const newMk = `${prefix}${newPath}`;
    const mv = await idbGet("config", oldMk);
    if (mv !== undefined) {
      await idbSet("config", newMk, mv);
      await idbDel("config", oldMk);
    }
  }
}

// --- 模型移动/复制（组级 rekey；对齐桌面 fileops.MoveModelFile/CopyModelFile，go/fileops/fileops.go:138/220）---
// 桌面语义：MoveModelFile(src, dstDir) 把 src（文件/目录）移入 dstDir 并保留原名
// （dst = Join(dstDir, Base(src))）；CopyModelFile 同语义但保留源。
// web 适配：模型库以「模型组」为最小单位（dir:<type>/<name>: + file:<type>/<name>/<rel>，
// 无桌面「游离文件」概念）——src 为组内任意文件路径或组目录路径时，均整组移动/复制
// （dir + 全部 file + ban/tags 标记，rekey 对齐 renameWebDir 既有处理）。
// dstDir = /web/<type>/<目标文件夹>（resolveDstDir 由 GetRepoRoot + 用户输入拼接），
// 目标模型名 = <目标文件夹>/<src 组名末段>（对齐 Go 的 dst=Join(dstDir, Base(src))，
// 多段组名只保留末段，父路径随移动丢弃，如 分类1/狐狸 → 作者A/狐狸）。
// 校验（对齐 Go 错误语义）：src/dstDir 非空、dstDir 须为合法 /web/<type>/<目标> 目录、
// 源须存在（Go os.Stat 源报错）、目标不得位于源内（自嵌套，Go「目标目录不能位于源目录内」）、
// 目标已存在拒绝（Go「目标已存在」防静默覆盖）。

/**
 * 目标目录 + 源组名 → 新模型组名（对齐 Go dst=Join(dstDir, Base(src))：
 * 目标文件夹 + src 组名末段）。
 */
function webMoveTargetName(dstName: string, srcName: string): string {
  const srcBase = srcName.includes("/") ? srcName.slice(srcName.lastIndexOf("/") + 1) : srcName;
  return `${dstName}/${srcBase}`;
}

/**
 * 模型组整组 rekey：旧组名 → 新组名（dir + 全部 file + ban/tags 标记）。
 * move=true 移动（删旧 key）；move=false 复制（保留旧 key = 读旧写新）。
 * 审核 A #1（事务性）：两阶段——先写全部新 key（不删旧），全成功后才删旧 key；
 * 中途失败只回滚本次新建（best-effort），旧 key 完好 → 无 dir/file 分裂残留。
 */
async function rekeyWebModelGroup(type: string, oldName: string, newName: string, move: boolean): Promise<void> {
  const writtenNew: string[] = [];
  const rollbackNew = async (): Promise<void> => {
    for (const k of writtenNew.reverse()) {
      try {
        await idbDel("files", k);
      } catch {
        /* best-effort */
      }
    }
  };
  try {
    // 阶段一：写新 key（dir + file + 标记），全成功才进阶段二
    const dv = await idbGet("files", dirKey(type, oldName));
    if (dv !== undefined) {
      await idbSet("files", dirKey(type, newName), { ...(dv as Record<string, unknown>), name: newName });
      writtenNew.push(dirKey(type, newName));
    }
    const oldPrefix = `file:${type}/${oldName}/`;
    const fks = await idbKeys("files", oldPrefix);
    for (const k of fks) {
      const rel = k.slice(oldPrefix.length);
      const val = await idbGet("files", k);
      if (val !== undefined) {
        const nk = fileKey(type, newName, rel);
        await idbSet("files", nk, val);
        writtenNew.push(nk);
      }
    }
    for (const prefix of ["ban:", "tags:"]) {
      const scanPrefix = `${prefix}/web/${type}/${oldName}/`;
      const keys = await idbKeys("config", scanPrefix);
      for (const k of keys) {
        const suffix = k.slice(scanPrefix.length);
        const val = await idbGet("config", k);
        if (val !== undefined) {
          const nk = `${prefix}/web/${type}/${newName}/${suffix}`;
          await idbSet("config", nk, val);
          writtenNew.push(nk);
        }
      }
    }
    // 阶段二：全部新 key 写入成功 → 删旧 key（move 时）
    if (move) {
      await idbDel("files", dirKey(type, oldName));
      for (const k of fks) await idbDel("files", k);
      for (const prefix of ["ban:", "tags:"]) {
        const scanPrefix = `${prefix}/web/${type}/${oldName}/`;
        const keys = await idbKeys("config", scanPrefix);
        for (const k of keys) await idbDel("config", k);
      }
    }
  } catch (e) {
    await rollbackNew();
    throw e;
  }
}

// ===== §13 移动/复制（组级 rekey）=====
/**
 * MoveModelFile / CopyModelFile 共用：解析 + 校验 + 组级 rekey。
 * move=true 移动（删源）；move=false 复制（保留源）。失败 reject（对齐 Go error → binding reject）。
 */
async function moveOrCopyWebModel(src: string, dstDir: string, move: boolean): Promise<void> {
  // 非 /web/ 路径 → 无效源路径（对齐 Go「源文件必须在仓库内」）；
  // 合法 /web/ 路径但模型组不存在（parseWebModelPath 反向匹配不到 dir key）→ 模型不存在
  if (!isWebPath(src)) throw new Error(t("webFs.moveInvalidSrc", { path: src }));
  const pm = await parseWebModelPath(src);
  if (!pm) throw new Error(t("webFs.moveModelMissing", { path: src }));
  const { type, name } = pm;
  // dstDir 须为 /web/<type>/<目标> 目录形态（目标名非空由 parseWebDirPath 保证）
  const di = parseWebDirPath(dstDir);
  if (!di) throw new Error(t("webFs.moveInvalidDstDir", { path: dstDir }));
  const dstName = di.name.trim();
  if (!dstName) throw new Error(t("webFs.moveInvalidDstDir", { path: dstDir }));
  // 审核 A #2：目标文件夹名 + 源组名末段分别做非法字符/空名校验（拼接后的 newName
  // 是多段路径含 "/" 合法，assertValidRenameName 禁 "/" 只适用于单段重命名）
  assertValidRenameName(dstName, "目录");
  // 目标模型名 = 目标文件夹/<src 组名末段>（对齐 Go dst=Join(dstDir, Base(src))）
  const newName = webMoveTargetName(dstName, name);
  const srcBase = newName.slice(newName.lastIndexOf("/") + 1);
  assertValidRenameName(srcBase, "目录");
  // 自嵌套检查（目标**严格**位于源内）须先于「目标已存在」——对齐 Go fileops.go:313-320
  //（自嵌套）先于 :326（目标已存在）：两条同时命中时 Go 报的是自嵌套。
  // 注意 `newName === name`（目标 == 源自身）不属于自嵌套：Go 侧此时 dstDir 是 src 的父
  // 目录，relToSrc 为 ".." 不算嵌套，dst=Join(dstDir,Base(src))=src 命中 stat 存在报
  // 「目标已存在」——故等值分支必须留在下方存在性检查里，不可随此支上移。
  if (newName.startsWith(`${name}/`)) {
    throw new Error(t("webFs.moveNested", { path: dstDir }));
  }
  // 防覆盖：目标组已存在 → 拒绝（对齐 Go「目标已存在」；含目标 == 源自身移动——
  // Go 对 dst===src 命中 stat(dst) 存在报「目标已存在」，web 侧 dir key 即源自身）
  if ((await idbGet("files", dirKey(type, newName))) !== undefined) {
    throw new Error(t("webFs.moveTargetExists", { path: `${WEB_ROOT}/${type}/${newName}` }));
  }
  await rekeyWebModelGroup(type, name, newName, move);
}

// ===== §14 子目录映射 =====
async function getWebSubDirMap(): Promise<Record<string, string>> {
  // 对齐 go/types/extensions.go SubDirAll：返回 rt.InstanceDir（整合包实例版本目录子目录），
  // 非 storageSubDir（仓库存储子目录）——B1 契约测试暴露的字段错用
  const rts = (resourceTypesJson as { resourceTypes?: Array<{ id: string; instanceDir?: string }> }).resourceTypes ?? [];
  const map: Record<string, string> = {};
  for (const r of rts) map[r.id] = r.instanceDir ?? "";
  return map;
}

/** 聚合所有资源类型的 IDB 模型条目（网页版「本地仓库」= 虚拟根 /web） */
export async function collectAllWebEntries(): Promise<ModelEntry[]> {
  const rts = (resourceTypesJson as { resourceTypes?: Array<{ id: string }> }).resourceTypes ?? [];
  const all: ModelEntry[] = [];
  for (const r of rts) {
    const entries = await scanWebModels(`${WEB_ROOT}/${r.id}`);
    all.push(...entries);
  }
  return all;
}

// ===== §16 binding 装配（browser-adapter.ts 消费入口）=====
// ===== 文件系统类 binding 片段（Top 6 注册表驱动：browser-adapter.ts 只做 {...} 装配）=====
// 收敛自 browser-adapter.ts webImpls 的文件系统类条目（扫描/读写/搜索/删除/重命名/
// 子目录/清缓存/FSA 授权）；SelectLocalRepo/GetFsaAuthState 为网页版专属扩展
// （Go AppBindings 无此函数，Phase 3 能力探测不会误报）。
export const webFsBindings = {
  ScanModelEntries: (dir: string) => scanWebModels(dir),
  // 真实列表入口（loader/import-queue/resource-manager 等 6 处均调 WithLabel 版本）
  ScanModelEntriesWithLabel: (dir: string, _label: string) => scanWebModels(dir),
  // app-tree/loader、preview-library/siblings 等按 rtype 扫描候选列表；网页版虚拟根
  // /web/<rtype> 本身已按类型分区，scanWebModels 根目录即等效“按 rtype 过滤”，
  // 非根目录则按目录前缀收敛，供目录批量重命名等场景使用
  ScanModelEntriesFiltered: (dir: string, _rtype: string, _subtype: string, _label: string) => scanWebModels(dir),
  ReadFileBytes: (path: string) => readWebFile(path),
  // MMD/Scene 3D 批量读取（原缺失被 mmd-data-port catch 成空对象 → 贴图静默丢失）
  ReadFileBytesBatch: async (paths: string[] | null) => {
    if (!paths) return null;
    const out: Record<string, string | null> = {};
    await Promise.all(paths.map(async (p) => { out[p] = await readWebFile(p); }));
    return out;
  },
  ReadFileBytesBatchWithMeta: async (paths: string[] | null) => {
    if (!paths) return null;
    const out: Record<string, { data: string | null; hash: string }> = {};
    // hash 暂置空：网页版不为纹理缓存做 SHA256 批量预算，MMD 贴图加载不受影响
    await Promise.all(paths.map(async (p) => { out[p] = { data: await readWebFile(p), hash: "" }; }));
    return out;
  },
  // CheckFileExists：IDB 虚拟库路径是否存在（file: 或 dir: key，对齐 Go os.Stat 语义）
  CheckFileExists: async (path: string) => {
    const pm = parseWebPath(path);
    if (!pm) return false;
    const f = await idbGet("files", `file:${pm.type}/${pm.rest}`);
    if (f) return true;
    const prefix = `dir:${pm.type}/`;
    const dirKeys = await idbKeys("files", prefix);
    const rest = pm.rest;
    return dirKeys.some((k) => {
      const name = k.slice(prefix.length, -1);
      return !!name && (rest === name || rest.startsWith(name + "/"));
    });
  },
  // DetectZipType：base64 → 字节 → 内容指纹（extract.ts detectZipType，对齐 Go 语义）
  DetectZipType: (base64Data: string) => {
    if (!base64Data) return Promise.resolve("");
    // base64 大小守卫：上限对齐 MAX_IMPORT_BYTES（100MB 原始 → base64 约 133.4MB）——
    // 探测能力与导入上限同口径，50~100MB 的合法 zip 不再被旧 50MB 守卫误杀为 ""
    //（atob 内存压力与导入路径同量级，导入本身接受的输入探测也接受）
    if (base64Data.length > Math.ceil(MAX_IMPORT_BYTES / 3) * 4) {
      return Promise.resolve("");
    }
    try {
      const bin = atob(base64Data);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return Promise.resolve(detectZipType(bytes) || "");
    } catch {
      return Promise.resolve("");
    }
  },
  // ADR-070 M1：蓝图/投影详情面板恢复（原 fail-fast 报「读取失败」）。
  // TS 平移 go/litematic/parser.go 三函数（ParseMeta/ParseSchematicSummary/ParseNbtStructure），
  // 只读 meta（不做 voxel，M2）；失败返回 "{}" 对齐 Go binding 契约
  ReadLitematicMeta: (path: string) => readNbtMetaJson(path, litematicMetaView),
  ReadNbtStructure: (path: string) => readNbtMetaJson(path, nbtStructureView),
  ReadSchematic: (path: string) => readNbtMetaJson(path, schematicSummaryView),
  // ADR-070 M2：蓝图/投影 voxel 3D 数据（litematic-adapter.ts:34 经 VOXEL_RPC_BY_EXT
  // 分发调用；TS 平移 go/litematic/voxel.go 三构建函数 + internal/app marshalVoxelData，
  // 失败返回 "{}" 对齐 Go binding 契约）
  GetNbtVoxelData: (path: string) => readVoxelJson(path, nbtVoxelView),
  GetSchematicVoxelData: (path: string) => readVoxelJson(path, schematicVoxelView),
  GetLitematicVoxelData: (path: string) => readVoxelJson(path, litematicVoxelView),
  // ADR-132 遗留 1：容器内条目枚举 + 体素读取（蓝图/litematic zip 多 nbt 预览）
  ListContainerEntries: (path: string, exts: string) => listWebContainerEntries(path, exts),
  GetVoxelDataInContainer: (path: string, entry: string, ext: string) =>
    readWebVoxelInContainer(
      path,
      entry,
      ext,
      ext === ".nbt" ? nbtVoxelView : ext === ".schematic" ? schematicVoxelView : litematicVoxelView,
    ),
  // DetectResourceType：扩展名判定（resolveTypeSafe，歧义 .zip/.7z 返回 null）→
  // 歧义容器读内容指纹（detectZipType）。ADR-066 web 识别层对齐 Go：
  // 一处补上后非 YSM 类型（pack/shader/蓝图/投影/MMD/VRC）的预览路由不再误入
  // YSM 路径（原 fail-fast 导致 rtype="" 全落 YSM 解析报"无法解析"）
  DetectResourceType: async (path: string) => {
    const byExt = resolveTypeSafe(path);
    if (byExt) return byExt;
    const b64 = await readWebFile(path);
    if (!b64) return "";
    const bytes = base64ToBytes(b64);
    if (!bytes) return "";
    return detectZipType(bytes);
  },
  // YSM 头部/摘要 web 实现（原 fail-fast → import-queue 作者预填/重命名 tips 静默降级、
  // 详情缺 stats/license）。失败不 reject：头部返回全空 YSMHeader、摘要返回最小空
  // YsmSummary（对齐 Go internal/app/app_model.go:41-65 单返回值吞错契约，消费方容错）。
  // ExtractYSMHeaderFromBase64：base64 → 字节 → parseYsmHeaderFromBytes（YSGP 尽力检测）
  ExtractYSMHeaderFromBase64: (base64Data: string) => {
    const bytes = base64ToBytes(base64Data);
    if (!bytes) return Promise.resolve(emptyYsmHeader());
    return Promise.resolve(parseYsmHeaderFromBytes(bytes));
  },
  // ExtractYSMHeader：readWebFile → base64 → 复用 FromBase64 同一解析
  ExtractYSMHeader: async (path: string) => {
    const b64 = await readWebFile(path);
    if (!b64) return emptyYsmHeader();
    const bytes = base64ToBytes(b64);
    if (!bytes) return emptyYsmHeader();
    return parseYsmHeaderFromBytes(bytes);
  },
  // ExtractYsmSummary：readWebFile → 字节 → YSGP 检测 → zip（PK 头）找 ysm.json 解析
  // → 非 zip 文本头部基本摘要；失败 → 最小空 YsmSummary
  ExtractYsmSummary: async (path: string) => {
    const source = path.split(/[/\\]/).pop() || "";
    const b64 = await readWebFile(path);
    if (!b64) return emptyYsmSummary(source);
    const bytes = base64ToBytes(b64);
    if (!bytes) return emptyYsmSummary(source);
    try {
      return extractYsmSummaryFromBytes(bytes, source);
    } catch {
      // ysm.json 畸形/非对象等 → 最小空摘要（对齐 Go app 层 ExtractYsmSummary 失败分支）
      return emptyYsmSummary(source);
    }
  },
  // 资源包/光影包详情恢复（原 fail-fast 报「binding 未实现」红错，app-preview/detail.ts:138/201
  // 直调）。TS 平移 go/packs/mcmeta.go ReadPackMeta/ReadShaderpackLang，只读 meta；
  // 失败返回 "{}"/{"name":"","entries":{}} 对齐 Go binding 契约（resource_bindings.go:34/59）
  ReadPackMeta: (path: string) => readPackMetaJson(path),
  ReadShaderpackLang: (path: string) => readShaderpackLangJson(path),
  // 资源包 3D：ListPackModels/ListPackModelsDetail/ReadPackEntry（原缺失 → pack-3d FAB 静默 no-op）
  ListPackModels: (path: string) => listWebPackModels(path),
  ListPackModelsDetail: (path: string) => listWebPackModelsDetail(path),
  ReadPackEntry: (path: string, entry: string) => readWebPackEntry(path, entry),
  // #5：Bedrock 预览/缩略图 fallback（原缺失 → .zip/.json 3D 预览整体断链）
  FindPreviewImage: (path: string) => webFindPreviewImage(path),
  ExtractPreviewTexture: (path: string) => webExtractPreviewTexture(path),
  AnalyzeBedrockModel: (path: string) => webAnalyzeBedrockModel(path),
  AnalyzeBedrockModelEntry: (path: string, subPath: string) => webAnalyzeBedrockModelEntry(path, subPath),
  // rtype 含 / 时替换为 _，避免 /web/a/b 破坏 readWebFile 三段解析
  GetRepoRoot: (rtype: string) => Promise.resolve(`${WEB_ROOT}/${rtype.replace(/\//g, "_")}`),
  GetDefaultRepoRoot: () => Promise.resolve(WEB_ROOT),
  // 搜索：关键词 + 数值范围条件（min/max 骨骼/立方体/纹理，>0 才过滤；统计走
  // Web Worker 批量分析，Worker 不可用降级为仅关键词匹配并在 UI 提示）
  SearchModels: (filesRoot: string, keyword: string, ...rest: number[]) =>
    searchWebModels(
      filesRoot,
      keyword,
      rest[0] ?? 0,
      rest[1] ?? 0,
      rest[2] ?? 0,
      rest[3] ?? 0,
      rest[4] ?? 0,
      rest[5] ?? 0,
    ),
  // ADR-111 统一删除入口（web 侧）：接收 rtype 参数但 web 模式按模型粒度删除
  DeleteResourcePack: async (path: string, _rtype: string) => {
    if (!isWebPath(path)) {
      return Promise.reject(new Error(t("webFs.deleteInvalidPath", { path })));
    }
    const pm = await parseWebModelPath(path);
    if (pm) await deleteWebModel(pm.type, pm.name);
  },
  RemoveDir: (dir: string) => {
    const di = parseWebModelDir(dir);
    if (!di) return Promise.reject(new Error(t("webFs.deleteInvalidPath", { path: dir })));
    return deleteWebModel(di.type, di.name);
  },
  // 重命名：模型目录整组 rekey / 组内单文件 rekey
  RenameDir: (oldPath: string, newName: string) => renameWebDir(oldPath, newName),
  RenameFile: (oldPath: string, newName: string) => renameWebFile(oldPath, newName),
  // 模型移动/复制（组级 rekey；对齐桌面 fileops.MoveModelFile/CopyModelFile 语义，
  // 差异：web 无「游离文件」，src 为组内文件/组目录时均整组移动/复制）
  MoveModelFile: (src: string, dstDir: string) => moveOrCopyWebModel(src, dstDir, true),
  CopyModelFile: (src: string, dstDir: string) => moveOrCopyWebModel(src, dstDir, false),
  // 子目录映射（resource_types.json 派生）
  GetSubDirMap: () => getWebSubDirMap(),
  // 目录/整合包信息：web 没有 ysm-pack.json，返回最小 PackInfo 避免展开目录时
  // GetPackInfo fail-fast 把预览区染成“无法读取整合包信息”
  GetPackInfo: async (dirPath: string) => {
    const di = parseWebDirPath(dirPath);
    const name = di?.name?.split("/").pop() || dirPath.split(/[/\\]/).filter(Boolean).pop() || "";
    return { name, description: "" };
  },
  // R1 文件层级读取：递归列出 /web 目录下全部文件完整路径（对齐桌面 ListAllFilePaths，
  // 递归完整路径、不限制扩展名；bus-handlers 删除目录移入回收站联动依赖）
  ListAllFilePaths: (dir: string) => listWebModelDirFiles(dir),
  // 网页版无扫描缓存（scanWebModels 直读 IDB）：清缓存为 no-op。
  // 缺此实现会让 app-tree 切换 root 时（index.ts:170）fail-fast 抛错跳过 _load，树卡死。
  ClearScanCache: () => Promise.resolve(),
  InvalidateScanCache: () => Promise.resolve(),
  // SelectLocalRepo 为网页版专属扩展（Go AppBindings 无此函数，Phase 3 能力探测不会误报）；
  // 用 FSA 授权本地仓库目录，替代 Go 本地文件系统扫描作为模型库文件来源
  SelectLocalRepo: () => selectLocalRepo(),
  // R2 FSA 授权状态查询（供 settings UI 启动引导；不触发权限弹窗）
  GetFsaAuthState: () => getFsaAuthState(),
  // 3D 截图：网页版直接触发浏览器下载（对齐 Go SaveScreenshotFile 的“保存截图”语义）
  SaveScreenshotFile: async (filename: string, base64Data: string) => {
    const a = document.createElement("a");
    a.download = filename;
    a.href = `data:image/png;base64,${base64Data}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  },
} satisfies Record<string, (...args: never[]) => Promise<unknown>>;
