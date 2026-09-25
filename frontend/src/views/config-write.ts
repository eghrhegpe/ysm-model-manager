// ===== views 级应用配置写组合根（ADR-313）=====
// 背景（2026-10 锐评第九轮）：`SaveAppConfig` 是六个**同型 string** 的位置实参
// （filesRoot / rpRoot / mcRoot / linkMode / theme / themeAuto），位置错了类型系统看不见。
// 设置页第八轮把全页收敛到 path-cards.ts|saveCfg 单点后，views 层仍有三处实参点：
// settings/path-cards.ts、app-sidebar/launcher-detect.ts、app-sidebar/events.ts——
// 后两处手抄配方还各自硬编码 `"dark"` 与 `"copy"` 字面量，而 THEME_VALID 里根本没有
// "dark"（合法缺省是 theme-core.THEME_DARK = "cyber"），落盘后 initTheme 的
// normalizeTheme 会把它静默归一成 "system"——用户只改过游戏目录，主题却被改成跟随系统。
//
// 本文件与 backend-deps.ts 同列：views 层的**组合根**（R5 白名单只认 `*-deps.ts`，
// 故本文件不得 import backend/app.ts，只能经 backend-deps 转发）。层位选 views 根
// 而非 features：saveCfg 的语义需要「配置字段值域」这组零依赖纯数据叶
// （settings-schema.ts 的 LINK_MODE_DEFAULT），而 features 不得反向 import views——
// 若出口下沉 features 就得把值域再抄一份，正是本轮要消灭的漂移源。
//
// 与 path-cards.ts|saveCfg 的关系：本文件是**唯一实参点**，saveCfg 降级为薄包装
// （补 settings 域的模块级 cfg 内存同步）。app-sidebar 两处直接调本模块，不再手抄配方。
//
// 分层：views/config-write.ts → { backend-deps, settings-schema, utils/storage, theme-core }
// 全为向下依赖或同层数据叶，不拉起任何 settings 页面模块（app-sidebar 分块不受污染）。

import { THEME_DARK } from "@/theme-core";
import { safeGet } from "@/utils/base/primitives/storage.ts";
import { LINK_MODE_DEFAULT } from "@/views/app-content/settings/settings-schema.ts";
import { backendGetApp } from "@/views/backend-deps.ts";

/**
 * 应用配置补丁：只列出希望覆盖的字段，未列字段取**重读**的当前落盘值。
 *
 * 为什么是「重读」而非调用方快照：原手抄配方的调用方普遍先 `LoadAppConfig()` 拿快照，
 * 再拿快照回写未改字段——用户在其他入口（如设置页 / 另一张卡片）改过字段后，
 * 二次保存会把新值静默覆盖回旧快照（设置页第八轮 P1 修过同款病）。
 */
export interface AppConfigPatch {
  filesRoot?: string;
  rpRoot?: string;
  mcRoot?: string;
  linkMode?: string;
  /** 缺省取 localStorage 当前值（各写入方均先 safeSet 再保存，语义与显式传入等价） */
  theme?: string;
  themeAuto?: string;
}

/**
 * 写应用配置的唯一实参点：`SaveAppConfig(filesRoot, rpRoot, mcRoot, linkMode, theme, themeAuto)`。
 *
 * 语义（与 Go 端 `orDefault` / `SanitizeLinkMode` 对齐）：
 * - 未 patch 的字段取**重读**的最新落盘值，重读失败退化为上次读到的值；
 * - 空串是「未传该参」的合法表示，Go 端 orDefault 会保留旧值；
 * - theme/themeAuto 缺省取 localStorage（非法值由主题层 normalizeTheme 兜底）；
 * - **不**在本函数内更新任何模块级内存快照——内存一致性归调用方（settings 域的
 *   saveCfg 包装负责同步 getCfg()），本模块保持无状态、可供任意 view 复用。
 *
 * @param patch 需要覆盖的字段（其余取重读值）
 * @returns 实际写入的完整六元组（便于调用方同步自身内存快照 / 断言）
 */
export async function writeAppConfig(patch: AppConfigPatch): Promise<{
  filesRoot: string;
  rpRoot: string;
  mcRoot: string;
  linkMode: string;
  theme: string;
  themeAuto: string;
}> {
  const { LoadAppConfig, SaveAppConfig } = await backendGetApp();
  // Partial：重读失败时保持空对象（走下方的空串兜底，绝不带着半份配置去写盘）
  let latest: Partial<Awaited<ReturnType<typeof LoadAppConfig>>> = {};
  try {
    latest = await LoadAppConfig();
  } catch {
    /* 重读失败退化为空对象（各字段回落到空串 → Go 端 orDefault 保留旧值，尽力而为） */
  }
  // theme/themeAuto 缺省自 localStorage：与设置页第八轮 saveCfg 同口径
  // （各调用方均先 safeSet("theme", …) 再保存；theme-auto 无值即 off 语义）
  const theme = patch.theme !== undefined ? patch.theme : safeGet("theme") || THEME_DARK;
  const themeAuto = patch.themeAuto !== undefined ? patch.themeAuto : safeGet("theme-auto") || "";
  const resolved = {
    filesRoot: patch.filesRoot !== undefined ? patch.filesRoot : latest.filesRoot || "",
    rpRoot: patch.rpRoot !== undefined ? patch.rpRoot : latest.resourcepackRoot || "",
    mcRoot: patch.mcRoot !== undefined ? patch.mcRoot : latest.mcRoot || "",
    linkMode: patch.linkMode !== undefined ? patch.linkMode : latest.linkMode || LINK_MODE_DEFAULT,
    theme,
    themeAuto,
  };
  await SaveAppConfig(
    resolved.filesRoot,
    resolved.rpRoot,
    resolved.mcRoot,
    resolved.linkMode,
    resolved.theme,
    resolved.themeAuto,
  );
  return resolved;
}
