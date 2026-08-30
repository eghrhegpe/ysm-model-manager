// ===== VRM 3D 菜单面板填充（ADR-076 v2 Phase 2：对齐 ysm-controls.ts 模式）=====
// VRM 专属面板（材质）集中于此，由 vrm-adapter 经 ctx.menu.setAdapterItems 注入 ⚙️ 根菜单。
import * as THREE from "three";
import {
  listVrmMaterials,
  getVrmMaterialDetail,
  setVrmMaterialVisible,
  setVrmMaterialOpacity,
  type VrmMaterialListItem,
  type VrmMaterialDetail,
} from "../../features/preview-3d/vrm-materials.ts";
import { t } from "../../core/i18n/t.ts";
import type { PreviewMenuNode } from "../../features/preview-3d/adapters/preview-menu/node-types.ts";
import type { VrmModelInfoCtx } from "../../features/preview-3d/adapters/vrm-adapter.ts";
import { shotButtonNodes } from "./shot-panel-shared.ts";

/** 材质控制桥：复用 vrm-materials.ts 纯逻辑层（显隐/透明/详情），DOM 渲染在本文件 */
export interface VrmMaterialControlBridge {
  list(): VrmMaterialListItem[];
  getDetail(index: number): VrmMaterialDetail | null;
  setVisible(index: number, visible: boolean): void;
  setOpacity(index: number, opacity: number): void;
}

/** VRM 模型信息声明式节点（[doc:adr-126-p4-b-1] children 样板，P5 收尾；对齐 mmdModelInfoNodes） */
export function vrmModelInfoNodes(ctx: VrmModelInfoCtx): PreviewMenuNode[] {
  return [
    { id: "vrm-model-name", kind: "field", labelKey: "preview.nameLabel", fallback: "名称", value: ctx.modelName },
    {
      id: "vrm-model-overview",
      kind: "field",
      labelKey: "preview.modelOverview",
      fallback: "模型",
      value: `${ctx.boneCount} 骨骼 ${ctx.materialCount} 材质`,
    },
  ];
}

/** VRM 截图面板声明式节点（[doc:adr-126-p4-b-1] children 样板，P5 收尾；对齐 mmdShotNodes）：
 *  screenshotFn null（无渲染器）→ 不注入按钮；modelForSave 用假对象，截图走活跃渲染器
 *  screenshotFn 通道（VRM 无离屏重建——.vrm 走不了 renderMultiAngle 的 YSM 解析管道） */
export function vrmShotNodes(
  screenshot: (() => Promise<string | null>) | null,
  modelPath: string,
): PreviewMenuNode[] {
  if (!screenshot) return [];
  // [doc:adr-126-p4-b-1] 只保留 current 按钮：saveScreenshot 的其余角度（front/45/side/
  // back45/all）走 renderMultiAngle 离屏重建，VRM 不支持 → 静默 no-op（a400b244 review P2）。
  // 按钮「假活」不如不注入——等离屏能力落地再扩回六角度。
  return shotButtonNodes(
    { boneCount: 0, cubeCount: 0, texWidth: 0, texHeight: 0, bones: [], _modelPath: modelPath, texture: "" },
    screenshot,
  )
    .filter((n) => n.id === "shot-current")
    .map((n) => ({ ...n, id: `vrm-${n.id}` }));
}