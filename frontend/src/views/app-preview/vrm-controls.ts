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
} from "../../utils/3d/vrm-materials.ts";
import { t } from "../../core/i18n/t.ts";
import type { PreviewMenuNode } from "../../utils/3d/adapters/preview-menu-node-types.ts";
import type { VrmModelInfoCtx } from "../../utils/3d/adapters/vrm-adapter.ts";
import { shotButtonNodes } from "./shot-panel-shared.ts";

/** 材质控制桥：复用 vrm-materials.ts 纯逻辑层（显隐/透明/详情），DOM 渲染在本文件 */
export interface VrmMaterialControlBridge {
  list(): VrmMaterialListItem[];
  getDetail(index: number): VrmMaterialDetail | null;
  setVisible(index: number, visible: boolean): void;
  setOpacity(index: number, opacity: number): void;
}

/**
 * 在 container 渲染 VRM 材质面板：每行 = 显隐开关（👁/🚫）+ 名称 + 透明度滑条。
 * 复用 🥉 slide-item 行样式（对齐 buildMaterialControls 口径）。
 * 纯渲染层——所有状态变更经 bridge 下沉到 vrm-materials.ts，本函数零业务逻辑。
 */
function buildVrmMaterialControls(
  container: HTMLElement,
  bridge: VrmMaterialControlBridge,
): void {
  const items = bridge.list();
  if (items.length === 0) {
    const empty = document.createElement("div");
    empty.className = "slide-sublabel";
    empty.style.cssText = "padding:8px 10px;color:rgba(128,128,128,0.85);font-size:12px";
    empty.textContent = "（无材质）";
    container.appendChild(empty);
    return;
  }
  items.forEach((it) => {
    const detail = bridge.getDetail(it.index);
    const visible = detail?.visible ?? true;
    const opacity = Math.round((detail?.opacity ?? 1) * 100);

    const row = document.createElement("div");
    row.className = "slide-item vrm-mat-row";
    row.setAttribute("data-testid", "mat-" + it.index);
    row.tabIndex = 0;
    row.setAttribute("role", "button");

    const eye = document.createElement("button");
    eye.type = "button";
    eye.className = "vrm-mat-eye";
    eye.title = visible ? "隐藏" : "显示";
    eye.textContent = visible ? "👁" : "🚫";
    eye.style.cssText =
      "flex:0 0 auto;background:none;border:none;cursor:pointer;font-size:14px;padding:0 6px 0 0;line-height:1";
    eye.onclick = (e: MouseEvent): void => {
      e.stopPropagation();
      const cur = bridge.getDetail(it.index)?.visible ?? true;
      bridge.setVisible(it.index, !cur);
      const nv = bridge.getDetail(it.index)?.visible ?? true;
      eye.textContent = nv ? "👁" : "🚫";
      eye.title = nv ? "隐藏" : "显示";
    };

    const label = document.createElement("span");
    label.className = "slide-label";
    label.textContent = it.name;
    label.style.cssText = "flex:1 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0";

    const op = document.createElement("input");
    op.type = "range";
    op.min = "0";
    op.max = "100";
    op.value = String(opacity);
    op.className = "vrm-mat-op";
    op.setAttribute("data-testid", "mat-op-" + it.index);
    op.style.cssText = "flex:0 0 auto;width:72px;cursor:pointer;accent-color:var(--accent,#7c83ff)";
    op.oninput = (): void => {
      bridge.setOpacity(it.index, Number(op.value) / 100);
    };
    op.onclick = (e: MouseEvent): void => e.stopPropagation();

    row.appendChild(eye);
    row.appendChild(label);
    row.appendChild(op);
    row.onclick = (): void => eye.click();
    container.appendChild(row);
  });
}

/** VRM 菜单面板渲染器（声明式菜单 item.render 回调）*/
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

export function makeVrmPanelRenderer(
  bridge: VrmMaterialControlBridge,
): (list: HTMLElement) => void {
  return (list): void => buildVrmMaterialControls(list, bridge);
}