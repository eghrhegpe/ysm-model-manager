# ADR-200：CLI 输出契约结构化：命令返回结果对象，--json 载荷去文本化

- **状态**：✅ 已采纳（Accepted）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-06
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`go/cli/cli.go`、`go/cli/json.go`、`go/cli/flow.go`、`frontend/src/views/app-content/diagnostics/perf-cli.ts`、ADR-173、ADR-199

---

## 1. 背景（Context）

CLI 当前有三类消费方：**人类终端**、**GUI 桥**（`--json` 恒开，进程内直调）、**CI/gate**（`gui-flow-gate.mjs`）。三者的输出契约却只有一套——人类可读文本：

```
命令 runXxx：fmt.Println(emoji + 中文表格)
  → captureStdout 劫持全局 os.Stdout
  → JsonResponse.Data = {output: 整段文本, lines: 行数组}
  → 前端正则反解析
```

实测证据（2026-09-06）：

| 证据 | 位置 |
|------|------|
| 前端从 `resp.data.output` 反解析结构化数据 | `perf-cli.ts:352` `singleBenchParseStages`、`:473` `guiFlowParseEntries`、`:560` `perfLogParseEntries` |
| 反解析脆弱性已被代码注释自认 | `flow.go:30-32`（「改个 emoji 就断」）、`flow.go:201-203`（gate 因新格式不含旧 token 而 fail-open 静默跳过） |
| 结构化数据已存在却被浪费 | `flow.go:25-33` `guiFlowResult{Stage, Duration, Success, FirstModel}` 结构化完整，仅喂给 `fmt.Printf` |
| 覆盖与规模 | 39 个顶层命令 / 9591 行；`go test ./go/cli -cover` 全绿但仅 **56.9%** |

**触发点**：ADR-199 把 GUI→CLI 从 `os/exec` 自 fork 改为进程内直调后，CLI 事实上成了 GUI 的 IPC 后端。此前「人眼输出 + 文本反解析」只是偶发脚本成本，现在变成常驻契约——改一个 emoji 会让 GUI 诊断面板静默降级，且不报错、不可观测。

---

## 2. 决策（Decision）

### D1 渲染与数据分离（核心）

命令契约由「打印文本」演进为「产出结果 + 各自渲染」：

- `CmdContext` 增加 `SetResult(any)`：命令把结构化结果挂上上下文；
- `--json` 模式下 `JsonResponse.Data` **优先承载结果对象**；未调用 `SetResult` 的命令回退到现有 `output/lines` 文本载荷（兼容存量）；
- 人类渲染器保留在命令内部（`fmt.Println` 照旧），无 `--json` 时行为**零变化**。

理由：结构化与人类可读不是二选一，而是同一结果的两种视图。渲染留在命令侧，避免引入中央 renderer 抽象层（39 命令的迁移成本）。

### D2 渐进迁移，先收敛真消费方

首批只做前端真在解析的命令：`gui-flow` / `single-bench` / `perf-log` / `perf-snapshot` / `health-report` / `cache-status`。其余命令维持文本载荷，按需求驱动逐个迁移——不做一次性 39 命令大爆炸。

理由：一次性改全量会与并行会话大面积冲突（同目录文件争抢），且多数命令当前无机器消费方，迁移零收益。

### D3 禁止新增文本反解析

结构化结果类型定义在命令同包（`go/cli`），前端一律消费 `Data` 对象字段。已有 3 处 parser 随对应命令迁移完成即删除；**新增前端解析人类文案的行为视为回归**。

### D4 结构化不得穿透 AppService

`AppService`（ADR-145 消费方接口）继续返回 DTO，结构化组装发生在 `go/cli` 层。禁止为结构化输出而给 `internal/app` 加方法。

理由：沿用 ADR-145 依赖倒置——`go/cli` 是消费方，输出形态是消费方的事。

### D5 结果对象只增不改

结果字段只允许追加；语义变更走「新增字段 + 旧字段保留一个版本」。`Data.output` 文本字段在迁移期内保留并标注 deprecated，不在迁移完成前移除。

### 已否决方案

| 方案 | 否决理由 |
|------|----------|
| A. 39 命令一次性结构化 | 改动面过大，与并行会话冲突；多数命令无机器消费方，收益为零 |
| B. 前端改直调 Go 绑定绕开 CLI | 推翻 ADR-199 刚落地的进程内直调链路，等于重开 fork 之争 |
| C. 维持现状 + 加测试锁死文案 | 锁死文案即锁死 CLI 输出演进；前端 parser 仍需同步改，成本未消失只是转移 |

---

## 3. 后果（Consequences）

**正面**

- 前端删掉 3 处正则解析器，GUI 诊断面板不再依赖 emoji / 换行 / 中文 token；
- `gui-flow` 的 `guiFlowResult`、`health-report` 的 `HealthReport` 等已有结构化数据直接过桥，消除「结构化 → 打印 → 反解析」的往返损耗；
- gate（`gui-flow-gate.mjs`）可从 fail-open 文本匹配升级为字段断言，消除静默降级；
- CLI 侧新增可测面：结果对象可单测断言，不必比对整段文本。

**负面 / 成本**

- 双轨期内 `Data` 存在两种形态（对象 / 文本），前端需兼容判断；
- 命令实现多一段 `SetResult` 调用，短命令体量略增；
- 首批 6 个命令需同步改前端，跨层改动（Go + TS）需主模型拍板。

**已知遗留（不在本 ADR 范围内，另立议题）**

- `ParamSpec`（ADR-173）登记覆盖率仅 5/39，且未消费于 help 生成与必填校验 —— 属**输入侧**契约，本 ADR 只解决**输出侧**；
- `captureStdout` 全局劫持无互斥、超时后 goroutine 仍持 pipe（ADR-199 副作用）—— 与结构化输出正交，同属进程内直调工程债；
- 桥接面 39 命令无读写分级（`dedup clean` / `cache-clear` 与只读命令同权）—— 属权限模型，另立 ADR。

---

## 4. 数据溯源

| 来源 | 结果 |
|------|------|
| `go test ./go/cli/ -cover -timeout 300s` | 全绿 0.42s，覆盖率 **56.9%** |
| `grep -c 'RegisterCommandC("' go/cli/*.go` | **39** 个顶层命令，9591 行 / 23 文件 |
| `grep -rn "Parse.*resp.data.output" frontend/src` | **3** 处前端反解析（`perf-cli.ts:352/473/560`） |
| `grep -n "fail-open\|FirstModel" go/cli/flow.go` | 结构化数据存在但仅用于打印；gate 静默降级前例 |
| `wc -l go/cli/*.go` | 单文件最大 `bench_concurrent.go` 1080 行、`mmd.go` 812 行 |

<!-- 文件名: cli-structured-output.md → 实际文件 ADR-200-cli-structured-output.md -->
