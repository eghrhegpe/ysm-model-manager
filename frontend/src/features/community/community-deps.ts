// ===== community 依赖组合根（ADR-190 D2 注入真化）=====
// download-queue-store 为单例状态模块，函数级透传 Deps 会把 getApp 推给全部调用方；
// 统一经本模块取 getApp：默认生产实现，测试可 setCommunityDeps 显式覆盖。

import { getApp } from "../../backend/app.ts";

export type GetAppFn = typeof getApp;

let getAppFn: GetAppFn = getApp;

/** 显式注入（组合根/测试用）；传空或不传字段则保留当前值 */
export function setCommunityDeps(deps?: { getApp?: GetAppFn }): void {
  if (deps?.getApp) getAppFn = deps.getApp;
}

/** 重置回生产实现（测试 afterEach 用） */
export function resetCommunityDeps(): void {
  getAppFn = getApp;
}

/** community 各模块统一经此取后端绑定 */
export function communityGetApp(): ReturnType<GetAppFn> {
  return getAppFn();
}
