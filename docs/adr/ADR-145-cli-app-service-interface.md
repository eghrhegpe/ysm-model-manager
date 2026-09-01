# ADR-145：cli 解耦 app：消费方定义 AppService 接口

- **状态**：已采纳（Accepted）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-01
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`go/cli/*.go, internal/app/*.go, main.go, go/types`

---

## 1. 背景（Context）

依赖方向图扫描（2026-09-01）发现架构倒挂：

```
go/cli ──import──▶ internal/app（Wails GUI 层）
```

`go/cli` 的定位是「脱离 GUI 的命令行操作」（AGENTS.md 原话），实际却反向依赖 GUI 层：

- **10 处 import** `ysm-model-manager/internal/app`（7 个生产文件：cli.go / tags.go /
  registry.go / download.go / mmd.go / concurrent.go / flow.go；3 个测试文件）。
- `CmdContext.App` 字段类型是具体类 `*app.App`，CLI 命令经它直调 **46 个 App 方法**
  （45 个经 `ctx.App.*` + `DispatchCommand` 的 `a.SetSessionFilesRoot`）。
- 后果：① CLI 想脱离 GUI 运行 / 测试，却被迫拉起整个 Wails App 上下文；②
  业务逻辑没抽成独立于 UI 的服务层，CLI 只能复用 `app.App` 的方法；③
  `internal/app` 是 29 扇出的 god-object 门面，CLI 反向边进一步把它焊死在 UI 上。

根因：**消费方（cli）持有了提供方（app）的具体实现**，而非面向接口。

## 2. 决策（Decision）

采用 Go 标准「消费方定义接口」反向依赖倒置，让 `internal/app.App` 隐式实现接口：

1. **在 `go/cli` 定义 `AppService` 接口**，仅含 CLI 实际调用的 46 个方法
   （45 个 `ctx.App.*` + `SetSessionFilesRoot`）。消费方持接口，不持 `*app.App`。
2. **`CmdContext.App` 字段类型改为 `AppService`**；`DispatchCommand` /
   `ExecuteCLIWithApp` / `RunCLI` 入参全部改为 `AppService`。
3. **DTO 下沉**：接口签名中的 `DownloadTask`、`QueueStatusInfo` 两个类型
   目前在 `internal/app/app_download.go`——CLI 要引用它们就得继续 import app（死结）。
   下沉到 `go/types`（跨边界契约本就属共享类型层；纯 JSON DTO，无内部依赖，
   JSON tag 原样保留 → Wails bindings / 契约测试不受影响）。
4. **组装上移**：`RunCLI` 不再内部 `app.NewApp()`（那会逼 cli import app），
   改为由 `main.go` 构造 `app.NewApp()` 后传入 `AppService`——装配责任留在入口。
5. **不做**：不把 46 个方法背后的业务逻辑搬到新包（那是更大的服务层抽取，
   另行 ADR）；本次只断掉 `go/cli → internal/app` 的依赖边。

目标依赖方向：

```
go/cli ──▶ AppService（接口，定义在 cli 内）
internal/app ──▶ go/*（App 实现 AppService，单向）
go/cli 不再 import internal/app ✓
```

## 3. 后果（Consequences）

正面：

- 断掉最硬的反向边：`go/cli` 生产代码不再依赖 Wails GUI 层，「无 GUI 跑 CLI」
  从口号变事实；CLI 逻辑可独立编译 / 测试 / 未来抽服务层。
- `internal/app.App` 凭 Go 结构化接口隐式满足 `AppService`，无需改造 app 本体，
  不改任何方法签名（除 DTO 下沉后的类型归属，签名文本不变）。
- DTO 下沉后 bindings 的 JSON 结构逐字节不变（url/saveDir/name/size、
  remaining/running），前端契约零漂移。

负面 / 已知遗留：

- `AppService` 是 46 方法的大接口（粗粒度门面），比细粒度接口丑，但远好于
  依赖具体类型——它是第一步止血，不是终点。
- `go/cli` 的 3 个测试文件仍 import `internal/app`（零值 `&app.App{}` 构造）。
  属可接受：测试本可依赖具体实现做集成验证；生产代码已断边。
- `internal/app` 29 扇出 god-object 仍在（独立治理项，ADR-144 之外另行处理）。
- `frontend/bindings/ysm-model-manager/go/types/` 会新增 DownloadTask 相关产物
  （generate:bindings 自动生成）。

## 4. 数据溯源

- 反向边：`grep ysm-model-manager/internal/app go/cli` → 10 处（7 生产 + 3 测试）。
- 方法清单：`grep '(ctx\.App|a\.App)\.([A-Z]\w*)\(\)' go/cli` 去重 → 45；
  + `registry.go:102 a.SetSessionFilesRoot` → 共 46。
- DTO 障碍：`internal/app/app_download.go` `type DownloadTask`（url/saveDir/name/size）、
  `type QueueStatusInfo`（remaining/running）——纯 JSON DTO，无方法无内部依赖。
- 签名基线：46 个方法其余入参/返回均为 stdlib / `go/types` / `go/ysm` 类型，
  无其它 app 私有类型（逐签名核对）。
