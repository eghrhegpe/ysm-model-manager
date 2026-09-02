// preview-menu-node-types.ts — [doc:adr-093-ysm] Preview 3D 菜单声明式节点类型（纯类型叶，零运行时依赖）。
//
// 从 MikuMikuAR frontend/src/scene/shared/menu-node-types.ts 移植概念（ADR-093 生态）：
//   - MenuNode / MenuKind / ControlSpec / StatePath —— 声明式菜单数据层的类型契约
//   - 补充 ysm 特有字段：dockGroup / sharedOnly / requiresEnvironment（预览器 dock 分组 + self/shared 模式守卫）
//
// 方向：适配器定义「菜单即数据」→ 单一渲染器递归渲染（renderMenu）。
// controls kind 是 cap 生态（MenuControlDef）进 node 树的原生通道——声明式节点
// 可直接持有 MenuControlDef[]（或惰性函数），渲染委托 renderCapControls（唯一控件渲染器）。

// [doc:adr-129-第一刀] PreviewStatePath / PreviewSnapshot 迁至 state/preview-state.ts（本位）；
// 本文件前向 import state 的类型——方向正（菜单节点吃状态层快照），非反向依赖。
import type { PreviewStatePath, PreviewSnapshot } from "../state/preview-state.ts";
import type { MenuControlDef } from "../caps/scene-capability.ts";

/** 动作节点回调上下文（与 ActionMenuCtx 对齐；ysm 侧 toast/closeOverlays 由 ctx.menu 提供） */
export interface PreviewActionMenuCtx {
  toast: (message: string) => void;
  closeAllOverlays: () => void;
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
  | "field" // 键值对行（统计/信息展示）
  | "row" // 列表行（纹理/材质/bone 等动态列表）
  | "divider"
  | "sectionTitle"
  | "material-row" // [doc:adr-126-p5] 组合控件行（label + eye 显隐 + opacity 滑条）——审计 #3 material 声明式化
  | "controls" // 声明式节点直持 MenuControlDef[]（cap 生态原生通道），渲染委托 renderCapControls
  | "custom";

/** 控件绑定规格（slider/toggle/button/field 用；ysm 侧 state 映射表建立后 bind 生效） */
export interface PreviewControlSpec {
  /** 声明式路径（走状态层读写；感知类闭包控件如 perception toggle 无状态层路径——
   *  用 get/set 直接读写，bind 可省略） */
  bind?: PreviewStatePath;
  min?: number;
  max?: number;
  step?: number;
  icon?: string;
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
  /** i18n 缺失时的回退文案 */
  fallback?: string;
  icon?: string;
  /** 仅 folder：默认展开 */
  defaultOpen?: boolean;
  /** folder：子节点（可折叠 section）；panel：面板内容声明式子节点（[doc:adr-126-p4-b-1] renderPreviewPanel children 分支递归 renderMenu） */
  children?: PreviewMenuNode[];
  /** slider/toggle 等控件绑定 */
  control?: PreviewControlSpec;
  /** 静态显示值（field 类型用，无需控制绑定） */
  value?: string | number;
  /** 逃生舱：无法数据化的内容直接渲染；closePopup 可选（兼容 MikuMikuAR 单参用法） */
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
  /** ———— ysm 特有（预览器 dock 归属与模式守卫）———— */
  /** 归属底栏分组（🧍 模型 / 💃 动作 / 🌍 环境 / 🎛️ 场景 / ⚙️ 设置 / 📊 统计附加行）；
   *  无 dockGroup 只出现在设置聚合视图。
   *  [ADR-159] "stats" = 统计附加行通道：适配器贡献 kind:"field" 节点（如资源包立方体数），
   *  mergeStatsMenuItems 将其并入统计面板 children，随「能渲染就能出统计」通道展示 */
  dockGroup?: "model" | "motion" | "env" | "scene" | "settings" | "stats";
  /** 仅 shared 模式显示（self 模式相机由适配器底部导航提供） */
  sharedOnly?: boolean;
  /** self 模式隐藏（相机由适配器自驱时 camBridge 控件语义错位） */
  hideInSelfMode?: boolean;
  /** 仅环境能力可用（skyCap/groundCap 任一非空）时显示 */
  requiresEnvironment?: boolean;

  /** 危险操作（如删除/卸载），渲染红色文字 */
  danger?: boolean;
  /** 兼容既有 e2e 选择器的 legacy data-testid（如 preview-close-3d / env-menu-btn / ysm-roles-entry），渲染为 id 属性 */
  legacyTestId?: string;
  /** material-row 类型：行内组合控件——eye 显隐 toggle（[doc:adr-126-p5] 审计 #3 组合行增强） */
  eye?: { get: () => boolean; set: (v: boolean) => void };
  /** material-row 类型：行内组合控件——opacity 透明度滑条（显示值 0-100，set 收 0-100） */
  opacity?: { get: () => number; set: (v: number) => void };
  /** controls 类型：cap 生态控件组（MenuControlDef[]），渲染委托 renderCapControls。
   *  传函数引用则每次渲染重取（惰性）——cap 后创建/参数变更后重渲染都能取到最新全量，
   *  与 ADR-125 P3「禁止构建期求值 → cap 后创建则永不可见」同口径。
   *  新增 cap 控件零接线：cap 自报 getMenuControls() 即可进任意声明式面板。 */
  controls?: MenuControlDef[] | (() => MenuControlDef[]);
}

/** 类型守卫：节点是否为 folder（可下钻） */
export function isPreviewFolderNode(n: PreviewMenuNode): boolean {
  return n.kind === "folder" || Array.isArray(n.children);
}

/** 递归收集全部叶子节点（folder 展开；供测试/审计遍历） */
export function collectPreviewLeafNodes(nodes: PreviewMenuNode[]): PreviewMenuNode[] {
  const out: PreviewMenuNode[] = [];
  for (const n of nodes) {
    if (n.kind === "folder" || Array.isArray(n.children)) {
      out.push(...collectPreviewLeafNodes(n.children ?? []));
    } else {
      out.push(n);
    }
  }
  return out;
}

/** 递归收集全部节点 id（供 id 唯一性契约测试） */
export function collectPreviewNodeIds(nodes: PreviewMenuNode[]): string[] {
  const out: string[] = [];
  for (const n of nodes) {
    out.push(n.id);
    if (Array.isArray(n.children)) out.push(...collectPreviewNodeIds(n.children));
  }
  return out;
}
