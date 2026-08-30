// ===== 能力门控（ADR-071 后收敛；ADR-123 P3 委托化）=====
// 判定逻辑已收拢至 backend/platform-web.ts 的 canBinding()（三态能力矩阵），
// 本文件保留 can() 对外 API 与消费方清单注释——utils/dom 侧 21 处消费点零改动。
// 消费方清单（新增消费方前核对语义为「该 binding 当前平台是否可用」，勿误作查看器
// 模式判定）：app-nav/index.ts:83（ListVersionInstances）、app-tree/bus-handlers.ts、
// app-tree/events.ts、app-tree/index.ts（如 OpenFileDialog 等）。
import { canBinding } from "../../backend/platform-web.ts";

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

/** 查看器/web 模式下该 action 是否在当前平台可达（白名单 + can() 探测） */
export function canWebAction(action: string): boolean {
  const b = VIEWER_WEB_ACTION_BINDINGS[action];
  return b !== undefined && can(b);
}
