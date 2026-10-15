// ===== 资源类型短标签（消除 app-nav / sync-manager 双份重复映射）=====
// 短标签用于紧凑展示（logo、当前类型指示）：YSM/MMD 用英文短名，
// 其余走 i18n rtype.* key（资源包/光影包/蓝图/投影，含 en/ja 翻译）。
// ⚠️ 短名表是**刻意的另一维度**（紧凑形态，与 `rtypeLabelOf` 全名体系不同规，勿硬并）；
// 但**回落段必须走 `rtypeLabelOf`**（2026-10-15 拍板「类型文案权威源 = locale」）：
// 原直取 `RESOURCE_TYPE_LABELS`（中文全名）会让 8 个无短名类型（SceneModel/CustomAnim/
// CustomMorph/StageAnim/DefaultAnim/DefaultMorph/mmd-shader/fbx）在 en/ja 的 logo、侧栏
// 兜底项、同步管理当前类型指示、右键菜单里落中文——本函数是这些位置的上屏出口。

import { getLang } from "@/core/i18n/locale.ts";
import { t } from "@/core/i18n/t.ts";
import { RESOURCE_TYPES, rtypeLabelOf } from "./types.ts";

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

/** 测试钩子：重置缓存（验证语言切换后缓存失效）；业务代码不应调用 */
export function __resetShortLabelCacheForTest(): void {
  cachedLang = undefined;
  cachedMap = undefined;
}

/** 资源类型短标签：map 命中 → 短名；否则走 `rtypeLabelOf` 出口（locale 全名 → 注册表名 → 原始 id） */
export function shortLabelOf(rtype: string): string {
  const lang = getLang();
  if (cachedLang !== lang || !cachedMap) {
    cachedLang = lang;
    cachedMap = buildShortLabelMap();
  }
  return cachedMap[rtype] || rtypeLabelOf(rtype) || RESOURCE_TYPES.YSM;
}
