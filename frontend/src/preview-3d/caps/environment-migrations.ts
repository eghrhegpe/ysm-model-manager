// ===== environment 存档迁移纯函数（ADR-292 D5/D7 迁移语义）=====
// 「环境贴图来源」收口（scene.environment 所有权归 EnvironmentCapability 独占）后，
// 旧存档里的 sky IBL 开关（sky 槽的 `environment` 布尔）需要归一为新键 `envSource`。
// 本模块是「存档 → 当前键形」适配器——零 THREE / 零 DOM / 零 envState 依赖，node 可测
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

/** 环境贴图数据源（ADR-292 D3/D5）。单一事实源——渲染分支与 UI radio 均由此派生。 */
export type EnvSource = "preset" | "sky" | "custom";

/** 迁移所需的两个存档片段（分属两个 cap 的 localStorage 槽，由调用方读齐后传入） */
export interface EnvMigrationInput {
  /**
   * environment 槽的 `preset` 字段（`EnvPresetId` 字符串）。
   * 非 string / 缺失 → 视为未设置（按默认 "sky" 处理）。
   */
  preset?: unknown;
  /**
   * **sky 槽**的 `environment` 布尔（sky IBL 开关）。
   * ⚠️ 与 cap 自身的 `enabled` 不同源——调用方须从 sky 槽读取。
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
 * 原 `skyEnvironment` 的承载键（sky 槽的 `environment`）不在此消费——它属 sky 槽，
 * 由 sky 侧 loadState 决定是否忽略；本函数只产出 env 侧的新键。
 * 传入的 `skyEnvironment` / `envEnabled` 是**读值依据**，不写入结果对象。
 *
 * @param state 任一存档对象（不 mutate）
 * @param input 跨槽读值（sky IBL 开关 + env 总开关）
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
