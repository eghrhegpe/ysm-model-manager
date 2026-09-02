// ===== NBT 解析类型守卫共享层（对齐 go/litematic/nbt.go getInt/getString/getCompound/getList 口径）=====
// 网页版 NBT/体素解析（nbt-parse.ts / voxel-parse.ts）共用的一组无状态类型守卫。
// 历史：两文件曾各抄一份逐行相同的 isObj/asNumber/asArray/getCompound——「跨文件同函数
// 禁双份定义」（frontend_naming 章程）红线，提取本模块收敛，搜一个守卫只出一个文件。
// 守卫语义对齐 Go 侧 getInt/getLong/getString/getCompound/getList 的「缺失/类型不符 → undefined
// 或 null」契约；调用方自行 ?? 兜底默认值。
// 零依赖（纯类型守卫，无 IO）。

/** 值是否为普通对象（非 null、非数组）。NBT Compound 解析后即此类。 */
export function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** getString 口径：字符串值，否则 undefined。 */
export function asString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

/** getInt/getLong 统一口径：整型（Byte/Short/Int/Long/Float/Double 均已归一为 number）。 */
export function asNumber(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/** getList 口径：List/ByteArray/IntArray 解析后均为 JS 数组，统一取数组值。 */
export function asArray(v: unknown): unknown[] | undefined {
  return Array.isArray(v) ? v : undefined;
}

/** getCompound 口径：键值存在且为对象则返回该 compound，否则 undefined。 */
export function getCompound(o: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const v = o[key];
  return isObj(v) ? v : undefined;
}
