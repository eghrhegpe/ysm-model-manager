// ===== 3D 预览底部根菜单（ADR-076 v3：底部根菜单 + SlideMenu 多层派生，按能力动态显示）=====
// 对齐 MikuMikuAR 范式：底部根按钮 → createSlideMenu 多层导航。
// 唯一事实来源：仅描述结构（id / icon / labelKey / fallback / kind / 能力门槛）。
// 渲染与 handler 见 preview-menu.ts；测试遍历本表 + 适配器真实注入项断言结构与
// dock 渲染（preview-menu-items.test.ts，对齐 MikuMikuAR 声明式菜单测试范式）。
//
// 整条链路已统一 PreviewMenuNode（方案 A 收尾）：CORE_MENU_ITEMS 与适配器注入
// 都是 PreviewMenuNode[]，不再有 PreviewMenuItemDef 往返转换。

import type { PreviewMenuNode } from "./node-types.ts";
//
// 能力驱动显示（用户 2026-08-16 决策 + 2026-08-19 环境拆组）：
// - 有骨骼/模型工具（适配器注入 model 组项）→ 显示「🧍 模型」
// - 有动作/播放（适配器注入 motion 组项）→ 显示「💃 动作」
// - 有环境能力（shared 模式 + sky/ground cap）→ 显示「🌍 环境」
//   （环境体量 > 全部场景设置：sky/ground/env/fog/reflector 聚合一面板，
//    后续地面/水面系统继续膨胀也不挤占场景组）
// - 有场景/相机能力（shared 模式）→ 显示「🎛️ 场景」

export type PreviewMenuGroupId = "model" | "motion" | "env" | "scene" | "settings";

/** 底栏分组定义（能力驱动：组内无任何可显示项时不渲染该组按钮） */
export interface PreviewMenuGroupDef {
  id: PreviewMenuGroupId;
  icon: string;
  /** i18n 键（dock 按钮/组标题文案）；缺失时回退 fallback（tr 兜底，杜绝裸中文） */
  labelKey: string;
  /** i18n 缺失时的回退文案 */
  fallback: string;
  /** [S5 收口] 静态直达面板声明：点击 dock 按钮首跳该 panel 节点 id（渲染函数数据驱动，
   *  新增「静态直达」组零改 core.ts）；缺省走通用逻辑（单 panel 直达 / 组根视图）。
   *  动态直达（如 motion 依赖活跃角色详情）无法静态声明，见 core.ts 唯一特例标注。 */
  directToPanel?: string;
}

export const PREVIEW_MENU_GROUPS: PreviewMenuGroupDef[] = [
  // dock 按钮文案与落地面板语义对齐（2026-08-28）：🧍 组点击直达 roles 面板（加载角色），
  // 原 fallback「模型」与落地标题「加载角色」错位——改「角色」按钮即面板，用户无转译歧义
  { id: "model", icon: "🧍", labelKey: "preview.groupModel", fallback: "角色", directToPanel: "roles" },
  { id: "motion", icon: "💃", labelKey: "preview.groupMotion", fallback: "动作" },
  // 环境独立成组（2026-08-19 拆组）：体量 > 全部场景设置（sky/ground/env/fog/reflector），
  // 且地面/水面系统后续会持续膨胀，单独 root 按钮避免场景组挤爆
  { id: "env", icon: "🌍", labelKey: "preview.groupEnv", fallback: "环境" },
  // 场景组只留相机/灯光/阴影/后处理（icon 换 🎛️ 与 🌍 环境区分）
  { id: "scene", icon: "🎛️", labelKey: "preview.groupScene", fallback: "场景" },
  // 设置独立成组：聚合所有场景能力（sky/ground/fog/shadow/reflector/postprocessing/light）的控件，
  // 用户一处调全部，即时生效。与 🌍 环境的区别：环境是能力开关+下钻参数，设置是平铺总览。
  { id: "settings", icon: "⚙️", labelKey: "preview.groupSettings", fallback: "设置" },
];

/**
 * core 固定菜单项（不依赖适配器注入）：
 * - roles：模型组唯一 core 项（已加载角色管理 + 底部内嵌加载入口 fillSwitch；
 *   2026-08-21 合并：独立 switch 项撤除，加载入口收编进角色面板，消灭双入口）
 * - environment / camera：场景组（shared 模式才显示）
 * close 不在此表——关闭由 SlideMenu header 的 ✕ 承担（legacy preview-close-3d 挂在关闭按钮）。
 */
export const CORE_MENU_ITEMS: PreviewMenuNode[] = [
  {
    id: "roles",
    icon: "🎭",
    labelKey: "preview.roles",
    fallback: "加载角色",
    kind: "panel",
    /** 已加载角色列表（MikuMikuAR buildModelRootItems 移植）：焦点切换 + 详情 + 工具 + 加载入口 */
    dockGroup: "model",
    legacyTestId: "ysm-roles-entry",
  },
  {
    id: "environment",
    icon: "🌍",
    labelKey: "preview.environment",
    fallback: "环境",
    kind: "panel",
    dockGroup: "env",
    // 环境能力门禁（requiresEnvironment 谓词化）：sky/ground cap 任一挂载才显示；
    // 经状态层 env.skyGroundCap 惰性解析，caps 后创建由 shared-infra refreshDock 补回
    visibleWhen: (s) => !!s["env.skyGroundCap"],
    legacyTestId: "env-menu-btn",
  },
  {
    id: "camera",
    icon: "🎥",
    labelKey: "preview.cameraView",
    fallback: "视图",
    kind: "panel",
    dockGroup: "scene",
    // self 模式隐藏（hideInSelfMode 谓词化）：相机由适配器自驱，camBridge 控件（旋转/速度/
    // 重置）操作核心 controls 会被适配器每帧覆盖（如 MMD 相机动画），呈现「无效空面板」——
    // 隐藏最诚实。谓词吃状态层 ui.mode（mount 入口同步 ctx.selfMode）
    visibleWhen: (s) => s["ui.mode"] !== "self",
  },
  {
    id: "lighting",
    icon: "💡",
    labelKey: "preview.lighting",
    fallback: "灯光",
    kind: "panel",
    dockGroup: "scene",
  },
  {
    id: "shadow",
    icon: "🌫️",
    labelKey: "preview.shadow",
    fallback: "阴影",
    kind: "panel",
    dockGroup: "scene",
  },
  {
    id: "postproc",
    icon: "🎇",
    labelKey: "preview.postprocessing",
    fallback: "后处理",
    kind: "panel",
    dockGroup: "scene",
  },
  // 设置面板：聚合所有 sceneCapabilityRegistry 中的 cap 控件，平铺渲染。
  // 不走 sharedOnly——self 模式若有 cap 也应可调（self 模式 cap 少，自然降级）。
  // fillSettings 容错：cap 不存在时跳过该分组，不渲染空 section。
  {
    id: "settings",
    icon: "⚙️",
    labelKey: "preview.settings",
    fallback: "设置",
    kind: "panel",
    dockGroup: "settings",
  },
];
