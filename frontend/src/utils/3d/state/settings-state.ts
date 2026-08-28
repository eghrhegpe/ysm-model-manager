// ===== settings-state.ts — [doc:adr-125] 3D 预览横切设置统一状态层（P1）=====
//
// 背景：ADR-085 S2「状态单向流」只落了 bind 回写，未落统一状态源，导致横切设置项
// （视锥裁剪 / 帧率 / 分辨率）各有独立读写通道（模块函数 + 两个 localStorage 键），
// 跨 cap 项（bloom / pmrem / wireframe）只能伸手直调 cap。没有统一状态层，
// 声明式 Schema 的 `control.bind: PreviewStatePath` 就是死代码。
//
// 本层职责：
//   1. 给全部横切设置项一个 `path` 读写口（getStateValue / setStateValue）
//   2. cap 派生路径惰性解析 cap——cap 缺席时 available()=false，不在构建期冻结
//      （对应 ADR-125 P3 明令禁止的 `if (cap)` 声明期求值反例）
//   3. 订阅通知，供后续把 05fe24b7 的手工 refresh 链路降级为「状态变更自动重算」
//
// 持久化边界（ADR-125 P1，防双写）：
//   - 三项真正无 cap 归属的横切项由本层读写 localStorage，键名与迁移前完全一致
//   - bloom / pmrem / wireframe 走 cap 的 get/set 派生映射，本层不落盘；
//     cap 存自己的域（cap.saveState），本层不重复存

import type { PreviewStatePath } from "../adapters/preview-menu-node-types.ts";
import { sceneCapabilityRegistry } from "../caps/scene-capability-registry.ts";
import type { SceneCapability } from "../caps/scene-capability.ts";
import { isFrustumCullEnabled, setFrustumCullEnabled } from "../frustum-cull.ts";
import {
  getMaxFps,
  invalidateMaxFpsCache,
  MAX_FPS_KEY,
  getMaxPixelRatio,
  MAX_PIXEL_RATIO_KEY,
} from "../render-budget.ts";
import { safeSet } from "../../dom/storage.ts";

/** 本层托管的横切设置路径（ADR-125 P1 收编六项） */
export type SettingsPath =
  | "render.frustumCull"
  | "render.maxFps"
  | "render.maxPixelRatio"
  | "render.bloom"
  | "render.wireframe"
  | "env.pmrem";

/** 全部受管路径（供契约测试枚举 / 快照遍历） */
export const SETTINGS_PATHS: readonly SettingsPath[] = [
  "render.frustumCull",
  "render.maxFps",
  "render.maxPixelRatio",
  "render.bloom",
  "render.wireframe",
  "env.pmrem",
];

/**
 * 契约守卫：SettingsPath 必须落在 `PreviewStatePath` 的定义域内。
 * 路径前缀写错（如 `renderX.foo`）时本行编译失败——把「bind 无处可指」挡在编译期。
 */
export function toStatePath(path: SettingsPath): PreviewStatePath {
  return path;
}

/** 单个路径的读写绑定（模块内使用；不外导，避免 knip 判为无引用导出） */
interface SettingsPathBinding {
  /** 读取当前值（cap 派生项在 cap 缺席时返回安全缺省） */
  get: () => unknown;
  /** 写入新值（cap 缺席时静默丢弃） */
  set: (v: unknown) => void;
  /** 该路径当前是否有真实来源；cap 派生项在 cap 缺席时 false，供 visible 守卫 */
  available: () => boolean;
}

// ── cap 惰性解析（禁止在 schema 构建期捕获 cap 实例）──

/** 判断对象上是否存在指定方法（结构性探测，避免 as 硬转后的运行期炸裂） */
function hasMethod<T>(obj: unknown, name: keyof T): boolean {
  const bag = obj as unknown as Record<string, unknown> | null;
  return typeof bag?.[name as string] === "function";
}

/** 带 isEnabled/setEnabled 的开关型 cap */
interface ToggleCap {
  isEnabled(): boolean;
  setEnabled(v: boolean): void;
}

function toggleCap(id: string): ToggleCap | undefined {
  const cap: SceneCapability | undefined = sceneCapabilityRegistry.getById(id);
  if (!cap) return undefined;
  if (!hasMethod<ToggleCap>(cap, "isEnabled") || !hasMethod<ToggleCap>(cap, "setEnabled")) {
    return undefined;
  }
  return cap as unknown as ToggleCap;
}

/** 环境贴图开关型 cap（SkyCapability 的 PMREM 语义） */
interface EnvToggleCap {
  isEnvironmentEnabled(): boolean;
  setEnvironmentEnabled(v: boolean): void;
}

function envToggleCap(id: string): EnvToggleCap | undefined {
  const cap: SceneCapability | undefined = sceneCapabilityRegistry.getById(id);
  if (!cap) return undefined;
  if (
    !hasMethod<EnvToggleCap>(cap, "isEnvironmentEnabled") ||
    !hasMethod<EnvToggleCap>(cap, "setEnvironmentEnabled")
  ) {
    return undefined;
  }
  return cap as unknown as EnvToggleCap;
}

/** 路径 → 读写绑定表（模块级常量；cap 解析全部惰性，不持有实例） */
const bindings: Record<SettingsPath, SettingsPathBinding> = {
  // ── 横切项：无 cap 归属，本层直管持久化 ──
  "render.frustumCull": {
    get: () => isFrustumCullEnabled(),
    set: (v) => setFrustumCullEnabled(Boolean(v)),
    available: () => true,
  },
  "render.maxFps": {
    get: () => getMaxFps(),
    set: (v) => {
      const n = Number(v);
      safeSet(MAX_FPS_KEY, String(Number.isFinite(n) ? n : 0));
      invalidateMaxFpsCache(); // rAF 热路径有模块级缓存，必须显式失效
    },
    available: () => true,
  },
  "render.maxPixelRatio": {
    get: () => getMaxPixelRatio(),
    set: (v) => {
      const n = Number(v);
      safeSet(MAX_PIXEL_RATIO_KEY, String(Number.isFinite(n) ? n : 1.5));
    },
    available: () => true,
  },
  // ── cap 派生项：走 get/set 映射，本层不落盘（cap 存自己的域）──
  //   与 cap 自报控件同源：pp-enabled / wireframe-toggle / sky-env
  "render.bloom": {
    get: () => toggleCap("postprocessing")?.isEnabled() ?? false,
    set: (v) => toggleCap("postprocessing")?.setEnabled(Boolean(v)),
    available: () => toggleCap("postprocessing") !== undefined,
  },
  "render.wireframe": {
    get: () => toggleCap("wireframe")?.isEnabled() ?? false,
    set: (v) => toggleCap("wireframe")?.setEnabled(Boolean(v)),
    available: () => toggleCap("wireframe") !== undefined,
  },
  "env.pmrem": {
    get: () => envToggleCap("sky")?.isEnvironmentEnabled() ?? false,
    set: (v) => envToggleCap("sky")?.setEnvironmentEnabled(Boolean(v)),
    available: () => envToggleCap("sky") !== undefined,
  },
};

// ── 订阅（供后续取代 05fe24b7 的手工 refresh 链路）──

type SettingsListener = (changed: SettingsPath) => void;
const listeners = new Set<SettingsListener>();

/** 订阅横切设置变更；返回取消订阅函数 */
export function subscribeSettings(listener: SettingsListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 通知变更（离散操作调用；高频滑块拖动请传 `{ notify: false }` 给 setStateValue） */
function notify(changed: SettingsPath): void {
  for (const l of [...listeners]) {
    try {
      l(changed);
    } catch (e) {
      console.warn("[settings-state] 订阅回调异常:", e);
    }
  }
}

// ── 对外 API ──

/** 读取路径当前值 */
export function getStateValue(path: SettingsPath): unknown {
  return bindings[path].get();
}

/**
 * 写入路径值。
 * @param opts.notify 是否广播变更；默认 true。滑块 `oninput` 高频写入传 false，
 *   避免每像素触发面板重算（沿用 SceneCapability.subscribe 的「仅离散操作通知」约定）。
 */
export function setStateValue(
  path: SettingsPath,
  value: unknown,
  opts?: { notify?: boolean },
): void {
  bindings[path].set(value);
  if (opts?.notify !== false) notify(path);
}

/** 该路径当前是否有真实来源（cap 派生项在 cap 未创建时为 false） */
export function isPathAvailable(path: SettingsPath): boolean {
  return bindings[path].available();
}

/** 全量快照：供 `visibleWhen: (s) => boolean` 等纯函数谓词消费 */
export function settingsSnapshot(): Record<SettingsPath, unknown> {
  const out = {} as Record<SettingsPath, unknown>;
  for (const p of SETTINGS_PATHS) out[p] = bindings[p].get();
  return out;
}

/** 测试用：清空全部订阅者（listener 集合隔离，防止用例间串扰） */
export function resetSettingsListeners(): void {
  listeners.clear();
}
