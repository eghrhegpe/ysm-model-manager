---
kind: go-errors
name: 错误包装 go/errors
tier: leaf
category: go
source_files:
  - go/errors/errors.go
use_when:
  - 错误
  - 中文提示
  - friendly
  - 报错
  - toast
---

# 错误包装 go/errors

## 概览

`go/errors/` 是纯工具小包，把英文系统错误转换为用户能看懂的中文提示（权限不足/文件被占用/磁盘空间不足等），服务于「所有异常路径必须有 toast 反馈」的 UI 安全红线。

## 核心职责

- `errors.go` — 错误汉化：汉字检测、常见系统错误模式映射表、兜底前缀

## 对外 API / 入口

- `Friendly(err error) error` — 入参为 nil 返回 nil；消息已含汉字直接原样返回；否则按映射表（access denied / not found / sharing violation / timeout / disk full 等 15 组模式）转成「中文提示: 原始消息」，未命中则加「操作失败: 」前缀

## 与其他子系统关系

- 独立工具包，仅用标准库；定位为 binding 层统一错误文案的备选设施，当前仓库内暂无调用方，接入点在 `internal/app/` 各 binding 的 catch 返回处

## 不变量

- 原始错误文本始终保留在冒号后缀，汉化不丢诊断信息
- 匹配基于小写子串，大小写不敏感
- 已有中文的错误不再二次包装，避免「权限不足: 权限不足」式重复

## 相关

- [wails_bridge](./wails-bridge.md) — binding 错误返回的消费侧
- AGENTS.md 治理红线 §三.3（UI 安全：异常路径必须有 toast 反馈）
