---
kind: app_cycle_injection
name: App↔子组件对象级环打破范式（回调注入）
tier: architecture
adr:
  - ADR-109
category: go
source_files:
  - internal/app/app_download.go
  - internal/app/app.go
auto_fields:
  symbols_with_lines:
    - App
    - App.CancelQueue
    - App.DownloadFromGitHub
    - App.EnqueueDownloads
    - App.GetAppVersion
    - App.GetYSMRepoRoot
    - App.OpenInBrowser
    - App.QueueStatus
    - App.ServiceShutdown
    - App.ServiceStartup
    - App.SetApp
    - App.SetMainWindow
    - DownloadQueue
    - NewApp
    - NewDownloadQueue
quick_groups:
  - 跨组件通信与页面
quick_intents:
  - App↔子组件对象级环、回调注入
  - 循环依赖、NewApp 组装
quick_risk_lines:
  - 子组件必须用回调注入替代 *App 反向指针，禁止在子组件 struct 里持 *App 字段
pitfalls:
  - 子组件持 *App 字段 → 对象级循环依赖、GC 无法回收；必须经回调注入
  - 回调未正确包装 → 空指针 panic；必须在新 App 时注入完整包装

use_when:
  - 新增/重构 internal/app 下的子组件（队列、缓存、扫描器等），且它需要调用 App 的能力（发事件、写日志、下载文件等）
  - 评审 PR 时检查是否有人把 `*App` 反向指针重新加回某个子组件 struct
  - 想确认「循环依赖」现状：本仓仅剩包级（import）环由 go build 兜底，对象级环已清零
status: active
---

# App↔子组件对象级环打破范式（回调注入）

## 概览

`internal/app` 是 Wails 绑定层（`package app`），`App` 是 god-object，持有若干子组件
（下载队列、纹理缓存、扫描器等）。子组件运行时往往要用到 App 的能力——发事件
（`a.app.Event.Emit`）、写操作日志（`a.AddOpLog`）、执行下载（`a.downloadFileWithQueue`）。
若子组件直接持有 `*App` 字段，就会形成 **App ↔ 子组件 的对象级循环引用**。

本范式用**依赖注入回调/闭包**取代反向 `*App` 指针：子组件只声明它需要的
`func` 字段，`App` 在 `NewApp()` 组装时把对应方法/闭包注入进去。结构上的环被打破，
残留的仅是 `App → 子组件 → 闭包（捕获 a）` 的单向所有权链，Go 的 mark-sweep GC 可正常回收，
无内存泄漏，且子组件可脱离 App 单独构造与单测。

> 历史：ADR-002 项目健康评估曾标记「仅 1 处同包内对象级循环（DownloadQueue ↔ App）」。
> 该环已由 **ADR-002 P1** 用本范式打破，`internal/app/app_download.go` 是落地样板。
> 现状（2026-08-30 实证）：`internal/app` 下已无任何 struct 字段持有 `*App` 反向指针。

## 核心职责

- 打破 App↔子组件的对象级循环引用，使依赖方向单向（App 拥有子组件，子组件不回指 App）。
- 让子组件可独立单元测试（构造时传入普通 func / mock，无需先造一个完整 `*App`）。
- 把「子组件需要 App 什么能力」显式声明在构造函数签名里，组装点一目了然。

## 对外 API / 入口

以 `DownloadQueue` 为样板：

```go
// internal/app/app_download.go
type DownloadQueue struct {
    tasks []types.DownloadTask // DTO 归属 go/types（ADR-145：跨包契约下沉）
    mu    sync.Mutex
    // ……
    // 注入的回调，替代原 *App 反向引用
    downloadFn func(ctx context.Context, url, saveDir string) (string, error)
    emitFn     func(name string, args ...interface{})
    logFn      func(op, modelName, sourcePath, targetDir string, fileSize int64, status, errMsg string)
}

// 组装点注入：App 把自身方法/闭包传给子组件，而非子组件存 *App
func NewDownloadQueue(
    downloadFn func(ctx context.Context, url, saveDir string) (string, error),
    emitFn     func(name string, args ...interface{}),
    logFn      func(op, modelName, sourcePath, targetDir string, fileSize int64, status, errMsg string),
) *DownloadQueue
```

注入站点（`internal/app/app.go` `NewApp()`）：

```go
a.queue = NewDownloadQueue(
    a.downloadFileWithQueue,                              // 方法值
    func(name string, args ...interface{}) { a.app.Event.Emit(name, args...) }, // 闭包捕获 a
    a.AddOpLog,                                          // 方法值
)
```

## 与其他子系统关系

- **`check-circular-go.mjs`（治理脚本）**：只扫**包级（import）循环**，明确**不覆盖对象级循环**。
  本仓包级环由 `go build` 天然拒绝；对象级环经本范式已清零，故该盲区当前无实际债。
  ⚠️ 若未来有人把 `*App` 反向指针加回子组件，该脚本**不会报警**——须靠本卡 + code review 守住。
- **ADR-002 / ADR-002 P1**：决策与落地记录（DownloadQueue↔App 环已破、解锁独立测试）。
- **Wails 绑定生成**：`App` 方法经 `window.go` 暴露给前端；子组件经 App 方法间接可达，不直连。

## 不变量

1. `internal/app` 内任何子组件 struct **不得**声明 `*App` 字段（反向指针）。
2. 子组件需要 App 能力时，一律在 `NewApp()`（或其专属 `NewX`）以 func / 闭包注入。
3. 注入的闭包若捕获 `a`，仅用于延迟解析 `a.app` 等启动期后才就绪的字段（如 `SetApp` 注入的
   `*application.App`），不得造成额外生命周期耦合。
4. 子组件构造不依赖完整 `*App`，可独立单测（见 `app_download_test.go`）。

## 排查范围 / 已知误区（2026-08-30 全量扫描结论）

- **本仓 `internal/app` 已无任何对象级循环**：逐一核对全部 struct 字段，
  仅有 **单向** 引用——`App→*DownloadQueue`、以及 `App→*proxySession→*cookieJar`
  （均不回指 `App`）；跨包指针（`*watcher.Watcher`、`*tags.Store`、`*application.App`）
  也不反向持有 `App`。故"破环"范畴内**当前无活债**，无需再搜 struct 互指环。
- 大文件（`resource_bindings.go` 744 / `app_install_instance.go` 651 / `app_scan.go` 601 /
  `app_model.go` 586 / `app_config.go` 553 行）是 **god-object 方法膨胀**，不是对象级耦合；
  若拆分属"可维护性/内聚"重构，与破环是两件事。
- 真正该警惕的**隐藏耦合是「包级全局可变状态」而非环**：先前 `app_scan.go` 的
  `var containerTypeCache sync.Map` 即此类——由 `ClearScanCache`(app_scan.go) 与
  `InvalidateScanCache`(resource_bindings.go) 跨文件直接 mutate 的全局缓存。
  **已于 2026-08-30 经 ADR-134 收进 `containerTypeCache` 组件**（`internal/app/app_container_cache.go`，
  持有 `map+mutex+可注入 detectFn`，复用本范式回调注入；`App.containerCache` 字段在 `NewApp()` 组装点注入，
  `ensureContainerCache()` 兜底 repoApp 不经 NewApp 构造的 nil 场景）。该全局债务已清零。

## 相关

- `docs/adr/ADR-002-project-health-assessment.md`（P1：DownloadQueue↔App 环打破）
- `docs/adr/ADR-134-container-type-cache-component.md`（将 `containerTypeCache` 包级全局收进组件的最小重构决策，已落地）
- `internal/app/app_container_cache.go` + `app_container_cache_test.go`（ADR-134 落地：组件 + 注入式单测）
- `scripts/check-circular-go.ts`（包级环检测，不含对象级——盲区由本卡覆盖）
- `internal/app/app_download_test.go`（注入后独立测试样板）
