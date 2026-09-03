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
// │  §5  文件读取            → web-fs-read.ts  readWebFile                        │
// │  §6  NBT/体素 meta 读取   → 下文    readNbtMetaJson；web-fs-read.ts readVoxelJson│
// │  §6.5 容器内条目枚举+体素 → web-fs-container.ts                               │
// │  §7  pack/shaderpack 读取 → web-fs-pack.ts                                    │
// │  #5  Bedrock 预览 fallback → web-fs-bedrock.ts                                │
// │  §8  路径解析            → web-fs-read.ts  parseWebModelPath / parseWebModelDir│
// │  §9  列表                → web-fs-read.ts  listWebModelDirFiles；下文 scanAllWebModels│
// │  §10 搜索                → 下文    searchWebModels                            │
// │  §11 重命名              → 下文    assertValidRenameName / renameWebDir/File  │
// │  §12 删除               → 下文    deleteWebModel                              │
// │  §13 移动/复制          → 下文    rekeyWebModelGroup / moveOrCopyWebModel    │
// │  §14 子目录映射          → 下文    getWebSubDirMap / collectAllWebEntries     │
// │  §15 导入分组            → web-fs-import.ts                                   │
// │  §16 binding 装配        → 下文    webFsBindings（Top 6 注册表驱动）           │
// └──────────────────────────────────────────────────────────────────────────────┘
import { idbGet, idbKeys, idbDel, idbGetAll, idbTx, type IdbOp } from "./idb.ts";
import { t } from "../core/i18n/t.ts";
import type { ModelEntry } from "../../bindings/ysm-model-manager/go/types/models.ts";
// 复用 dnd-shared 的导入白名单（.json 仅放行 ysm.json，其余须 ALL_EXTS 成员），
// 避免 browser-adapter 另起一套扩展名校验导致漂移
import resourceTypesJson from "../../../resource_types.json" with { type: "json" };
// rtype 魔法字符串统一走 RESOURCE_TYPES 常量（治理红线 R7）
import { RESOURCE_TYPES, resolveTypeSafe } from "../utils/resource/types.ts";
// rtype 扩展名白名单（resource_types.json 派生，单一事实源；ScanModelEntriesFiltered 过滤用）
import { getExts } from "../utils/resource/extensions.ts";
import { base64ToBytes, parseWebPath, parseWebDirPath, webDirType, isWebPath, WEB_ROOT, MAX_IMPORT_BYTES } from "./web-common.ts";
// R2 导入增强：detectContainerType 供 DetectResourceType 歧义容器内容指纹（ADR-066 web 识别层）
import { detectContainerType } from "./extract.ts";
// ADR-070 M1：蓝图/投影 meta 读取（NBT 解析 + 三个视图提取，TS 平移 go/litematic/parser.go）
import { parseNbtRoot, litematicMetaView, nbtStructureView, schematicSummaryView } from "./nbt-parse.ts";
import { litematicVoxelView, nbtVoxelView, schematicVoxelView } from "./voxel-parse.ts";
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
import { getFsaAuthState, selectLocalRepo } from "./web-fs-auth.ts";
// 共享读取装配 + 路径反解（web-fs-read.ts 叶子，断 container/pack/bedrock ↔ 主文件 循环）
import {
  readWebFile,
  readVoxelJson,
  parseWebModelPath,
  parseWebModelDir,
  listWebModelDirFiles,
} from "./web-fs-read.ts";
// §6.5 容器内条目枚举 + 体素（ADR-132 遗留 1）
import { listWebContainerEntries, readWebVoxelInContainer } from "./web-fs-container.ts";
// §7 pack/shaderpack meta 读取
import {
  readPackMetaJson,
  readShaderpackLangJson,
  listWebPackModels,
  listWebPackModelsDetail,
  readWebPackEntry,
} from "./web-fs-pack.ts";
// #5 Bedrock 预览 fallback 链
import { webFindPreviewImage, webExtractPreviewTexture, webAnalyzeBedrockModel, webAnalyzeBedrockModelEntry } from "./web-fs-bedrock.ts";

// 公共 API 原路径透出（browser-adapter / web-store / web-community 消费面零改动）：
// importWebFiles 主文件不再直接消费（FSA 入库走 web-fs-auth），仅门面转出
export { importWebFiles } from "./web-fs-import.ts";
export { getFsaAuthState, reauthorizeFsaRoot, rescanFsaRoot, selectLocalRepo } from "./web-fs-auth.ts";
// readWebFile 移入 web-fs-read.ts 后经此透出，web-community 消费面不变
export { readWebFile } from "./web-fs-read.ts";

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
  // P0-1 优化：原本每模型组 1 次 meta get + 1 次 file 前缀扫 + N 次 file get
  // （N+1 串行事务，千级模型 ~2000+ 往返）。改为两次前缀批量操作收敛：
  //   ① idbGetAll("dir:type/")   一次事务拿全部 dir key+value（含 addedAt meta）
  //   ② idbGetAll("file:type/")  一次事务拿全部文件 key+value（含 size）
  // 内存按组名收敛，主文件竞争 / 大小汇总在内存完成——总 IDB 事务数 O(1)。
  const [dirRows, fileRows] = await Promise.all([
    idbGetAll("files", `dir:${type}/`),
    idbGetAll("files", `file:${type}/`),
  ]);
  const dirPrefix = `dir:${type}/`;
  const filePrefix = `file:${type}/`;
  // dir 值按完整 name 索引（key 升序 → name 有序）
  const dirMeta = new Map<string, { name?: string; addedAt?: number }>();
  for (const [k, v] of dirRows) {
    const name = k.slice(dirPrefix.length, -1);
    if (name) dirMeta.set(name, v as { name?: string; addedAt?: number });
  }
  // 文件行按「dir name 前缀」归组：文件 key = file:<type>/<name>/<rel>，
  // name 可含多段路径（目录树），故以 dir name + "/" 为前缀匹配。
  // 组名按长度降序排——首次 startsWith 命中即最长匹配，
  // 避免逐组全量扫描（O(文件×组) → O(文件×log组)，P1 性能修复）
  const filesByGroup = new Map<string, Array<[string, { size?: number }]>>();
  const sortedGroups = [...dirMeta.keys()].sort((a, b) => b.length - a.length);
  for (const [fk, fv] of fileRows) {
    const rel = fk.slice(filePrefix.length);
    let bestGroup = "";
    for (const name of sortedGroups) {
      if (rel.startsWith(`${name}/`)) { bestGroup = name; break; }
    }
    if (!bestGroup) continue; // 孤儿文件（无对应 dir key）
    const fileRel = rel.slice(bestGroup.length + 1);
    const arr = filesByGroup.get(bestGroup);
    if (arr) arr.push([fileRel, fv as { size?: number }]);
    else filesByGroup.set(bestGroup, [[fileRel, fv as { size?: number }]]);
  }
  const entries: ModelEntry[] = [];
  for (const [name, meta] of dirMeta) {
    // 汇总该模型全部文件大小；Path/Name 指向主文件（含扩展名，与桌面
    // scanner.go:136 Name=filepath.Base(p) 含扩展名、Ext=原扩展名一致——
    // 否则 loader.ts 的 name.endsWith(ext) 过滤会恒失败使列表为空）。
    // 主文件优先选 .ysm/.zip/.json，避免多文件模型误选首文件（如 a_tex.png）
    // 导致解码失败；孤儿 dir key（文件被删）无主文件则跳过，避免 Path 以 / 结尾。
    const groupRows = filesByGroup.get(name) ?? [];
    let size = 0;
    let mainRel = "";
    let mainRank = 0;
    for (const [fileRel, f] of groupRows) {
      size += f?.size ?? 0;
      // 嵌套 rel（含 /，如 tex/face.png）不参与主文件竞争：主文件必须在模型组根层
      // （对齐桌面目录模型：组根放 ysm.json/main.json，子目录为纹理/附属资源）
      const rank = fileRel.includes("/") ? MAIN_FILE_RANK_NONE : mainFileRank(fileRel);
      if (rank > mainRank) {
        mainRank = rank;
        mainRel = fileRel;
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
): Promise<Record<string, unknown> | null> {
  try {
    const b64 = await readWebFile(path);
    if (!b64) return null;
    const bytes = base64ToBytes(b64);
    if (!bytes) return null;
    const root = parseNbtRoot(bytes);
    const view = extract(root);
    return view ?? null;
  } catch {
    return null;
  }
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
  // ADR-040 治理：整组删除收敛为 idbTx——dir + 全部 file + ban/tags 标记
  // files / config 分属两个 store，各自单事务（IDB 单事务仅限单 store）。
  // 跨 store 仍非原子：files 事务提交后 config 事务失败会留 ban/tags 孤儿标记，
  // 调用方需 best-effort 重试清理。
  const fileOps: IdbOp[] = [{ kind: "del", key: dirKey(type, name) }];
  const fks = await idbKeys("files", `file:${type}/${name}/`);
  for (const k of fks) fileOps.push({ kind: "del", key: k });
  const cfgOps: IdbOp[] = [];
  // 清理 ban/tags 标记（随主事务一起，原子）
  for (const prefix of ["ban:", "tags:"]) {
    const keys = await idbKeys("config", `${prefix}/web/${type}/${name}/`);
    for (const k of keys) cfgOps.push({ kind: "del", key: k });
  }
  await idbTx("files", fileOps);
  if (cfgOps.length) await idbTx("config", cfgOps);
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
  // 单事务「写新+删旧」，避免两步非原子崩溃留双 key
  await idbTx("files", [
    { kind: "put", key: newKey, value: val },
    { kind: "del", key: oldKey },
  ]);
  // 移动按全路径 key 的 ban/tags 标记
  // 用函数替换绕过 finalName 含 $&/$1 等特殊序列时的展开（P1 注入修复）
  const newPath = oldPath.replace(/\/[^/]+$/, () => `/${finalName}`);
  for (const prefix of ["ban:", "tags:"]) {
    const oldMk = `${prefix}${oldPath}`;
    const newMk = `${prefix}${newPath}`;
    const mv = await idbGet("config", oldMk);
    if (mv !== undefined) {
      await idbTx("config", [
        { kind: "put", key: newMk, value: mv },
        { kind: "del", key: oldMk },
      ]);
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
 * ADR-040 治理：每阶段按 store 收敛为单事务（idbTx）——files 一批、config 一批，
 * 单个 store 内全有或全无（IDB 单事务仅限单 store；跨 files/config 仍两段，符合
 * IDB 能力上限）。原实现逐 key idbSet/idbDel 各开事务，中途崩溃会留新旧 key 并存。
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
    // 阶段一：写新 key（dir + file + 标记），全成功才进阶段二；按 store 单事务提交
    // ⚠️ 读-改-写窗口：idbKeys 扫旧 key + 逐个 idbGet 读旧值与下方 idbTx 写新值
    // 之间无事务包裹。若并发的 renameOrCopy 同时改写同一组 key，读到的旧值可能与
    // 写入时的新值不一致。当前 web 端单用户操作，并发概率低；多 tab 并发时可能残留。
    const fileOps: IdbOp[] = [];
    const cfgOps: IdbOp[] = [];
    const dv = await idbGet("files", dirKey(type, oldName));
    if (dv !== undefined) {
      fileOps.push({ kind: "put", key: dirKey(type, newName), value: { ...(dv as Record<string, unknown>), name: newName } });
      writtenNew.push(dirKey(type, newName));
    }
    const oldPrefix = `file:${type}/${oldName}/`;
    const fks = await idbKeys("files", oldPrefix);
    for (const k of fks) {
      const rel = k.slice(oldPrefix.length);
      const val = await idbGet("files", k);
      if (val !== undefined) {
        const nk = fileKey(type, newName, rel);
        fileOps.push({ kind: "put", key: nk, value: val });
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
          cfgOps.push({ kind: "put", key: nk, value: val });
          writtenNew.push(nk);
        }
      }
    }
    if (fileOps.length) await idbTx("files", fileOps);
    if (cfgOps.length) await idbTx("config", cfgOps);
    // 阶段二：全部新 key 写入成功 → 删旧 key（move 时），同样按 store 单事务
    if (move) {
      const delFileOps: IdbOp[] = [
        { kind: "del", key: dirKey(type, oldName) },
      ];
      for (const k of fks) delFileOps.push({ kind: "del", key: k });
      await idbTx("files", delFileOps);
      // 阶段二 config 删：两个 prefix 的删合并为单事务（与阶段一 cfgOps 对齐），
      // 避免 ban: 删成功后 tags: 删失败导致旧 tags: 残留（新旧并存）。
      const delCfgOps: IdbOp[] = [];
      for (const prefix of ["ban:", "tags:"]) {
        const scanPrefix = `${prefix}/web/${type}/${oldName}/`;
        const keys = await idbKeys("config", scanPrefix);
        delCfgOps.push(...keys.map((k) => ({ kind: "del" as const, key: k })));
      }
      if (delCfgOps.length) await idbTx("config", delCfgOps);
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
  // app-tree/loader、preview-library/siblings 等按 rtype 扫描候选列表。对齐 Go
  // app_scan.go:328-376：按 rtype 扩展名白名单过滤 + 命中条目填 type 字段。
  // subtype 参数已废弃（go/types/extensions.go:322 SupportedExtsForSubtype 直接忽略）。
  // rtype 空/未知（getExts 返回空）→ 退化不过滤（对齐 Go：白名单为空时不过滤）。
  // 已知差异（契约测试锁定）：Go 对 .zip/.7z 容器打开内容指纹核验（containerCache，
  // 内容非本 rtype 则剔除）；web 暂不验真，仅按扩展名白名单保留容器条目。
  ScanModelEntriesFiltered: async (dir: string, rtype: string, _subtype: string, _label: string) => {
    const entries = await scanWebModels(dir);
    const exts = getExts(rtype);
    if (exts.length === 0) return entries;
    const extSet = new Set(exts);
    return entries.filter((e) => extSet.has(e.Ext)).map((e) => ({ ...e, type: rtype }));
  },
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
  // DetectContainerType：base64 → 字节 → 内容指纹（extract.ts detectContainerType，对齐 Go 语义）
  DetectContainerType: (base64Data: string) => {
    if (!base64Data) return Promise.resolve("");
    // base64 大小守卫：上限对齐 MAX_IMPORT_BYTES（100MB 原始 → base64 约 133.4MB）——
    // 探测能力与导入上限同口径，50~100MB 的合法 zip 不再被旧 50MB 守卫误杀为 ""
    //（atob 内存压力与导入路径同量级，导入本身接受的输入探测也接受）
    if (base64Data.length > Math.ceil(MAX_IMPORT_BYTES / 3) * 4) {
      return Promise.resolve("");
    }
    // base64 → 字节统一走 web-common.base64ToBytes（复用容错原语，非法输入返回 null → ""）
    const bytes = base64ToBytes(base64Data);
    if (!bytes) return Promise.resolve("");
    return Promise.resolve(detectContainerType(bytes) || "");
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
  // 歧义容器读内容指纹（detectContainerType）。ADR-066 web 识别层对齐 Go：
  // 一处补上后非 YSM 类型（pack/shader/蓝图/投影/MMD/VRC）的预览路由不再误入
  // YSM 路径（原 fail-fast 导致 rtype="" 全落 YSM 解析报"无法解析"）
  DetectResourceType: async (path: string) => {
    const byExt = resolveTypeSafe(path);
    if (byExt) return byExt;
    const b64 = await readWebFile(path);
    if (!b64) return "";
    const bytes = base64ToBytes(b64);
    if (!bytes) return "";
    return detectContainerType(bytes);
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
  // Web Worker 批量分析，Worker 不可用降级为仅关键词匹配并在 UI 提示）。
  // 签名与 Go appservice.go:19 对齐（8 具名参数）——Go 侧增/改参数时类型检查即报漂移
  SearchModels: (
    filesRoot: string,
    keyword: string,
    minBones = 0,
    maxBones = 0,
    minCubes = 0,
    maxCubes = 0,
    minTex = 0,
    maxTex = 0,
  ) =>
    searchWebModels(
      filesRoot,
      keyword,
      minBones,
      maxBones,
      minCubes,
      maxCubes,
      minTex,
      maxTex,
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
