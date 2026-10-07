---
kind: go-cli-layout
name: go/cli 目录结构（43 文件分组与命名）
tier: leaf
category: go
status: active
source_files:
  - go/cli/cli.go
  - go/cli/appservice.go
  - go/cli/registry.go
  - go/cli/shared.go
  - go/cli/bench_single.go
  - go/cli/bench_concurrent.go
  - go/cli/bench_baseline.go
  - go/cli/bench_matrix.go
  - go/cli/perf.go
  - go/cli/perf_snapshot.go
  - go/cli/perf_identity.go
  - go/cli/flow.go
  - go/cli/flow_phases.go
  - go/cli/flow_report.go
auto_fields:
  symbols_with_lines:
    - AppService
    - AttachSidecar
    - CatCache
    - CatConfig
    - CatModel
    - CatOther
    - CatPerf
    - CatResource
    - CliCommand
    - CmdContext
    - CmdContext.SetResult
    - DispatchCommand
    - Error
    - ErrParam
    - ErrParam.Error
    - ErrParam.Unwrap
    - ErrRuntime
    - ErrRuntime.Error
    - ErrRuntime.Unwrap
    - ExecuteCLIWithApp
    - ExitCodeOf
    - ExitParamErr
    - ExitRuntimeErr
    - ExitSuccess
    - GetAllCommands
    - GetCommand
    - ParamBool
    - ParamNumber
    - ParamSpec
    - ParamString
    - ParamType
    - ParseCommandArgs
    - PrintError
    - RegisterCommand
    - RegisterCommandC
    - RunCLI
    - RunCLIInProcess
    - SidecarOutput
    - String
    - Unwrap
use_when:
  - go/cli 目录太大不知从哪下手
  - 新增 CLI 命令该放哪个文件
  - bench_ / perf_ / flow_ 前缀文件是什么
  - go/cli 文件行数治理拆分
quick_groups:
  - 门禁与脚本
quick_intents:
  - go/cli 目录结构、43 个文件怎么分组
  - 新增 CLI 命令放哪个文件、命令注册在哪
  - bench_ / perf_ / flow_ 前缀文件是什么
  - go/cli 与 internal/app 的依赖方向
quick_risk_lines:
  - go/cli 禁止反向 import internal/app（ADR-145 依赖倒置），App 能力一律经 appservice.go 的 AppService 接口；`main.go` 有 `var _ cli.AppService = appStruct` 编译期断言兜底
  - 新增命令必须经 RegisterCommandC 登记 ParamSpec，未登记走 legacy 降级（空串/0/false 会被丢弃）
pitfalls:
  - bench_* 文件是基准测试 harness，不是生产并发代码——生产并发在 go/conc（ADR-197），误改 bench_* 当并发实现会南辕北辙
  - 与生产 AppService 同包仅因共用 CLI 基建（RegisterCommandC / newCmdFlagSet / newParamErrf），依赖纠缠尚未拆包
invariant_anchors:
  - go/cli/appservice.go|AppService
  - go/cli/registry.go|RegisterCommandC
  - go/cli/cli.go|RunCLI
---

# go/cli 目录结构（43 文件分组与命名）

## 概览

`go/cli/` 是全仓**最大的 Go 包**（43 个非测试文件，第二名 `go/litematic` 仅 13），承载 CLI 模式（`--cli` 分支）的全部命令实现。CLI 入口在根 `main.go`，本包负责命令注册、参数解析与执行。

文件数膨胀的主因是**行数治理拆分**：`bench_single.go` / `perf.go` / `flow.go` 三个巨型文件在 2026-10 按职责各拆为 3~7 个兄弟文件。文件名前缀即分组标签。

## 核心职责

按前缀分组（新增命令按此归位）：

| 前缀 / 文件 | 职责 | 备注 |
|---|---|---|
| `cli.go` | 命令注册与调度框架（`RunCLI` / `ExecuteCLIWithApp` / `RunCLIInProcess` / `SidecarOutput`） | 框架核心 |
| `appservice.go` | **`AppService` 消费方接口（ADR-145 依赖倒置）** | `go/cli` 不 import `internal/app`；`main.go` 编译期断言 |
| `registry.go` | 命令注册表（`RegisterCommandC`） | 单一事实来源，GUI 命令列表由此派生 |
| `shared.go` | 跨命令共享基建（`newCmdFlagSet` / `newParamErrf` 等） | — |
| `cat*` / 命令域文件 | 各业务命令实现：`model.go`（search）、`avatar.go`、`cache.go`、`creator.go`、`dedup.go`、`download.go`、`fileops.go`、`health.go`、`install.go`、`instance.go`、`recycle.go`、`resource.go`、`scan.go`、`tags.go`、`workshop.go` 等 | 按领域一文件 |
| `config.go` / `config_cmd.go` | 配置命令与配置读写 | — |
| `bench_*`（7 文件） | **基准测试 harness**：`bench_single.go`（单模型基准）、`bench_concurrent.go`（`concurrent-bench`）、`bench_baseline.go`（baseline 判定/呈现，ADR-262 D8）、`bench_matrix.go`（目标集矩阵载荷）、`bench_model_validate.go`（数据校验与体积估算）、`bench_stage_utils.go`（阶段汇总）、`bench_single_print.go` / `bench_single_hint.go`（text 呈现 / 优化提示） | ⚠️ **非生产并发代码**，生产并发在 `go/conc` |
| `perf_*`（4 文件） | 性能诊断：`perf.go`（`perf-log` 优化记录）、`perf_snapshot.go`（`perf-snapshot` 一站式快照）、`perf_identity.go`（报告身份块，ADR-262 D2）、`perf_targets.go` + `perf_target_set.go`（目标集解析与三旋钮 selector×order×limit，ADR-262 D3） | — |
| `flow_*`（3 文件） | `gui-flow` 命令：`flow.go`（类型 + `runGUIFlow` 主流程）、`flow_phases.go`（各 `runPhase*` 实现）、`flow_report.go`（数据准备 + 渲染估算 + 报告） | 原 781 行单文件拆分 |
| `scan_bench.go` | 扫描基准（Go walk 单引擎耗时测量） | — |
| `json.go` | JSON 输出封装（信封 `NewJsonSuccess` / `NewJsonError`）+ 命令清单导出（`GetAllowedCommands` / `GetAllowedCommandSpecs`） | — |

## 对外 API / 入口

- `RunCLI(app AppService, args []string) error` — CLI 模式入口（根 `main.go` 调用）
- `RunCLIInProcess(app, parent, args) (string, error)` — 进程内执行（ADR-199，替代 GUI fork 子进程）
- `RegisterCommandC(name, cat, desc, fn)` / `RegisterCommandCParams(...)` — 命令注册（ParamSpec 登记）
- `AllowedCommands` / `GetAllowedCommandSpecs()` — 供 `main.go` 注入 GUI 桥

## 与其他子系统关系

- **↔ `internal/app`（依赖倒置，ADR-145）**：`go/cli` 持 `AppService` 接口，`*app.App` 隐式满足（46 个方法）。**禁止反向 import**。
- **↔ `main.go`（唯一装配点）**：`cliSpecsToDTO` 做 `CommandSpec → CommandSpecDTO` 字段级薄转换；`var _ cli.AppService = appStruct` 编译期锁签名。
- **↔ `docs/cli-commands.md`（生成物）**：`gen-cli-doc.ts` 由源码注册派生，`--check` 接 doctor 防漂移。**新增命令只改源码注册，不手改此文档**。
- **↔ `go/conc`**：`bench_*` 是测试 harness，生产并发工具在 `go/conc`。

## 不变量

- `go/cli` 不 import `internal/app`（ADR-145）；App 能力一律经 `AppService` 接口。
- 所有用户可见命令必须经 `RegisterCommandC` 登记，未登记即不出现在 GUI 命令列表。
- 同包（`package cli`）内共享 `RegisterCommandC` / `newCmdFlagSet` / `newParamErrf` 基建。

## 相关

- [CLI 搜索命令 search](./go-cli-search.md) — `search` 命令的完整解剖（本卡的前身，聚焦单命令）
- [GUI→CLI 参数桥 ParamSpec 协议(ADR-173)](./adr173-gui-cli-paramspec.md) — 参数规格跨包传递
- [通用泛型并发工具 go/conc](./go-conc.md) — 生产并发入口（与 `bench_*` 区分）
- [Go 团队复杂度扫描 ccheck](./go-ccheck.md) — 行数治理拆分的配套度量
- `docs/cli-commands.md` — CLI 命令完整参考（自动生成，单一事实源 = 源码注册）
