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
  // [ADR-250] `render.bloom` 已退表：后处理是视觉项（与 wireframe/pmrem 同类），不进性能档位。
  // 后处理开关唯一入口 = postprocessing cap 自报的 `pp-enabled` 控件（写 envState.ppEnabled）。
  "render.wireframe",
  "env.pmrem",
  // [doc:adr-126-p5-c] 探针：cap 内部状态上浮至状态层快照，供 cap 控件
  // visibleWhen(s) 谓词消费（替代 cap 内 visible? 闭包），打通 B 轨。
  "env.waterMode",
  // [doc:adr-126-p5-c] 探针：cap 内部状态上浮至状态层快照，供 cap 控件
  // visibleWhen(s) 谓词消费（替代 cap 内 visible? 闭包），打通 B 轨。
  // ADR-249 §2.1 拆轴：原单枚举 env.groundMatSource 拆为来源/样式两键。
  "env.groundSourceKind",
  "env.groundCanvasStyle",
  // ADR-249 §2.3 叠加层：独立透明格线层状态上浮
  "env.groundOverlay",
  // ui.activeComponent 已由 per-scene 闭包取代，本键保留仅作类型兼容，不再写入。
  // [doc:adr-126-p4-d] 预览会话模式（shared/self）：mountPreviewRootMenu 入口同步一次，
  // dock 级 visibleWhen 谓词消费（旧 hideInSelfMode/sharedOnly 语义收口到谓词）。
  "ui.mode",
  // [doc:adr-126-p4-d] 环境能力可用性（旧 requiresEnvironment 语义）：sky/ground cap 任一
  // 挂载即 true，经 ADR-168 lookup 注入点惰性解析——caps 后创建由 refreshDock 补回。
  "env.skyGroundCap",
  // 探针：雾模式上浮（fog 的 near/far × density 按 mode 互斥显隐，visibleWhen B 轨消费）。
  "env.fogMode",
  // 探针 [ADR-297]：水面模型倒影开关上浮（reflect 组强度/分辨率/SSR 抑制三从控
  // 仅在主开可见时出场，visibleWhen B 轨消费；water cap 态直读，envState 单真值源）。
  "env.waterReflectionEnabled",
] as const;

/**
 * 状态路径：已落地路径的联合（类型契约 = 运行时实现）。
 * 写未落地键（如 `ui.mode` / `env.sky`）编译报错——把「谓词读黑洞键静默假死」
 * 挡在编译期。新路径两步走：扩 KNOWN_PATHS + 填 bindings。
 * cap 派生探针（env.waterMode / env.ground* / env.fogMode / env.skyGroundCap 类）
 * 入册另有三条门槛（判定输入须是 cap 态上浮值 / 三处登记一步不缺 + 活体消费者守卫 /
 * 控件基元归一在 binding 内），见 [ADR-291]。
 */
export type PreviewStatePath = (typeof KNOWN_PATHS)[number];

/**
 * 路径 → 值类型映射（2026 锐评 P1：消灭 getStateValue/setStateValue 的 unknown 擦除）。
 *
 * 读取侧（getStateValue / PreviewSnapshot）按**精确输出域**声明；
 * 写入侧（setStateValue）经 {@link PathInput} 放宽——泛型控件层
 * （PreviewControlDef.setValue: number | string | boolean，menu-node-types）对任意
 * 路径可交付任意基元，binding 内部负责归一（Number()/Boolean()/String()/枚举守卫），
 * 故写入域 = 本路径精确类型 ∪ 控件基元联合（仍比 unknown 严：拒绝 object/undefined）。
 * 新增路径两步走不变：扩 KNOWN_PATHS + 在 PathValue 补值类型 + 填 binding。
 * （cap 派生探针的入册门槛见 [ADR-291]。）
 */
export type PathValue = {
  "render.frustumCull": boolean;
  "render.maxFps": number;
  "render.maxPixelRatio": number;
  "render.wireframe": boolean;
  "env.pmrem": boolean;
  "env.waterMode": string;
  "env.groundSourceKind": string;
  "env.groundCanvasStyle": string;
  // ADR-249 §2.3 叠加层：独立透明格线层状态上浮
  "env.groundOverlay": string;
  "ui.mode": "shared" | "self";
  "env.skyGroundCap": boolean;
  "env.fogMode": string;
  "env.waterReflectionEnabled": boolean;
};

/** 写入侧输入域：精确类型 ∪ 控件基元（binding 归一后落精确类型） */
export type PathInput<K extends PreviewStatePath> = PathValue[K] | number | string | boolean;

/**
 * 状态层快照：`visibleWhen: (s: PreviewSnapshot) => boolean` 纯函数谓词吃的快照形状。
 * 由 state/preview-state.ts `previewSnapshot()` 产出（每键值类型经 PathValue 精确映射）。
 * 键位 = KNOWN_PATHS（全部有真实来源，无黑洞键）。
 * [doc:adr-126-p4-d] 与 AGENTS.md「3d菜单只允许 visibleWhen: (s) => boolean」对齐。
 * 旧 Record<PreviewStatePath, unknown> 的结构超集——Partial<PreviewSnapshot> 消费方零改动。
 */
export type PreviewSnapshot = { [K in PreviewStatePath]: PathValue[K] };
