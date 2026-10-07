// ===== environment 存档迁移纯函数（ADR-292 D5/D7 迁移语义）=====
// 「环境贴图来源」收口（scene.environment 所有权归 EnvironmentCapability 独占）后，
// 旧存档里的 sky IBL 开关（sky 槽的 `environment` 布尔）需要归一为新键 `envSource`。
// 本模块是「存档 → 当前键形」适配器——零 THREE / 零 DOM / 零**运行时** envState 依赖
// （schema 值域仅 `import type` 派生，编译期擦除），node 可测
// （与 ground-migrations.ts 同口径的可测性契约）。
//
// 迁移语义（ADR-292 §3.3，2026-09-21 用户拍板）：
//
//   判据总纲 = **保画面不变**。旧世界里 sky 与 env 两个 cap 同写 scene.environment，
//   env cap 构造在后（基础卡 sky → 氛围卡 env）且 loadState 末尾显式 buildEnvironment()，
//   故 **env 后写胜出**——旧存档的可见画面由 env 侧决定，除非 env 功能被整体关掉。
//
//   ① env 关闭 + sky IBL 开  → "sky"
//      唯一能证明「用户真的要天空 IBL」的强信号：他关掉了整个环境贴图功能、
//      却留着天空 IBL。此组合下旧世界画面 = 天空烘的 IBL，迁 "preset" 会**丢画面**。
//   ② preset === "custom"（且 HDR 缓存仍在）→ "custom"
//      用户显式加载过 HDR 文件，画面 = HDR。注意 HDR 二进制不入存档，
//      「缓存是否仍在」由 cap 侧判定（本纯函数只看存档里的 preset 字符串）。
//   ③ 其余  → "preset"
//      含「preset=sky（默认）+ sky IBL 开」这一**默认路径**：用户从未表达过
//      「我要天空 IBL」，他只是没关默认开启的开关。把「没关」解读成「我要」是
//      过度解读，且会把默认路径上的所有用户迁进 "sky"、画面从 env 预设突变为天空 IBL。
//
// 优先级：① > ② > ③（互斥且穷尽）。
//
// 幂等：输入已含 envSource 键 → 返回**同一引用**（零拷贝快路），绝不 mutate 入参。

import type { EnvState } from "@/preview-3d/state/env-state-schema.ts";

/**
 * 环境贴图数据源（ADR-292 D3/D5）。渲染分支与 UI radio 均由此派生。
 *
 * **派生自 schema 值域**（`env-state-schema.ts|envSource.values`）——ADR-283 定 schema 为值域
 * 唯一事实源。[锐评 P0-① 收口 2026-10-07] 原为手写字面量 union，与 schema 侧各自声明同一组值：
 * 加第 4 个来源只改一处即静默分叉。改派生后 `EnvState["envSource"]` 与 schema 恒同步，
 * 加值只动 `env-state-schema.ts` 一处（`environment-migrations.test.ts` 有值域对账测试兜底）。
 *
 * ⚠️ 本模块仍是**零运行时依赖**：上方是 `import type`（编译期擦除），node 直测契约不变。
 */
export type EnvSource = EnvState["envSource"];

/** 迁移所需的两个存档片段（分属两个 cap 的 localStorage 槽，由调用方读齐后传入） */
export interface EnvMigrationInput {
  /**
   * environment 槽的 `preset` 字段（`EnvPresetId` 字符串）。
   * 非 string / 缺失 → 视为未设置（按默认 "sky" 处理）。
   */
  preset?: unknown;
  /**
   * sky IBL 开关（`environment` 布尔）。
   * ⚠️ 与 cap 自身的 `enabled` 不同源。[cross-slot 解耦 2026-10-07] 调用方改读
   * envState.skyEnvironment 单一事实源（生产 loadAll 里 sky.loadState 先恢复，
   * 与旧跨槽读 sky 存档等价）——本纯函数本身保持槽无关（node 可测不变）。
   */
  skyEnvironment?: unknown;
  /** environment 槽的 `enabled`（env 功能总开关）。false = 用户关掉了整个环境贴图功能。 */
  envEnabled?: unknown;
}

/**
 * 旧存档 → `envSource`（ADR-292 §3.3 三条判据）。
 *
 * @param input 两个 cap 槽的片段（见 {@link EnvMigrationInput}）
 * @returns 归属后的来源。三判据互斥穷尽，恒有值。
 */
export function migrateEnvSource(input: EnvMigrationInput): EnvSource {
  const skyIblOn = input.skyEnvironment === true;
  const envOff = input.envEnabled === false;
  const preset = typeof input.preset === "string" ? input.preset : "sky";

  // ① 强意图：env 关掉却留天空 IBL → 旧画面就是天空烘的图
  if (skyIblOn && envOff) return "sky";

  // ② 显式自定义 HDR
  if (preset === "custom") return "custom";

  // ③ 默认：env 侧胜出（含 default 路径 preset=sky + skyIbl 开）
  return "preset";
}

/**
 * 把旧存档对象归一为含 `envSource` 的当前键形。
 *
 * 判据：**存档里没有 `envSource` 键** ⇒ 旧存档，按 {@link migrateEnvSource} 补写。
 * 已含该键 ⇒ 直接返回**同一引用**（幂等快路，零拷贝）。
 *
 * `skyEnvironment` 的承载键（sky 槽的 `environment`）**由 sky 侧独占消费**——sky.loadState
 * 把它恢复进 `envState.skyEnvironment`，env 侧经该单一事实源取值（2026-10-07 cross-slot 解耦后
 * env 不再跨槽读 sky 槽）；本函数只产出 env 侧的新键。
 * 传入的 `skyEnvironment` / `envEnabled` 是**读值依据**，不写入结果对象。
 *
 * @param state 任一存档对象（不 mutate）
 * @param input 迁移读值（sky IBL 开关「经 envState.skyEnvironment」+ env 总开关）
 */
export function normalizeEnvLegacyState(
  state: Record<string, unknown>,
  input: EnvMigrationInput,
): Record<string, unknown> {
  if ("envSource" in state) return state; // 幂等快路：已是新键形
  const out = { ...state };
  out.envSource = migrateEnvSource({
    preset: input.preset ?? state.preset,
    skyEnvironment: input.skyEnvironment,
    envEnabled: input.envEnabled ?? state.enabled,
  });
  return out;
}
