// ===== settings-keys.ts — 设置键台账（键 → 存储轨 → 权威方 → 换机是否迁移）=====
//
// 血统：锐评 2026-10-15 P1 ②。设置分两轨持久化，而历史文档只登记了 Go 磁盘轨
// （`ysm_config.json`）——`docs/guide/backup-migration.md` 的官方迁移指引是
// 「复制 ysm_config.json」，而字体/密度/动画/默认页/键位/3D 偏好等几十项用户设置
// 躺在 localStorage（WebView2 profile 内），换机照文档操作即静默丢失，且无处可查。
// 根因不是漏写文档，是**没人知道一共有哪些键、分别归哪一轨**：键名散落在 40 余个
// 源文件里，写入方与备份叙事互不知情。仿 preview-3d/state/preview-paths.ts|KNOWN_PATHS
// 的「路径表即类型契约」范式，把键的归属收成一处声明，并让 tests/test_settings_key_ledger.ts
// 与真实源码做**双向对账**（漏登记的键 = 红，防新增键只写不登记；登记的死键 = 红，防笔误）。
//
// 本文件是**纯数据叶**：零 import、零运行时行为，声明 + 导出查询函数。之所以放 src 根
// （而非某视图目录）：台账跨越 views / preview-3d / backend / core / utils 五层，
// 放任何一层都会让其余层反向依赖那一层。消费面：备份迁移文档（人工维护的叙事）、
// 设置页「导出设置」类需求（未来）、本次契约测试。
//
// ⚠️ 台账**不参与运行时读写**——不要为了「走台账」把 40 余处 safeGet 改成查表：
// 那会把一张纯数据表变成热路径依赖网，且键的真实权威仍是各模块的读侧口径
// （见每条 authority）。本文件的价值是**让漂移暴露出来**，不是取代权威。

/**
 * 存储轨：这个键的值落在哪。
 *
 * - `go-disk`      — `ysm_config.json`（Go `types.AppConfig` 字段）。唯一随「复制配置文件」
 *                    迁移的一轨。
 * - `local-storage` — 浏览器 localStorage（WebView2 用户 profile 内）。桌面端换机、
 *                    重装、profile 被清 → 全部丢失，**官方迁移流程不含此轨**。
 * - `indexed-db`   — IndexedDB（仅网页模式，`backend/idb.ts`）。同上，且桌面端根本不存在。
 * - `session`      — 会话内存态，不落任何存储。
 */
export type SettingsTier = "go-disk" | "local-storage" | "indexed-db" | "session";

/**
 * 权威方：读写冲突时谁说了算。
 *
 * - `disk-authority`    — `ysm_config.json` 是事实源，localStorage 仅作 Go 不可达时的
 *                         启动兜底壳（不得反向优先，见 theme-core.ts|initTheme 与
 *                         views/config-write.ts|writeAppConfig 两侧同口径断言）。
 * - `browser-authority` — localStorage / IDB 是唯一事实源，无磁盘副本。
 * - `dual-write`        — 两侧都写、互为镜像（如 theme：磁盘权威 + localStorage 镜像）。
 * - `non-persistent`    — 运行期缓存/迁移哨兵，重启重算即可，无用户意图可丢。
 */
export type SettingsAuthority =
  | "disk-authority"
  | "browser-authority"
  | "dual-write"
  | "non-persistent";

/** 一条键登记。`goField` 仅磁盘轨填写（Go 结构体字段名，便于人工回溯源码定位）。 */
export interface SettingsKeyEntry {
  /**
   * 键的登记名。localStorage 轨填真实 localStorage 键；磁盘轨填 Go json 字段名并加
   * `disk:` 命名空间前缀（如 `disk:theme`）。**前缀不是装饰**：theme/themeAuto 这类
   * 键在两轨都有同名物理键（磁盘字段 vs localStorage 镜像），不加前缀两行台账就撞名，
   * 撞名就逼人把两条轨塞进一行——一行只能声明一个 tier，于是镜像的归属被磁盘的
   * 归属吞掉（这正是本文要消灭的那类漂移）。契约测试据此按 `disk:` 前缀分流两轨。
   */
  readonly key: string;
  /** 该键对应的用户设置（台账的主语是「用户会心疼丢的东西」） */
  readonly setting: string;
  readonly tier: SettingsTier;
  readonly authority: SettingsAuthority;
  /**
   * 是否随「复制 ysm_config.json + 仓库目录」的标准迁移流程保住。
   * 恒等于「tier 是否为 go-disk」——非磁盘轨写 true 即为错误登记，契约测试断言。
   */
  readonly migrates: boolean;
  /** 仅磁盘轨：Go `types.AppConfig` 字段名（跨语言回溯用） */
  readonly goField?: string;
  /** 键的持有模块（`file.ts` 形态，具体文件不写——文件会搬家，模块名不会） */
  readonly owner: string;
  /**
   * 键族通配（仅一个尾部/中部 `*`）：`key` 仍是登记名（占位符，如 `ysm-scene-cap-*`），
   * 真实键由持有模块动态拼接。声明本字段 = 声明「这个键是键族，不是单键」——
   * 消费方（备份采集/回写、对账）必须按 `keyPattern` 匹配真键，不得把占位符当真键读。
   * 不声明（缺省）则 `key` 就是真键。契约测试不校验本字段（它不改变键集合的归属），
   * 靠知识卡提示 + 备份采集测试兜底。
   */
  readonly keyPattern?: string;
  /** 迁移/备份语义的必要说明（用户可见后果，非实现细节） */
  readonly note?: string;
}

/** 磁盘轨登记名的命名空间前缀（见 SettingsKeyEntry.key 注释：theme 跨轨撞名的处置） */
export const DISK_KEY_PREFIX = "disk:";

/** 磁盘轨登记名 → 裸 json 字段名（供人工阅读与断言比对） */
export function diskFieldName(key: string): string {
  return key.startsWith(DISK_KEY_PREFIX) ? key.slice(DISK_KEY_PREFIX.length) : key;
}

/**
 * 键台账全集。**新增设置键必须「写键 + 登记本表」两步走**——
 * `tests/test_settings_key_ledger.ts` 扫生产源码里的每个键字面量，漏登记即转红。
 * 顺序：磁盘轨 → localStorage 用户偏好 → localStorage 界面态 → localStorage 3D 偏好
 * → 网页模式专用 → 迁移哨兵与调试开关。
 */
export const SETTINGS_KEYS: readonly SettingsKeyEntry[] = [
  // ─── Go 磁盘轨（ysm_config.json，随标准迁移流程保住）───────────────────
  {
    key: "disk:schemaVersion",
    setting: "配置文件 schema 版本（迁移门控）",
    tier: "go-disk",
    authority: "disk-authority",
    migrates: true,
    goField: "SchemaVersion",
    owner: "internal/app/app_config.go",
    note: "结构性迁移（旧独立路径 → CustomRoots）按本字段门控：文件版本 < 当前版本才迁移并盖版本章，≥ 则跳过（幂等）。取代旧「字段空不空」的启发式判据——历史多次迁移 bug（白名单漏字段/启动路径漏跑迁移）同根于此。版本章只能由 applyConfigMigrations 在迁移完成后盖，写盘不越权盖章",
  },
  {
    key: "disk:filesRoot",
    setting: "文件存储根目录",
    tier: "go-disk",
    authority: "disk-authority",
    migrates: true,
    goField: "FilesRoot",
    owner: "views/config-write.ts",
  },
  {
    key: "disk:customRoots",
    setting: "各资源类型独立路径",
    tier: "go-disk",
    authority: "disk-authority",
    migrates: true,
    goField: "CustomRoots",
    owner: "internal/app/resource_bindings.go",
    note: "ADR-095 起自定义路径下沉为 map，旧独立字段已废弃并被清零",
  },
  {
    key: "disk:mcRoot",
    setting: "Minecraft 游戏目录",
    tier: "go-disk",
    authority: "disk-authority",
    migrates: true,
    goField: "McRoot",
    owner: "views/config-write.ts",
    note: "写盘前经 ValidateMinecraftDir 校验，校验失败返回错误不落盘",
  },
  {
    key: "disk:linkMode",
    setting: "链接模式（复制/硬链接/符号链接）",
    tier: "go-disk",
    authority: "disk-authority",
    migrates: true,
    goField: "LinkMode",
    owner: "views/config-write.ts",
    note: "非法值软校验回落 copy（ADR-296 D6），加载与保存两路共用 washLinkMode",
  },
  {
    key: "disk:theme",
    setting: "主题皮肤",
    tier: "go-disk",
    authority: "dual-write",
    migrates: true,
    goField: "Theme",
    owner: "theme-core.ts",
    note: "磁盘权威 + localStorage 镜像；两轨同值镜像，读写两侧口径须一致",
  },
  {
    key: "disk:themeAuto",
    setting: "主题自动模式（关/跟随系统/按时间）",
    tier: "go-disk",
    authority: "dual-write",
    migrates: true,
    goField: "ThemeAuto",
    owner: "theme-core.ts",
    note: "system/time 模式下重算出的 theme 与本字段同笔落盘（锐评 2026-10-15 P0）",
  },
  {
    key: "disk:hashIndexDisabled",
    setting: "禁用持久哈希索引",
    tier: "go-disk",
    authority: "disk-authority",
    migrates: true,
    goField: "HashIndexDisabled",
    owner: "go/scanner/hashindex.go",
    note: "ADR-348 B1：缺省 false = 启用持久哈希索引（冷扫经 size+mtime 双指纹免重读 SHA256）；true = 全真算 SHA256 的旧行为（绕过 hashIndex 快路径），排查扫描结果差异时用。非 UI 暴露（开发/逃生开关），SaveAppConfig「以旧为基」自动保全",
  },
  {
    key: "disk:mirror",
    setting: "下载镜像源",
    tier: "go-disk",
    authority: "disk-authority",
    migrates: true,
    goField: "Mirror",
    owner: "internal/app/app_config.go",
  },
  {
    key: "disk:voxelMaxBlocks",
    setting: "3D 体素渲染上限",
    tier: "go-disk",
    authority: "disk-authority",
    migrates: true,
    goField: "VoxelMaxBlocks",
    owner: "internal/app/app_config.go",
    note: "0 = 使用包内默认 200000",
  },
  {
    key: "disk:scanCacheTtlMs",
    setting: "扫描缓存 TTL",
    tier: "go-disk",
    authority: "disk-authority",
    migrates: true,
    goField: "ScanCacheTTLMs",
    owner: "internal/app/app_config.go",
    note: "ADR-062 阈值下沉重构；0 = 默认 30s",
  },
  {
    key: "disk:downloadTimeoutSec",
    setting: "下载超时秒数",
    tier: "go-disk",
    authority: "disk-authority",
    migrates: true,
    goField: "DownloadTimeoutSec",
    owner: "internal/app/app_config.go",
  },
  {
    key: "disk:logMaxEntries",
    setting: "日志条数上限",
    tier: "go-disk",
    authority: "disk-authority",
    migrates: true,
    goField: "LogMaxEntries",
    owner: "internal/app/app_config.go",
  },
  {
    key: "disk:logMaxFieldLen",
    setting: "日志单字段长度上限",
    tier: "go-disk",
    authority: "disk-authority",
    migrates: true,
    goField: "LogMaxFieldLen",
    owner: "internal/app/app_config.go",
  },
  {
    key: "disk:logCorruptRetentionDays",
    setting: "损坏日志保留天数",
    tier: "go-disk",
    authority: "disk-authority",
    migrates: true,
    goField: "LogCorruptRetentionDays",
    owner: "internal/app/app_config.go",
  },
  {
    key: "disk:previewReadLimitMb",
    setting: "预览整读上限 MB",
    tier: "go-disk",
    authority: "disk-authority",
    migrates: true,
    goField: "PreviewReadLimitMB",
    owner: "internal/app/app_config.go",
  },
  {
    key: "disk:updateCheckIntervalMs",
    setting: "版本检查间隔",
    tier: "go-disk",
    authority: "disk-authority",
    migrates: true,
    goField: "UpdateCheckIntervalMs",
    owner: "internal/app/app_config.go",
    note: "0 = 默认 6h；网页模式的等价键为 localStorage 的 ysm_lastUpdateCheck",
  },
  {
    key: "disk:updateCheckTimeoutMs",
    setting: "版本检查超时",
    tier: "go-disk",
    authority: "disk-authority",
    migrates: true,
    goField: "UpdateCheckTimeoutMs",
    owner: "internal/app/app_config.go",
  },
  {
    key: "disk:winX",
    setting: "窗口位置 X",
    tier: "go-disk",
    authority: "disk-authority",
    migrates: true,
    goField: "WinX",
    owner: "internal/app/app_config.go",
  },
  {
    key: "disk:winY",
    setting: "窗口位置 Y",
    tier: "go-disk",
    authority: "disk-authority",
    migrates: true,
    goField: "WinY",
    owner: "internal/app/app_config.go",
  },
  {
    key: "disk:winW",
    setting: "窗口宽度",
    tier: "go-disk",
    authority: "disk-authority",
    migrates: true,
    goField: "WinW",
    owner: "internal/app/app_config.go",
  },
  {
    key: "disk:winH",
    setting: "窗口高度",
    tier: "go-disk",
    authority: "disk-authority",
    migrates: true,
    goField: "WinH",
    owner: "internal/app/app_config.go",
  },
  {
    key: "disk:winRelX",
    setting: "窗口相对屏幕 X 百分比",
    tier: "go-disk",
    authority: "disk-authority",
    migrates: true,
    goField: "WinRelX",
    owner: "internal/app/app_config.go",
    note: "双屏安全：换屏后按相对百分比还原绝对坐标",
  },
  {
    key: "disk:winRelY",
    setting: "窗口相对屏幕 Y 百分比",
    tier: "go-disk",
    authority: "disk-authority",
    migrates: true,
    goField: "WinRelY",
    owner: "internal/app/app_config.go",
  },
  {
    key: "disk:winScrW",
    setting: "上次记录时虚拟屏宽度",
    tier: "go-disk",
    authority: "disk-authority",
    migrates: true,
    goField: "WinScrW",
    owner: "internal/app/app_config.go",
    note: "与当前虚拟屏不一致即触发坐标重算",
  },
  {
    key: "disk:winScrH",
    setting: "上次记录时虚拟屏高度",
    tier: "go-disk",
    authority: "disk-authority",
    migrates: true,
    goField: "WinScrH",
    owner: "internal/app/app_config.go",
  },
  // 废弃字段（ADR-095 后不再承载数据，读侧清零后随保存丢弃）：仍在磁盘 json 里
  // 可见，故一并登记以证「台账覆盖 AppConfig 全部 json 字段」。
  ...(
    [
      ["disk:ysmRoot", "YsmRoot", "YSM 独立路径（已废弃，下沉 customRoots）"],
      ["disk:resourcepackRoot", "ResourcepackRoot", "资源包独立路径（已废弃）"],
      ["disk:shaderpackRoot", "ShaderpackRoot", "光影包独立路径（已废弃）"],
      ["disk:schematicRoot", "SchematicRoot", "投影独立路径（已废弃）"],
      ["disk:litematicRoot", "LitematicRoot", "Litematic 独立路径（已废弃）"],
      ["disk:mmdRoot", "MmdRoot", "MMD 独立路径（已废弃）"],
      ["disk:vrcRoot", "VrcRoot", "VRChat 独立路径（已废弃）"],
    ] as const
  ).map(
    ([key, goField, setting]): SettingsKeyEntry => ({
      key,
      setting,
      tier: "go-disk",
      authority: "disk-authority",
      migrates: true,
      goField,
      owner: "internal/app/app_config.go",
      note: "Deprecated：加载时迁移进 customRoots 后清零，不再承载数据",
    }),
  ),

  // ─── localStorage 轨：用户外观偏好（换机即丢，官方迁移流程不含）────────────
  {
    key: "ui-font-size",
    setting: "界面字号（5 档）",
    tier: "local-storage",
    authority: "browser-authority",
    migrates: false,
    owner: "views/app-content/settings/ui-prefs.ts",
    note: "写入 CSS 变量 --fs-scale 重算全局字号；白名单外值回落默认档",
  },
  {
    key: "ui-display-font",
    setting: "界面显示字体",
    tier: "local-storage",
    authority: "browser-authority",
    migrates: false,
    owner: "views/app-content/settings/ui-prefs.ts",
  },
  {
    key: "ui-card-density",
    setting: "卡片密度（紧凑/标准/宽松）",
    tier: "local-storage",
    authority: "browser-authority",
    migrates: false,
    owner: "views/app-content/settings/ui-prefs.ts",
  },
  {
    key: "ui-animations",
    setting: "界面动画开关",
    tier: "local-storage",
    authority: "browser-authority",
    migrates: false,
    owner: "views/app-content/settings/ui-prefs.ts",
    note: "与 OS prefers-reduced-motion 并轨：系统要求减少动效且用户未显式开 → 自动关",
  },
  {
    key: "ui-default-page",
    setting: "启动默认页面",
    tier: "local-storage",
    authority: "browser-authority",
    migrates: false,
    owner: "core/page-store.ts",
    note: "读侧过 VALID_PAGES 白名单，历史值 resources 映射为 repository",
  },
  {
    key: "uiLang",
    setting: "界面语言",
    tier: "local-storage",
    authority: "browser-authority",
    migrates: false,
    owner: "core/i18n/locale.ts",
    note: "缺省经宿主检测系统语言，兜底 zh-CN",
  },
  {
    key: "theme-auto",
    setting: "主题自动模式（localStorage 镜像）",
    tier: "local-storage",
    authority: "dual-write",
    migrates: false,
    owner: "theme-core.ts",
    note: "themeAuto 的镜像键：磁盘不可达（Go 启动失败/纯网页）时的兜底读源",
  },
  {
    key: "theme",
    setting: "主题皮肤（localStorage 镜像）",
    tier: "local-storage",
    authority: "dual-write",
    migrates: false,
    owner: "theme-core.ts",
    note: "磁盘 theme 的镜像键（磁盘侧登记名 disk:theme）：读写两侧口径须一致，磁盘优先、localStorage 仅兜底",
  },
  {
    key: "ysm_lastUpdateCheck",
    setting: "上次版本检查时间戳（网页版）",
    tier: "local-storage",
    authority: "browser-authority",
    migrates: false,
    owner: "features/maintenance/version-updater.ts",
    note: "桌面端等价物是磁盘轨 updateCheckIntervalMs（间隔）+ Go 侧检查时间戳；网页版无 Go 落点，故用此键记频次",
  },
  {
    key: "fbx-worker",
    setting: "FBX 解析走 worker",
    tier: "local-storage",
    authority: "browser-authority",
    migrates: false,
    owner: "views/app-content/settings/worker-prefs.ts",
    note: "默认关（主线程为稳定基线），开启失败自动降级主线程",
  },
  {
    key: "mmd-pmx-worker",
    setting: "MMD PMX 解析走 worker",
    tier: "local-storage",
    authority: "browser-authority",
    migrates: false,
    owner: "views/app-content/settings/worker-prefs.ts",
  },
  {
    key: "ysm-dedup-config",
    setting: "去重配置（策略/保留策略/优先路径）",
    tier: "local-storage",
    authority: "browser-authority",
    migrates: false,
    owner: "views/app-content/diagnostics/dedup.ts",
    note: "JSON 序列化整份配置；Go 侧只消费 strategy 去重哈希算法",
  },

  // ─── localStorage 轨：3D 预览偏好 ─────────────────────────────────────
  {
    key: "td-keymap",
    setting: "3D 相机键位映射",
    tier: "local-storage",
    authority: "browser-authority",
    migrates: false,
    owner: "preview-3d/infra/settings-schema.ts",
    note: "值表归 infra/keymap.ts；损坏 JSON 回落默认键位",
  },
  {
    key: "td-cam-speed",
    setting: "3D 相机移动速度",
    tier: "local-storage",
    authority: "browser-authority",
    migrates: false,
    owner: "preview-3d/infra/settings-schema.ts",
    note: "值域 2–200，读侧 clamp；规格声明与两个写入面同源（ADR-303）",
  },
  {
    key: "td-rot-mode",
    setting: "3D 相机旋转模式（环绕/自由）",
    tier: "local-storage",
    authority: "browser-authority",
    migrates: false,
    owner: "preview-3d/infra/settings-schema.ts",
  },
  {
    key: "ysm_3d_maxPixelRatio",
    setting: "3D 渲染分辨率上限",
    tier: "local-storage",
    authority: "browser-authority",
    migrates: false,
    owner: "preview-3d/infra/settings-schema.ts",
    note: "用户可设上限；自适应降采样地板 MIN_PIXEL_RATIO 是另一个旋钮，不并入",
  },
  {
    key: "ysm_3d_maxFps",
    setting: "3D 帧率上限",
    tier: "local-storage",
    authority: "browser-authority",
    migrates: false,
    owner: "preview-3d/infra/render-budget.ts",
  },
  {
    key: "ysm_3d_perfPreset",
    setting: "3D 性能档位",
    tier: "local-storage",
    authority: "browser-authority",
    migrates: false,
    owner: "preview-3d/state/perf-presets.ts",
    note: "选档会连带改写 maxFps 与 SSR 缩放，三个键成组读写",
  },
  {
    key: "ysm_3d_frustumCull",
    setting: "3D 视锥剔除开关",
    tier: "local-storage",
    authority: "browser-authority",
    migrates: false,
    owner: "preview-3d/infra/frustum-cull.ts",
  },
  {
    key: "ysm.preview.lastRtype",
    setting: "3D 预览上次资源类型",
    tier: "local-storage",
    authority: "browser-authority",
    migrates: false,
    owner: "preview-3d/menu/shell/switch.ts",
  },
  {
    key: "ysm_showBoneLabels",
    setting: "骨骼名称可见性",
    tier: "local-storage",
    authority: "browser-authority",
    migrates: false,
    owner: "views/app-preview/skeleton-render.ts",
    note: "缺省 true（默认显示）",
  },
  {
    key: "ysm-render-mode",
    setting: "仓库树视图模式（网格/列表）",
    tier: "local-storage",
    authority: "browser-authority",
    migrates: false,
    owner: "views/app-tree/render.ts",
  },
  {
    key: "ysm-scene-cap-*",
    setting: "3D 场景能力状态（天空/地面/雾/水/光照/后处理等，共十余键）",
    tier: "local-storage",
    authority: "browser-authority",
    migrates: false,
    owner: "preview-3d/caps/scene-capability.ts",
    keyPattern: "ysm-scene-cap-*",
    note: "键族：localStorage 实际键为 STORAGE_PREFIX + capId（ysm-scene-cap- 前缀接 capId），JSON 序列化；另有动态成员键 ysm-scene-cap-「cap」-「field」 形态。备份采集/回写必须按 keyPattern 展开真键——把占位符当键读恒 null，等于这些场景设置永远不迁移",
  },
  {
    key: "vmd.positionScale",
    setting: "VMD 骨骼位移缩放",
    tier: "local-storage",
    authority: "browser-authority",
    migrates: false,
    owner: "preview-3d/adapters/vrm/vrm-adapter.ts",
  },
  {
    key: "ysmAlphaInfo",
    setting: "半透明贴图 alpha 信息缓存",
    tier: "local-storage",
    authority: "browser-authority",
    migrates: false,
    owner: "preview-3d/texture/texture-alpha.ts",
    note: "派生缓存（非用户直接设置），但重启重算成本高故持久化",
  },

  // ─── localStorage 轨：界面会话态（换个说法：用户会记住的「上次在哪」）──────
  {
    key: "nav_page",
    setting: "上次停留页面",
    tier: "local-storage",
    authority: "browser-authority",
    migrates: false,
    owner: "core/page-store.ts",
  },
  {
    key: "nav_collapsed",
    setting: "导航栏折叠态",
    tier: "local-storage",
    authority: "browser-authority",
    migrates: false,
    owner: "views/app-nav/index.ts",
  },
  {
    key: "repo_rtype",
    setting: "当前资源类型（仓库页/侧栏）",
    tier: "local-storage",
    authority: "browser-authority",
    migrates: false,
    owner: "utils/resource/repo-rtype.ts",
    note: "运行期变更唯一入口是 bus 事件 repo:rtype-changed，直读 localStorage 会漏运行期切换",
  },
  {
    key: "repo_subdir",
    setting: "仓库子目录（跨语言契约占位）",
    tier: "local-storage",
    authority: "browser-authority",
    migrates: false,
    owner: "views/app-content/init-pages.ts",
    note: "ADR-096-d1 裁定保留：Go 侧 subtype 参数仍在签名里，禁新增消费者",
  },
  {
    key: "ysm_syncLastType",
    setting: "同步面板上次类型（历史兼容键）",
    tier: "local-storage",
    authority: "browser-authority",
    migrates: false,
    owner: "views/app-sync-manager/state.ts",
    note: "repo_rtype 的历史键，双写防旧版读取者；新代码只读 repo_rtype",
  },
  {
    key: "dirOpenState",
    setting: "仓库树目录展开态",
    tier: "local-storage",
    authority: "browser-authority",
    migrates: false,
    owner: "views/app-tree/index.ts",
    note: "按 rtype 命名空间分层（{ rtype: { 相对目录: bool } }），避免跨类型串展开态",
  },
  {
    key: "preview-width",
    setting: "预览面板宽度",
    tier: "local-storage",
    authority: "browser-authority",
    migrates: false,
    owner: "views/app-content/init-preview.ts",
  },
  {
    key: "lt_previewTab",
    setting: "Litematic 预览页签",
    tier: "local-storage",
    authority: "browser-authority",
    migrates: false,
    owner: "views/app-preview/litematic-meta.ts",
  },
  {
    key: "ysm_previewTab",
    setting: "预览页签",
    tier: "local-storage",
    authority: "browser-authority",
    migrates: false,
    owner: "views/app-preview/detail.ts",
  },
  {
    key: "ysm-browse-mode",
    setting: "工坊浏览模式",
    tier: "local-storage",
    authority: "browser-authority",
    migrates: false,
    owner: "views/app-content/site/workshop-browse-mode.ts",
  },
  {
    key: "ysm-embed-mode",
    setting: "工坊嵌入模式",
    tier: "local-storage",
    authority: "browser-authority",
    migrates: false,
    owner: "views/app-content/site/workshop-browse-mode.ts",
  },
  {
    key: "ysm-fav-creators",
    setting: "收藏的创作者",
    tier: "local-storage",
    authority: "browser-authority",
    migrates: false,
    owner: "views/app-content/site/workshop-data.ts",
    note: "JSON 数组；收藏是用户攒下来的清单，换机丢 = 重新找一遍",
  },
  {
    key: "ysm-ws-active-tag",
    setting: "工坊当前筛选标签（按站点分域）",
    tier: "local-storage",
    authority: "browser-authority",
    migrates: false,
    owner: "views/app-content/site/workshop-data.ts",
    keyPattern: "ysm-ws-active-tag*",
    note: "键族：实际键为 workshop-data.ts scopedFilterKey 拼出的「ysm-ws-active-tag:」+ 站点id（冒号分隔，空站点回退无后缀裸键），**不是短横线**——登记名无后缀，直接读写会套错站。备份按 keyPattern 展开真键",
  },
  {
    key: "ysm-ws-search-kw",
    setting: "工坊搜索词（按站点分域）",
    tier: "local-storage",
    authority: "browser-authority",
    migrates: false,
    owner: "views/app-content/site/workshop-data.ts",
    keyPattern: "ysm-ws-search-kw*",
    note: "键族：scopedFilterKey 拼「ysm-ws-search-kw:」+ 站点id；备份按 keyPattern 展开真键",
  },
  {
    key: "ysm-ws-last-tab",
    setting: "工坊上次页签（按站点分域）",
    tier: "local-storage",
    authority: "browser-authority",
    migrates: false,
    owner: "views/app-content/site/workshop-data.ts",
    keyPattern: "ysm-ws-last-tab*",
    note: "键族：scopedFilterKey 拼「ysm-ws-last-tab:」+ 站点id；备份按 keyPattern 展开真键",
  },
  {
    key: "diag.perf.density",
    setting: "性能面板采样密度",
    tier: "local-storage",
    authority: "browser-authority",
    migrates: false,
    owner: "views/app-content/diagnostics/perf-density.ts",
  },
  {
    key: "perf-history",
    setting: "性能趋势历史记录",
    tier: "local-storage",
    authority: "browser-authority",
    migrates: false,
    owner: "views/app-content/diagnostics/perf-trend.ts",
    note: "攒够 ≥2 条才画趋势线；测试需先 localStorage.clear() 隔离",
  },
  {
    key: "scan-authors",
    setting: "本地扫描作者索引",
    tier: "local-storage",
    authority: "browser-authority",
    migrates: false,
    owner: "features/community/community-data.ts",
    note: "派生缓存（扫仓产出），换机重扫即重建",
  },
  {
    key: "ListModelAuthors",
    setting: "作者列表缓存",
    tier: "local-storage",
    authority: "browser-authority",
    migrates: false,
    owner: "features/community/community-data.ts",
    note: "派生缓存；键名沿用历史命名（含无分隔符驼峰），不重命名以免老用户缓存失效",
  },
  {
    key: "community-merge",
    setting: "社区数据合并位",
    tier: "local-storage",
    authority: "browser-authority",
    migrates: false,
    owner: "features/community/community-data.ts",
    note: "派生缓存（bundled JSON + 本地覆盖的合并结果）",
  },
  {
    key: "community-sites",
    setting: "社区站点表覆盖",
    tier: "local-storage",
    authority: "browser-authority",
    migrates: false,
    owner: "features/community/community-data.ts",
  },

  // ─── 网页模式专用键（桌面端不消费）────────────────────────────────────
  {
    key: "ysm:config",
    setting: "网页版应用配置（SaveAppConfig 等的网页实现落点）",
    tier: "local-storage",
    authority: "browser-authority",
    migrates: false,
    owner: "backend/web-store.ts",
    note: "网页模式的「磁盘轨」替身：没有 Go 进程时 SaveAppConfig 写这里。桌面端不读此键",
  },
  {
    key: "web:workshop-creators",
    setting: "网页版工坊创作者覆盖表",
    tier: "local-storage",
    authority: "browser-authority",
    migrates: false,
    owner: "backend/web-community.ts",
    note: "bundled JSON + localStorage 覆盖层；仅网页模式",
  },
  {
    key: "web:workshop-sites",
    setting: "网页版工坊站点覆盖表",
    tier: "local-storage",
    authority: "browser-authority",
    migrates: false,
    owner: "backend/web-community.ts",
    note: "bundled JSON + localStorage 覆盖层；仅网页模式",
  },
  {
    key: "web:github-repos",
    setting: "网页版 GitHub 仓库覆盖表",
    tier: "local-storage",
    authority: "browser-authority",
    migrates: false,
    owner: "backend/web-community.ts",
    note: "bundled JSON + localStorage 覆盖层；仅网页模式",
  },

  // ─── IndexedDB 轨（仅网页模式；key 常量声明在 web-store/web-fs-auth，走 idbSet/idbGet）──
  {
    key: "web:import-logs",
    setting: "网页版导入日志环",
    tier: "indexed-db",
    authority: "browser-authority",
    migrates: false,
    owner: "backend/web-store.ts",
    note: 'IDB store "config"；桌面端等价物是 Go 侧 ysm-import-logs.json',
  },
  {
    key: "web:runtime-logs",
    setting: "网页版运行时日志环",
    tier: "indexed-db",
    authority: "browser-authority",
    migrates: false,
    owner: "backend/web-store.ts",
  },
  {
    key: "web:log-health",
    setting: "网页版日志通道健康锁存位",
    tier: "indexed-db",
    authority: "non-persistent",
    migrates: false,
    owner: "backend/web-store.ts",
    note: "写-删哨兵键：探针用，不承载用户数据",
  },
  {
    key: "fsaRootHandle",
    setting: "网页版文件系统访问授权句柄",
    tier: "indexed-db",
    authority: "non-persistent",
    migrates: false,
    owner: "backend/web-fs-auth.ts",
    note: "FileSystemHandle 不可结构化克隆时由授权弹窗重获；桌面端无此机制",
  },

  // ─── 迁移哨兵与调试开关（非用户设置，重启可重算）────────────────────────
  {
    key: "__waterSchemaVersion",
    setting: "水体状态 schema 版本（迁移哨兵）",
    tier: "local-storage",
    authority: "non-persistent",
    migrates: false,
    owner: "preview-3d/caps/water-migrations.ts",
    note: "版本号而非数据本身：读出旧值即触发一次性状态迁移",
  },
  {
    key: "ysmm:diary-outbox",
    setting: "错误日记离线队列",
    tier: "local-storage",
    authority: "non-persistent",
    migrates: false,
    owner: "backend/diary-outbox.ts",
    note: "待发运的日记条目（上限 50 条，丢最旧）；排空即抹除，不是不该丢的数据",
  },
  {
    key: "ysm_3d_gpuBudgetCalibrated",
    setting: "GPU 负载基线校准结果",
    tier: "local-storage",
    authority: "non-persistent",
    migrates: false,
    owner: "preview-3d/infra/gpu-load-calibrate.ts",
    note: "首次启动采样后写一次，驱动自适应降采样；坏值回落重新校准",
  },
  {
    key: "ysm:coi-reload",
    setting: "COI 头刷新哨兵",
    tier: "local-storage",
    authority: "non-persistent",
    migrates: false,
    owner: "workers/coi-sw.ts",
  },
  {
    key: "ysm-force-decode-bridge",
    setting: "强制走解码桥（桌面联调逃生阀）",
    tier: "local-storage",
    authority: "non-persistent",
    migrates: false,
    owner: "backend/ysm-decode-bridge.ts",
    note: "排查用开关，正常用户不应设置；桌面端不消费",
  },
  {
    key: "_devtools",
    setting: "调试开关（无写入方）",
    tier: "local-storage",
    authority: "non-persistent",
    migrates: false,
    owner: "utils/debug/dev-mode.ts",
    note: "注释已声明：无写入方，实际仅 URL ?dev=1 生效",
  },
  {
    key: "_debug",
    setting: "调试日志开关",
    tier: "local-storage",
    authority: "non-persistent",
    migrates: false,
    owner: "utils/debug/debug.ts",
  },
];

/** 某键的登记条目（未登记返回 undefined——本函数是「查得到吗」的探测，不是默认值工厂） */
export function findSettingsKey(key: string): SettingsKeyEntry | undefined {
  return SETTINGS_KEYS.find((e) => e.key === key);
}

/**
 * 随标准迁移流程（复制 ysm_config.json + 仓库目录）能保住的键。
 * 台账目前全量 = 磁盘轨；若将来把某项 localStorage 偏好下沉进磁盘轨，这里会自动变宽。
 */
export function migratingSettingsKeys(): readonly SettingsKeyEntry[] {
  return SETTINGS_KEYS.filter((e) => e.migrates);
}

/**
 * 标准迁移流程**带不走**的键（换机/重装即丢的那一档）。
 * 备份文档的「换机后需要重设什么」一节即由此派生——文档与台账同源，不再两处维护。
 */
export function nonMigratingSettingsKeys(): readonly SettingsKeyEntry[] {
  return SETTINGS_KEYS.filter((e) => !e.migrates);
}
