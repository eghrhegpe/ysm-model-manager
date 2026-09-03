---
kind: adr173_gui_cli_paramspec
name: GUI→CLI 参数桥 ParamSpec 协议(ADR-173) 实施状态
tier: architecture
category: go
source_files:
  - go/cli/registry.go
  - go/cli/json.go
  - internal/app/cli_bridge.go
  - main.go
auto_fields:
  symbols_with_lines:
    - App.ExecuteCLI
    - App.GetAllowedCLICommands
    - App.SetAllowedCommands
    - App.SetAllowedCommandSpecs
    - CatCache
    - CatConfig
    - CatModel
    - CatOther
    - CatPerf
    - CatResource
    - CliCommand
    - CmdContext
    - CommandSpec
    - CommandSpecDTO
    - DispatchCommand
    - GetAllCommands
    - GetAllowedCommands
    - GetAllowedCommandSpecs
    - GetCommand
    - IsCommandAllowed
    - JsonError
    - JsonResponse
    - JsonResponse.ToJson
    - MetaInfo
    - NewJsonError
    - NewJsonNotSupported
    - NewJsonSuccess
    - ParamBool
    - ParamNumber
    - ParamSpec
    - ParamSpecDTO
    - ParamString
    - ParamType
    - RegisterCommand
    - RegisterCommandC
    - TimingInfo
use_when:
  - 修改 GUI 桥可调用 CLI 命令的参数时（新增 flag / 需要传空值语义）
  - 排查 ExecuteCLI 参数丢失（空串/0/false 不见、顺序不定、拼写错误静默丢参）
  - 理解 internal/app 与 go/cli 之间参数规格如何跨包传递
pitfalls:
  - internal/app 不得 import go/cli（ADR-145 架构：两侧互不依赖，main 装配）——规格经 main.go cliSpecsToDTO 字段级转换注入，go/cli 侧字段改名/删除会在此编译失败（有意为之的漂移防线）
  - 新增命令参数若不登记 ParamSpec，桥接层走 legacy 降级（空串/0/false 丢弃）——与 ADR-173 前行为等价，但拿不到声明序输出与显式空值能力；无 flag 命令（cache-status/perf-log）无需登记
  - scripts/_lib/cli-registry.ts 的 CMD_RE 只解析到 runFn 不强制收尾 `)`——RegisterCommandC 尾随变参 ParamSpec 拆行注册合法（2026-09-03 教训：曾要求完整 `)` 闭合致 5 命令从注册表解析消失、completions/文档 parity 双双拉红）
quick_groups:
  - CLI 桥
  - 参数序列化
quick_intents:
  - GUI 调 CLI 参数为何丢失
  - 如何给命令登记 ParamSpec
  - 参数规格存在哪（单一事实源）
quick_risk_lines:
  - RegisterCommandC(" 新增参数
invariant_anchors:
  - go/cli/registry.go|type ParamSpec struct
  - internal/app/cli_bridge.go|func buildCLIArgs
---

# GUI→CLI 参数桥 ParamSpec 协议(ADR-173) 实施状态

## 概览

GUI→CLI 参数链路（frontend buildArgsMap → Wails map → ExecuteCLI → os/exec 子进程 --cli）曾有四重损耗：
空串/0/false 丢弃（无法传显式空值）、Go map 遍历无序（位置参数命令不可走桥）、拼写错误静默丢参、
参数知识散落三处注释（无单一事实源）。ADR-173（路线 A）在命令注册表声明参数规格（ParamSpec），
桥接层按规格序列化。**实施进度见下，ADR 只记决策方向。**

## 实施进度（2026-09-03 A4 第一波 ✅）

| 决策 | 状态 | 落点 |
|------|------|------|
| A1 规格下沉 go/cli 注册表 | ✅ 落地 | `registry.go`：`ParamSpec{Key,Type,AllowEmpty}` + `CliCommand.Params` + `RegisterCommandC` 变参（既有调用零改动）；`json.go` `GetAllowedCommandSpecs()` 与 `GetAllowedCommands()` 同源派生防漂移 |
| A2 桥接按规格序列化 | ✅ 落地 | `internal/app/cli_bridge.go`：`buildCLIArgs`（纯函数可单测）——有规格按声明序输出 + AllowEmpty=true 时显式空值（`--key=` / `--key 0` / `--key=false`）；无规格走 legacy 降级；规格外键/类型不符 → 告警 + 尾部追加不丢参 |
| A1→A2 装配通道 | ✅ 落地 | `main.go` `cliSpecsToDTO` 字段级薄转换（internal/app 零依赖 go/cli）；`SetAllowedCommandSpecs` 独立 once 注入（旧装配/测试只注入名单 → 自动 legacy） |
| A4 第一波登记 | ✅ 落地 | 5 个有参数高频命令：search（8 参）/ analyze（model）/ list（limit,format）/ single-bench（6 参）/ gui-flow（model,verbose）；**全部 AllowEmpty=false**（与旧行为逐位等价，空值仍丢） |
| A3 前端能力自描述 | ✅ 收敛为注释消除 | 2026-09-03 评估后**不做运行时规格透传**（ADR-173 附注）：A2 已 Go 侧兜底全部运行时收益 + `getAllowedCLICommands()` 零生产消费 + 透传需 5 文件纯适配。`GetAllowedCLICommands` 维持纯名列表；cli-bridge.ts 参数链路注释已指向 go/cli 注册表单一事实源 |

## 核心职责

- **规格单一事实源**：命令参数知识从三处注释收敛到 `go/cli` 注册表声明（与命令同处注册，新增参数改一处）
- **桥接双路径序列化**：登记命令 = 声明序 + 显式空值可选；未登记 = legacy（零回归）
- **DTO 装配通道**：规格经 main.go 转换注入 app，绕过 import 依赖（ADR-145）

## 对外 API / 入口

- Go：`RegisterCommandC(name, cat, desc, run, params ...ParamSpec)`（登记）、`GetAllowedCommandSpecs() []CommandSpec`（导出）
- app 注入：`SetAllowedCommandSpecs([]CommandSpecDTO)`（main 装配调用；Wails 绑定自动生成，前端不消费）
- 测试入口：`buildCLIArgs(command, base, args, specs) ([]string, []string warnings)`（internal/app 纯函数）
- 守卫：`go/cli/paramspec_test.go`（登记完整性/序）、`internal/app/cli_bridge_test.go`（序列化等价/AllowEmpty/未知键）

## 与其他子系统关系

- `go/cli`（规格声明）→ main.go（DTO 转换）→ `internal/app`（序列化）→ 子进程 `--cli` 各命令 flag 解析——四段链路，规格只在第一段声明、桥接只消费注入副本
- `scripts/_lib/cli-registry.ts`（docs/completions 生成器）解析 RegisterCommandC 前四组参数，变参尾随不破坏解析
- 前端 `cli-bridge.ts` / `cli-allowlist.ts`（web 静态白名单）暂未感知规格（A3 波次）

## 不变量

- 登记命令在 AllowEmpty=false 时序列化行为与 ADR-173 前**逐位等价**（空值丢弃、bool 仅 true 出开关、整数无小数点）
- 规格外键永不静默丢参：告警 + legacy 追加（渐进期）；未来收紧为显式拒绝是 A4 后续决策，不是现状
- filesRoot 是全局参数，不进入任何命令规格（调用方先行处理）

## 相关

- [ADR-173](../adr/ADR-173-gui-cli-paramspec-map.md)：决策方向（本文档是其实施进度）
- Go 代码评审 #4（参数桥三重语义丢失，本文档立项源头）
- `go/cli/registry.go`（CliCommand/ParamSpec/RegisterCommandC 变参）
- `internal/app/cli_bridge.go`（buildCLIArgs / SetAllowedCommandSpecs）
