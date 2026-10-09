// ===== sky-asset.ts（sky cap 资产管线下沉 · ADR-235-d1 子提交 B）=====
// 病根锁：`createSky` / `applyUniform` / `applyScaledUniform` 原先作为 SkyCapability 私有方法
// 混在编排壳里，双写 sky+envSky 材质的机制无法叶层直测。下沉本模块：接受「sky/envSky 材质对」为参数，
// **不读 envState / 不判 changed 门控**（门控归 cap 编排），只做纯机制。
// 参照 ADR-091-d1（环境 cap 拆分）+ ADR-311-d1（判别样本双侧）。
import { Sky } from "three/addons/objects/Sky.js";

type UniformTable = Record<string, { value: number } | undefined>;

/**
 * 创建 Three 官方 Sky 网格（Preetham 大气散射，`side=BackSide` 由 Sky 默认）。
 * `scale` 须大于相机 maxDistance（天空盒半边长），预览核心取 SKY_SCALE=12000。
 * `cloudCoverage` 由 patch 体系（`sky-patch.ts`）注入；此处 `??=` 防御兜底——
 * 若上游尚未注入则先补一个初值（随后由 `writeUniforms` 覆盖），保证本模块不被上游时序绑架。
 */
export function createSky(cloudCoverage: number, scale: number): Sky {
  const sky = new Sky();
  sky.scale.setScalar(scale);
  const u = sky.material.uniforms as UniformTable;
  // ⚠️ Sky 默认已含 `cloudCoverage`（value≈0.4）：`??=` 只在未注入时赋值，会把传入值吞掉
  // （判别样本：`createSky(0.35)` 必须得 0.35）。故**先保底再写值**——无则注入、有则覆盖。
  if (u.cloudCoverage === undefined) u.cloudCoverage = { value: cloudCoverage };
  else u.cloudCoverage.value = cloudCoverage;
  return sky;
}

/**
 * 双写 uniform（sky + envSky）。无 changed 门控——**门控归调用方**（cap 判 `changed.has(field)`）。
 * uniform 不存在即抛错（`undefined.value`）——调用方须保证 patch 已注入该 uniform。
 */
export function applyUniformToPair(sky: Sky, envSky: Sky, uniform: string, value: number): void {
  // 类型断言用非 undefined 的 `{ value: number }`（与 cap 原写法一致）——禁用 `!` 非空断言
  (sky.material.uniforms as Record<string, { value: number }>)[uniform].value = value;
  (envSky.material.uniforms as Record<string, { value: number }>)[uniform].value = value;
}

/**
 * 双写 uniform，带 **undefined 守卫**（patch 幂等注入后 uniform 必存在，但防御性保留）。
 * 与 {@link applyUniformToPair} 的区别：缺 uniform 时静默跳过（不抛错），适用于
 * 非对称 patch（主天空有 `sunIntensityScale` / `sunDiscScale`，envSky 无）。
 */
export function applyScaledUniformToPair(
  sky: Sky,
  envSky: Sky,
  uniform: string,
  value: number,
): void {
  const su = (sky.material.uniforms as UniformTable)[uniform];
  const esu = (envSky.material.uniforms as UniformTable)[uniform];
  if (su !== undefined) su.value = value;
  if (esu !== undefined) esu.value = value;
}
