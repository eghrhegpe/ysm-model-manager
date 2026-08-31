// ===== YSM 3D 菜单面板填充（ADR-076 v2 Phase 2：底部导航收编进声明式根菜单）=====
// adapter 保持「内容构建 + 装配」单一职责；YSM 专属面板（模型 fill3DPanel / 截图 /
// 骨骼拾取联动）集中于此，由 ysm-adapter 经 ctx.menu.setAdapterItems 注入 ⚙️ 根菜单。
// 旧 buildYsmBottomNav / mkNavBtn / popupSection / popupRow 已随 Phase 2 删除——
// 控件全部表驱动渲染，测试遍历 CORE_MENU_ITEMS + 适配器真实注入项断言结构
// （preview-menu/items.test.ts，对齐 MikuMikuAR 声明式菜单测试范式）。

import { TOAST_MS } from "../../utils/dom/toast-ms.ts";
import * as THREE from "three";
import { bus } from "../../bus.ts";
import { friendlyError } from "../../utils/dom/errors.ts";
import { t } from "../../core/i18n/t.ts";
import { saveScreenshot } from "./skeleton-render.ts";
import type { PreviewMenuNode } from "../../preview-3d/menu/node-types.ts";
import { makeShotAction, shotButtonNodes } from "./shot-panel-shared.ts";
import type { Spec3D, BoneSelectInfo } from "../../preview-3d/model3d.ts";
import type { BedrockGeometry } from "../../preview-3d/decoder/geometry.ts";
import type { CameraControlBridge } from "../../preview-3d/adapters/camera-controls.ts";
export type { CameraControlBridge };
import { registerSchema, unregisterSchema, makeYsmModelSchemaId, YSM_MODEL_SCHEMA_ID } from "../../preview-3d/adapters/schema-registry.ts";
import { buildYsmModelSchema } from "./skeleton-fill-panel.ts";

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

/**
 * [doc:adr-126-p4-b-2] YSM 截图面板——声明式节点版。
 * 共享逻辑在 shot-panel-shared.ts（shotButtonNodes），screenshot 为 ctx 可选字段
 * （undefined = 走 saveScreenshot fallback，面板常驻——与 MMD 能力缺失不注入不同）。
 * fillYsmShotPanel 保留（向后兼容）；新面板路径走本函数。
 */
export function ysmShotNodes(ctx: YsmControlsContext): PreviewMenuNode[] {
  return shotButtonNodes(ctx.model, ctx.screenshot).map((n) => ({ ...n, id: `ysm-${n.id}` }));
}

/** 截图面板：6 角度保存（原视图菜单截图子区，相机控件已归 core 根菜单 camera 项） */
export function fillYsmShotPanel(list: HTMLElement, ctx: YsmControlsContext): void {
  const saveShot = makeShotAction(ctx.model, ctx.screenshot);
  for (const key of ["current", "front", "45", "side", "back45", "all"] as const) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "ysm-3d-popbtn ysm-3d-popbtn--row";
    item.textContent = "📷 " + t("preview.screenshot" + key[0].toUpperCase() + key.slice(1));
    item.dataset.testid = "shot-" + key;
    item.onclick = (): void => {
      void saveShot(key);
    };
    list.appendChild(item);
  }
}

/**
 * [doc:adr-126-p5→B2] YSM model 面板受控 schema 注册 + 组件选择副作用装配。
 * maid-3d / ysm-3d 共用：注册 buildYsmModelSchema（吃状态层快照 + per-scene 会话态闭包）。
 *
 * @param sessionId 当前 3D 会话稳定 id（mount 层生成，per-mount 唯一）。传入 → 注册到
 *   per-scene key `ysm-model-{sessionId}`（多模型同框防互相覆盖，Bug A 根因修复，对齐
 *   litematic `litematic-slice-{n}` 范式）；缺省（旧调用/测试）→ 退化为旧全局键
 *   YSM_MODEL_SCHEMA_ID（兼容不破）。
 * @deprecated 省略 sessionId 的调用形态仅保留兼容——新调用必须传 sessionId，
 *   否则多模型同台仍会互相覆盖 builder。
 *
 * B2 变更：activeComponent 从全局状态层收敛为本地闭包（per-scene 会话态）——
 *   不再 subscribeSettings("ui.activeComponent")（旧链：状态层广播 → 回调读全局值 →
 *   showModelGroup；模块级单值跨预览泄漏，maid generic 模式 clamp 会误伤同台 YSM）。
 *   返回 off：dispose 时注销 schema + 清本地会话态（防陈旧 builder 闭包持有已销毁场景）。
 */
export function registerYsmModelSchema(ctx: YsmControlsContext, sessionId?: string): () => void {
  const schemaId = sessionId ? makeYsmModelSchemaId(sessionId) : YSM_MODEL_SCHEMA_ID;
  // per-scene 会话态：组件选择真源（-1 = All）——随本次注册闭包生灭，不入全局状态层
  let activeComponent = -1;
  const sessionActiveComponent = {
    get: (): number => activeComponent,
    set: (n: number): void => {
      activeComponent = n;
      // 单一消费点副作用：切 3D 显示组（与旧订阅链同语义，防 listeners 只增不减）
      ctx.handle.showModelGroup(n);
    },
  };
  registerSchema(schemaId, (snap) =>
    buildYsmModelSchema(
      { model: ctx.model, spec: ctx.spec, texArr: ctx.texArr as THREE.Texture[] },
      snap,
      sessionActiveComponent,
    ),
  );
  return () => {
    unregisterSchema(schemaId);
  };
}



