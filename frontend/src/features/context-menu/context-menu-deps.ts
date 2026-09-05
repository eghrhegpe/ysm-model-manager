// ===== context-menu 依赖组合根（ADR-190 D2 注入真化）=====
// HANDLERS/FILE_HANDLERS/DIR_HANDLERS 为 const 对象字面量表，逐条透传 Deps 不现实；
// 统一经本模块取 getApp：默认生产实现，挂载入口或测试可显式 setContextMenuDeps 覆盖。
// 禁止业务代码绕过本模块直接 import backend/app（lint 由 review 抽查兜底）。

import { getApp } from "../../backend/app.ts";

export type GetAppFn = typeof getApp;

let getAppFn: GetAppFn = getApp;

/** 显式注入（组合根/测试用）；传空或不传字段则保留当前值 */
export function setContextMenuDeps(deps?: { getApp?: GetAppFn }): void {
  if (deps?.getApp) getAppFn = deps.getApp;
}

/** 重置回生产实现（测试 afterEach 用） */
export function resetContextMenuDeps(): void {
  getAppFn = getApp;
}

/** 各 handler 表统一经此取后端绑定 */
export function contextMenuGetApp(): ReturnType<GetAppFn> {
  return getAppFn();
}
