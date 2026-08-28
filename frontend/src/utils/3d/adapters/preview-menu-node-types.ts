// preview-menu-node-types.ts — [doc:adr-093-ysm] Preview 3D 菜单声明式节点类型（纯类型叶，零运行时依赖）。
//
// 从 MikuMikuAR frontend/src/scene/shared/menu-node-types.ts 移植概念（ADR-093 生态）：
//   - MenuNode / MenuKind / ControlSpec / StatePath —— 声明式菜单数据层的类型契约
//   - 补充 ysm 特有字段：dockGroup / sharedOnly / requiresEnvironment（预览器 dock 分组 + self/shared 模式守卫）
//   - 与既有 PreviewMenuItemDef（preview-menu-defs.ts）建立双向映射：flat 面板项 → 可嵌套节点，
//     节点通过 escapeHatch（renderCustom / action）兼容现有命令式 render/run 逃生舱
//
// 方向：适配器定义「菜单即数据」→ 未来单一渲染器递归渲染（renderMenu），双方都依赖本叶。
// 当前阶段（方案 A 第 1 步）：仅类型层落地，渲染器仍是命令式 preview-menu.ts——本叶先立「数据层契约」，
// 让新增/迁移菜单项时有声明式形状可依，而非继续手写 createElement。

/** 状态路径：类型化字符串（沿用 MikuMikuAR 契约；ysm 侧 state 映射表尚未建立时为占位） */
export type PreviewStatePath =
  | `env.${string}`
  | `render.${string}`
  | `light.${string}`
  | `ui.${string}`
  | `perception.${string}`
  | `motion.${string}`
  | `model.${string}`;

/**
 * 状态层快照：`visibleWhen: (s: PreviewSnapshot) => boolean` 纯函数谓词吃的快照形状。
 * 由 `state/preview-state.ts` 的 `previewSnapshot()` 产出（Record<PreviewStatePath, unknown>）。
 * 未落地路径的值为 undefined（谓词读 `s["ui.mode"]` 安全——falsy）。
 * [doc:adr-126-p4-d] 与 AGENTS.md「3d菜单只允许 visibleWhen: (s) => boolean」对齐。
 */
export type PreviewSnapshot = Record<PreviewStatePath, unknown>;

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
  | "custom";

/** 控件绑定规格（slider/toggle/button/field 用；ysm 侧 state 映射表建立后 bind 生效） */
export interface PreviewControlSpec {
  bind: PreviewStatePath;
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
  /** field 类型：显示值（静态或衍生） */
  value?: string | number | boolean;
  /** button 类型：按钮文案（i18n key 或字面量） */
  text?: string;
}

/** 声明式菜单节点：菜单即数据。与 PreviewMenuItemDef 的映射见 preview-menu-defs.ts 顶部注释 */
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
  /** 逃生舱：无法数据化的内容直接渲染（对应 PreviewMenuItemDef.render）；closePopup 可选（兼容 MikuMikuAR 单参用法） */
  renderCustom?: (container: HTMLElement, closePopup?: () => void) => (() => void) | void;
  /** 条件守卫：吃状态层快照的纯函数，返回 false 时不渲染（如 self 模式隐藏 camera）——[doc:adr-126-p4-d] 升级为 (s: PreviewSnapshot) => boolean */
  visibleWhen?: (s: PreviewSnapshot) => boolean;
  /** [doc:adr-126-p5-a] 受控 schema builder 注册 key：有则 renderPreviewPanel 查 schema-registry 的该 key；
   *  缺省回退 node.id。多模型同框时各适配器用专属 key（如 "ysm-model"）避免互相覆盖 */
  schemaId?: string;
  /** action 节点回调（对应 PreviewMenuItemDef.run） */
  action?: (ctx: PreviewActionMenuCtx) => void | Promise<void>;
  /** ———— ysm 特有（预览器 dock 归属与模式守卫）———— */
  /** 归属底栏分组（🧍 模型 / 💃 动作 / 🌍 环境 / 🎛️ 场景 / ⚙️ 设置）；无 dockGroup 只出现在设置聚合视图 */
  dockGroup?: "model" | "motion" | "env" | "scene" | "settings";
  /** 仅 shared 模式显示（self 模式相机由适配器底部导航提供）——对应 PreviewMenuItemDef.sharedOnly */
  sharedOnly?: boolean;
  /** self 模式隐藏（相机由适配器自驱时 camBridge 控件语义错位）——对应 PreviewMenuItemDef.hideInSelfMode */
  hideInSelfMode?: boolean;
  /** 仅环境能力可用（skyCap/groundCap 任一非空）时显示——对应 PreviewMenuItemDef.requiresEnvironment */
  requiresEnvironment?: boolean;

    /** 危险操作（如删除/卸载），渲染红色文字——对应 PreviewMenuItemDef.danger */
    danger?: boolean;
    /** 兼容既有 e2e 选择器的 legacy data-testid（如 preview-close-3d / env-menu-btn / ysm-roles-entry），渲染为 id 属性 */
    legacyTestId?: string;
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
