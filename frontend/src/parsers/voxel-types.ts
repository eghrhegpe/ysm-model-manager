// ===== 体素输出类型（对齐 types.VoxelGroup / LitematicVoxelData json tag）=====
// 消费方：litematic-adapter.ts / web-fs-read.ts / web-fs-container.ts / litematic-3d.ts

/** 同色方块组（对齐 types.VoxelGroup json tag） */
export interface VoxelGroup {
  color: string;
  positions: number[][];
}

/** 体素视图输出（对齐 go/types/resource.go:325 LitematicVoxelData json tag） */
export interface VoxelData {
  size: number[];
  groups: VoxelGroup[] | null; // null 仅出现在「无 Regions」降级（对齐 Go 空 Groups → JSON null）
  truncated: boolean;
  maxBlocks: number;
}
