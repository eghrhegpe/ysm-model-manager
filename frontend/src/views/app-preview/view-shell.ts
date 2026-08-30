// ===== 3D 预览视图壳层公共注入（单一事实源）=====
// 从 fbx-3d / ysm-3d / vrm-3d / maid-3d 抽出的公共视图壳函数：
//   - readFileBytes：Wails ReadFileBytes 注入（视图壳层保留 getApp；适配器 0 backend
//     import，ADR-072 边界判据）——4 处逐字重复（fbx/ysm/vrm/maid）收敛于此。
//   - addOpLog：环形日志面板诊断注入（ADR-112 复用 MMD 同款 AddOpLog；失败静默不阻断）。
// 消除跨视图 jscpd 重复；视图壳仍在 views/ 层，适配器（utils/3d/adapters）不 import 本模块。

import { getApp } from "../../backend/app.ts";

/** 数据读取注入（Wails ReadFileBytes；返回 null = 读取失败） */
export async function readFileBytes(path: string): Promise<string | null> {
  const App = await getApp();
  return (App as unknown as Record<string, (p: string) => Promise<string | null>>)["ReadFileBytes"](path);
}

/** 环形日志面板诊断（AddOpLog 注入；失败静默不阻断加载）。scope = 运行时环打标（如 "fbx-preview"） */
export async function addOpLog(scope: string, op: string, msg: string, status: "ok" | "fail" | "warn", err?: string): Promise<void> {
  try {
    const App = await getApp();
    const fn = (App as unknown as Record<string, (a: string, b: string, c: string, d: string, e: number, f: string, g: string) => Promise<unknown>>)["AddOpLog"];
    if (typeof fn !== "function") return;
    await fn(scope, op, msg, "", 0, status, err || "");
  } catch {
    /* 诊断不阻断 */
  }
}
