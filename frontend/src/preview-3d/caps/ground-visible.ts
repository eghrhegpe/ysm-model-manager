// ===== ground-visible.ts（ground cap 显隐谓词下沉 · 横向铺叶层直测）=====
// 病根锁：`updateGridVisible` / `updateSurfaceVisible` / `isSurfaceVisible` 三个显隐判据
// 手抄在 GroundCapability 内（`updateSurfaceVisible` 与 `isSurfaceVisible` 逐字相同），
// 任一处改布尔组合会静默分叉（ADR-249 历史血案同形）。下沉为纯谓词单源，cap 只写落地副作用。
// 参照 ADR-235-d1（门控判据下沉）+ ADR-311-d1（判别样本双侧）。
import type { GroundSourceKind } from "./ground-surface-spec.ts";

/** 参考网格显隐：能力开关 × 地面总开关 × 网格开关（三支合取，少一支即灭） */
export function groundGridVisibleFor(
  enabled: boolean,
  groundVisible: boolean,
  groundGridVisible: boolean,
): boolean {
  return enabled && groundVisible && groundGridVisible;
}

/** 表面层显隐：能力开关 × 地面总开关 × 来源非 none（来源切 none 回落 false，无表面层纯净态） */
export function groundSurfaceVisibleFor(
  enabled: boolean,
  groundVisible: boolean,
  sourceKind: GroundSourceKind,
): boolean {
  return enabled && groundVisible && sourceKind !== "none";
}
