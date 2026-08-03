// ===== 全局操作事件处理（类型化版 — ADR-014 P3 组件层）=====
// 统一入口，汇聚所有子 handler 模块
// app-content/index.js 调用此模块注册所有 handler

import { registerDnD } from "./handler-dnd.js";
import { registerSync } from "./handler-sync.js";
import { registerUpload } from "./handler-upload.js";
import { registerInstanceOps } from "./handler-other.js";

/** 注册所有全局 handler，返回 unsub 函数数组 */
export function registerGlobalHandlers(): Array<() => void> {
  const unsubs: Array<() => void> = [];
  registerDnD(unsubs);
  registerSync(unsubs);
  registerUpload(unsubs);
  registerInstanceOps(unsubs);
  return unsubs;
}
