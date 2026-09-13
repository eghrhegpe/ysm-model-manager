// ===== views 级后端依赖组合根（ADR-190 D2 注入真化 / ADR-208 D1 延伸至 views） =====
// 背景（2026-09-10 views 架构锐评 P1-1）：views 曾是直连 backend/app.ts 的法外之地
// （57 处 import 无 seam），而 features 已被 R5 门禁强制走 *-deps.ts 组合根。
// 本次将 R5 自 features 扩展至 views：本文件 = views 层唯一合法 import backend/app.ts 的出口。
// 测试不受影响：vi.mock("@/backend/app.ts") 的模块层拦截沿转发链依然生效
// （与 features/backend-deps.ts 先例一致，c5080749 / 088b1d36）。
// 注意：本文件自身是 R5 白名单成员（*-deps.ts 结尾），批量迁移脚本须显式排除本文件
// （2026-09-10 实测教训：全层 sed 会把本文件的 import/调用一并改写为自引用 + 无限递归）。

import { type AppBindings, getApp } from "@/backend/app.ts";

/** 各模块统一经此取后端绑定（views 层唯一入口） */
export function backendGetApp(): ReturnType<typeof getApp> {
  return getApp();
}

/** 重导出绑定类型：views 层类型引用也走组合根，闭合唯一 seam（避免直 import backend/app.ts 类型） */
export type { AppBindings };

// 【口径钉死 2026-09-13】本 seam 管辖的是 backend/app.ts 的**运行时函数调用**；
// `@/bindings/...`（generate:bindings 生成物）的 **import type 纯类型引用**不在此列，
// 全仓 views/features 直连约 20 处属**有意保留**：纯编译期、零运行时耦合、
// check-layering 与 check-binding-usage 均不约束。若日后要统一「类型也走组合根」，
// 须先立 ADR（新增 views/backend-types.ts re-export 层 + 全量迁移），勿当作违规随手改。
