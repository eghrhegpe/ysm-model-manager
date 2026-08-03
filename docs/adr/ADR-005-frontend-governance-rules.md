# ADR-005：前端治理规则体系

- **状态**：已采纳（Accepted）
- **日期**：2026-08-03（初定，规则时间线 v1.5.1 → 持续维护）
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`frontend/js/` 全量 / `copilot-instructions.md` / `Design.md` / `AGENTS.md` §四

---

## 1. 背景（Context）

项目在 v1.5.1 左右经历了一次全面的前端治理整顿，目标是消除 AI 代理在反复开发中
容易引入的、具有长期危害的代码模式。这些规则不是一次性设计决策，而是**被具体事故驱动**的：

- v1.5.1 清理了 `window.*` 全局变量污染
- v1.6.4 统一了 `repoRoot` → `filesRoot` 命名
- copilot 加固阶段排除了 XSS 风险（`innerHTML` 拼接）
- 动画路线图阶段确定了"禁止 display 切换"规范

原文档见 `docs/core/CLEANUP_RULES.md`（已于 2026-08-03 删除，9 条规则全文并入本 ADR §2.1–§2.9，检测命令速查随文件移除）。

---

## 2. 决策（Decision）

### 2.1 禁止 `window.*` 全局变量

**规则**：前端不得新增 `window.__lastModel`、`window.$spec` 等全局变量。

**替代方案**：模块级 `let` + getter/setter，或 `PageStore`（`core/page-store.js`）。

**背景**：v1.5.1 清理。多个 AI 代理在开发中反复引入全局变量，导致状态在不同页面
之间泄漏，调试成本极高。清理后由 AGENTS.md §四.1 治理红线固化。

**严重度**：Error

### 2.2 禁止 `cfg.repoRoot` / `repoRoot` 变量名

**规则**：Go/JS 中均不得使用 `repoRoot` 变量名。

**替代方案**：Go 用 `cfg.FilesRoot`，JS 用 `filesRoot`。

**背景**：v1.6.4 统一命名。"repo" 在此项目中指"模型仓库"（一个用户实例），
而非代码仓库，命名歧义导致多个模块混用。

**严重度**：Error

### 2.3 禁止回调式 API

**规则**：不得直接使用 `entry.file(callback)` 等回调式 API。

**替代方案**：`new Promise(resolve => entry.file(resolve))` 包装为 Promise。

**背景**：DnD 数据读取时回调异步导致数据到达时机不可控，必须 Promise 化才能保证
数据到达后再处理。

**严重度**：Warn

### 2.4 禁止 `display: none/block` 做动画切换

**规则**：动画切换不得使用 `display: none/block`。

**替代方案**：`opacity` / `transform` / `grid-template-rows` 配合 CSS transition。

**背景**：`display: none` 破坏 transition，导致动画跳帧。动画路线图阶段确认，
统一使用 opacity/transform 方案。

**严重度**：Warn

### 2.5 禁止硬编码颜色值

**规则**：CSS 中不得硬编码颜色值（`#RGB`、`rgba()`）。

**替代方案**：`var(--txt)`、`var(--bg)` 等 CSS 变量（见 Design.md §3 主题系统）。

**背景**：项目有 4 套主题通过 CSS 变量切换。硬编码颜色绕过主题系统，导致深色/浅色
主题下显示异常。

**严重度**：Warn

### 2.6 禁止 `public/` 下放 JS

**规则**：JS 文件不得放入 `public/` 目录。

**替代方案**：ESM import → `app-modules.js` 统一注册。

**背景**：Vite dev 模式下优先加载 `public/` 文件，绕过模块系统，导致依赖关系断裂。

**严重度**：Error

### 2.7 禁止魔法字符串 `rtype` 字面量

**规则**：JS 中不得直接使用 `"ysm"`、`"mmd-skin"`、`"vrchat-avatar"` 等字面量。

**替代方案**：使用 `types/resource.go` 常量或前端 `RESOURCE_TYPES` 常量。

**背景**：资源类型是项目的核心枚举，字面量散落在各处导致类型新增后漏改。
所有资源类型定义以 `resource_types.json` 为单一事实来源。

**严重度**：Warn

### 2.8 禁止未转义拼接 HTML

**规则**：`innerHTML` 拼接不得直接使用用户数据。

**替代方案**：`esc()`、`renderFormattedText()`、`renderDisplayName()`。

**背景**：copilot XSS 加固阶段引入。所有 `innerHTML` 拼接必须转义，否则存在注入风险。

**严重度**：Error

### 2.9 禁止 `public/` 侧边栏手动拼接

**规则**：不得在 `public/` 侧手动拼接 `sidebarItem` / `tb-btn` 元素。

**替代方案**：统一用 `renderSidebar()` 模板函数。

**背景**：可复用性。手动拼接导致侧边栏在不同入口间样式不一致。

**严重度**：Warn

---

## 3. 规则严重度分级

| 严重度 | 数量 | 含义 | 处理 |
|--------|------|------|------|
| **Error** | 4 条 | 运行时错误或安全风险 | 必须拦截，CI 不可通过 |
| **Warn** | 5 条 | 长期债务或可维护性问题 | 建议修复，不阻塞发布 |

---

## 4. 后果（Consequences）

### 正面
- AI 代理在每次开发中受到明确约束，减少"改完一个 bug 引入一个新坑"
- 规则附带检测命令（grep / ESLint / CodeQL），可自动化 CI 拦截
- 新加入的人（或 AI）读此文档即可了解项目前端的"不可为"边界

### 负面
- 部分规则（如禁止魔法字符串）需要在新增资源类型时同步更新常量定义，有维护成本
- 规则体系仍在演进中，未来可能新增规则或放宽旧规则

---

## 5. 与 AGENTS.md §四 的关系

本文档中的 Error 级规则与 `AGENTS.md §四「三条治理红线」` 内容一致：

| CLEANUP_RULES | AGENTS.md 红线 |
|---------------|----------------|
| 2.1 `window.*` 全局变量 | §四.1 零 `window.__*` 全局变量 |
| 2.6 `public/` 下放 JS | §四.3 相关 |
| 2.8 未转义 `innerHTML` | §四.3 UI 安全 |

`CLEANUP_RULES.md` 是更完整的清单（9 条 vs 3 条红线），AGENTS.md 红线是其子集。

---

## 6. 数据溯源

| 来源 | 结果 |
|------|------|
| `docs/core/CLEANUP_RULES.md` | 9 条规则全文，含检测命令 |
| `copilot-instructions.md` | 致命陷阱 #11（回调 Promise 化）、XSS 加固 |
| `ADR-015`（统一动画系统） | display 切换 → opacity/transform 替代方案 |
| `Design.md` | CSS 变量主题系统，4 套主题定义 |

---

*原文档：`docs/core/CLEANUP_RULES.md`，提炼治理决策理由，检测命令保留在原文件中。*
