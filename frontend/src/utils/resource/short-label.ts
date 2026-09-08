// ===== 资源类型短标签（消除 app-nav / sync-manager 双份重复映射）=====
// 短标签用于紧凑展示（logo、当前类型指示）：YSM/MMD 用英文短名，
// 其余走 i18n rtype.* key（资源包/光影包/蓝图/投影，含 en/ja 翻译）。
// 与 RESOURCE_TYPE_LABELS（全名，硬编码中文）互补——短标签优先，
// 未命中回退全名（兜底覆盖 maid-model 等新类型，无需改本文件）。

import { getLang } from "@/core/i18n/locale.ts";
import { t } from "@/core/i18n/t.ts";
import { RESOURCE_TYPE_LABELS, RESOURCE_TYPES } from "./types.ts";

/**
 * 构建资源类型短标签映射（调用期求值——t() 在每次 shortLabelOf 调用时执行，
 * 运行时切语言后返回新语言标签，不烘焙进模块加载期常量表）。
 */
function buildShortLabelMap(): Record<string, string> {
  return {
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
}

/** 模块级缓存：语言未变时直接返回 cachedMap，避免每次调用重建映射 */
let cachedLang: string | undefined;
let cachedMap: Record<string, string> | undefined;

/** 重置缓存（仅测试用，验证语言切换后缓存失效） */
export function _resetShortLabelCache(): void {
  cachedLang = undefined;
  cachedMap = undefined;
}

/** 资源类型短标签：map 命中 → 短名；否则全名（RESOURCE_TYPE_LABELS）→ 原始 id（兜底） */
export function shortLabelOf(rtype: string): string {
  const lang = getLang();
  if (cachedLang !== lang || !cachedMap) {
    cachedLang = lang;
    cachedMap = buildShortLabelMap();
  }
  return cachedMap[rtype] || RESOURCE_TYPE_LABELS[rtype] || rtype || RESOURCE_TYPES.YSM;
}
