---
kind: tech-debt-ledger
name: 技术债台账（探查快照 2026-10-08）
tier: leaf
category: go
status: snapshot
affected: false
source_files:
  - go/fsutil/safe_walk.go
use_when:
  - 技术债
  - tech debt
pitfalls:
  - 子代理探查易夸大债规模：H1 死链误报、H3「30+ 处吞错」实为 12 处且多已 log、G3「重复函数」多为有意保留的兼容入口——动手前必亲自 grep 核实
quick_groups:
  - 技术债探查
quick_intents:
  - 已还债 / 待还债 / 债的查证修正
quick_risk_lines:
  - 凡子代理报的债，先亲自 grep 真实代码 + 跑对应门禁验证，再决定是否动手；不要盲信「N 处违反」的计数
---

# 技术债台账（探查快照 2026-10-08）

> 快照卡：`status: snapshot` + `affected: false`，不进日常 AI 路由、不干扰 `use_when` 命中。
> 本卡是 2026-10-08 四域并行探查的结构化结论 + 主模型对探查报告的**查证修正**。
> 后续还债进展请更新本卡或迁 `docs/archive/`。

## 探查方法

4 个子代理按域并行：Go+Rust 后端 / 前端 TS / 架构·ADR·治理 / 测试·CI·依赖。
主模型对每条「高危债」亲自 grep 源码 + 跑门禁（`pre-push-gate --static`、`check-redlines`、`doctor --docs`）复核，修正了若干被夸大的项。

## 已归还（2026-10-08 提交 338d10748）

- **H2 · ADR-051 错误分类单源收敛（高）**
  - `go/cli/json.go` 的 `NewJsonError` 新增 `errors.As(&types.AppError)` 分支，优先透传 `types.ErrorCode`（如 `INVALID_PATH`）到 `JsonResponse.Error.Code`，前端 `friendlyError` 据此做 i18n；`ErrParam/ErrRuntime → param_error/runtime_error` 原有契约保持不变。
  - `go/importer/importer.go` 的 `sanitizeImportPaths` 由返回 `(string,string,string)` 改为返回 `(string,string,error)`，返回结构化 `types.AppError`（带 `Code`），消除 `Import` 内 `errors.New` 裸字符串漂移；`Import` 直接透传。
  - Go 单测钉死：`TestNewJsonError_PassthroughAppErrorCode` / `_LegacyErrParamUnchanged` / `_LegacyErrRuntimeUnchanged`。
- **H3 · ADR-030 WalkDir 失败可见（高）**
  - 新增 `go/fsutil/safe_walk.go` 的 `SafeWalk`（回调对访问失败的条目返回 nil 时补记日志）。
  - 收口 4 处真实「纯吞 err」站点：`ysm/extracted.go:259`（纹理查找）、`launcher/detect.go:116`（实例探测）、`cli/cli_scan_dir.go:186`、`cli/bench_concurrent.go:331`（两处"尽力而为"工具）。
  - **查证修正**：子代理报「30+ 处 `_ = WalkDir` 吞错」不成立——实际 12 处生产 `_ = WalkDir` 中，`watcher/recycle/sync/extracted:390/mmd` 等回调内**已 `log.Printf`/计数**，仅 2 处（`extracted:259`、`launcher/detect:116`）是真·静默吞错；其余 `_ =` 只是丢弃根目录不可读的顶层 error（下层已 log）。已自 log 的站点**不**改走 `SafeWalk` 以免重复记录。
  - Go 单测：`TestSafeWalk_LogsSkippedError` / `TestSafeWalk_PassthroughNonNil`。

## 待还债（按优先级，含查证修正）

### 高 / 中（建议近期）
- **H1 · 文档死链阻断 push（子代理误报）**：`docs/architecture.md:773` 的 `bundled_data.go cli.go` 是 ASCII 目录树美术字，非 markdown 链接；`check-doc-drift errors=0`、`pre-push-gate --static` 全绿。仓库本可推，**跳过**。
- **H4 · 悬空 ADR（高）**：ADR-122/139/186/251 仅 🔄部分采纳但零知识卡进度跟踪，决策已定无实施态记录。建议补 `source_files`/进度卡或状态行写明「暂缓/不实施」。
- **A2 · 92 篇 ADR 陈旧路径（中）**：ADR「相关」行引用已删除的 `frontend/src/utils/3d`（已迁 `preview-3d`），建议批量路径清洗。
- **A4 · R7 rtype 魔法串（中·WARN 级）**：`check-redlines` R7 仅 3 处（`const DEFAULT_NS = "ysm"` 等），其中至少 1 处是合法命名空间常量定义点；其余 250+ 处 `"ysm"` 是测试数据/文件名/合法 rtype 参数，**不可盲改**。逐处人工判定后再动。
- **A1 · 129/333 ADR 缺 emoji 状态标记 + 取代链错配（ADR-125/136/137/138）**：治理口径自相矛盾，建议归一状态行 + 补取代导航。
- **G1 · Rust 组件层空目录（中）**：`rust-core/`、`rust-wails-bridge/` 是空目录（仅 `rust-test-utils` 有 62 行测试工具），需在架构文档定性为「未实现/已弃用/已迁 Go」。

### 维护性（低·已知且被门禁冻结）
- **F1 · 死代码基线**：`check-deadcode-baseline` knip 183 + jscpd 118，ERROR 0、无新增（门禁只减不增）；优先回收 `preview-3d/caps`、`adapters`、`parsers`。
- **F2 · 32 个 >500 行巨型前端文件**：集中在 `preview-3d/caps/*`、`adapters/*`，按子域切分。
- **F3 · features 越 seam 软接触 backend 非绑定 helper**：`context-menu/version-updater/dnd/community/import/platform` 直引 `capabilities/platform/runtime/browser-adapter`，收口受许模块或经 seam 暴露（非硬违规，ADR-190/208 精神）。
- **G3 · 重复辅助函数（子代理部分夸大）**：`copyDirRecursive`/`copyFile` 等多数已在注释中声明「已收敛至 fsutil，保留双入口避免改名 churn（测试直接引用）」——是有意兼容入口，非真债；新代码务必走 `fsutil.*`，存量双入口按需收敛。
- **T1 · 依赖审计信息缺口**：本环境 `goproxy.cn` `Forbidden`、`npm outdated` 超时，无法实测 `go list -u -m all`/`npm audit`；已知风险 `@wailsio/runtime ^3.0.0-beta.26`（beta）、`typescript ^7`、`vite ^8` 大版本。需联网环境 `govulncheck` + `npm audit` 补全。
- **T2 · 薄弱测试**：`frontend/src/utils/base`(纯函数核)、`utils/storage`(隐私安全层) 无单测；Go `internal/app/app.go` 主编排仅间接覆盖。
- **T3 · 巨型 fixture 测试**：`water-capability.test.ts` 125KB 等，拆分降维护成本。
- **T4 · `vi.mock(".js")` 旧写法** 19 处（M3 过时），统一改 `.ts`。

## 总体判断

治理体系成熟度**高于**同类项目（红线脚本 `type-consistency`/`binding-check`/`check-redlines` 全绿、前端 `typecheck`/`vite build` 通过、零循环依赖、零生产 `any`/`@ts-ignore`、i18n 三语 parity 完美）。
真实高危债集中在两条已还的 ADR 红线（H2/H3）；其余多为「已知/可收敛/被门禁冻结」的维护性债，且子代理探查对 H1/H3/G3 存在**规模夸大**，动手前务必亲自核实。

## 相关

- ADR-051（错误分类单源）、ADR-030（后端健壮性契约）、ADR-010/065（rtype 单源）、ADR-190/208（features→backend seam）
- 受影响知识卡：`go-fsutil.md`（`SafeWalk`）、`go-importer.md`、`go-cli-layout.md`、`go-launcher.md`、`go-ysm-parser.md`
