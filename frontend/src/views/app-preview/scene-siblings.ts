// ===== 场景 MMD 同类型候选列表（只扫 SceneModel 目录）=====
// 直接用类型 ID 调 GetRepoRoot，后端返回 FilesRoot/mmd/SceneModel，无需前端回溯拼接
// Go ScanModelEntriesFiltered 按 SceneModel 注册表白名单过滤（ADR-044③ 对称范式），
// 前端不做扩展名二次判定。
import { getApp } from "../../backend/app.ts";

/** 场景模型候选（只扫 SceneModel 子目录）；失败返回 [] */
export async function resolveSceneSiblings(): Promise<string[]> {
  try {
    const App = await getApp();
    const sceneRoot = await App.GetRepoRoot("SceneModel");
    if (!sceneRoot) return [];
    const raw = await App.ScanModelEntriesFiltered(sceneRoot, "SceneModel", "", "场景模型");
    // code review P3：Go 白名单含 .vrm/.zip（SceneModel 扩展集），但 createScene3D
    // 是 pmx/pmd 查看器——保留最小扩展名守卫，防列表出现加载不了的条目（破碎预览）
    return (raw || []).map((e) => e.Path || "").filter((p) => /\.(pmx|pmd)$/i.test(p));
  } catch {
    return [];
  }
}
