// ===== 场景能力统一接口（ADR-073 扩展：能力注册表驱动）=====
// 所有场景能力（Sky/Ground/Light/后续 Fog/Shadow/Reflection 等）实现本接口，
// 由 scene-capability-registry 自动发现并注入菜单，新增能力只需：
//   1. 实现 SceneCapability 接口
//   2. 在 registry.add() 注册一行
// 菜单/持久化/生命周期全部由框架驱动，零手工 wiring。

import { safeGet, safeSet } from "../../../utils/dom/storage.ts";
import type { PreviewSnapshot } from "../state/preview-state.ts";

/* ============ 菜单控件定义 ============ */

/** 单个菜单控件类型 */
type MenuControlKind = "toggle" | "slider" | "select" | "button" | "divider" | "image" | "color" | "timeline" | "histogram" | "preset-thumb";

/** 菜单控件定义（声明式，由框架渲染为 DOM） */
export interface MenuControlDef {
  /** 稳定 id（用于持久化 key） */
  id: string;
  /** 控件类型 */
  kind: MenuControlKind;
  /** i18n 标签键 */
  labelKey: string;
  /** i18n 回退文案 */
  fallback: string;
  /** 控件辅助说明 i18n 键（toggle/select 展示在右侧小字，hintKey 缺省取 fallback 不显示；button 有内部 button.hintKey 优先级更高） */
  hintKey?: string;
  /** 分组标题 i18n 键（同一 group 的连续控件归入一个可折叠 section；group 变化时插入 section header） */
  group?: string;
  /**
   * 设置面板聚合序号（ADR-125 P2）：定义后该控件自动并入 ⚙️ 设置面板，按本值升序排列。
   * 未定义 = 不进设置面板（避免 pp 的 20 个高级控件淹没设置页）。
   * cap 侧自声明即可，settings 侧零接线。
   */
  settingsOrder?: number;
  /** 条件显隐（A 轨闭包）：定义且返回 false 时控件隐藏（依赖 cap 自身 params，禁止跨 cap 探查）。未定义则始终显示。 */
  visible?: () => boolean;
  /** 条件显隐（B 轨纯函数谓词）：吃状态层快照 PreviewSnapshot，返回 false 时隐藏。
   *  与节点级 visibleWhen 同构，用于把 cap 控件条件显隐从「闭包依赖运行时 params」升级为「状态层快照驱动」，
   *  配合 preview-state 的 env.waterMode / env.groundMatSource 等 cap 状态上浮路径，消除快照冻结类 bug 根源。
   *  A 轨 visible 与 B 轨 visibleWhen 并存时两者 AND（皆通过才显示）。未定义则仅看 visible。 */
  visibleWhen?: (s: PreviewSnapshot) => boolean;
  /** slider 配置 */
  slider?: {
    min: number;
    max: number;
    step: number;
    unit?: string;
    /**
     * slider 提交回调（拖拽松手/change 事件，离散触发）。
     * 与 setValue 的 oninput 高频写入区分：用于「拖动时抑制、提交时通知」类语义
     * （如 pixel-ratio 拖动不触发面板重算，松手后广播一次）。
     */
    onCommit?: (v: number) => void;
  };
  /** select 配置 */
  select?: Array<{ value: string; label: string }>;
  /** button 配置（kind=button 时生效） */
  button?: {
    /** 按钮展示文案（i18n 键），为空则取 labelKey/fallback */
    textKey?: string;
    /** 按钮次级文案（i18n 键），展示按钮右侧小字（如已加载 HDR 文件名） */
    hintKey?: string;
    /** 读取当前右侧 hint 文案（动态覆盖 hintKey，如当前加载的 HDR 文件名） */
    getHint?: () => string;
    /** 按钮变种：primary 强调 / ghost 次按钮 */
    variant?: "primary" | "ghost";
    /** 点击回调。非 getValue/setValue 语义（按钮无"值"），统一单独挂 action */
    action: () => void | Promise<void>;
    /** 是否禁用（异步加载中禁用） */
    disabled?: () => boolean;
  };
  /** preset-thumb 配置（kind=preset-thumb 时生效） */
  thumb?: {
    size: number;
    options: Array<{ value: string; label: string; getThumb: () => string | null }>;
    activeValue: () => string;
    onSelect: (value: string) => void;
  };
  /** 读取当前值（框架调用，渲染初始状态；button/image 忽略，image 可返回 null 跳过渲染） */
  getValue: () => number | string | boolean | null | number[];
  /** 设置值（框架调用，用户交互时触发；button 忽略） */
  setValue: (v: number | string | boolean) => void;
}

/* ============ 场景能力统一接口 ============ */

/** cap 间协调查询器：组合根 createAll 时注入，cap 间联动经此查询（不 import
 *  scene-capability-registry——组合根 import 全部 cap，cap 反向 import 它即成模块环） */
export interface SceneCapabilityLookup {
  getById(id: string): SceneCapability | undefined;
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

  /** 按模型类别套用预设（可选，无预设的能力忽略） */
  setPreset?(modelType: string): void;

  /** 返回菜单控件定义列表（框架自动渲染为 slide panel） */
  getMenuControls(): MenuControlDef[];

  /** 持久化：保存当前状态到 localStorage */
  saveState(): void;

  /** 持久化：从 localStorage 恢复状态（构造后、apply 前调用） */
  loadState(): void;
}

/* ============ 持久化工具 ============ */

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
      }
    }
  }
  return applied;
}

/**
 * 参数变更订阅器工厂（ground / water 的 subscribe + notify 样板收敛）。
 * 返回 { subscribe, notify }：
 *   - subscribe(listener)：登记监听器，返回取消订阅函数；
 *   - notify()：同步逐个触发（离散的模式切换触发，高频滑块不应 notify——语义同接口注释）。
 */
export function createListenerSet(): {
  subscribe: (listener: () => void) => () => void;
  notify: () => void;
} {
  const listeners = new Set<() => void>();
  return {
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    notify(): void {
      for (const l of listeners) l();
    },
  };
}
