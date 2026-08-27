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
