// ===== pack_format → Minecraft 版本号映射（类型化版 — ADR-014 P2）=====
// 映射表抽为独立 JSON（pack-format-map.json），MC 版本迭代只改 JSON 不改代码。

import _FORMAT_VERSION_MAP from "./pack-format-map.json" with { type: "json" };

/** FORMAT_VERSION_MAP 静态 import，MC 版本迭代只改 JSON 不改代码（显式类型标注供 number 索引） */
const FORMAT_VERSION_MAP: Record<string, string> = _FORMAT_VERSION_MAP;

/** 已知最大 pack_format（超出视为「最新版本」），动态计算消灭硬编码魔数 */
const MAX_KNOWN_FORMAT = Math.max(...Object.keys(FORMAT_VERSION_MAP).map(Number));

/** ReadPackMeta 返回的 meta 对象（ADR-143 P1 后 Go 直出 typed struct，字段可空数组） */
export interface PackMeta {
  supported_formats?: number[] | null;
  min_format?: number | number[] | null;
  max_format?: number | number[] | null;
  pack_format?: number;
}

/**
 * 根据 meta 对象生成格式号 + 版本号描述
 * @param meta ReadPackMeta 返回的 JSON 对象
 * @note min/max 各自映射的版本号可能是范围字符串（如 "1.9 ~ 1.10.2"），
 *       拼接用「 / 」作分隔符，避免出现 "1.9 ~ 1.10.2 ~ 1.11" 的四段歧义串。
 */
export function describeVersionRange(meta: PackMeta): { format: string; version: string } {
  const fmtVer = (n: number): string =>
    FORMAT_VERSION_MAP[n] || (n > MAX_KNOWN_FORMAT ? "最新版本" : String(n));
  // 1. supported_formats 优先
  if (
    meta.supported_formats &&
    Array.isArray(meta.supported_formats) &&
    meta.supported_formats.length === 2
  ) {
    const min = meta.supported_formats[0];
    const max = meta.supported_formats[1];
    const minVer = fmtVer(min);
    const maxVer = fmtVer(max);
    if (max >= 9999) {
      return { format: "≥ " + min, version: "≥ " + minVer };
    }
    return { format: min + " ~ " + max, version: minVer + " / " + maxVer };
  }
  // 2. min_format / max_format（可能是 int 或 [min,max] 数组）
  // binding 层（internal/app/resource_bindings.go）恒输出 []int{Min, Max}：
  // min_format 取首元素（Min），max_format 取末元素（Max），避免双值数组丢 Max
  if (meta.min_format != null && meta.max_format != null) {
    const minRaw = Array.isArray(meta.min_format) ? meta.min_format[0] : meta.min_format;
    const maxRaw = Array.isArray(meta.max_format)
      ? meta.max_format[meta.max_format.length - 1]
      : meta.max_format;
    const minVer = fmtVer(minRaw);
    const maxVer = fmtVer(maxRaw);
    if (maxRaw >= 9999) {
      return { format: "≥ " + minRaw, version: "≥ " + minVer };
    }
    if (minRaw !== maxRaw) {
      return {
        format: minRaw + " ~ " + maxRaw,
        version: minVer + " / " + maxVer,
      };
    }
  }
  // 3. 单体 pack_format 兜底
  if (meta.pack_format != null) {
    // P3 修复：改用 fmtVer 与 supported/min/max 分支口径一致——
    // 原 FORMAT_VERSION_MAP 直接索引 + `ver || ""` 使 pack_format > 88 返回空串，
    // 而同一数字经 supported_formats/min/max 分支会返回「最新版本」（fmtVer 兜底）
    return { format: String(meta.pack_format), version: fmtVer(meta.pack_format) };
  }
  return { format: "?", version: "" };
}
