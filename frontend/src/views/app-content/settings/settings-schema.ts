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

/** 链接模式枚举（整合包 relink 的三种模式：复制 / 硬链接 / 符号链接）。
 *  option 渲染 / hint 显隐顺序的单一来源（替代 init.ts 本地 LINK_MODE_KEYS 副本——
 *  与 MIRROR_SOURCES 同款病：加第四种模式时 hint 显隐与模板 option 漏一处即静默漂移）。
 *  注意与「存储层 linkMode」区分：本枚举是 UI 下拉值域，path-cards.ts|saveCfg 的
 *  patch.linkMode 与 cfg.linkMode 同写同读本值域（缺省回退 copy）。 */
export const LINK_MODES = ["copy", "hardlink", "symlink"] as const;
export type LinkMode = (typeof LINK_MODES)[number];

/** 默认链接模式（copy = 复制，最通用兜底）。 */
export const LINK_MODE_DEFAULT: LinkMode = "copy";

// ===== ADR-307 D3 扩编（2026-10 锐评收债）：外观/更新域值域收编 =====
// 此前这些值域散在「模板裸 <option> + ui-prefs.ts 本地 scaleMap/白名单 + init.ts 默认字面量」
// 三处各写一份——与镜像源 option 半截接线同款病（加档位/改默认漏一处即静默漂移）。
// 收编原则不变：本文件只载枚举 + 顺序 + 默认，文案键映射归消费面（Record 护栏逼同步）。

/** 字号五档枚举（ui-prefs.ts|applyUIPrefs 的 scaleMap 值域 + 模板 option 渲染单一来源）。
 *  UI 顺序 = 由细到粗；五档 px 偏移语义（−2/+0/+2）留消费面 ui-prefs。 */
export const FONT_SIZE_LEVELS = ["xsmall", "small", "normal", "medium", "large"] as const;
export type FontSizeLevel = (typeof FONT_SIZE_LEVELS)[number];

/** 默认字号（normal = 标准 0px 偏移；ui-prefs 各回退字面量自此引用）。 */
export const FONT_SIZE_DEFAULT: FontSizeLevel = "normal";

/** 卡片密度枚举（ui-prefs.ts compact/normal 二值域；模板 option 渲染单一来源）。
 *  加第三档（如「舒适」）：此处加成员 → 消费面 Record 文案表编译期报错；
 *  ⚠️ ui-prefs 的 px 三元（6/10 两档）是二值域特化逻辑，第三档须同步改其映射。 */
export const DENSITY_LEVELS = ["compact", "normal"] as const;
export type DensityLevel = (typeof DENSITY_LEVELS)[number];

/** 默认密度（compact = 紧凑）。 */
export const DENSITY_DEFAULT: DensityLevel = "compact";

/** 创作者名字体枚举（ui-prefs.ts|applyUIPrefs displayFont 二值域）。 */
export const DISPLAY_FONTS = ["kaiti", "system"] as const;
export type DisplayFont = (typeof DISPLAY_FONTS)[number];

/** 默认创作者字体（kaiti = 楷体）。 */
export const DISPLAY_FONT_DEFAULT: DisplayFont = "kaiti";

/** 更新检查间隔（ms）枚举：6h / 12h / 24h / 0=关闭。UI 顺序 = 选项渲染序。
 *  裸毫秒曾散在模板 option（tpl-settings-about.ts）+ init.ts 默认回退 + version-updater.ts
 *  CHECK_INTERVAL（6h 兜底）三处各写一份。⚠️ version-updater 属 features 域（启动链），
 *  不得反向 import views 层叶——其 CHECK_INTERVAL 是跨域副本，须与 UPDATE_CHECK_DEFAULT 手工
 *  保持相等（注释互指，契约测试锁定 6h 语义）；能收编的模板 option 与 init 默认在本轮接上。 */
export const UPDATE_CHECK_INTERVALS = [21600000, 43200000, 86400000, 0] as const;
export type UpdateCheckInterval = (typeof UPDATE_CHECK_INTERVALS)[number];

/** 默认更新检查间隔（6h；init.ts 缺省回退自此引用，与 version-updater.ts CHECK_INTERVAL 同源 6h）。 */
export const UPDATE_CHECK_DEFAULT: UpdateCheckInterval = 21600000;
