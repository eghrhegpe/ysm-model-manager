// ===== 全局操作事件处理（类型化版 — ADR-014 P3 组件层）=====
// 统一入口，汇聚所有子 handler 模块
// app-content/index.js 调用此模块注册所有 handler

import { registerPageStore } from "./page-store.ts";
import { registerContextMenus } from "./context-menus.ts";
import { registerDnD } from "./handler-dnd.ts";
import { registerSync } from "./handler-sync.ts";
import { registerInstanceOps } from "./handler-other.ts";
import { registerResourceManagerGlobal } from "../views/app-resource-manager/index.ts";

/** 注册所有全局 handler，返回 unsub 函数数组 */
export function registerGlobalHandlers(): Array<() => void> {
  const unsubs: Array<() => void> = [];
  registerPageStore(unsubs);
  registerContextMenus(unsubs);
  registerDnD(unsubs);
  registerSync(unsubs);
  registerInstanceOps(unsubs);
  registerResourceManagerGlobal(unsubs);
  return unsubs;
}
