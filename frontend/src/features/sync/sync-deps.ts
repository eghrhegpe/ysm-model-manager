// ===== sync 依赖组合根（ADR-190 D2 注入真化）=====
// 原经 features/backend-deps.ts 共享出口，sync 建目录后独立收口。
// registerSync 消费的后端绑定（ListVersionInstances / InstallModelTo / SyncModelToggleStatus
// / AddImportLog / InvalidateScanCache 等）一律走本模块。
// 禁止业务代码绕过本模块直接 import backend/app。

import { getApp } from "@/backend/app.ts";

/** sync 各模块统一经此取后端绑定（本模块唯一出口） */
export function syncGetApp(): ReturnType<typeof getApp> {
  return getApp();
}
