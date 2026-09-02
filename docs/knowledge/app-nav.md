---
kind: app-nav
name: 顶部导航 app-nav
tier: leaf
category: ui
source_files:
  - frontend/src/views/app-nav/
quick_groups:
  - 跨组件通信与页面
quick_intents:
  - 导航栏、切页、nav:change
  - 页面记忆、版本号、折叠展开
  - nav_page 恢复
quick_risk_lines:
  - nav:change 事件必须仅由 app-nav 派发，其他页面禁止自派 nav:change
pitfalls:
  - 页面 A 直接派 nav:change → 与 app-nav 状态分裂、高亮错位；必须经 app-nav 派发
  - 折叠态未持久化 → 刷新恢复宽版；必须经 safeSet 落 localStorage nav_collapsed

use_when:
  - 导航栏
  - 导航
  - 切页
  - nav:change
  - 菜单
  - 页面记忆
  - 版本号
invariant_anchors:
  - frontend/src/views/app-nav/tpl.ts|navCSS
status: active
---

# 顶部导航 app-nav

## 概览

`app-nav` 是应用的主导航菜单组件（Shadow DOM，渲染为左侧固定栏），列出模型仓库、整合包管理、创作者频道、创意工坊、诊断与冲突、设置 6 个入口，底部显示应用版本号。它是 `nav:change` 事件的唯一派发源，并在启动时恢复上次浏览的页面。

## 核心职责

- `app-nav.ts` — `<app-nav>` 组件：渲染导航项并绑定点击派发 `nav:change`；监听 `nav:changed` 更新高亮并把当前页写入 localStorage `nav_page`；启动时读 `localStorage.getItem("nav_page")` 恢复页面（旧值 `resources` 兼容映射为 `repository`，默认 `repository`）；经 `getApp()` 调 `GetAppVersion` 异步填充版本号
- **折叠/展开（`_collapsed` + `data-collapsed`）**：折叠收成 48px 常驻窄条（仅图标 + 展开按钮，`nav-toggle` 常驻可见防意外找不回导航）；折叠态持久化 localStorage `nav_collapsed`（`safeGet`/`safeSet`）；触发区是整行 `.menu-head`（label + 箭头统一响应，`cursor:pointer`，扩大点击范围）；`setCollapsed(collapsed, persist=true)` 公开接口——`persist=false` 不落盘，原留给 workshop 页自动折叠，现无调用方（2026-08-12 移除自动折叠后仅手动路径）

## 对外 API / 入口

- 自定义元素：`<app-nav>`
- 公开方法：`setCollapsed(collapsed, persist?)` — 折叠/展开导航栏（见核心职责）
- 监听 bus：`nav:changed`（由 `app-content` 消费 `nav:change` 后回发，据此同步高亮与持久化）、`lang:changed`（语言切换时重渲染导航标签）
- 派发 bus：`nav:change`（导航项点击；启动恢复页面）
- getApp 调用：`GetAppVersion`
- 导航项 id：`repository` / `instances` / `workshop` / `github` / `diagnostics` / `settings`

## 与其他子系统关系

- `app-content` 是 `nav:change` 的唯一消费方：切页整块重渲染后回发 `nav:changed` 形成闭环（见知识卡 `app_content`）
- 其他模块（如 `app-sidebar` 底部路径按钮、`repo:search-creator` 流程）也通过派发 `nav:change` 借道切页
- 版本号来自 Go 端 `go/version` 包 binding

## 不变量

- 启动恢复页面的 `nav:change` 用 `queueMicrotask` 延迟派发——但**生产环境 app-content 为动态 import**（app-modules.ts 动态 import app-content），恢复事件实际在 app-content 订阅前触发而丢失；首屏不丢的真正保证来自 app-content 构造器 `resolveInitialPage` 兜底（知识卡旧文把 queueMicrotask 描述为首屏保证，实为动态 import 下失效，漂移已修正）
- `nav:change` 的派发源头有三处（app-nav 点击/启动恢复、程序化切页方、**index.html:60-64 内联 DOMContentLoaded 脚本**——P2 修正：该内联源默认值已从 `"instances"` 改为 `"repository"`，与 page-store 兜底对齐；**2026-08-09 复核补修：内联源补 `nav_page` 读取与六页白名单校验**——原忽略 nav_page 记忆且无 sanitize，非法 page 可经此注入链路）；高亮状态只由 `nav:changed` 回环驱动，不本地抢跑
- `_unsub` 在 `disconnectedCallback` 清理；localStorage 写入包 try/catch 防隐私模式异常（**读路径 `resolveInitialPage` 同样包 try/catch**，P2 修复：隐私模式 getItem 抛错会使 app-nav/app-content 构造失败）
- 折叠态是**纯用户手动状态**：2026-08-12 起不再有按页面自动折叠/恢复逻辑（app-content 曾对 workshop 页自动折叠，已移除——避免覆盖用户手动折叠记忆），`nav_collapsed` 只由 `setCollapsed` 手动路径写入
- 样式走 CSS 变量（`var(--bg)` / `var(--accent)` 等），动画受 `.no-animations` 全局开关约束

## 相关

- `frontend/src/bus.ts` — 事件总线（见知识卡 `event_bus`）
- 知识卡：`app_content`、`page_store`
