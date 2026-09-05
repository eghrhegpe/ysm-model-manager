// ===== core 全局 handler 注册（ADR-185 后 core-only）=====
// 右键菜单 / 整合包操作 / Android 平台事件已迁 features（context-menu、pack-ops、
// platform），由 app-content 编排注册；本文件只汇编 core 内核注册器。

import { registerPageStore } from "../page-store.ts";
import { registerSync } from "./sync.ts";

/** 注册 core 全局 handler，返回 unsub 函数数组（features 层注册由 app-content 编排） */
export function registerCoreHandlers(): Array<() => void> {
  const unsubs: Array<() => void> = [];
  registerPageStore(unsubs);
  registerSync(unsubs);
  return unsubs;
}
