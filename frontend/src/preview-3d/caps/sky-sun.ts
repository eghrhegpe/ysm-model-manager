// ===== sky-sun.ts（sky cap 资产管线下沉 · ADR-235-d1 子提交 A）=====
// 病根锁：`hourToSun`/`getSunPosition`/太阳球坐标换算原先作为 SkyCapability 私有方法
// 混在编排壳里（sky-capability.ts 967 行），纯计算无法叶层直测。下沉本模块：零 three 依赖，
// 全部输入参数化（不读 envState），cap 只调结果。参照 ADR-091-d1（环境 cap 拆分）范式。
// 三维向量用内联结构返回（零 three / 零自定义类型依赖，便于纯函数直测）。

/**
 * 按一天中的小时（0-24）映射太阳位置：6=日出(东)、12=正午(南)、18=日落(西)，夜间在地平线下 → 天空转暗。
 * 与 sky-capability.ts 原 `hourToSun` 逐字等价（含 `((hour % 24) + 24) % 24` 的负数/超界 wrap）。
 */
export function computeHourToSun(hour: number): { elevation: number; azimuth: number } {
  const h = ((hour % 24) + 24) % 24;
  const dayAngle = ((h - 6) / 12) * Math.PI; // 6→0, 12→π/2, 18→π
  const elevation = Math.sin(dayAngle) * 70; // 峰值 70°，夜间为负 → 天空转暗
  const azimuth = 90 + ((h - 6) / 12) * 180; // 90(东)→180(南)→270(西)
  return { elevation, azimuth };
}

/**
 * 当前 timeOfDay 对应的太阳归一化坐标 (x: 0-1 经度, y: 0-1 纬度，0=底 1=顶)。
 * 供时间轴标记太阳位置；与 ENV_PRESETS.sunPos 同一口径。
 * 参数化 `hour`（原实现读 `envState.skyTimeOfDay`）——下沉后成为纯函数。
 */
export function computeSunPosition(hour: number): { x: number; y: number } {
  const { elevation, azimuth } = computeHourToSun(hour);
  // azimuth 90~270 → x 0~1；elevation -70~70 → y 0~1（70=顶 1.0，-70=底 0.0）
  const x = (azimuth - 90) / 180;
  const y = (elevation + 70) / 140;
  return { x: clamp01(x), y: clamp01(y) };
}

/**
 * 由太阳高度角/方位角换算归一化方向向量（等价 three `Vector3.setFromSphericalCoords(1, φ, θ)`）。
 * 原先内联在 `writeUniforms`（sky-capability.ts）——下沉后 `u.sunPosition.value.set(x, y, z)` 直用。
 */
export function sunVectorFromSpherical(
  elevation: number,
  azimuth: number,
): {
  x: number;
  y: number;
  z: number;
} {
  const phi = ((90 - elevation) * Math.PI) / 180; // 极角 φ：从 +Y 轴起
  const theta = (azimuth * Math.PI) / 180; // 方位角 θ
  const sinPhi = Math.sin(phi);
  return {
    x: sinPhi * Math.sin(theta),
    y: Math.cos(phi),
    z: sinPhi * Math.cos(theta),
  };
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}
