---
kind: settings-persistence
name: 设置持久化双轨与键台账
tier: leaf
category: config
status: active
source_files:
  - frontend/src/settings-keys.ts
  - tests/test_settings_key_ledger.ts
  - go/types/config.go
  - internal/app/app_config.go
auto_fields:
  symbols_with_lines:
    - App.CheckUpdate
    - App.CurrentVersion
    - App.DoUpdate
    - App.GetConfigPath
    - App.GetMinecraftPaths
    - App.GetSubDirMap
    - App.GetWindowPosition
    - App.LoadAppConfig
    - App.RestartApplication
    - App.SaveAppConfig
    - App.SaveAppConfigPatch
    - App.SaveThresholds
    - App.SaveWindowPosition
    - App.SelectDirectory
    - App.SetDownloadMirror
    - App.SetSessionFilesRoot
    - App.ValidateMinecraftDir
    - AppConfig
    - AppConfigPatch
    - DedupConfig
    - DISK_KEY_PREFIX
    - diskFieldName
    - findSettingsKey
    - ImportSettingsResult
    - LocalAuthor
    - migratingSettingsKeys
    - nonMigratingSettingsKeys
    - PackInfo
    - PackMetaView
    - PackModelDetail
    - PackModelDetailList
    - SchemaVersion
    - SETTINGS_KEYS
    - SettingsAuthority
    - SettingsExport
    - SettingsKeyEntry
    - SettingsTier
    - ShaderpackLang
    - SyncConfig
    - SyncResolveResult
    - SyncScanDirs
    - WorkshopCreator
    - WorkshopPresetSearch
    - WorkshopSite
last_verified: 2026-10-16
use_when:
  - 新增或修改任何会被用户感知的设置项（判断它落在哪一轨、是否随迁移保住）
  - 改配置写入/读取路径（writeAppConfig / SaveAppConfigPatch / safeGet / safeSet）
  - 写或改备份、换机迁移相关的文档
  - 排查「设置重启后没保住」「换机后设置丢了」类问题
  - 怀疑某个键有双权威（磁盘 vs localStorage 口径不一致）
pitfalls:
  - 只备份 ysm_config.json 带不走 localStorage 轨的几十项设置——官方迁移叙事曾长期漏掉这一档
  - theme / themeAuto 跨双轨同名，台账用 disk: 前缀分列；无前缀即撞名，撞名会逼两轨塞进一行
  - 新增 localStorage 键必须同步登记 settings-keys.ts，漏登记则契约测试转红
  - 网页模式的「磁盘替身」是 localStorage 的 ysm:config 键，别把它当桌面磁盘轨
  - disk-authority 与 browser-authority 混用会产生双权威：读写两侧口径必须一致
quick_groups:
  - 配置与注册表
quick_intents:
  - 新增一个设置项，该落哪一轨、要不要登记台账
  - 换机迁移 / 备份会保住哪些设置、丢哪些
  - 某键的权威方是磁盘还是 localStorage
  - 配置写入路径为何要经 config-write.ts 唯一实参点
quick_risk_lines:
  - 新增设置键忘了登记 settings-keys.ts 台账（契约测试会红，但只有跑了才知道）
  - 把 localStorage 键当成会随 ysm_config.json 迁移——不会
  - 读写两侧对「谁是权威」各持一词（theme 的历史病灶：initTheme 与 writeAppConfig 曾反向）
---

# 设置持久化双轨与键台账

## 概览

应用设置存在**两处**，这是绝大多数「设置保存/迁移」困惑的根源：

| 轨 | 落点 | 覆盖 | 换机是否保住 |
|----|------|------|------------|
| Go 磁盘轨 | `%APPDATA%\YSM-Model-Manager\ysm_config.json` | 路径、链接模式、主题、镜像源、运行阈值、窗口 | ✅ 复制配置文件即恢复 |
| 浏览器 localStorage 轨 | WebView 用户 profile 内 | 字号/字体/密度/动画、语言、默认页、3D 偏好、键位、收藏、会话态 | ❌ 换机/重装即丢 |
| IndexedDB 轨（仅网页版） | 浏览器 IDB | 日志环、健康锁存位、FS 授权句柄 | ❌ 同上 |

字段单一事实源 = `go/types/config.go|AppConfig`（磁盘轨）与 `frontend/src/settings-keys.ts|SETTINGS_KEYS`（全轨台账）。

**台账存在的理由**：历史上没有任何一处能回答「一共有哪些设置键、分别归哪一轨、换机会不会丢」。键名散落在数十个源文件里，写入方与备份叙事互不知情，结果是官方迁移文档只写了磁盘轨那一半。本台账把归属收成一处声明，并用契约测试与真实源码双向对账——**漏登记的键转红（防新增键只写不登记），登记的死键也转红（防笔误）**。

## 核心职责

`frontend/src/settings-keys.ts`（纯数据叶，零 import）：
- `SETTINGS_KEYS` — 键全集，每条声明 `key` / `setting`（用户视角名称）/ `tier`（存储轨）/ `authority`（权威方）/ `migrates`（是否随标准迁移）/ `owner`（持有模块）/ `goField`（磁盘轨跨语言回溯）/ `note`
- `findSettingsKey` / `migratingSettingsKeys` / `nonMigratingSettingsKeys` — 查询口；备份文档的「哪些跟得走 / 哪些要重设」由后两者派生

`tests/test_settings_key_ledger.ts`（契约测试）五组断言：
- A 台账里的 localStorage 键必须真在源码中被使用（防死键/笔误；键族 `ysm-scene-cap-*` 走前缀通配豁免）
- B **源码里每个 localStorage 键都必须登记**（主价值：新键漏登记即红）
- C Go `AppConfig` 每个 json 字段都必须登记（磁盘轨漏登记即红）
- D 台账自洽：键名不重复、tier/authority 值合法、`migrates` 与 tier 一致

## 对外 API / 入口

- `SETTINGS_KEYS` / `findSettingsKey(key)` / `migratingSettingsKeys()` / `nonMigratingSettingsKeys()` — `frontend/src/settings-keys.ts`
- 磁盘轨写入唯一入口：`views/config-write.ts|writeAppConfig(patch)` → Go `SaveAppConfigPatch`（原子 patch，ADR-349；实参点单点化始于 ADR-313），执法 `tests/test_config_write_single_exit.ts`
- 主题读写两侧口径：`theme-core.ts|initTheme`（读）与 `views/config-write.ts|writeAppConfig`（写）——两侧都必须「磁盘优先」
- 备份迁移用户叙事：`docs/guide/backup-migration.md`「哪些设置会跟着迁移」一节

## 与其他子系统关系

- `go/types/config.go|AppConfig` — 磁盘轨字段定义（台账断言 C 的对账对象）
- `internal/app/app_config.go|SaveAppConfig` / `LoadAppConfig` — 磁盘轨读写（含 `configWriteMu` 串行化与 `orDefault` 以旧为基语义）
- `utils/base/primitives/storage.ts|safeGet/safeSet` — localStorage 轨唯一合规入口（隐私模式红线，禁裸调）
- `theme-core.ts` — 双写轨（theme/themeAuto）读侧；`views/app-content/settings/theme.ts` 写侧
- `docs/guide/backup-migration.md` — 面向用户的迁移叙事，与台账同源

## 不变量

1. **新增 localStorage 键 = 写键 + 登记台账，两步走**。漏第二步 → `tests/test_settings_key_ledger.ts` 断言 B 转红。
2. **`migrates` 恒等于「tier 是否为 go-disk」**。非磁盘轨写 `true` 即错误登记（断言 D）。
3. **磁盘轨登记必须带 `disk:` 前缀**。theme/themeAuto 跨双轨同名物理键，无前缀即撞名，撞名会把两条轨塞进一行、一行只能声明一个 tier——镜像的归属被磁盘的归属吞掉（这正是要消灭的漂移）。
4. **写侧与读侧对「谁是权威」口径一致**。历史病灶：`initTheme` 曾 localStorage 优先、`writeAppConfig` 曾 localStorage 兜底，两边反向 → 磁盘备份被 localStorage 冲掉。现在写入侧未传字段由 Go 锁内重读决定（P1 ③ 前是前端重读）、读取侧 `cfg.theme || safeGet("theme")` 磁盘优先。
5. **台账不参与运行时读写**。它是让漂移暴露的声明，不是权威——不要为了「走台账」把 safeGet 改成查表。
6. **网页版 `ysm:config`（localStorage）是磁盘轨的网页替身**，不是桌面磁盘轨；桌面端不消费它。
7. **结构性迁移按 `AppConfig|SchemaVersion` 门控，且只有 `applyConfigMigrations` 有权盖章**。文件版本 < 当前版本才跑迁移（旧独立路径 → `CustomRoots`）并盖版本章；≥ 则跳过（幂等）。写盘路径（`saveConfig`）**不得**越权盖章——把「未迁移」的配置标成「已迁移」会令下次读取跳过迁移，复现「启动路径漏跑迁移」的静默数据丢失。此门控取代旧「字段空不空」的启发式判据：历史多次迁移 bug（`go/types` 新增字段被白名单漏拷贝、启动路径漏跑 `migrateLegacyConfigFields`）同根于此。

## 相关

- 键集合与归属：`frontend/src/settings-keys.ts`
- 对账守卫：`tests/test_settings_key_ledger.ts`
- 磁盘轨字段：`go/types/config.go|AppConfig`
- 用户迁移叙事：`docs/guide/backup-migration.md`
- 写入唯一出口（ADR-313 → ADR-349 原子化）：`views/config-write.ts|writeAppConfig` → Go `SaveAppConfigPatch`、执法 `tests/test_config_write_single_exit.ts`（已改锁新绑定）
- 主题双写口径：知识卡 `theme`
- localStorage 安全包装：知识卡 `dom-storage`
