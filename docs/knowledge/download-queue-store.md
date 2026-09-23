---
kind: download-queue-store
name: 下载队列状态机 download-queue-store
tier: architecture
category: feature
source_files:
  - frontend/src/features/community/download-queue-store.ts
  - frontend/src/features/community/download-queue.ts
  - frontend/src/features/community/download-queue-progress.ts
  - frontend/src/features/community/download-queue-web.ts
  - frontend/src/features/community/download-tasks.ts
  - frontend/src/backend/runtime.ts
auto_fields:
  symbols_with_lines:
    - addQueueError
    - buildDownloadTasks
    - cancelDownloads
    - classifyDownloadSize
    - createDownloadQueue
    - createProgressGuard
    - decrementRemaining
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
    - markCurrentFile
    - ProgressGuard
    - ProgressGuardHooks
    - QueueController
    - QueueControllerOptions
    - QueueError
    - resetProgress
    - resume
    - rollbackToIdle
    - runWebEnqueue
    - subscribe
    - WebEnqueueCtx
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
  - isActiveStatus 必须同时认 "downloading" 和 "enqueued"（Go 端入队后只发 enqueued，从不发 downloading）；UI 控制器 run/ended 分支同样走 isActiveStatus，勿再裸比较单字符串（2026-09 修复：idle→enqueued 直跳曾跳过 run 分支致按钮不 disable）
  - remaining 所有权归 Go file-start 载荷（pos/left 语义，queue.go:254——末文件 left=0），**前端 file-done 禁止本地递减**：递减会在「本文件 done → 下一文件 start」窗口造成假归零，completeTimer `remaining>0` 守卫被击穿 → 批次中途假完成提前收口（2026-09 实证证伪「死代码」推断的教训）；done/cancelled 事件前端强制 remaining=0 仅限收口清残值
  - 队列收口 onAllDone 载荷的 errorList 必须是 getStateSnapshot 拷贝（与 onTimedCompletion 路径防御级对齐），活体引用会静默污染 STATE
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
  - frontend/src/features/community/download-queue.ts|gh-queue-error-wrap
status: active
---

# 下载队列状态机 download-queue-store

## 概览

创意工坊批量下载队列的状态层（模块级 Store）。ADR-040 ≤400 行红线拆分产物：自 `download-queue.ts`（原超长文件）拆出，类型 / STATE / Go 调用 / 后端事件注册全部内聚于此。v2：模块级持久层——`Events.On` 在脚本加载时注册一次，页面切换不丢失事件。ADR-208 D2 二次拆分：网页版 fetch→IDB/直链兜底入队分支拆至 `download-queue-web.ts`（经 ctx 注入本模块写函数保持单一写入纪律 + 零运行时环）。

ADR-039 §2.2 Events.On 豁免：模块顶层注册 4 组 Wails Events.On（`queue:status` / `queue:file-start` / `queue:file-done` / `download:progress`），无对应 `Events.Off` 退出路径；认定为 app 级单例豁免（`_registered` 布尔守卫防重复注册）。

## 核心职责

- **`STATE: DownloadState`** — 模块级共享状态（status / total / remaining / currentFile / progress / errorList / _lastDone / _lastDoneSeq）。`getStateSnapshot()` 返回只读深拷贝（progress / _lastDone 新对象，errorList 数组壳与 QueueError 元素均逐一拷贝——802deb2d1 元素级修复）；`notify()` 广播变更。
- **`DownloadTask`** — 下载任务接口（url / saveDir / name / size）。
- **`QueueError`** — 队列错误项（name / err）。
- **`DownloadState`** — 队列状态快照接口。
- **`subscribe(fn) / notify()`** — 订阅 / 广播 STATE 变更。
- **`getStateSnapshot(): Readonly<DownloadState>`** — 当前状态只读快照（拉取模型，深拷贝：progress / _lastDone 新对象，errorList 数组壳与元素逐一拷贝，修改快照不污染 STATE）。
- **`resume()`** — 页面切回时从 Go 端恢复当前队列状态（`QueueStatus` binding 调用）。
- **`isActiveStatus(s)`** — 队列是否处于活跃下载（同时认 `downloading` 和 `enqueued`，P1 修复：Go 端入队后只发 `enqueued`，从不发 `downloading`）。
- **`enqueueDownloads(tasks: DownloadTask[])`** — 模块级入队（纯 Go 调用，不涉及 DOM）；web 分支委托 `download-queue-web.ts`（IndexedDB 入库 + 50MB 超限回退浏览器直链 + 15s fetch 超时兜底，经 `markCurrentFile` / `decrementRemaining` / `addQueueError` / `rollbackToIdle` 写函数注入）；Go 分支调 `EnqueueDownloads`。
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
- **`features/community/download-queue-web.ts`** — 网页版下载入库分支（ADR-208 D2 拆出）：`runWebEnqueue(tasks, ctx)`；对 store 零运行时依赖（`DownloadTask` 仅 type-only，ctx 注入写函数——check-circular 防环设计）。
- **`features/community/download-tasks.ts`** — 下载任务构建层：`buildDownloadTasks` 产出 `DownloadTask[]` 供 `enqueueDownloads` 消费。
- **`backend/runtime.ts` `Events`** — Wails 事件抽象层；本模块顶层注册 4 组 `Events.On`。
- **`backend/app.ts` `getApp()`** — 获取类型化绑定（`EnqueueDownloads` / `CancelQueue` / `QueueStatus` / `CachedCreatorAvatar` / `DebugExtractCreatorAvatar`）。
- **`backend/browser-adapter.ts` `importWebFiles`** — web 下载分支：fetch → File → importWebFiles 落库。
- **`backend/platform-web.ts` `isWebPlatform`** — web 下载分支判定。
- **`utils/dom/toast-ms.ts`** — 下载完成 toast 时长。
- **`bus.ts`** — `toast:show` / `tree:reload` / `stats:refresh` / `avatar:refresh` 广播。

## 不变量

- **app 级单例豁免**：`_registered` 布尔守卫防重复注册；禁止非 app 级模块复制此模式。
- **isActiveStatus 双状态**：必须同时认 `downloading` 和 `enqueued`（P1 修复：Go 端入队后只发 `enqueued`）。UI 控制器（download-queue.ts）status 分支的 run/ended 判定同走 `isActiveStatus`，杜绝「idle→enqueued 直跳漏初始化 / enqueued→idle 回滚漏清理」。
- **remaining 单一事实源**：`STATE.remaining` 只镜像 Go `queue:file-start` 载荷的 left（末文件为 0），file-done handler **不本地递减**（递减会造成批次窗口假归零，击穿 progress.ts completeTimer 的 `remaining>0` 守卫 → 提前假完成）；`queue:status` done/cancelled handler 强制归零清残值。
- **收口载荷快照化**：`cmDqHandleQueueEnded` 向 `onAllDone` 传 `getStateSnapshot().errorList`（非 notify 活体引用），与 `onTimedCompletion` 路径防御级对齐——消费者改写不得污染 STATE。
- **web 下载 50MB 上限**：`download-queue-web.ts` 的 `WEB_DOWNLOAD_IDB_LIMIT`（与 `web-common` 的 `DetectContainerType` 同款量级守卫）；超限回退浏览器直链。
- **fetch 15s 超时兜底**：`download-queue-web.ts` 的 `WEB_DOWNLOAD_FETCH_TIMEOUT_MS`（防挂起服务器永久卡队列）。
- **getStateSnapshot 只读**：调用方应只读快照、不可修改——修改会绕过通知链路。深拷贝（progress / _lastDone 新对象，errorList 元素逐一拷贝）使「只读快照」从君子协定变真保证；快照独立性回归护栏见 `download-queue.test.ts` 的「getStateSnapshot 快照独立性」describe（5 用例：progress / errorList push / errorList 元素级 / _lastDone 各路径）。
- **enqueue 失败回滚 idle**：模块级函数失败也回滚 `STATE.status = idle`，防永久卡 downloading。
- **事件 payload 守卫**（P3 审计修复）：v3 事件 data 应为非空数组，非数组 / 空数组视为畸形直接丢弃。
- **头像提取串行化**：`_avatarChain` Promise 链限并发 1；同一作者在途去重（`_avatarInFlight` Set）。
- **进度边界守卫**：非法数值（NaN / ±Infinity / 负数）归一为 0（防 "NaNMB" 幽灵数值）。
- **错误摘要容器结构**（`download-queue.ts|gh-queue-error-wrap`）：队列结束的错误摘要嵌套在单一 `.gh-queue-error-wrap` 容器内；`#gh-queue-status` 显示摘要时直接子节点唯一，旧进度行由 `replaceChildren` 清掉——结构护栏钉在 `download-queue-ui.test.ts` 的「done + 错误列表」「cancelled」两用例。

## 相关

- `docs/knowledge/go-download.md`（Go 端下载实现）
- `docs/knowledge/download-tasks.md`（任务构建层）
- `docs/knowledge/backend-idb.md`（IndexedDB 入库）
- `docs/knowledge/wails-bridge.md`（Wails 事件抽象）
