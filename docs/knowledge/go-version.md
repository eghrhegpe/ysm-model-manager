---
kind: go-version
name: 版本号 go/version
tier: leaf
category: go
source_files:
  - go/version/version.go
quick_groups:
  - 配置与注册表
quick_intents:
  - 版本号、版本检查、go-version
  - version-check
quick_risk_lines:
  - 版本号必须走 go/version 的 LoadVersion，禁止在多处手写版本号读取
pitfalls:
  - 多处手写版本号读取 → 版本不一致、UI 显示与后端实际版本脱节；必须经 LoadVersion
  - 版本号变更未同步 → 版本检测失效；必须在发版时更新 go/version

use_when:
  - 版本
  - version
  - 更新
  - ldflags
invariant_anchors:
  - go/version/version.go|ldflags
---

# 版本号 go/version

## 概览

`go/version/` 只有一件事：持有应用版本号。默认 `"dev"`，发版构建时通过 `-ldflags -X` 注入正式版本，供界面展示与自动更新的版本比较。

## 核心职责

- `version.go` — 声明可注入的 `Version` 变量

## 对外 API / 入口

- `Version` — `var Version = "dev"`；注入方式：`go build -ldflags "-X ysm-model-manager/go/version.Version=v1.0.0" .`

## 与其他子系统关系

- 被 `internal/app/app.go` 的 `GetAppVersion` binding 返回给前端展示（知识卡旧文称 GetVersion，命名漂移已修正）
- 被 `internal/app/app_config.go` 使用：`CurrentVersion()` 返回（与 GetAppVersion 双入口同源冗余，P4 观察待收敛）、`updater.Check(version.Version)` 作为自动更新的当前版本入参（见 [go_updater](./go-updater.md)）

## 不变量

- 只允许构建期注入，运行时不得改写（`Version` 为导出可变全局，防写仅靠约定，P4 文档级）
- 发版流程（`scripts/build-release.ps1` / `docs/releases/`）必须注入版本号，否则更新检查会以 `"dev"` 比较；dev 语义下 `splitVer("dev")` 归零 → 更新检查恒提示有新版（P3 观察：无代码兜底，updater 无 dev 特判测试）

## 相关

- [go_updater](./go-updater.md) — 以 Version 为基准检查新版本（`splitVer("dev")` 归零 → dev 构建恒提示新版，已补单测钉住，P3 观察）
- [wails_bindings](./wails-bindings.md) — `GetAppVersion` / `CurrentVersion` binding（知识卡旧文引 wails_bridge 为幽灵链接，已修正；两入口双源冗余 P4 观察待收敛）
