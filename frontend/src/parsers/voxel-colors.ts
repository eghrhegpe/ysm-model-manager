// ===== 网页版方块配色（ADR-070 M2：voxel groups 的 color 来源）=====
// 纯 TS 平移 go/litematic/block_colors.go（MapColor）与 go/litematic/block_ids.go
// （ResolveBlockName）。数据表（BLOCK_COLOR_MAP / BLOCK_VARIANT_NAMES）由 Go 源
// 一次性生成（voxel-colors-data.json），本文件只做算法平移。
import data from "./voxel-colors-data.json";
const BLOCK_COLOR_MAP: Record<string, string> = data.BLOCK_COLOR_MAP;
const BLOCK_VARIANT_NAMES: Record<string, string> = data.BLOCK_VARIANT_NAMES;

// 对齐 block_colors.go fuzzyMatch：方块后缀命中时尝试去掉后缀再匹配
const BLOCK_SUFFIXES = [
  "stairs", "slab", "wall", "fence", "gate", "door",
  "trapdoor", "button", "pressure_plate",
];

/** 确定性名称哈希（FNV-1a 32 位，对齐 block_colors.go hashColor 的 fnv.New32a） */
function fnv1a32(name: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i) & 0xff;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** 对齐 block_colors.go hueToRgb（标准 HSL → RGB 转换） */
function hueToRgb(p: number, q: number, t: number): number {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 0.5) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}

/** 对齐 block_colors.go rgbToHex（含钳位与小写十六进制） */
function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : v);
  r = clamp(r);
  g = clamp(g);
  b = clamp(b);
  const hex = (n: number): string => n.toString(16).padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

/** 对齐 block_colors.go hslToHex：s/l 为百分数（50/60） */
function hslToHex(h: number, s: number, l: number): string {
  const hf = h / 360.0;
  const sf = s / 100.0;
  const lf = l / 100.0;
  let r: number, g: number, b: number;
  if (sf === 0) {
    r = g = b = lf;
  } else {
    const q = lf < 0.5 ? lf * (1 + sf) : lf + sf - lf * sf;
    const p = 2 * lf - q;
    r = hueToRgb(p, q, hf + 1 / 3);
    g = hueToRgb(p, q, hf);
    b = hueToRgb(p, q, hf - 1 / 3);
  }
  // Go int(r*255+0.5)：非负浮点截断取整
  return rgbToHex(Math.floor(r * 255 + 0.5), Math.floor(g * 255 + 0.5), Math.floor(b * 255 + 0.5));
}

/** 对齐 block_colors.go hashColor：FNV-1a 哈希 → HSL(h, 50%, 60%) 十六进制 */
function hashColor(name: string): string {
  const hue = fnv1a32(name) % 360;
  return hslToHex(hue, 50, 60);
}

/** 对齐 block_colors.go fuzzyMatch：前缀逐段匹配，失败后去掉已知后缀递归 */
function fuzzyMatch(name: string): string {
  const parts = name.split("_");
  for (let n = parts.length; n >= 1; n--) {
    const prefix = parts.slice(0, n).join("_");
    if (BLOCK_COLOR_MAP[prefix] !== undefined) return BLOCK_COLOR_MAP[prefix];
  }
  for (const suffix of BLOCK_SUFFIXES) {
    if (name.endsWith(`_${suffix}`)) {
      const base = name.slice(0, name.length - suffix.length - 1);
      const c = fuzzyMatch(base);
      if (c !== "") return c;
    }
  }
  return "";
}

/**
 * 对齐 go/litematic/block_colors.go MapColor：方块注册名 → 近似十六进制颜色。
 * 去命名空间（minecraft:）→ 预定义表 → 前缀/后缀模糊匹配 → FNV 哈希回退。
 * air/cave_air/void_air 映射为空串（调用方据此判定空气方块）。
 */
export function mapColor(blockName: string): string {
  let name = blockName;
  const idx = name.indexOf(":");
  if (idx >= 0) name = name.slice(idx + 1);
  const direct = BLOCK_COLOR_MAP[name];
  if (direct !== undefined) return direct;
  const fuzzy = fuzzyMatch(name);
  if (fuzzy !== "") return fuzzy;
  return hashColor(name);
}

/**
 * 对齐 go/litematic/block_ids.go ResolveBlockName：schematic v1 数字 ID →
 * 注册名（优先 "id:data" 变体，回退 "id:0"）。未找到返回空串。
 */
export function resolveBlockName(id: number, data: number): string {
  const v = BLOCK_VARIANT_NAMES[`${id}:${data}`];
  if (v !== undefined) return v;
  return BLOCK_VARIANT_NAMES[`${id}:0`] ?? "";
}
