// ===== 全局操作事件处理（类型化版 — ADR-014 P3 组件层）=====
// 统一入口，汇聚所有子 handler 模块
// app-content/index.js 调用此模块注册所有 handler

import { registerPageStore } from "../page-store.ts";
import { registerContextMenus } from "../context-menus.ts";
import { registerSync } from "./sync.ts";
import { registerInstanceOps } from "./instance-ops.ts";
import { registerAndroidEvents } from "./android-events.ts";

/** 注册所有 core 全局 handler，返回 unsub 函数数组（features/views 层注册由 app-content 编排） */
export function registerGlobalHandlers(): Array<() => void> {
  const unsubs: Array<() => void> = [];
  registerPageStore(unsubs);
  registerContextMenus(unsubs);
  registerSync(unsubs);
  registerInstanceOps(unsubs);
  registerAndroidEvents(unsubs);
  return unsubs;
}
