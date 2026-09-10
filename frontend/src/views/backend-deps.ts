// ===== views 级后端依赖组合根（ADR-190 D2 注入真化 / ADR-208 D1 延伸至 views） =====
// 背景（2026-09-10 views 架构锐评 P1-1）：views 曾是直连 backend/app.ts 的法外之地
// （57 处 import 无 seam），而 features 已被 R5 门禁强制走 *-deps.ts 组合根。
// 本次将 R5 自 features 扩展至 views：本文件 = views 层唯一合法 import backend/app.ts 的出口。
// 测试不受影响：vi.mock("@/backend/app.ts") 的模块层拦截沿转发链依然生效
// （与 features/backend-deps.ts 先例一致，c5080749 / 088b1d36）。
// 注意：本文件自身是 R5 白名单成员（*-deps.ts 结尾），批量迁移脚本须显式排除本文件
// （2026-09-10 实测教训：全层 sed 会把本文件的 import/调用一并改写为自引用 + 无限递归）。

import { getApp } from "@/backend/app.ts";

/** 各模块统一经此取后端绑定（views 层唯一入口） */
export function backendGetApp(): ReturnType<typeof getApp> {
  return getApp();
}
