// ===== 骨骼名导出文本构建（纯函数层）=====
// 从 views/app-preview/skeleton.ts 的「📋 导出骨骼名」按钮抽出，供单测覆盖（ADR-023 L3）。

/** 骨骼条目（结构类型，兼容 DecodedYsm.bones 元素） */
export interface BoneEntry {
  name: string;
  cubes?: unknown[];
}

/**
 * 构建骨骼名导出文本行：
 * 首行 `模型: <path>`、次行 `骨骼总数: <n>`，其后每根骨骼
 * 有方块则 `名称 (n 方)`，结构骨骼（无方块）则 `名称 (结构骨骼,无方)`。
 */
export function buildBoneNamesText(
  modelPath: string,
  boneCount: number,
  bones: BoneEntry[],
): string[] {
  const lines: string[] = [`模型: ${modelPath}`, `骨骼总数: ${boneCount}`];
  for (const b of bones) {
    const cs = b.cubes || [];
    lines.push(
      `${b.name}${cs.length ? ` (${cs.length} 方)` : " (结构骨骼,无方)"}`,
    );
  }
  return lines;
}
