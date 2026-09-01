---
kind: go-executil
name: 进程隐藏窗口 go/executil
tier: architecture
category: go
source_files:
  - go/executil/hidewindow_windows.go
  - go/executil/hidewindow_other.go
quick_groups:
  - 跨组件通信与页面
quick_intents:
  - 子进程隐藏控制台窗口、HideWindow
  - 外部进程启动、跨平台 HideWindow
quick_risk_lines:
  - 子进程隐藏控制台窗口必须走 go/executil 的 HideWindow，禁止直调 os/exec 不带隐藏标志
pitfalls:
  - 直调 os/exec 不带隐藏标志 → Windows 子进程闪控制台窗口；必须经 HideWindow
  - Unix 平台 HideWindow 未 no-op → 编译失败；必须在 build tags 中区分平台

use_when:
  - 子进程隐藏控制台窗口
  - 跨平台 HideWindow
  - 外部进程启动
invariant_anchors:
  - go/executil/hidewindow_windows.go|HideWindow
---

# 进程隐藏窗口 go/executil

## 概览

`go/executil/` 包提供跨平台的外部进程执行工具，当前唯一功能是 **HideWindow**：在 Windows 上隐藏子进程控制台窗口，其他平台为 no-op。

## 核心职责

- 跨平台隐藏子进程控制台窗口（Windows 专属；Unix 无此概念，noop）
- 叠加语义：保留调用方已设置的 `SysProcAttr` 字段，仅追加 `HideWindow` 标志，不覆盖

## 对外 API / 入口

- `HideWindow(cmd *exec.Cmd)` — 统一入口，Windows 设置 `SysProcAttr.HideWindow = true`，其他平台为空函数

## 与其他子系统关系

- **历史遗留**：原为 `avatar/fileops/internal/app` 三处各自复制的同名函数（ADR-003 下沉遗留），现统一收敛于此
- **消费方**：所有需要静默启动子进程、不希望弹出控制台窗口的场景（通过 `executil.HideWindow(cmd)` 调用）

## 不变量

- **不覆盖**已有 `SysProcAttr`：若调用方已设置 `HideWindow = true` 或其他字段，不会清空
- 非 Windows 平台行为恒为 no-op，无副作用
- 本包只含窗口隐藏逻辑，不包含进程启动/等待/输出读取等职责

## 相关

- ADR-003（逻辑下沉历史）
