// ===== CustomMorph 同类型候选列表（只扫 CustomMorph 目录的 VPD 文件）=====
// 直接用类型 ID 调 GetRepoRoot，后端返回 FilesRoot/mmd/CustomMorph，无需前端回溯拼接
// Go ScanModelEntriesFiltered 按 CustomMorph 注册表白名单过滤（ADR-044③ 对称范式），
// 前端不做扩展名二次判定。
import { getApp } from "../../backend/app.ts";

/** CustomMorph 目录下所有候选文件（含子目录）；失败返回 [] */
export async function resolveMorphSiblings(): Promise<string[]> {
  try {
    const App = await getApp();
    const morphRoot = await App.GetRepoRoot("CustomMorph");
    if (!morphRoot) return [];
    const raw = await App.ScanModelEntriesFiltered(morphRoot, "CustomMorph", "", "自定义表情");
    // code review P3：CustomMorph 白名单含 .zip（非 VPD 姿势）——VPD 应用流程
    // 只认 vpd——保留最小扩展名守卫，防列表出现不可应用的条目（失败应用）
    return (raw || []).map((e) => e.Path || "").filter((p) => /\.(vpd)$/i.test(p));
  } catch {
    return [];
  }
}
