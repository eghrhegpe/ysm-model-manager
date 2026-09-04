---
kind: install_domain_split
name: install 域切分经验：切纯域不硬切复合域（耦合度门槛判断）
tier: architecture
category: go
source_files:
  - internal/app/app_install_import.go
  - internal/app/app_install_recycle.go
  - internal/app/app_install_instance.go
auto_fields:
  symbols_with_lines:
    - App.ClearInstanceResources
    - App.CountInstanceResources
    - App.DeleteFromRecycle
    - App.DetectContainerType
    - App.EmptyRecycleBin
    - App.GetInstanceStatus
    - App.GetInstanceSyncStatus
    - App.GetResourceInstanceStatus
    - App.GetSyncScanDirs
    - App.HasYSMMod
    - App.ImportFileAndPushToInstance
    - App.ImportFolderAndPushToInstance
    - App.ImportModelFile
    - App.InstallModelFile
    - App.InstallModelTo
    - App.ListRecycleBin
    - App.MoveToRecycle
    - App.PullResourceFromInstance
    - App.PullSingleResourceFromInstance
    - App.PushResourceToInstance
    - App.PushSingleResourceToInstance
    - App.RelinkAllInstanceResources
    - App.RestoreFromRecycle
    - App.SyncCustomToRepo
    - App.SyncModelToggleStatus
    - App.SyncResources
use_when:
  - internal/app 再切分或迁移 App god-object 字段/方法时
  - 评估某子域「迁出 internal/app 包」的收益与成本
  - 复述 ADR-179 实际收敛边界
pitfalls:
  - 硬切高内聚复合域会把 App god-object 换成「接口版 god-object」，且连带拉扯共享 helper 的宿主域（伪切分）
  - 包级私有 helper 被多域/多测试直调时，迁移需连带改造测试，成本随调用面放大
quick_groups:
  - install: queue / linkMode / launcher
  - shared (不迁): logger / runtimeLogs / scan cache / config
quick_intents:
  - 该子域是否仅依赖注入回调与 DTO 即可运转？是 → 可切（纯域）
  - 该子域是否直读 App 的共享基础设施字段？是 → 不切（复合域）
quick_risk_lines:
  - import 域依赖 LoadAppConfig/GetRepoRoot/ScanModelEntries/ClearScanCache/ListVersionInstances 等 10+ 跨域方法
  - importModelFolderAs 宿主在 app_files.go（files 域），被 files 域绑定与 install 组合链三方共用
invariant_anchors:
  - internal/app/app_install_import.go|ImportFileAndPushToInstance
---

# install 域切分经验：切纯域不硬切复合域（耦合度门槛判断）

## 概览

ADR-179 垂直切分 `internal/app` 的**实际收敛边界**（2026-09-04 实测确定）。切分前须先过「耦合度门槛」判断：**纯域（只依赖注入回调 + DTO）切分子包收益为正；复合域（直读 App 共享基础设施 / 与 files-scan-bindings 互咬）硬切收益为负，属过度工程**。

## 核心职责

为后续任何 `internal/app` 子包切分（scan/config/bindings/bridge 域）提供可复用的判据：

1. **切**：方法群可经构造参数注入回调/Deps 接口运转，无 App 字段直读 → 迁子包，App 留同名委托（Wails 绑定签名不变，`generate:bindings -ts` diff 为零）。
2. **不切**：方法群直读 App 级共享基础设施（logger/runtimeLogs/watcher/config 快照/扫描缓存）或与跨域私有 helper 深度耦合 → 留 App 包。

## 对外 API / 入口

- `internal/app/install` 子包：`Manager`（聚合根，持 `Queue`/linkMode 状态）+ `NewManager` + `ConfigDeps` 闭包注入。
- App 侧保留同名 Wails 绑定委托：`EnqueueDownloads`/`CancelQueue`/`QueueStatus`/`SetLinkMode`/`GetLinkMode`/`DetectLauncherInstances`。

## 与其他子系统关系

| 子域 | 处置 | 依据 |
|------|------|------|
| queue（下载队列） | ✅ 迁入 install | 纯逻辑，外部依赖全为注入回调（emitFn/AddOpLog），零 App 字段直读 |
| linkMode（链接模式） | ✅ 迁入 install | 状态私有；配置读写经 `ConfigDeps` 闭包单向注入 |
| launcher（实例探测） | ✅ 迁入 install | 纯函数转发 `launcher.Detect`，无 App 状态 |
| 日志（app_install_log.go） | ⏸ 留 App | 操作的 logger/runtimeLogs 是 App 级共享基础设施（watcher/sync/download 全包写入），伪切分 |
| import（app_install_import.go） | ⏸ 留 App | 需 10+ 跨域方法接口（LoadAppConfig/ScanModelEntries/ClearScanCache/ListVersionInstances…），换接口版 god-object |
| recycle / instance | ⏸ 留 App | 同上，且与 files 域共享 helper（如 `importModelFolderAs` 宿主在 app_files.go） |

## 不变量

- Wails 绑定签名在任何切分前后不变（委托薄壳保 `window.go` 消费面零变化）。
- 子包禁止 import `internal/app`（依赖单向，延续 ADR-173 环规避）。
- `&App{}` 零值构造（测试常用）下 Manager 方法须 nil 安全（返回零值而非 panic）。

## 相关

- ADR-179（本经验的决策载体；范围澄清含日志/import/recycle/instance 不切分记录）
- ADR-173（app→cli 环规避：allowedCommands 注入，Deps 闭包同手法）
- ADR-134（containerCache 包级全局抽离先例）
