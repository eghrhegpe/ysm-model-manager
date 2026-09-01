// ===== schema-registry.ts — 3D 预览面板受控 builder 注册（[doc:adr-126-p5-a] 根治渲染逃生舱）=====
//
// 背景：ADR-125 诊断「三套并存」（A 声明式 Schema / B cap 控件 / C 逃生舱），P4-B 把 C 层
// 收敛为「静态内容 → children 声明式」，但 `renderCustom` 逃生舱仍在——新增面板可以绕过
// 数组系统直接拼 DOM，单一事实来源有后门。本注册表把「新增面板」收敛为唯一受控入口：
//
//   registerSchema(id, (snapshot) => PreviewMenuNode[])
//
// - builder 吃状态层快照（PreviewSnapshot，与 P4-D 的 visibleWhen 同构）——面板内容随状态响应
// - renderPreviewPanel 优先查 registry：有注册 → builder 产出节点走 renderMenu；无注册 → 次选
//   node.children（内联声明式）；最后才是 renderCustom 逃生舱（真·无法数据化的内容）
// - 新增面板 = 注册一行 + 产出声明式节点，不再允许「直接拼 DOM 的 renderCustom 捷径」
//
// 与 ADR-085 S1「注册表驱动」同语言：新增项只改注册表，不散改代码。

import type { PreviewMenuNode } from "../menu/node-types.ts";
import type { PreviewSnapshot } from "../state/preview-state.ts";

/** YSM model 面板 schema 键（adapter schemaId 与 views 注册共用同一常量，防漂移静默丢面板） */
export const YSM_MODEL_SCHEMA_ID = "ysm-model";

/**
 * per-scene 唯一 schema 键工厂（YSM/maid 同框隔离，对齐 litematic `litematic-slice-{n}` 范式）。
 * 固定全局键 `ysm-model` 被第二场景 build 静默覆盖（Bug A 根因）：先后加载两个 YSM（或 YSM +
 * maid）时，第一个模型的 builder 闭包被第二个 build 覆盖，旧面板 select/纹理/统计全串数据。
 * 传 sessionId 后注册到 `ysm-model-{sessionId}`，dispose 精准注销自己的 key，互不误伤。
 * 兼容：无 sessionId（旧调用/测试）时调用方退化用 YSM_MODEL_SCHEMA_ID（本工厂不接受 undefined）。
 */
export function makeYsmModelSchemaId(sessionId: string): string {
  return `${YSM_MODEL_SCHEMA_ID}-${sessionId}`;
}

/** 面板 builder：吃状态层快照（Partial——builder 只读自己关心的键，键存在性仍编译期守卫），产出声明式节点（纯数据，零 DOM） */
export type SchemaBuilder = (snapshot: Partial<PreviewSnapshot>) => PreviewMenuNode[];

/** 注册表（模块级单例；与 sceneCapabilityRegistry 同范式） */
const registry = new Map<string, SchemaBuilder>();

/** 注册面板 builder；重复注册**覆盖**旧 builder（多模型同框时活跃模型换菜单，后注册者生效）——
 * 与 setAdapterItems 换菜单语义一致；测试用 registerSchema 注册后需 resetSchemas 隔离 */
export function registerSchema(id: string, builder: SchemaBuilder): void {
  registry.set(id, builder);
}

/** 注销面板 builder（预览 dispose 时调用，防跨会话污染：陈旧 builder 的闭包
 *  持有已 dispose 场景的 model/texArr/handle，不清理会泄漏 WebGL 纹理集） */
export function unregisterSchema(id: string): void {
  registry.delete(id);
}

/** 取面板 builder；未注册返回 undefined */
export function getSchema(id: string): SchemaBuilder | undefined {
  return registry.get(id);
}

/** 是否已注册 */
export function hasSchema(id: string): boolean {
  return registry.has(id);
}

/** 全部已注册 id（供契约测试枚举 / 审计「谁在绕道 renderCustom」） */
export function listSchemas(): string[] {
  return [...registry.keys()];
}

/** 测试用：清空注册表（用例间隔离） */
export function resetSchemas(): void {
  registry.clear();
}
