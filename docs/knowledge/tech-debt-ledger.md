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
- **H1 · 文档死链阻断 push（子代理误报·已核实跳过）**：`docs/architecture.md:773` 的 `bundled_data.go cli.go` 是 ASCII 目录树美术字，非 markdown 链接；`check-doc-drift errors=0`、`pre-push-gate --static` 全绿。仓库本可推，**跳过**。
- **H4 · 悬空 ADR（子代理误报·2026-10-08 核实已完备）**：子代理称 ADR-122/139/186/251「零知识卡进度跟踪」，实测四篇均已在 ADR 头部自标 🔄部分采纳的**精确范围**——ADR-122（tier3 Builder 化否决）、ADR-139（L3 跨 OS 不在批准范围）、ADR-186（含「被取代」字段指向 ADR-210）、ADR-251（顶部 blockquote 声明 §2.2 被 ADR-252 取代、其余有效）。状态字段已足够，符合 ADR 体系「状态记生命周期、不记实施进度」约定；ADR-186/251 更优地把取代链内嵌进 ADR 自身。**无需补卡，移除本项**。
- **A2 · ADR 陈旧路径（中·已推进，2026-10-08 修正 17 处事实锚点型）**：子代理称「92 篇 utils/3d 陈旧路径」被夸大——`frontend/src/utils/3d/` 已整体升格 `frontend/src/preview-3d/`（ADR-129/138/235），143 处 `utils/3d` 引用多为 ADR **历史叙述**（迁移旧名），不可机械替换；`check-adr-drift` 不查散文路径故门禁不报错。真实可修的是**事实锚点型**引用（「相关」/「新建」/「落点」行指向当前代码）。进展：① 已据 `audit-20260922.md` 实锤修正 ADR-127（2 处路径→preview-3d）、ADR-122「相关」行（旧路径+失效命名 BuildCtx）、同步 audit 自身（提交 7c268fe69）；② **子代理分域判定**：`grep docs/adr/` 命中 56 处，其中 **17 处事实锚点型已修正（跨 16 篇 ADR，提交 56d257823）**，每个新路径经 `Test-Path` 验证存在于 `frontend/src/preview-3d/` 下（按新目录结构补齐子目录：`model3d.ts→mesh/model3d.ts`、`mmd-adapter.ts→adapters/mmd/mmd-adapter.ts`、`multi-model.ts→menu/panels/multi-model.ts` 等）；**其余 39 处保留**——为历史叙述（迁移动作描述，如 ADR-072「迁入 utils/3d/」、ADR-049「纯 TS 移植到」）或目标不存在（`perception/` 已迁 `adapters/shared/perception/`、菜单子系统已重构为 `menu/{engine,panels,...}/`，旧文件名不复存在）。行号保留（ADR 历史陈述性质），未改状态/决策。
- **A4 · R7 rtype 魔法串（子代理误报·2026-10-08 核实 3 处均为"值形似、语义非 rtype"）**：`check-redlines` R7（WARN 级，`fix: RESOURCE_TYPES`）报 3 处，逐处实锤均非 rtype 魔法串——
  - `preview-3d/state/model-defaults.ts:17` `| "ysm"`：是 `ModelType` 预览预设类别 union 的成员（同 union 含 `"default"`/`"mmd-scene"` 等**非 rtype 值**），语义域是"场景预设 key"而非资源类型 ID；硬改引用 `types.YSM` 会破坏类型语义。
  - `utils/cache/with-cached.ts:27` `DEFAULT_NS = "ysm"`：是**缓存命名空间前缀**（localStorage 缓存 key 前缀），与 rtype 无涉；值是 `ysm` 纯属巧合，引用 `types.YSM` 反而让"缓存命名空间"语义不清。
  - 第 3 处 snippet `"ysm",` 同理为值形似。**结论：误报，不修**——R7 的文本匹配无法区分"值=ysm 但语义非 rtype"的场景。真正该引用 `types.YSM` 常量的点已被 `type-consistency`/`binding-check` 覆盖。
- **A1 · 129/333 ADR 缺 emoji 状态标记 + 取代链错配（ADR-125/136/137/138）**：治理口径自相矛盾，建议归一状态行 + 补取代导航。
- **G1 · Rust 组件层空目录（子代理误判为"未实现"·2026-10-08 实锤为"已退役"并已清理）**：子代理称 `rust-core/`、`rust-wails-bridge/` 是空目录需定性为"未实现/已弃用/已迁 Go"——实测 `git log --diff-filter=D -- docs/knowledge/rustbridge.md` 命中 `3bf77cd63`「refactor: 删除 Rust 扫描基础设施（Go 并行遍历取代）」，**Rust 桥已明确退役**，非未实现。两目录为空壳（0 条目、未 git 跟踪、无构建脚本依赖），`go/rustbridge` 亦不存在。**已删除两个空壳目录**（净化退役残留）。唯一幸存 crate 为 `rust-test-utils`（`TempRoot` 61 行，git 跟踪）。**遗留可清理项**：`.gitignore:146-150` 的 4 条死规则（`rust-core/target/`、`rust-wails-bridge/target/`、`go/rustbridge/static-lib/`、`go/rustbridge/android-lib/`）指向不存在的路径，无害但为退役残留，团队可择机清除（本轮保留以防 Rust 回归）。

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
真实高危债集中在两条已还的 ADR 红线（H2/H3）；其余多为「已知/可收敛/被门禁冻结」的维护性债，且子代理探查对 **H1（死链误报）、H3（30+ 吞错夸大，实为 2 处）、H4（悬空 ADR 误报，四篇状态已完备）、G3（重复函数多为有意保留入口）、A2（92 篇夸大，实为历史叙述+审计已盘 3 处）** 存在系统性夸大，动手前务必亲自核实。

## 相关

- ADR-051（错误分类单源）、ADR-030（后端健壮性契约）、ADR-010/065（rtype 单源）、ADR-190/208（features→backend seam）
- 受影响知识卡：`go-fsutil.md`（`SafeWalk`）、`go-importer.md`、`go-cli-layout.md`、`go-launcher.md`、`go-ysm-parser.md`
