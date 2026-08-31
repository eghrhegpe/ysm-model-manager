// ===== 同类型候选列表通用底座（视图壳数据准备：GetRepoRoot → ScanModelEntriesFiltered）=====
// 各格式（mmd / fbx / scene / ...）共享同一链路，Go 按注册表白名单过滤（ADR-044③ 对称范式）。
// 归位 views 层（ADR-072 根治：依赖 getApp 读仓库根，属视图壳数据能力，
// 不该被 preview-3d/adapters 反向 import —— 那会与 adapter → controls 形成循环依赖环）。
import { getApp } from "../../backend/app.ts";
import { RESOURCE_TYPE_LABELS } from "../../utils/resource/types.ts";

/**
 * 解析某资源类型的同目录候选主文件路径列表。
 * @param rtype  资源类型 id（RESOURCE_TYPES.*），传给 Go `GetRepoRoot` + `ScanModelEntriesFiltered`
 * @returns 候选绝对路径列表；根为空 / 扫描失败 → []（调用方下拉不渲染，不阻断）
 */
export async function resolveSiblingsByType(rtype: string): Promise<string[]> {
  try {
    const app = await getApp();
    const root = await app.GetRepoRoot(rtype);
    if (!root) return [];
    const label = RESOURCE_TYPE_LABELS[rtype] || rtype;
    const entries = await app.ScanModelEntriesFiltered(root, rtype, "", label);
    return (entries || []).map((e) => e.Path || "");
  } catch {
    return [];
  }
}
