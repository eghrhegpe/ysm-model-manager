// ===== FBX 同类型候选列表（ADR-112 地基拓展：P0-1 预览内切换）=====
// 委托通用底座 resolveSiblingsByType，Go 按注册表白名单过滤 .fbx，排除同目录 .vmd 等异格式。

import { RESOURCE_TYPES } from "../../utils/resource/types.ts";
import { resolveSiblingsByType } from "./siblings.ts";

/** 同类型 FBX 模型候选（GetRepoRoot(fbx) → ScanModelEntriesFiltered 主文件 Path 列表）；失败返回 []（下拉不渲染） */
export async function resolveFbxSiblings(): Promise<string[]> {
  return resolveSiblingsByType(RESOURCE_TYPES.FBX);
}
