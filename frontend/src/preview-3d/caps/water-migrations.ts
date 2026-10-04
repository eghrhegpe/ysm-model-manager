// ===== [锐评 2026-10-04 P1-4] 水面存档旧默认值迁移（纯函数，零 THREE / 零 DOM）=====
// 范式对齐 `caps/environment-migrations.ts`：迁移逻辑住 cap 侧纯函数模块，loadState 只负责调用与落地。
//
// 背景：ADR-319 D1 把 `waterLevel` 的 schema 默认从 0.01 抬到 0.15（0.01 会把浪高预算
// `effectiveWaveHeight` 钳到 1 cm、水面退化成平面）。但 `saveState` 遍历 schema 键集、
// **恒写 `waterLevel`** ⇒ 存量存档把旧默认原样带回：新默认只对「新装 / 清过档」的用户生效，
// 老用户升级后拖浪高几乎无变化（「浪死平」观感原样保留）。
//
// 判据（宁可窄，不可误伤）：
//  · 只迁移「存档里记录的水位 **严格等于**旧默认 0.01」——这不是用户选择，是一个已退役的默认值；
//  · 只迁移**无版本戳**的档（ADR-319 之前保存的）。带 `WATER_SCHEMA_VERSION` 的新档一律不动，
//    故用户手动把水位设成 0.01 也永远安全（新档 save/load 往返恒等）。
// 边界：氛围预设是**快照语义**（走 setEnvState，不经 loadState），不受本迁移影响——ADR-319 §3
// 已声明「预设快照与新默认不同步」属可接受代价，本函数不越权去改它。
import { ENV_STATE_SCHEMA } from "@/preview-3d/state/env-state-schema.ts";

/** 水面存档 schema 版本戳的键名。**不是参数键**：不入 env-state schema、不参与 `restoreBySchema`，
 *  唯一消费者 = `water-capability.ts|loadState` 的迁移判据（新增存档键必须自证有读侧消费者）。 */
export const WATER_SCHEMA_VERSION_KEY = "__waterSchemaVersion";
/** 当前水面存档 schema 版本：≥2 = ADR-319 D1 之后（水位默认 0.15）。 */
export const WATER_SCHEMA_VERSION = 2;

/** ADR-319 D1 之前 `waterLevel` 的 schema 默认值——旧档迁移的唯一判据。
 *  字面量是历史事实（该值已不在 schema 里），不得引现 schema 默认。 */
export const LEGACY_DEFAULT_WATER_LEVEL = 0.01;

/**
 * 旧档水位默认值迁移：返回要写入的水位（= 现 schema 默认），`undefined` 表示不动。
 * @param archivedLevel 存档里记录的 `waterLevel`（缺失 = undefined）
 * @param schemaVersion 存档版本戳（ADR-319 之前的档没有 → undefined）
 */
export function migrateLegacyWaterLevel(
  archivedLevel: unknown,
  schemaVersion: unknown,
): number | undefined {
  if (schemaVersion === WATER_SCHEMA_VERSION) return undefined;
  if (archivedLevel !== LEGACY_DEFAULT_WATER_LEVEL) return undefined;
  return ENV_STATE_SCHEMA.waterLevel.default;
}
