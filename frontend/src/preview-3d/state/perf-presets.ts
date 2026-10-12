// ===== perf-presets.ts — 3D 预览性能档位（薄壳版：数据表 + 通用套用器）=====
// ADR-126 P4 系列延续：档位 = 纯数据表（StatePath → 值），套用走状态层统一写口。
// 新增档位只改表，零代码接线；新增参数需同步扩 KNOWN_PATHS + 填 preview-state binding——
// 刻意规避隔壁 MikuMikuAR 的坑（每个模式手写参数映射 + SetPerformanceMode 走 Go 绑定
// + custom 档需手动 reRender 面板）。
//
// 范围（薄壳版一期）：只控「有状态层路径」的性能项——帧率 / 分辨率。
//  - wireframe / skyIblSelfHold / **bloom** 是视觉项不进档位表；frustumCull 是纯优化（无画质损失）恒开不进表
//    [ADR-250] bloom 原在表中（low=false / medium=high=true），经 setMasterEnabled 写 cap 私有总闸，
//    与 per-type 门禁二元相与造成「一枚字段三重语义」+ 档位覆盖用户手动开关，现已退表。
//  - custom = 不套用（保持用户手调）

import { safeGet, safeSet } from "@/utils/base/primitives/storage.ts";
import type { PreviewStatePath } from "./preview-paths.ts";
import { setStateValue } from "./preview-state.ts";

/** 性能档位：低 / 中 / 高 + 自定义（自定义不套用，保持用户手调） */
export type PerfLevel = "low" | "medium" | "high" | "custom";

/** 持久化键：当前档位（对齐 ysm_3d_maxFps 风格） */
export const PERF_PRESET_KEY = "ysm_3d_perfPreset";

/** 无存档时的默认档位 */
export const PERF_PRESET_DEFAULT: PerfLevel = "medium";

/** 档位表：三档 → StatePath → 值（纯数据，新增档位只改这里；新增参数需同步扩 KNOWN_PATHS + 填 binding） */
export const PERF_PRESETS: Record<
  Exclude<PerfLevel, "custom">,
  Partial<Record<PreviewStatePath, number | boolean>>
> = {
  low: {
    "render.maxFps": 30,
    "render.maxPixelRatio": 0.75,
  },
  medium: {
    "render.maxFps": 60,
    "render.maxPixelRatio": 1.0,
  },
  high: {
    "render.maxFps": 120,
    "render.maxPixelRatio": 1.5,
  },
};

/** 读取当前档位（无存档或未知值回默认） */
export function getPerfPreset(): PerfLevel {
  const v = safeGet(PERF_PRESET_KEY);
  return v === "low" || v === "medium" || v === "high" || v === "custom" ? v : PERF_PRESET_DEFAULT;
}

/**
 * 套用档位：遍历档位表走状态层统一写口（默认广播 notify，面板订阅可自动刷新）。
 * custom / 未知档位 = 不套用（保持用户手调）；cap 缺席的派生路径静默跳过。
 */
export function applyPerfPreset(level: PerfLevel): void {
  const table = PERF_PRESETS[level as Exclude<PerfLevel, "custom">];
  if (!table) return;
  for (const [path, value] of Object.entries(table) as [PreviewStatePath, number | boolean][]) {
    setStateValue(path, value);
  }
}

/** 切换档位：持久化 + 套用 */
export function setPerfPreset(level: PerfLevel): void {
  safeSet(PERF_PRESET_KEY, level);
  _ssrScaleCache = null; // 档位变更 → SSR 缩放缓存失效（模块级缓存纪律，对齐 getMaxFps 范式）
  applyPerfPreset(level);
}

/**
 * SSR 反射缓冲缩放（`SSRPass.resolutionScale` 的档位派生值）。
 *
 * [2026-10-12] 上游 `SSRPass` 本就提供 `resolutionScale`（默认 1 = 全分辨率），本仓此前
 * 从未启用。它**只降 SSR 自己的三张缓冲**（`ssrRenderTarget`/`prevRenderTarget`/两张 blur），
 * `beauty`/`normal`/`metalness` 保持全分辨率——**主渲染完全不受影响**，与「全屏降分辨率」
 * 的霰弹枪方案有本质区别。
 *
 * 为什么这是**精准**旋钮：`SSRPass.setSize` 内
 * `MAX_STEP = √(w² + h²)`（`SSRPass.js`）——SSR 的射线步进数正比于**屏幕对角线**，
 * 故分辨率是 SSR 成本的主因子；缩小反射缓冲同时砍掉步进数与三张缓冲的显存。
 *
 * 为何不做用户旋钮：SSR 是**近似反射**，缩放在视觉上属「可接受的精度取舍」而非功能开关，
 * 与 `maxFps`/`maxPixelRatio` 同属性能项 → 归口档位表，不另立 UI（避免第七个旋钮的
 * 七处接线）。`custom` 档位（用户手调）取 `high` 值：不擅自替用户降质。
 *
 * ⚠️ 消费点必须在**建 pass / setSize 时**读（`resolutionScale` 只在那两处生效），
 * 不得进 rAF 热路径。
 */
const SSR_SCALE_BY_LEVEL: Record<Exclude<PerfLevel, "custom">, number> = {
  low: 0.5,
  medium: 0.75,
  high: 1,
};

let _ssrScaleCache: number | null = null;

/** 取当前档位对应的 SSR 反射缓冲缩放（0.5–1；模块级缓存，档位变更加载时失效）。 */
export function getSsrResolutionScale(): number {
  if (_ssrScaleCache !== null) return _ssrScaleCache;
  const level = getPerfPreset();
  // custom = 用户手调档：按「不擅自降质」取 high（1.0 全分辨率）
  const v = level === "custom" ? 1 : SSR_SCALE_BY_LEVEL[level];
  _ssrScaleCache = v;
  return v;
}

/** 测试钩子：清 SSR 缩放缓存（生产由 setPerfPreset 失效，测试直写 localStorage 后需手动清）。 */
export function __resetSsrScaleCacheForTest(): void {
  _ssrScaleCache = null;
}
