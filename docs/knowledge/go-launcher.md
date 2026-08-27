---
kind: go-launcher
name: 启动器实例发现 go/launcher
tier: leaf
category: go
source_files:
  - go/launcher/detect.go
use_when:
  - 改启动器发现/实例目录解析逻辑时
---

# 启动器实例发现 go/launcher

## 概览

桌面启动器 Minecraft 实例发现：识别用户所选启动器（HMCL / PCL / Minecraft 官方），并把每个 MC 版本解析到实际运行目录与 YSM 自定义目录（`config/yes_steve_model/custom`）。

## 核心职责

- 启动器识别：HMCL / PCL / Minecraft 三档（`launcherHMCL` / `launcherPCL` / `launcherMinecraft`）
- 版本目录解析：每个版本 → 实际运行目录 + YSM 自定义目录

## 对外 API / 入口

- `Detect` — 识别启动器并解析全部 MC 版本的实际运行目录与自定义目录

## 与其他子系统关系

- 供 app 层实例检测/列表使用（`ListVersionInstances` 等 binding 的数据源之一）
- `go/types` — `VersionInstance` 等结构

## 不变量

- 未识别到任何启动器 → 空结果（不 panic）
- YSM 自定义目录固定 `config/yes_steve_model/custom`

## 相关

- go:launcher/ 目录登记（project-map）
