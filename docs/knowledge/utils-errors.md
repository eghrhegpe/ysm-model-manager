---
kind: utils-errors
name: 错误处理 errors
tier: leaf
category: utils
source_files:
  - frontend/src/utils/dom/errors.ts
use_when:
  - 错误提示
  - 友好错误
  - friendlyError
  - toast 文案
  - 报错翻译
  - 网络错误
  - 文件被占用
---

# 错误处理 errors

## 概览

把 Go 端/运行时返回的原始错误转换为用户可读的中文提示，是异常路径 toast 文案的统一入口（治理红线：所有异常路径必须有 toast 反馈）。

## 核心职责

- Go 英文错误消息 → 中文友好提示（正则模式匹配）
- 已含中文的消息直接透传（Go 端已友好化/已翻译）
- 未匹配时拼接可配置的前缀兜底

## 对外 API / 入口

- `friendlyError(err: unknown, fallback = "操作失败"): string`
  - 空值 → `"未知错误"`；err 可为 Error 对象或字符串
  - 消息含汉字 → 原样返回
  - 模式库（按优先级）：**社区功能高频错误**（429/rate limit → GitHub API 频率受限、abort → 已取消、parse error → 数据格式异常、DNS → 域名解析失败、ECONNREFUSED/socket → 连接中断、SSL/TLS → 证书错误）**> 通用错误**（权限不足、文件不存在、文件被占用、目录为空、超时、网络异常、参数无效、文件已存在、磁盘空间不足、不支持的格式、操作过于频繁、目录类型错误）
  - 未命中 → `"${fallback}: ${原始消息}"`

## 与其他子系统关系

- 消费方覆盖全部异步操作层：`core/handler-sync` + `handler-other` + `context-menus`、`features/version-updater` + `recycle-bin` + `import-queue`、`app-tree`（instance-actions / bus-handlers / toolbar-events）、`app-content/community`（settings / site-view）、`app-sync-manager`
- 标准调用模式：`catch (e) { bus.emit("toast:show", { type: "error", message: friendlyError(e, "XX失败") }) }`，toast 呈现见 [app_toast](./app-toast.md)
- Go 端错误源头见 [go_errors](./go-errors.md)

## 不变量

- 治理红线：**所有异常路径必须有 toast 反馈**（AGENTS.md §3.3），禁止静默 `catch {}`；catch 后消息一律经 friendlyError 再给用户
- 模式匹配有顺序依赖：社区错误在前、通用错误在后，新增模式注意不要覆盖更具体的规则
- 不把技术栈细节（堆栈/英文原文）直接暴露给用户，仅在 fallback 分支附原文以便排查

## 相关

- [app_toast](./app-toast.md) — toast 呈现
- [go_errors](./go-errors.md) — Go 端错误源
- [event_bus](./event-bus.md) — toast:show 事件通道
- `frontend/src/utils/dom/errors.test.js` — 单元测试（验证入口）
