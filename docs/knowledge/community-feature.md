---
kind: community-feature
name: 社区下载 community
tier: architecture
category: feature
source_files:
  - frontend/src/features/community/data.ts
  - frontend/src/features/community/download-queue.ts
  - frontend/src/features/community/events.ts
  - frontend/src/features/community/render.ts
tests:
  - frontend/src/features/community/data.test.ts
  - frontend/src/features/community/download-queue.test.ts
  - frontend/src/views/app-tree/data.test.ts
  - frontend/src/views/app-tree/render.test.ts
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
- `events.ts` — `bindRepoEvents(sr, ctx)`：内部维护 `showAll`/`selectedSet`，返回 `{ renderList, updateSelectedUI, cleanup }`；三个下载入口（单行下载按钮 `handleSingleDownload`、「下载选中」按钮、全选后「下载选中」）全部汇入 `queue.enqueue(tasks)`；单文件 >10MB 拒载、>4MB `modalConfirm` 确认；右键行 → `bus.emit("menu:show")` 展示索引信息；B 站搜索作者走 `parseModelName` 取作者 + `OpenInBrowser`（`parseModelName` 已由动态导入改为顶层静态导入，提交 7bb9f7c）
- `download-queue.ts` — 双层结构：
  - 模块级持久层：`STATE`（status/total/remaining/currentFile/progress/errorList/_lastDone/_lastDoneSeq）+ `subscribe`/`getState`/`resume`/`enqueueDownloads`/`cancelDownloads`；脚本加载时一次性 `Events.On` 注册 `queue:status`、`queue:file-start`、`queue:file-done`、`download:progress`（`_registered` 守卫，页面切换不丢事件，致命陷阱 #7 的解法）；`.ysm` 下载成功且文件名含 `[作者]` 前缀时，异步 `CachedCreatorAvatar` →（未命中则 `DebugExtractCreatorAvatar` 后重取）→ 广播 `avatar:refresh`
  - `resume()`：切回页面时调 `QueueStatus()` 恢复状态，对 Wails 多返回值的三种映射形态（数组 / `{Remaining,Running}` 对象 / 裸数字）都做兜底解析，仅在 `running` 为真时把 STATE 置回 `downloading`
  - UI 层 `createDownloadQueue(options)`：订阅 STATE 渲染 `#gh-queue-status` 进度行；`stuckGuardReset()` 集中清理定时器；`file-done` 到达时强制把卡在 `99%` 的进度覆盖为 100%；队列结束经 `cleanupProgressUI` 统一恢复按钮、发 `tree:reload` + `stats:refresh`、清 `ClearScanCache`
  - 99% 卡死守护分两档：小文件（`total ≤ 100KB`）从 `<10%` 直跳 `≥99%` → 锁 99%，**300ms** 后补写 100%；大文件（`total > 1MB`）同样条件 → 锁 99%，**2s** 后转「⏳…」菊花动画（`_dotTimer` 每 400ms 加一个点）
  - `enqueue()` 先 `GetRepoRoot(RESOURCE_TYPES.YSM)` 取仓库根目录并写入每个 task 的 `saveDir`，取不到则 toast「请先配置仓库目录」并中止

## 对外 API / 入口

- 导出：`showProgress`、`tryFetchModels`、`FetchModelsResult`（data.ts）；`isModelMissing`、`countMissing`、`renderModelList`、`renderCardsHTML`、`renderRepoHeaderHTML`、`WorkshopModel`、`WorkshopSite`（render.ts；`GROUP_LABELS` 是模块内私有常量，未导出）；`bindRepoEvents`、`RepoEventsContext`、`RepoEventsHandle`（events.ts）；`subscribe`、`getState`、`resume`、`enqueueDownloads`、`cancelDownloads`、`createDownloadQueue`、`DownloadTask`、`QueueError`、`DownloadState`、`QueueControllerOptions`、`QueueController`（download-queue.ts）
- 监听 bus：无（UI 层经 `subscribe` 订阅 STATE）
- 派发 bus：`toast:show`、`tree:reload`、`stats:refresh`、`avatar:refresh`、`menu:show`
- Wails `Events.On`（@wailsio/runtime，模块顶层注册一次；v3 payload 为 `{ data: unknown[] }`，多参在 Go Emit 侧打包为数组）：`queue:status`、`queue:file-start`、`queue:file-done`、`download:progress`
- getApp() / binding 调用：`EnqueueDownloads`、`CancelQueue`、`QueueStatus`、`GetRepoRoot`、`ClearScanCache`、`CachedCreatorAvatar`、`DebugExtractCreatorAvatar`、`OpenInBrowser`

## 与其他子系统关系

- 由 [app_content](./app-content.md) 的 workshop/github 视图初始化；视图销毁时调 `cleanup()`（cancel 队列 + `queue.destroy()` 退订 STATE）
- 下载执行后端见 [go_download](./go-download.md)；入队后的文件安装见 [go_installer](./go-installer.md)
- 头像提取联动见 [go_avatar](./go-avatar.md)（`avatar:refresh` 消费方在 app-content/app-tree）
- 下载完成发 `tree:reload`/`stats:refresh` 联动 [app_tree](./app-tree.md)；确认弹窗走 [dialog_modal](./dialog-modal.md)

## 不变量

- Wails `Events.On` 只在模块顶层注册一次，由 `_registered` 布尔守卫保护（致命陷阱 #7：三入口共用一组事件，禁止在视图内重复注册）
- **ADR-039 §2.2 Events.On 豁免**（提交 bbe5fad，文件头有显式声明块）：这 4 组监听无对应 `Events.Off` 退出路径，按「app 级常驻单例」豁免（生命周期等同应用，与 `registerErrorDiary` / matchMedia 监听同类）。非 app 级模块禁止复制此模式；若社区页将来支持卸载/热重载，必须补 `Events.Off`
- `STATE.status === "downloading"` 时 `enqueueDownloads`/`enqueue` 直接返回，防止并发双队列
- 三个下载入口（单击/多选/全选）统一走 `queue.enqueue` → 模块级 `enqueueDownloads` → `EnqueueDownloads` binding，事件监听只有一组
- **DOM 事件监听器清理模式**（审计发现）：`events.ts` 的 `bindEvents` 向容器元素注册了 7 个 DOM 事件监听器（click/change/contextmenu/input），`externalCleanup` 必须移除所有监听器。推荐做法：用 `cloneNode(false)` 替换所有绑定元素（`sr.replaceChild(sr.cloneNode(false), sr)`），一次性解除所有事件绑定，比逐个 `removeEventListener` 更可靠（P2）。
- `enqueue` 内 Go 入队失败必须回滚 `STATE.status = "idle"` + `notify()` + `cleanupProgressUI()`，防按钮/进度条卡死（致命陷阱 #3）
- 99% 卡死守护：`_lastPct < 10` 直跳 ≥99% 视为可疑，锁 99% 并起 `_stuckTimer`（小文件 300ms 补 100%，大文件 2s 转菊花）；所有定时器必须经 `stuckGuardReset()` 清理
- 进度为 `Content-Length ≤ 0`（未知长度）时 `pct` 恒置 0、只显示已下载 MB 数，完成判定只信任 `queue:file-done` / `queue:status=done`，不得据进度条推断 100%（致命陷阱 #6）
- **按 `data-name` 反查 DOM 必须用 `CSS.escape(name)`，不能用 `esc()`**（ADR-039 P3，提交 9ea7db9）：`esc()` 产出的 HTML 实体在属性选择器里不会还原，含 `&` 的文件名会匹配失败导致勾选清不掉
- `createDownloadQueue` 返回的 `destroy` 即 `subscribe` 的退订函数，视图销毁必须调用，防僵尸回调累积
- `menu:show` 传原文，转义职责归 context-menu 组件（二次 esc 会出现 `&amp;`）
- 本目录已无动态 `import()`：`parseModelName` 等依赖一律顶层静态导入，禁止回退到 `await import(...)` 或带 `.js` 后缀的路径

## 相关

- [go_download](./go-download.md) — 后端下载队列与事件发射
- [app_content](./app-content.md) — workshop/github 页面宿主
- [go_avatar](./go-avatar.md) — 创作者头像提取与缓存
- [context_menu](./context-menu.md) — 右键信息展示
