// ===== MMD 动作库路径解析（ADR-094 位置路由复用）=====
// 各 MMD 类型（EntityPlayer/SceneModel/CustomAnim 等）现为独立顶级类型，
// 直接调用 GetRepoRoot("CustomAnim") 获取路径，无需前端回溯拼接。

/** VMD/VPD 扩展名（MMD 生态动作格式） */
const ANIM_EXTS = [".vmd", ".vpd"];

/**
 * 获取 MMD 动作库（CustomAnim）的绝对路径。
 * 直接用类型 ID 调 GetRepoRoot，后端返回 FilesRoot/mmd/CustomAnim。
 */
export async function getCustomAnimPath(): Promise<string | null> {
  try {
    const { getApp } = await import("../../../backend/app.ts");
    const { GetRepoRoot } = await getApp();
    const filesRoot = await GetRepoRoot("CustomAnim");
    return filesRoot || null;
  } catch {
    return null;
  }
}

/** 从文件列表中筛选动作文件（.vmd / .vpd） */
export function filterAnimFiles(files: string[]): string[] {
  return files.filter((p) => {
    const lower = p.toLowerCase();
    return ANIM_EXTS.some((ext) => lower.endsWith(ext));
  });
}
