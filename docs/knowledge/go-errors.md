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
invariant_anchors:
  - go/errors/errors.go|refused
---

# 错误包装 go/errors

## 概览

`go/errors/` 是纯工具小包，把英文系统错误转换为用户能看懂的中文提示（权限不足/文件被占用/磁盘空间不足等），服务于「所有异常路径必须有 toast 反馈」的 UI 安全红线。

## 核心职责

- `errors.go` — 错误汉化：汉字检测、常见系统错误模式映射表、兜底前缀。映射表现 16 组（P2 修复后）：权限不足（含 EPERM "operation not permitted"）、不存在、被占用（含 EBUSY "device or resource busy"）、文件已存在（EEXIST "file exists" 归此组，不再误归占用）、目录为空、超时、拒绝、网络中断、网络异常、参数无效、磁盘满、不支持、限流（"too many requests"/"rate limit"，不再误伤 EMFILE/ELOOP）、打开文件过多、非目录、是目录

## 对外 API / 入口

- `Friendly(err error) error` — 入参为 nil 返回 nil；消息已含汉字直接原样返回；否则按映射表（access denied / not found / sharing violation / timeout / disk full 等 **16 组**模式——知识卡旧文「15 组」为过期描述，已更正）转成「中文提示: 原始消息」，未命中则加「操作失败: 」前缀；「目录为空」组已收窄为完整短语（P3 修复：裸 `"no files"` 是 `"no filesystem"` 子串，文件系统类错误曾被误分类）

## 与其他子系统关系

- 独立工具包，仅用标准库；定位为 binding 层统一错误文案的备选设施，当前仓库内暂无调用方，接入点在 `internal/app/` 各 binding 的 catch 返回处

## 不变量

- 原始错误文本始终保留在冒号后缀，汉化不丢诊断信息
- 匹配基于小写子串，大小写不敏感
- 已有中文的错误不再二次包装，避免「权限不足: 权限不足」式重复

## 相关

- [wails_bridge](./wails-bridge.md) — binding 错误返回的消费侧
- AGENTS.md 治理红线 §三.3（UI 安全：异常路径必须有 toast 反馈）
