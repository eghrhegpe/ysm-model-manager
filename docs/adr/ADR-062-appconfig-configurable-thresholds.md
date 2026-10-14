# ADR-062：AppConfig 可配置化下沉：运行阈值与检查间隔从常量收敛为配置项

- **状态**：✅ 已采纳
- **日期**：2026-08-15
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`docs/archive/extensibility-index.md 6.7/4.4/1.9a`、`go/types/config.go`、`go/scanner/scanner.go:46`、`go/download/download.go:26`、`go/logs/logs.go:18,21,27`、`go/logs/runtime.go:11`、`go/fileops/fileops.go:20`、`frontend/src/features/version-updater.ts:24,26`、`frontend/src/backend/web-store.ts:33-34`、`internal/app/app.go`（启动注入 `LoadAppConfig`）

---

## 1. 背景（Context）

### 1.1 运行阈值散落为包级常量，不可配置

可拓展点发掘（extensibility-index 6.7）定位：`AppConfig` 已含 `Mirror`/`VoxelMaxBlocks`/`LinkMode` 等配置项，但运行阈值仍以包级常量硬编码，跨 4 个包 6 处：

| 阈值 | 位置 | 现状 |
|------|------|------|
| 扫描缓存 TTL（30s） | `go/scanner/scanner.go:46` `scanCacheTTL` | 包级常量 |
| 下载超时（300s） | `go/download/download.go:26` `defaultTimeout` | 包级常量 |
| 日志条数上限（500） | `go/logs/logs.go:18` `maxLogEntries` | 包级常量 |
| 日志字段上限（1024） | `go/logs/logs.go:21` `maxFieldLen` | 包级常量 |
| 日志保留天数（7） | `go/logs/logs.go:27` `corruptRetentionDays` | 包级常量 |
| 预览读取上限（50MB） | `go/fileops/fileops.go:20` `maxPreviewRead` | 包级常量 |

### 1.2 用户可感知间隔同样硬编码

- 版本检查间隔（6h）/ 超时（30s）：`frontend/src/features/version-updater.ts:24,26` `CHECK_INTERVAL`/`CHECK_TIMEOUT`
- 网页版日志环容量（500/300）：`frontend/src/backend/web-store.ts:33-34` `WEB_IMPORT_LOG_CAP`/`WEB_RUNTIME_LOG_CAP`

### 1.3 既有裁决

- ADR-044 策略 A：基础设施工具收敛——阈值已具名（本轮已完成 6.10/6.12 常量集中），但「具名」不等于「可配置」。
- 常规轮次约束：阈值下沉 AppConfig 属**跨层行为变更**（Go types 结构体 + 各包读取改造 + 前端设置页），非纯提取，已评估不宜在常规轮次内 rush。

## 2. 决策（Decision）

**运行阈值与用户可感知间隔从包级常量收敛为 AppConfig 可配置项**，默认值等于现有常量（零行为漂移），仅「需要调整时」通过设置页/配置文件覆盖：

1. **AppConfig 扩展字段**（`go/types/config.go`）：
   - `ScanCacheTTLMs int`（默认 30000，0=用默认）
   - `DownloadTimeoutSec int`（默认 300，0=用默认）
   - `LogMaxEntries int`（默认 500，0=用默认）
   - `LogMaxFieldLen int`（默认 1024，0=用默认）
   - `LogCorruptRetentionDays int`（默认 7，0=用默认）
   - `PreviewReadLimitMB int`（默认 50，0=用默认）
   - `UpdateCheckIntervalMs int`（默认 6h，0=用默认）
   - `UpdateCheckTimeoutMs int`（默认 30s，0=用默认）
2. **读取改造**：各包提供 `configFunc` 注入点（薄壳传 `AppConfig`），读取时 `0 → 常量默认值`，与现有 `VoxelMaxBlocks` 的「0=默认 200000」语义对齐；无配置注入时行为完全不变。
3. **前端设置页**：版本检查间隔/日志容量可进设置项（低优先，随 4.4 立项拆分小步落地）。
4. **网页版**：`web-store.ts` 日志容量读取 localStorage 覆盖层（默认 500/300），与桌面 `AppConfig` 语义对齐。

## 3. 后果（Consequences）

**正面**：
- 运行时调整阈值无需改代码重编译（长 TTL 大仓库、慢网络下载超时等真实场景）。
- 阈值「具名 → 可配置」消除用户对硬编码间隔的不可控感（检查间隔 6h 无法缩短）。

**负面**：
- 跨层改动面：Go types 结构体 + 4 个 Go 包读取 + 前端设置页 + 网页版覆盖层，需分阶段落地。
- 配置漂移风险：默认值必须与现有常量严格一致，测试需钉住「0=默认」契约。

**已知遗留**：
- `updater` 手写 semver（6.9b）与阈值无关，独立立项（ADR-063）。
- 网页版 `CFG_KEY` 等 localStorage 键规约未纳入本 ADR（保持现状）。

## 4. 数据溯源

来源：`docs/archive/extensibility-index.md` 6.7（阈值下沉 AppConfig）、4.4（检查间隔进设置）、1.9a（日志容量参数化）→ 结果：ADR-062 立项，编码按 §2 分阶段落地（Go 字段先行 → 各包注入点 → 前端设置页）。

<!-- 文件名: appconfig-configurable-thresholds.md → 实际文件 ADR-062-appconfig-configurable-thresholds.md -->
