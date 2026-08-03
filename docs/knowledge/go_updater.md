---
kind: go_updater
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
- 下载更新包
- 应用更新

## 与其他子系统关系

- `go/version/`: 版本信息管理
- `frontend/js/features/version-updater.js`: 前端更新 UI

## 不变量

- 更新操作需要用户确认

## 相关

- `frontend/js/features/version-updater.js`
