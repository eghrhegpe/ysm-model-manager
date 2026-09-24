// ===== 场景能力统一接口（ADR-073 扩展：能力注册表驱动）=====
// 所有场景能力（Sky/Ground/Light/后续 Fog/Shadow/Reflection 等）实现本接口，
// 由 scene-capability-registry 自动发现并注入菜单，新增能力只需：
//   1. 实现 SceneCapability 接口
//   2. 在 registry.add() 注册一行
// 菜单/持久化/生命周期全部由框架驱动，零手工 wiring。

import { envState, setEnvState } from "@/preview-3d/state/env-state.ts";
import {
  ENV_STATE_SCHEMA,
  type EnvState,
  type EnvStateKey,
} from "@/preview-3d/state/env-state-schema.ts";
import { safeGet, safeSet } from "@/utils/base/primitives/storage.ts";
import type { IconRef } from "@/utils/icon/resolve.ts";
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
} from "@/preview-3d/menu/schema/menu-node-types.ts";

import type { LocaleKey } from "@/core/i18n/t.ts";
// PreviewMenuNode 同自共享叶（刀2 接口 getMenuNodes? 返回类型；caps 直产节点入口）
import type { PreviewMenuNode } from "@/preview-3d/menu/schema/menu-node-types.ts";

/* ============ 场景能力统一接口 ============ */

/** cap 间协调查询器：组合根 createAll 时注入，cap 间联动经此查询（不 import
 *  scene-capability-registry——组合根 import 全部 cap，cap 反向 import 它即成模块环） */
export interface SceneCapabilityLookup {
  getById(id: string): SceneCapability | undefined;
  /**
   * [暗线 C1 收口 2026-10] panelId → cap 解析（替代 core.ts 手写 SCENE_CAP_FOR_PANEL 平行映射表）。
   * 面板 id 与 cap id 命名天然不同（面板 lighting/postproc，cap light/postprocessing），
   * 现由 cap 自行声明 panelId（默认 = id），新增 cap 无需再改 core.ts 映射表。
   * 仅当存在「启停整个能力」的总开关且面板渲染需挂 headerToggle 时，调用方据此查 cap。
   */
  getCapByPanelId?(panelId: string): SceneCapability | undefined;
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

/**
 * 环境面板分段 id（ADR-268）：cap 经 `getEnvPlacement().section` 自报归入哪张卡。
 * 集中在此与 `env.ts` 的段外壳描述符共享同一联合类型——新增/改名分段编译期即漂移报错。
 * 值对应「基础」（天空/地面/水面）与「氛围」（环境/雾/反射）两张语义卡。
 */
export type EnvSectionId = "basic" | "atmosphere";

/** 环境面板归属声明（ADR-268）：段 + 段内展示序（order 升序，间隔取值便于后续插入） */
export interface EnvPlacement {
  section: EnvSectionId;
  order: number;
}

export interface SceneCapability {
  /** 唯一标识（如 "sky" / "ground" / "light" / "fog"） */
  readonly id: string;

  /**
   * [暗线 C1 收口 2026-10] 面板渲染侧 id（dock 组 rootView / 场景组 headerToggle 绑定用）。
   * 默认 = id（sky/ground/light 面板与 cap 同名）；命名分裂的面板（lighting→light、
   * postproc→postprocessing）在此显式声明，消除 core.ts 手写 SCENE_CAP_FOR_PANEL 平行映射表。
   */
  readonly panelId?: string;

  /** 显示名称 i18n 键 */
  readonly labelKey: LocaleKey;

  /** 图标（emoji） */
  readonly icon: IconRef;

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
   * 能力总开关节点 id（可选）：**「此 cap 有启停整个能力」的唯一真值源**。
   * 消费方三处同契：
   *  - env 面板：cap 行升 folder header 的 headerToggle，子视图 filter 剔除
   *  - 场景组根视图：panel 行 headerToggle（是否给开关由本声明决定）。
   *  - 直达面板（light/shadow/postproc 等）：面板渲染时 filter 移除首行主开关防一二级双份。
   * 仅当存在「启停整个能力」的 toggle 时实现（enabled/visible toggle）；audio 返回
   *   getMenuNodes() 顶层节点中对应 id（如 "fog-enabled"、"env-enabled"、"shadow-enabled"、
   *  "light-enabled"、"pp-enabled"），非控件定义（PreviewControlDef）。
   * 守护：env.test.ts 遍历 6 环境 cap 断言必须上报；light/shadow/postproc 由
   *  cap 自身测试断言 getMasterNodeId 声明 + 面板渲染 filter 契约。
   */
  getMasterNodeId?(): string;

  /**
   * 环境面板归属声明（可选，ADR-268）：**「此 cap 是否属于环境面板、归哪张卡、卡内序」的
   * 唯一真值源**——对齐设置面板节点级 `settingsOrder` 的插件范式（`settings.ts`
   * `collectSettingsCapControls` 遍历 registry 自动聚合）。
   * 实现本方法即入选环境面板；不实现（light/shadow/postproc/renderMode 等非环境 cap）
   * 天然被 `buildEnvSchema` 过滤。新增环境 cap 只在自己文件加一行本声明，`env.ts` 零改动。
   * `section` 取 `EnvSectionId`（与 env.ts 段外壳共享），`order` 段内升序（间隔取值）。
   * 守护：env.test.ts 遍历 6 环境 cap 断言必声明本方法。
   */
  getEnvPlacement?(): EnvPlacement;

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
 * z-fighting 防御的唯一口径（2026-09 锐评 P4 收敛）：ground 承接面最上、pool 底微抬、
 * reflector 平面下沉让位——各层方向与量级语义各异，取用时按名引用，禁止互相推导。
 *
 * 注：原 `waterFilm: 0.01`（film 水膜写死高度）已随 ADR-257 删除——film 的水面 y 现由
 * `envState.waterLevel`（默认同为 0.01）驱动，是唯一事实源，不再是本分层的常量成员。
 */
export const GROUND_LAYER_OFFSETS = {
  /** ground 承接面（SurfaceMesh）相对 y=0 的微抬 */
  groundSurface: 0.005,
  /** ADR-249 §2.3 装饰叠加层（透明格线，位于 surface 之上） */
  groundOverlay: 0.007,
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

/** 从 localStorage 加载 JSON。
 *
 *  **形态闸（2026-09-22 锐评 F-1 三度收口复审补）**：只接受 **JSON 对象**，其余一律 `null`
 *  （同「无存档」语义）。原实现只 try/catch 包 `JSON.parse`，`JSON.parse("5")` 得 `5` 便
 *  原样返回 —— 而各 cap 的 legacy 回填写 `!("xEnabled" in s)`，`in` 对非对象真值抛
 *  `TypeError: Cannot use 'in' operator to search for ... in 5`；异常被 `loadAll` 的
 *  per-cap try/catch 吞掉并 continue → **后续 cap 静默跳过恢复**（ringLog 无生产 sink，
 *  用户只见黑场景零提示）。收口在**唯一入口**：一处闸住，9 个调用点全免疫，各 cap 不必
 *  各写一遍 typeof 守卫（下游既有 `if (!state) return` 早退天然接住）。
 *  数组亦排除——`in` 不抛错但非存档对象形态。 */
export function restoreState(capId: string): Record<string, unknown> | null {
  const raw = safeGet(STORAGE_PREFIX + capId);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
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
 * [锐评 P0 收口 2026-09] 读侧派生化：从 env-state schema 按键集直接恢复标量字段，
 * 取代 cap 内「手写 canonical 键清单」这种与 saveState 派生化（getPresetKeys）缺位半截的写法。
 *
 * 模式：每个 canonical 键经**唯一写入口** `setEnvState` 落值（自动走 clampFieldValue 值域钳制
 * + 写入中间件豁免），与 saveState 同一条写管道——新增 schema 标量键只要落在目标 group（如
 * "water"），读侧零登记即可随 saveState 自动 round-trip，不再依赖手写还原表。
 *
 * ⚠️ 设计边界（与 saveState 派生化对齐，不越界）：
 *  - 仅覆盖 **canonical `water*` 标量键**（schema type ∈ number/boolean）。枚举键（waterMode）
 *    由调用方用 oneOf 白名单单独接（防脏枚举值直漏 cap setter，与写侧 clampFieldValue 的
 *    枚举收敛同纪律）；历史旧方言别名（size/level/mode/…）是存档兼容层，仍须手写映射，不在此。
 *  - current 值短路：envState 已是该键默认值（大多场景遗留存档无此键）则跳过，省一次无谓写。
 *  - 全程 `{ source: "manual", skipMiddleware: true }`：与 loadState 其余恢复分支同口径
 *    （存档恢复显式豁免「手改即 custom」类中间件，防把用户预设误打 custom）。
 *
 * @returns 至少一个键落值返回 true（与 restoreFields 语义一致，便于统一早退判定）。
 */
export function restoreBySchema(
  state: Record<string, unknown> | null,
  keys: readonly EnvStateKey[],
): boolean {
  if (!state) return false;
  let applied = false;
  for (const key of keys) {
    if (!key.startsWith("water")) continue; // 仅水面 canonical 键（防御性，调用方已过滤 group）
    const def = ENV_STATE_SCHEMA[key] as { type: string } | undefined;
    if (!def) continue;
    const v = state[key];
    // 类型不匹配（脏存档/旧方言缺省）→ 跳过，保持该键 schema 默认（setEnvState 兜底同口径）
    if (def.type === "number") {
      if (typeof v !== "number") continue;
      if ((envState as unknown as Record<string, unknown>)[key] === v) continue;
      setEnvState({ [key]: v } as Partial<EnvState>, {
        source: "manual",
        skipMiddleware: true,
      });
      applied = true;
    } else if (def.type === "boolean") {
      if (typeof v !== "boolean") continue;
      if ((envState as unknown as Record<string, unknown>)[key] === v) continue;
      setEnvState({ [key]: v } as Partial<EnvState>, {
        source: "manual",
        skipMiddleware: true,
      });
      applied = true;
    }
    // enum / 其他类型键不在此处理（调用方单独接）
  }
  return applied;
}

/**
 * 参数变更订阅器（ground / water 的 subscribe + notify 样板）已提级共享原语
 * `@/utils/base/primitives/listener-set.ts`（ADR-216：与 download-queue-store
 * 手搓 Set 收敛单一事实源）——本文件不再定义/导出，消费方直引 primitives。
 */
