/**
 * token-types.ts — design-tokens 判定层的**类型基座**（2026-10-25 从 design-tokens.ts 沿真缝拆出）。
 *
 * 为什么单独立文件：`DesignViolation` / `TokenRawMap` 被 style 扫描与 emoji 扫描两个域共用，
 * 是拆分后唯一的公共依赖根；放这里可让两个域模块互不 import（避免循环依赖）。
 *
 * 导出面：本文件的类型经 ./design-tokens.ts 原样透出，消费方 import 路径零改动。
 * 行为：纯类型声明，零运行时副作用。
 */

/** 违规种类（稳定标识，供 JSON 消费与基线 key）。 */
export type DesignViolationKind =
  | "inline-style-font-size"
  | "inline-style-radius"
  | "inline-style-color"
  | "css-font-size"
  | "css-radius"
  | "css-color"
  | "css-shadow"
  | "css-transition"
  | "inline-style-padding"
  | "css-padding"
  | "emoji-icon"
  | "toast-emoji-prefix"
  | "locale-emoji-prefix";

/** 单条命中。 */
export interface DesignViolation {
  kind: DesignViolationKind;
  /** 1-based 行号（调用方按行喂入时由 offset 提供；纯函数内不感知）。 */
  line: number;
  /** 命中的原始片段（截断展示，避免超长模板串刷屏）。 */
  snippet: string;
  /** 建议替换的令牌名（如 --fs-md）；无法可信建议时为 null。 */
  suggestion: string | null;
}

/** 令牌映射：令牌名 → 该令牌在**基准缩放**下的 px 数值（可换算时）。 */
export type TokenPxMap = Map<string, number>;

/** 令牌名 → 原始值文本（诊断展示用）。 */
export type TokenRawMap = Map<string, string>;
