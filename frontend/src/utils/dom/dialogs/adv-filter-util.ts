// ===== 高级筛选条件：解析 + 校验（纯函数层）=====
// 从 utils/dom/dialogs/adv-filter.ts 抽出，供单测覆盖（ADR-023 L3）。
// 注意：Go SearchModels 只支持 6 个范围 + 1 关键字（见 adv-filter.ts 头部注释）。

/** 筛选条件 */
export interface AdvFilterValue {
  keyword: string;
  minBones: number | null;
  maxBones: number | null;
  minCubes: number | null;
  maxCubes: number | null;
  minTex: number | null;
  maxTex: number | null;
  tag: string;
}

/**
 * 解析范围输入框数字：空 / 非数字 / 负数 → null（null 表示不限制）。
 * 与原 collect() 中 num() 行为一致。
 */
export function parseFilterNumber(raw: string): number | null {
  const v = (raw || "").trim();
  if (!v) return null;
  const n = parseInt(v, 10);
  return isNaN(n) || n < 0 ? null : n;
}

/**
 * 校验三组 min/max 范围（仅两端都填数字时比对），返回错误文案或 null。
 * 错误文案与 adv-filter 弹窗展示一致。
 */
export function validateAdvFilter(data: AdvFilterValue): string | null {
  if (
    data.minBones != null &&
    data.maxBones != null &&
    data.minBones > data.maxBones
  ) {
    return "骨骼数：最小值不能大于最大值";
  }
  if (
    data.minCubes != null &&
    data.maxCubes != null &&
    data.minCubes > data.maxCubes
  ) {
    return "立方体：最小值不能大于最大值";
  }
  if (
    data.minTex != null &&
    data.maxTex != null &&
    data.minTex > data.maxTex
  ) {
    return "纹理尺寸：最小值不能大于最大值";
  }
  return null;
}
