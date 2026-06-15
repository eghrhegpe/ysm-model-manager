// ===== pack_format → Minecraft 版本号映射 =====

const FORMAT_VERSION_MAP = {
  1: "1.6.1 ~ 1.8.9",
  2: "1.9 ~ 1.10.2",
  3: "1.11 ~ 1.12.2",
  4: "1.13 ~ 1.14.4",
  5: "1.15 ~ 1.16.1",
  6: "1.16.2 ~ 1.16.5",
  7: "1.17 ~ 1.18",
  8: "1.18.1 ~ 1.18.2",
  9: "1.19 ~ 1.19.2",
  11: "1.19.3",
  12: "1.19.4",
  13: "1.19.4 ~ 1.20",
  14: "1.20 ~ 1.20.1",
  15: "1.20.1",
  16: "1.20.2",
  17: "1.20.2",
  18: "1.20.3",
  19: "1.20.3",
  20: "1.20.3",
  21: "1.20.3",
  22: "1.20.5",
  24: "1.20.5",
  25: "1.20.5",
  26: "1.20.5",
  28: "1.20.5",
  29: "1.20.5",
  30: "1.20.5",
  31: "1.20.5",
  32: "1.20.6",
  33: "1.21",
  34: "1.21.1",
  35: "1.21.2",
  36: "1.21.2",
  37: "1.21.2",
  38: "1.21.2",
  39: "1.21.2",
  40: "1.21.2",
  41: "1.21.2",
  42: "1.21.3",
  43: "1.21.4",
  44: "1.21.4",
  45: "1.21.4",
  46: "1.21.4",
  47: "1.21.5",
  48: "1.21.5",
  49: "1.21.5",
  50: "1.21.5",
  51: "1.21.5",
  52: "1.21.5",
  53: "1.21.5",
  54: "1.21.5",
  55: "1.21.5",
  56: "1.21.6",
  57: "1.21.6",
  58: "1.21.6",
  59: "1.21.6",
  60: "1.21.6",
  61: "1.21.6",
  62: "1.21.6",
  63: "1.21.7",
  64: "1.21.8",
  65: "1.21.9", "65.0": "1.21.9", "65.1": "1.21.9", "65.2": "1.21.9",
  66: "1.21.9", "66.0": "1.21.9",
  67: "1.21.9", "67.0": "1.21.9",
  68: "1.21.9", "68.0": "1.21.9",
  69: "1.21.10", "69.0": "1.21.10",
  70: "1.21.11", "70.0": "1.21.11", "70.1": "1.21.11",
  71: "1.21.11", "71.0": "1.21.11",
  72: "1.21.11", "72.0": "1.21.11",
  73: "1.21.11", "73.0": "1.21.11",
  74: "1.21.11", "74.0": "1.21.11",
  75: "1.21.11", "75.0": "1.21.11",
  76: "26.1", "76.0": "26.1",
  77: "26.1", "77.0": "26.1",
  78: "26.1", "78.0": "26.1", "78.1": "26.1",
  79: "26.1", "79.0": "26.1",
  80: "26.1", "80.0": "26.1",
  81: "26.1", "81.0": "26.1", "81.1": "26.1",
  82: "26.1", "82.0": "26.1",
  83: "26.1", "83.0": "26.1",
  84: "26.1.2", "84.0": "26.1.2",
  85: "26.2", "85.0": "26.2",
  86: "26.2", "86.0": "26.2", "86.1": "26.2", "86.2": "26.2",
  87: "26.2", "87.0": "26.2",
  88: "26.2", "88.0": "26.2",
};

/**
 * 根据 pack_format 数值获取可读 Minecraft 版本描述
 * @param {number} packFormat
 * @returns {string|null}
 */
export function formatVersion(packFormat) {
  return FORMAT_VERSION_MAP[packFormat] || null;
}

/**
 * 根据 meta 对象生成格式号 + 版本号描述
 * @param {object} meta - ReadPackMeta 返回的 JSON 对象
 * @returns {{format:string, version:string}}
 */
export function describeVersionRange(meta) {
  const fmtVer = (n) => FORMAT_VERSION_MAP[n] || (n > 88 ? "最新版本" : String(n));
  // 1. supported_formats 优先
  if (meta.supported_formats && Array.isArray(meta.supported_formats) && meta.supported_formats.length === 2) {
    const min = meta.supported_formats[0];
    const max = meta.supported_formats[1];
    const minVer = fmtVer(min);
    const maxVer = fmtVer(max);
    if (max >= 9999) {
      return { format: "≥ " + min, version: "≥ " + minVer };
    }
    return { format: min + " ~ " + max, version: minVer + " ~ " + maxVer };
  }
  // 2. min_format / max_format（可能是 int 或 [min,max] 数组）
  if (meta.min_format != null && meta.max_format != null) {
    const minRaw = Array.isArray(meta.min_format) ? meta.min_format[0] : meta.min_format;
    const maxRaw = Array.isArray(meta.max_format) ? meta.max_format[0] : meta.max_format;
    const minVer = fmtVer(minRaw);
    const maxVer = fmtVer(maxRaw);
    if (maxRaw >= 9999) {
      return { format: "≥ " + minRaw, version: "≥ " + minVer };
    }
    if (minRaw !== maxRaw) {
      return { format: minRaw + " ~ " + maxRaw, version: minVer + " ~ " + maxVer };
    }
  }
  // 3. 单体 pack_format 兜底
  if (meta.pack_format != null) {
    const ver = FORMAT_VERSION_MAP[meta.pack_format];
    return { format: String(meta.pack_format), version: ver || "" };
  }
  return { format: "?", version: "" };
}
