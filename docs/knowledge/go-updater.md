---
kind: go-updater
name: 自动更新 go/updater
tier: architecture
category: go
source_files:
  - go/updater/
use_when:
  - 更新
  - 自动更新
  - 版本升级
  - updater
invariant_anchors:
  - go/updater/update.go|fetchExpectedHash
  - go/updater/update.go|StatusCode
---

# 自动更新 go/updater

## 概览

`go/updater/` 包负责 YSM 应用的自动更新机制。

## 核心职责

- 检查版本更新
- 下载更新包：**多源镜像回退**（用户反馈：直连 GitHub Release 20MB 包 7 分钟仅 17%）——`DownloadWithProgress` 先直连 asset URL，失败/超时后按 `ghProxyPrefixes`（ghfast.top → gh-proxy.com，第三方公开代理，域名可变动）依次拼前缀重试，任一成功即返回；全部失败聚合各源错误（含源标识）。**进度回调** `onProgress(done, total)`：已知长度按 1% 步进、未知长度（分块传输）按 512KB 节流；Copy 成功后补发尾块（<512KB 短包/不足 512KB 的尾块不丢最终字节数）
- 应用更新（InstallUpdate 含 zip 展开 Base 防穿越、exe 缺失报错、helper 重启替换；哈希**校验**实际在 Download 完成——知识卡旧文把 fetchExpectedHash 归于 InstallUpdate 属职责漂移，已修正）

## 对外 API / 入口

- `Check` — 查询 GitHub Releases 检查新版本（`Release`/`ReleaseAsset`/`UpdateInfo`）；`fetchExpectedHash` 现返回 `(string, error)`（P2 修复：原 "" 同时表达未找到/网络/HTTP 三种失败，404/403 时哈希校验静默跳过；现非 200 显式报错并 log 告警，下载继续但无哈希校验）
- `Download` — 兼容旧调用方（无进度回调），委托 `DownloadWithProgress(url, hash, nil)`
- `DownloadWithProgress(assetURL, expectedHash, onProgress)` — 多源回退下载：`updateLock` 串行保护；`downloadOnce` 单源尝试（独立 90s 超时，原 5min——避免直连卡死拖满整个更新流程；500MB limit+1 截断探测 + SHA256 校验 + 非 200 拒绝）；错误聚合格式「更新包下载失败（N 个源均失败）：\n源: 原因」
- `CleanupOldVersion` — 清理旧版本残留
- `InstallUpdate` — 应用更新（含 `assetPattern` 匹配安装包）

## 与其他子系统关系

- `go/version/`: 版本信息管理
- `frontend/src/features/version-updater.ts`: 前端更新 UI（进度经 `update:progress` 事件驱动 `modalProgress` 弹窗 + 窗口标题）

## 不变量

- 更新操作需要用户确认
- 下载多源回退任一成功即返回；`ghProxyPrefixes` 为第三方公开服务，域名失效时改常量即可（测试可整体替换为本地 server 隔离真实网络）
- 每源独立 90s 超时：慢/卡源快速切镜像，全源失败才聚合报错（含源标识便于判断直连还是镜像问题）
- 进度回调节流：已知长度 1% 步进、未知长度 512KB；尾块补发保证最终字节数（P3 修复：<512KB 短包与不足 512KB 的尾块此前零回调）

## 相关

- `frontend/src/features/version-updater.ts`
