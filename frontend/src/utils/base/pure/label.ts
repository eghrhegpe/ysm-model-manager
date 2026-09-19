// utils/base/pure/label.ts — 标签取值决策（全仓唯一回退标准）。
//
// 背景：菜单/控件两套渲染栈各有一份「label 到底取哪个字段」的读数——render.ts 的 rmLabel 与
// cap-controls.ts 的 capLabel。同一契约两种读法，是 2026-09「表情面板整列无文字」的病根：
// 节点契约规定 labelKey 缺失时用 label 明文（menu-node-types.ts「label 只装动态数据明文」），
// cap 栈却只读 labelKey → tOf("") 三级回退全 miss → 原样返回空串，明文从未上屏。
//
// 本模块把该决策收敛为唯一纯函数。翻译器由调用方注入（不 import i18n），守 utils/base/pure
// 「真纯函数、零副作用、零上层依赖」纯度——core 准入三条之③（无 Wails 也能单测）同款约束。

/** 标签来源字段（PreviewMenuNode / CapControlView 的结构子集） */
export interface LabelSource {
  /** i18n 键（优先；空串视为未提供——空串进 tOf 会原样回退成空字符串） */
  labelKey?: string | undefined;
  /** 明文标签（动态数据名：表情名 / 材质名 / 角色名等，不经 i18n） */
  plain?: string | undefined;
}

/**
 * 统一标签取值决策（唯一回退标准，三级顺序固定）：
 *   ① `labelKey` 非空 → `translate(labelKey)`——i18n 三级回退（当前包 → 兜底包 → 裸 key）
 *      由注入的 translate 自身承担；
 *   ② 无 labelKey 且传入 `valueOverride` → `String(valueOverride)`——field 行「显示值优先」语义；
 *   ③ 其余 → `plain` 明文（缺省空串）。
 *
 * ⚠️ ②③ 顺序不可换：rmLabel 的既有消费者（field 行）依赖「显示值压过 label 明文」。
 *
 * @param src 标签来源（labelKey / plain）
 * @param translate i18n 翻译器（调用方注入 tOf；本层零依赖，便于 node 环境裸测）
 * @param valueOverride 可选显示值覆盖（仅在无 labelKey 时生效）
 * @returns 最终显示文本
 */
export function resolveLabel(
  src: LabelSource,
  translate: (key: string) => string,
  valueOverride?: unknown,
): string {
  if (src.labelKey) return translate(src.labelKey);
  if (valueOverride !== undefined) return String(valueOverride);
  return src.plain ?? "";
}
