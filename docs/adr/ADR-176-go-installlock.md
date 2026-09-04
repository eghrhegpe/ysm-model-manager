# ADR-176：Go 端维持进程单例与 InstallLock,收敛测试注入,修文档/门禁漂移与吞错

- **状态**：已采纳（Accepted）

- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）

- **日期**：2026-09-04

- **决策人**：Jieling（人类首席架构师）、AI 代理

- **相关**：`go/scanner/scanner.go`、`go/installer/installer.go`、`go/sync/sync.go`、`go/sync/conflict.go`、`internal/app/app_install_instance.go`、`go/AGENTS.md`、`docs/architecture.md` 铺设

***

## 1. 背景（Context）

外部锐评对本仓 Go 端发起一轮审计，核心定性大多成立，但**头部量化数字被注水**：宣称「1520 个 TODO / FIXME、每 21 行非测试代码一个标记」，实际全仓 `*.go` 扫描（排除 upstream / node\_modules / rust）= 2 条；引用的「49afd979 曾删除本注入点」类 commit-hash 旁白在 scanner.go 抽样中找不到。

在逐条查证后，对锐评开出的两味「P0 药方」——① `scanner.go` 包级全局状态收进结构体；② `InstallLock` 收进 `*Installer` 结构体——给出不同判断：

- **`scanner`** **的** **`scanCache / cacheGen / keyVersions / inFlight`** 是典型的**进程级单例缓存与去重基建**：桌面工具整个进程本就该只有一份扫描缓存与在途合并表。struct 化只是把「包级 `var`」换成「包级 `*Scanner` + 把句柄穿进全部调用处（ScanEntries / ScanLite / ScanLocalAuthors / GenerateRepoIndex 及其测试）」，单例语义不变量，只是多一层样板。锐评的「服务定位器反模式」对**桌面单例工具**高估。

- **`InstallLock`**（`go/installer/installer.go:21`）是一把**横跨 installer / sync / conflict / app 四处的进程级串行互斥**，本质是「安装操作 vs 后台同步」的并发契约，被 go/sync/sync.go、go/sync/conflict.go、internal/app/app\_install\_instance.go 复用。它已经历「两把私有锁统一成一把全局锁」（锐评 #15 后的整改），**这个方向是对且已落地的**。收进 `*Installer` 后，sync/conflict 仍须触达同一把锁、仍要拿单例实例——全局没消失，只是从 `var` 挪进字段，收益存疑。

真正值得当「账」收的，是锐评里被埋没、但零/低成本且立刻值钱的点：**测试注入穿生产路径**、**文档与构建门禁漂移**、**吞错**。

## 2. 决策（Decision）

### 2.1 维持进程级单例（不重构为结构体持有）

不采纳「`scanner.go` 全局状态收进结构体」「`InstallLock` 收进 `*Installer`」两条改造。理由见背景：此为进程固有唯一态与跨包串行契约，恢复性能与风险不成比例。

将来若出现**多实例诉求**（同一进程内多个相互隔离的扫描作用域），再重开本 ADR 评估拆单例——但不应仅因「全局变量不优雅」而拆。

### 2.2 收敛测试注入：生产路径零钩子

把当前以包级函数指针实现、仅测试用的注入点（`scanner.SetWalkStartHook / SetRustScanHook`，及查证同类的 `dedup.computeHash`、`fileops.renameForMove`、`updater` 尺寸/代理常量等）收敛为**显式依赖**：

- 可参数化的（如哈希函数、重命名实现）改为结构体字段/参数传入；

- 确属「仅测试制造确定性分支」的钩子（如 Rust 扫描 handled 分支、在途重叠）迁移到 `internal/testutil` 的测试专用 seam，**生产路径零包级可变函数指针**。

### 2.3 修文档与构建门禁漂移

- `go/AGENTS.md` 包结构表把 `internal/app` 归入 `go/` 子树，但 `go/internal/app` **不存在**，真实绑定点在**仓库根** **`internal/app`**——修正文档归属描述。

- 根 `go.mod` 在仓库根，`go build ./go/...` **不编译根** **`internal/app`** **与根** **`cli.go`**，等于门禁漏了主体——构建/验证流程补上这两者。

### 2.4 收敛吞错：非清理路径的错误不留痕

- 把非「清理/临时」路径上的 `_, _ =` / `_ =`（至少 `json.Marshal` 类）改为 **log + return**，避免序列化失败前端拿坏数据却无任何痕迹。

- 修死代码 `go/cli/tags.go:211 var _ = json.Marshal`（json 已被正常使用）。

- 保留但加注：基准/耗时模拟里**故意吞错**（如 `concurrent.go:837` 模拟序列化开销）不属于吞错，是基准隔离手段，补注释说明以绝误认。

## 3. 后果（Consequences）

**正面**

- 生产路径不再挂可写函数指针，消除「运行时全局行为被替换」的隐忧与额外竞争面。

- 文档与构建门禁对齐现实，`go build ./go/...` 能覆盖到真正打包的 app 入口。

- 非清理路径的错误不再静默丢失，同步/序列化失败可被日志面板追溯。

**负面**

- 维持单例意味着 `scanner` / `installer` 的包级状态继续存在——接受其为进程固有态的代价（锁与纪律仍在），但不再为其承受「struct 化」的样板与跨调用破裂风险。

- 测试注入收敛需改若干调用处与测试文件，属一次性成本。

**已知遗留**

- `InstallLock` 跨三包复用的串行契约维持不变；若未来引入真正的多 Installer 实例，需另议。

- 全仓吞错点的清点与修复按 C1（`json.Marshal` / 写文件类）→ C2（清理路径保留）分级推进，不以数字论英雄。

## 4. 数据溯源

| 来源                                                                  | 结果                                                                  |
| ------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `rg 'TODO\|FIXME' --glob '*.go'`（整仓，排除 upstream/node\_modules/rust） | **2 条** → 锐评「1520 个」为注水                                             |
| `Test-Path go/internal/app`                                         | **False** → 绑定点确实在仓库根 `internal/app`                                |
| `Test-Path go/AGENTS.md`                                            | True → 其包表把 `internal/app` 归入 `go/`，与现实漂移                           |
| `rg 'InstallLock'`                                                  | 定义于 `installer.go:21`，被 sync/conflict/app 复用，跨包串行契约成立               |
| `go/scanner/scanner.go` 全文                                          | `scanCache/cacheGen/keyVersions/inFlight/hookMu…` 为进程级单例缓存 + 单测钩子组合 |
| `go/cli/tags.go:211`、`go/cli/mmd.go:342`、`go/cli/concurrent.go:837` | tags.go 死代码属实；concurrent.go 为基准故意吞错（非生产丢失）                          |

