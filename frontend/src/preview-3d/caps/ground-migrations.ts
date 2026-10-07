// ===== ground 存档迁移纯函数（锐评「迁移考古层下沉」2026-09-21）=====
// GroundCapability.loadState 的三代存档归一逻辑整体迁入本模块：capability 回归
// 「状态 → Three」适配器本职，本文件是「存档 → 当前键形」适配器——零 THREE / 零 DOM /
// 零 envState 依赖，node 可测（与 ground-surface-spec.ts 同口径的可测性契约）。
//
// 三代考古（行为逐条复刻自 loadState 内联段，回归锚见 ground-migrations.test.ts）：
//   代数一  ADR-196 前扁平无前缀存档 {visible, size, matSource, matColor...}
//           → 前缀化 {groundVisible, groundSize, ...}；判据 = 存在任一旧无前缀键
//           （锐评 P4：旧判据「缺 groundSize」恒真已废，混合存档照常进分支）。
//   代数二  旧单枚举 matSource（ADR-252 前 9 值）→ 来源轴 + 材质轴 + 叠加层三轴
//           （migrateGroundMatSource），图案值并把线色/格数搬入叠加层（视觉等价）。
//   代数三  ADR-249~252 之间存档的图案型 groundCanvasStyle（grid/checker/stripes/
//           diamond）→ plain 底座 + 同名叠加层，同样搬运线色/格数。
import {
  LEGACY_CANVAS_PATTERNS,
  type LegacyGroundMatSource,
  migrateGroundMatSource,
} from "./ground-surface-spec.ts";

/** 代数一的旧无前缀键清单（判据 + 搬运源；matSource 单独走三轴拆分，
 *  matLineColor 由 ADR-252 规则搬入叠加层——两者均不在 LEGACY_KEY_MAP 直搬表内） */
const LEGACY_GROUND_KEYS = [
  "visible",
  "size",
  "divisions",
  "colorCenter",
  "colorGrid",
  "matSource",
  "matColor",
  "matColor2",
  "matGridSize",
  "matOpacity",
  "matScale",
  "matDensity",
  "matAngleDeg",
  "matRoughness",
  "matMetalness",
] as const;

/** 旧无前缀键 → 新前缀键映射（matSource 系三轴拆分入口，不在表内直搬） */
const LEGACY_KEY_MAP: Record<string, string> = {
  visible: "groundVisible",
  size: "groundSize",
  divisions: "groundDivisions",
  colorCenter: "groundColorCenter",
  colorGrid: "groundColorGrid",
  // matLineColor 刻意不入表：其值由 ADR-252 规则搬入 groundOverlayColor，
  // 原键随 legacy 分支整体丢弃（不保留死镜像键）
  matColor: "groundMatColor",
  matColor2: "groundMatColor2",
  matGridSize: "groundMatGridSize",
  matOpacity: "groundMatOpacity",
  matScale: "groundMatScale",
  matDensity: "groundMatDensity",
  matAngleDeg: "groundMatAngleDeg",
  matRoughness: "groundMatRoughness",
  matMetalness: "groundMatMetalness",
};

/**
 * 把任意世代的 ground 存档归一为当前键形（restoreFields 可直接消费）。
 * 幂等：输入已是新键形时返回**同一引用**（零拷贝快路）；否则返回新对象，
 * 绝不 mutate 入参。非 ground 无关键（如 cap 私有的 enabled）原样透传。
 *
 * 三代各自具名（见下方 helper）：代数一/二 → migrateLegacyGroundState、代数三 →
 * liftLegacyCanvasPattern。主函数只做「读旧线色/格数 → 分支 → 进代数三」，零嵌套。
 */
export function normalizeGroundLegacyState(
  state: Record<string, unknown>,
): Record<string, unknown> {
  // ADR-252：旧线色/格数需搬入叠加层（图案由 surface 迁至 overlay 时带走样式参数）。
  // 两代读法并存：扁平时代读 matLineColor/matGridSize，混合时代可能已带前缀。
  const legacyLineColor = numOr(state, "matLineColor") ?? numOr(state, "groundMatLineColor");
  const legacyGridSize = numOr(state, "matGridSize") ?? numOr(state, "groundMatGridSize");

  // ── 代数一 + 二：存在任一旧无前缀键 → 前缀化搬运 + matSource 拆三轴 ──
  const migrated = hasLegacyUnprefixedKey(state)
    ? migrateLegacyGroundState(state, legacyLineColor, legacyGridSize)
    : state;

  // ── 代数三：ADR-249 时代存档的图案型 groundCanvasStyle 进位叠加层 ──
  return liftLegacyCanvasPattern(migrated, legacyLineColor, legacyGridSize);
}

/** 代数一/二触发判据：存在任一旧无前缀键。
 *  （锐评 P4：旧判据「缺 groundSize」恒真已废，混合存档照常进分支。） */
function hasLegacyUnprefixedKey(state: Record<string, unknown>): boolean {
  return LEGACY_GROUND_KEYS.some((k) => k in state);
}

/** 代数一 + 二：前缀化搬运（含已前缀键保底透传）+ matSource 拆三轴。返回新对象。 */
function migrateLegacyGroundState(
  state: Record<string, unknown>,
  legacyLineColor: number | undefined,
  legacyGridSize: number | undefined,
): Record<string, unknown> {
  const migrated: Record<string, unknown> = {};
  for (const k of LEGACY_GROUND_KEYS) copyLegacyKey(state, migrated, k);
  carryOverPrefixedKeys(state, migrated);
  // ADR-249 §2.1 + ADR-252：旧单枚举 matSource 拆为来源轴 + 材质轴 + 叠加层
  if ("matSource" in state) applyLegacyMatSource(state, migrated, legacyLineColor, legacyGridSize);
  return migrated;
}

/** 旧无前缀键 → 新前缀键直搬（matSource 系三轴拆分入口，不在表内直搬）。
 *  判据 `key in state && target` 逐字保持：`target` 缺省仅对 matSource 成立。 */
function copyLegacyKey(
  state: Record<string, unknown>,
  migrated: Record<string, unknown>,
  key: string,
): void {
  const target = LEGACY_KEY_MAP[key];
  if (!(key in state) || !target) return;
  migrated[target] = state[key];
}

/** 保底透传：混合存档（部分字段已升级）若整对象替换会把已前缀化的字段静默
 *  丢弃（审核回归实测：{visible, groundCanvasStyle} 混合 → canvasStyle 丢失）。
 *  判据逐字保持原实现 = 「ground 前缀且未被旧键映射占用」；旧键均不带 ground
 *  前缀故无冲突，matSource 不满足判据、由三轴拆分单独消费。 */
function carryOverPrefixedKeys(
  state: Record<string, unknown>,
  migrated: Record<string, unknown>,
): void {
  for (const [k, v] of Object.entries(state)) {
    if (k.startsWith("ground") && !(k in migrated)) migrated[k] = v;
  }
}

/** 代数二：旧单枚举 matSource → 来源轴 + 材质轴 + 叠加层。
 *  旧图案值 → 叠加层，并把线色/格数一并搬过去（视觉等价）。 */
function applyLegacyMatSource(
  state: Record<string, unknown>,
  migrated: Record<string, unknown>,
  legacyLineColor: number | undefined,
  legacyGridSize: number | undefined,
): void {
  const m = migrateGroundMatSource(String(state.matSource) as LegacyGroundMatSource);
  migrated.groundSourceKind = m.sourceKind;
  if (m.canvasStyle) migrated.groundCanvasStyle = m.canvasStyle;
  if (!m.overlayStyle) return;
  migrated.groundOverlay = m.overlayStyle;
  if (legacyLineColor !== undefined) migrated.groundOverlayColor = legacyLineColor;
  if (legacyGridSize !== undefined) migrated.groundOverlaySize = legacyGridSize;
}

/** 代数三触发条件：ADR-249 时代的图案型 groundCanvasStyle（白名单闭集）。 */
function isLegacyPatternStyle(v: unknown): v is string {
  return typeof v === "string" && (LEGACY_CANVAS_PATTERNS as readonly string[]).includes(v);
}

/** 代数三：ADR-249 时代存档的图案型 groundCanvasStyle 进位叠加层（底座归 plain），
 *  线色/格数仅在该轴尚无值（undefined 门）时搬运。无匹配 → **原引用**返回
 *  （幂等零拷贝快路：已是新键形的存档不得被复制）。 */
function liftLegacyCanvasPattern(
  out: Record<string, unknown>,
  legacyLineColor: number | undefined,
  legacyGridSize: number | undefined,
): Record<string, unknown> {
  const rawStyle = out.groundCanvasStyle;
  if (!isLegacyPatternStyle(rawStyle)) return out;
  const lifted: Record<string, unknown> = { ...out, groundCanvasStyle: "plain" };
  if (lifted.groundOverlay === undefined || lifted.groundOverlay === "none") {
    lifted.groundOverlay = rawStyle;
  }
  if (legacyLineColor !== undefined && lifted.groundOverlayColor === undefined) {
    lifted.groundOverlayColor = legacyLineColor;
  }
  if (legacyGridSize !== undefined && lifted.groundOverlaySize === undefined) {
    lifted.groundOverlaySize = legacyGridSize;
  }
  return lifted;
}

/** 数值安全读（仅当 own property 且为 number 时返回，否则 undefined） */
function numOr(state: Record<string, unknown>, key: string): number | undefined {
  const v = state[key];
  return typeof v === "number" ? v : undefined;
}
