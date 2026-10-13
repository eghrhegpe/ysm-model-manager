# ADR-339：全类型 .disabled 启禁同步（大一统 repo↔pack 一致性）

- **状态**：📝 提议中（Proposed）
- **日期**：2026-10-13
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **准入理由**：把焊接在 YSM 的启禁→整合包同步链扩到所有 dirLevelSync 类型，需 Go 新绑定 + bus 契约变更 + 前端发射面，跨 Go/前端两域且难逆转
- **相关**：待补（`docs/adr/` / 关联代码路径）

---

## 1. 背景（Context）

<!-- ⚠️ 本节是「决策当时」的状态快照，ADR 落地后此处的病灶可能已治愈；评估「现在是否还这样」以当前源码树 + 知识卡实施进度为准，勿把本节当现状。 -->

`.disabled`/`.ban` 是**通用**启禁约定（`go/fileops/fileops_enable.go`：MC 生态通用，`registry.disableSuffixes=[".disabled",".ban"]`），`ToggleEnable` 对任意类型都生效（仓库侧改名即禁用）。但把 `.disabled` 状态**批量同步到整合包**的两条链都焊死在 YSM：

- 显式链：`sync:toggle:status` 仅在 YSM 树发射（`frontend/src/views/app-tree/{bus-handlers.ts:305, events.ts:113, index.ts:769}` 的 `rtype===YSM` 门），handler 锁 `GetRepoRoot("ysm")`（`features/sync/sync.ts:169`）。
- watcher 自动链：`watcher.New(ysmRoot, …)`（`internal/app/app.go:252`，`ysmRoot=GetRepoRoot("ysm")`）→ `syncAll` 调 `SyncToggleStatus(ins.CustomDir, ysmRoot, …)`（`go/watcher/watcher.go:367`）。

后果：非 YSM 的 `dirLevelSync` 类型（mmd 各子目录 / maid-model / blueprint / litematic）在**复制模式**下，repo 禁用了某模型，整合包侧的副本不会改名进 `.disabled` → repo↔pack 禁用态长期错位。`features/sync/sync.ts:168` 早已留痕「mmd/vrchat 启禁同步需 per-type 实例目录支持，**另行扩展**」——本 ADR 即收这条债。

## 2. 决策（Decision）

**范围 = `registry.IsDirLevelSync(rtype)` 的类型**（ysm / maid-model / blueprint / litematic / mmd 各子目录）。**排除** `dirLevelSync:false` 的 resourcepack / shaderpack / fbx——游戏用 config 列表启停，不认 `.disabled`，同步过去无意义（且 manager 也不为其建 disabled 桶）。

落地三处，全部把「按类型枚举 + 实例目录解析」收进 Go（守住回归红线「前端只读不判」）：

1. **Go 新绑定** `App.SyncModelToggleStatusForType(rtype string)`：`rtype` 为空 = 全部 `dirLevelSync` 类型；非空 = 只该类型。内部循环 `registry.AllSubDirs()`（按 `IsDirLevelSync` 过滤）× `mdsync.ListVersions(mcRoot)` 各实例，逐对 `registry.FindInstDir(ins.VersionDir, d.SubDir, rtype)` + `a.GetRepoRoot(rtype)`，复用既有 `ysmsync.SyncToggleStatus`（与 `RelinkAllInstanceResources` 全类型循环范式同源）。
2. **bus 契约** `sync:toggle:status`：`void` → `{ rtype?: string }`。发射方带「刚 toggle 的树类型」，handler 只同步**那个类型**——避免一次 toggle 白扫 14 类型 × N 实例的性能回归。
3. **前端**：三发射点去掉 `===YSM` 门，改带 rtype；`runSyncToggleStatus(payload)` 直调新绑定 `SyncModelToggleStatusForType(payload.rtype)`（不再自行 `ListVersionInstances` + 逐实例循环）。

## 3. 后果（Consequences）

- **正面**：非 YSM 的目录级模型禁用也即时跟 pack，repo↔pack 一致（大一统）；性能精确（只同步被动的类型）；类型枚举/目录解析归 Go，前端更薄。
- **负面/遗留**：① watcher **自动链仍是 YSM-only**（`app.go:252` 单 `ysmRoot`）——外部磁盘改动触发的自动同步不含非 YSM；留作后续（watcher 多根，或让 `syncAll` 复用 `SyncModelToggleStatusForType("")`）。② 依赖「游戏模组认 `.disabled`」的额外收益仍因模组而异（mmd/maid 大概率认，本 ADR 不为游戏认不认背书，只为 manager 自身一致性负责）。

## 4. 数据溯源

查证 → 决策：`sync.ts:168`「另行扩展」留痕 + `bus-handlers.ts:305`/`app.go:252` 双链 YSM-only 实锤（当前源码树逐行核）→ 缺口成立；`fileops_enable.go`/`registry.disableSuffixes` 证 `.disabled` 通用 → 扩范围安全；`registry.IsDirLevelSync` + `resource_types.json` 的 `dirLevelSync` 字段（true: ysm/maid-model/blueprint/litematic/mmd 各子目录；false: resourcepack/shaderpack/fbx）→ 定范围；`RelinkAllInstanceResources`（`app_install_instance.go:254`）的全类型循环范式 → 落地范式。

<!-- 文件名: alltype-toggle-sync.md → 实际文件 architecture/ADR-339-alltype-toggle-sync.md（ADR-320 architecture 全量模板） -->
