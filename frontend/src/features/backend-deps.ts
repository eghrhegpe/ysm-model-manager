// ===== features 级后端依赖组合根（ADR-190 D2 注入真化）=====
// 供未迁入目录级组合根（context-menu-deps / community-deps）的零散模块使用：
// maintenance / dnd / import / sync / pack-ops / require-mcroot。
// 默认生产实现，测试可 setBackendDeps 显式覆盖；新模块优先用目录级组合根或函数级 Deps。

import { getApp } from "../backend/app.ts";

export type GetAppFn = typeof getApp;

let getAppFn: GetAppFn = getApp;

/** 显式注入（组合根/测试用）；传空或不传字段则保留当前值 */
export function setBackendDeps(deps?: { getApp?: GetAppFn }): void {
  if (deps?.getApp) getAppFn = deps.getApp;
}

/** 重置回生产实现（测试 afterEach 用） */
export function resetBackendDeps(): void {
  getAppFn = getApp;
}

/** 各模块统一经此取后端绑定 */
export function backendGetApp(): ReturnType<GetAppFn> {
  return getAppFn();
}
