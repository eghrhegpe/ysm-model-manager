# ADR-005：前端治理规则体系

- **状态**：已采纳（Accepted）
- **日期**：2026-08-03（初定，规则时间线 v1.5.1 → 持续维护）
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`frontend/js/` 全量 / `docs/governance-rules.md`（规则条文唯一事实来源） / `Design.md` / `AGENTS.md` §三

---

## 1. 背景（Context）

项目在 v1.5.1 左右经历了一次全面的前端治理整顿，目标是消除 AI 代理在反复开发中
容易引入的、具有长期危害的代码模式。这些规则不是一次性设计决策，而是**被具体事故驱动**的：

- v1.5.1 清理了 `window.*` 全局变量污染
- v1.6.4 统一了 `repoRoot` → `filesRoot` 命名
- copilot 加固阶段排除了 XSS 风险（`innerHTML` 拼接）
- 动画路线图阶段确定了"禁止 display 切换"规范

原文档见 `docs/core/CLEANUP_RULES.md`（2026-08-03 删除后曾并入本 ADR；2026-08-04 规则条文提取归位独立手册 `docs/governance-rules.md`，本 ADR 回归决策记录本位）。

---

## 2. 决策（Decision）

采纳 9 条前端治理规则（4 Error + 5 Warn），每条规则均由具体事故驱动。2026-08-04 起，**规则条文、替代方案与检测工具的唯一事实来源为 `docs/governance-rules.md`**（规则手册）；本 ADR 保留决策依据，不再承载规则条文。

| # | 规则 | 驱动事故 | 严重度 |
|---|------|----------|--------|
| R1 | 禁止 `window.*` 全局变量 | v1.5.1 全局变量清理 | Error |
| R2 | 禁止 `repoRoot` 变量名 | v1.6.4 命名歧义混用 | Error |
| R3 | 禁止回调式 API | DnD 数据到达时机失控 | Warn |
| R4 | 禁止 `display: none/block` 做动画切换 | transition 跳帧 | Warn |
| R5 | 禁止硬编码颜色值 | 绕过主题系统致显示异常 | Warn |
| R6 | 禁止 `public/` 下放 JS | Vite dev 绕过模块系统 | Error |
| R7 | 禁止魔法字符串资源类型字面量 | 类型新增后漏改 | Warn |
| R8 | 禁止未转义拼接 HTML | XSS 注入风险 | Error |
| R9 | 禁止侧边栏手动拼接 | 入口间样式不一致 | Warn |

规则明细（条文 / 替代方案 / 背景 / 检测命令）→ `docs/governance-rules.md`。

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

## 5. 与 AGENTS.md §三 的关系

规则手册中的 Error 级规则与 `AGENTS.md §三「三条治理红线」` 内容一致：

| 规则手册 | AGENTS.md 红线 |
|---------------|----------------|
| R1 `window.*` 全局变量 | §3.1 零 `window.__*` 全局变量 |
| R6 `public/` 下放 JS | §3.3 相关 |
| R8 未转义 `innerHTML` | §3.3 UI 安全 |

`docs/governance-rules.md` 是更完整的清单（9 条 vs 3 条红线），AGENTS.md 红线是其子集。

---

## 6. 数据溯源

| 来源 | 结果 |
|------|------|
| `docs/core/CLEANUP_RULES.md` | 9 条规则全文，含检测命令（2026-08-03 删除，后继见下行） |
| `docs/governance-rules.md` | 2026-08-04 规则条文提取归位的独立手册（唯一事实来源） |
| `copilot-instructions.md` | 致命陷阱 #11（回调 Promise 化）、XSS 加固 |
| `ADR-015`（统一动画系统） | display 切换 → opacity/transform 替代方案 |
| `Design.md` | CSS 变量主题系统，4 套主题定义 |

---

*规则条文唯一事实来源：`docs/governance-rules.md`（2026-08-04 从本 ADR 提取归位）；本 ADR 保留决策理由与事故背景。*
