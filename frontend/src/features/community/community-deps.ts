// ===== community 依赖组合根（ADR-190 D2 注入真化）=====
// download-queue-store 为单例状态模块，函数级透传 Deps 会把 getApp 推给全部调用方；
// 统一经本模块取 getApp。禁止业务代码绕过本模块直接 import backend/app。
// （code_review fdb92713：set/reset seam 曾复制 context-menu-deps 已删模式——
// 全仓库零消费方，events.integration/show-repo-models 测试走 vi.mock 模块层拦截；
// 按 context-menu-deps.ts 记载的先例（c5080749）删除零测试的模块级可变全局，
// 保留纯转发单出口；待真实组合根/挂载注入落地再恢复。）

import { getApp } from "../../backend/app.ts";

/** community 各模块统一经此取后端绑定（本模块唯一出口） */
export function communityGetApp(): ReturnType<typeof getApp> {
  return getApp();
}
