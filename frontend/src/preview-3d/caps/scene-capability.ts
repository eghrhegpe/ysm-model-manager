// ===== 场景能力统一接口（ADR-073 扩展：能力注册表驱动）=====
// 所有场景能力（Sky/Ground/Light/后续 Fog/Shadow/Reflection 等）实现本接口，
// 由 scene-capability-registry 自动发现并注入菜单，新增能力只需：
//   1. 实现 SceneCapability 接口
//   2. 在 registry.add() 注册一行
// 菜单/持久化/生命周期全部由框架驱动，零手工 wiring。
// （锐评 2026-10-07 #6 拆轴：存档工具箱 → caps/persist-utils.ts，分层偏移 → caps/layer-offsets.ts）

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
 * `as { isSkyIblSelfHoldEnabled?: () => boolean }`）。运行时正确性由 registry.add
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
   * 主开关节点 id（可选）：**「此 cap 在菜单一级行上暴露哪个开关」的唯一真值源**。
   *
   * ⚠️ 措辞校准（2026-10-05 设计层锐评 §2）：本方法的**语义按 cap 而异**，不是单一语义——
   * `sky`/`water`/`environment`/`fog`/`reflector` 报的是**能力级启停**（enabled toggle，
   * 真值源一律 envState 的 `*Enabled` 键）；**`ground` 报的是可见性开关**
   * （`ground-visible` → `envState.groundVisible`，ground 侧无能力级 toggle，
   * 其私有 `enabled` 刻意无 UI 写口）。故首句原「启停整个能力」是以偏概全，
   * 会让读者以为 ground 的实现是错的——实际是**契约措辞未覆盖其合法用法**。
   * 消费方只关心「一级行要不要给开关、给哪个节点的」，不关心其语义层级；
   * 若未来需要区分「能力级 vs 参数级」，须另立字段（如 `masterKind`），
   * 而不是让本方法继续承载两义。
   *
   * 消费方三处同契：
   *  - env 面板：cap 行升 folder header 的 headerToggle，子视图 filter 剔除
   *  - 场景组根视图：panel 行 headerToggle（是否给开关由本声明决定）。
   *  - 直达面板（light/shadow/postproc 等）：面板渲染时 filter 移除首行主开关防一二级双份。
   * 返回 `getMenuNodes()` 顶层节点中对应 id（如 "fog-enabled"、"env-enabled"、"shadow-enabled"、
   *  "light-enabled"、"pp-enabled"、"ground-visible"），**非控件定义**（PreviewControlDef）。
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

// ringLog 下沉至叶子模块 @/preview-3d/ring-log.ts（打破 env-dispatcher 循环依赖），此处保留 re-export。
export { ringLog } from "@/preview-3d/ring-log.ts";

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

// [锐评 P1-0/P3-1 2026-10-08] 原 `restoreBySchema`（读侧派生化批量恢复器）已下沉
// `water-persist.ts|restoreWaterSchemaKeys`——本文件唯一消费方是 water（通用签名藏
// startsWith("water") 后门类 = P3-1「共享工具暗特化」），且其硬编码 `source:"manual"`
// 违反 2026-09-22 来源纪律（P1-0 暗门）。scene-capability.ts 回归「接口 + localStorage
// IO（persistState/restoreState）」本分。

/**
 * 参数变更订阅器（ground / water 的 subscribe + notify 样板）已提级共享原语
 * `@/utils/base/primitives/listener-set.ts`（ADR-216：与 download-queue-store
 * 手搓 Set 收敛单一事实源）——本文件不再定义/导出，消费方直引 primitives。
 */
