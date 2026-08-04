---
kind: app_nav
name: 顶部导航 app-nav
tier: leaf
category: ui
source_files:
  - frontend/js/views/app-nav/index.ts
use_when:
  - 导航栏
  - 导航
  - 切页
  - nav:change
  - 菜单
  - 页面记忆
  - 版本号
---

# 顶部导航 app-nav

## 概览

`app-nav` 是应用的主导航菜单组件（Shadow DOM，渲染为左侧固定栏），列出模型仓库、整合包管理、创作者频道、创意工坊、诊断与冲突、设置 6 个入口，底部显示应用版本号。它是 `nav:change` 事件的唯一派发源，并在启动时恢复上次浏览的页面。

## 核心职责

- `app-nav.ts` — `<app-nav>` 组件：渲染导航项并绑定点击派发 `nav:change`；监听 `nav:changed` 更新高亮并把当前页写入 localStorage `nav_page`；启动时读 `localStorage.getItem("nav_page")` 恢复页面（旧值 `resources` 兼容映射为 `repository`，默认 `repository`）；经 `getApp()` 调 `GetAppVersion` 异步填充版本号

## 对外 API / 入口

- 自定义元素：`<app-nav>`
- 监听 bus：`nav:changed`（由 `app-content` 消费 `nav:change` 后回发，据此同步高亮与持久化）
- 派发 bus：`nav:change`（导航项点击；启动恢复页面）
- getApp 调用：`GetAppVersion`
- 导航项 id：`repository` / `instances` / `workshop` / `github` / `diagnostics` / `settings`

## 与其他子系统关系

- `app-content` 是 `nav:change` 的唯一消费方：切页整块重渲染后回发 `nav:changed` 形成闭环（见知识卡 `app_content`）
- 其他模块（如 `app-sidebar` 底部路径按钮、`repo:search-creator` 流程）也通过派发 `nav:change` 借道切页
- 版本号来自 Go 端 `go/version` 包 binding

## 不变量

- 启动恢复页面的 `nav:change` 必须用 `queueMicrotask` 延迟派发，确保 `app-content` 等组件的 `connectedCallback` 先完成 `bus.on` 注册，否则首屏丢事件
- `nav:change` 的派发源头只此一处（加上程序化切页方），高亮状态只由 `nav:changed` 回环驱动，不本地抢跑
- `_unsub` 在 `disconnectedCallback` 清理；localStorage 写入包 try/catch 防隐私模式异常
- 样式走 CSS 变量（`var(--bg)` / `var(--accent)` 等），动画受 `.no-animations` 全局开关约束

## 相关

- `frontend/js/bus.ts` — 事件总线（见知识卡 `event_bus`）
- 知识卡：`app_content`、`page_store`
