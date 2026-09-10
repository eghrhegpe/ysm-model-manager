// ===== dialogs 依赖组合根（ADR-190 D2 注入真化）=====
// 原经 features/backend-deps.ts 共享出口（12 消费者跨 6 目录），按目录级组合根收敛
// （ADR-208 D1）：adv-filter / rename / tag-editor 等生产默认 getApp 一律走本模块。
// 禁止业务代码绕过本模块直接 import backend/app。

import { getApp } from "@/backend/app.ts";

/** dialogs 各模块统一经此取后端绑定（本模块唯一出口） */
export function dialogsGetApp(): ReturnType<typeof getApp> {
  return getApp();
}
