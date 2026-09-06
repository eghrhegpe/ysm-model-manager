# ADR-199：cli-bridge 进程内直调：移除 GUI 自 fork

- **状态**：已采纳（Accepted）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-06
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`internal/app/cli_bridge.go,go/cli/cli.go,main.go`

---

## 1. 背景（Context）

GUI 的 CLI 桥（`internal/app.ExecuteCLI`，Wails 绑定）原先每执行一条 CLI 命令，
都用 `os/exec` 把**自身 exe 再 fork 一份**（`cli_bridge.go` 旧 `executeCLICommand`）：
拿 `os.Executable()` → `exec.CommandContext(exe, "--cli", args...)` → 子进程冷启动走完整初始化
→ 进 CLI 模式执行 → stdout 吐 JSON → 父进程读 stdout 透传前端。

代价（四选其重）：
1. **冷启动税**：每条命令都完整跑一遍 Go 二进制启动，Windows 下尤重，命令一多即串行的一串进程创建。
2. **孤儿进程**：旧实现用 `context.Background()`（后已挂 `a.appCtx`，但子进程模型本身未变），
   应用退出后在途子进程脱离生命周期。
3. **错误语义打折**：跨进程只能传 stdout 字符串，错误协议全靠字符串约定。
4. **两份事实源**（**已被 ADR-173 消除**）：白名单 + 规格单一事实源现位于 `go/cli` 注册表，
   由 `main.go` 注入 `internal/app`，漂移编译期拦截——此条不构成根治障碍。

关键澄清：旧注释称 fork 是为「避免循环依赖」。实情是 ADR-145 已将 `go/cli` 侧依赖倒置——
`go/cli` 生产代码**不 import `internal/app`**（仅持 `AppService` 接口），`internal/app` 也一直未 import `go/cli`。
fork 是 ADR-145 只解了 `cli→app` 方向、把 `app→cli` 方向原样保留的遗留，**并非架构必需**。

## 2. 决策（Decision）

**移除 `os/exec` 自 fork，GUI 进程内直调 CLI 实现。** 但保持 ADR-145 既定约定
「`internal/app` 与 `go/cli` 互不 import，`main` 装配」——**不**让 `internal/app` 直接 import `go/cli`，
改用**依赖注入**：

- `go/cli` 新增 `RunCLIInProcess(a AppService, parent context.Context, args []string) (string, error)`：
  复用 `cliPrologue` / `DispatchCommand` / `captureStdout` / `json.go` 的 `JsonResponse` 协议，
  返回 `--json` 模式 JSON 字符串（成功/失败均为合法 JSON），内置 5min 超时 + 透传 `parent.Done` 兜底，
  **不打印到 GUI stdout**（避免污染 WebView 控制台）。
- `internal/app` 定义 `CLIInProcessRunner` 类型（`func(a *App, parent, args) (string, error)`）与
  `SetCLIInProcessRunner` 注入点；`ExecuteCLI` 第 3 步改调注入的执行器，移除 `executeCLICommand` /
  `getExitCode` / `cliCommandTimeout` 及 `os/exec`、`strings`、`errors` 无用 import。
- `main.go` 装配期注入：`appStruct.SetCLIInProcessRunner(func(a *app.App, parent, args) (string, error) {
  return cli.RunCLIInProcess(a, parent, args) })`，把 `*App` 当作 `cli.AppService` 透传。

**为何不直接 `internal/app` import `go/cli`**：会触发 `go/cli` 白盒测试（`package cli` 内部测试，
既调未导出命令函数 `runCacheStatus` 等、又需 `*app.App`）的编译期 import 循环——
`cli` 测试 → `internal/app`（现 import `go/cli`）→ `go/cli` = 循环。依赖注入让 `internal/app` 仍不 import
`go/cli`，循环消失，白盒测试原样保留。

## 3. 后果（Consequences）

**正面**
- 冷启动税、孤儿进程两项最重代价**归零**：无子进程创建、无 Context 脱离。
- 错误语义部分缓解：`app.appCtx` 直接管生命周期；`RunCLIInProcess` 恒返回合规 JSON，前端消费协议不变。
- 白名单 / 规格已是单一事实源（ADR-173），无需再合。

**负面 / 成本**
- `internal/app` 新增一个注入字段与装配点（`main.go` 一行），属必要薄胶水。
- 未注入执行器时 `ExecuteCLI` 显式报错（`cli_runner_unset`），**绝不退化到 os/exec**（ADR-199 红线）。

**已知遗留（第二阶段，非本次范围）**
- `RunCLIInProcess` 仍经 `captureStdout` 捕获文本再包 JSON（与 `RunCLI` 的 `--json` 分支同构）。
  真正根治是给命令引入结构化返回（`Run` 返回 `data interface{}` + `error`），桥直接拿 Go 值转响应，
  消除「JSON 字符串猜」。涉及 39+ 命令签名改造，增量实施，需另立 ADR。

## 4. 数据溯源

- 来源：`internal/app/cli_bridge.go` 旧 `executeCLICommand`（os/exec 自 fork）、`go/cli/cli.go` `RunCLI`
  的 `--json` 分支、`main.go` 装配段、`docs/adr/ADR-145-*`（依赖倒置）、`ADR-173`（规格单一事实源）。
- 结果：新增 `go/cli.RunCLIInProcess` + `internal/app.CLIInProcessRunner`/注入点 +
  `main.go` 装配；删除 fork 路径；`go/cli` 白盒测试零改动（依赖注入保持 `package cli` 不循环）。

<!-- 文件名: cli-bridge-gui-fork.md → 实际文件 ADR-199-cli-bridge-gui-fork.md -->
