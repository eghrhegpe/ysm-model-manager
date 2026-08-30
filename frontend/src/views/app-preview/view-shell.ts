// ===== 3D 预览视图壳层公共注入（单一事实源）=====
// 从 fbx-3d / ysm-3d / vrm-3d / maid-3d 抽出的公共视图壳函数：
//   - readFileBytes：Wails ReadFileBytes 注入（视图壳层保留 getApp；适配器 0 backend
//     import，ADR-072 边界判据）——4 处逐字重复（fbx/ysm/vrm/maid）收敛于此。
//   - addOpLog：环形日志面板诊断注入（ADR-112 复用 MMD 同款 AddOpLog；失败静默不阻断）。
// 消除跨视图 jscpd 重复；视图壳仍在 views/ 层，适配器（features/preview-3d/adapters）不 import 本模块。
// 2026-09 类型化改造：Wails 绑定方法直调（getApp() 返回类型化 AppBindings，见
// backend/types.ts），删除 `as unknown as Record<string,...>` 手写签名断言——
// Go 绑定签名变更时编译期报错而非运行时穿透。

import { getApp } from "../../backend/app.ts";

/** 数据读取注入（Wails ReadFileBytes；返回 null = 读取失败） */
export async function readFileBytes(path: string): Promise<string | null> {
  const App = await getApp();
  return await App.ReadFileBytes(path);
}

/** 环形日志面板诊断（AddOpLog 注入；失败静默不阻断加载）。scope = 运行时环打标（如 "fbx-preview"） */
export async function addOpLog(scope: string, op: string, msg: string, status: "ok" | "fail" | "warn", err?: string): Promise<void> {
  try {
    const App = await getApp();
    await App.AddOpLog(scope, op, msg, "", 0, status, err || "");
  } catch {
    /* 诊断不阻断 */
  }
}
