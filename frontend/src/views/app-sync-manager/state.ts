// ===== app-sync-manager 共享状态（state） =====
// 职责：跨模块共享的持久化状态（上次选中类型）。
// 从 index.ts 下沉：打破 index → events → index 循环依赖
// （events 与 index 均从本模块导入，DAG 变为 index → events → state / index → state）
//
// ADR-095 后续（2026-08-18）：全局焦点统一——类型选择已全局化到 app-nav 下拉，
// 状态主键为 repo_rtype（app-nav 同源），ysm_syncLastType 仅为历史兼容键。
// 移除 sm-tabs 后 sync 页不再承担类型切换，仅跟随全局 repo:rtype-changed。
import { safeGet, safeSet } from "@/utils/base/primitives/storage.ts";
import { RESOURCE_TYPES } from "@/utils/resource/types.ts";

// 历史兼容键（sm-tabs 时代的旧数据）
export const LAST_TYPE_KEY = "ysm_syncLastType";
// 全局类型焦点主键（app-nav 双下拉同源）
const GLOBAL_RTYPE_KEY = "repo_rtype";

/**
 * 上次选中类型读取器。**权威源 = localStorage 的 `repo_rtype`，每次实读**。
 *
 * 2026-10 修复（锐评：缓存盖过权威源）：原实现用模块级缓存（import 时读一次），而
 * `repo_rtype` 的写入方是 app-nav 切换器（`app-nav/index.ts` 直接 `safeSet`，不经本模块）
 * ——「面板未挂载期间用户在仓库页切类型」后缓存陈旧，再挂载时旧值还会**盖过新鲜的
 * `default-type` 属性**（`_selectedType = getLastSelectedType() || _defaultType`），
 * 面板按错类型拉数据直到用户再动一次下拉。读多写少，实读成本可忽略。
 */
export function getLastSelectedType(): string {
  return safeGet(GLOBAL_RTYPE_KEY) || safeGet(LAST_TYPE_KEY) || RESOURCE_TYPES.YSM;
}

export function setLastSelectedType(type: string): void {
  safeSet(GLOBAL_RTYPE_KEY, type); // 统一写全局（nav 下拉下次初始化读到一致值）
  safeSet(LAST_TYPE_KEY, type); // 旧键同步（防历史读取者）
}
