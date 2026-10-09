// ===== 贴地平面分层偏移（拆轴自 scene-capability.ts，锐评 2026-10-07 #6）=====
// 零依赖纯数据叶：ground/water/reflector 三 cap 共享的 z 分层口径，取用按名引用，
// 禁止互相推导（各层方向与量级语义各异）。

/**
 * 贴地平面分层偏移（世界单位；Minecraft 1 单位 = 1 方块，0.01 即厘米级）。
 * z-fighting 防御的唯一口径（2026-09 锐评 P4 收敛）：ground 承接面最上、pool 底微抬、
 * reflector 平面下沉让位——各层方向与量级语义各异，取用时按名引用，禁止互相推导。
 *
 * 注：原 `waterFilm: 0.01`（film 水膜写死高度）已随 ADR-257 删除——film 的水面 y 现由
 * `envState.waterLevel` 驱动（schema 默认 0.15；ADR-319 D1 从 0.01 抬升——水位同时是波高预算的
 * 下钳上限，0.01 会把浪高钳死成平面），是唯一事实源，不再是本分层的常量成员。
 * ⚠️ 与本层 `groundSurface`（0.005）的跨层耦合：`waterLevel` 低于它时水膜被承接面吞掉——
 * 逐字段 schema `range` 管不到这条，登记见 `docs/archive/audit-water-critique.md` P2-1④。
 */
export const GROUND_LAYER_OFFSETS = {
  /** ground 承接面（SurfaceMesh）相对 y=0 的微抬 */
  groundSurface: 0.005,
  /** ADR-249 §2.3 装饰叠加层（透明格线，位于 surface 之上） */
  groundOverlay: 0.007,
  /** water pool 池底相对 y=0 的微抬（贴 GridHelper 基准面） */
  waterPoolBottom: 0.0001,
  /** reflector 平面下沉（位于 ground 承接面之下，两层不相交即无 z-fighting） */
  reflector: -0.01,
} as const;
