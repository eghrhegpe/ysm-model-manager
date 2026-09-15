// ===== preview-3d/menu-node-types.ts — 声明式菜单控件/节点类型共享叶（ADR-195 刀2 下沉）=====
//
// 零运行时依赖叶子（纯类型）：承载「菜单即数据」的类型契约，供 menu/ 与 caps/ 两域共用。
//
// 下沉背景（ADR-195 刀2）：cap 生态要直产 PreviewMenuNode[]（getMenuNodes 替代
// getMenuControls），caps/* 需反向引用节点类型；而 node-types（menu/）依赖
// 控件类型（caps/scene-capability 旧称，刀3 更名为 PreviewControlDef）
// ——若不破环，「caps → menu/node-types → 控件类型」会成纯类型环。下沉本叶后：
//   - menu/node-types.ts 与 caps/scene-capability.ts 都从本叶引用类型（re-export 保兼容）
//   - caps/* 直产 PreviewMenuNode[] 只依赖本叶（不再反向 import menu/）
//   - 方向单一：menu/caps → 本叶 → state/preview-paths（零依赖），无环
//
// 血统：控件类型（刀3 由旧控件类型更名，终成 PreviewControlDef /
// PreviewControlKind）自 caps/scene-capability.ts 下沉；PreviewMenuNode
// 系（PreviewMenuNode/Kind/PreviewControlSpec/PreviewActionMenuCtx/dockGroup）自
// menu/node-types.ts 下沉（2026-09-06 ADR-195 刀2）——两域（menu/caps）共享同一类型契约，
// 对齐 ADR-168 二期 preview-paths.ts 下沉范本（零依赖叶子 + 原位 re-export 兼容）。
// menu/node-types.ts 留 PreviewMenuCtx（依赖 caps/adapters 真依赖）+ 值函数并 re-export
// 本叶类型保 30+ 消费者 import 零改动。

import type { PreviewSnapshot, PreviewStatePath } from "@/preview-3d/state/preview-paths.ts";
import type { IconSpec } from "@/utils/icon/resolve.ts";

/** 控件种类（含简单+复杂）——controls 通道承载元素的 kind。
 *  [ADR-195 刀3] 更名收敛（终名 PreviewControlKind）：cap 控件与节点控件收敛到
 *  同一声明式类型子孙，消除"第二套控件类型"观感。简单 kind（toggle/slider/select/divider/color）可走
 *  PreviewMenuNode.control 节点原生承载，复杂 kind（button/image/timeline/histogram/
 *  preset-thumb）经 controls 通道承载——二者由同一个 cap 栈渲染器渲染。 */
export type PreviewControlKind =
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

/**
 * 控件定义（[ADR-195 刀3] 更名，终名 PreviewControlDef）：声明式，由 cap 栈渲染器渲染为 DOM。
 * 经 `PreviewMenuNode.controls` 通道承载（复杂可视化控件），与 `PreviewControlSpec`
 * （节点原生控件字段）同属控件声明体系——不再有并列于节点体系的第二种类型。
 */
export interface PreviewControlDef {
  /** 稳定 id（用于持久化 key） */
  id: string;
  /** 控件类型 */
  kind: PreviewControlKind;
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
    /** [预设冗余标签] true = 不渲染控件顶部 label（外层已用 folder 折叠头承载标题，省去内部重复标题行）。 */
    hideLabel?: boolean;
  };
  /** 读取当前值（框架调用，渲染初始状态；button/image 忽略，image 可返回 null 跳过渲染） */
  getValue: () => number | string | boolean | null | number[];
  /** 设置值（框架调用，用户交互时触发；button 忽略） */
  setValue: (v: number | string | boolean) => void;
}

/* ============ 节点体系类型（ADR-195 刀2 自 menu/node-types.ts 下沉）============ */

/** 动作节点回调上下文（与 ActionMenuCtx 对齐；ysm 侧 toast/closeOverlays 由 ctx.menu 提供） */
export interface PreviewActionMenuCtx {
  toast: (message: string) => void;
  closeAllOverlays: () => void;
  /** [ADR-193 第四刀] 视图导航原语（可选）：声明式 action 内下钻子视图
   *  （如 roles 角色行 → modelDetailView 详情）。mount3D 注入 menu.navigate，
   *  旧消费者（仅 toast/closeAllOverlays）零感知 */
  navigate?: (view: { title: string; render: (list: HTMLElement) => void }) => void;
}

/** 节点种类：folder 可嵌套；其余为叶节点（与 MikuMikuAR MenuKind 对齐，加 ysm 的 panel 语义） */
export type PreviewMenuNodeKind =
  | "folder"
  | "panel" // ysm 特有：子面板（渲染进详情/面板视图）
  | "action"
  | "slider"
  | "toggle"
  | "select" // [doc:adr-126-p5-c] 下拉选择控件（bind 到 PreviewStatePath，走状态层读写）
  | "button"
  | "color" // [ADR-195] 颜色控件（cap color 原生化；值 0xRRGGBB ↔ #rrggbb，投影 renderCapColor）
  | "field" // 键值对行（统计/信息展示）
  | "row" // 列表行（纹理/材质/bone 等动态列表）
  | "divider"
  | "sectionTitle"
  // [可折叠卡] card 支持 collapsible:true → 变成可折叠卡牌（顶行标题箭头 + 内容区折叠），
  // 与 env 顶层 cap 卡 / cap 子视图分组（原 folder 的扁平折叠头）同一盒式折叠视觉；collapsible 缺省不可折叠。
  | "card" // [ADR-195 终态] 卡牌分组容器：顶行标题+分隔线+内容区，把同级行按语义聚拢（collapsible:true 时可折叠，统一折叠视觉）
  | "material-row" // [doc:adr-126-p5] 组合控件行（label + eye 显隐 + opacity 滑条）——审计 #3 material 声明式化
  | "controls" // [ADR-195 刀3] 承载 PreviewControlDef[]，渲染委托 renderCapControls
  | "custom";

/**
 * 底栏 dock 分组 id（单一事实源——2026-09 锐评收口：原 defs.ts 手写字面量与本文件
 * dockGroup 双源漂移，归位类型叶后 defs.ts 值文件反向引用，方向单一）。
 * 仅列 dock 按钮组（5 组）；dockGroup 的 "stats" 是统计附加行通道（非 dock 组），单列。
 */
export type PreviewMenuGroupId = "model" | "motion" | "env" | "scene" | "settings";

/** dockGroup 合法值：dock 组 ∪ 统计附加行通道（node-types 类型叶自足，消费方经此引用） */
export type PreviewDockGroup = PreviewMenuGroupId | "stats";

/** 控件绑定规格（slider/toggle/button/field 用；ysm 侧 state 映射表建立后 bind 生效）。
 *  [ADR-195 刀3] 本接口与 PreviewControlDef（复杂控件）同属一个控件声明体系——简单控件
 *  由节点原生承载（本接口），复杂控件经 controls 通道承载（PreviewControlDef），
 *  渲染统一走 cap 栈（见 ADR-195）。 */
export interface PreviewControlSpec {
  /** 声明式路径（走状态层读写；感知类闭包控件如 perception toggle 无状态层路径——
   *  用 get/set 直接读写，bind 可省略） */
  bind?: PreviewStatePath;
  min?: number;
  max?: number;
  step?: number;
  icon?: IconSpec;
  options?: Array<{ value: string; label: string }>;
  /** 衍生控件：状态值 → 控件显示值 */
  get?: (v: unknown) => unknown;
  /** 衍生控件：控件值 → 状态值 */
  set?: (v: unknown) => unknown;
  /** 控件值变更后的副作用 */
  onChange?: (v: unknown) => void;
  /** slider 类型：旁挂数字输入框（与 range 双向联动，onchange 走 min/max clamp）——
   *  大数值层号精确输入场景（litematic 分层切片首用） */
  numeric?: boolean;
  /** slider 值单位（[ADR-195] 自 PreviewControlDef.slider.unit 同构）：
   *  "h"→HH:MM 时间、"%"→百分比、其它非空字符串后缀（°、m、x）、""=无后缀。
   *  渲染端 formatCapSliderValue 消费。 */
  unit?: string;
  /** slider 提交回调（拖拽松手/change 离散触发；[ADR-195] 自 PreviewControlDef.slider.onCommit
   *  同构——如 pixel-ratio 拖动抑制重算、松手广播一次） */
  onCommit?: (v: number) => void;
  /** 控件辅助说明 i18n 键（[ADR-195] 自 PreviewControlDef.hintKey 同构——toggle/select/slider
   *  渲染在 label 右侧小字） */
  hintKey?: string;
  /** button 类型：按钮变种（[ADR-195] 自 PreviewControlDef.button 同构；primary 强调 / ghost 次） */
  variant?: "primary" | "ghost";
  /** button 类型：按钮点击回调（无值语义控件；node.action 的控件态表达） */
  action?: () => void | Promise<void>;
  /** button 类型：是否禁用（异步加载中禁用） */
  disabled?: () => boolean;
  /** button 类型：动态右侧 hint 文案（覆盖 hintKey，如已加载 HDR 文件名） */
  getHint?: () => string;
  /** onchange 后重渲染当前面板（menu.refresh()）：面板内容随绑定状态变化的场景
   *  （如组件 select 切档后 stats/纹理行按新快照重建，[doc:adr-126-p5] 订阅链闭合的渲染侧） */
  refreshOnChange?: boolean;
  /** field 类型：显示值（静态或衍生） */
  value?: string | number | boolean;
  /** button 类型：按钮文案（i18n key 或字面量） */
  text?: string;
}

/** 声明式菜单节点：菜单即数据 */
export interface PreviewMenuNode {
  /** 稳定 id；渲染为 data-testid="preview-<id>" */
  id: string;
  kind: PreviewMenuNodeKind;
  /** i18n 键（folder/divider 不需要） */
  labelKey?: string;
  /** 明文标签（动态数据名，不经 i18n）：仅当节点无 labelKey、且显示名是运行时数据
   *  （表情名/材质名/角色名等）时承载。回退标准统一归 i18n tOf（labelKey → FALLBACK → 裸 key）；
   *  本字段不参与「i18n 缺 key 回退」，只装数据明文。 */
  label?: string;
  /** 控件辅助说明 i18n 键（[ADR-195] 自 PreviewControlDef.hintKey 同构——toggle/select/slider
   *  渲染在 label 右侧小字；capControlToNode 透传，节点渲染器经 spec/节点读取） */
  hintKey?: string;
  /** [ADR-195 刀2] 设置面板聚合序号（自 PreviewControlDef.settingsOrder 同构）：定义后该
   *  节点自动并入 ⚙️ 设置面板，按本值升序排列。settings 聚合 collectSettingsCapControls
   *  对已迁移 cap 从节点树读取本字段（未迁移 cap 走旧控件定义 settingsOrder）。 */
  settingsOrder?: number;
  icon?: IconSpec;
  /** 默认展开（folder 用；card 声明 collapsible:true 时也适用，缺省展开） */
  defaultOpen?: boolean;
  /** [可折叠卡] 仅 card：true = 可折叠卡（箭头 + 点击折叠内容区，复用 folder 折叠态记忆）。
   *  false/缺省 = 经典不可折叠卡壳（ADR-195 语义保留）。 */
  collapsible?: boolean;
  /** 仅 folder：header 上的功能总开关（对齐 MikuMikuAR PopupRow.headerToggle——
   *  「功能 = 本 folder」时开关放 header 一眼可见，免展开；createHeaderToggle 内置
   *  stopPropagation，开关点击不触发折叠。folder body 内不得再重复同一开关。 */
  headerToggle?: {
    value: boolean;
    onChange: (v: boolean) => void;
  };
  /** folder：子节点（可折叠 section）；panel：面板内容声明式子节点（[doc:adr-126-p4-b-1] renderPreviewPanel children 分支递归 renderMenu） */
  children?: PreviewMenuNode[];
  /** slider/toggle 等控件绑定 */
  control?: PreviewControlSpec;
  /** 静态显示值（field 类型用，无需控制绑定） */
  value?: string | number;
  /** 逃生舱：无法数据化的内容直接渲染；closePopup 可选（兼容 MikuMikuAR 单参用法） */
  // biome-ignore lint/suspicious/noConfusingVoidType: renderCustom 返回 void 表「cleanup 或空」,改 undefined 连锁破坏 6+ 实现点(menu/env/settings/bones-panel-node),2026-09 裁决保留
  renderCustom?: (container: HTMLElement, closePopup?: () => void) => (() => void) | void;
  /** 条件守卫：吃状态层快照的纯函数，返回 false 时不渲染（如 self 模式隐藏 camera）——[doc:adr-126-p4-d] 升级为 (s: PreviewSnapshot) => boolean。
   *  2026-09 放宽为 Partial：谓词只读自己关心的键（键存在性仍编译期守卫——未落地键报错），调用方可传部分快照 */
  visibleWhen?: (s: Partial<PreviewSnapshot>) => boolean;
  /** [doc:adr-126-p5-a] 受控 schema builder 注册 key：有则 renderPreviewPanel 查 schema-registry 的该 key。
   *  多模型同框时各适配器用专属 key（如 "ysm-model" / "litematic-slice-{n}"）避免互相覆盖。
   *  必显式——panel id 不再隐式兜底作 schema key（P5 复盘：id 撞注册键渲染错内容且无告警，
   *  与 per-scene 显式 key 约定冲突） */
  schemaId?: string;
  /** action 节点回调 */
  action?: (ctx: PreviewActionMenuCtx) => void | Promise<void>;
  /** ———— ysm 特有（预览器 dock 归属与模式守卫）———— */ /** 归属底栏分组（🧍 模型 / 💃 动作 / 🌍 环境 / 🎛️ 场景 / ⚙️ 设置 / 📊 统计附加行）；
   *  无 dockGroup 只出现在设置聚合视图。
   *  [ADR-159] "stats" = 统计附加行通道：适配器贡献 kind:"field" 节点（如资源包立方体数），
   *  mergeStatsMenuItems 将其并入统计面板 children，随「能渲染就能出统计」通道展示 */
  dockGroup?: PreviewDockGroup;
  // 可见性统一走 visibleWhen（[doc:adr-126-p4-d] 谓词化收口）：sharedOnly/hideInSelfMode/
  // requiresEnvironment 三个专有布尔已删除——dock 组过滤（menu/core.ts dockGroupItemsFor）
  // 与内容级渲染（render.ts）共用同一求值器，谓词吃状态层快照
  //   - self 模式隐藏 → (s) => s["ui.mode"] !== "self"
  //   - 环境能力门禁 → (s) => !!s["env.skyGroundCap"]

  /** row 类型：行首焦点钮（radio 语义，ADR-193 第四刀 roles 角色行首用）——
   *  active 显 ● / ○，onClick 供焦点切换（如 sceneRegistry.setActive） */
  radio?: { active: boolean; title: string; onClick: () => void };
  /** row 类型：行尾徽标按钮（如 roles ⚙ 工具 / switch ➕ 追加）——
   *  独立于整行 action 的行内次级动作 */
  badge?: { label: string; title: string; onClick: () => void };
  /** 危险操作（如删除/卸载），渲染红色文字 */
  danger?: boolean;
  /** [P3 已清退 2026-09-05] 原 legacyTestId e2e 兼容映射字段已删除——查证 e2e（frontend/e2e/）对 legacyTestId/panelTestId/各具体 id 值零消费，淘汰前提失效提前清退；e2e 选择器统一走 data-testid="preview-"+node.id 派生（makePreviewMenuRow）*/
  /** material-row 类型：行内组合控件——eye 显隐 toggle（[doc:adr-126-p5] 审计 #3 组合行增强） */
  eye?: { get: () => boolean; set: (v: boolean) => void };
  /** material-row 类型：行内组合控件——opacity 透明度滑条（显示值 0-100，set 收 0-100） */
  opacity?: { get: () => number; set: (v: number) => void };
  /** row 类型：行密度（可选）。compact = 紧凑导航行（icon+label+箭头等稀疏内容，降
   *  min-height/padding，对齐 scene 组根视图 .cm-row 密度，如 env 面板一级 cap 行）；
   *  缺省 = 标准内容行（roles 角色行等，38px 触控基座）。纯视觉密度，不影响行为。 */
  rowDensity?: "compact";
  /** controls 类型：cap 生态控件组（PreviewControlDef[]），渲染委托 renderCapControls。
   *  传函数引用则每次渲染重取（惰性）——cap 后创建/参数变更后重渲染都能取到最新全量，
   *  与 ADR-125 P3「禁止构建期求值 → cap 后创建则永不可见」同口径。
   *  [ADR-195 刀3] 类型名收敛：控件声明统一 PreviewControlDef（cap 栈渲染），无第二套类型。
   *  新增 cap 控件零接线：cap 自报控件即可进任意声明式面板。 */
  controls?: PreviewControlDef[] | (() => PreviewControlDef[]);
}
