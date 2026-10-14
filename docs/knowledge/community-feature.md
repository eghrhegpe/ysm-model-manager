---
kind: community-feature
name: 社区下载 community
tier: architecture
category: feature
source_files:
  - frontend/src/features/community/
  - frontend/src/utils/base/pure/gh-links.ts
auto_fields:
  symbols_with_lines:
    - addQueueError
    - AvatarMap
    - bindRepoEvents
    - buildDownloadTasks
    - buildModelDownloadUrl
    - buildModelRow
    - cancelDownloads
    - classifyDownloadSize
    - clearAllCommunityCache
    - clearAvatars
    - cmReBindBack
    - cmReBindContextMenu
    - cmReBindDlSelected
    - cmReBindRowClick
    - cmReBindSearch
    - cmReBindSelAll
    - cmReBindSelChecks
    - cmReBindToggle
    - CmReCtx
    - cmReListen
    - cmReRenderList
    - CmReState
    - cmReUpdateSelectedUI
    - CommunityData
    - communityGetApp
    - countMissing
    - createDownloadQueue
    - createProgressGuard
    - createVirtualList
    - decrementRemaining
    - DEFAULT_COMMUNITY_URL
    - DOWNLOAD_CONFIRM_BYTES
    - DOWNLOAD_REJECT_BYTES
    - DownloadCandidate
    - DownloadProgressPayload
    - DownloadQueue
    - DownloadSizeDecision
    - DownloadState
    - DownloadTask
    - enqueueDownloads
    - FETCH_MODELS_FAILURES
    - fetchCommunityCreators
    - fetchCommunitySites
    - FetchModelsFailure
    - FetchModelsFailureError
    - fetchModelsFailureKind
    - FetchModelsResult
    - fillSearch
    - filterModels
    - forceRefreshCommunityMerge
    - forceRefreshScanAuthors
    - getAvatar
    - getAvatarSnapshot
    - getState
    - getStateSnapshot
    - GH_DOCS
    - GH_RELEASES
    - GH_REPO
    - GH_ROW_H
    - isActiveStatus
    - isModelMissing
    - ListenerRef
    - loadCommunityData
    - loadLocalAuthors
    - LocalCreator
    - markCurrentFile
    - measureGhRowH
    - mergeCommunityCreators
    - mergeCommunitySites
    - mergeLocalAuthorsInto
    - ModelRowCtx
    - parseEventPayload
    - ProgressGuard
    - ProgressGuardHooks
    - QueueController
    - QueueControllerOptions
    - QueueError
    - QueueFileDonePayload
    - QueueFileStartPayload
    - QueueStatusPayload
    - RepoEventsContext
    - RepoEventsHandle
    - RepoHeaderData
    - RepoTpl
    - resetProgress
    - resume
    - rollbackToIdle
    - runWebEnqueue
    - setAvatar
    - setAvatars
    - showProgress
    - subscribe
    - subscribeAvatars
    - tryFetchModels
    - VIEW_TESTIDS
    - VirtualList
    - VirtualListOpts
    - WebEnqueueCtx
    - WorkshopModel
  tests:
    - frontend/src/features/community/data.test.ts
    - frontend/src/features/community/download-queue.test.ts
    - frontend/src/features/community/download-queue-ui.test.ts
    - frontend/src/features/community/download-tasks.test.ts
    - frontend/src/views/app-tree/data.test.ts
    - frontend/src/views/app-tree/render.test.ts
quick_groups:
  - 文件操作与标签
quick_intents:
  - 创意工坊、社区下载、下载队列
  - 镜像源、批量下载、github 仓库
  - download-queue / download-tasks
quick_risk_lines:
  - 社区下载必须走 community download-queue 排队，禁止各组件各自发下载请求
pitfalls:
  - 各组件各自发下载请求 → 并发冲突、进度丢失；必须经 download-queue 排队
  - 镜像源未走 gh-links → 下载慢、镜像不可用；必须经 gh-links 的 CDN 分流
  - 远程 JSON（GitHub API base64 content）用裸 `JSON.parse(atob(...))` 解码 → atob 产 Latin-1，UTF-8 字节被逐字节当码位，非 ASCII 名落盘成双重编码乱码（2026-09-21 曾把 197 条乱码当新作者入库，按 name 去重失效）；须 base64ToBytes → TextDecoder(UTF-8)

use_when:
  - 创意工坊
  - 社区
  - 下载队列
  - 镜像源
  - 批量下载
  - github 仓库
  - 下载进度
  - workshop
perf:
  - io-bound
invariant_anchors:
  - frontend/src/features/community/download-queue.ts|isActiveStatus
  - frontend/src/features/community/data.ts|Promise.any
  - frontend/src/features/community/community-fetch.ts|fetchWithFallback
status: active
---

# 社区下载 community

## 概览

`features/community/` 是创意工坊（GitHub 模型仓库）浏览与批量下载的前端业务层，多文件分工：`data.ts` 抓取远端 index.json（多镜像竞速）、`render.ts` 渲染仓库模型列表行与表头、`events.ts` 绑定仓库页交互事件、`virtual-list.ts` 定高虚拟滚动、`download-queue.ts`（UI 控制器 + 对外 re-export）与其拆分的 `download-queue-store.ts` / `download-queue-progress.ts`（模块级下载队列状态机 + 99% 卡进度守护，ADR-040 拆分：829 → 360/299/278）。`show-repo-models.ts` 已于 2026-09 死链拆除（god-like envelope 的死字段税；孤儿模块随 init-workshop 注入链退役而删除）。站点/创作者频道卡片渲染不在此目录——归 `views/app-content/site/`（见知识卡 `app-content-site`）。下载执行桌面在 Go 端队列（go/download），前端通过 Wails 事件接收进度；网页版无 Go 队列，web 分支走 fetch→importWebFiles 入 IndexedDB（对齐导入链路），失败/超 50MB 回退 `<a download>` 直链（ADR-123 P1）；单文件 fetch 15s 超时（AbortController，code_review P2），挂起服务器超时亦回退直链、不卡队列（分支级 try/finally 兜底复位 idle）。

## 核心职责

- `data.ts` — `tryFetchModels(repo, mirror, onProgress)`：三镜像（raw.githubusercontent / jsDelivr / api.github）延时并发（首个立即、2s/4s 各补一个）+ `Promise.any` 取最快成功；单请求 8s `AbortController` 超时，**护栏覆盖 headers 与 body 读取全程**（timer/整体取消转播到 `resp.json()` 落定才拆——旧实现 headers 到达即拆，body 卡流时超时与胜者 abort 双双管不到，三路全挂 = 竞速永挂；2026-10-13 收口，护栏用例见 `data.test.ts`「body 读取阶段护栏」）；**仅 raw 源 404 视为确定性 NoIndex 证据**（置 `FetchRaceState.rawNoIndex` 并 abort 整体，jsd/api 404 可能是 CDN 缓存未命中/限流，只记录不误杀在途请求）；全败时经 `summarizeFetchFailures` 类型化分类（404→`NoIndex`、403→`RateLimited`、网络/超时→`NetworkOffline`、其余→`AllFailed`），抛出 `FetchModelsFailureError`（`kind` 判别字段，`message` 保留 token 兼容旧断言形态）——消费者经 `fetchModelsFailureKind` 判别（唯一生产可达点 `views/app-content/init-github.ts` 错误文案映射；`site/edit.ts` 的同名分支经子代理复核判死码已删——其保护区的 `fetchWithFallback` 全败返回 `[]` 从不抛竞速 token），不再散落 `err.message === "NoIndex"` 魔法串对照。`showProgress` 渲染抓取进度条；回收站段条目经 `hasRecycleSegment`（utils/recycle-path.ts）过滤
- `render.ts` — 仓库模型列表渲染（非站点卡片）：`VIEW_TESTIDS`（ADR-133 稳定 testid 声明）、`WorkshopModel`、`isModelMissing`/`countMissing`（按 hash 或名称比对本地 `localMap`；`hashSetOf`/`_hashSetCache` WeakMap 把线性扫描收敛为 O(1) Set 查找，`1cd8e305`）、`filterModels`（关键词 + 仅显缺失，自 events.ts renderList 抽出，ADR-023 L3）、`buildModelRow`（单行构建器，供虚拟列表 `renderItem` 复用）、`renderRepoHeaderHTML`（仓库页头部）；`renderModelList` 已删除、站点卡片渲染已迁 `views/app-content/site/render.ts`（`buildSiteHtml`）
- `events.ts` — `bindRepoEvents(sr, ctx)`：内部维护 `showAll`/`selectedSet`，返回 `{ renderList, updateSelectedUI, cleanup }`；**虚拟滚动接入**：`renderList` 内部经 `createVirtualList` 写入 `#gh-repo-list`（行高经 `measureGhRowH` 探针实测——`.gh-row` 高随 `--fs-scale` 字体缩放主题增长，`GH_ROW_H=42` 仅为无布局环境兜底；jsdom 零高度自动全量回退）；全选逻辑改遍历 `currentFiltered` 筛选结果（虚拟化后 DOM 只含可见行，原"遍历 DOM 勾选"会漏选）；三个下载入口（单行下载按钮 `handleSingleDownload`、「下载选中」按钮、全选后「下载选中」）全部汇入 `queue.enqueue(tasks)`；单文件 >10MB 拒载、>4MB `modalConfirm` 确认；右键行 → `bus.emit("ctx:show")`（type `workshop`，4 条纯展示行 `kind:"header"`——ADR-208 D3 移植 menu-defs 单一事实源，原裸发 `menu:show` 幽灵菜单已杀灭；noop 假动作已退役，表意走 icon 字段、体积走 `utils/format formatBytes`）；B 站搜索作者走 `parseModelName` 取作者 + `OpenInBrowser`（`parseModelName` 已由动态导入改为顶层静态导入，提交 7bb9f7c）
- `virtual-list.ts` — `createVirtualList<T>(opts)`：定高虚拟列表组件（零高度自动全量回退、阈值 60 行以下直接全量、`destroy()` 移除滚动监听）；底层走 `utils/dom/virtual-scroll.ts` 共享原语（`calcVisibleRange` + `installScrollSync`）
- `download-queue.ts` 族（原单文件超 100 行红线，ADR-040 拆为 tasks/store/progress/ui 四件；ADR-208 D2 再拆 web 入队分支至 `download-queue-web.ts`）：
  - **`download-tasks.ts`（独立文件，ADR-044 后拆分）**：`buildDownloadTasks`（下载任务构造，URL 经 `buildModelDownloadUrl` **逐段 encodeURIComponent**——路径含 `#`/`?`/`%` 不再截断（原 P3 观察 ④，2026-10-13 清偿；`render.ts` 单行下载按钮 `data-url` 同走该助手，双出口口径不漂移），`classifyDownloadSize`（`DOWNLOAD_CONFIRM_BYTES` 4MB 确认阈值 / `DOWNLOAD_REJECT_BYTES` 10MB 拒载阈值）
  - **`download-queue-store.ts`（模块级持久层）**：`STATE`（status/total/remaining/currentFile/progress/errorList/_lastDone/_lastDoneSeq）+ `subscribe`/`getState`/`resume`/`enqueueDownloads`/`cancelDownloads`/`isActiveStatus`；脚本加载时一次性 `Events.On` 注册 `queue:status`、`queue:file-start`、`queue:file-done`、`download:progress`（`_registered` 守卫，页面切换不丢事件，致命陷阱 #7 的解法）；`.ysm` 下载成功且文件名含 `[作者]` 前缀时，异步 `CachedCreatorAvatar` →（未命中则 `DebugExtractCreatorAvatar` 后重取）→ 广播 `avatar:refresh`（`_avatarChain` Promise 链串行限并发 1）；`resume()`：切回页面时调 `QueueStatus()` 恢复状态，对 Wails 多返回值的三种映射形态（数组 / `{Remaining,Running}` 对象 / 裸数字）都做兜底解析，仅在 `running` 为真时把 STATE 置回 `downloading`
  - **`download-queue-progress.ts`（99% 卡进度守护）**：`createProgressGuard` 状态机分两档——小文件（`total ≤ 100KB`）从 `<10%` 直跳 `≥99%` → 锁 99%，**300ms** 后补写 100%；大文件（`total > 1MB`）同样条件 → 锁 99%，**2s** 后转「refresh SVG + …」菊花动画（`_dotTimer`/`_dots` 每 400ms 加一个点，**2026-09-20 R8 整改后状态收进守卫闭包 CmPgCtx，不再挂 pctEl DOM 节点自定义属性**；图标位走 `UI_ICONS.refresh`+`innerHTML`，不再是 `⏳` emoji）；`forceFileDone` 在 `file-done` 到达时强制把卡在 99% 的进度覆盖为 100%（fail 显示 `UI_ICONS.error` 并复位锁定），失败汇总行同走 `${UI_ICONS.warning}` 前缀；3s `completeTimer` 收口与队列结束双路互斥（`beginQueueEnded`，防重复 onAllDone/cleanup）；**P3③ 落盘守卫**：`armCompleteTimer` 到点校验 `currentFile && _lastDoneSeq < total`（file-done 未达=落盘在途）→ 有界 re-arm（至多 2 次，总窗 9s）防提前拆 UI；file-done 到达后下一轮即收口，预算耗尽放行保留 done 丢失兜底
  - **`download-queue.ts`（UI 控制器）**：`createDownloadQueue(options)`：订阅 STATE 渲染 `#gh-queue-status` 进度行；`stuckGuardReset()` 集中清理定时器；队列结束经 `cleanupProgressUI` 统一恢复按钮、发 `tree:reload` + `stats:refresh`、清 `ClearScanCache`；**`destroy()` 清理全部定时器**（P2 修复：原仅 unsub——视图销毁后 `_dotTimer` interval 无限自旋、3s `completeTimer` 在死视图上触发副作用；现 `stuckGuardReset()` 集中清 `_stuckTimer`/`_dotTimer`/`completeTimer` 后再退订）；`enqueue()` 先 `GetRepoRoot(currentRepoType())` 取仓库根目录写入每个 task 的 `saveDir`，取不到则 toast「请先配置仓库目录」并中止；**受理后装修**（P3①：入队回执 false=重入拒收 → `downloadQueue.busyDropped` warn、不复启 UI；回执 true 才 disable 按钮 + 落「准备下载」行，且受理时已非 active（web 同步收口/事件抢跑）不装修、真进度行不被迟到 preparing 覆盖、prev.lastDoneSeq 对齐现值不重放 file-done；catch 仅受理后抛错才 rollback——受理前失败不得踩他批运行态）；并对旧单文件契约 re-export 全部公开符号（store 的 subscribe/getState/resume/enqueueDownloads/cancelDownloads/isActiveStatus + 类型），消费者零改动
- **`creator-avatar-store.ts`（创作者头像 store，ADR-264）**：模块级单例（与 `download-queue-store` 同寿命同形态，底层 ADR-216 listener-set），承载「`作者 → dataUri`」头像表。写入方两路：`download-queue-store` 的 `.ysm` 成功增量（`setAvatar`，**原地改写**——已渲染卡片即时更新）与工坊页批量提取 `extractAvatars`（`setAvatars`，**整表替换**，旧 ctx 不可见由重渲染兑底）——两种语义刻意不同勿统一（契约测试锁定）。**空表不覆盖**：批量提取返回空表是「这次没提取到」而非「头像没了」，照收会抹掉已知头像。`avatar:refresh` 的消费方（工坊页订阅）从此处读，不再借宿 `AppContentState`（历史归属：曾借宿页面容器、寿命错配，ADR-263 裁定上收、ADR-264 落地）。
- **⚠️ 「空表」的两种语义必须由调用方区分（锐评修复，2026-10-14）**：Go 侧 `internal/app/app_avatar.go|BatchExtractCreatorAvatars` 在「`ysmRoot()==""`（仓库根未配置）」与「确实没有头像」两种情况下**都返回空表**，`setAvatars` 的守卫本身分不了。判据落在 `views/app-content/site/workshop-avatar.ts|extractAvatars`：仓库根未配置 → 保留（守卫用意）；**仓库根已配置 → 该空表具权威性，调 `clearAvatars()` 显式清**——否则用户删空某创作者的全部模型后，其陈旧头像在本应用会话内永不自愈（store 是内存态、重启才清，且生产**无任何其它** `clearAvatars` 调用点）。`setAvatars` 的守卫因此降为**纯防御安全网**（判断权归有信息的调用方），**勿移除也勿给 `clearAvatars` 加守卫**（会让该判定失效）。⚠️ **同一类问题上一轮审计已识别，但只落在 CLI**：`PurgeCreatorAvatarCache`（清**磁盘**头像缓存）早已存在并被 CLI `avatar purge` 使用（`go/cli/avatar.go|runAvatarPurge` 自陈「P1-2：缓存无失效机制，作者换头像后旧图残留，手动 purge 重建」），前端虽已生成该绑定却**零生产调用**——GUI 用户无入口；本次修的是**内存态自愈判据**，与磁盘 purge 正交可并存。回归锁：`site/workshop-avatar.test.ts` 6 例（非空替换 / 未配置保留 / **已配置清空** / `GetRepoRoot` 抛错保守保留 / 绑定抛错降级 / 按 `ysm` 类型问根，与 Go `ysmRoot()` 同参），变异验证：退回「空表一律跳过」即核心锁转红

## 对外 API / 入口

- 导出：`showProgress`、`tryFetchModels`、`FetchModelsResult`（data.ts）；`VIEW_TESTIDS`、`WorkshopModel`、`isModelMissing`、`countMissing`、`filterModels`、`ModelRowCtx`、`buildModelRow`、`renderRepoHeaderHTML`（render.ts）；`bindRepoEvents`、`RepoEventsContext`、`RepoEventsHandle`（events.ts）；`createVirtualList`、`VirtualList`、`VirtualListOpts`（virtual-list.ts）；`subscribe`、`getState`、`resume`、`enqueueDownloads`、`cancelDownloads`、`createDownloadQueue`、`DownloadTask`、`QueueError`、`DownloadState`、`QueueControllerOptions`、`QueueController`（download-queue.ts）；`WorkshopSite` 类型来自 bindings（`bindings/ysm-model-manager/go/types/models.ts`，非本目录导出）
- 监听 bus：无（UI 层经 `subscribe` 订阅 STATE）
- 派发 bus：`toast:show`、`tree:reload`、`stats:refresh`、`avatar:refresh`、`ctx:show`（workshop 右键，ADR-208 D3 后不再裸发 `menu:show`）
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
- `STATE.status` 为 `"downloading"` **或** `"enqueued"`（Go 端入队后只发 `enqueued`，从不发 `downloading`，审计修复后守卫统一经 `isActiveStatus` 认两态）时 `enqueueDownloads`/`enqueue`/`cancelDownloads` 直接返回，防止并发双队列与取消静默失效
- 三个下载入口（单击/多选/全选）统一走 `queue.enqueue` → 模块级 `enqueueDownloads` → `EnqueueDownloads` binding，事件监听只有一组
- **DOM 事件监听器清理模式**（审计发现）：`events.ts` 的 `bindEvents` 向容器元素注册了 7 个 DOM 事件监听器（click/change/contextmenu/input），`externalCleanup` 必须移除所有监听器。推荐做法：用 `cloneNode(false)` 替换所有绑定元素（`sr.replaceChild(sr.cloneNode(false), sr)`），一次性解除所有事件绑定，比逐个 `removeEventListener` 更可靠（P2）。
- **虚拟化后全选约束**（提交 3bfdfe63）：DOM 只含可见行，全选逻辑必须遍历 `currentFiltered` 筛选结果（而非 `selContainer.querySelectorAll(".gh-sel")`），否则漏选；`renderList()` 无参调用（内部用 `currentFilter`），不再返回 DocumentFragment
- `enqueue` 内 Go 入队失败必须回滚 `STATE.status = "idle"` + `notify()` + `cleanupProgressUI()`，防按钮/进度条卡死（致命陷阱 #3）
- 99% 卡死守护：`_lastPct < 10` 直跳 ≥99% 视为可疑，锁 99% 并起 `_stuckTimer`（小文件 300ms 补 100%，大文件 2s 转菊花）；所有定时器必须经 `stuckGuardReset()` 清理
- 进度为 `Content-Length ≤ 0`（未知长度）时 `pct` 恒置 0、只显示已下载 MB 数，完成判定只信任 `queue:file-done` / `queue:status=done`，不得据进度条推断 100%（致命陷阱 #6）
- **按 `data-name` 反查 DOM 必须用 `CSS.escape(name)`，不能用 `esc()`**（ADR-039 P3，提交 9ea7db9）：`esc()` 产出的 HTML 实体在属性选择器里不会还原，含 `&` 的文件名会匹配失败导致勾选清不掉
- `createDownloadQueue` 返回的 `destroy` 即 `subscribe` 的退订函数，视图销毁必须调用，防僵尸回调累积
- 菜单载荷（ctx:show 的 `workshop.name` 等 → menu-defs label → `menu:show`）传原文，转义职责归 context-menu 组件（二次 esc 会出现 `&amp;`）
- 本目录已无动态 `import()`：`parseModelName` 等依赖一律顶层静态导入，禁止回退到 `await import(...)` 或带 `.js` 后缀的路径
- **创意工坊 index 过滤 `.recycle` 回收站条目**（[G5 收口] 单一实现 `utils/recycle-path.ts` `hasRecycleSegment`，命名对齐 Go `sync.hasRecycleSegment` 段语义 EqualFold——注意区别于 `fsutil.IsRecycleDir` 基名版，一次性路径判定须用段判定）：`tryFetchModels`（`data.ts`）加载远端 index 后过滤 path 含 `.recycle` 段的条目，web `generateWebRepoIndex`（`backend/web-community.ts`）生成时同样过滤——回收站下"已删/待清理"文件不应出现在工坊下载列表；若不滤，文件经 Go 下载器 `stripRecycleSegments` 剥段落盘，剥后仅剩文件名者落到仓库根（观感同「下载平铺」）。原 isRecyclePath（feature 层）/ isRecycleRel（backend 层）双实现已删（原「避免跨层回引」为过度设计：helper 落 utils 纯函数域零跨层引用），Go 桌面 scanner 已跳过回收站，此过滤兜底远端作者生成的旧 index
- **远程 JSON api 路解码必须走 UTF-8 字节还原**（提交 4bb5eb38）：`community-fetch.ts|fetchWithFallback` 的 `api` 分支（GitHub contents.content = base64(UTF-8 字节)）须 `base64ToBytes` → `new TextDecoder("utf-8").decode`，**禁止裸 `JSON.parse(atob(...))`**——atob 产 Latin-1 串（每字节→同码位），非 ASCII 创作者名变双重编码乱码落盘（2026-09-21 一次社区合并把 197 条乱码当新作者追加，Go `MergeCommunityCreatorsFromJSON` 按 name 去重失效，乱码名 ≠ 干净名）。同口径已在 `data.ts` 模型列表 api 路（`atob → Uint8Array.from(charCodeAt) → TextDecoder`）落地，`community-fetch.ts` 拆分时（ADR-040 §2.1）曾漏用此模式；Go 侧另有 `app_workshop.go|repairMojibake` 合并闸作防劣化兜底（还原后乱码名恢复真实码位、与既有干净条目同名走 update）。回归锁 `frontend/src/features/community/community-fetch.test.ts` + `internal/app/app_workshop_mojibake_test.go`
- **P3 观察台账（2026-08 复审立案，2026-10-13 全部清偿）**：① `enqueue` 入口守卫与 `await GetRepoRoot` 之间的竞态窗口会让第二批次被 store 守卫**静默丢弃**——清偿：`enqueueDownloads` 升**受理回执 `Promise<boolean>`**（store 同步 check-and-set 即原子真值），UI 控制器装修挪至受理后并在拒收回执上 `downloadQueue.busyDropped` warn（三道等价防御：已非 active 不复启 UI / 真进度行不被迟到 preparing 覆盖 / prev 对齐现值不重放 file-done；受理前失败的 catch 不再无条件 rollbackToIdle 踩他批）；② 8s 超时护不到 `resp.json()` body 读取——清偿：护栏扩至载荷读完（`data.ts|fetchModelsOne` 全程 try/finally）；③ completeTimer 到点不校验当前文件已 file-done，慢落盘被提前拆 UI——清偿：落盘未完（`currentFile && _lastDoneSeq < total`）有界 re-arm（至多 2 次 ×3s=9s 窗），file-done 到达后下一轮即收口，预算耗尽放行保留 done 丢失兜底（`download-queue-progress.ts|armCompleteTimer`）；④ 下载 URL 未编码保留字符——清偿：逐段编码助手 `download-tasks.ts|buildModelDownloadUrl` 双出口共用。②④ 同日早前清偿于竞速/URL 收口批次，①③ 清偿于 enqueue/completeTimer 批次，四条均已钉用例。
- **web 下载失败不回退直链的粗分类边界（2026-10-13 观察项）**：`download-queue-web.ts|runWebEnqueue` 中 `importWebFiles` 报 `failed` 时计败**不**走直链兜底——`failed` 混装「预期过滤」（.7z/非支持扩展名/无主文件组，直链救不了）与「真写盘失败」（quota/IDB，blob 在手直链可救）两类，`{imported, failed}` 契约（4 生产消费者 + contract-b1/b3 钉死）不分原因故无从分辨；用户可重试，代价低；若未来 importWebFiles 暴露失败分类，写盘类应改直链兜底。另：`WEB_DOWNLOAD_IDB_LIMIT=50MB` 与导入 `MAX_IMPORT_BYTES=100MB` 是**刻意分离**的两条守卫（fetch+blob 双份内存），历史上探测守卫曾从 50 抬到 100 对齐导入，勿反向"对齐"联动
- **已知边界（子代理复核 P2 记录，挂账非必修）**：web-stats 降级旗标是**单槽旁路信道**——`batchStatsWebModels` 批调用入口同步清零治好了「长尾残旗跨批冒领」（清零不得放 batchChain 排队回调内，会把已降级未消费的前批误成漏报）；但真并发批仍有归属互踩窗口：A 批成功、消费微任务链未完时 B 起批同步置位（如 Worker 构造抛错/gen 弃置）→ A 误报一次 + B 真降级被同位吞。彻底解是把降级位随批返回值走，而降级信号**正是**无法经 SearchModels 的 Go-parity 返回形状传递才立此全局旗标的——随批化须先改三端契约（browser-adapter contract b1/b2 + `backend/web-fs.ts|SearchModels` 的「禁静默改动」注记 + toolbar-search 消费口），触发面需并发两次数值搜索且后批走同步失败分支，代价与收益不成比例，挂账待议；口径见 `web-stats.ts|consumeWebSearchDegraded` jsdoc

## 已知边界 / 待治理

- `download-queue.ts`（UI 控制器）当前已接近 ≤400 行红线；下次在此文件新增功能时，应优先评估是否可继续拆分子职责（如把 `cmDqHandle*` 状态响应族拆为独立模块），而非继续堆叠
- `events.ts` 的 `bindRepoEvents` 承担编排角色（队列初始化 + 虚拟列表创建 + 一组事件绑定），职责密度高；后续若新增仓库页交互，考虑先抽出 orchestrator 再扩展，避免该文件继续线性增长
- `backendGetApp` / `communityGetApp` / `contextMenuGetApp` 三处别名转发同一实现；当前为 vi.mock 测试策略所依赖的形态，待真实 DI 容器落地时合并

## 相关

- [go_download](./go-download.md) — 后端下载队列与事件发射
- [app_content](./app-content.md) — workshop/github 页面宿主
- [go_avatar](./go-avatar.md) — 创作者头像提取与缓存
- [context_menu](./context-menu.md) — 右键信息展示
