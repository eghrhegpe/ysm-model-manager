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
---

# 自动更新 go/updater

## 概览

`go/updater/` 包负责 YSM 应用的自动更新机制。

## 核心职责

- 检查版本更新
- 下载更新包（**Download 检查 HTTP 状态码**，P2 修复：原 404 错误页 HTML 在 expectedHash=="" 时被当包装盘；非 200 直接拒绝并清理）
- 应用更新（InstallUpdate 含 zip 展开 Base 防穿越、exe 缺失报错、helper 重启替换；哈希**校验**实际在 Download 完成——知识卡旧文把 fetchExpectedHash 归于 InstallUpdate 属职责漂移，已修正）

## 对外 API / 入口

- `Check` — 查询 GitHub Releases 检查新版本（`Release`/`ReleaseAsset`/`UpdateInfo`）；`fetchExpectedHash` 现返回 `(string, error)`（P2 修复：原 "" 同时表达未找到/网络/HTTP 三种失败，404/403 时哈希校验静默跳过；现非 200 显式报错并 log 告警，下载继续但无哈希校验）
- `Download` — 下载更新包（500MB limit+1 截断探测 + SHA256 校验 + 非 200 拒绝）
- `CleanupOldVersion` — 清理旧版本残留
- `InstallUpdate` — 应用更新（含 `assetPattern` 匹配安装包）

## 与其他子系统关系

- `go/version/`: 版本信息管理
- `frontend/src/features/version-updater.ts`: 前端更新 UI

## 不变量

- 更新操作需要用户确认

## 相关

- `frontend/src/features/version-updater.ts`
