// ===== 能力门控（ADR-071 后收敛；ADR-123 P3 委托化）=====
// 判定逻辑已收拢至 backend/platform-web.ts 的 canBinding()（三态能力矩阵）。
// ADR-203 D3：从 utils/dom/capabilities.ts 迁至 backend/capabilities.ts，
// 消除 utils/dom → backend 反向依赖。消费方直接引 backend/capabilities。
// 消费方清单：context-menus.ts、app-tree/*、app-nav/index.ts、diagnostics/init.ts。
import { canBinding } from "./platform-web.ts";

/** 当前平台是否可用指定 binding（三态矩阵：desktop 全量 / web adapter has / Android 黑名单） */
export function can(binding: string): boolean {
  return canBinding(binding);
}

/**
 * 查看器/web 模式下右键菜单 action 的 binding 需求映射（2026-XX P2-3 收敛）：
 * 原 `context-menus.ts` 内嵌 `VIEWER_WEB_ACTION_BINDINGS` 表 + 手写 `can(binding)`
 * 调用收敛到本表 + canWebAction(action)，新增右键 web binding 只改这里。
 * 与 ADR-071 一致：仅声明「哪些 action 在 web 上可达」，不重复 `can()` 三态判定逻辑。
 */
export const VIEWER_WEB_ACTION_BINDINGS: Readonly<Record<string, string>> = {
  "file.rename": "RenameFile",
  "dir.rename": "RenameDir",
  "dir.batch-rename": "RenameDir",
  "file.edit-tags": "GetModelTags",
  // 移动/复制解锁（P0 翻案）：runBatchFileOp / file.move / file.copy 均走
  // MoveModelFile/CopyModelFile binding（web-fs webFsBindings 已实现组级 rekey）
  "file.move": "MoveModelFile",
  "file.copy": "CopyModelFile",
  "batch.move": "MoveModelFile",
  "batch.copy": "CopyModelFile",
};

/**
 * 纯前端右键动作集：不调 Wails binding（DOM/剪贴板/下载
 * 已下沉 utils/dom），viewer 模式恒可达。原 `context-menus.ts` 硬编码
 * `VIEWER_OK_ACTIONS` 收敛至此，成为「viewer 可达性」单一事实源的一部分。
 * noop 假动作已退役（menu-defs kind 判别后标题项不占 action 空间，不再入集）。
 */
export const VIEWER_PURE_ACTIONS: ReadonlySet<string> = new Set([
  "batch.copy-paths",
  "batch.export-list",
  "file.copy-path",
]);

/** 查看器/web 模式下该 action 是否在当前平台可达：纯前端恒可达 + binding 走 can() 探测 */
export function canWebAction(action: string): boolean {
  if (VIEWER_PURE_ACTIONS.has(action)) return true;
  const b = VIEWER_WEB_ACTION_BINDINGS[action];
  return b !== undefined && can(b);
}
