---
title: 前端治理规则手册
description: 9 条前端治理规则的唯一事实来源 — 规则条文 × 严重度 × 替代方案 × 检测工具
---

# 前端治理规则手册（Governance Rules）

> 9 条前端治理规则的**唯一事实来源**（规则条文 + 严重度 + 替代方案 + 检测工具）。
> 决策背景与事故驱动过程见 [ADR-005](./adr/ADR-005-frontend-governance-rules.md)；检测脚本实现见「脚本体系全景」（仓库 `scripts/README.md`）「治理红线」表。
> 本手册承接原 `docs/core/CLEANUP_RULES.md`（2026-08-03 曾整本并入 ADR-005，2026-08-04 归位独立手册——规则条文与决策依据各司其职）。

---

## 规则总表

| # | 规则 | 严重度 | 检测 |
|---|------|--------|------|
| R1 | 禁止 `window.*` 全局变量 | Error | `check-redlines.mjs R1` + `doctor.mjs` |
| R2 | 禁止 `repoRoot` 变量名 | Error | `check-redlines.mjs R2` |
| R3 | 禁止回调式 API | Warn | `check-redlines.mjs R3` |
| R4 | 禁止 `display: none/block` 做动画切换 | Warn | `check-redlines.mjs R4` |
| R5 | 禁止硬编码颜色值 | Warn | `check-redlines.mjs R5` + `doctor.mjs` |
| R6 | 禁止 `public/` 下放 JS | Error | `check-redlines.mjs R6` |
| R7 | 禁止魔法字符串资源类型字面量 | Warn | `check-redlines.mjs R7` + `type-consistency.mjs` |
| R8 | 禁止未转义拼接 HTML | Error | `check-redlines.mjs R8` + `doctor.mjs` |
| R9 | 禁止侧边栏手动拼接 | Warn | `check-redlines.mjs R9` |

**严重度分级**：Error（4 条）= 运行时错误或安全风险，必须拦截；Warn（5 条）= 长期债务或可维护性问题，建议修复，不阻塞发布。

> check-redlines.mjs 另有 W1/W2/W5 附加扫描项（反斜杠路径 / `window.go.main.App` 直调等），属 AGENTS.md §三 治理红线范畴，不在本手册 9 条之内。

---

## 规则明细

### R1 禁止 `window.*` 全局变量（Error）

- **规则**：前端不得新增 `window.__lastModel`、`window.$spec` 等全局变量。
- **替代**：模块级 `let` + getter/setter，或 `PageStore`（`core/page-store.ts`）。
- **背景**：v1.5.1 清理。多个 AI 代理反复引入全局变量，状态跨页面泄漏，调试成本极高。

### R2 禁止 `cfg.repoRoot` / `repoRoot` 变量名（Error）

- **规则**：Go/JS 中均不得使用 `repoRoot` 变量名。
- **替代**：Go 用 `cfg.FilesRoot`，JS 用 `filesRoot`。
- **背景**：v1.6.4 统一命名。"repo" 在此项目指"模型仓库"（用户实例）而非代码仓库，命名歧义导致多模块混用。

### R3 禁止回调式 API（Warn）

- **规则**：不得直接使用 `entry.file(callback)` 等回调式 API。
- **替代**：`new Promise(resolve => entry.file(resolve))` 包装为 Promise。
- **背景**：DnD 数据读取时回调异步导致数据到达时机不可控，Promise 化才能保证到达后再处理。

### R4 禁止 `display: none/block` 做动画切换（Warn）

- **规则**：动画切换不得使用 `display: none/block`。
- **替代**：`opacity` / `transform` / `grid-template-rows` 配合 CSS transition。
- **背景**：`display: none` 破坏 transition 导致跳帧；ADR-015 统一动画系统在动画域将其具体化。

### R5 禁止硬编码颜色值（Warn）

- **规则**：CSS 中不得硬编码颜色值（`#RGB`、`rgba()`、`hsl()`）。
- **替代**：`var(--txt)`、`var(--bg)` 等 CSS 变量（见 Design.md 主题系统）。
- **背景**：项目多套主题通过 CSS 变量切换，硬编码颜色绕过主题系统，深色/浅色下显示异常。

### R6 禁止 `public/` 下放 JS（Error）

- **规则**：JS 文件不得放入 `public/` 目录。
- **替代**：新 JS 放 `frontend/src/`，ESM import → `app-modules.ts` 统一注册。
- **背景**：Vite dev 模式优先加载 `public/` 文件，绕过模块系统，依赖关系断裂（致命陷阱 #9）。

### R7 禁止魔法字符串资源类型字面量（Warn）

- **规则**：JS 中不得直接使用 `"ysm"`、`"mmd-skin"`、`"vrchat-avatar"` 等字面量。
- **替代**：前端 `RESOURCE_TYPES` 常量 / Go `types/resource.go` 常量；类型定义以 `resource_types.json` 为单一事实来源。
- **背景**：资源类型是核心枚举，字面量散落各处导致类型新增后漏改（ADR-010）。

### R8 禁止未转义拼接 HTML（Error）

- **规则**：`innerHTML` 拼接不得直接使用用户数据。
- **替代**：`esc()`、`renderFormattedText()`、`renderDisplayName()`。
- **背景**：copilot XSS 加固阶段引入，所有 `innerHTML` 拼接必须转义，否则存在注入风险。

### R9 禁止侧边栏手动拼接（Warn）

- **规则**：不得在 `public/` 侧手动拼接 `sidebarItem` / `tb-btn` 元素。
- **替代**：统一用 `renderSidebar()` 模板函数。
- **背景**：手动拼接导致侧边栏在不同入口间样式不一致。

---

## 与其他文档的关系

| 文档 | 职责 |
|------|------|
| 本手册 | 规则条文唯一事实来源（改规则改这里） |
| [ADR-005](./adr/ADR-005-frontend-governance-rules.md) | 决策依据：为何立规、事故驱动过程、严重度分级决策 |
| `AGENTS.md` §三 | AI 常驻摘要（3 条红线 = 本手册 Error 级子集） |
| 脚本体系全景（仓库 `scripts/README.md`） | 检测工具实现与红线→脚本映射 |
| [致命陷阱手册](./pitfalls.md) | 项目特定事故教训（规则之外的情境坑） |
