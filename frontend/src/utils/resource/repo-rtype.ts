// ===== 当前仓库资源类型·时刻读（utils 层叶子）=====
// 原生在 features/repo/repo-rtype.ts；backend/web-fs-auth（FSA 导入落库）也要读同一
// 权威源，为避免 backend → features 反向依赖（backend 是胶水层，只许向下），
// 把无事件的时刻值读取下沉至此，features/repo/repo-rtype.ts re-export 兼容下游。

import { safeGet } from "@/utils/dom/storage.ts";
import { RESOURCE_TYPES } from "./types.ts";

/**
 * 读取当前仓库资源类型（时刻值）。
 * 权威源 = localStorage `repo_rtype`（由 app-nav 写入），缺省 YSM。
 * 适用于"操作时读取当前类型"的一次性场景（下载落库、导入冲突检查等）；
 * 需要响应类型切换并重载的组件请用 useCurrentResourceType（features/repo/repo-rtype.ts）。
 */
export function currentRepoType(): string {
  return safeGet("repo_rtype") || RESOURCE_TYPES.YSM;
}
