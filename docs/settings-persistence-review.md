# 设置持久化功能锐评（2026-10-17）

- **评审对象**：YSM 模型管理器「设置持久化」功能族——三轨台账（`frontend/src/settings-keys.ts`）、磁盘写入唯一出口（`views/config-write.ts|writeAppConfig`）、导出/导入（ADR-344-d1，`internal/app/app_settings_export.go` + `frontend/src/views/app-content/settings/settings-backup.ts`）、契约测试（`tests/test_settings_key_ledger.ts`）。
- **评审基线**：`0f8fc1817`（HEAD，2026-10-17）。上一轮锐评（2026-10-15/16）的 P0/P1 已基本落地（双门控专用 Code、导入顺序翻转、假备份拒止、尺寸闸、`LocalStorageKeyCount` 删除），本轮是对**当前树**的再评审。
- **实证方法**：全文读源码 + 跑 `tests/test_settings_key_ledger.ts`（✅ 全绿：go-disk 33 字段 + localStorage/IDB 64 键，扫 649 个生产文件）+ 核对启动链与事件订阅面。
- **结论**：**无 P0。P1 四条、P2 六条、P3 三条**。设计骨架（台账单一事实源 + 双向对账 + 导入顺序铁律）是全仓罕见的扎实样本，但**「白名单判据维度不足」「导入 UI 缺确认与后续引导」「dual-write 镜像导入后分叉」三条 P1 是真实缺陷**，会让 ADR 承诺的用户体验打折扣。

---

## 一、做得好的（先立靶）

1. **台账单一事实源 + 双向对账**（`settings-keys.ts` + `tests/test_settings_key_ledger.ts`）：断言 A（防死键）/ B（防漏登，主价值）/ C（Go 字段 ⊆ 台账）/ D（自洽）/ E（台账 disk: ⊆ Go 字段，防幽灵）五向闭合，是仓库里「文档-代码不腐」的范式。键族用 `keyPattern` 展开真键、禁按前缀猜名，把「拼接键隐身」盲区收进网里（抓出 `sb_selectedName_*` / `ysm-tabs-last-*` / `ysm:model-visible:*` 三族）。
2. **导入顺序铁律**（磁盘先落盘、浏览器后回写）及配套的「删掉 30 行从未被测试的补偿事务」——不是简化，是消掉不可判定的启发式。`settings-backup.test.ts:288-302` 锁「磁盘侧失败时浏览器**完全不写**」，比旧「写后再回滚」严格得多。
3. **双版本门控挂专用 Code**（`ErrSettingsTooNew`）：承认 `friendlyError` 命中 Code 即丢弃 Reason/Suggestion 的机制，把「请升级程序后导入」交给 i18n 分类文案承载——正确认清了错误通道的取舍。
4. **导出侧尺寸闸与导入侧对称**，且拒止从 `log.Printf` 升为「当场拒绝」——备份动作的失败必须可见，这是对的。
5. 前端测试把 `esc()`、参数直传（非 stringify）、失败零副作用、取消零副作用都锁进了 `initSettingsBackup` 编排链路，覆盖相当完整。

---

## 二、P1（高——建议下一轮修）

### P1-① 导入**没有二次确认**，注释与实现自相矛盾

**锚点**：`internal/app/app_settings_export.go:123-124`（`ReadSettingsExport` 注释：「前端先调本绑定拿到内容做**导入前确认**（含「导入后将应用 N 项浏览器偏好」计数）」）；`frontend/src/views/app-content/settings/settings-backup.ts:163-171`（点导入 → `SelectImportFile` → `ReadSettingsExport` → **立即** `ImportSettingsFromFile`，无任何确认弹窗）。

**问题**：`ReadSettingsExport` 的存在理由是「导入前确认」，但 UI 流程是选完文件**直接整份覆盖**。而导入是**破坏性**动作——ADR-344-d1:19 明确「以导入配置为基」整份覆盖磁盘 `AppConfig`，且会重启 watcher、改写 `FilesRoot`/`McRoot`。误选文件 / 误点即覆盖当前全部设置。虽然有 `.bak-*` 可回滚，但 UI 既不预告「即将覆盖 N 项设置、磁盘路径将被改写」，也不告知「已生成备份、位于哪里、如何恢复」。读取到的 `exp.AppConfig` 完全没被展示（只用了 `localStorage` 计数），`ReadSettingsExport` 的「预览」价值浪费了一半。

**影响**：迁移动作对用户是一次「无提示的破坏」。这是 ADR 自己声明的能力未落地，不是额外需求。

**建议**：`ReadSettingsExport` 之后加确认对话框，展示三件事——①「将覆盖磁盘配置（含文件存储路径 / 游戏根目录，可能需要重新确认）」；②「将应用 N 项浏览器偏好」（用现有 `applied`/`importedKeysFrom` 口径）；③「导入前已自动备份到 {backupPath}，导入后如不满意可用它恢复」。确认后才调 `ImportSettingsFromFile`。

**处置**：✅ 已处置（2026-10-17）——`settings-backup.ts` 在 `ReadSettingsExport` 后、`ImportSettingsFromFile` 前插入 `modalConfirm`（`titleIcon: "warning"`、`danger: true`、`okText` 自定义），message 预告「整份覆盖当前设置（文件存储路径 / 游戏根目录等磁盘配置被替换）+ 将应用 N 项浏览器偏好（`importedKeysFrom(exp.localStorage).length`）+ 导入前已自动备份、可在备份目录找回」，取消则磁盘/浏览器都零副作用。新增三语言 i18n 键（`settings.backup.importConfirmTitle` / `importConfirmMessage` / `importConfirmOk`，zh-CN / en / ja）。测试补两条：①确认（断言 `danger` 样式 + `modalConfirm` 调用先于 `ImportSettingsFromFile`）；②取消（`ImportSettingsFromFile`/`safeSet`/`emit` 都不动）。

### P1-② 导入后 `dual-write` 镜像键（theme/themeAuto）与磁盘**必然分叉**，且无任何同步

**锚点**：`frontend/src/settings-keys.ts:985-989`（`exportableSettingsKeys` 判据 `tier=local-storage && authority=browser-authority`，注释「`dual-write` 不备份——事实源在磁盘，备份镜像反而制造两处不一致」）；`frontend/src/theme-core.ts:104-120`（`initTheme` 磁盘分支：`cfg.theme || safeGet("theme")` → `safeSet("theme", theme)` 回写镜像——**只在启动时执行一次**）；`frontend/src/bus.ts` + `git grep settings:imported`（`settings-backup.ts:180` 只 `bus.emit("settings:imported")`，订阅方仅 `app-content/index.ts:96` 重建面板）。

**问题**：`theme`/`theme-auto` 是 `dual-write`（磁盘权威 + localStorage 镜像），因 `authority` 不是 `browser-authority` 被白名单排除 → **导入不会回写这两个镜像键**。但导入会**改写磁盘** `theme`/`themeAuto`（导出源值）。于是导入后到下次重启之间：磁盘 `theme=导出源值`、localStorage `theme=本机旧值`，而 `theme-core` **不订阅 `config:changed` 也不订阅 `settings:imported`**（grep 零命中），面板重建也不会重跑 `initTheme`。用户看到「导入成功」，但主题仍是旧值，UI 与真相分叉直到重启。

**影响**：白名单排除 `dual-write` 的理由是「避免备份镜像」，但导入场景里磁盘**确实变了**而镜像没跟着变，结果恰好制造了它想避免的那种「两处不一致」。排除逻辑在「采集」场景成立，在「导入」场景不成立。

**建议**：导入成功后补一次「镜像回同步」——让 `theme-core` 订阅 `settings:imported`（或由 `settings-backup.ts` 显式调 `syncThemeMirror()`）：读磁盘 `cfg.theme||cfg.themeAuto`，`safeSet` 回写两个镜像键。这与 `initTheme` 同口径，不是新逻辑。

**✅ 已处置（2026-10-17）**：在 `app-content/index.ts` 的 `settings:imported` 订阅里补 `void initTheme()`（重建面板同处）。`initTheme` 本身即以磁盘为权威重算并 `safeSet` 回写 `theme`/`theme-auto` 两个镜像键（`theme-core.ts:100-129`），**未新增独立 `syncThemeMirror` 函数**——复用启动链同一口径，避免「两处镜像回写逻辑」漂移。
**📌 处置依据**：未采纳「让 `theme-core` 订阅 bus」——`theme-core.ts:1-6` 是神桶拆分后的纯逻辑层（零顶层副作用），bus 广播属启动装配、由 `app-modules.ts` 承接；让纯逻辑层订阅 bus 会重新引入「import 即副作用」的测试困境。同步挂在事件消费方 `app-content/index.ts`，符合既有分层。`initTheme` 内部 catch 一切、`void` fire-and-forget 不阻塞面板重建。

### P1-③ 假备份拒止判据**误伤正常用户**——「无路径设置」≠「配置损坏」

**锚点**：`internal/app/app_settings_export.go:86-95`（`cfg.FilesRoot=="" && len(cfg.CustomRoots)==0` 且 `os.Stat(configPath())` 存在 → 拒绝导出）；`internal/app/app.go:331-340`（`resolveStartupConfigBootstrap`：`configFileMissing` 或 `McRoot==""` 且自动探测到 Minecraft 目录时 `needsWrite=true`）、`app.go:235-246`（启动链据此 `saveConfig`）。

**问题**：拒止意图是「拦配置损坏后的零值缓存」，但判据是「路径字段为空」。而启动链会在**配置文件缺失时重建**，并在 `McRoot==""` 时**自动探测 Minecraft 目录落盘**。装过 Minecraft 的用户（绝大多数）首启动即自动生成配置文件（`McRoot` 非空），若此时尚未在「设置 → 环境」设文件存储根目录（`FilesRoot` 空、`CustomRoots` 空），导出被**直接拒绝**——哪怕他只是想把字号/主题/键位导走。`configPath()` 存在**不**蕴含「损坏」。

**影响**：真实路径存在（新装机、未设仓库路径即导出浏览器偏好）；同时判据不可靠——「文件存在 + 无路径」对正常用户是常态而非异常形态。

**建议**：拒止判据改挂在**配置可解析性**上（如 `LoadAppConfig` 解析失败、`SchemaVersion` 异常、或明确加一个 `configCorrupt` 标记），不要用「路径字段空」代理。至少把判据收窄为「配置文件存在且 `loadAppConfig` 走的是损坏回退分支」。

**✅ 已处置（2026-10-17）**：判据收窄为「配置文件存在且**无法解析**」。`ExportSettingsJSON` 里 `os.Stat(configPath())` 存在时用 `readJSONFile` 重新解析磁盘配置，解析失败（`json.Unmarshal` 报错）才拒止；JSON 合法（哪怕路径全空）即放行——反映的是用户真实状态，不是损坏。未新增 `configCorrupt` 标记字段（改动面更大、且 `LoadAppConfig` 的 `configLoaded=false` 重试语义不应被破坏）。测试同步：`TestExportSettingsJSON_RejectsCorruptConfig` 保留（写损坏 JSON，仍拒止）+ 新增 `TestExportSettingsJSON_AllowsExistingConfigWithoutPaths`（写合法 `{}`，放行——锁住 P1③ 的误伤路径）。

### P1-④ 白名单判据只有二维（tier + authority），装不下 ADR 明确要求排除的类别

**锚点**：`frontend/src/settings-keys.ts:985-989`；`docs/adr/decisions/ADR-344-d1-settings-export-import.md:17`（决策②「**剔除**缓存/会话/调试/哨兵/派生键（社区合并、扫描作者缓存、诊断历史、`_debug`/`__waterSchemaVersion`、网页专用 IDB 日志与 `fsaRootHandle`）」）；台账内 `scan-authors`（`settings-keys.ts:773` note「派生缓存（扫仓产出），换机重扫即重建」）、`ListModelAuthors`（:782 note 派生缓存）、`community-merge`（:791 note 派生缓存）、`ysmAlphaInfo`（:614 note「派生缓存…重启重算成本高故持久化」）、`perf-history`（:764 note 趋势历史）、`ysm:config`（:810 note「桌面端不读此键」）、`web:workshop-creators`/`web:workshop-sites`/`web:github-repos`（:819-843，网页模式专用）——**这些键的 `authority` 全填的是 `browser-authority`，因此全部落入 `exportableSettingsKeys()` 白名单**。

**问题**：ADR 决策②要求剔除「派生缓存」「网页专用」键，但白名单判据只有 `tier` + `authority` 两维，台账靠「把派生缓存标成 `non-persistent`」来排除——而上面这批却被标成 `browser-authority`（因为它们在语义上确实是「浏览器权威」）。结果有两个真实危害：

- **污染**：桌面端导出文件会带上 `ysm:config`（网页版整份配置替身，可能不小）与 4 个 `web:*` 覆盖表，虚增文件体积、逼近尺寸闸。
- **陈旧数据回灌**：导入时这些键被写回新机 localStorage，**覆盖新机刚重算的缓存**。比如导入旧机 `scan-authors`/`ListModelAuthors`（作者索引，扫仓产出）后，作者列表显示旧机数据直到下次重扫；`community-merge` 同理。

**影响**：这是**判据维度不足**的系统性问题，不是个别登记错误——`exportableSettingsKeys` 无法表达「仅网页模式」「派生可重算」两个 ADR 明确要排除的维度。

**建议**：白名单判据补第三维。最小改法：新增一个 `exportable?: boolean`（默认跟随现状）或 `persistenceKind: "user-preference" | "derived-cache" | "web-only"` 字段，`exportableSettingsKeys()` 只收 `user-preference`；把上表这批键按真实性质归类。契约测试 D 组补一条「`exportable` 与 `authority`/note 自洽」的断言（如派生缓存不得 `exportable`）。

**✅ 已处置（2026-10-17，commit `4a9340068`）**：采纳最小改法 `exportable?: boolean`（缺省跟随二维判据）。`exportableSettingsKeys()` 判据补 `e.exportable !== false`。显式 `exportable: false` 的键：派生缓存 4 个（`ysmAlphaInfo` / `scan-authors` / `ListModelAuthors` / `community-merge`）+ 网页模式专用 4 个（`ysm:config` / `web:workshop-creators` / `web:workshop-sites` / `web:github-repos`）。契约测试新增断言 D5：note 命中 `/派生缓存|仅网页模式|桌面端不读此键/` 的 localStorage 键必须 `exportable === false`（防新派生缓存/网页专用键漏标）。
**📌 处置偏差（与报告建议不同，说明理由）**：`perf-history` **未**标 `exportable: false`，反而显式 `exportable: true`。报告将其列为污染项，但复核后认定它是**用户积累的趋势历史**（攒够 ≥2 条才画趋势线，换机后重算需重新采样，非纯派生缓存）——剔除它会让换机丢用户可见历史，违背「用户会心疼丢的东西」这一台账主语。ADR 决策②的「诊断历史」按「纯派生、可重算」理解，`perf-history` 不在其列。台账 note 已补该归类说明，与 D5 断言不冲突（其 note 不命中 hint）。

---

## 三、P2（中——可排期）

### P2-① 导出侧尺寸闸在 marshal **之后**，防不住 marshal 阶段开销

**锚点**：`internal/app/app_settings_export.go:105`（`json.MarshalIndent`）→ `:112`（`len(data) > settingsExportMaxBytes` 才检查）。对比导入侧 `:129-135`（先 `os.Stat` 看大小**再** `ReadFile`）。

**问题**：尺寸闸位置不对称。localStorage map 很大时，`MarshalIndent` 已经把整份数据塞进内存、花完 CPU 才算到超限。低危（map 来自本机前端、非外部输入），但闸门的「防资源浪费」语义被架空一半。

**建议**：采集侧先估大小（如 `collectExportableLocalStorage` 后按键值总长粗算）早退，或导出一开始就带上限断言。

### P2-② `ReadSettingsExport` 与 `ImportSettingsFromFile` 双重读取 + 轻微 TOCTOU

**锚点**：`settings-backup.ts:163`（前端 `ReadSettingsExport` 取 `exp` 计数）→ `:167`（`ImportSettingsFromFile`，Go 内部 `app_settings_export.go:180` 再次 `ReadSettingsExport`）。

**问题**：同一文件读两遍。计数用第一次读的 `exp.localStorage`，实际写盘走第二次读的文件——两遍之间文件若被替换，计数与实际写入不符（本机场景低危）。且是纯冗余设计。

**建议**：让 `ImportSettingsFromFile` 返回实际应用的浏览器键集合（或让前端只依赖 `res`），避免二次读。

**✅ 已处置（2026-10-17，commit `4df3e4d9a`）**：新增绑定 `ImportSettingsData(exp types.SettingsExport)`，与 `ImportSettingsFromFile` 共用 `importResolved` 落盘主体。前端 `ReadSettingsExport` 预览后把**同一个** `exp` 传给 `ImportSettingsData`，不再对同一文件读两遍——计数与实际写入必然一致。`importResolved` 补 `exp.Format` 数据入口防线（未走 `ReadSettingsExport` 校验的伪造/错误数据被拒止，不会以零值 `AppConfig` 覆盖当前配置）。`ImportSettingsFromFile` 保留为按路径入口（向后兼容）。配套：`settings-backup.ts` 解构改 `ImportSettingsData`；`e2e/mock-data.ts` 补 `ImportSettingsData: undefined`（bindings 契约，`MockKey` 须覆盖新绑定）；测试 Go 侧新增 `TestImportSettingsData_RoundTripAndBackup` / `TestImportSettingsData_RejectsBadFormat`，前端既有「磁盘失败不写浏览器」「取消零副作用」用例照旧锁（mock 名同步改）。

### P2-③ 导出固定路径**静默覆盖**上一次导出

**锚点**：`app_settings_export.go:39`（`settingsExportFilename = "ysm-settings-export.json"` 固定）、`:117-120`（`WriteFileAtomic` 直接覆盖）。

**问题**：第二次导出覆盖第一次，旧文件无版本号、无提示。用户若已把旧文件拷走则无碍，但「导出」动作通常意味着「保留一份」，静默覆盖违背直觉，且覆盖后无法找回。

**建议**：文件名带时间戳（如 `ysm-settings-export-20261017-1530.json`），或覆盖前确认；至少 toast 提示「已覆盖上次导出的文件」。

**✅ 已处置（2026-10-17，采纳「时间戳」方案）**：导出文件名改为带时间戳 `ysm-settings-export-YYYYMMDD-HHMMSS.mmm.json`（`settingsExportNameFmt` + `settingsExportTimeFmt`），每次导出都是独立快照、不再静默覆盖——比「覆盖前确认」更贴合「导出=保留一份快照」的直觉。配套 `settingsExportKeep = 10` + `pruneOldExportFiles()`（Glob `ysm-settings-export-*.json`，时间戳前缀字典序 LRU 删最旧，保留 10 份；清理失败仅 `log.Printf`——多留一份比删错更安全，与 `pruneOldConfigBackups` 同模式）。UI 显示/复制的就是当次导出路径（时间戳名），语义更清楚。测试：新增 `TestPruneOldExportFiles_KeepsRecentExports`（造 15 个假导出 → 裁剪到 10、最旧被删）；原 `path != settingsExportPath()` 断言改为 `assertExportPathInConfigDir` helper（时间戳名不能精确相等，改断言目录 + 文件名前缀）。

### P2-④ 备份文件**有产出、无 UI 消费入口**

**锚点**：`app_settings_export.go:43-45`（`settingsBackupKeep = 10`，LRU 裁剪）、`:241-252`（`pruneOldConfigBackups`）；`settings-backup.ts:176`（UI 仅 `setStatus(t("settings.backup.importedTo", { n, backup: esc(backupPath) }))` 一行文字）。

**问题**：ADR-344-d1:19 承诺「后悔可还原备份文件」，但还原路径全在 UI 外——用户只能自己打开文件管理器找到 `.bak-*` 替换 `ysm_config.json`。设置页无「浏览备份 / 恢复此备份 / 删除旧备份」入口，且 `.bak-*` 会累积到 10 份用户不知情。

**建议**：状态行把 `backup` 变成可点按钮（「打开备份位置」），或加一个「恢复上次导入前备份」按钮（读最新 `.bak-*` → `ImportSettingsFromFile` 同链路）。

### P2-⑤ 导入成功后**未做「环境」侧引导**，ADR 承诺的「UI 提示确认路径」未落地

**锚点**：`docs/adr/decisions/ADR-344-d1-settings-export-import.md:19`（「路径字段**原样导入**（换机后旧盘符失效由 UI 提示「确认文件存储路径与游戏根目录」）」）；`settings-backup.ts:176-180`（导入成功仅 `setStatus` + `toast` + `bus.emit("settings:imported")`，无任何路径确认提示或跳转）。

**问题**：导入后 `FilesRoot`/`McRoot` 指向旧机路径，应用无法扫描，静默表现为「仓库空」「导入失败」。UI 侧「由 UI 提示」这一承诺完全未落地。

**建议**：`settings:imported` 后检测 `cfg.FilesRoot`/`cfg.McRoot` 是否本机存在，不存在则 toast + 跳转「设置 → 环境」卡片，或加警示条「导入的文件存储路径在当前机器不存在，请重新设置」。

**处置**：📌 **部分不成立**（2026-10-17 复核）——`settings.backup.importDone` 文案已含「若导入的路径在本机无效，请在「环境」页重新设置目录」（zh-CN / en / ja 三语言），**文案侧提示已存在**，锐评「完全未落地」不准确。但**自动检测**路径有效性 + 跳转/警示条仍未实现——保留为后续增强（需 Go 侧路径存在性绑定，与 P2-④「恢复备份」同属导入后 UX 收尾，一并排期）。

### P2-⑥ `if (!exp) return` 是死代码

**锚点**：`settings-backup.ts:164`（`if (!exp) return; // 防御：read 成功但回空（Go 侧不应发生）`）；`go/types/config.go:70`（`SettingsExport` 是 **struct**，非指针），Wails 绑定成功时恒为对象。

**问题**：`!exp` 对对象恒 `false`，分支不可达。注释称「Go 侧不应发生」恰恰说明它不该写。会误导后续维护者以为空返回是可能态。

**建议**：删除，或改为判关键字段（如 `exp.format` 非空）。

**处置**：✅ 已处置（2026-10-17，随 P1-① 一并）——防御判空改为 `if (!exp?.format) return`（保留防御语义、分支可达）；测试里 `ReadSettingsExport` mock 补 `format: "ysm-settings-export"`，并加注释说明为什么不能写 `!exp`。

---

## 四、P3（低——记录）

- **P3-① 导出文件无内容指纹**：无 SHA256/hash，导入侧无法检测文件被截断（除 JSON 解析失败外）。低危。
- **P3-② 前缀通配 `matchesPattern` 会误匹配未来同前缀键**（`settings-backup.ts:43-51`）：如 `ysm-ws-active-tag*` 会匹配未来新增的 `ysm-ws-active-tag-other`。低危。
- **P3-③ 台账 `owner` 命名跨语言不一致**：localStorage 键写 `views/app-content/settings/ui-prefs.ts`（含目录），磁盘轨写 `internal/app/app_config.go`（含包路径），个别写裸 `theme-core.ts`——`owner` 注释说「文件会搬家，模块名不会」，但实际填的是路径形态。低危，影响人工回溯。

---

## 五、总体评价与处置建议

**评分**：骨架 9/10，执行 7/10。台账 + 契约测试 + 导入顺序铁律是仓库级范本；失分集中在**白名单判据维度不足**（P1-④）和**导入 UX 半成品**（P1-①、P1-②、P2-④、P2-⑤）——ADR 把「换机从手抄偏好变一键迁移」说清楚了，但「一键迁移之后呢」这条链（确认 → 镜像同步 → 路径引导 → 可回滚）没接完。

**建议处置顺序**：

1. **P1-④**（白名单补第三维 + 台账归类 + 契约 D 组补断言）——根因，其余三条都受它影响。
2. **P1-①**（导入确认对话框）+ **P1-②**（镜像同步）+ **P2-⑤**（路径引导）——同属导入 UX，一次改。
3. **P1-③**（拒止判据改挂可解析性）——单独，判据收窄。
4. P2 六条按排期，P3 记录即可。

**处置记录**：本报告条目请按项目惯例在修复后补 `docs(锐评)` 提交逐条记录（接受 / 不采纳理由）；不采纳的条目写明实证复核结论。

---

*评审人：AI 代理（鲸鱼架构师 deepseek）｜评审日期：2026-10-17｜基线 commit：`0f8fc1817`*
