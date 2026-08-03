---
kind: go_download
name: 下载器 go/download
tier: architecture
category: go
source_files:
  - go/download/
use_when:
  - 下载
  - 进度
  - download
  - 进度条
  - 下载进度
---

# 下载器 go/download

## 概览

`go/download/` 包负责模型资源的 HTTP 下载，支持进度报告、重试机制、断点续传。

## 核心职责

- 执行 HTTP 下载请求
- 实时上报下载进度到前端
- 下载完成后回调 installer

## 对外 API / 入口

- `New` / `NewWithClient` — 创建 `Downloader`（可注入 http client）
- `File` — 单文件下载，支持 `ProgressFn` 进度回调
- `FromGitHubAPI` — 从 GitHub API 拉取下载（release asset）
- `ResolveSavePath` — 解析保存路径（防冲突命名）

## 与其他子系统关系

- `go/installer/`: 下载完成后的安装触发
- 前端通过 Wails EventsOn 接收进度事件

## 不变量

- Content-Length = -1 时锁定 99%，2s 后转菊花（致命陷阱 #6）
- 三入口（单击/多选/全选）都走 `enqueueDownloadTasks()`，只注册一组 Wails EventsOn（致命陷阱 #8）
- 下载失败后按钮不灰掉，`finally` 中 emit 完成事件

## 相关

- 致命陷阱 §三 陷阱 #6 #8
