# ADR-179：internal/app 垂直切分子包（拆解扁平巨型包与 App god-object）

- **状态**：已采纳（Accepted）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-04
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：ADR-173（app→cli 环规避，allowedCommands 注入）、ADR-134（containerCache 全局抽离）、ADR-102（main.ts 拆分，前端侧同构先例）

---

## 1. 背景（Context）

2026-09-04 Go 端代码审查实测：

- `internal/app` 为**单一扁平巨型包**：70+ 个 `.go` 文件无子包划分，5 个文件 >500 行（`resource_bindings.go` 608、`app_install_instance.go` 598、`app_config.go` 582、`app_scan.go` 531、`app_model.go` 505）。
- `App` 结构体（`app.go:40`）约 42 字段、6 把锁（configMu / linkModeMu / watcherMu / plazaWinMu / proxyMu 等），为 god-object 雏形。
- 同时实测确认**底线健康**：生产代码 0 `log.Fatal` / 0 `panic`、依赖无环（`go/` 不反向依赖桥接层）、类型事实源单一、测试密集。故本决策是**演进式切分，不是推倒重来**。

风险：继续平铺将使并行会话冲突面扩大、锁序无法静态确认、单文件职责持续过载。

## 2. 决策（Decision）

**按业务域垂直切分 `internal/app` 为子包，采用「委托先行、逐步搬迁」的渐进策略**，禁止一次性大爆炸迁移。

### 2.1 目标子包（按域垂直切，不按技术层横切）

| 子包 | 收编文件（现状） | 摘出的 App 字段 |
|------|------------------|------------------|
| `internal/app/install` | `app_install*.go`、`app_download.go`、`app_launcher.go` | 下载队列、安装锁相关 |
| `internal/app/scan` | `app_scan.go`、`container_entries.go`、`app_files.go` | 扫描缓存/once |
| `internal/app/config` | `app_config*.go`（含 5 个平台变体）、`app_migrate*` | configCache、configMu |
| `internal/app/bindings` | `resource_bindings.go`、`resourcepack_models.go`、`app_container_cache.go`、`app_texture_cache.go`、`app_tags.go` | containerCache、tagsStore |
| `internal/app/bridge` | `cli_bridge.go`、`proxy.go`、`plaza_window.go` | proxySessions、httpServers、plazaWin |

`App` 最终只保留：生命周期（appCtx/appCancel/logger/runtimeLogs/watcher）+ 各域 manager 指针 + Wails 窗口句柄。

### 2.2 三条铁律

1. **Wails 绑定签名不变**：`App` 上保留同名委托方法 `func (a *App) InstallPack(...) { return a.installer.InstallPack(...) }`，前端 `window.go` 消费面零变化；`generate:bindings -ts` 重跑后 diff 应为零。
2. **依赖单向**：子包**禁止 import `internal/app`**（自上而下单向）。需要 App 服务的以构造函数参数注入接口或回调；延续 ADR-173 的环规避手法。
3. **锁随域走**：每把锁迁入所属 manager，禁止跨包加锁；迁移时顺带在 manager 注释中写明锁序，收敛 data race 面。

### 2.3 实施顺序（每域独立提交、独立验证）

`install`（最大域，先立样板）→ `bindings` → `config` → `scan` → `bridge`。每步验证：`go build ./...` + 全量 `go test -timeout`（Go 测试一律带 `-timeout`）。

### 2.4 同场加映（P2 项，随切分顺带）

- 给 `scanner.ScanEntries*` 等 IO 入口补 `context.Context` 参数，复用 `appCtx` 取消源。
- `wasm_decoder.go` 的包级 `var nodeJSPath = findNodeJS()` 改惰性 `sync.Once`。
- 引入 `golangci-lint`（`errcheck`/`govet`），吞错以白名单固化。

## 3. 后果（Consequences）

**正面**：单文件职责回归；并行会话冲突面缩小（按域隔离）；锁序可注释固化；App 回归「生命周期+桥」薄壳；为后续 Android/CLI 复用域逻辑铺路。

**负面/代价**：迁移期存在「委托方法」过渡态（短暂的双跳转）；每域迁移需重跑全量 Go 测试；子包间共享类型需上移到独立 `internal/app/types`（或复用 `go/types`），存在一次类型归位成本。

**已知遗留**：委托方法在全部域搬迁完成后是否清理，由各域完成后视 Wails 绑定生成行为再定（见知识卡）。

### 范围澄清（2026-09-04 实测补充）
日志子域（`app_install_log.go` 的 `AddImportLog/AddOpLog/GetImportLogs/ClearImportLogs/GetRuntimeLogs/ClearRuntimeLogs`）经依赖面复核，操作的 `a.logger` / `a.runtimeLogs` 是 **App 级共享日志基础设施**（watcher、sync、download 等全包写入，非 install 域私有状态）。若迁 `install` 包，需 `Manager` 持有 logger 副本而 `App` 仍须保留该字段——属伪切分，且违背「单一事实源 / 不推倒重来」。故**日志不纳入 install 收编清单**，留 `App` 包作为共享能力。

install 域实际收编结果：
- ✅ `queue`（P0，下载队列，纯逻辑零耦合）
- ✅ `linkMode`（P1，状态 + 持久化经 ConfigDeps 闭包单向注入）
- ✅ `launcher`（P1，纯函数转发）

### 复合域不切分子包（2026-09-04 实测补充）

`import` / `recycle` / `instance` 经三轮依赖面勘察（import.go 全文 → 跨域方法定位 → 私有 helper 调用方网络），判定**不迁 install 子包**，走文件级治理 + 知识卡记录：

1. **接口版 god-object**：迁移需 `AppDeps` 接口含 10+ 方法（LoadAppConfig/GetRepoRoot/DetectResourceType/ScanModelEntries×2/ClearScanCache/ListVersionInstances/filesRootForSync/saveConfig/logger…），等于把 god-object 换帽子，App 委托 + 组合链 + 私有转发仍占原文件 60% 以上，并不变薄。
2. **连带拉扯 files 域**：`importModelFolderAs` 宿主在 `app_files.go`（files 域），被 files 域绑定 + install 组合链三方共用，强迁污染边界或制造私有转发伪切分。
3. **测试迁移面大**：import/pack/coverage 等测试直接调私有 helper（如 `importModelFileWithSubpath`、`pushRepoPathToInstance`），迁移须改造测试。
4. **切分收益的耦合度门槛**：queue/linkMode/launcher 是「低耦合纯域」（依赖注入回调 + DTO 即可运转），切出收益为正；import/recycle/instance 是「高内聚复合域」（与 files/scan/bindings 共享 config/cache/logger 状态），切分收益为负。**收益来自切纯域，不在硬切复合域。**

此类判据已沉淀知识卡 `install_domain_split`，后续 scan/config/bindings/bridge 域切分前先过该门槛。

## 4. 数据溯源

2026-09-04 Go 端审查（Explore 子代理实测 + 主模型抽查）：internal/app 文件清单 Glob（70+ .go）、`go/**/*_test.go` ~96 个、`log.Fatal|panic(` grep 生产代码 0 命中、`App` 结构体 app.go:40 起约 42 字段。评分 7.5/10，P1 即本 ADR 主题。
