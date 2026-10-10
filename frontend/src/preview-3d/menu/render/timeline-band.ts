// ===== timeline-band.ts — 昼夜色带纯计算（[锐评 S1-3] 自 cap-controls.ts 拆出的呈现层纯函数）=====
//
// 拆出理由：色带原为 `renderCapTimeline` 内**写死的 5 个色标**，无法叶层直测，也无法与
// 天空真实相位对齐。本模块零 DOM / 零 three，只做「小时 → 颜色」的纯映射，供渲染器消费。
//
// 病（S1-3）：同一控件里太阳圆点随 `computeHourToSun` 实时联动，底下色带却是常量
// ——「一半实时一半假」比全假更误导（调云量/浑浊度时色带纹丝不动，而光斑明明在变）。
//
// 药与边界：色带**由太阳高度角派生**（与 shader 的太阳位置、圆点标记同一事实源），
// 只把光照相位如实画出来——**不重算大气散射**（ADR-073 红线：禁止自写 Preetham）。
// 故本模块的色标是「相位指示色」，不是「渲染预言」：它保证与太阳位置一致、
// 与 6/12/18 锚点一致，不宣称复现最终画面（画面由 sky shader 唯一决定）。
//
// 与 cap 的依赖方向：menu/render → caps/sky-sun.ts（零 three 纯模块），
// 合规于 R7（render 只管 menu/ 内部子层 rank）与 R9（R9 约束的是 state|infra|decoder|shader-patches）。

import { computeHourToSun } from "@/preview-3d/caps/sky-sun.ts";

/** 色带采样粒度（小时）：24h 色带取 25 个采样点（含两端），相位变化肉眼平滑 */
const SAMPLE_HOURS = 1;

/**
 * 相位关键帧：太阳高度角（°）→ 色。
 *
 * 高度角由 `computeHourToSun` 给出（6h/18h = 0°，12h = +70° 峰值，夜间为负），
 * 故下表是**物理相位**而非「几点钟」的拍脑袋——昼长变化只需换高度角函数，
 * 本表与刻度锚点都会自动跟随。
 *
 * 取色参照真实天光演进：夜幕(深靛) → 天文暮(藏蓝) → 地平线(橙) → 晨蓝(浅青) → 正午(亮蓝白)。
 */
const PHASE_KEYS: Array<{ el: number; rgb: [number, number, number] }> = [
  { el: -70, rgb: [4, 6, 15] }, // 深夜：近黑
  { el: -12, rgb: [4, 6, 15] }, // 天文暮：仍属夜
  { el: -6, rgb: [26, 43, 74] }, // 航海暮：藏蓝透出
  { el: 0, rgb: [255, 138, 92] }, // 地平线（日出/日落）：暖橙
  { el: 8, rgb: [155, 196, 232] }, // 晨/暮后：浅青蓝
  { el: 70, rgb: [155, 196, 232] }, // 正午：亮蓝（与晨同族，靠上部亮度区隔）
];

/** 色标（canvas linearGradient 消费形态）：t ∈ [0,1] 横向位置，c 为 rgb() 颜色 */
export interface BandStop {
  t: number;
  c: string;
}

/** 昼间峰值色（正午天顶感）——正午相位单独提亮，避免与晨昏同色 */
const NOON_RGB: [number, number, number] = [190, 220, 248];
/** 正午相位对应的高度角（`computeHourToSun` 的峰值 = sin(π/2)*70） */
const NOON_ELEVATION = 70;

function lerp(a: number, b: number, k: number): number {
  return a + (b - a) * k;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/** 把高度角映射到相位色：相邻关键帧线性插值（表按 el 升序，故可顺序扫描）。
 *  表首尾为哨兵（-70 / +70 = `computeHourToSun` 的极值），故任意高度角必落区间内；
 *  末尾 return 只是循环外推的兜底，不承担语义。 */
function phaseRgb(elevation: number): [number, number, number] {
  const lo0 = PHASE_KEYS[0];
  const hi0 = PHASE_KEYS[PHASE_KEYS.length - 1];
  if (!lo0 || !hi0) return [0, 0, 0]; // 表为空（构建期常量，实际不可达）
  const el = Math.max(lo0.el, Math.min(hi0.el, elevation));
  for (let i = 0; i < PHASE_KEYS.length - 1; i++) {
    const lo = PHASE_KEYS[i];
    const hi = PHASE_KEYS[i + 1];
    if (!lo || !hi) break;
    if (el > hi.el) continue;
    const span = hi.el - lo.el;
    const k = span <= 0 ? 0 : (el - lo.el) / span;
    return [
      Math.round(lerp(lo.rgb[0], hi.rgb[0], k)),
      Math.round(lerp(lo.rgb[1], hi.rgb[1], k)),
      Math.round(lerp(lo.rgb[2], hi.rgb[2], k)),
    ];
  }
  return hi0.rgb;
}

/**
 * 指定小时的色带颜色（rgb() 形式）。
 *
 * 正午提亮：高度角触峰时向 {@link NOON_RGB} 收拢——日出/日落的暖橙→晨蓝过渡若直接
 * 接正午，会停在浅青而不够亮，与「正午最亮」的直觉不符。
 */
export function bandColorAt(hour: number): string {
  const h = ((hour % 24) + 24) % 24;
  const { elevation } = computeHourToSun(h);
  let [r, g, b] = phaseRgb(elevation);
  if (elevation > 0) {
    // 白昼段按高度角比例向正午色收拢（0° = dawn/dusk 原色，70° = 完全正午色）
    const k = clamp01(elevation / NOON_ELEVATION);
    r = Math.round(lerp(r, NOON_RGB[0], k));
    g = Math.round(lerp(g, NOON_RGB[1], k));
    b = Math.round(lerp(b, NOON_RGB[2], k));
  }
  return `rgb(${r},${g},${b})`;
}

/**
 * 整条色带的色标序列：按 {@link SAMPLE_HOURS} 采样 0→24h，位置 t = 小时/24。
 *
 * 返回的 t 严格递增、首尾恰为 0 与 1（canvas `createLinearGradient` 的硬要求，
 * 且首尾同色 = 24h 与 0h 闭环无接缝）。
 */
export function bandStops(): BandStop[] {
  const stops: BandStop[] = [];
  for (let h = 0; h <= 24; h += SAMPLE_HOURS) {
    stops.push({ t: h / 24, c: bandColorAt(h) });
  }
  return stops;
}

/** 刻度锚点：6/12/18 = 日出/正午/日落（由 computeHourToSun 的零点与峰值定义，非拍脑袋） */
export const BAND_TICKS: ReadonlyArray<{ hour: number; t: number }> = [6, 12, 18].map((hour) => ({
  hour,
  t: hour / 24,
}));
