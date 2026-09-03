# ADR-173：GUI→CLI 参数桥 ParamSpec 白名单协议：区分未传与显式空值，消除 map 无序与参数损耗

- **状态**：已采纳（Accepted）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-03
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：ADR-049（GUI→CLI 桥打通）、ADR-145（AppService 接口下沉）、Go 代码评审 #4

---

## 1. 背景（Context）

GUI→CLI 参数链路共四次格式转换：

```
frontend cli-bridge.executeCLI → buildArgsMap (Record<string,string|number|boolean>，滤 undefined/null)
→ Wails map[string]interface{}（JSON 过桥，数值恒 float64）
→ internal/app ExecuteCLI 转 []string → os/exec 子进程 <exe> --cli --files-root <root> <命令> --json
→ go/cli 剥离全局参数 → 各命令内部 flag.FlagSet 解析
```

此链路存在三重已确认的语义损耗（`internal/app/cli_bridge.go` 函数头注释自认账，Go 评审 #4 实证）：

1. **空串丢弃**——无法传显式空值（空串与「未传」同义，flag 层也无法区分）；
2. **数值 0 丢弃**——同理；
3. **bool false 丢弃**——仅 true 会产出 `--flag`。

另有结构性问题：Go map 遍历无序 → **参数顺序不确定**，仅 flag 语义命令安全，位置参数命令不可走此桥。

参数知识目前散落三处注释承载（cli_bridge.go 函数头、前端 cli-bridge.ts 类型注释、各命令内部 flag 定义），新增命令参数须人工「同步核对」，漏核对即静默丢参——注释即契约，违反单一事实源原则。

## 2. 决策（Decision）

采用**路线 A：协议层 ParamSpec 白名单**，在命令注册表声明参数规格，桥接层按规格序列化。命令实现（flag.FlagSet 解析）保持不变。

**A1. 规格单一事实源下沉 go/cli 注册表**：扩展 `CliCommand`（或并行注册表）携带 `ParamSpec`——每条命令声明参数的：

- flag 形态：键名、类型（string/number/bool）、是否允许显式空值（`AllowEmpty`）；
- 位置参数序（如有）：声明序数键 → 参数名映射，未来位置参数命令走桥的前提。

**A2. 桥接层（internal/app ExecuteCLI）按规格序列化**：

- **显式空值**：仅当对应 `AllowEmpty=true` 时以占位编码产出（如 `--key=` / `--key 0` / `--key false`），否则维持现状语义（与 flag 默认一致）；未登记规格的命令按现状降级，保持兼容；
- **有序输出**：按 ParamSpec 声明顺序产出参数（纯 flag 命令无顺序依赖但输出稳定），消除 map 无序；
- **未知参数键**：规格外键显式拒绝或告警，拼写错误不再静默丢参。

**A3. 前端能力自描述**：`GetAllowedCLICommands` 扩展为返回「名称 + ParamSpec」，前端 cli-bridge 以此做唯一入口校验与参数组装（web 降级列表同源生成），删除跨层注释契约。

> **范围调整（2026-09-03，A4 第一波落地后评估）**：A3 收敛为**仅注释契约消除，不做运行时规格透传**。
> 依据：A2 已在 Go 侧兜底全部运行时收益（规格外键告警、显式空值、声明序输出），前端不消费规格亦然；
> `getAllowedCLICommands()` 零生产消费；ADR 自身 Consequences 已声明「TS 层拿不到编译期规格（可接受）」；
> 透传需连锁适配 web-cli.ts/cli-bridge.test.ts/mock-data/browser-adapter 约 5 文件，纯契约成本零运行时增益。
> `GetAllowedCLICommands` 维持纯名列表返回（桌面动态 / web 静态均不破坏）；跨层注释契约的消除
> 已在 cli-bridge.ts 完成（参数链路注释指向 go/cli 注册表单一事实源）。

**A4. 渐进接线**：先登记现有前端白名单命令的规格并核对行为等价，再逐步放开 `AllowEmpty` 与位置参数命令。

理由：参数知识收敛到注册表单一事实源；改动集中在桥接序列化层，不动各命令实现，可渐进落地、随时回退；与既有多数纯 flag 命令行为兼容。

## 3. 后果（Consequences）

**正面**

- 「未传 vs 显式空值」语义可表达，0 / false / 空串按需可传；
- 参数顺序确定，位置参数命令未来可安全走桥；
- 前端从后端获得命令能力自描述，web/桌面双实现同源，拼写错误被显式拦截。

**负面**

- 每个暴露命令需登记 ParamSpec（一次性注册表工作量）；
- 桥接层多一次内存规格查询（可忽略）；
- 前端 `CLIArgs` 类型保持宽松 Record，运行时校验在 Go 侧——TS 层拿不到编译期规格（可接受，后续可选生成类型）。

**已知遗留（不在本 ADR 范围）**

- 子进程 fork 开销与进程内直调 `RunCLI` 是独立决策，另行立项（评审 #3 已加超时兜底，短期无碍）；
- `AllowEmpty` 的占位编码需与 go/cli flag 解析侧确认各命令可接受形态，接线时逐命令核对。

## 4. 数据溯源

- 损耗语义自述：`internal/app/cli_bridge.go:43-50`（函数头注释）、`:84-113`（实际转换代码）
- 前端链路：`frontend/src/services/cli-bridge.ts:99-101`（参数链路注释）、`:195-203`（buildArgsMap 滤 undefined/null）
- 注册结构：`go/cli/registry.go`（CliCommand：Name/Category/Description/Run，无规格字段）
- 白名单注入：`main.go:35`（SetAllowedCommands ← cli.GetAllowedCommands()，仅命令名列表）
- 前端消费：`frontend/src/services/cli-bridge.ts` + `frontend/src/backend/cli-allowlist.ts`（硬编码降级）
