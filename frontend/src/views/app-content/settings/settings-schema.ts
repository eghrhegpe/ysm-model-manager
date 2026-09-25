// ===== settings-schema.ts — 主设置页（非 3D）设置项的单一数据源（ADR-307 D3）=====
//
// 对标 preview-3d/infra/settings-schema.ts（ADR-303）的同款纯数据叶形态：零依赖
// （不 import three / DOM / 上层 / i18n），主设置页各面（tpl 模板 / init 绑定 / 测试）
// 安全引用，不给主设置页拉进 3D 预览机械。
// 有意与 3D schema 一致：不在此携带 labelKey 文案映射——值→文案的映射归各消费面
// （如 init.ts 的 MIRROR_I18N_KEY，呼应 preview-3d 的 ROT_MODE_LABEL 留在主设置页域）。
// 本文件只承载「枚举成员 + 顺序 + 默认」这类纯数据；加一项 = 在此加成员 +
// 在消费面补映射/文案，类型系统拦下漏键（替代原 init.ts 本地 MIRROR_KEYS 副本 +
// Record<string, LocaleKey> 松键，后者加镜像源漏文案只在运行时 ?? 兜底，编译期不报错）。

/** 下载镜像源枚举。注意：UI 层 direct 用空串 `""` 表示（set-mirror 首项 value=""），
 *  存储层同样以空串存 direct；本联合的 "direct" 是「归一后的语义值」，消费面读 select.value
 *  时需 `raw === "" ? "direct" : raw` 归一后再索引映射（见 init.ts mirrorName）。 */
export type MirrorSource = "direct" | "jsdelivr" | "githubapi";

/** 镜像源枚举有序列表：option 渲染 / hint 显隐顺序的单一来源（替代原 init.ts 本地 MIRROR_KEYS 副本）。 */
export const MIRROR_SOURCES = [
  "direct",
  "jsdelivr",
  "githubapi",
] as const satisfies readonly MirrorSource[];

/** 默认镜像源（direct = 直连）。 */
export const MIRROR_DEFAULT: MirrorSource = "direct";
