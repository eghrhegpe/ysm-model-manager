// ===== preview-state.ts — [doc:adr-126-p4-a] 3D 预览全域状态层（升格自 ADR-125 P1）=====
//
// 血统：ADR-085 S2「状态单向流」只落了 bind 回写，未落统一状态源；ADR-125 P1 把这条
// 方向的「设置面板」落地了（settings-state.ts / 六项横切）。ADR-126 P4-A 把该模式
// 升格到「3D 预览全域」——本文件就是升格后的形态。
//
// 升格要点（与 ADR-126 §2.1「7 域类型全声明，binding 只填已落地项」校准对齐）：
//   - 模块名 / 类型名 / 快照函数名升格：SettingsPath→(并入 PreviewStatePath) /
//     SETTINGS_PATHS→KNOWN_PATHS / settingsSnapshot→previewSnapshot
//   - `PreviewStatePath`（本文件定义，ADR-129 第一刀归位自 adapters）作为路径类型契约：
//     七域（env/render/light/ui/perception/motion/model）类型层全声明；
//     本文件 binding 层只填**已落地的 6 项**（render.*/env.* 横切设置）。
//   - 业务状态（角色/动作/面板导航）由 sceneRegistry / SlideMenuHandle / 节点字段
//     各有归宿——不重复造轮，避免双源。后续 P4-C 拆 dockGroup 时按需加
//     `ui.activePanel`、P4-D 谓词化时按需加 model/motion 域 binding。
//   - 公共函数名（getStateValue/setStateValue/subscribeSettings/isPathAvailable/
//     resetSettingsListeners/toStatePath）保持稳定——通用名跨子步复用，零额外回归。
//
// 职责（与 ADR-125 P1 一致，本文件继承）：
//   1. 给已落地的横切设置项一个 `path` 读写口（getStateValue / setStateValue）
//   2. cap 派生路径惰性解析 cap——cap 缺席时 available()=false，不在构建期冻结
//      （对应 ADR-125 P3 明令禁止的 `if (cap)` 声明期求值反例）
//   3. 订阅通知，供后续把 05fe24b7 的手工 refresh 链路降级为「状态变更自动重算」
//
// 持久化边界（ADR-125 P1，防双写，本文件继承）：
//   - 三项真正无 cap 归属的横切项由本层读写 localStorage，键名与迁移前完全一致
//   - bloom / pmrem / wireframe 走 cap 的 get/set 派生映射，本层不落盘；
//     cap 存自己的域（cap.saveState），本层不重复存

// [doc:adr-129-第一刀] 状态层核心类型本位（修依赖倒置：原住 adapters 平铺的 preview-menu-node-types.ts，
// state 反向 import adapters → 类型归位 state，adapters 反过来前向 import state，方向正）
import { sceneCapabilityRegistry } from "../caps/scene-capability-registry.ts";
import type { SceneCapability } from "../caps/scene-capability.ts";
import { isFrustumCullEnabled, setFrustumCullEnabled } from "../frustum-cull.ts";
import {
  getMaxFps,
  invalidateMaxFpsCache,
  MAX_FPS_KEY,
  MAX_FPS_DEFAULT,
  getMaxPixelRatio,
  MAX_PIXEL_RATIO_KEY,
} from "../render-budget.ts";
import { safeSet } from "../../utils/dom/storage.ts";

/**
 * 本层已落地的横切设置路径（ADR-125 P1 收编六项，ADR-126 P4-A 升格为 KNOWN_PATHS 命名）。
 *
 * 2026-09 收紧：`PreviewStatePath` 类型 = 本集合（类型契约即运行时实现）。
 * 原「7 域模板字面量宽类型」让未落地键（如 ui.mode / env.sky）在类型层合法、
 * 运行时却恒 undefined——谓词读它们静默假死。现未落地键在编译期即报错：
 * 新增路径必须「扩 KNOWN_PATHS + 填 binding」两步走，缺一步编译不过。
 */
export const KNOWN_PATHS = [
  "render.frustumCull",
  "render.maxFps",
  "render.maxPixelRatio",
  "render.bloom",
  "render.wireframe",
  "env.pmrem",
  // [doc:adr-126-p5-c] 探针：cap 内部状态上浮至状态层快照，供 cap 控件
  // visibleWhen(s) 谓词消费（替代 cap 内 visible? 闭包），打通 B 轨。
  "env.waterMode",
  "env.groundMatSource",
  // [doc:adr-126-p5-b] 组件选择（YSM 多组件模型）：-1 = All，其余 = 组件下标。
  // 会话态不落盘；面板侧 subscribe 变更 → 调 showModelGroup 副作用（views 层装配）。
  "ui.activeComponent",
] as const;

/**
 * 状态路径：已落地路径的联合（类型契约 = 运行时实现）。
 * 写未落地键（如 `ui.mode` / `env.sky`）编译报错——把「谓词读黑洞键静默假死」
 * 挡在编译期。新路径两步走：扩 KNOWN_PATHS + 填 bindings。
 */
export type PreviewStatePath = typeof KNOWN_PATHS[number];

/**
 * 状态层快照：`visibleWhen: (s: PreviewSnapshot) => boolean` 纯函数谓词吃的快照形状。
 * 由本文件 `previewSnapshot()` 产出（Record<PreviewStatePath, unknown>）。
 * 键位 = KNOWN_PATHS（全部有真实来源，无黑洞键）。
 * [doc:adr-126-p4-d] 与 AGENTS.md「3d菜单只允许 visibleWhen: (s) => boolean」对齐。
 */
export type PreviewSnapshot = Record<PreviewStatePath, unknown>;

/**
 * 契约守卫：调用方路径必须落在 `PreviewStatePath` 的定义域内。
 * 路径前缀写错（如 `renderX.foo`）时本行编译失败——把「bind 无处可指」挡在编译期。
 * 升格后签名从 `(SettingsPath) => PreviewStatePath` 窄→宽 改为恒等函数
 * （类型层已是宽集合，调用点 `toStatePath(p)` 形态不变）。
 */
export function toStatePath(path: PreviewStatePath): PreviewStatePath {
  return path;
}

/** 单个路径的读写绑定（模块内使用；不外导，避免 knip 判为无引用导出） */
interface PreviewStatePathBinding {
  /** 读取当前值（cap 派生项在 cap 缺席时返回安全缺省） */
  get: () => unknown;
  /** 写入新值（cap 缺席时静默丢弃） */
  set: (v: unknown) => void;
  /** 该路径当前是否有真实来源；cap 派生项在 cap 缺席时 false，供 visible 守卫 */
  available: () => boolean;
}

// ── cap 惰性解析（禁止在 schema 构建期捕获 cap 实例）──

/** [doc:adr-126-p5-b] 当前选中组件（会话态内存值）：-1 = All，其余 = 组件下标 */
let _activeComponent = -1;

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

/** [doc:adr-126-p5-c] 水面能力（读/写 mode）——供 env.waterMode 惰性绑定 */
interface WaterModeCap {
  getWaterMode(): string;
  setWaterMode(v: string): void;
}
function waterCap(): WaterModeCap | undefined {
  const cap: SceneCapability | undefined = sceneCapabilityRegistry.getById("water");
  if (!cap) return undefined;
  if (!hasMethod<WaterModeCap>(cap, "getWaterMode") || !hasMethod<WaterModeCap>(cap, "setWaterMode")) {
    return undefined;
  }
  return cap as unknown as WaterModeCap;
}

/** [doc:adr-126-p5-c] 地面能力（读/写 matSource）——供 env.groundMatSource 惰性绑定 */
interface GroundMatCap {
  getMatSource(): string;
  setMatSource(v: string): void;
}
function groundMatCap(): GroundMatCap | undefined {
  const cap: SceneCapability | undefined = sceneCapabilityRegistry.getById("ground");
  if (!cap) return undefined;
  if (!hasMethod<GroundMatCap>(cap, "getMatSource") || !hasMethod<GroundMatCap>(cap, "setMatSource")) {
    return undefined;
  }
  return cap as unknown as GroundMatCap;
}

/** 路径 → 读写绑定表（模块级常量；cap 解析全部惰性，不持有实例）
 *  类型用窄联合（`typeof KNOWN_PATHS[number]`）而非 `PreviewStatePath` 全集——
 *  保证"加新路径"必须先扩 `KNOWN_PATHS` + 填 binding，类型层守住"调用方永不传未落地项" */
const bindings: Record<typeof KNOWN_PATHS[number], PreviewStatePathBinding> = {
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
      // 与 getMaxFps 守卫语义对齐：非法/负数 → 安全缺省 60（而非 0=不限，0 会静默关闭节流）；
      // 0 仍是合法值（不限帧率）。写入什么、读回什么、缺省什么三方一致。
      safeSet(MAX_FPS_KEY, String(Number.isFinite(n) && n >= 0 ? n : MAX_FPS_DEFAULT));
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
    set: (v) => {
      const cap = toggleCap("postprocessing");
      if (!cap) return;
      // 性能档位只做「总闸」：render.bloom=false 关闭全部（低档保性能）；
      // =true 不强制打开 —— 尊重 per-type 预设设为关闭的类型（方块/体素/光影包），
      // 根治「medium 默认强制全类型开 Bloom → YSM/车万女仆爆亮」的越权。
      // 最终开关 = 总闸(render.bloom) && per-type 门禁(params.enabled)，手动开关不受此限。
      // 经 setMasterEnabled 只写生效开关、不抹 per-type 门禁（总闸 off→on 循环可恢复）；
      // 缺 setMasterEnabled/getParams（旧实现/测试 fake）时结构化回退旧语义 setEnabled(Boolean(v))，
      // 不做硬转——hasMethod 模式防运行期炸裂。
      const master = cap as unknown as {
        getParams?: () => { enabled: boolean };
        setMasterEnabled?: (v: boolean) => void;
      };
      if (master.setMasterEnabled) {
        master.setMasterEnabled(Boolean(v) ? (master.getParams?.()?.enabled ?? true) : false);
      } else {
        cap.setEnabled(Boolean(v));
      }
    },
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
  // [doc:adr-126-p5-c] 探针：cap 内部状态上浮——water.mode / ground.matSource。
  // 惰性解析（cap 缺席时 available=false、get 安全缺省），不持有实例、不落盘。
  "env.waterMode": {
    get: () => waterCap()?.getWaterMode() ?? "film",
    set: (v) => waterCap()?.setWaterMode(String(v)),
    available: () => waterCap() !== undefined,
  },
  "env.groundMatSource": {
    get: () => groundMatCap()?.getMatSource() ?? "none",
    set: (v) => groundMatCap()?.setMatSource(String(v)),
    available: () => groundMatCap() !== undefined,
  },
  // ── 会话态：不落盘（非持久化偏好）──
  //   [doc:adr-126-p5-b] 组件选择（YSM 多组件模型）：-1 = All，其余 = 组件下标。
  //   副作用（showModelGroup）由面板侧 subscribe 装配——本层只存值 + 广播。
  "ui.activeComponent": {
    get: () => _activeComponent,
    set: (v) => {
      const n = Number(v);
      _activeComponent = Number.isFinite(n) ? n : -1;
    },
    available: () => true,
  },
};

/** 重置会话态组件选择（预览 dispose/重建时调用；-1 = All）。
 *  [doc:adr-126-p5] _activeComponent 是模块级会话值，跨预览泄漏——不重置则下一个模型
 *  读陈旧下标，越界组件 → stats 聚合错 + select 无匹配项（P5-A review P2） */
export function resetActiveComponent(): void {
  _activeComponent = -1;
}

// ── 订阅（供后续取代 05fe24b7 的手工 refresh 链路）──

type PreviewStateListener = (changed: typeof KNOWN_PATHS[number]) => void;
const listeners = new Set<PreviewStateListener>();

/** 订阅横切设置变更；返回取消订阅函数 */
export function subscribeSettings(listener: PreviewStateListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 通知变更（离散操作调用；高频滑块拖动请传 `{ notify: false }` 给 setStateValue） */
function notify(changed: typeof KNOWN_PATHS[number]): void {
  for (const l of [...listeners]) {
    try {
      l(changed);
    } catch (e) {
      console.warn("[preview-state] 订阅回调异常:", e);
    }
  }
}

// ── 对外 API ──

/** 读取路径当前值（窄类型：仅接受已落地的 KNOWN_PATHS 之一） */
export function getStateValue(path: typeof KNOWN_PATHS[number]): unknown {
  return bindings[path].get();
}

/**
 * 写入路径值。
 * @param opts.notify 是否广播变更；默认 true。滑块 `oninput` 高频写入传 false，
 *   避免每像素触发面板重算（沿用 SceneCapability.subscribe 的「仅离散操作通知」约定）。
 */
export function setStateValue(
  path: typeof KNOWN_PATHS[number],
  value: unknown,
  opts?: { notify?: boolean },
): void {
  // cap set 可能抛错（cap 缺失、内部状态异常）；
  // 不包 try/catch 时异常直接传播，notify 不执行，订阅者收不到变更通知
  try {
    bindings[path].set(value);
  } catch (e) {
    console.warn(`[preview-state] setStateValue("${path}") failed:`, e);
  }
  if (opts?.notify !== false) notify(path);
}

/** 该路径当前是否有真实来源（cap 派生项在 cap 未创建时为 false） */
export function isPathAvailable(path: typeof KNOWN_PATHS[number]): boolean {
  return bindings[path].available();
}

/**
 * 全量快照：供 `visibleWhen: (s) => boolean` 等纯函数谓词消费。
 * 返回 PreviewSnapshot（Record<PreviewStatePath, unknown>）——七域键位都可能在
 * （未落地项为 undefined），谓词写 `s["ui.mode"] === "self"` 安全（取到 undefined 自然为 falsy）。
 */
export function previewSnapshot(): PreviewSnapshot {
  const out = {} as Record<PreviewStatePath, unknown>;
  for (const p of KNOWN_PATHS) out[p] = bindings[p].get();
  return out;
}

/** 测试用：清空全部订阅者（listener 集合隔离，防止用例间串扰） */
export function resetSettingsListeners(): void {
  listeners.clear();
}
