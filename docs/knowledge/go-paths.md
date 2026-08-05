---
kind: go-paths
name: 路径安全 go/paths
tier: architecture
category: go
source_files:
  - go/paths/
use_when:
  - 路径
  - 安全
  - path
  - 路径校验
---

# 路径安全 go/paths

## 概览

`go/paths/` 包提供路径安全校验，防止路径穿越攻击和非法路径访问。

## 核心职责

- 路径合法性校验
- 防止路径穿越
- 统一路径处理

## 对外 API / 入口

- `IsInside(root, path)` — 路径越权检查，越权返回 `ErrPathEscalation`
- `ContainsMinecraftMarker` — 检测路径是否含 Minecraft 标记

## 与其他子系统关系

- 所有文件操作包均依赖此包
- `go/fsutil/`: 文件操作

## 不变量

- 所有用户输入的路径必须经过此包校验

## 相关

- `go/fsutil/`
