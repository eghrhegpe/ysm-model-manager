---
kind: go-version
name: 版本号 go/version
tier: leaf
category: go
source_files:
  - go/version/version.go
use_when:
  - 版本
  - version
  - 更新
  - ldflags
---

# 版本号 go/version

## 概览

`go/version/` 只有一件事：持有应用版本号。默认 `"dev"`，发版构建时通过 `-ldflags -X` 注入正式版本，供界面展示与自动更新的版本比较。

## 核心职责

- `version.go` — 声明可注入的 `Version` 变量

## 对外 API / 入口

- `Version` — `var Version = "dev"`；注入方式：`go build -ldflags "-X ysm-model-manager/go/version.Version=v1.0.0" .`

## 与其他子系统关系

- 被 `internal/app/app.go` 的 GetVersion binding 返回给前端展示
- 被 `internal/app/app_config.go` 使用：`CurrentVersion()` 返回、`updater.Check(version.Version)` 作为自动更新的当前版本入参（见 [go_updater](./go-updater.md)）

## 不变量

- 只允许构建期注入，运行时不得改写
- 发版流程（`cmd/build-release.ps1` / `docs/releases/`）必须注入版本号，否则更新检查会以 `"dev"` 比较

## 相关

- [go_updater](./go-updater.md) — 以 Version 为基准检查新版本
- [wails_bridge](./wails-bridge.md) — GetVersion binding
