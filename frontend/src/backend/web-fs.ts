// ===== 网页版文件系统职责（ADR-040 拆分：browser-adapter.ts 职责切分产物）=====
// 文件系统类操作：IndexedDB 虚拟根 /web 的扫描/读写/删除/重命名/子目录映射。
// 被 web-store（标签聚合扫描）与 web-community（作者扫描/仓库索引）复用；
// browser-adapter.ts 从本文件 import 组装 webImpls。
// 共享原语（WebUnsupportedError / WEB_ROOT / MAX_IMPORT_BYTES / arrayBufferToBase64）
// 见 web-common.ts。拆分子模块（本文件门面 re-export 保持公共 API 原路径不变）：
//   - web-fs-shared.ts   key 规约 + 主文件优先级（叶子，断 auth↔import↔主文件 循环）
//   - web-fs-import.ts   导入分组（§15：zip 展平 / 粗细分组 / 写入回滚）
//   - web-fs-auth.ts     FSA 授权本地仓库（§3：句柄持久化 / 授权态 / 重扫入库）
//   - web-fs-scan.ts     模型库扫描 + 全库列表 + 搜索（§4/§9/§10）
//   - web-fs-mutate.ts   重命名/删除/移动复制（§11/§12/§13）
//
// ┌─ 快速跳转 ───────────────────────────────────────────────────────────────────┐
// │  §1  key 规约 + 主文件优先级 → web-fs-shared.ts                               │
// │  §3  FSA 授权持久化      → web-fs-auth.ts                                    │
// │  §4  模型库扫描           → web-fs-scan.ts  scanWebModels / scanAllWebModels  │
// │  §5  文件读取            → web-fs-read.ts  readWebFile                        │
// │  §6  NBT/体素 meta 读取   → 下文    readNbtMetaJson；web-fs-read.ts readVoxelJson│
// │  §6.5 容器内条目枚举+体素 → web-fs-container.ts                               │
// │  §7  pack/shaderpack 读取 → web-fs-pack.ts                                    │
// │  #5  Bedrock 预览 fallback → web-fs-bedrock.ts                                │
// │  §8  路径解析            → web-fs-read.ts  parseWebModelPath / parseWebModelDir│
// │  §9  列表                → web-fs-read.ts  listWebModelDirFiles；web-fs-scan.ts scanAllWebModels│
// │  §10 搜索                → web-fs-scan.ts  searchWebModels                    │
// │  §11 重命名              → web-fs-mutate.ts  assertValidRenameName / renameWebDir/File│
// │  §12 删除               → web-fs-mutate.ts  deleteWebModel                   │
// │  §13 移动/复制          → web-fs-mutate.ts  rekeyWebModelGroup / moveOrCopyWebModel│
// │  §14 子目录映射          → 下文    getWebSubDirMap / collectAllWebEntries     │
// │  §15 导入分组            → web-fs-import.ts                                   │
// │  §16 binding 装配        → 下文    webFsBindings（Top 6 注册表驱动）           │
// └──────────────────────────────────────────────────────────────────────────────┘

import { t } from "@/core/i18n/t.ts";
// R2 导入增强：detectContainerType 供 DetectResourceType 歧义容器内容指纹（ADR-066 web 识别层）
import { detectContainerType } from "@/parsers/extract.ts";
import { litematicVoxelView } from "@/parsers/litematic-voxel.ts";
// ADR-070 M1：蓝图/投影 meta 读取（NBT 解析 + 三个视图提取，TS 平移 go/litematic/parser.go）
import {
  litematicMetaView,
  nbtStructureView,
  parseNbtRoot,
  schematicSummaryView,
} from "@/parsers/nbt-parse.ts";
import { nbtVoxelView } from "@/parsers/nbt-voxel.ts";
import { schematicVoxelView } from "@/parsers/schematic-voxel.ts";
// YSM 头部/摘要 binding web 实现（TS 平移 go/ysm/header.go + summary.go；纯解析在
// ysm-header.ts，本文件只做 IDB 读取装配。消费方：import-queue-data.ts:278 作者/tips
// 预填、rename.ts:92 重命名 tips、detail.ts:58-62 详情 stats/license、loader.ts:140 作者兜底）
import {
  emptyYsmHeader,
  emptyYsmSummary,
  extractYsmSummaryFromBytes,
  parseYsmHeaderFromBytes,
} from "@/parsers/ysm-header.ts";
// rtype 扩展名白名单（resource_types.json 派生，单一事实源；ScanModelEntriesFiltered 过滤用）
import { getExts } from "@/utils/resource/extensions.ts";
// 全类型条目（id / instanceDir）同步读单一解析点 schema.ts
// （ADR-269 D3⑥：废本模块对 resource_types.json 的重复内联 import）
import { allResourceTypes } from "@/utils/resource/schema.ts";
// rtype 魔法字符串统一走 RESOURCE_TYPES 常量（治理红线 R7）
import { resolveTypeSafe } from "@/utils/resource/types.ts";
import type { ModelEntry } from "../../bindings/ysm-model-manager/go/types/models.ts";
import { idbGet, idbKeys } from "./idb.ts";
import {
  base64ToBytes,
  isWebPath,
  MAX_IMPORT_BYTES,
  parseWebDirPath,
  parseWebPath,
  WEB_ROOT,
} from "./web-common.ts";
import { getFsaAuthState, selectLocalRepo } from "./web-fs-auth.ts";
// #5 Bedrock 预览 fallback 链
import {
  webAnalyzeBedrockModel,
  webAnalyzeBedrockModelEntry,
  webExtractPreviewTexture,
  webFindPreviewImage,
} from "./web-fs-bedrock.ts";
// §6.5 容器内条目枚举 + 体素（ADR-132 遗留 1）
import { listWebContainerEntries, readWebVoxelInContainer } from "./web-fs-container.ts";
// 重命名/删除/移动复制段（§11/§12/§13：webFsBindings 内层调用）
import {
  deleteWebModel,
  moveOrCopyWebModel,
  renameWebDir,
  renameWebFile,
} from "./web-fs-mutate.ts";
// §7 pack/shaderpack meta 读取
import {
  listWebPackModels,
  listWebPackModelsDetail,
  readPackMetaJson,
  readShaderpackLangJson,
  readWebPackEntry,
} from "./web-fs-pack.ts";
// 共享读取装配 + 路径反解（web-fs-read.ts 叶子，断 container/pack/bedrock ↔ 主文件 循环）
import {
  listWebModelDirFiles,
  parseWebModelDir,
  parseWebModelPath,
  readVoxelJson,
  readWebFile,
} from "./web-fs-read.ts";
// 扫描/搜索段（§4/§9/§10：webFsBindings 内层调用；typeFromWebDir 经门面 re-export 保持公共路径）
import { scanWebModels, searchWebModels } from "./web-fs-scan.ts";

export {
  getFsaAuthState,
  reauthorizeFsaRoot,
  rescanFsaRoot,
  selectLocalRepo,
} from "./web-fs-auth.ts";
// 公共 API 原路径透出（browser-adapter / web-store / web-community 消费面零改动）：
// importWebFiles 主文件不再直接消费（FSA 入库走 web-fs-auth），仅门面转出
export { importWebFiles } from "./web-fs-import.ts";
// 变更段经此透出
export {
  deleteWebModel,
  moveOrCopyWebModel,
  renameWebDir,
  renameWebFile,
} from "./web-fs-mutate.ts";
// readWebFile 移入 web-fs-read.ts 后经此透出，web-community 消费面不变
export { readWebFile } from "./web-fs-read.ts";
// 扫描/搜索段经此透出（browser-adapter.test / web-fs.bindings.test / web-community 消费面不变）
export { scanAllWebModels, scanWebModels, searchWebModels, typeFromWebDir } from "./web-fs-scan.ts";

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

// ===== §14 子目录映射 =====
async function getWebSubDirMap(): Promise<Record<string, string>> {
  // 对齐 go/types/extensions.go SubDirAll：返回 rt.InstanceDir（整合包实例版本目录子目录），
  // 非 storageSubDir（仓库存储子目录）——B1 契约测试暴露的字段错用
  const map: Record<string, string> = {};
  for (const r of allResourceTypes) map[r.id] = r.instanceDir ?? "";
  return map;
}

/** 聚合所有资源类型的 IDB 模型条目（网页版「本地仓库」= 虚拟根 /web） */
export async function collectAllWebEntries(): Promise<ModelEntry[]> {
  const rts = allResourceTypes;
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
  ScanModelEntriesFiltered: async (
    dir: string,
    rtype: string,
    _subtype: string,
    _label: string,
  ) => {
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
    await Promise.all(
      paths.map(async (p) => {
        out[p] = await readWebFile(p);
      }),
    );
    return out;
  },
  ReadFileBytesBatchWithMeta: async (paths: string[] | null) => {
    if (!paths) return null;
    const out: Record<string, { data: string | null; hash: string }> = {};
    // hash 暂置空：网页版不为纹理缓存做 SHA256 批量预算，MMD 贴图加载不受影响
    await Promise.all(
      paths.map(async (p) => {
        out[p] = { data: await readWebFile(p), hash: "" };
      }),
    );
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
      return !!name && (rest === name || rest.startsWith(`${name}/`));
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
    // [ADR-174 附录 A] 与 Go 的实现策略差异：Go app_install_import.go:58 尾探针优先
    // （覆盖至导入上限 500MB）再整包兜底；web 因 atob 内存约束全量解码（上限
    // MAX_IMPORT_BYTES=100MB）。两侧各自「探测上限与导入上限同口径」——非漂移；
    // ⚠️ web 导入上限抬升时必须同步抬此守卫（联动条款）。
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
      ext === ".nbt"
        ? nbtVoxelView
        : ext === ".schematic"
          ? schematicVoxelView
          : litematicVoxelView,
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
  AnalyzeBedrockModelEntry: (path: string, subPath: string) =>
    webAnalyzeBedrockModelEntry(path, subPath),
  // rtype 含 / 时替换为 _，避免 /web/a/b 破坏 readWebFile 三段解析
  GetRepoRoot: (rtype: string) => Promise.resolve(`${WEB_ROOT}/${rtype.replace(/\//g, "_")}`),
  GetDefaultRepoRoot: () => Promise.resolve(WEB_ROOT),
  // 搜索：关键词 + 数值范围条件（min/max 骨骼/立方体/纹理，>0 才过滤；统计走
  // Web Worker 批量分析，Worker 不可用降级为仅关键词匹配并在 UI 提示）。
  // 签名与 Go appservice.go:19 对齐（8 具名参数）——Go 侧增/改参数时类型检查即报漂移
  // [ADR-174 D3 差异声明] kw 快路径（无数值条件）返回降级行 = 与 Go 的有意差异：
  // Go app_scan.go 恒 AnalyzeBedrockModel + BoneCount==0 排除 + Name 主键稳定排序；
  // web 不分析/不排除/不排序（扫描序）。契约锁定：contract-b1 B1c；UI 提示：
  // consumeWebSearchDegraded。此语义禁静默改动——先改 contract 再改实现。
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
    searchWebModels(filesRoot, keyword, {
      minBones,
      maxBones,
      minCubes,
      maxCubes,
      minTex,
      maxTex,
    }),
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
