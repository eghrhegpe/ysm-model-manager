// ===== 通用类型守卫（零依赖纯函数层）=====
// 跨模块共享的基础类型守卫与值提取函数——isObj/asRecord/toInt。
// nbt-guards.ts 的 NBT 专用守卫（asString/asNumber/asArray/getCompound）与本文件互补：
// 本文件放通用层，NBT 专用层引本文件可扩展复用。

/** 值是否为普通对象（非 null、非数组）。对齐 go map / struct 解析后的中间形态。 */
export function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** 同 isObj，直接返回窄化后的 Record 值（undefined 表示非对象）。 */
export function asRecord(v: unknown): Record<string, unknown> | undefined {
  return isObj(v) ? v : undefined;
}

/** 对齐 Go int：number 取整，非数字/非有限 → 0 */
export function toInt(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : 0;
}
