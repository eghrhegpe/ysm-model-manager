// ===== preview-paths.ts — 状态层路径契约叶子（ADR-168 二期下沉产物）=====
//
// 零依赖叶子：KNOWN_PATHS（值）+ PreviewStatePath + PreviewSnapshot（类型）。
// 2026-09-03 自 preview-state.ts 下沉——该文件原持三件套，被 caps/scene-capability.ts
// 以 `import type { PreviewSnapshot }` 反向引用，构成「scene-capability ⇄ preview-state」
// 纯 type 环（madge）。下沉后本文件无任何 import，环消。
//
// 引用规则：
//   - preview-state.ts（运行时实现）import 本文件 KNOWN_PATHS，并 re-export 三件套
//     保既有公共面（menu/render.ts、perf-presets.ts、caps/*、adapters/* 的 import 不动）。
//   - 类型契约消费者（caps/scene-capability.ts 等）可直接 import 本叶子。
//
// 血统：ADR-125 P1 收编六项横切设置 → ADR-126 P4-A 升格 KNOWN_PATHS 命名 →
// ADR-129 第一刀类型归位 state → ADR-168 二期契约独立叶子（本文件）。

/**
 * 本层已落地的横切设置路径（ADR-125 P1 收编六项，ADR-126 P4-A 升格为 KNOWN_PATHS 命名）。
 *
 * 2026-09 收紧：`PreviewStatePath` 类型 = 本集合（类型契约即运行时实现）。
 * 原「7 域模板字面量宽类型」让未落地键（如 ui.mode / env.sky）在类型层合法、
 * 运行时却恒 undefined——谓词读它们静默假死。现未落地键在编译期即报错：
 * 新增路径必须「扩 KNOWN_PATHS + 填 binding」两步走，缺一步编译不过。
 */
export const KNOWN_PATHS = [
  "render.frustumCull",
  "render.maxFps",
  "render.maxPixelRatio",
  "render.bloom",
  "render.wireframe",
  "env.pmrem",
  // [doc:adr-126-p5-c] 探针：cap 内部状态上浮至状态层快照，供 cap 控件
  // visibleWhen(s) 谓词消费（替代 cap 内 visible? 闭包），打通 B 轨。
  "env.waterMode",
  "env.groundMatSource",
  // [doc:adr-126-p5-b] 组件选择（YSM 多组件模型）：-1 = All，其余 = 组件下标。
  // 会话态不落盘；面板侧 subscribe 变更 → 调 showModelGroup 副作用（views 层装配）。
  "ui.activeComponent",
  // [doc:adr-126-p4-d] 预览会话模式（shared/self）：mountPreviewRootMenu 入口同步一次，
  // dock 级 visibleWhen 谓词消费（旧 hideInSelfMode/sharedOnly 语义收口到谓词）。
  "ui.mode",
  // [doc:adr-126-p4-d] 环境能力可用性（旧 requiresEnvironment 语义）：sky/ground cap 任一
  // 挂载即 true，经 ADR-168 lookup 注入点惰性解析——caps 后创建由 refreshDock 补回。
  "env.skyGroundCap",
] as const;

/**
 * 状态路径：已落地路径的联合（类型契约 = 运行时实现）。
 * 写未落地键（如 `ui.mode` / `env.sky`）编译报错——把「谓词读黑洞键静默假死」
 * 挡在编译期。新路径两步走：扩 KNOWN_PATHS + 填 bindings。
 */
export type PreviewStatePath = (typeof KNOWN_PATHS)[number];

/**
 * 状态层快照：`visibleWhen: (s: PreviewSnapshot) => boolean` 纯函数谓词吃的快照形状。
 * 由 state/preview-state.ts `previewSnapshot()` 产出（Record<PreviewStatePath, unknown>）。
 * 键位 = KNOWN_PATHS（全部有真实来源，无黑洞键）。
 * [doc:adr-126-p4-d] 与 AGENTS.md「3d菜单只允许 visibleWhen: (s) => boolean」对齐。
 */
export type PreviewSnapshot = Record<PreviewStatePath, unknown>;
