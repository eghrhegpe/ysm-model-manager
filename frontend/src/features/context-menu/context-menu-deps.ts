// ===== context-menu 依赖组合根（ADR-190 D2 注入真化）=====
// HANDLERS/FILE_HANDLERS/DIR_HANDLERS 为 const 对象字面量表，逐条透传 Deps 不现实；
// 统一经本模块取 getApp。禁止业务代码绕过本模块直接 import backend/app。
// （code_review c5080749：set/reset 注入 seam 曾超前导出——全仓库无消费方，测试走
// vi.mock("@/backend/app.ts") 模块层拦截（context-menus.setup.ts），seam 是零测试的
// 模块级可变全局，按 knip 死导出纪律移除；待真实组合根/挂载注入落地再恢复。）

import { getApp } from "../../backend/app.ts";

/** 各 handler 表统一经此取后端绑定（本模块唯一出口） */
export function contextMenuGetApp(): ReturnType<typeof getApp> {
  return getApp();
}
