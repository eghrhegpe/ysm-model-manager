// ===== pack_format → Minecraft 版本号映射 =====

const FORMAT_VERSION_MAP = {
  1: "1.6.1快照13w24a ~ 1.8.9",
  2: "1.9快照15w31a ~ 1.10.2",
  3: "1.11快照16w32a ~ 1.13快照17w47b",
  4: "1.13快照17w48a ~ 1.14.4快照19w46b",
  5: "1.15-pre1 ~ 1.16.2-pre3",
  6: "1.16.2-rc1 ~ 1.16.5",
  7: "1.17快照20w45a ~ 1.18快照21w38a",
  8: "1.18快照21w39a ~ 1.18.2",
  9: "1.19快照22w11a ~ 1.19.2",
  11: "1.19.3快照22w42a ~ 22w44a",
  12: "1.19.3快照22w45a ~ 1.19.4快照23w07a",
  13: "1.19.4-pre1 ~ 1.20快照23w13a",
  14: "1.20快照23w14a ~ 23w16a",
  15: "1.20快照23w17a ~ 1.20.1",
  16: "1.20.2快照23w31a",
  17: "1.20.2快照23w32a ~ 1.20.2-pre1",
  18: "1.20.2-pre2 ~ 1.20.3快照23w41a",
  19: "1.20.3快照23w42a",
  20: "1.20.3快照23w43a ~ 23w44a",
  21: "1.20.3快照23w45a ~ 23w46a",
  22: "1.20.3-pre1 ~ 1.20.5快照23w51b",
  24: "1.20.5快照24w03a ~ 24w04a",
  25: "1.20.5快照24w05a ~ 24w05b",
  26: "1.20.5快照24w06a ~ 24w07a",
  28: "1.20.5快照24w09a ~ 24w10a",
  29: "1.20.5快照24w11a",
  30: "1.20.5快照24w12a",
  31: "1.20.5快照24w13a ~ 1.20.5-pre3",
  32: "1.20.5-pre4 ~ 1.20.6",
  33: "1.21快照24w18a ~ 24w20a",
  34: "1.21快照24w21a ~ 1.21.1",
  35: "1.21.2快照24w33a",
  36: "1.21.2快照24w34a ~ 24w35a",
  37: "1.21.2快照24w36a",
  38: "1.21.2快照24w37a",
  39: "1.21.2快照24w38a ~ 24w39a",
  40: "1.21.2快照24w40a",
  41: "1.21.2-pre1 ~ 1.21.2-pre2",
  42: "1.21.2-pre3 ~ 1.21.3",
  43: "1.21.4快照24w44a",
  44: "1.21.4快照24w45a",
  45: "1.21.4快照24w46a",
  46: "1.21.4-pre1 ~ 1.21.4",
  47: "1.21.5快照25w02a",
  48: "1.21.5快照25w03a",
  49: "1.21.5快照25w04a",
  50: "1.21.5快照25w05a",
  51: "1.21.5快照25w06a",
  52: "1.21.5快照25w07a",
  53: "1.21.5快照25w08a ~ 25w09b",
  54: "1.21.5快照25w10a",
  55: "1.21.5-pre1 ~ 1.21.5",
  56: "1.21.6快照25w15a",
  57: "1.21.6快照25w16a",
  58: "1.21.6快照25w17a",
  59: "1.21.6快照25w18a",
  60: "1.21.6快照25w19a",
  61: "1.21.6快照25w20a",
  62: "1.21.6快照25w21a",
  63: "1.21.6-pre1 ~ 1.21.7-rc1",
  64: "1.21.7-rc2 ~ 1.21.8",
  65: "1.21.9快照25w31a",
  66: "1.21.9快照25w34a ~ 25w34b",
  67: "1.21.9快照25w35a",
  68: "1.21.9快照25w36a ~ 25w36b",
  69: "1.21.9快照25w37a ~ 1.21.10",
  70: "1.21.11快照25w41a",
  71: "1.21.11快照25w43a",
  72: "1.21.11快照25w44a",
  73: "1.21.11快照25w45a",
  74: "1.21.11快照25w46a",
  75: "1.21.11-pre1 ~ 1.21.11",
  76: "26.1快照26.1-snapshot-1",
  77: "26.1快照26.1-snapshot-2",
  78: "26.1快照26.1-snapshot-3",
  79: "26.1快照26.1-snapshot-5",
  80: "26.1快照26.1-snapshot-6",
  81: "26.1快照26.1-snapshot-7",
  82: "26.1快照26.1-snapshot-10",
  83: "26.1快照26.1-snapshot-11",
  84: "26.1-pre-1 ~ 26.1.2",
  85: "26.2快照26.2-snapshot-1 ~ 26.2-snapshot-2",
  86: "26.2快照26.2-snapshot-3",
  87: "26.2快照26.2-snapshot-7 ~ 26.2-snapshot-8",
  88: "26.2-pre-1 ~ 26.2-rc-2",
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
 * 根据 meta 对象生成支持的版本范围描述
 * @param {object} meta - ReadPackMeta 返回的 JSON 对象
 * @returns {string}
 */
export function describeVersionRange(meta) {
  // 1. supported_formats 优先
  if (meta.supported_formats && Array.isArray(meta.supported_formats) && meta.supported_formats.length === 2) {
    const min = meta.supported_formats[0];
    const max = meta.supported_formats[1];
    const minVer = FORMAT_VERSION_MAP[min];
    const maxVer = FORMAT_VERSION_MAP[max];
    if (minVer && maxVer && max >= 9999) {
      return "≥ " + minVer;
    }
    if (minVer && maxVer) {
      return minVer + " ~ " + maxVer;
    }
    if (minVer) {
      return minVer + " +";
    }
  }
  // 2. min_format / max_format（可能是 int 或 [min,max] 数组）
  if (meta.min_format != null && meta.max_format != null) {
    const minRaw = Array.isArray(meta.min_format) ? meta.min_format[0] : meta.min_format;
    const maxRaw = Array.isArray(meta.max_format) ? meta.max_format[0] : meta.max_format;
    const minVer = FORMAT_VERSION_MAP[minRaw];
    const maxVer = FORMAT_VERSION_MAP[maxRaw];
    if (minVer && maxVer && maxRaw >= 9999) {
      return "≥ " + minVer;
    }
    if (minVer && maxVer) {
      return minVer + " ~ " + maxVer;
    }
  }
  // 3. 单体 pack_format 兜底
  if (meta.pack_format && FORMAT_VERSION_MAP[meta.pack_format]) {
    return FORMAT_VERSION_MAP[meta.pack_format];
  }
  return "";
}
