---
kind: cli_quality_audit
name: CLI 质量摸排 Checklist
tier: architecture
category: go
source_files:
  - go/cli/
  - internal/app/cli_bridge.go
  - frontend/src/services/cli-bridge.ts
auto_fields:
  symbols_with_lines:
    - ALLOWED_CLI_COMMANDS
    - App.ExecuteCLI
    - App.GetAllowedCLICommands
    - App.SetAllowedCommands
    - AppService
    - buildArgsMap
    - CatCache
    - CatConfig
    - CatModel
    - CatOther
    - CatPerf
    - CatResource
    - cliAnalyze
    - CLIArgs
    - cliCacheStatus
    - CliCommand
    - cliList
    - CLIResponse
    - cliSearch
    - CmdContext
    - DispatchCommand
    - ErrParam
    - ErrParam.Error
    - ErrParam.Unwrap
    - ErrRuntime
    - ErrRuntime.Error
    - ErrRuntime.Unwrap
    - executeCLI
    - ExecuteCLIWithApp
    - ExitCodeOf
    - ExitParamErr
    - ExitRuntimeErr
    - ExitSuccess
    - GetAllCommands
    - getAllowedCLICommands
    - GetAllowedCommands
    - GetCommand
    - IsCommandAllowed
    - JsonError
    - JsonResponse
    - JsonResponse.ToJson
    - MetaInfo
    - NewJsonError
    - NewJsonNotSupported
    - NewJsonSuccess
    - parseCLIResponse
    - ParseCommandArgs
    - PrintError
    - RegisterCommand
    - RegisterCommandC
    - resetDynamicCommandsCache
    - RunCLI
    - String
    - TimingInfo
  tests:
    - frontend/src/services/cli-bridge.test.ts
tests:
  - frontend/src/services/cli-bridge.test.ts
use_when:
  - CLI
  - 质量摸排
  - 代码审核
  - 代码审查
  - bug 排查
  - 审计
  - 白名单
  - 绑定层
pitfalls:
  - "绑定层工具函数重复 → Go CLI 和前端 TS 各一份"
  - "白名单漂移：ALLOWED_CLI_COMMANDS 在三处维护"
  - "goroutine/channel 防御缺失：outputBuffer.done 未初始化导致 panic"
  - "百分比计算三类陷阱：除零、超 100%、基数语义错误"
  - "json.Marshal 吞错：_, err := json.Marshal(...) 前端收到 null 无法定位"
quick_intents:
  - "CLI 质量摸排 / 代码审查"
  - "绑定层故障排查"
  - "goroutine/channel 资源回收 bug"
  - "百分比计算审计"
  - "json.Marshal 吞错全仓扫描"
status: archived
affected: false
---
# CLI 质量摸排 Checklist

## 概览

本文档记录 YSM 项目 Go CLI 层（`go/cli/` + `internal/app/` + `frontend/src/services/`）代码审核的**高频问题模式**与**修复 Checklist**。2026-08-19 多轮审核发现 27 个问题（4 阻塞级 / 9 高危 / 11 中危 / 3 低危），规律六扩展审计又发现 **20 处 `json.Marshal` 吞错**（绑定层 13 + CLI 层 3 + go/packs 跨包 4），全部修复并沉淀为可复用的排查清单。

## 核心规律（6 条）

### 规律一：绑定层是故障放大器

**现象**：同一工具函数（如 `splitLines`）在 `go/cli/shared.go` 和 `internal/app/cli_bridge.go` 各有一份，修一个忘一个。

**根因**：Wails 绑定层（`internal/app/`）是 Go CLI 和前端 TS 的中间层，天然容易产生逻辑重复。

**对策**：
- 绑定层只做转发 + 协议转换，不承载业务逻辑
- 共享工具函数统一放 `go/cli/shared.go`，绑定层仅调用

### 规律二：白名单有漂移风险

**现象**：`ALLOWED_CLI_COMMANDS` 在三处维护（CLI 注册表 + 绑定层 + 前端），新增命令需同步三处。

**根因**：前端硬编码副本与后端注册表脱节。

**对策**：
- 前端改为动态拉取：`GetAllowedCLICommands()` 从后端获取
- 硬编码仅作降级 fallback（网页版不支持 Wails 时使用）
- 配合缓存避免重复请求

### 规律三：goroutine + channel 防御性编程

**现象**：`outputBuffer.done` 未初始化 → `close()` panic；`restoreStdout` 未 defer → panic 后级联故障。

**根因**：资源回收场景缺少双重保障。

**对策**（必须同时具备）：
1. `defer` 兜底（确保异常路径也能恢复）
2. `sync.Once` 幂等（防止重复调用导致死锁）
3. 显式调用 `restoreFunc()`（确保数据先写入再关闭）

**代码模式**：
```
defer restoreFunc()   // 兜底
restoreFunc()         // 显式调用
```

### 规律四：百分比计算的三个陷阱

审计发现 5 处百分比 bug，通用检查清单：

| 陷阱 | 示例 | 检查方法 |
|------|------|----------|
| 除零 | `cacheSize/0` panic | 分母前加 `if denom > 0` |
| 上限 | 命中率 120% | 计算后加 `if rate > 100 { rate = 100 }` |
| 基数 | 用总文件数算缓存命中率 | 语义对齐：缓存服务模型 → 基数用模型文件数 |

### 规律五：审计逻辑双轨问题

**现象**：`resource-scan` 和 `repo-audit` 各自实现一套分类逻辑，口径不一致（`.json` 算模型 vs 不算模型）。

**根因**：两个命令独立开发，未复用共享函数。

**对策**：
- 分类逻辑统一走 `classifyResource(ext, stats)`
- 统计结构统一用 `resourceStats` 结构体
- 一个分类函数，多处调用

### 规律六：序列化错误不能丢

**现象**：`makeJsonResponse` 用 `_` 忽略 `json.Marshal` 错误 → 前端收到 `"null"` 无法定位。

**根因**：Go 的 `_, err :=` 模式容易忽视错误处理。

**对策**：
- 序列化函数一律返回 `(T, error)`
- 调用方必须检查 error，错误时输出有意义的 fallback 响应
- 前端能看到明确的 `error.code` + `error.message`

**扩展审计（20 处吞错全景）**：本规律是全仓级反模式，不止 CLI 层：

| 层 | 数量 | 典型位置 | 修法 |
|----|------|----------|------|
| 绑定层（`internal/app/`） | 13 | `GetAllowedCLICommands` / `ReadPackMeta` / `marshalVoxelData` / `ReadSchematic` / `ReadNbtStructure` / `ReadLitematicMeta` / `FindDuplicateFiles` / `CountDuplicateFiles` / `SyncResourcesToInstance` / `BuildSyncItems` / `AnalyzeModelDetail` / `ResetWorkshopSites` / `ListPackModels` | 统一 `marshalJSON`/`marshalJSONIndent` helper（失败返回带 error 字段的合法 JSON） |
| CLI 层（`go/cli/`） | 3 | `runSearch` / `printYSMAnalysis` / `runList` | 复用 `ToJson()` fallback 模式，失败输出有意义错误 |
| 跨包（`go/packs/`） | 4 | `mcmeta.go` `ReadShaderpackLang`（os.Stat / zip.OpenReader / langData 空 / 正常返回） | 抽 `marshalShaderpackResult` helper（失败返回 `{"error":...}` 合法 JSON） |

**附带发现**：`printYSMAnalysis` 的 `json.MarshalIndent(meta, "  ", "  ")` 缩进参数写错——prefix 应为 `""` 而非 `"  "`（每行前多两个空格）。

**检查锚**：`grep -rn "data, _ := json.Marshal\|result, _ := json.Marshal" go/ internal/` 应为零结果。

### 规律七：同类反模式跨包残留（修复要全仓扫）

**现象**：规律六修复聚焦 CLI 层（`go/cli/` + `internal/app/`），但 `go/packs/mcmeta.go` 还有 4 处同类 `data, _ := json.Marshal`——修一层漏一层。

**根因**：反模式往往跨包分布，按"本次改动范围"排查会漏掉同构代码。

**对策**：
- 修复反模式时用 `grep -rn "<模式>" go/ internal/` **全仓扫描**同类，不限定当前改动文件
- 每修一类，顺手清掉所有同构调用点（本次：20 处吞错一次清完）
- 沉淀到 audit-framework 反模式表（锚点可 grep 的模式）

## 复审裁决记录

### 2026-08-25 外部审计三条

| 审计建议 | 裁决 | 理由 |
|---------|------|------|
| cli 包 8659 行最大包过重，拆 core/cache/perf/resource 子包 | **不采纳** | 已按职责拆 28 个文件（cache.go/perf.go/resource.go…），符合 go/AGENTS.md「不按行数机械切包」；再拆会切断 shared.go helper 共享与 DispatchCommand 注册表引用，断链风险 > 收益。「行数大」≠「包过重」 |
| shared.go:142 自定义 min/max 与内置并存 | **已修** | go.mod 为 go 1.25.0，内置 min/max（1.21+）全覆盖；删除自定义定义，mmd.go / model.go / cli_test.go 共 11 处调用自动落内置，零行为变化 |
| captureStdout 篡改全局 os.Stdout | **保留** | `--json` 模式核心机制：捕获命令全部输出包装 JSON 响应给前端/gate（cli.go RunCLI）。CLI 入口单线程分发场景安全，已有双重防护（defer restoreStdout panic 兜底 + 显式 restore 防 String() 死锁，见规律三）。长治久安方向 = 命令输出流参数化（注入 io.Writer），但需改所有命令签名，收益不成比例，记待办不动 |

## 快速排查 Checklist

### 阻塞级（必查）

| # | 检查项 | 文件 | 检查方法 |
|---|--------|------|----------|
| R1 | channel 初始化 | `shared.go` | 所有 channel 创建后必须赋值，`close()` 前确认非 nil |
| R2 | stdout 恢复 | `cli.go` | `restoreStdout()` 必须 `defer` + 显式调用 + `sync.Once` 幂等 |
| R3 | 除零保护 | `cache.go` | 所有除法前检查 `denom > 0` |
| R4 | 文件校验 | `resource.go` | 完整性检查必须验证 JSON 结构，不能只判扩展名 |

### 高危（建议查）

| # | 检查项 | 文件 | 检查方法 |
|---|--------|------|----------|
| O1 | 参数校验 | `concurrent.go` | `workers >= 1` 且 `workers <= 256` |
| O3 | Walk 错误 | `cache.go`, `mmd.go`, `resource.go` | `filepath.Walk` 回调的 `err != nil` 不能静默返回 nil |
| O5 | 重复注册 | `registry.go` | `RegisterCommand` 重复时输出 WARN 而非 panic |

### 中危（可选查）

| # | 检查项 | 文件 | 检查方法 |
|---|--------|------|----------|
| Y1 | error shadowing | `resource.go` | `if x, err := foo(); err != nil` 独立变量名 `jsonErr` |
| Y2 | 审计数据 | `resource.go` | `HitRate/Hits/Misses` 必须填充，不能全零 |
| Y3 | 扣分上限 | `resource.go` | `calculateAuditScore` 加 `scoreFloor` 下限 |

## 修复示例

### 示例 1：channel 初始化

```go
// ❌ 错误
buf := &outputBuffer{}
go func() { buf.readFrom(r) }()

// ✅ 正确
buf := &outputBuffer{done: make(chan struct{})}
go func() { buf.readFrom(r) }()
```

### 示例 2：双重保障

```go
// ❌ 错误
outputBuf, restoreStdout := captureStdout()
err := DispatchCommand(...)
restoreStdout()  // panic 时不会执行

// ✅ 正确
outputBuf, restoreStdout := captureStdout()
defer restoreStdout()  // 兜底
err := DispatchCommand(...)
restoreStdout()         // 显式调用（确保数据先写入）
```

### 示例 3：百分比计算

```go
// ❌ 错误
hitRate := float64(cacheSize) / float64(totalSize) * 100

// ✅ 正确
hitRate := 0.0
if totalSize > 0 {
    hitRate = float64(cacheSize) / float64(totalSize) * 100
    if hitRate > 100 { hitRate = 100 }
}
```

## 与其他子系统关系

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────────┐
│   frontend/src/  │────▶│ internal/app/    │────▶│     go/cli/         │
│  services/      │     │ cli_bridge.go    │     │  (shared, registry) │
│  cli-bridge.ts  │     │                  │     │                     │
└─────────────────┘     └──────────────────┘     └─────────────────────┘
       ▲                        ▲                        ▲
       │                        │                        │
  动态拉取               协议转换 + 转发              业务逻辑 + 注册表
```

**数据流**：
1. 前端 `executeCLI()` → 调用 `GetAllowedCLICommands()` 获取动态白名单
2. 绑定层 `ExecuteCLI()` → 构建参数 → `os/exec` 调用自身二进制
3. CLI 层 `RunCLI()` → 解析参数 → 调用注册表中的命令实现

## 相关

- [wails-bridge](wails-bridge.md) — Wails 桥接层知识卡
- [wails-bindings](wails-bindings.md) — 绑定生成规范
- [go-executil](go-executil.md) — Go 执行工具库
- AGENTS.md（CLI 模式使用说明）
