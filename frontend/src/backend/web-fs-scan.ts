// ===== web-fs 扫描/搜索（ADR-040 职责切分延续，自 web-fs.ts §4/§9/§10 拆出）=====
// 来源：web-fs.ts L123-472（typeFromWebDir / scanWebModels / scanWebModelGroups /
// scanWebModelFilesInDir / groupFilesByDir / buildGroupEntry / scanAllWebModels /
// WebSearchResult / webDegradedMatches / NumericFilter / passesNumericFilters /
// toSearchResult / emitWebSearchHit / searchWebModels）。
// 职责：模型库扫描（IDB dir: 前缀 → ModelEntry 列表）+ 全库递归列表 + 关键词/数值
// 范围搜索（Worker 批量统计）。与 Go ScanModelEntries / ListAllFilePaths /
// SearchModels 对齐；公共 API 由 web-fs.ts 门面 re-export 保持原路径不变。
// 本模块只做「读 IDB → 归组/收敛 → ModelEntry/WebSearchResult」，不触碰文件写入语义
// （写入见 web-fs-import.ts / web-fs-mutate.ts）。

import { allResourceTypes } from "@/utils/resource/schema.ts";
import { RESOURCE_TYPES } from "@/utils/resource/types.ts";
import type { ModelEntry } from "../../bindings/ysm-model-manager/go/types/models.ts";
import { idbGet, idbGetAll, idbGetAllMetadata } from "./idb.ts";
import { WEB_ROOT, webDirType } from "./web-common.ts";
import { listWebModelDirFiles, parseWebModelPath } from "./web-fs-read.ts";
import {
  dirKey,
  fileKey,
  MAIN_FILE_RANK_NONE,
  MAIN_FILE_RANK_TYPE,
  mainFileRank,
} from "./web-fs-shared.ts";
import { batchStatsWebModels, type WebModelStats } from "./web-stats.ts";

// ===== §1 key 规约（typeFromWebDir 原属 web-fs.ts §1，随扫描段一并下沉）=====

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

/** 抽出降复杂度/复用：文件行按「dir name 前缀」归组（scanWebModelGroups 内层大循环）。
 *  组名按长度降序排——首次 startsWith 命中即最长匹配（P1 性能修复）；
 *  保留孤儿文件 continue（无对应 dir key）与 fileRel 截取语义。 */
function groupFilesByDir(
  fileMetaRows: ReadonlyArray<[string, { size?: number }]>,
  filePrefix: string,
  sortedGroups: ReadonlyArray<string>,
): Map<string, Array<[string, { size?: number }]>> {
  // 文件行按「dir name 前缀」归组：文件 key = file:<type>/<name>/<rel>，
  // name 可含多段路径（目录树），故以 dir name + "/" 为前缀匹配。
  // 组名按长度降序排——首次 startsWith 命中即最长匹配，
  // 避免逐组全量扫描（O(文件×组) → O(文件×log组)，P1 性能修复）
  const filesByGroup = new Map<string, Array<[string, { size?: number }]>>();
  for (const [fk, fv] of fileMetaRows) {
    const rel = fk.slice(filePrefix.length);
    let bestGroup = "";
    for (const name of sortedGroups) {
      if (rel.startsWith(`${name}/`)) {
        bestGroup = name;
        break;
      }
    }
    if (!bestGroup) continue; // 孤儿文件（无对应 dir key）
    const fileRel = rel.slice(bestGroup.length + 1);
    const arr = filesByGroup.get(bestGroup);
    if (arr) arr.push([fileRel, fv as { size?: number }]);
    else filesByGroup.set(bestGroup, [[fileRel, fv as { size?: number }]]);
  }
  return filesByGroup;
}

/** 抽出降复杂度/复用：每个模型组收敛为一条主文件 ModelEntry（scanWebModelGroups 内层收敛块）。
 *  主文件竞争 / 大小汇总 / Ext/subdir 计算语义原样保留；mainRank < MAIN_FILE_RANK_TYPE
 *  时返回 null（原 continue → 调用方跳过该组）。 */
function buildGroupEntry(
  name: string,
  meta: { name?: string; addedAt?: number } | undefined,
  groupRows: Array<[string, { size?: number }]>,
  root: string,
): ModelEntry | null {
  // 汇总该模型全部文件大小；Path/Name 指向主文件（含扩展名，与桌面
  // scanner.go:136 Name=filepath.Base(p) 含扩展名、Ext=原扩展名一致——
  // 否则 loader.ts 的 name.endsWith(ext) 过滤会恒失败使列表为空）。
  // 主文件优先选 .ysm/.zip/.json，避免多文件模型误选首文件（如 a_tex.png）
  // 导致解码失败；孤儿 dir key（文件被删）无主文件则跳过，避免 Path 以 / 结尾。
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
  if (mainRank < MAIN_FILE_RANK_TYPE) return null;
  // Ext 与桌面一致：小写化 + 无点号保护（lastIndexOf=-1 时 slice(-1) 会取 "E" 之类的字符）
  const dot = mainRel.lastIndexOf(".");
  const ext = dot > 0 ? mainRel.slice(dot).toLowerCase() : "";
  // ADR-096：subdir 仅作元数据保留，不参与 Path 拼接。
  // 网页版 name 已含子目录路径（如 "SceneModel/角色A"），无需额外提取。
  const nameParts = name.split("/");
  const subDir = nameParts.length > 1 ? nameParts[0] : "";
  return {
    Name: mainRel,
    Size: size,
    Path: `${root}/${name}/${mainRel}`,
    Ext: ext,
    Hash: "",
    ModTime: meta?.addedAt ?? Date.now(),
    HasTags: false,
    subdir: subDir,
  };
}

/** 根目录扫描：每个模型组收敛为一条主文件 ModelEntry */
async function scanWebModelGroups(type: string, root: string): Promise<ModelEntry[]> {
  // P0-1 优化：原本每模型组 1 次 meta get + 1 次 file 前缀扫 + N 次 file get
  // （N+1 串行事务，千级模型 ~2000+ 往返）。改为两次前缀批量操作收敛：
  //   ① idbGetAll("dir:type/")   一次事务拿全部 dir key+value（含 addedAt meta）
  //   ② idbGetAllMetadata("file:type/")  一次事务投影 size/mime（code_review
  //      53e59e02 #7：IDB 无部分值读取，cursor.value 仍克隆整条含 data——
  //      此处省的是把 data 传回调用方，不是省克隆成本）
  // 内存按组名收敛，主文件竞争 / 大小汇总在内存完成——总 IDB 事务数 O(1)。
  const [dirRows, fileMetaRows] = await Promise.all([
    idbGetAll("files", `dir:${type}/`),
    idbGetAllMetadata("files", `file:${type}/`),
  ]);
  const dirPrefix = `dir:${type}/`;
  const filePrefix = `file:${type}/`;
  // dir 值按完整 name 索引（key 升序 → name 有序）
  const dirMeta = new Map<string, { name?: string; addedAt?: number }>();
  for (const [k, v] of dirRows) {
    const name = k.slice(dirPrefix.length, -1);
    if (name) dirMeta.set(name, v as { name?: string; addedAt?: number });
  }
  // 文件行按「dir name 前缀」归组（纯函数抽至 groupFilesByDir）
  const sortedGroups = [...dirMeta.keys()].sort((a, b) => b.length - a.length);
  const filesByGroup = groupFilesByDir(fileMetaRows, filePrefix, sortedGroups);
  const entries: ModelEntry[] = [];
  for (const [name, meta] of dirMeta) {
    // 每个模型组收敛为一条主文件条目（纯函数抽至 buildGroupEntry；
    // mainRank < MAIN_FILE_RANK_TYPE 的组在此跳过，对齐原 continue 语义）
    const entry = buildGroupEntry(name, meta, filesByGroup.get(name) ?? [], root);
    if (entry) entries.push(entry);
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

// ===== §9 列表（递归列出 /web 目录全部文件路径）=====
/** 扫描全部资源类型的模型（供标签聚合 / 子目录映射等全库操作） */
export async function scanAllWebModels(): Promise<
  Array<{ type: string; name: string; path: string }>
> {
  const rts = allResourceTypes;
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

/** 搜索数值过滤条件（对齐桌面 SearchModels 六条数值范围；>0 才参与过滤）。 */
interface NumericFilter {
  minBones: number;
  maxBones: number;
  minCubes: number;
  maxCubes: number;
  minTex: number;
  maxTex: number;
}

/** 抽出降复杂度/复用：单条模型统计是否通过数值范围过滤（对齐桌面 SearchModels 六条条件）。
 *  与 webDegradedMatches 对称拆分——数值过滤降复杂度后语义零变化（minBones>0 && ...<... 同原序）。
 *  六条排除条件以短路 || 合并为单一布尔，避免逐条 if 嵌套累计认知复杂度。 */
function passesNumericFilters(s: WebModelStats, f: NumericFilter): boolean {
  const excluded =
    (f.minBones > 0 && s.boneCount < f.minBones) ||
    (f.maxBones > 0 && s.boneCount > f.maxBones) ||
    (f.minCubes > 0 && s.cubeCount < f.minCubes) ||
    (f.maxCubes > 0 && s.cubeCount > f.maxCubes) ||
    (f.minTex > 0 && (s.texWidth < f.minTex || s.texHeight < f.minTex)) ||
    (f.maxTex > 0 && (s.texWidth > f.maxTex || s.texHeight > f.maxTex));
  return !excluded;
}

/** 抽出降复杂度/复用：数值命中的 (ModelEntry, 统计) → WebSearchResult 映射（与 webDegradedMatches 对称）。 */
function toSearchResult(e: ModelEntry, s: WebModelStats): WebSearchResult {
  return {
    name: e.Name,
    path: e.Path,
    boneCount: s.boneCount,
    cubeCount: s.cubeCount,
    texWidth: s.texWidth,
    texHeight: s.texHeight,
    hasError: false,
  };
}

/** 抽出降复杂度/复用：单条命中条目按统计过滤后写入结果（保持 stats[i] 索引对齐与
 *  排除/写入顺序语义：先排除 hasError，再过数值条件，最后映射入 out）。 */
function emitWebSearchHit(
  e: ModelEntry,
  s: WebModelStats,
  f: NumericFilter,
  out: WebSearchResult[],
): void {
  // 对齐 Go：统计失败（BoneCount==0 等价 hasError）在数值条件下直接排除
  if (!s || s.hasError) return;
  // 数值条件过滤（纯函数抽至 passesNumericFilters，六条顺序与原 if 链一致）
  if (!passesNumericFilters(s, f)) return;
  out.push(toSearchResult(e, s));
}

export async function searchWebModels(
  filesRoot: string,
  keyword: string,
  filters?: {
    minBones?: number;
    maxBones?: number;
    minCubes?: number;
    maxCubes?: number;
    minTex?: number;
    maxTex?: number;
  },
): Promise<WebSearchResult[]> {
  const {
    minBones = 0,
    maxBones = 0,
    minCubes = 0,
    maxCubes = 0,
    minTex = 0,
    maxTex = 0,
  } = filters ?? {};
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
  //（降级行语义 = 与 Go 的有意差异，声明见 SearchModels binding D3 注释 / contract-b1 B1c）
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
  const f: NumericFilter = { minBones, maxBones, minCubes, maxCubes, minTex, maxTex };
  const out: WebSearchResult[] = [];
  matched.forEach((e, i) => {
    const s = stats[i];
    // stats[i] 索引对齐 matched 数组；排除/写入顺序语义由 emitWebSearchHit 保持
    emitWebSearchHit(e, s, f, out);
  });
  return out;
}
