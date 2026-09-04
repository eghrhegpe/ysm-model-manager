// ===== 资源类型短标签（消除 app-nav / sync-manager 双份重复映射）=====
// 短标签用于紧凑展示（logo、当前类型指示）：YSM/MMD 用英文短名，
// 其余走 i18n rtype.* key（资源包/光影包/蓝图/投影，含 en/ja 翻译）。
// 与 RESOURCE_TYPE_LABELS（全名，硬编码中文）互补——短标签优先，
// 未命中回退全名（兜底覆盖 maid-model 等新类型，无需改本文件）。

import { t } from "../../core/i18n/t.ts";
import { RESOURCE_TYPE_LABELS, RESOURCE_TYPES } from "./types.ts";

/** 资源类型短标签映射（仅需 i18n 化的 4 类；YSM/MMD 为通用英文缩写） */
const SHORT_LABEL_MAP: Record<string, string> = {
  [RESOURCE_TYPES.YSM]: "YSM",
  [RESOURCE_TYPES.MMD]: "MMD",
  // ADR-111：VRM 已合并进 EntityPlayer 的 variants，短标签用字面量 "vrm"
  vrm: "VRM",
  [RESOURCE_TYPES.PACK]: t("rtype.pack"),
  [RESOURCE_TYPES.SHADER]: t("rtype.shader"),
  [RESOURCE_TYPES.BLUEPRINT]: t("rtype.blueprint"),
  [RESOURCE_TYPES.LITEMATIC]: t("rtype.litematic"),
  [RESOURCE_TYPES.MAID]: t("rtype.maid"),
};

/** 资源类型短标签：map 命中 → 短名；否则全名（RESOURCE_TYPE_LABELS）→ 原始 id（兜底） */
export function shortLabelOf(rtype: string): string {
  return SHORT_LABEL_MAP[rtype] || RESOURCE_TYPE_LABELS[rtype] || rtype || RESOURCE_TYPES.YSM;
}
