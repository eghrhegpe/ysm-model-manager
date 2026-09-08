// ===== 预览注册表配置 =====
// 从 index.ts 拆分：类型派发 / 清理 / 作废三份注册表集中管理。
// 新增格式 = 这里加对应条目，无需改路由逻辑。

import { RESOURCE_TYPES } from "@/utils/resource/types.ts";
import { showModelDetail, showResourcePack, showShaderpack, showSimplePreview } from "./detail.ts";
import {
  showFbxPreview,
  showMmdPreview,
  showMorphPreview,
  showScenePreview,
  showStagePreview,
  showVrmMeta,
} from "./detail-3d.ts";
import { cleanupEmpty3D, invalidateEmptyPreview } from "./empty-3d.ts";
import { cleanupLitematic3D, invalidateLitematicPreview, showLitematic } from "./litematic-meta.ts";
import { cleanupMaid3D, invalidateMaidPreview, showMaidPreview } from "./maid-3d.ts";
import { cleanupMmd3D, invalidateMmdPreview } from "./mmd-3d.ts";
import { cleanupPack3D, invalidatePackPreview } from "./pack-3d.ts";
import { cleanupScene3D, invalidateScenePreview } from "./scene-3d.ts";
import type { PreviewCtx } from "./utils.ts";
import { cleanupVrm3D, invalidateVrmPreview } from "./vrm-3d.ts";

/** 预览 show 函数签名：ctx + path + 类型元信息（icon/label） */
export type PreviewShowFn = (
  ctx: PreviewCtx,
  path: string,
  meta: { icon: string; label: string },
) => void;

/**
 * 类型 → show 派发映射表（ADR-072 D2：注册表驱动查表）。
 * 新增格式 = 注册表一条目 + 这里一行。
 * VRC 的 .vrm（3D meta 卡）/ .vrca/.zip（简单预览）分支收进 handler 内部。
 */
export const PREVIEW_HANDLERS: Record<string, PreviewShowFn> = {
  // ADR-080：资源包详情卡（pack.mcmeta + pack.png）+ 🏗️ FAB 进 3D 模型预览。
  [RESOURCE_TYPES.PACK]: (ctx, path) => showResourcePack(ctx, path),
  [RESOURCE_TYPES.YSM]: (ctx, path) => showModelDetail(ctx, path),
  [RESOURCE_TYPES.MAID]: (ctx, path) => showMaidPreview(ctx, path),
  [RESOURCE_TYPES.LITEMATIC]: (ctx, path) => showLitematic(ctx, path),
  [RESOURCE_TYPES.BLUEPRINT]: (ctx, path) => showLitematic(ctx, path),
  [RESOURCE_TYPES.SHADER]: (ctx, path, meta) => showShaderpack(ctx, path, meta),
  // MMD 角色模型（EntityPlayer）— ADR-111 variants 复合 key 查表分发（G1 收口）
  [`${RESOURCE_TYPES.MMD}:vrm`]: (ctx, path, meta) => showVrmMeta(ctx, path, meta),
  [RESOURCE_TYPES.MMD]: (ctx, path, meta) => showMmdPreview(ctx, path, meta),
  // MMD 独立顶级类型（后端 DetectResourceType 路径消歧命中时直接路由）
  SceneModel: (ctx, path) => showScenePreview(ctx, path),
  CustomMorph: (ctx, path) => showMorphPreview(ctx, path),
  StageAnim: (ctx, path) => showStagePreview(ctx, path),
  CustomAnim: (ctx, path, meta) => showSimplePreview(ctx, path, meta),
  DefaultAnim: (ctx, path, meta) => showSimplePreview(ctx, path, meta),
  DefaultMorph: (ctx, path, meta) => showSimplePreview(ctx, path, meta),
  "mmd-shader": (ctx, path, meta) => showSimplePreview(ctx, path, meta),
  // FBX 独立预览（ADR-112：模型 + 内嵌动画，物理落 CustomAnim 目录）
  fbx: (ctx, path, meta) => showFbxPreview(ctx, path, meta),
};

/**
 * 3D 预览清理注册表：切页时无差别全清（WebGL renderer + rAF 循环）。
 * 新增格式 = 这里加一行，disconnectedCallback 自动遍历。
 * FBX 走共享单例（scene-3d），无需独立 cleanup，故不在表中。
 */
export const PREVIEW_CLEANUP: Array<() => void> = [
  cleanupLitematic3D,
  cleanupVrm3D,
  cleanupMmd3D,
  cleanupScene3D,
  cleanupPack3D,
  cleanupEmpty3D,
  cleanupMaid3D,
];

/**
 * 3D 预览作废注册表：任意新选择作废在飞渲染，防跨类型污染。
 * 新增格式 = 这里加一行，model:select handler 自动遍历。
 */
export const PREVIEW_INVALIDATE: Array<() => void> = [
  invalidateLitematicPreview,
  invalidateVrmPreview,
  invalidateMmdPreview,
  invalidateScenePreview,
  invalidatePackPreview,
  invalidateEmptyPreview,
  invalidateMaidPreview,
];
