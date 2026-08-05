---
kind: go-download
name: 下载器 go/download
tier: architecture
category: go
source_files:
  - go/download/
  - internal/app/app_download.go
use_when:
  - 下载
  - 进度
  - download
  - 进度条
  - 下载进度
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
- `FromGitHubAPI(ctx, apiURL, savePath, onProgress)` — 从 GitHub API 拉取下载
- `ResolveSavePath(rawURL, saveDir)` — 从 raw URL 解析保存路径 + jsd/api 镜像 URL

## 与其他子系统关系

- `internal/app/app_download.go`：`downloadFileWithQueue` 用 `ResolveSavePath` 解析路径、按 Mirror 策略排序三个源、逐源调 `File`/`FromGitHubAPI`，任一成功即返回；进度经 `emitDownloadProgress` 转发 `download:progress` Wails 事件
- 前端通过 Wails EventsOn 接收进度事件（`download-queue.ts`）

## 不变量

- Content-Length = -1 时进度由前端锁定 99% 转菊花（致命陷阱 #6）；Go 端结束时 `total<=0` 归一为 `downloaded` 再发 final progress
- 三入口（单击/多选/全选）都走 `enqueueDownloads()`，前端只注册一组 Wails EventsOn（致命陷阱 #7）
- 取消语义：`CancelQueue` 置 cancelled + cancel ctx → 正在下载的文件立即中断、队列结束不发 `queue:status done`；`EnqueueDownloads` 入队时复位 cancelled（取消后再下载不哑火）

## 相关

- 致命陷阱 §三 陷阱 #6 #7
