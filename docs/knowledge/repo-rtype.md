---
kind: repo-rtype
name: 全局资源类型状态 repo-rtype
tier: leaf
category: feature
source_files:
  - frontend/src/features/repo/repo-rtype.ts
  - frontend/src/utils/dom/storage.ts
  - frontend/src/bus.ts
auto_fields:
  symbols_with_lines:
    - bus
    - Bus
    - BusEventName
    - BusEvents
    - CtxShowPayload
    - currentRepoType
    - MenuItem
    - ModelSelectPayload
    - NavPagePayload
    - PageName
    - safeGet
    - safeRemove
    - safeSet
    - ToastPayload
    - useCurrentResourceType
quick_groups:
  - 资源类型与仓库状态
quick_intents:
  - currentRepoType 当前资源类型
  - useCurrentResourceType 订阅类型切换
  - repo_rtype localStorage 权威源
pitfalls:
  - 权威源 = localStorage `repo_rtype`（由 app-nav 切换器写入），禁止各模块自行落盘
  - 运行期类型变更唯一入口 = `repo:rtype-changed` 事件；直接读 localStorage 会错过运行期切换
  - `useCurrentResourceType` 的 onChange 仅在类型真正变化时触发（同值去重），组件销毁必须调 cleanup()
use_when:
  - 当前资源类型
  - 类型切换订阅
  - 仓库类型权威源
  - repo_rtype 状态
status: active
---

# 全局资源类型状态 repo-rtype

## 概览

全局资源类型权威源。收敛 `oldest-models` / `recycle-bin` / `views/init-pages` 三处各自手写的 `safeGet("repo_rtype") || RESOURCE_TYPES.YSM` + `bus.on("repo:rtype-changed")` 同模式：初值取 localStorage（持久化权威源，由 app-nav 切换器写入）；运行期以事件载荷为准，类型变化时更新并触发 onChange。

## 核心职责

- **`currentRepoType(): string`** — 读取当前仓库资源类型（时刻值）。权威源 = localStorage `repo_rtype`，缺省 `RESOURCE_TYPES.YSM`。适用于「操作时读取当前类型」的一次性场景（下载落库、导入冲突检查等）。
- **`useCurrentResourceType(onChange: () => void): { get, cleanup }`** — 订阅当前仓库资源类型。初值取 `currentRepoType()`；运行期监听 `repo:rtype-changed` 事件，类型变化时更新内部值并回调 `onChange()`；同值去重不重复触发。`cleanup()` 移除订阅（组件销毁时调用，防迟到响应/泄漏）。

## 对外 API / 入口

- `currentRepoType(): string` — 一次性读取当前类型（download-queue / import-executor / toolbar-events / show-repo-models / diagnostics/health 等消费）
- `useCurrentResourceType(onChange: () => void): { get: () => string; cleanup: () => void }` — 订阅类型切换（oldest-models / recycle-bin 消费）

## 与其他子系统关系

- **`views/app-nav/index.ts`** — 导航栏资源类型切换器：用户选择后 `safeSet("repo_rtype", sel.rtype)` 落盘 + `bus.emit("repo:rtype-changed", rtype)` 广播。唯一落盘入口。
- **`bus.ts` `repo:rtype-changed` 事件** — 运行期类型变更唯一入口；`useCurrentResourceType` 订阅此事件。
- **`utils/dom/storage.ts` `safeGet`** — localStorage 安全读取（隐私模式下降级兜底）。
- **`utils/resource/types.ts` `RESOURCE_TYPES`** — 资源类型常量（YSM / EntityPlayer / vrm / resourcepack 等）。
- **消费方**：`features/community/download-queue.ts`（下载落库 GetRepoRoot）、`features/import-executor.ts`（importWebFiles 类型参数）、`views/app-sidebar/events.ts`（侧边栏选中状态 key）、`views/app-sidebar/index.ts`（组件 rtype 属性）、`views/app-sidebar/render.ts`（实例 rtype 兜底）、`views/app-tree/toolbar-events.ts`（导入文件夹 GetRepoRoot）、`views/app-content/diagnostics/health.ts`（诊断扫描根目录）、`backend/web-fs-auth.ts`（web 导入类型参数）、`features/community/show-repo-models.ts`（GitHub 页扫描目标类型）。

## 不变量

- **localStorage 权威源**：`repo_rtype` 由 app-nav 切换器唯一写入，禁止其他模块直接 `safeSet("repo_rtype", ...)`。
- **运行期变更唯一入口**：`repo:rtype-changed` 事件；直接读 localStorage 会错过运行期切换（如 app-nav 切换器已广播但 localStorage 尚未刷新的窗口）。
- **同值去重**：`useCurrentResourceType` 仅在 `rt !== currentType` 时触发 onChange，避免重复加载。
- **cleanup 必调**：组件销毁时必须调 `cleanup()` 移除订阅，防迟到响应/内存泄漏。
- **缺省 YSM**：localStorage 无值时 `currentRepoType()` 返回 `RESOURCE_TYPES.YSM`，与 app-nav 切换器初值一致。

## 相关

- `docs/knowledge/app-sync-manager.md`（同步状态主键 repo_rtype）
- `docs/knowledge/go-ts-golden.md`（resource_types.json 单一事实源）
