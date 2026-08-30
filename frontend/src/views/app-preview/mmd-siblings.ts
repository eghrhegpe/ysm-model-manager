// ===== MMD 同类型候选列表（视图壳层数据准备：委托共享底座 resolveSiblingsByType）=====
// Go 按注册表白名单过滤（ADR-044③ 对称范式）。
// 从 mmd-3d.ts 归位到 views 层（ADR-072 根治：resolveMmdSiblings 是视图壳数据能力，
// 依赖 getApp 读仓库根，不该被 features/preview-3d/adapters 的 mmd-controls 反向 import——那会
// 与 mmd-3d → mmd-adapter → mmd-controls 形成循环依赖环）。
// 委托 siblings.ts 的共享底座（同 fbx-siblings.ts）——code review P3：不再逐行复制
// GetRepoRoot → label → ScanModelEntriesFiltered 链路——独立副本会漂移（已实际发生：
// 共享基座测试更新而 mmd 副本没跟，见 P2 测试未同步）。
import { resolveSiblingsByType } from "./siblings.ts";
import { RESOURCE_TYPES } from "../../utils/resource/types.ts";

/** 同类型 MMD 模型候选（委托共享底座 resolveSiblingsByType）；失败返回 []（下拉不渲染） */
export async function resolveMmdSiblings(): Promise<string[]> {
  return resolveSiblingsByType(RESOURCE_TYPES.MMD);
}
