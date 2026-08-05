---
kind: community_feature
name: 社区下载 community
tier: architecture
category: feature
source_files:
  - frontend/src/features/community/data.ts
  - frontend/src/features/community/download-queue.ts
  - frontend/src/features/community/events.ts
  - frontend/src/features/community/render.ts
use_when:
  - 创意工坊
  - 社区
  - 下载队列
  - 镜像源
  - 批量下载
  - github 仓库
  - 下载进度
  - workshop
---

# 社区下载 community

## 概览

`features/community/` 是创意工坊（GitHub 模型仓库）浏览与批量下载的前端业务层，四个文件分工：`data.ts` 抓取远端 index.json（多镜像竞速）、`render.ts` 渲染站点卡片与模型列表、`events.ts` 绑定仓库页交互事件、`download-queue.ts` 模块级下载队列状态机 + UI 控制器。下载执行本身在 Go 端队列（go/download），前端通过 Wails 事件接收进度。

## 核心职责

- `data.ts` — `tryFetchModels(repo, mirror, onProgress)`：三镜像（raw.githubusercontent / jsDelivr / api.github）延时并发（首个立即、2s/4s 各补一个）+ `Promise.any` 取最快成功；单请求 8s `AbortController` 超时；任一 404 即置 `_earlyExitReason = "NoIndex"` 中止全部；全败时诊断根因抛 `NoIndex`/`RateLimited`/`NetworkOffline`/`AllFailed`。`showProgress` 渲染抓取进度条
- `render.ts` — `isModelMissing`/`countMissing`（按 hash 或名称比对本地 `localMap`）、`renderModelList`（DOM API 构建行，非字符串拼接）、`renderCardsHTML`（站点卡片按 search/repo/browse 分组）、`renderRepoHeaderHTML`（仓库页头部）
- `events.ts` — `bindRepoEvents(sr, ctx)`：内部维护 `showAll`/`selectedSet`，返回 `{ renderList, updateSelectedUI, cleanup }`；三个下载入口（单行下载按钮 `handleSingleDownload`、「下载选中」按钮、全选后「下载选中」）全部汇入 `queue.enqueue(tasks)`；单文件 >10MB 拒载、>4MB `modalConfirm` 确认；右键行 → `bus.emit("menu:show")` 展示索引信息；B 站搜索作者走 `OpenInBrowser`
- `download-queue.ts` — 双层结构：
  - 模块级持久层：`STATE`（status/total/remaining/currentFile/progress/errorList/_lastDone/_lastDoneSeq）+ `subscribe`/`getState`/`resume`/`enqueueDownloads`/`cancelDownloads`；脚本加载时一次性 `Events.On` 注册 `queue:status`、`queue:file-start`、`queue:file-done`、`download:progress`（`_registered` 守卫，页面切换不丢事件，致命陷阱 #7 的解法）；`.ysm` 下载成功后异步提取创作者头像并广播 `avatar:refresh`
  - UI 层 `createDownloadQueue(options)`：订阅 STATE 渲染 `#gh-queue-status` 进度行；`stuckGuardReset()` 集中清理定时器；99% 卡死守护——小文件/大文件进度从 <10% 直跳 ≥99% 时锁定 99%，2s 后转「⏳…」菊花动画，`file-done` 到达强制覆盖为 100%；队列结束经 `cleanupProgressUI` 统一恢复按钮、发 `tree:reload` + `stats:refresh`、清 `ClearScanCache`

## 对外 API / 入口

- 导出：`showProgress`、`tryFetchModels`、`FetchModelsResult`（data.ts）；`isModelMissing`、`countMissing`、`renderModelList`、`renderCardsHTML`、`renderRepoHeaderHTML`、`GROUP_LABELS`、`WorkshopModel`、`WorkshopSite`（render.ts）；`bindRepoEvents`、`RepoEventsContext`、`RepoEventsHandle`（events.ts）；`subscribe`、`getState`、`resume`、`enqueueDownloads`、`cancelDownloads`、`createDownloadQueue`、`DownloadTask`、`DownloadState`、`QueueController`（download-queue.ts）
- 监听 bus：无（UI 层经 `subscribe` 订阅 STATE）
- 派发 bus：`toast:show`、`tree:reload`、`stats:refresh`、`avatar:refresh`、`menu:show`
- Wails EventsOn（@wailsio/runtime，模块顶层注册一次）：`queue:status`、`queue:file-start`、`queue:file-done`、`download:progress`
- getApp() / binding 调用：`EnqueueDownloads`、`CancelQueue`、`QueueStatus`、`LoadAppConfig`、`GetRepoRoot`、`ClearScanCache`、`CachedCreatorAvatar`、`DebugExtractCreatorAvatar`、`OpenInBrowser`

## 与其他子系统关系

- 由 [app_content](./app_content.md) 的 workshop/github 视图初始化；视图销毁时调 `cleanup()`（cancel 队列 + `queue.destroy()` 退订 STATE）
- 下载执行后端见 [go_download](./go_download.md)；入队后的文件安装见 [go_installer](./go_installer.md)
- 头像提取联动见 [go_avatar](./go_avatar.md)（`avatar:refresh` 消费方在 app-content/app-tree）
- 下载完成发 `tree:reload`/`stats:refresh` 联动 [app_tree](./app_tree.md)；确认弹窗走 [dialog_modal](./dialog_modal.md)

## 不变量

- Wails `Events.On` 只在模块顶层注册一次，由 `_registered` 布尔守卫保护（致命陷阱 #7：三入口共用一组事件，禁止在视图内重复注册）
- `STATE.status === "downloading"` 时 `enqueueDownloads`/`enqueue` 直接返回，防止并发双队列
- 三个下载入口（单击/多选/全选）统一走 `queue.enqueue` → 模块级 `enqueueDownloads` → `EnqueueDownloads` binding，事件监听只有一组
- `enqueue` 内 Go 入队失败必须回滚 `STATE.status = "idle"` + `notify()` + `cleanupProgressUI()`，防按钮/进度条卡死（致命陷阱 #3）
- 99% 卡死守护：`_lastPct < 10` 直跳 ≥99% 视为可疑，锁 99% 并起 `_stuckTimer`（2s 后转菊花）；所有定时器必须经 `stuckGuardReset()` 清理
- `createDownloadQueue` 返回的 `destroy` 即 `subscribe` 的退订函数，视图销毁必须调用，防僵尸回调累积
- `menu:show` 传原文，转义职责归 context-menu 组件（二次 esc 会出现 `&amp;`）

## 相关

- [go_download](./go_download.md) — 后端下载队列与事件发射
- [app_content](./app_content.md) — workshop/github 页面宿主
- [go_avatar](./go_avatar.md) — 创作者头像提取与缓存
- [context_menu](./context_menu.md) — 右键信息展示
