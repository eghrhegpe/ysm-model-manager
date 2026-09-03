---
kind: go-download
name: 下载器 go/download
tier: architecture
category: go
source_files:
  - go/download/
  - internal/app/app_download.go
auto_fields:
  symbols_with_lines:
    - App.CancelQueue
    - App.DownloadFromGitHub
    - App.EnqueueDownloads
    - App.QueueStatus
    - Downloader
    - Downloader.File
    - Downloader.FileWithChecksum
    - Downloader.FromGitHubAPI
    - Downloader.FromGitHubAPIWithChecksum
    - Downloader.WithRetry
    - DownloadQueue
    - ErrChecksumMismatch
    - ErrNonBinaryContentType
    - ErrPartialResponse
    - ErrRedirectChainTooLong
    - ErrRedirectToUnsafeScheme
    - ErrTruncated
    - ErrUnsupportedScheme
    - HTTPStatusError
    - HTTPStatusError.Error
    - New
    - NewDownloadQueue
    - NewWithClient
    - ProgressFn
    - ResolveSavePath
    - RetryPolicy
    - TruncationError
    - TruncationError.Error
    - TruncationError.Unwrap
  quick_groups:
    - 文件操作与标签
  quick_intents:
    - 下载、下载进度、进度条
    - download、HTTPStatusError、TruncationError
    - 校验和校验
  quick_risk_lines:
    - 下载必须走 go/download，必须带校验和校验防截断 / 部分响应
  pitfalls:
    - 下载不校验 checksum → 静默损坏文件；必须经 ErrChecksumMismatch 拦截
    - 部分响应未识别 → 后续续传逻辑失效；必须经 ErrPartialResponse 分类
  use_when:
    - 下载
    - 进度
    - download
    - 进度条
    - 下载进度
  perf:
    - io-bound
    - single-thread
  invariant_anchors:
    - go/download/download.go|TruncationError
    - go/download/download.go|ErrPartialResponse
    - go/download/download.go|ErrChecksumMismatch
    - go/download/download.go|HTTPStatusError
quick_groups:
  - 文件操作与标签
quick_intents:
  - 下载、下载进度、进度条
  - download、HTTPStatusError、TruncationError
  - 校验和校验
quick_risk_lines:
  - 下载必须走 go/download，必须带校验和校验防截断 / 部分响应
pitfalls:
  - 下载不校验 checksum → 静默损坏文件；必须经 ErrChecksumMismatch 拦截
  - 部分响应未识别 → 后续续传逻辑失效；必须经 ErrPartialResponse 分类

use_when:
  - 下载
  - 进度
  - download
  - 进度条
  - 下载进度
perf:
  - io-bound
  - single-thread
invariant_anchors:
  - go/download/download.go|TruncationError
  - go/download/download.go|ErrPartialResponse
  - go/download/download.go|ErrChecksumMismatch
  - go/download/download.go|HTTPStatusError
status: active
---

# 下载器 go/download

## 概览

`go/download/` 包负责模型资源的纯 HTTP 下载（不依赖 Wails runtime），支持 ctx 取消中断、进度回调与失败半文件清理。镜像回退策略（raw/jsd/api 排序）在 `internal/app/app_download.go` 的 `downloadFileWithQueue` 中编排，`Downloader` 只做单源下载。

## 核心职责

- 单文件 HTTP 下载（`File` / `FromGitHubAPI`，API 源带 GitHub Accept 头）
- 实时上报下载进度（`ProgressFn` 回调，200ms 节流 + 结束 final 兜底）
- ctx 取消/超时即中断请求（`http.NewRequestWithContext`），队列取消可终止当前文件
- 下载失败/中断时 `os.Remove` 半截文件，避免残留损坏文件被扫描/预览

## 对外 API / 入口

- `New` / `NewWithClient` — 创建 `Downloader`（可注入 http client）
- `File(ctx, url, savePath, onProgress)` — 单文件下载，ctx 取消即中断
- `FileWithChecksum(ctx, url, savePath, onProgress, expectedSHA256)` — P2 预留：File + 可选 SHA256 校验（nil/空则跳过，行为零漂移；不匹配返回 `ErrChecksumMismatch`，不装盘、无 .part 残留）
- `FromGitHubAPI(ctx, apiURL, savePath, onProgress)` — 从 GitHub API 拉取下载
- `FromGitHubAPIWithChecksum(ctx, apiURL, savePath, onProgress, expectedSHA256)` — P2 预留：GitHub API 版的可选 SHA256 校验（语义同 FileWithChecksum）
- `WithRetry(maxAttempts, backoff)` — **显式开启**自动重试（默认不重试，行为零漂移）：仅对**同一 URL** 的网络类失败/服务端 5xx 指数退避重试（字段 0 回退默认 3 次/500ms）；ctx 取消、4xx、`ErrPartialResponse` 等安全 sentinel 一律不重试。**与三源回退正交**——`downloadFileWithQueue` 用默认（不重试）Downloader，三级回退不叠加重试，避免获取仓库 index 时总时长爆炸
- `ResolveSavePath(rawURL, saveDir)` — 从 raw URL 解析保存路径 + jsd/api 镜像 URL；`raw.githubusercontent.com` 走 `/{owner}/{repo}/{branch}/{path}` 四段结构化定位（**分支名任意**，dev/release/1.0 均得完整 relPath + 带正确分支的 jsd/api），非 raw 前缀回退 `/main/` `/master/` 标记搜索

## 与其他子系统关系

- `internal/app/app_download.go`：`downloadFileWithQueue` 用 `ResolveSavePath` 解析路径、按 Mirror 策略排序三个源、逐源调 `File`/`FromGitHubAPI`，任一成功即返回；进度经 `emitDownloadProgress` 转发 `download:progress` Wails 事件。**队列契约 DTO（`DownloadTask`/`QueueStatusInfo`）已下沉 `go/types`（ADR-145：跨包契约，供 go/cli AppService 接口引用；JSON tag 原样保留 → bindings 零漂移）**
- 前端通过 Wails EventsOn 接收进度事件（`download-queue.ts`）

## 不变量

- Content-Length = -1 时进度由前端锁定 99% 转菊花（致命陷阱 #6）；Go 端结束时 `total<=0` 归一为 `downloaded` 再发 final progress
- 三入口（单击/多选/全选）都走 `enqueueDownloads()`，前端只注册一组 Wails EventsOn（致命陷阱 #7）
- 取消语义：`CancelQueue` 置 cancelled + cancel ctx → 正在下载的文件立即中断、队列结束不发 `queue:status done`；`EnqueueDownloads` 入队时复位 cancelled（取消后再下载不哑火）。队列带 `epoch` 代际计数：取消/新入队递增，旧 process goroutine 退出时仅当代际一致才复位 running / 发 done，防止「取消后立即重新入队」双 goroutine 并发处理同一队列
- **process 判空退出前复位 running 后重检任务列表**（P2 修复：判空解锁 return 与 defer 复位 running 之间 Enqueue 可能已追加任务——running 仍 true 不启新 goroutine、defer 又复位+发 done → 队列静默停滞；现复位后代际一致且有任务则重启处理）
- **`commitAtomicWrite` 的 Sync 失败分支必须显式 `Close` 释放句柄**（R26 P2-2 修复）：旧实现 Sync 失败直接 return，Close 没被调用，依赖外层 cleanup 的 Close 顺序。Windows 上句柄未释放会导致后续 Remove 失败、`.part-*` 残留。修复：Sync 失败分支显式 `_ = af.tmp.Close()` 释放句柄后再 return。Close 的错误被丢弃——Sync 已失败，Close 失败不影响错误分类。
- **`len(via) >= 10` 重定向上限与标准库对齐，非 off-by-one**（R26 P2-1 误判澄清）：Go 语义里 `via` 是「已发起的请求」（含原始请求），`len(via) >= 10` 拒绝第 10 次重定向（第 11 个请求），允许 9 次重定向——与标准库 `net/http/client.go:834` 的 `defaultMaxRedirect=10` 语义完全对齐。子代理曾误判为 off-by-one，核查标准库源码后确认不修。

## 相关

- 致命陷阱 §三 陷阱 #6 #7
