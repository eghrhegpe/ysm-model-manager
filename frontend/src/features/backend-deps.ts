// ===== features 级后端依赖组合根（ADR-190 D2 注入真化）=====
// 供未迁入目录级组合根（context-menu-deps / community-deps）的零散模块使用：
// maintenance / dnd / import / sync / pack-ops / require-mcroot。
// 禁止业务代码绕过本模块直接 import backend/app。
// （code_review 088b1d36：set/reset seam 曾复制 context-menu-deps 已删模式——
// 全仓库零消费方，测试走 vi.mock("@/backend/app.ts") 模块层拦截；按同目录
// context-menu-deps.ts 记载的先例（c5080749）删除零测试的模块级可变全局，
// 保留纯转发单出口；待真实组合根/挂载注入落地再恢复。）

import { getApp } from "../backend/app.ts";

/** 各模块统一经此取后端绑定（本模块唯一出口） */
export function backendGetApp(): ReturnType<typeof getApp> {
  return getApp();
}
