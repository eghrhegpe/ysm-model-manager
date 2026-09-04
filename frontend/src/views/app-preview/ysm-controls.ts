// ===== YSM 3D 菜单面板填充（ADR-076 v2 Phase 2：底部导航收编进声明式根菜单）=====
// adapter 保持「内容构建 + 装配」单一职责；YSM 专属面板（模型 fill3DPanel / 截图 /
// 骨骼拾取联动）集中于此，由 ysm-adapter 经 ctx.menu.setAdapterItems 注入 ⚙️ 根菜单。
// 旧 buildYsmBottomNav / mkNavBtn / popupSection / popupRow 已随 Phase 2 删除——
// 控件全部表驱动渲染，测试遍历 CORE_MENU_ITEMS + 适配器真实注入项断言结构
// （preview-menu/items.test.ts，对齐 MikuMikuAR 声明式菜单测试范式）。

import * as THREE from "three";
import type { PreviewMenuNode } from "../../preview-3d/menu/node-types.ts";
import { shotButtonNodes } from "./shot-panel-shared.ts";
// 导出面收敛（knip）：CameraControlBridge/YsmModel/YsmContentHandle 消费方直连
// adapters 单源（content-bridges/camera-controls），此处不再原位转发
import type { YsmControlsContext } from "../../preview-3d/adapters/content-bridges.ts";
export type { YsmControlsContext };
import { registerSchema, unregisterSchema, makeYsmModelSchemaId, YSM_MODEL_SCHEMA_ID } from "../../preview-3d/adapters/schema-registry.ts";
import { buildYsmModelSchema } from "./skeleton-fill-panel.ts";

/**
 * [doc:adr-126-p4-b-2] YSM 截图面板——声明式节点版。
 * 共享逻辑在 shot-panel-shared.ts（shotButtonNodes），screenshot 为 ctx 可选字段
 * （undefined = 走 saveScreenshot fallback，面板常驻——与 MMD 能力缺失不注入不同）。
 * （fillYsmShotPanel 命令式旧轨已于 2026-09-03 随 G3 收口删除——生产装配零调用点）
 */
export function ysmShotNodes(ctx: YsmControlsContext): PreviewMenuNode[] {
  return shotButtonNodes(ctx.model, ctx.screenshot).map((n) => ({ ...n, id: `ysm-${n.id}` }));
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



