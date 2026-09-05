---
kind: download-queue-store
name: 下载队列状态机 download-queue-store
tier: architecture
category: feature
source_files:
  - frontend/src/features/community/download-queue-store.ts
  - frontend/src/features/community/download-queue.ts
  - frontend/src/features/community/download-queue-progress.ts
  - frontend/src/features/community/download-tasks.ts
  - frontend/src/backend/runtime.ts
auto_fields:
  symbols_with_lines:
    - buildDownloadTasks
    - cancelDownloads
    - classifyDownloadSize
    - createDownloadQueue
    - createProgressGuard
    - DOWNLOAD_CONFIRM_BYTES
    - DOWNLOAD_REJECT_BYTES
    - DownloadCandidate
    - DownloadQueue
    - DownloadSizeDecision
    - DownloadState
    - DownloadTask
    - enqueueDownloads
    - Events
    - getState
    - getStateSnapshot
    - isActiveStatus
    - notify
    - ProgressGuard
    - ProgressGuardHooks
    - QueueController
    - QueueControllerOptions
    - QueueError
    - resume
    - STATE
    - subscribe
    - Window
tests:
  - frontend/src/backend/runtime.test.ts
  - frontend/src/features/community/download-queue.test.ts
  - frontend/src/features/community/download-queue-ui.test.ts
  - frontend/src/features/community/download-tasks.test.ts
quick_groups:
  - 创意工坊下载
quick_intents:
  - DownloadState 队列状态
  - DownloadTask 下载任务
  - enqueueDownloads 入队
  - cancelDownloads 取消
  - Wails 事件订阅
pitfalls:
  - ADR-039 §2.2 Events.On 豁免：模块顶层注册 4 组 Wails Events.On 无对应 Off（app 级单例，_registered 守卫防重复注册）
  - 非 app 级模块禁止复制此模式
  - isActiveStatus 必须同时认 "downloading" 和 "enqueued"（Go 端入队后只发 enqueued，从不发 downloading）
  - web 下载入库上限 50MB（WEB_DOWNLOAD_IDB_LIMIT），超限回退浏览器直链
  - fetch 15s 超时兜底（WEB_DOWNLOAD_FETCH_TIMEOUT_MS），防挂起服务器永久卡队列
use_when:
  - 下载队列状态
  - 入队 / 取消 / 恢复
  - Wails 进度事件
  - 社区下载状态层
invariant_anchors:
  - frontend/src/features/community/download-queue-store.ts|STATE
  - frontend/src/features/community/download-queue-store.ts|DownloadTask
  - frontend/src/features/community/download-queue-store.ts|DownloadState
  - frontend/src/features/community/download-queue-store.ts|enqueueDownloads
  - frontend/src/features/community/download-queue-store.ts|cancelDownloads
  - frontend/src/features/community/download-queue-store.ts|subscribe
  - frontend/src/features/community/download-queue-store.ts|getStateSnapshot
status: active
---

# 下载队列状态机 download-queue-store

## 概览

创意工坊批量下载队列的状态层（模块级 Store）。ADR-040 ≤400 行红线拆分产物：自 `download-queue.ts`（原超长文件）拆出，类型 / STATE / Go 调用 / 后端事件注册全部内聚于此。v2：模块级持久层——`Events.On` 在脚本加载时注册一次，页面切换不丢失事件。

ADR-039 §2.2 Events.On 豁免：模块顶层注册 4 组 Wails Events.On（`queue:status` / `queue:file-start` / `queue:file-done` / `download:progress`），无对应 `Events.Off` 退出路径；认定为 app 级单例豁免（`_registered` 布尔守卫防重复注册）。

## 核心职责

- **`STATE: DownloadState`** — 模块级共享状态（status / total / remaining / currentFile / progress / errorList / _lastDone / _lastDoneSeq）。`getStateSnapshot()` 返回只读浅拷贝；`notify()` 广播变更。
- **`DownloadTask`** — 下载任务接口（url / saveDir / name / size）。
- **`QueueError`** — 队列错误项（name / err）。
- **`DownloadState`** — 队列状态快照接口。
- **`subscribe(fn) / notify()`** — 订阅 / 广播 STATE 变更。
- **`getStateSnapshot(): Readonly<DownloadState>`** — 当前状态只读快照（拉取模型，返回独立引用）。
- **`resume()`** — 页面切回时从 Go 端恢复当前队列状态（`QueueStatus` binding 调用）。
- **`isActiveStatus(s)`** — 队列是否处于活跃下载（同时认 `downloading` 和 `enqueued`，P1 修复：Go 端入队后只发 `enqueued`，从不发 `downloading`）。
- **`enqueueDownloads(tasks: DownloadTask[])`** — 模块级入队（纯 Go 调用，不涉及 DOM）；web 下载分支走 IndexedDB 入库 + 50MB 超限回退浏览器直链 + 15s fetch 超时兜底；Go 分支调 `EnqueueDownloads`。
- **`cancelDownloads()`** — 模块级取消（`CancelQueue` binding 调用）。
- **Wails 事件注册** — 4 组事件：`queue:status`（状态变更）、`queue:file-start`（文件开始）、`queue:file-done`（文件完成 + 增量提取创作者头像）、`download:progress`（进度回调）。
- **创作者头像增量提取**（`queue:file-done` handler）：`.ysm` 成功时经 `_avatarChain` Promise 链限并发 1，串行执行 `DebugExtractCreatorAvatar`（作者去重防重复排队）。

## 对外 API / 入口

- `STATE: DownloadState` — 模块级共享状态（progress guard / UI 控制器 import 协作，不对外 re-export）
- `DownloadTask` / `QueueError` / `DownloadState` — 类型（`download-queue.ts` re-export 保公共面）
- `subscribe(fn: (s: DownloadState) => void): () => void` — 订阅 STATE 变更
- `notify(): void` — 广播 STATE 变更
- `getStateSnapshot(): Readonly<DownloadState>` — 当前状态只读快照
- `getState(): DownloadState` — 兼容别名（deprecated）
- `resume(): Promise<void>` — 页面切回恢复状态
- `isActiveStatus(s: DownloadState): boolean` — 活跃下载判定
- `enqueueDownloads(tasks: DownloadTask[]): Promise<void>` — 模块级入队
- `cancelDownloads(): Promise<void>` — 模块级取消

## 与其他子系统关系

- **`features/community/download-queue.ts`** — UI 控制器：re-export `DownloadState` / `DownloadTask` / `QueueError`；消费 `enqueueDownloads` / `cancelDownloads` / `subscribe`；`createDownloadQueue` 对外暴露。
- **`features/community/download-queue-progress.ts`** — 99% 卡进度守卫状态机：消费 `STATE` / `isActiveStatus`。
- **`features/community/download-tasks.ts`** — 下载任务构建层：`buildDownloadTasks` 产出 `DownloadTask[]` 供 `enqueueDownloads` 消费。
- **`backend/runtime.ts` `Events`** — Wails 事件抽象层；本模块顶层注册 4 组 `Events.On`。
- **`backend/app.ts` `getApp()`** — 获取类型化绑定（`EnqueueDownloads` / `CancelQueue` / `QueueStatus` / `CachedCreatorAvatar` / `DebugExtractCreatorAvatar`）。
- **`backend/browser-adapter.ts` `importWebFiles`** — web 下载分支：fetch → File → importWebFiles 落库。
- **`backend/platform-web.ts` `isWebPlatform`** — web 下载分支判定。
- **`utils/dom/toast-ms.ts`** — 下载完成 toast 时长。
- **`bus.ts`** — `toast:show` / `tree:reload` / `stats:refresh` / `avatar:refresh` 广播。

## 不变量

- **app 级单例豁免**：`_registered` 布尔守卫防重复注册；禁止非 app 级模块复制此模式。
- **isActiveStatus 双状态**：必须同时认 `downloading` 和 `enqueued`（P1 修复：Go 端入队后只发 `enqueued`）。
- **web 下载 50MB 上限**：`WEB_DOWNLOAD_IDB_LIMIT`（与 `web-common` 的 `DetectContainerType` 同款量级守卫）；超限回退浏览器直链。
- **fetch 15s 超时兜底**：`WEB_DOWNLOAD_FETCH_TIMEOUT_MS`（防挂起服务器永久卡队列）。
- **getStateSnapshot 只读**：调用方应只读快照、不可修改——修改会绕过通知链路。
- **enqueue 失败回滚 idle**：模块级函数失败也回滚 `STATE.status = idle`，防永久卡 downloading。
- **事件 payload 守卫**（P3 审计修复）：v3 事件 data 应为非空数组，非数组 / 空数组视为畸形直接丢弃。
- **头像提取串行化**：`_avatarChain` Promise 链限并发 1；同一作者在途去重（`_avatarInFlight` Set）。
- **进度边界守卫**：非法数值（NaN / ±Infinity / 负数）归一为 0（防 "NaNMB" 幽灵数值）。

## 相关

- `docs/knowledge/go-download.md`（Go 端下载实现）
- `docs/knowledge/download-tasks.md`（任务构建层）
- `docs/knowledge/backend-idb.md`（IndexedDB 入库）
- `docs/knowledge/wails-bridge.md`（Wails 事件抽象）
