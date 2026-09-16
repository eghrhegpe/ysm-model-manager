// ===== Litematic 体素 3D 预览（ADR-066 P3：脚手架收缴进 mount-preview-core.ts）=====
// 内容层抽到 litematic-adapter.ts。本文件仅作兼容薄包装，保留
// createLitematic3D / cleanupVoxel3D / invalidateLitematicPreview 公开符号，
// litematic-meta.ts 与既有测试无需改动。voxelFn 经适配器工厂传入，决定走哪条 Go RPC。
// ADR-132 遗留 1：.zip 蓝图/投影容器先 ListContainerEntries 枚举 → 装配容器内多模型
// adapter（containerPath + modelEntries + 容器内 voxelCall），修复「zip 被当 gzip 打开」坏预览。

import type { VoxelData } from "@/parsers/voxel-types.ts";
import { makeLitematicAdapter } from "@/preview-3d/adapters/litematic-adapter.ts";
import {
  cleanupPreview,
  type Mount3DOptions,
  mount3D,
} from "@/preview-3d/adapters/mount-preview-core.ts";
import { extOf, isContainerExt, RESOURCE_TYPES, VOXEL_RPC_BY_EXT } from "@/utils/resource/types.ts";
import { backendGetApp } from "@/views/backend-deps.ts";
import { openModel3DFullscreen, registerReRoute, withPreviewExtras } from "./preview-library.ts";

/** 容器内体素条目扩展名白名单（ListContainerEntries 过滤口径，对齐 VOXEL_RPC_BY_EXT 键） */
const CONTAINER_VOXEL_EXTS = ".nbt,.litematic,.schematic";

/** 是否容器路径（.zip/.7z 蓝图/投影包）——容器内条目走枚举 + 容器内 voxelCall。
 *  G1 收口：改 isContainerExt（原 .zip 特判）。Go container 包统一支持 zip/7z/目录
 *  （go/container/container.go），.7z 蓝图包同样可 ListContainerEntries 枚举；
 *  特判 .zip 会让 7z 包走裸容器路径（被当 gzip 打开失败，ADR-132 zip 同类缺陷）。 */
function isContainerPath(path: string): boolean {
  return isContainerExt(path);
}

/** 容器内条目扩展名（.nbt/.litematic/.schematic 等；无匹配回退空 = 走默认体素构建） */
function entryExtOf(entry: string): string {
  const ext = extOf(entry);
  return VOXEL_RPC_BY_EXT[ext] ? ext : "";
}

/** voxel RPC 查表（单一分派点，替代 if/else 链——注册表新增 RPC 名只需在此加一行）。
 *  三 Go 绑定签名一致（GetNbtVoxelData / GetSchematicVoxelData / GetLitematicVoxelData，
 *  均返回 LitematicVoxelData | null，与前端 VoxelData 结构同源——null 差异由各绑定
 *  实现承担，此处仅收窄类型）。空串 = 历史默认语义（voxelFnFor 兜底）。
 *  未知名不在表内 → 调用方显式抛错（fail-loud，同原 if/else 语义）。 */
type VoxelApp = {
  GetNbtVoxelData(p: string): Promise<unknown>;
  GetSchematicVoxelData(p: string): Promise<unknown>;
  GetLitematicVoxelData(p: string): Promise<unknown>;
};

/** voxelCall 注入（视图壳层保留 getApp；适配器 0 backend import，ADR-072 边界判据）。
 *  voxelFn 是 VOXEL_RPC_BY_EXT 的 Go RPC 名（GetNbtVoxelData / GetSchematicVoxelData /
 *  GetLitematicVoxelData，三签名一致）——动态 key 保留（工厂注入），查表分派；
 *  未知名显式抛错（fail-loud，注册表增长失败响亮，同原审查 P3 意图）。
 *  ADR-143 P1：绑定返回 typed VoxelData | null（原 string JSON）。 */
function makeVoxelCall(voxelFn: string): (path: string) => Promise<VoxelData | null> {
  return async (path: string): Promise<VoxelData | null> => {
    const App = (await backendGetApp()) as unknown as VoxelApp;
    // 按 VOXEL_RPC_BY_EXT 值域收窄到三个具名方法（arrow 包装保留调用形态；未知名不在
    // 表内 → 显式抛错而非静默回退 GetLitematicVoxelData——注册表新增 RPC 名失败响亮）
    const table: Record<string, (p: string) => Promise<VoxelData | null>> = {
      GetNbtVoxelData: (p) => App.GetNbtVoxelData(p) as unknown as Promise<VoxelData | null>,
      GetSchematicVoxelData: (p) =>
        App.GetSchematicVoxelData(p) as unknown as Promise<VoxelData | null>,
      GetLitematicVoxelData: (p) =>
        App.GetLitematicVoxelData(p) as unknown as Promise<VoxelData | null>,
      // 空串 = 默认走 Litematic（历史语义，voxelFnFor 的兜底）
      "": (p) => App.GetLitematicVoxelData(p) as unknown as Promise<VoxelData | null>,
    };
    const fn = table[voxelFn];
    if (!fn) throw new Error(`未识别的 voxel RPC 名: ${voxelFn}`);
    return await fn(path);
  };
}

/** 容器内 voxelCall：GetVoxelDataInContainer(containerPath, entry, ext)（ADR-132 遗留 1）。
 *  ext 按条目路径逐条派生（entryExtOf：命中 VOXEL_RPC_BY_EXT 才用自身 ext）——mixed-format
 *  容器（a.nbt + x.schematic 混排，均在白名单）切换时派发各自 builder，而非沿用首条目 ext
 *  （审核修复 P1：旧实现捕获 entries[0] 的 ext 一次，第二格式必走错 builder）；未知扩展名
 *  回退捕获的默认 ext（单格式容器保持原语义，default → BuildVoxelDataFromRoot）。 */
function makeContainerVoxelCall(
  containerPath: string,
  fallbackExt: string,
): (entryPath: string) => Promise<VoxelData | null> {
  return async (entryPath: string): Promise<VoxelData | null> => {
    const App = await backendGetApp();
    return (await App.GetVoxelDataInContainer(
      containerPath,
      entryPath,
      entryExtOf(entryPath) || fallbackExt,
    )) as unknown as VoxelData | null;
  };
}

/** 枚举 zip 容器内体素条目（ListContainerEntries；失败返回 []，调用方降级单模型裸路径） */
async function listContainerEntries(containerPath: string): Promise<string[]> {
  try {
    const App = await backendGetApp();
    const parsed = await App.ListContainerEntries(containerPath, CONTAINER_VOXEL_EXTS);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** 打开 Litematic/蓝图 体素 3D 预览（voxelFn 由注册表 VOXEL_RPC_BY_EXT 解析）；siblings 提供同类型候选 */
export async function createLitematic3D(
  path: string,
  voxelFn: string,
  opts?: Mount3DOptions,
): Promise<void> {
  const extraOpts = withPreviewExtras(opts ?? {});
  // ADR-132 遗留 1：zip/7z 容器 → 先枚举容器内体素条目，装配容器内多模型 adapter
  if (isContainerPath(path)) {
    const entries = await listContainerEntries(path);
    if (entries.length > 0) {
      const firstExt = entryExtOf(entries[0]);
      await mount3D(
        makeLitematicAdapter({
          voxelCall: makeContainerVoxelCall(path, firstExt),
          container: {
            containerPath: path,
            modelEntries: entries,
            entryExt: firstExt,
          },
        }),
        entries[0],
        extraOpts,
      );
      return;
    }
    // 枚举失败/空容器：降级裸路径（zip 会被 gzip 打开失败——修复前正是此路径报错，
    // 现降级仍走原错误契约而非崩溃）
  }
  await mount3D(makeLitematicAdapter({ voxelCall: makeVoxelCall(voxelFn) }), path, extraOpts);
}

/** 按扩展名解析体素 RPC（对齐 litematic-meta.ts 的 VOXEL_RPC_BY_EXT 映射） */
function voxelFnFor(path: string): string {
  return VOXEL_RPC_BY_EXT[extOf(path)] || "GetLitematicVoxelData";
}

/** 跨类型换角色注册：投影/蓝图进入类型 tab（P2-2），opener 透传 siblings（P1-2） */
registerReRoute(RESOURCE_TYPES.LITEMATIC, (path, opts) =>
  createLitematic3D(path, voxelFnFor(path), opts),
);
registerReRoute(RESOURCE_TYPES.BLUEPRINT, (path, opts) =>
  createLitematic3D(path, voxelFnFor(path), opts),
);

/** 同台追加 Litematic/蓝图 模型：经统一路由主门收口（cooperate → keepInScene 追加，ADR-093 T4），与 mmd/vrm 对称 */
export async function appendLitematicPreview(path: string): Promise<void> {
  await openModel3DFullscreen(path, { cooperate: true });
}

/** 清理体素 3D（WebGL renderer + rAF 循环）：组件销毁/再次创建前调用，防 GPU 资源残留 */
export function cleanupVoxel3D(): void {
  cleanupPreview();
}
