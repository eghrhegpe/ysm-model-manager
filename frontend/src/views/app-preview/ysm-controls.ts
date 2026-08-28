// ===== YSM 3D 菜单面板填充（ADR-076 v2 Phase 2：底部导航收编进声明式根菜单）=====
// adapter 保持「内容构建 + 装配」单一职责；YSM 专属面板（模型 fill3DPanel / 截图 /
// 骨骼拾取联动）集中于此，由 ysm-adapter 经 ctx.menu.setAdapterItems 注入 ⚙️ 根菜单。
// 旧 buildYsmBottomNav / mkNavBtn / popupSection / popupRow 已随 Phase 2 删除——
// 控件全部表驱动渲染，测试遍历 CORE_MENU_ITEMS + 适配器真实注入项断言结构
// （preview-menu-items.test.ts，对齐 MikuMikuAR 声明式菜单测试范式）。

import { TOAST_MS } from "../../utils/dom/toast-ms.ts";
import * as THREE from "three";
import { bus } from "../../bus.ts";
import { friendlyError } from "../../utils/dom/errors.ts";
import { t } from "../../core/i18n/t.ts";
import { saveScreenshot } from "./skeleton-render.ts";
import { fill3DPanel } from "./skeleton-fill-panel.ts";
import type { Spec3D, BoneSelectInfo } from "../../utils/3d/model3d.ts";
import type { BedrockGeometry } from "./geometry.ts";
import type { CameraControlBridge } from "../../utils/3d/adapters/camera-controls.ts";
export type { CameraControlBridge };

/** 模型对象（对齐 fill3DPanel / saveScreenshot 的字段需求；ysm-adapter 复用此类型） */
export type YsmModel = BedrockGeometry & {
  textures?: string[] | null;
  _modelPath?: string;
  textureNames?: string[];
  boneCount?: number;
  bones?: unknown[];
};

/** YSM 内容层句柄（shared 化：相机操作走核心 cameraControls，本句柄只管内容/骨骼） */
export interface YsmContentHandle {
  showModelGroup(i: number): void;
  getModelGroupCount(): number;
  setBoneVisible(name: string, visible: boolean): void;
  toggleBone(name: string): void;
  getBoneList(modelIdx?: number): Array<{ id: string; name: string; parentId?: string | null }>;
  /** 骨骼拾取回调（由控件层设置，适配器转发到 raycast state） */
  onBoneSelect: ((info: BoneSelectInfo) => void) | null;
  /** 骨骼详情框（fill3DPanel 写入） */
  _boneDetailEl: HTMLElement | null;
}

/** 控件装配上下文：由 ysm-adapter 在 buildYsmScene 内组装传入 */
export interface YsmControlsContext {
  model: YsmModel;
  /** 当前纹理下标（纹理选择器初始值） */
  texIdx: number;
  /** preloadModel 返回的纹理数组（可能含 null——缺失纹理占位，fill3DPanel 内断言） */
  texArr: (THREE.Texture | null)[];
  spec: Spec3D;
  /** YSM 内容层句柄（模型组/骨骼显隐/拾取回调） */
  handle: YsmContentHandle;
  /** shared 模式下核心的相机控制桥（Phase 2 后相机归核心根菜单 camera 项，本字段保留兼容） */
  cameraControls?: CameraControlBridge;
  /** 用户切换纹理时触发重建（旧 overlay 清理 + 按新 texIdx 重新挂载） */
  onTextureChange?: (texIdx: number) => void;
  /** 截取当前 3D 渲染画面（PNG base64，无 data: 前缀）—— ADR-052 P3 通用化 */
  screenshot?(): Promise<string | null>;
}

/** 连点/多菜单触发时忽略并发（防重复保存文件）——对齐原 skeleton.ts makeShotGuard */
function makeShotGuard(): { saving: boolean; setSaving: (v: boolean) => void } {
  let _saving = false;
  return {
    get saving() {
      return _saving;
    },
    setSaving: (v: boolean) => {
      _saving = v;
    },
  };
}

/** 模型菜单面板：统计 / 纹理 / 骨骼列表 / 骨骼详情 / 多组件切换（fill3DPanel 内容） */
export function fillYsmModelPanel(list: HTMLElement, ctx: YsmControlsContext): void {
  const modelSel = document.createElement("select");
  modelSel.className = "ysm-3d-popselect";
  modelSel.style.display = "none";
  modelSel.onchange = (): void => {
    ctx.handle.showModelGroup(parseInt(modelSel.value, 10));
  };
  if (ctx.handle.getModelGroupCount() > 1) {
    modelSel.style.display = "";
    list.appendChild(modelSel);
  }
  fill3DPanel(
    list as HTMLDivElement,
    ctx.model,
    ctx.texArr as THREE.Texture[],
    ctx.spec as Spec3D,
    ctx.handle,
    modelSel,
  );
}

/** 截图面板：6 角度保存（原视图菜单截图子区，相机控件已归 core 根菜单 camera 项） */
export function fillYsmShotPanel(list: HTMLElement, ctx: YsmControlsContext): void {
  const shot = makeShotGuard();
  const shotKeys = ["current", "front", "45", "side", "back45", "all"] as const;
  const shotLabels = [
    t("preview.screenshotCurrent"),
    t("preview.screenshotFront"),
    t("preview.screenshot45"),
    t("preview.screenshotSide"),
    t("preview.screenshotBack45"),
    t("preview.screenshotAll"),
  ];
  const saveShot = async (key: string): Promise<void> => {
    if (shot.saving) return;
    shot.setSaving(true);
    try {
      await saveScreenshot(ctx.model, key, () => {}, ctx.screenshot);
    } catch (e) {
      console.error("[3D 截图]", e);
      bus.emit("toast:show", {
        msg: "截图保存失败：" + friendlyError(e),
        duration: TOAST_MS.verbose,
        type: "error",
      });
    } finally {
      shot.setSaving(false);
    }
  };
  shotKeys.forEach((key, i) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "ysm-3d-popbtn ysm-3d-popbtn--row";
    item.textContent = "📷 " + shotLabels[i];
      item.dataset.testid = "shot-" + key;
    item.onclick = (): void => {
      void saveShot(key);
    };
    list.appendChild(item);
  });
}



