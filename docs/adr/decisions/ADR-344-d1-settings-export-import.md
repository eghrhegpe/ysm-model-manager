# ADR-344-d1：设置导出/导入（桌面端 v1）——双轨收拢成单个 JSON，换机不再手抄偏好

- **状态**：✅ 已采纳（Adopted）
- **日期**：2026-10-16
- **决策人**：Jieling（人类首席架构师）、AI 代理

---

## 背景（一句）

设置持久化双轨（Go 磁盘 `ysm_config.json` + 前端 localStorage）把几十项偏好放在旧机的浏览器本地存储里，`b1116645c` 只写了「备份迁移双轨叙事」文档、代码从未实现导出/导入（`git log -i -S exportSettings` 为空），用户按 `docs/guide/backup-migration.md` 复制 `ysm_config.json` 即静默丢字号/键位/3D 偏好/收藏创作者。

## 决策（三行）

① **导出格式**：单个 JSON 文件 `ysm-settings-export.json`，`{format, exportVersion, exportedAt, appVersion, appConfig, localStorage}`；`appConfig` 为完整 `types.AppConfig`，`localStorage` 为「偏好类」键值 map（**不含缓存/会话态/调试/派生数据**）。导出目标固定为应用数据目录，UI 显示完整路径 + 复制按钮——与 `ExportWorkshopCreatorsJSONFile` 一致，**不新增保存对话框绑定**。

② **localStorage 采集口径以台账为单一事实源**：遍历 `exportableSettingsKeys()`（`tier=local-storage && authority=browser-authority` 的查询口，2026-10-16 更正：原写 `nonMigratingSettingsKeys()` 已随口径分离退役——`migrates` 只回答「复制 ysm_config.json 带不带得走」，不回答「换机丢不丢」，导出面归 `exportableSettingsKeys()`），剔除缓存/会话/调试/哨兵/派生键（社区合并、扫描作者缓存、诊断历史、`_debug`/`__waterSchemaVersion`、网页专用 IDB 日志与 `fsaRootHandle`）。不在前端手写键清单——台账已由 `tests/test_settings_key_ledger.ts` 双向对账，再手抄一份必然漂移。**台账登记了 `keyPattern` 的键族（3D 场景能力 `ysm-scene-cap-*`、工坊按站筛选态 `ysm-ws-active-tag*` 等）按通配在实际键上展开真键采集/回写**——`key` 只是占位符（`safeGet("ysm-scene-cap-*")` 恒 null），候选键只能取自 `safeKeys()`/导出文件的真实键，禁按前缀猜键名。

③ **导入走「备份 → 合并 → 落盘 → 侧效」同一把锁**：新增 `ReadSettingsExport(path)`（只读解析 + 校验）与 `ImportSettingsFromFile(path)`（先备份当前 `ysm_config.json` 为 `.bak`，再以导入配置为基、`applyConfigMigrations` 盖章、`washLinkMode` 洗脏，`configWriteMu` 锁内落盘）；把 `SaveAppConfig`/`SaveAppConfigPatch` 尾部的 `install.SyncLinkMode` + 根路径变更时 `rebuildWatcherAndDirs` 抽成共享 `applyPostSaveSideEffects(oldCfg, cfg)`，三处共用避免第三份手抄。路径字段**原样导入**（换机后旧盘符失效由 UI 提示「确认文件存储路径与游戏根目录」），不做 `mcRoot` 硬校验拦截——导入是迁移动作，不应因旧机路径在现机不存在而失败。

## 后果（一句）

桌面端换机从「复制一个文件 + 手重设几十项偏好」变为「导出一次 + 导入一次 + 改路径」；网页版（IndexedDB + `ysm:config`）留作后续，v1 不承诺。回退：`git revert` 单提交可逆（新增绑定 + 独立模块 + UI 小节，互不侵入既有写入口）。契约护栏：`settings-keys.ts` 新增 `disk:settingsExportVersion`（若有）走既有契约测试 C；导出文件结构由 `types.SettingsExport` 单点定义。

<!-- 文件名: c1.md → 实际文件 decisions/ADR-344-d1-settings-export-import.md（ADR-320 decisions 轻量模板） -->
