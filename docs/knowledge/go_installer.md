---
kind: go_installer
name: 模型安装 go/installer
tier: architecture
category: go
source_files:
  - go/installer/
use_when:
  - 安装
  - installer
  - 模型导入
  - 下载模型
---

# 模型安装 go/installer

## 概览

`go/installer/` 包负责模型资源的安装流程，包括从下载队列到目标存储路径的复制/移动。

## 核心职责

- 接收下载完成事件，触发安装流程
- 处理存储路径映射（不同资源类型对应不同子目录）
- 安装结果通知前端

## 与其他子系统关系

- `go/download/`: 下载完成后回调
- `go/paths/`: 路径安全校验
- `go/types/`: 资源类型映射

## 不变量

- 安装路径必须通过 `go/paths/` 安全校验
- 支持硬链接安装以提升性能

## 相关

- `go/download/` — 下载器
- `go/paths/` — 路径安全
