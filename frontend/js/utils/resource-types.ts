// ===== 资源类型常量（类型化版 — ADR-014 P2）=====

/** 资源类型 ID（键为类型标签，值为内部 ID） */
export const RESOURCE_TYPES: Record<string, string> = {
  YSM: "ysm",
  MMD: "mmd-skin",
  VRC: "vrchat-avatar",
  PACK: "resourcepack",
  SHADER: "shaderpack",
  BLUEPRINT: "create-blueprint",
  LITEMATIC: "litematic",
};

/** 资源类型显示标签（内部 ID → 中文名） */
export const RESOURCE_TYPE_LABELS: Record<string, string> = {
  ysm: "模型",
  "mmd-skin": "MMD",
  "vrchat-avatar": "VRC",
  resourcepack: "资源包",
  shaderpack: "光影包",
  "create-blueprint": "蓝图",
  litematic: "投影",
};

/** 全部资源类型 ID 列表 */
export const ALL_RESOURCE_TYPES: string[] = Object.values(RESOURCE_TYPES);
