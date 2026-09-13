// ===== 场景能力统一接口（ADR-073 扩展：能力注册表驱动）=====
// 所有场景能力（Sky/Ground/Light/后续 Fog/Shadow/Reflection 等）实现本接口，
// 由 scene-capability-registry 自动发现并注入菜单，新增能力只需：
//   1. 实现 SceneCapability 接口
//   2. 在 registry.add() 注册一行
// 菜单/持久化/生命周期全部由框架驱动，零手工 wiring。

import { safeGet, safeSet } from "@/utils/base/primitives/storage.ts";
import type { EnvironmentCapability } from "./environment-capability.ts";
import type { FogCapability } from "./fog-capability.ts";
import type { GroundCapability } from "./ground-capability.ts";
import type { LightCapability } from "./light-capability.ts";
import type { PostprocessingCapability } from "./postprocessing-capability.ts";
import type { ReflectorCapability } from "./reflector-capability.ts";
import type { RenderModeCapability } from "./render-mode-capability.ts";
import type { ShadowCapability } from "./shadow-capability.ts";
// 能力类型统一顶层 type import（动态 import 仅在类型位置引用无运行时意义；
// 且 render-mode 静态回引本文件 → 动态引用成环，check-circular 卡 CI。type-only 编译期擦除破环）
import type { SkyCapability } from "./sky-capability.ts";
import type { WaterCapability } from "./water-capability.ts";

// [ADR-195 刀2] 控件类型下沉 preview-3d/menu-node-types.ts
// （共享类型叶，menu/ 与 caps/ 双域引用，破 caps→menu 纯类型环）——本文件 re-export
// 保既有公共面（caps/*、menu/*、adapters/*、state/* 的 import 语句零改动）。
// [ADR-195 刀3] 类型更名收敛：旧控件类型 → PreviewControlDef / PreviewControlKind
// （旧名消除，控件声明单类型化）。
// 注：re-export 不提供本模块内可用绑定，故下方另 type-import 供工厂内部引用。
export type {
  PreviewControlDef,
  PreviewControlKind,
} from "@/preview-3d/menu/menu-node-types.ts";

// PreviewMenuNode 同自共享叶（刀2 接口 getMenuNodes? 返回类型；caps 直产节点入口）
import type { PreviewMenuNode } from "@/preview-3d/menu/menu-node-types.ts";

/* ============ 场景能力统一接口 ============ */

/** cap 间协调查询器：组合根 createAll 时注入，cap 间联动经此查询（不 import
 *  scene-capability-registry——组合根 import 全部 cap，cap 反向 import 它即成模块环） */
export interface SceneCapabilityLookup {
  getById(id: string): SceneCapability | undefined;
}

/**
 * id ↔ 能力类型绑定表（2026-09 锐评 P2-2）：id 字符串与具体能力类型在此声明一次，
 * registry.getById("sky") 调用点自动收窄；add(id, factory) 在注册处绑定 K ↔
 * CapabilityMap[K]，拼错 id / 漏挂 / 返回错类型编译期报错，运行时再由 add 的 id
 * 校验兜底（反射/动态构造等静态盲区的最后防线）。
 * （本体在此而非 registry：getTypedCap 与 registry 共用，且 type-only 依赖具体
 * cap 类型，放共享叶避免 cap→registry 运行时环）
 */
export interface CapabilityMap {
  sky: SkyCapability;
  ground: GroundCapability;
  water: WaterCapability;
  environment: EnvironmentCapability;
  fog: FogCapability;
  shadow: ShadowCapability;
  reflector: ReflectorCapability;
  postprocessing: PostprocessingCapability;
  light: LightCapability;
  renderMode: RenderModeCapability;
}

/** 能力 id 字面量联合（CapabilityMap 的键） */
export type CapabilityId = keyof CapabilityMap;

/**
 * 宽查询器（SceneCapabilityLookup.getById 返回宽 SceneCapability）按 id 收窄为
 * 具体能力类型的唯一收口（锐评 §二：替代各 cap 散落的结构化 cast
 * `as { isEnvironmentEnabled?: () => boolean }`）。运行时正确性由 registry.add
 * 的 id 校验兜底；cast 集中在此一处并注释依据。
 */
export function getTypedCap<K extends CapabilityId>(
  lookup: SceneCapabilityLookup | undefined,
  id: K,
): CapabilityMap[K] | undefined {
  return lookup?.getById(id) as CapabilityMap[K] | undefined;
}

export interface SceneCapability {
  /** 唯一标识（如 "sky" / "ground" / "light" / "fog"） */
  readonly id: string;

  /** 显示名称 i18n 键 */
  readonly labelKey: string;

  /** 图标（emoji） */
  readonly icon: string;

  /** 能力描述 i18n 键 */
  readonly descKey: string;

  /** 挂入场景（constructor 后调用） */
  apply(): void;

  /** 释放资源（会话结束时调用） */
  dispose(): void;

  /** 逐帧更新（可选；动态效果如水面波纹/弹簧骨骼驱动）。无动态需求的能力可不实现。 */
  update?(dt: number): void;

  /** 参数变更订阅（可选）。当影响菜单可见性/分组的持久化参数变化（如水面 mode、地面材质来源）时，
   *  由能力主动通知，供菜单侧局部刷新当前子视图。返回取消订阅函数。仅离散的模式切换触发，高频滑块不应 notify。 */
  subscribe?(listener: () => void): () => void;

  /** 启用/禁用 */
  setEnabled(v: boolean): void;
  isEnabled(): boolean;

  /** 返回菜单控件定义列表（框架自动渲染为 slide panel） */
  getMenuNodes?(): PreviewMenuNode[];

  /**
   * 能力总开关节点 id（可选）：folder 聚合器（如 env 面板）据此把开关升到 folder header
   * （对齐 MikuMikuAR PopupRow.headerToggle——「功能=本 folder」时开关免展开可见），
   * 并自动从 body 剔除同源节点。仅当存在「启停整个能力」的 toggle 时实现
   * （fog/env/reflector 的 enabled toggle 属此）；ground 的 visible 是 params 级、
   * sky 无能力级启停 → 不实现。
   *
   * 返回值是 getMenuNodes() 顶层节点中对应 id（如 "fog-enabled"、"env-enabled"），
   * 非控件定义（PreviewControlDef）。
   */
  getMasterNodeId?(): string;

  /** 持久化：保存当前状态到 localStorage */
  saveState(): void;

  /** 持久化：从 localStorage 恢复状态（构造后、apply 前调用） */
  loadState(): void;
}

/* ============ 持久化工具 ============ */

/**
 * 环形日志面板注入点取用 helper（mount-preview-core 在 globalThis 挂载 __ysmRingLog）。
 * 此前三处构建/加载路径逐字复制同构的 globalThis cast 样板（锐评 P2），收敛于此；
 * 无注入点时可选 console 兜底（文案可与面板版不同，保持既有控制台口径）。
 */
export function ringLog(
  mod: string,
  msg: string,
  lvl: "info" | "warn" | "error",
  consoleFallback?: () => void,
): void {
  const logger = (
    globalThis as unknown as {
      __ysmRingLog?: (mod: string, msg: string, lvl?: "info" | "warn" | "error") => void;
    }
  ).__ysmRingLog;
  if (logger) logger(mod, msg, lvl);
  else consoleFallback?.();
}

/**
 * 贴地平面分层偏移（世界单位；Minecraft 1 单位 = 1 方块，0.01 即厘米级）。
 * z-fighting 防御的唯一口径（2026-09 锐评 P4 收敛）：ground 承接面最上、water 水膜再上、
 * pool 底微抬、reflector 平面下沉让位——各层方向与量级语义各异，取用时按名引用，禁止互相推导。
 */
export const GROUND_LAYER_OFFSETS = {
  /** ground 承接面（SurfaceMesh）相对 y=0 的微抬 */
  groundSurface: 0.005,
  /** water film 模式水膜高度（高于 groundSurface，避免与地面闪面） */
  waterFilm: 0.01,
  /** water pool 池底相对 y=0 的微抬（贴 GridHelper 基准面） */
  waterPoolBottom: 0.0001,
  /** reflector 平面下沉（位于 ground 承接面之下，两层不相交即无 z-fighting） */
  reflector: -0.01,
} as const;

/** 持久化字段种别：普通字段按 typeof 分发；枚举字段走 oneOf 白名单 */
export type FieldKind = "number" | "boolean" | { oneOf: readonly string[] };

/**
 * 持久化种别表绑定到目标对象，生成 restoreFields 的 restorer 表（表驱动持久化基建，
 * 2026-09 锐评 P2-1：params 接口 + 种别表两处互锁后，save/load 自动跟随，四处手工同步收敛为两处）。
 * 对 target 的写入用一次受控宽化 cast——运行时安全由 restoreFields 的 typeof 分发保证：
 * restorer 只在存档值类型与种别匹配时被调用，写入类型必然正确。
 */
export function bindFieldRestorers<P extends object>(
  target: P,
  spec: { [K in keyof P]?: FieldKind },
): Record<string, FieldRestorer> {
  const out: Record<string, FieldRestorer> = {};
  const writable = target as unknown as Record<string, number | boolean | string>;
  for (const key of Object.keys(spec) as Array<keyof P & string>) {
    const kind = spec[key];
    if (kind === undefined) continue;
    if (kind === "number") {
      out[key] = {
        number: (v) => {
          writable[key] = v;
        },
      };
    } else if (kind === "boolean") {
      out[key] = {
        boolean: (v) => {
          writable[key] = v;
        },
      };
    } else {
      out[key] = oneOf(kind.oneOf, (v) => {
        writable[key] = v;
      });
    }
  }
  return out;
}

/** 按种别表键集从 source 导出白名单对象（saveState 的表驱动形态，键集与表恒等） */
export function pickPersistFields<P extends object>(
  source: P,
  spec: { [K in keyof P]?: FieldKind },
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(spec) as Array<keyof P & string>) {
    out[key] = source[key];
  }
  return out;
}

const STORAGE_PREFIX = "ysm-scene-cap-";

/** 保存 JSON 到 localStorage */
export function persistState(capId: string, state: Record<string, unknown>): void {
  safeSet(STORAGE_PREFIX + capId, JSON.stringify(state));
}

/** 从 localStorage 加载 JSON */
export function restoreState(capId: string): Record<string, unknown> | null {
  const raw = safeGet(STORAGE_PREFIX + capId);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** 单字段恢复器：按存档值的实际类型分派，类型不匹配则跳过（等价于手写 typeof 守卫） */
export interface FieldRestorer {
  number?: (v: number) => void;
  boolean?: (v: boolean) => void;
  string?: (v: string) => void;
  /**
   * 枚举白名单：值为 string 且命中 values 才 apply（取代手写
   * `typeof v === "string" && (v === "a" || v === "b")` 的枚举守卫）。
   * 与 string 同配时 string 优先（oneOf 仅作缺省的受约束分发）。
   */
  oneOf?: { values: readonly string[]; apply: (v: string) => void };
}

/**
 * 枚举白名单恢复器工厂：保持调用方零断言（apply 收到窄化后的枚举类型）。
 * apply 的宽化断言收敛在这一处——运行时分发前已过 `values.includes` 校验，
 * 传入 v 必然 ∈ values，断言不引入不安全。
 */
export function oneOf<T extends string>(
  values: readonly T[],
  apply: (v: T) => void,
): FieldRestorer {
  return { oneOf: { values, apply: apply as (v: string) => void } };
}

/**
 * 类型安全的字段批量恢复器（取代各 cap `loadState` 里逐行手写的
 * `if (typeof state.x === "number") this.params.x = state.x;`）。
 *
 * 收敛动机：该样板在 ground / sky / water 等 cap 之间构成 jscpd 10 行级重复块
 * （`ground-capability#sky-capability` 等），且每新增一个持久化字段就多复制一行。
 *
 * @returns 至少一个字段成功回填 true；无存档、或存档值全部类型不匹配（含损坏数据）
 *   返回 false——「无存档」与「有存档但什么都没恢复」对调用方是同一早退语义。
 */
export function restoreFields(
  state: Record<string, unknown> | null,
  spec: Record<string, FieldRestorer>,
): boolean {
  if (!state) return false;
  let applied = false;
  for (const [key, restorer] of Object.entries(spec)) {
    const v = state[key];
    if (typeof v === "number") {
      if (restorer.number) {
        restorer.number(v);
        applied = true;
      }
    } else if (typeof v === "boolean") {
      if (restorer.boolean) {
        restorer.boolean(v);
        applied = true;
      }
    } else if (typeof v === "string") {
      if (restorer.string) {
        restorer.string(v);
        applied = true;
      } else if (restorer.oneOf?.values.includes(v)) {
        restorer.oneOf.apply(v);
        applied = true;
      }
    }
  }
  return applied;
}

/**
 * 参数变更订阅器（ground / water 的 subscribe + notify 样板）已提级共享原语
 * `@/utils/base/primitives/listener-set.ts`（ADR-216：与 download-queue-store
 * 手搓 Set 收敛单一事实源）——本文件不再定义/导出，消费方直引 primitives。
 */
