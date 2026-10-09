// ===== light-visible.ts（light cap 显隐谓词下沉 · 横向铺叶层直测）=====
// 病根锁：`helperVisibleFor` 是「三处调用点统一单源」的唯一谓词，但零叶测——
// 注释自述旧实现三分歧（createHelper 缺能力总闸、syncHelper 缺能力总闸），纯逻辑收敛后
// 任一处布尔组合改错（尤其漏能力总闸）会静默复活旧三分歧。下沉为纯谓词 + 三支各断一支判别样本。
// 参照 ground-visible.ts（同构三布尔合取）+ ADR-311-d1。
export function lightHelperVisibleFor(
  masterOn: boolean,
  lightEnabled: boolean,
  lightHelperVisible: boolean,
): boolean {
  return masterOn && lightEnabled && lightHelperVisible;
}
