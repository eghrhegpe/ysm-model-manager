// ===== preview-3d/menu-node-types.ts — 声明式菜单控件/节点类型共享叶（ADR-195 刀2 下沉）=====
//
// 零运行时依赖叶子（纯类型）：承载「菜单即数据」的类型契约，供 menu/ 与 caps/ 两域共用。
//
// 下沉背景（ADR-195 刀2）：cap 生态要直产 PreviewMenuNode[]（getMenuNodes 替代
// getMenuControls），caps/* 需反向引用节点类型；而 node-types（menu/）依赖
// MenuControlDef（caps/scene-capability）——若不破环，「caps → menu/node-types →
// caps/scene-capability → caps/*」会形成纯类型环。把控件/节点类型统一下沉本叶后：
//   - menu/node-types.ts 与 caps/scene-capability.ts 都从本叶引用类型（re-export 保兼容）
//   - caps/* 直产 PreviewMenuNode[] 只依赖本叶（不再反向 import menu/）
//   - 方向单一：menu/caps → 本叶 → state/preview-paths（零依赖），无环
//
// 血统：MenuControlDef/MenuControlKind 自 caps/scene-capability.ts 下沉（2026-09-06），
// 对齐 ADR-168 二期 preview-paths.ts 下沉范本（零依赖叶子 + 原位 re-export 兼容）。
// PreviewMenuNode 系（node-types.ts）终态亦并入本叶（MenuControlDef 字段并入
// PreviewControlSpec 后），当前阶段 MenuControlDef 先行下沉破环。

import type { PreviewSnapshot } from "./state/preview-paths.ts";

/** 单个菜单控件类型（导出：PreviewMenuNode.controls 字段引用同一形制） */
export type MenuControlKind =
  | "toggle"
  | "slider"
  | "select"
  | "button"
  | "divider"
  | "image"
  | "color"
  | "timeline"
  | "histogram"
  | "preset-thumb";

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
  /** 条件显隐（B 轨纯函数谓词）：吃状态层快照 PreviewSnapshot（2026-09 放宽为 Partial——谓词只读自己关心的键，
   *  键存在性仍编译期守卫，未落地键报错），返回 false 时隐藏。
   *  与节点级 visibleWhen 同构，用于把 cap 控件条件显隐从「闭包依赖运行时 params」升级为「状态层快照驱动」，
   *  配合 preview-state 的 env.waterMode / env.groundMatSource 等 cap 状态上浮路径，消除快照冻结类 bug 根源。
   *  [铁律收口] 3d菜单只允许 visibleWhen——A 轨 visible 闭包已整体删除（2026-09，ground/water 换皮完成），
   *  谓词只吃快照不摸 cap 实例，全仓唯一条件显隐入口。 */
  visibleWhen?: (s: Partial<PreviewSnapshot>) => boolean;
  /** slider 配置 */
  slider?: {
    min: number;
    max: number;
    step: number;
    unit?: string;
    /**
     * 旁挂数字输入框（与 range 双向联动，onchange 走 min/max clamp）。
     * [控件原语归一] 自 PreviewControlSpec.numeric 收编（2026-09）——此前 node 栈
     * 专属能力，cap 栈（litematic 分层等）调用不到；归一后所有数组类菜单共享。
     */
    numeric?: boolean;
    /**
     * slider 提交回调（拖拽松手/change 事件，离散触发）。
     * 与 setValue 的 oninput 高频写入区分：用于「拖动时抑制、提交时通知」类语义
     * （如 pixel-ratio 拖动不触发面板重算，松手后广播一次）。
     */
    onCommit?: (v: number) => void;
  };
  /** 控件值变更后的副作用钩子（select/toggle/slider 通用，change/input 提交后调用）。
   *  [控件原语归一] 自 PreviewControlSpec.onChange 收编（2026-09）——适配层可在其中
   *  注入 menu.refresh（refreshOnChange 语义）或广播副作用，renderCap* 无需持有 menu 引用。 */
  onChange?: (v: unknown) => void;
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
