// ===== preview-state.ts — [doc:adr-126-p4-a] 3D 预览全域状态层（升格自 ADR-125 P1）=====
//
// 血统：ADR-085 S2「状态单向流」只落了 bind 回写，未落统一状态源；ADR-125 P1 把这条
// 方向的「设置面板」落地了（settings-state.ts / 六项横切）。ADR-126 P4-A 把该模式
// 升格到「3D 预览全域」——本文件就是升格后的形态。
//
// 升格要点（与 ADR-126 §2.1「7 域类型全声明，binding 只填已落地项」校准对齐）：
//   - 模块名 / 类型名 / 快照函数名升格：SettingsPath→(并入 PreviewStatePath) /
//     SETTINGS_PATHS→KNOWN_PATHS / settingsSnapshot→previewSnapshot
//   - `PreviewStatePath`（ADR-129 第一刀归位自 adapters，ADR-168 二期下沉至
//     preview-paths.ts 契约叶子；本文件 re-export 保公共面）作为路径类型契约。
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
// [ADR-168] 状态层不 import 组合根单例（scene-capability-registry）——cap 查询走注入点
// setSceneCapabilityLookup（shared-infra createAll 后注入），断 preview-state→registry 运行时环。
import type { SceneCapability, SceneCapabilityLookup } from "@/preview-3d/caps/scene-capability.ts";
import { ringLog } from "@/preview-3d/caps/scene-capability.ts";
import { isFrustumCullEnabled, setFrustumCullEnabled } from "@/preview-3d/infra/frustum-cull.ts";
import {
  getMaxFps,
  getMaxPixelRatio,
  invalidateMaxFpsCache,
  MAX_FPS_DEFAULT,
  MAX_FPS_KEY,
  MAX_PIXEL_RATIO_KEY,
} from "@/preview-3d/infra/render-budget.ts";
import { safeSet } from "@/utils/base/primitives/storage.ts";
import type { PathInput, PathValue, PreviewSnapshot, PreviewStatePath } from "./preview-paths.ts";
// [ADR-168 二期] KNOWN_PATHS / PreviewStatePath / PreviewSnapshot 已下沉零依赖叶子
// preview-paths.ts（断 caps/scene-capability ⇄ preview-state 纯 type 环）：
// 本文件 import KNOWN_PATHS 供 bindings 注册 / previewSnapshot() 遍历，并 re-export
// 三件套保既有公共面——外部消费者（menu/caps/adapters）的 import 语句零改动。
// （re-export 拆值/类型两行：gen-knowledge-autogen 的 reRe 正则不识别花括号内 `type X`。）
import { KNOWN_PATHS } from "./preview-paths.ts";

export type { PathInput, PathValue, PreviewSnapshot, PreviewStatePath } from "./preview-paths.ts";
export { KNOWN_PATHS } from "./preview-paths.ts";

/**
 * 契约守卫：调用方路径必须落在 `PreviewStatePath` 的定义域内。
 * 路径前缀写错（如 `renderX.foo`）时本行编译失败——把「bind 无处可指」挡在编译期。
 * 升格后签名从 `(SettingsPath) => PreviewStatePath` 窄→宽 改为恒等函数
 * （类型层已是宽集合，调用点 `toStatePath(p)` 形态不变）。
 */
export function toStatePath(path: PreviewStatePath): PreviewStatePath {
  return path;
}

/**
 * 单路径读写绑定（值类型 V 精确参数化——binding 表内 get/set 类型对齐编译期校验）。
 * I = 写入输入域（控件基元联合，binding 内归一）；默认 I = V（精确路径自给自足）。
 */
interface PathBinding<V, I = V> {
  /** 读取当前值（cap 派生项在 cap 缺席时返回安全缺省） */
  get: () => V;
  /** 写入新值（cap 缺席时静默丢弃） */
  set: (v: I) => void;
  /** 该路径当前是否有真实来源；cap 派生项在 cap 缺席时 false，供 visible 守卫 */
  available: () => boolean;
}

/** 全路径绑定表：get 值类型由 PathValue 推导、set 输入域由 PathInput 推导——漏填/错填编译期报错 */
type PathBindingMap = { [K in PreviewStatePath]: PathBinding<PathValue[K], PathInput<K>> };

// ── cap 惰性解析（禁止在 schema 构建期捕获 cap 实例）──

/** [ADR-168] cap 查询器注入点：组合根（shared-infra buildSharedInfra）createAll 后注入
 *  registry 单例。状态层不 import 组合根（断 preview-state→registry 运行时环，与
 *  menu/core.ts getCap 透传范式同构）。空查询器 → capById undefined →
 *  binding available false——与「cap 缺席」同语义，行为等价。 */
let _capLookup: SceneCapabilityLookup | null = null;
export function setSceneCapabilityLookup(lookup: SceneCapabilityLookup | null): void {
  _capLookup = lookup;
}

function capById(id: string): SceneCapability | undefined {
  return _capLookup?.getById(id) ?? undefined;
}

/** [doc:adr-126-p4-d] 当前预览会话模式（shared/self）：menu/core.ts mount 入口同步一次，
 *  dock 级 visibleWhen 谓词经快照 `s["ui.mode"]` 读取——默认 shared（谓词缺省可见） */
let _uiMode: "shared" | "self" = "shared";

/** 同步会话模式到状态层（mountPreviewRootMenu 入口调用；每次 mount 覆盖，防会话/测试残留） */
export function setPreviewUiMode(mode: "shared" | "self"): void {
  _uiMode = mode;
}

/** 判断对象上是否存在指定方法（结构性探测，避免 as 硬转后的运行期炸裂） */
function hasMethod<T>(obj: unknown, name: keyof T): boolean {
  const bag = obj as unknown as Record<string, unknown> | null;
  return typeof bag?.[name as string] === "function";
}

/**
 * 惰性 cap 解析工厂（2026-09-14 收敛：envToggleCap/waterCap/groundMatCap/
 * wireframeModeCap 等同构函数抽此一处）——cap 缺席或任一方法不齐 → undefined；
 * 返回类型由 T 参数化，消费方零 cast。
 */
function lazyCap<T extends object>(id: string, ...methods: Array<keyof T>): T | undefined {
  const cap: SceneCapability | undefined = capById(id);
  if (!cap) return undefined;
  for (const m of methods) {
    if (!hasMethod<T>(cap, m)) return undefined;
  }
  return cap as unknown as T;
}

// [ADR-250] 原 `toggleCap`（isEnabled/setEnabled 开关型 cap 解析）已删除——
// 其唯一消费方 `render.bloom` 已退表（后处理开关归 envState.ppEnabled）。

/** 环境贴图开关型 cap（SkyCapability 的 PMREM 语义） */
interface EnvToggleCap {
  isEnvironmentEnabled(): boolean;
  setEnvironmentEnabled(v: boolean): void;
}

function envToggleCap(id: string): EnvToggleCap | undefined {
  return lazyCap<EnvToggleCap>(id, "isEnvironmentEnabled", "setEnvironmentEnabled");
}

/** [doc:adr-126-p5-c] 水面能力（读/写 mode）——供 env.waterMode 惰性绑定 */
interface WaterModeCap {
  getWaterMode(): string;
  setWaterMode(v: string): void;
}
function waterCap(): WaterModeCap | undefined {
  return lazyCap<WaterModeCap>("water", "getWaterMode", "setWaterMode");
}

/** [doc:adr-126-p5-c] 地面能力（读/写 来源轴+样式轴）——供 env.groundSourceKind / env.groundCanvasStyle 惰性绑定 */
interface GroundMatCap {
  getSourceKind(): string;
  setSourceKind(v: string): void;
  getCanvasStyle(): string;
  setCanvasStyle(v: string): void;
}
function groundMatCap(): GroundMatCap | undefined {
  return lazyCap<GroundMatCap>(
    "ground",
    "getSourceKind",
    "setSourceKind",
    "getCanvasStyle",
    "setCanvasStyle",
  );
}

/** 渲染模式线框能力（RenderModeCapability 的 wireframe 单项语义）——
 *  不走 toggleCap：RenderModeCapability.setEnabled 是空操作（各属性独立覆盖），
 *  isEnabled 返回「任一属性有 override」，与 wireframe 单项语义不符。
 *  真值源与 rm-wireframe 控件同口（getWireframe() === true / setWireframe(v ? true : null)）。 */
interface WireframeModeCap {
  getWireframe(): boolean | null;
  setWireframe(v: boolean | null): void;
}
function wireframeModeCap(): WireframeModeCap | undefined {
  return lazyCap<WireframeModeCap>("renderMode", "getWireframe", "setWireframe");
}

/** 路径 → 读写绑定表（模块级常量；cap 解析全部惰性，不持有实例）
 *  类型用窄联合（`typeof KNOWN_PATHS[number]`）而非 `PreviewStatePath` 全集——
 *  保证"加新路径"必须先扩 `KNOWN_PATHS` + 填 binding，类型层守住"调用方永不传未落地项" */
// 值类型精确化——每键 get/set 参数经 PathValue[K] 编译期对齐
//（maxFps/maxPixelRatio 的 set 接受 number|string 归一，get 返回 number 子集；
// ui.mode 的 set 归一守卫接受 string，get 返回 "shared"|"self" 子集）
const bindings: PathBindingMap = {
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
  //   与 cap 自报控件同源：wireframe-toggle / sky-env
  // [ADR-250] `render.bloom` 已退场——后处理是视觉项，与 wireframe/pmrem 同类不进性能档位表。
  // 历史：该路径经 setMasterEnabled 写 cap 私有总闸字段，与 per-type 门禁二元相与，
  // 构成「一枚字段三重语义」，且档位切换会覆盖用户手动开关。现后处理开关唯一入口 = `pp-enabled`。
  // [幽灵船收口 2026-09] render.wireframe 原绑定指向 WireframeCapability——该 cap 从未注册
  // （scene-capability-registry 无 wireframe 工厂），toggleCap("wireframe") 恒 undefined →
  // available() 永远 false 死链。真身是 RenderModeCapability.rm-wireframe（settingsOrder:30）。
  // 现绑定改走 renderMode 的 getWireframe/setWireframe 专用口（同 rm-wireframe 控件真值源）。
  "render.wireframe": {
    get: () => wireframeModeCap()?.getWireframe() === true,
    set: (v) => wireframeModeCap()?.setWireframe(v ? true : null),
    available: () => wireframeModeCap() !== undefined,
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
  "env.groundSourceKind": {
    get: () => groundMatCap()?.getSourceKind() ?? "none",
    set: (v) => groundMatCap()?.setSourceKind(String(v)),
    available: () => groundMatCap() !== undefined,
  },
  "env.groundCanvasStyle": {
    get: () => groundMatCap()?.getCanvasStyle() ?? "plain",
    set: (v) => groundMatCap()?.setCanvasStyle(String(v)),
    available: () => groundMatCap() !== undefined,
  },
  // [doc:adr-126-p4-d] 会话模式：mount 期写一次（setPreviewUiMode），dock 级 visibleWhen
  // 谓词写 `(s) => s["ui.mode"] !== "self"` 与旧 hideInSelfMode 语义等价
  "ui.mode": {
    get: () => _uiMode,
    set: (v) => {
      _uiMode = v === "self" ? "self" : "shared";
    },
    available: () => true,
  },
  // [doc:adr-126-p4-d] 环境能力可用性：sky/ground cap 任一挂载（requiresEnvironment 语义）。
  // 惰性经 ADR-168 lookup 注入点——与 ctx.getCap 同源，caps 后创建由 shared-infra refreshDock 补回
  "env.skyGroundCap": {
    get: () => !!(capById("sky") || capById("ground")),
    set: () => {},
    available: () => !!(capById("sky") || capById("ground")),
  },
};

// ── 订阅（供后续取代 05fe24b7 的手工 refresh 链路）──

type PreviewStateListener = (changed: (typeof KNOWN_PATHS)[number]) => void;
const listeners = new Set<PreviewStateListener>();

/**
 * 订阅横切设置变更；返回取消订阅函数。
 * 生产侧暂无消费方（横切设置控件走 getValue/setValue 自身读写 + cap.subscribe 局部刷新）。
 * 预留：setStateValue 已按「仅成功广播」实现，接入方（如跨 cap 联动、面板自动重算）
 * 可直接订阅而不必轮询快照。dispose 语义由接入方自持 off 处理。
 */
export function subscribeSettings(listener: PreviewStateListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 通知变更（离散操作调用；高频滑块拖动请传 `{ notify: false }` 给 setStateValue） */
function notify(changed: (typeof KNOWN_PATHS)[number]): void {
  for (const l of [...listeners]) {
    try {
      l(changed);
    } catch (e) {
      ringLog("preview-state", "订阅回调异常", "warn", () => {
        console.warn("[preview-state] 订阅回调异常:", e);
      });
    }
  }
}

// ── 对外 API ──

/** 读取路径当前值（窄类型：仅接受已落地的 KNOWN_PATHS 之一；返回类型按 PathValue 精确映射） */
export function getStateValue<P extends PreviewStatePath>(path: P): PathValue[P] {
  return bindings[path].get();
}

/**
 * 写入路径值（输入域 PathInput[P] = 精确类型 ∪ 控件基元——泛型控件层
 * setValue(v: number | string | boolean) 可交付任意基元，binding 归一；
 * 比 unknown 严：object/undefined 编译报错）。
 * @param opts.notify 是否广播变更；默认 true。滑块 `oninput` 高频写入传 false，
 *   避免每像素触发面板重算（沿用 SceneCapability.subscribe 的「仅离散操作通知」约定）。
 */
export function setStateValue<P extends PreviewStatePath>(
  path: P,
  value: PathInput<P>,
  opts?: { notify?: boolean },
): void {
  // cap set 可能抛错（cap 缺失、内部状态异常）；
  // 仅成功时才 notify，避免订阅者读旧值却以为新值已变更（状态层与 cap 实际状态分叉）。
  let success = false;
  try {
    bindings[path].set(value);
    success = true;
  } catch (e) {
    ringLog("preview-state", `setStateValue("${path}") failed`, "warn", () => {
      console.warn(`[preview-state] setStateValue("${path}") failed:`, e);
    });
  }
  if (success && opts?.notify !== false) notify(path);
}

/** 该路径当前是否有真实来源（cap 派生项在 cap 未创建时为 false） */
export function isPathAvailable(path: (typeof KNOWN_PATHS)[number]): boolean {
  return bindings[path].available();
}

/**
 * 全量快照：供 `visibleWhen: (s) => boolean` 等纯函数谓词消费。
 * 返回 PreviewSnapshot（每键值类型经 PathValue 精确映射）——谓词写
 * `s["env.waterMode"] === "film"` 走 string 比较，类型守卫天然正确。
 */
export function previewSnapshot(): PreviewSnapshot {
  // 逐键写入经宽松中间形态（循环变量 p 为联合类型，无法逐键精确赋值），
  // 出口 cast 到 PreviewSnapshot——bindings 已按 PathBindingMap 校验，每键 get 类型对齐
  const out = {} as Record<PreviewStatePath, unknown>;
  for (const p of KNOWN_PATHS) out[p] = bindings[p].get();
  return out as PreviewSnapshot;
}

/** 测试用：清空全部订阅者（listener 集合隔离，防止用例间串扰） */
export function resetSettingsListeners(): void {
  listeners.clear();
}
