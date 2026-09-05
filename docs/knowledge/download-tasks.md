---
kind: download-tasks
name: 下载任务执行层 download-tasks
tier: leaf
category: feature
source_files:
  - frontend/src/features/community/download-tasks.ts
  - frontend/src/features/community/download-queue-store.ts
  - frontend/src/features/community/download-queue.ts
auto_fields:
  symbols_with_lines:
    - buildDownloadTasks
    - cancelDownloads
    - classifyDownloadSize
    - createDownloadQueue
    - DOWNLOAD_CONFIRM_BYTES
    - DOWNLOAD_REJECT_BYTES
    - DownloadCandidate
    - DownloadQueue
    - DownloadSizeDecision
    - DownloadState
    - DownloadTask
    - enqueueDownloads
    - getState
    - getStateSnapshot
    - isActiveStatus
    - notify
    - QueueController
    - QueueControllerOptions
    - QueueError
    - resume
    - STATE
    - subscribe
quick_groups:
  - 创意工坊下载
quick_intents:
  - buildDownloadTasks 任务构建
  - classifyDownloadSize 大小策略
  - DOWNLOAD_CONFIRM_BYTES 确认阈值
  - DOWNLOAD_REJECT_BYTES 拒绝阈值
pitfalls:
  - 4MB 确认 / 10MB 拒绝 双阈值策略（含边界值本身需确认）
  - NaN / ±Infinity 大小一律 reject（数值守卫范式，防误判 ok 直接下载）
  - m.size 哨兵 -1 处理：Content-Length=-1 → size 置 0（P4 修复：|| 0 会把 -1 当真值）
  - saveDir 留空：由 download-queue-store enqueueDownloads 从根反解 webType 写入
use_when:
  - 下载任务构建
  - 下载大小策略
  - 选中集转下载任务
  - 社区下载前置决策
status: active
---

# 下载任务执行层 download-tasks

## 概览

创意工坊下载任务构建 + 大小策略纯函数层。自 `community/events.ts` 抽出：下载大小决策（4MB 确认 / 10MB 拒绝）与选中集 → 下载任务列表的构建逻辑，供单测覆盖（ADR-023 L3）。与 `download-queue-store.ts` 协作：本模块产出 `DownloadTask[]` 供 `enqueueDownloads` 消费。

## 核心职责

- **`classifyDownloadSize(size: number): DownloadSizeDecision`** — 下载大小策略：≤4MB 直接下；4–10MB 需确认；>10MB 拒绝。数值守卫：NaN / ±Infinity 一律 `reject`（防误判 `ok` 直接下载）。
- **`buildDownloadTasks(models, selectedNames, dlPrefix): DownloadTask[]`** — 选中集 → 下载任务列表：路径统一转正斜杠；未匹配的选中项静默跳过；size 哨兵处理（Content-Length=-1 → 0）。
- **`DOWNLOAD_CONFIRM_BYTES` / `DOWNLOAD_REJECT_BYTES`** — 阈值常量（4MB / 10MB）。

## 对外 API / 入口

- `classifyDownloadSize(size: number): "ok" | "confirm" | "reject"` — 下载大小策略判定
- `buildDownloadTasks(models: DownloadCandidate[], selectedNames: Iterable<string>, dlPrefix: string): DownloadTask[]` — 选中集 → 下载任务列表
- `DOWNLOAD_CONFIRM_BYTES: number`（4MB）
- `DOWNLOAD_REJECT_BYTES: number`（10MB）
- `DownloadCandidate` / `DownloadSizeDecision` 类型

## 与其他子系统关系

- **`features/community/download-queue-store.ts`** — 消费 `DownloadTask[]`（`enqueueDownloads` 入队；`saveDir` 留空由 `enqueueDownloads` 从根反解 webType 写入）。
- **`features/community/download-queue.ts`** — UI 控制器：调用 `buildDownloadTasks` 构建任务 → 调 `enqueueDownloads` 入队；按 `classifyDownloadSize` 决策弹确认 / 拒绝。
- **`features/community/events.ts`** — 原驻点：大小决策 + 任务构建逻辑已下沉本模块。

## 不变量

- **4MB / 10MB 双阈值**：含边界值本身需确认（`size > DOWNLOAD_CONFIRM_BYTES` → confirm；`size > DOWNLOAD_REJECT_BYTES` → reject）。
- **数值守卫**：`NaN` / `±Infinity` 一律 `reject`（AGENTS.md §3.4 数值守卫范式）。
- **size 哨兵处理**：`Content-Length=-1` → `size` 置 0（P4 修复：`m.size || 0` 会把 -1 当真值原样写入）。
- **路径统一转正斜杠**：`m.path.replace(/\\/g, "/")`（跨平台兼容）。
- **未匹配选中项静默跳过**：`models.find` 返回 undefined 时 filter 剔除。

## 相关

- `docs/knowledge/go-download.md`（Go 端下载实现）
- `docs/knowledge/download-queue-store.md`（状态层 / 入队）
- `docs/knowledge/community-virtual-list.md`（虚拟滚动列表）
