# ADR-134：将 containerTypeCache 包级全局收进组件（破隐藏耦合）

- **状态**：已采纳（Accepted）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-08-30
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`docs/knowledge/app_cycle_injection.md`

---

## 1. 背景（Context）

`internal/app` 是 Wails 绑定层（god-object `App`）。扫描链路有两份进程内缓存：

1. `go/scanner` 包的 `scanCache`（`sync.Map`，30s TTL，条目缓存）——已由该包自有全局持有，经
   `scanner.InvalidateCache()` 清除。
2. `internal/app/app_scan.go:346` 的 **`var containerTypeCache sync.Map`**——容器类型指纹缓存
   （path → `{modTime,size,detected}`），由**包级全局变量**持有，被 `cachedContainerType()`
   读写、被 `App.ClearScanCache()` 直接 `.Clear()`。

第 2 份缓存是**包级全局可变状态**，属 `app_cycle_injection.md` 知识卡定义的"隐藏耦合"而非对象级环：
- 跨文件隐式共享：`ClearScanCache`(app_scan.go) 与 `InvalidateScanCache`(resource_bindings.go)
  都直接 mutate 这个包级全局；
- 测试间会串（全局在进程内共享，单测不清就泄漏）；
- 不属于任何组件，违反"状态应收进组件内部持有"的既有范式（参见 `DownloadQueue` 经注入破环）。

外部调用面（`App.ClearScanCache` / `App.InvalidateScanCache`）经 Wails 暴露给前端、
且被 watcher 回调注册（`app.go:206` / `app_config.go:228`），**签名与行为不得变**。

## 2. 决策（Decision）

**在 `internal/app` 内抽一个小组件持有 `containerTypeCache`，照 `DownloadQueue` 的注入范式，
不碰 `go/scanner`、不动任何 binding 签名。**

最小形态（新增文件 `internal/app/app_container_cache.go`）：

```go
// containerTypeCache 容器类型指纹缓存（path → fingerprint），原包级全局，现收进组件内部持有
type containerTypeCache struct {
    mu       sync.Mutex
    items    map[string]containerFingerprint
    detectFn func(path string, registry *types.ResourceTypeRegistry) string // 可注入，对照 DownloadQueue
}

type containerFingerprint struct {
    modTime  time.Time
    size     int64
    detected string
}

// newContainerTypeCache 构造组件；detectFn 负责「缓存未命中时」的真实容器类型探测
func newContainerTypeCache(detectFn func(path string, registry *types.ResourceTypeRegistry) string) *containerTypeCache {
    return &containerTypeCache{items: make(map[string]containerFingerprint), detectFn: detectFn}
}

// defaultDetectFn 生产默认探测实现（指向 packs，组装点注入 App）
func defaultDetectFn(path string, registry *types.ResourceTypeRegistry) string {
    return packs.DetectResourceType(path, registry)
}

// Get 返回容器真实类型（带文件指纹缓存）；文件变化（modtime/size）时重核验
func (c *containerTypeCache) Get(path string, registry *types.ResourceTypeRegistry) string {
    info, err := os.Stat(path)
    if err != nil {
        return ""
    }
    c.mu.Lock()
    fp, ok := c.items[path]
    c.mu.Unlock()
    if ok && fp.modTime.Equal(info.ModTime()) && fp.size == info.Size() {
        return fp.detected
    }
    detected := c.detectFn(path, registry)
    c.mu.Lock()
    c.items[path] = containerFingerprint{modTime: info.ModTime(), size: info.Size(), detected: detected}
    c.mu.Unlock()
    return detected
}

func (c *containerTypeCache) Clear() {
    c.mu.Lock()
    c.items = make(map[string]containerFingerprint)
    c.mu.Unlock()
}
```

组装与接线（保持 `ClearScanCache` 外部签名不变）：

```go
// app.go — App struct 新增字段
type App struct {
    // ……
    containerCache *containerTypeCache
}

// app.go — NewApp() 内初始化（默认探测指向 packs）
a.containerCache = newContainerTypeCache(defaultDetectFn)

// app_scan.go — cachedContainerType 删除，调用点改方法
// 原: if detected := cachedContainerType(e.Path, registry); detected != rtype {
// 改: if detected := a.containerCache.Get(e.Path, registry); detected != rtype {

// app_scan.go — ClearScanCache 仍清两份缓存，但全局改为组件字段
func (a *App) ClearScanCache() {
    a.ensureContainerCache()       // 兜底：测试用 repoApp 不经 NewApp 构造时惰性初始化
    scanner.InvalidateCache()      // 清 go/scanner 的 scanCache（不变）
    a.containerCache.Clear()       // 清本组件持有的指纹缓存（原 containerTypeCache.Clear()）
}

// ensureContainerCache 兜底：repoApp 构造的 App 不经 NewApp，containerCache 为 nil 时惰性初始化
func (a *App) ensureContainerCache() {
    if a.containerCache == nil {
        a.containerCache = newContainerTypeCache(defaultDetectFn)
    }
}
```

理由：
- **最小**：改动全在 `internal/app` 单包内；`go/scanner`、Wails binding、前端、watcher 注册**零改动**；
  外部只看到 `App.ClearScanCache()` 行为不变。
- **与既有范式一致**：完全复刻 `DownloadQueue` 路径（全局/自由函数 → 组件字段 + 方法 + `NewApp` 注入），
  未来 reviewer 有 `app_cycle_injection.md` 可对照。
- **消除隐藏耦合**：全局状态收进 `App` 持有的组件，生命周期随 `App` 走，测试可独立构造、互不串污染。

## 3. 后果（Consequences）

**正面**
- 包级全局可变状态清零一处；`internal/app` 的"隐藏耦合"清单再少一项。
- 并发更安全：原 `sync.Map` 无条件并发读；改为 `map + mutex` 后语义等价，且 `Clear` 与 `Get`
  的竞态窗口由单一锁收敛（实测当前调用均在 App 单例内串行，风险本就低）。
- 可测性提升：组件可脱离 `App` 单测（注入 mock `detectFn` 断言缓存短路语义，无需真实容器文件；
  见 `internal/app/app_container_cache_test.go`）。`ScanModelEntriesFiltered`/`ClearScanCache`
  经 `ensureContainerCache()` 兜底，测试用 `repoApp` 不经 `NewApp` 构造时不会 nil panic。

**负面 / 代价**
- `App` struct 多一个字段（god-object 略胖，但属"持有组件"的正当膨胀，非方法堆砌）。
- 需同步更新 `app_cycle_injection.md` 知识卡的"排查范围"示例（把 `containerTypeCache` 从
  "待收进组件"改为"已收进组件"）。

**已知遗留**
- `go/scanner` 的 `scanCache` 仍是该包内包级全局——那是另一包的事，本 ADR 不触碰；
  若日后想把"所有扫描缓存"统一收口，可另立 ADR 把两份缓存在 `go/scanner` 内合并，
  但那会改 `cachedContainerType` 跨包调用，超出"最小"范畴，故不纳入本次。

## 4. 数据溯源

- 来源：`internal/app/app_scan.go:346` `var containerTypeCache sync.Map`、
  `:354-369` `cachedContainerType`、`:429-433` `ClearScanCache`；
  `internal/app/resource_bindings.go:589` `InvalidateScanCache` 委托 `ClearScanCache`；
  `internal/app/app.go:206` / `app_config.go:228` watcher 注册 `a.ClearScanCache`。
- 结果：确认该全局仅被 `cachedContainerType`（读+写）与 `ClearScanCache`（清）三处触碰，
  且 `cachedContainerType` 仅被 `app_scan.go:410` 一处调用 → 收进组件后**无外部签名变化**，
  最小重构可行。
- 关联范式：`docs/knowledge/app_cycle_injection.md`（对象级环打破 + 隐藏耦合排查范围）。

<!-- 文件名: container-type-cache-component.md → 实际文件 ADR-134-container-type-cache-component.md -->
