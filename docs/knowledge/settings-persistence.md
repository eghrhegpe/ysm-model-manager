---
kind: settings-persistence
name: 设置持久化双轨与键台账
tier: leaf
category: config
status: active
source_files:
  - frontend/src/settings-keys.ts
  - frontend/src/views/app-content/settings/settings-backup.ts
  - tests/test_settings_key_ledger.ts
  - go/types/config.go
  - internal/app/app_config.go
  - internal/app/app_settings_export.go
auto_fields:
  symbols_with_lines:
    - App.CheckUpdate
    - App.CurrentVersion
    - App.DoUpdate
    - App.ExportSettingsJSON
    - App.GetConfigPath
    - App.GetMinecraftPaths
    - App.GetSubDirMap
    - App.GetWindowPosition
    - App.ImportSettingsFromFile
    - App.LoadAppConfig
    - App.ReadSettingsExport
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
    - applyImportedLocalStorage
    - collectExportableLocalStorage
    - DedupConfig
    - DISK_KEY_PREFIX
    - diskFieldName
    - exportableSettingsKeys
    - findSettingsKey
    - importedKeysFrom
    - ImportSettingsResult
    - initSettingsBackup
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
    - unbackupableSettingsKeys
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
  - 只备份 ysm_config.json 带不走 localStorage 轨的几十项设置——官方迁移叙事曾长期漏掉这一档（`b1116645c` 有文档无实现，2026-10-16 起由 ADR-344-d1 导出/导入收拢）
  - 设置导出/导入的采集与回写**必须走台账查询口 `exportableSettingsKeys()`**（判定 = tier=local-storage && authority=browser-authority，只写在台账一处），禁手写第二份键名清单、也禁在消费方复写判定——手抄必漂移，新键漏登记即漏备份
  - 台账 `keyPattern` 键族（3D 场景能力 `ysm-scene-cap-*`、工坊按站筛选态 `ysm-ws-*`）登记的是占位符，真实键由持有模块拼接——采集/回写必须展开真键，且候选键只能取自实际键（`safeKeys()` / 导出文件），禁按前缀猜键名
  - 拼接键族的前缀必须以 `*_PREFIX` 常量形态声明；藏在函数体内裸拼 `` `ysm:x${p}` `` 会让契约测试的键扫描失明（实测三族因此漏登），新键族落地先收常量再登记
  - 台账字段 `migrates` 只回答「复制 ysm_config.json 带不带得走」，**不回答「换机丢不丢」**——ADR-344 后后者要并看导出面；给用户列「要重设什么」用 `unbackupableSettingsKeys()`，用 `nonMigratingSettingsKeys()` 会劝人重设早已能带走的字号
  - 导入顺序铁律：**磁盘先落盘、浏览器后回写**（锐评 2026-10-16 修正，推翻早前的「失败回滚」设计）。理由：磁盘是真相源且可回滚（`.bak-*`），浏览器 localStorage 无备份；且 Go 写盘成功但 watcher 重启失败也会报错（`applyPostSaveSideEffects`），旧「先写浏览器、报错回滚」会把磁盘（新）/浏览器（旧）**反向分叉**——比「磁盘新/浏览器旧」更糟。顺序翻过来后失败面收窄为「磁盘新/浏览器旧」，并删掉「导入前拍照 + 失败回滚」这套从未被测试的补偿事务（删的是不可判定的启发式，不是功能）。提示条数用前端台账过滤后的 `applied`（Go 的 `len(localStorage)` 未过滤、会虚高）
  - 磁盘侧防护：`ReadSettingsExport` 有大小上限（8 MiB）与**双版本门控**（文件格式 `ExportVersion` + 配置 schema `AppConfig.SchemaVersion`，两套独立编号，少一道旧程序会按旧结构静默错读新版导出）；导入前备份最多保留 10 份（`.bak-时间戳`，毫秒精度）；配置文件存在却无任何路径设置时导出**直接拒绝**（假备份比没备份更糟）
  - theme / themeAuto 跨双轨同名，台账用 disk: 前缀分列；无前缀即撞名，撞名会逼两轨塞进一行
  - 新增 localStorage 键必须同步登记 settings-keys.ts，漏登记则契约测试转红；拼接键族须把前缀收敛为 `*_PREFIX` 常量（函数体内裸拼接对账失明，实测漏登过三族）
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
| 浏览器 localStorage 轨 | WebView 用户 profile 内 | 字号/字体/密度/动画、语言、默认页、3D 偏好、键位、收藏、会话态 | ❌ 单独复制配置文件不恢复；「设置 → 环境 → 备份与迁移」导出/导入可整体带走 |
| IndexedDB 轨（仅网页版） | 浏览器 IDB | 日志环、健康锁存位、FS 授权句柄 | ❌ 同上 |

字段单一事实源 = `go/types/config.go|AppConfig`（磁盘轨）与 `frontend/src/settings-keys.ts|SETTINGS_KEYS`（全轨台账）。

**台账存在的理由**：历史上没有任何一处能回答「一共有哪些设置键、分别归哪一轨、换机会不会丢」。键名散落在数十个源文件里，写入方与备份叙事互不知情，结果是官方迁移文档只写了磁盘轨那一半。本台账把归属收成一处声明，并用契约测试与真实源码双向对账——**漏登记的键转红（防新增键只写不登记），登记的死键也转红（防笔误）**。

## 核心职责

`frontend/src/settings-keys.ts`（纯数据叶，零 import）：
- `SETTINGS_KEYS` — 键全集，每条声明 `key` / `setting`（用户视角名称）/ `tier`（存储轨）/ `authority`（权威方）/ `migrates`（是否随复制配置文件迁移）/ `owner`（持有模块）/ `goField`（磁盘轨跨语言回溯）/ `note`
- `findSettingsKey` / `migratingSettingsKeys` / `nonMigratingSettingsKeys` — 迁移面查询口；**`migrates` 只回答「复制 ysm_config.json 带不走带得走」**，不回答「换机会不会丢」——ADR-344-d1 后后者还要看导出面
- `exportableSettingsKeys` — 导出/导入**采集与回写的白名单单一事实源**（`tier=local-storage && authority=browser-authority` 的判定只写在这一处，`settings-backup.ts` 消费它，禁在消费方复写判定——两处各写一遍必漂移）；`unbackupableSettingsKeys` — 既不跟复制走也不随导出走的「真正要重设/重算」档，用户叙事应由此派生（拿 `nonMigratingSettingsKeys` 写文档会劝用户重设早已能带走的字号）

`tests/test_settings_key_ledger.ts`（契约测试）分组断言：
- A 台账里的 localStorage 键必须真在源码中被使用（防死键/笔误；键族 `ysm-scene-cap-*` 走前缀通配豁免）
- B **源码里每个 localStorage 键都必须登记**（主价值：新键漏登记即红）。口径含双引号首参、模板字面量首参（`` `前缀${…}` `` 按「静态段+*」入网）、`*_KEY`/`*_PREFIX` 常量、`storageKey:`/`key:` 规格成员；**函数体内拼接**（`function k(p){return \`…${p}\`}`）扫描不可见——拼接键持有者必须把前缀收敛为 `*_PREFIX` 常量再拼（立闸实测抓出三族漏登，其中模型可见性是用户可感知偏好）
- C Go `AppConfig` 每个 json 字段都必须登记（磁盘轨漏登记即红）
- E 磁盘轨**反向**对账：台账 `disk:` 条目必须是 Go 现存 json 字段（C 只有「Go ⊆ 台账」单向，字段删除后的幽灵登记要 E 才红）
- D 台账自洽：键名不重复、tier/authority 值合法、`migrates` 与 tier 一致

## 对外 API / 入口

- `SETTINGS_KEYS` / `findSettingsKey(key)` / `migratingSettingsKeys()` / `nonMigratingSettingsKeys()` / `exportableSettingsKeys()` / `unbackupableSettingsKeys()` — `frontend/src/settings-keys.ts`
- 磁盘轨写入唯一入口：`views/config-write.ts|writeAppConfig(patch)` → Go `SaveAppConfigPatch`（原子 patch，ADR-349；实参点单点化始于 ADR-313），执法 `tests/test_config_write_single_exit.ts`
- 主题读写两侧口径：`theme-core.ts|initTheme`（读）与 `views/config-write.ts|writeAppConfig`（写）——两侧都必须「磁盘优先」
- 备份迁移用户叙事：`docs/guide/backup-migration.md`「哪些设置会跟着迁移」一节
- 设置导出/导入（ADR-344-d1，桌面端）：前端 `views/app-content/settings/settings-backup.ts`（采集/回写浏览器偏好，白名单 = 台账 `exportableSettingsKeys()`）→ Go `internal/app/app_settings_export.go|ExportSettingsJSON` / `ReadSettingsExport` / `ImportSettingsFromFile`。Go 侧三道闸：①`ReadSettingsExport` 大小上限 8 MiB + format 门控 + **双版本门控**（`ExportVersion` 门控文件格式、`AppConfig.SchemaVersion` 门控配置 schema——两套独立编号，缺后者旧程序会按旧结构静默错读新版导出）；②`ExportSettingsJSON` 假备份**拒止**（配置文件存在却无任何路径设置 = 损坏后零值缓存形态，直接拒绝导出而非只记日志——做备份的人不看日志，假保险比没保险更糟）；③`ImportSettingsFromFile` 导入前备份 `ysm_config.json.bak-时间戳`（最多 10 份）。回写计数只算 `safeSet` 真正落盘的键（隐私竞态/配额满不计入「已应用 N 项」）。导入后前端 emit `settings:imported` 触发面板全量重建

## 与其他子系统关系

- `go/types/config.go|AppConfig` — 磁盘轨字段定义（台账断言 C 的正向对账对象、断言 E 的反向对账对象）
- `internal/app/app_config.go|SaveAppConfig` / `LoadAppConfig` — 磁盘轨读写（含 `configWriteMu` 串行化与 `orDefault` 以旧为基语义）
- `utils/base/primitives/storage.ts|safeGet/safeSet` — localStorage 轨唯一合规入口（隐私模式红线，禁裸调）；`safeSet` 返回落盘成败（false = 隐私竞态/配额满，已记 warn），对分叉敏感的调用方（导入回写计数）须消费返回值，fire-and-forget 的 UI 偏好写忽略即可
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
8. **设置导出/导入的键面以台账为单一事实源**。采集/回写白名单 = `exportableSettingsKeys()`（go-disk 随 appConfig 走、session/non-persistent 不备份、dual-write 镜像不备份——备份镜像反而制造两处不一致），消费方不得复写判定。导出文件里未登记的键一律忽略。**台账里登记了 `keyPattern` 的键族（3D 场景能力 `ysm-scene-cap-*`、工坊按站筛选态 `ysm-ws-active-tag*` 等）必须按通配展开真键采集/回写**——`key` 只是占位符，`safeGet("ysm-scene-cap-*")` 恒 null，把占位符当真键读等于整族不迁移（正是本功能要根治的换机静默丢）。候选键只能来自 `safeKeys()`/导出文件的实际键，禁按前缀猜键名（拼接规则一变就错）。导入后必须 emit `settings:imported` 重建面板（theme/语言/路径可能已变，只刷 store 会留下 UI 与真相分叉）。
9. **拼接键的可见性纪律**：动态键族的**前缀必须以 `*_PREFIX` 常量形态声明**（契约测试的 `_PREFIX`/模板首参口径只扫得到这两种形态）。藏在函数体内的模板拼接（`` return `ysm:x:${p}` ``）对账失明——新写拼接键先落常量、再登记台账 `keyPattern`，否则断言 B 扫不到、导出静默漏一族。
10. **`migrates` 只表「随复制配置文件走」，不表「换机丢不丢」**。ADR-344-d1 后两个口径分离：可导出键 `migrates:false` 但换机带得走。用户叙事（「要重设什么」）派生自 `unbackupableSettingsKeys()`，不是 `nonMigratingSettingsKeys()`。

## 相关

- 键集合与归属：`frontend/src/settings-keys.ts`
- 对账守卫：`tests/test_settings_key_ledger.ts`
- 磁盘轨字段：`go/types/config.go|AppConfig`
- 用户迁移叙事：`docs/guide/backup-migration.md`
- 设置导出/导入决策：`docs/adr/decisions/ADR-344-d1-settings-export-import.md`；前端采集/回写 `frontend/src/views/app-content/settings/settings-backup.ts`、磁盘侧 `internal/app/app_settings_export.go`
- 写入唯一出口（ADR-313 → ADR-349 原子化）：`views/config-write.ts|writeAppConfig` → Go `SaveAppConfigPatch`、执法 `tests/test_config_write_single_exit.ts`（已改锁新绑定）
- 主题双写口径：知识卡 `theme`
- localStorage 安全包装：知识卡 `dom-storage`
