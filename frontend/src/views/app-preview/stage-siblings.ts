// ===== StageAnim 舞台包资源扫描（只扫 StageAnim 目录的 VMD + 音频文件）=====
// 直接用类型 ID 调 GetRepoRoot，后端返回 FilesRoot/mmd/StageAnim，无需前端回溯拼接
// StageAnim 目录结构：
//   StageAnim/<舞台包>/
//     ├── *.vmd      角色动画 / 相机轨道
//     ├── *.mp3      背景音乐
//     ├── *.ogg      （可选）
//     ├── *.wav      （可选）
//     └── stage_config.json
import { getApp } from "../../backend/app.ts";

/** 扫描 StageAnim 目录下所有资源文件（VMD + 音频 + config）；失败返回 [] */
export async function resolveStageSiblings(): Promise<Array<{
  path: string;
  kind: "vmd" | "audio" | "config" | "other";
}>> {
  try {
    const App = await getApp();
    const stageRoot = await App.GetRepoRoot("StageAnim");
    if (!stageRoot) return [];
    const raw = await App.ScanModelEntriesFiltered(stageRoot, "StageAnim", "", "舞台动画");
    const results: Array<{ path: string; kind: "vmd" | "audio" | "config" | "other" }> = [];
    for (const e of raw || []) {
      const p = e.Path || "";
      if (!p) continue;
      const ext = (p.split(/[/\\]/).pop() || "").toLowerCase();
      if (ext.endsWith(".vmd")) results.push({ path: p, kind: "vmd" });
      else if (/\.(mp3|ogg|wav)$/i.test(p)) results.push({ path: p, kind: "audio" });
      else if (ext === "stage_config.json") results.push({ path: p, kind: "config" });
    }
    return results;
  } catch {
    return [];
  }
}
