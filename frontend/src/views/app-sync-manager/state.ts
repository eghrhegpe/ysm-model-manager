// ===== app-sync-manager 共享状态（state） =====
// 职责：跨模块共享的持久化状态（上次选中类型）。
// 从 index.ts 下沉：打破 index → events → index 循环依赖
// （events 与 index 均从本模块导入，DAG 变为 index → events → state / index → state）
//
// ADR-095 后续（2026-08-18）：全局焦点统一——类型选择已全局化到 app-nav 下拉，
// 状态主键为 repo_rtype（app-nav 同源），ysm_syncLastType 仅为历史兼容键。
// 移除 sm-tabs 后 sync 页不再承担类型切换，仅跟随全局 repo:rtype-changed。
import { safeGet, safeSet } from "../../utils/dom/storage.ts";
import { RESOURCE_TYPES } from "../../utils/resource/types.ts";

// 历史兼容键（sm-tabs 时代的旧数据）
export const LAST_TYPE_KEY = "ysm_syncLastType";
// 全局类型焦点主键（app-nav 双下拉同源）
const GLOBAL_RTYPE_KEY = "repo_rtype";
// 优先读全局主键，兼容旧键，兜底 YSM
export let _lastSelectedType =
  safeGet(GLOBAL_RTYPE_KEY) || safeGet(LAST_TYPE_KEY) || RESOURCE_TYPES.YSM;
export function setLastSelectedType(type: string): void {
  _lastSelectedType = type;
  safeSet(GLOBAL_RTYPE_KEY, type); // 统一写全局（nav 下拉下次初始化读到一致值）
  safeSet(LAST_TYPE_KEY, type); // 旧键同步（防历史读取者）
}
