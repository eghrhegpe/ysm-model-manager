# ADR-032：同步差异检测与失败可见性加固

- **状态**：✅ 已采纳
- **日期**：2026-08-04
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`go/sync/sync.go, frontend/js/views/app-sync-manager/index.ts`

---

## 1. 背景（Context）

整合包同步模块（`go/sync` + `app-sync-manager`）审核发现四个缺陷：

1. **改动静默失败**：`SyncToggleStatus` 的 rename 失败分支（非锁定错误）为空块吞错，启用/禁用改动无任何日志留痕，用户与排障者均无感知；
2. **内容变化漏报**：`SyncResources` 按文件名匹配不比对内容——整合包内被用户改过的同名文件（改名不改名）判为 `synced`，差异不可见；
3. **错误分类脆弱**：`isFileLocked` 仅靠英文错误子串（"sharing"/"access"）文本匹配；
4. **前端并发覆盖**：`app-sync-manager` 的 `_init` 无防重入，快速切换 instance 属性时多个异步加载并发执行，后完成者覆盖先完成者的渲染。

## 2. 决策（Decision）

1. **失败路径补日志**：`SyncToggleStatus` 锁定跳过与非锁定失败均 `log.Printf` 留痕（文件名 + 错误），不再静默吞错；
2. **同名异 size 归入 Missing**：`SyncResources` 收集文件大小，同名文件 size 不同（内容已变化）视为待推送更新归入 `Missing`；目录类资源（含 `pack.mcmeta` 的文件夹）按名匹配不受影响——mtime 因安装复制必变不可靠、hash 全量成本高，故以 size 为差异信号；
3. **errno 优先判定**：`isFileLocked` 先做 `errors.Is` errno 判断（Windows `ERROR_SHARING_VIOLATION`=32 / Unix `EBUSY`=16；两端错误码空间互不重叠，rename 不会命中对方语义，跨平台无副作用），英文子串文本匹配降为兜底；
4. **`_init` generation 守卫**：代际计数递增，过期加载在 await 后 `gen !== this._gen` 时丢弃渲染与订阅，防并发覆盖。

## 3. 后果（Consequences）

**正面**：

- 启/禁用改动失败可见（日志留痕）；
- 内容变化可推送更新：`SyncResources` 的 Missing 信号经 `PushResourceToInstance` 走 `installer.Install` 原子替换（ADR-028）闭环，新版本落地；
- 锁定判定跨平台稳健；前端快速切 instance 不再互相覆盖。

**负面 / 已知遗留**：

- size 相同而内容不同的漏报仍存在（hash 成本权衡，接受）；超大文件截断哈希（`maxHashRead` 100MB）同理；
- `GetInstanceSyncStatus` 每次刷新对每资源类型全目录 Walk，未做缓存（性能观察，正确性 OK）；
- `_lastSelectedType` 模块级偏好状态保持（跨实例记忆 tab 选择是特性，未改）；
- `go/sync/sync.go` gofmt 遗留问题随本次修复（`gofmt -w` 已清）。

## 4. 数据溯源

- **来源**：同步模块审核报告（2026-08-04）——P2 改动静默失败 / P2 同名内容漏报 / P3 文本匹配脆弱 / P3 前端 `_init` 无防重入；
- **决策落地**：commit `0d16e3a`（`fix(sync): 同步差异检测与失败可见性`）；
- **验证**：`go build ./go/... ./internal/app/...` 通过；`go test ./go/sync/` 14/14 PASS（新增 `TestSyncResources_SizeMismatch` / `TestIsFileLocked`）；前端 `npm run typecheck` 通过。

<!-- 文件名: sync-diff-detection-failure-visibility.md → 实际文件 ADR-032-sync-diff-detection-failure-visibility.md -->
