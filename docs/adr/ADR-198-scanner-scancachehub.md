# ADR-198：scanner 扫描缓存五件套收口为 scanCacheHub 组件

- **状态**：已采纳（Accepted）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-06
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：ADR-134（全局状态抽离为组件）、ADR-109（审核框架/并发 checklist）

---

## 1. 背景（Context）

`go/scanner` 包级存在五件全局可变状态（scanner.go 头部）：
`scanCache`（扫描缓存）、`inFlight`（single-flight 航班表）、`cacheGen`（全局代际）、
`keyVersions`（per-key 版本戳）、`walkCount`（walk 计数）。

问题：
1. 与 ADR-134「包级全局状态抽离为 App 持有组件」方向正面冲突（同性质的
   containerTypeCache 已抽离，scanner 五件套是最大遗留）；
2. 测试隔离靠 hook 注入 + 手工失效（`InvalidateCache`），`scanCache`/`dedupSeen`
   跨测试污染风险常驻；并行会话各跑测试时无独立沙箱；
3. 五件套彼此强耦合（代际守卫依赖 cacheGen+keyVersions 联动），散落为全局量后
   不变量（invariant）无法在结构体方法内集中维护，读者须跨文件拼图。

同时承认现状的价值：这套三层守卫（single-flight + 全局代际 + per-key 版本）是
全仓并发设计最佳（见锐评 #21 亮点），重构**只换组织方式、不动并发语义**。

## 2. 决策（Decision）

将五件套收进单一 `ScanCacheHub` 结构体，scanner 包内全部缓存访问改走 hub 方法：

1. **结构**：`type ScanCacheHub struct { scanCache; inFlight; cacheGen; keyVersions; walkCount }`
   + 各自的 mutex 保持原布局，方法名与现函数语义一一对应
   （`getOrStartFlight` / `joinInFlightWaiter` / `bumpGen` / `invalidate` …）。
2. **持有**：包内默认 hub 实例（`defaultHub`）保持现包级 API 签名不变
   （`ScanEntries` 等公开函数委托给 defaultHub）——**公开 API 零破坏**，调用方无感；
3. **可注入**：`NewScanCacheHub()` 供测试创建独立沙箱实例，测试不再依赖全局失效；
4. **接线（后续刀）**：App 组装点持有 hub 并注入（对齐 containerTypeCache 范式，
   ADR-134）；CLI/无 App 场景走 defaultHub 兜底；
5. **红线**：并发语义逐行等价迁移——single-flight 航班判定、waiter 版本比较、
   代际失效链不得改变；迁移前先为现有缓存行为补齐语义钉子测试
   （`scanner_cache_*` 已有基础，缺口处先测后迁）。

分刀顺序：刀 1 = 结构体收拢 + 包内委托（纯机械）；刀 2 = 测试沙箱化；
刀 3 = App 接线注入。每刀独立可提交、可回滚。

## 3. 后果（Consequences）

正面：
- 不变量集中：代际守卫的 cacheGen/keyVersions 联动在 hub 方法内单点维护；
- 测试隔离：独立 hub 实例，跨测试污染根除；
- ADR-134 账还清：internal/app 与 go/ 两侧全局可变状态治理口径统一。

负面 / 已知遗留：
- 迁移期包内存在 defaultHub 委托层，多一层间接（可接受，公开 API 稳定优先）；
- `dedupSeen`（dedup 包）同类全局状态不在本 ADR 范围，如需同款治理另立决策；
- 改动面覆盖 scanner.go 大半文件，须整刀提交，禁止跨刀半成品合流。

## 4. 数据溯源

- 锐评 2026-09-06 #3（严重）：`go/scanner/scanner.go:30-62` 全局五件套；
- 锐评 #21（亮点）：三层守卫并发设计为全仓最佳——重构约束「语义零变更」的依据；
- ADR-134：全局状态抽离方向；containerTypeCache（app_container_cache.go）：同款收口先例。
