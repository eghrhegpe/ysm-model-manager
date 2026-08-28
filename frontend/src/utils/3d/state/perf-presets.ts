// ===== perf-presets.ts — 3D 预览性能档位（薄壳版：数据表 + 通用套用器）=====
// ADR-126 P4 系列延续：档位 = 纯数据表（StatePath → 值），套用走状态层统一写口。
// 新增档位/参数只改表，零代码接线——刻意规避隔壁 MikuMikuAR 的坑（每个模式
// 手写参数映射 + SetPerformanceMode 走 Go 绑定 + custom 档需手动 reRender 面板）。
//
// 范围（薄壳版一期）：只控「有状态层路径」的性能项——帧率 / 分辨率 / Bloom 开关。
//  - wireframe / pmrem 是视觉项不进档位表；frustumCull 是纯优化（无画质损失）恒开不进表
//  - cap 派生路径（render.bloom）在 cap 缺席时 setStateValue 静默丢弃（available()=false），
//    套用无副作用
//  - custom = 不套用（保持用户手调）

import { safeGet, safeSet } from "../../dom/storage.ts";
import { KNOWN_PATHS, setStateValue } from "./preview-state.ts";

/** 性能档位：低 / 中 / 高 + 自定义（自定义不套用，保持用户手调） */
export type PerfLevel = "low" | "medium" | "high" | "custom";

/** 持久化键：当前档位（对齐 ysm_3d_maxFps 风格） */
export const PERF_PRESET_KEY = "ysm_3d_perfPreset";

/** 无存档时的默认档位 */
export const PERF_PRESET_DEFAULT: PerfLevel = "medium";

/** 档位表路径类型：必须落在状态层 KNOWN_PATHS 定义域（编译期守卫） */
type PerfPath = (typeof KNOWN_PATHS)[number];

/** 档位表：三档 → StatePath → 值（纯数据，新增档位/参数只改这里，零接线） */
export const PERF_PRESETS: Record<
  Exclude<PerfLevel, "custom">,
  Partial<Record<PerfPath, number | boolean>>
> = {
  low: {
    "render.maxFps": 30,
    "render.maxPixelRatio": 0.75,
    "render.bloom": false,
  },
  medium: {
    "render.maxFps": 60,
    "render.maxPixelRatio": 1.0,
    "render.bloom": true,
  },
  high: {
    "render.maxFps": 120,
    "render.maxPixelRatio": 1.5,
    "render.bloom": true,
  },
};

/** 读取当前档位（无存档或未知值回默认） */
export function getPerfPreset(): PerfLevel {
  const v = safeGet(PERF_PRESET_KEY);
  return v === "low" || v === "medium" || v === "high" || v === "custom"
    ? v
    : PERF_PRESET_DEFAULT;
}

/**
 * 套用档位：遍历档位表走状态层统一写口（默认广播 notify，面板订阅可自动刷新）。
 * custom / 未知档位 = 不套用（保持用户手调）；cap 缺席的派生路径静默跳过。
 */
export function applyPerfPreset(level: PerfLevel): void {
  const table = PERF_PRESETS[level as Exclude<PerfLevel, "custom">];
  if (!table) return;
  for (const [path, value] of Object.entries(table) as [PerfPath, number | boolean][]) {
    setStateValue(path, value);
  }
}

/** 切换档位：持久化 + 套用 */
export function setPerfPreset(level: PerfLevel): void {
  safeSet(PERF_PRESET_KEY, level);
  applyPerfPreset(level);
}
