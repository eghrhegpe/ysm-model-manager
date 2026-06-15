# YSM 模型管理器 — AI 代理入职指南

## 第一条：先读文档

在开始任何修改前，**必须依次阅读**：

1. **`.github/copilot-instructions.md`** — 战斗手册（致命陷阱、工作流、约定）
2. **`docs/architecture.md`** — 项目架构
3. **`docs/release-notes/`** — 最新版本的发版说明（看已有的改动）
4. **`docs/bug-chronicle.md`** — 已知 Bug 和排查路径
5. **`docs/pending-cleanup.md`** — 待清除清单（调试代码是否还在）
6. **`docs/Design.md`** — 设计规范（CSS 变量、布局、字号、颜色规则）

## 第二条：确认当前状态

- 检查 `git log --oneline -5` 看最近提交
- `build/bin/` 下的 YSMParser.exe 仅作为 Go CLI fallback，`wails build -clean` 会清掉，但 WASM 内嵌解码不受影响

## 第三条：改前读文件

禁止基于记忆修改。每次改文件前先 `grep_search` / `read_file` 确认最新状态。啊

## 第四条：改完立即构建

```powershell
# Go 改了
go build ./go/... 2>&1 | Select-String error

# 前端改了
cd frontend ; npx vite build 2>&1 | Select-String error
```

不攒多个修改。

## 第五条：已知已完成的改动（v1.3.0+）

已在发版说明中记录，但快速提示：

## 第六条：回滚规则

如果 `multi_replace_string_in_file` 后构建失败，检查 import 语句是否完整，修复后继续。

## 七、多 AI 角色分工（按前缀命中率）

关键约束决定了下一步的提议：

| 约束                               | 影响                           |
| ---------------------------------- | ------------------------------ |
| 元宝 / 网页 DeepSeek 无 agent 模式 | 不能改文件，只能审计           |
| M3 免费但连接慢                    | 适合改小代码（量少等得起）     |
| OpenCode 快但缓存小                | 适合快速修小 bug，掉记忆无所谓 |
| CodeBuddy / CodeGeeX 输出效率高    | 适合大段读写、跨文件重构       |
| CSS 一崩用户失焦                   | **不给免费 AI 碰 CSS**         |
| 发版没标签没法写更新报告           | 谁发标签？Copilot              |

### 职责分配
必须相互协作，才能发挥出各自服务商的优势

| 职责                        | 用谁                  | 理由                                 |
| --------------------------- | --------------------- | ------------------------------------ |
| **发计划**                  | **Copilot**           | 上下文最长，缓存有记忆，计划不会跑偏 |
| **审计代码**                | 元宝 / 网页 DeepSeek  | 免费，输出量大，全量读不心疼         |
| **改小代码**                | OpenCode + M3         | 免费快，掉记忆无所谓                 |
| **改大代码 / 跨文件重构**   | CodeBuddy / CodeGeeX  | 输出效率高，有 agent 模式            |
| **CSS**                     | **Copilot 或自己改**  | CSS 崩了用户直接失焦                 |
| **Go 端 / Vite / 最终验证** | **Copilot 收尾**      | 改错代价高，必须你把关               |
| **打 Git 标签**             | **Copilot**（发版时） | 只有你知道完整改了什么               |

### 原则

- 频繁修改上免费（OpenCode+M3）：掉记忆就重读一次，不贵
- 审计让网页端来（元宝/DeepSeek）：免费，全量读，输出量大
- 修改让 agent 来（CodeBuddy/CodeGeeX）：有 agent 模式，能自动改
- 计划让 Copilot 来：上下文最长+缓存记忆，计划靠谱
- Gl/CSS/HTML 模板给免费 AI 碰？**不行**——视觉锚点一丢，开发目标直接跑偏
- Go Binding 签名、Vite 配置、wails build 链：**不给免费 AI**，改错一次花 10 倍 token 修

## 各工具前缀一致性评级

| 工具                | 评级       | 理由                                        |
| ------------------- | ---------- | ------------------------------------------- |
| Aider 🥇            | ⭐⭐⭐⭐⭐ | repo map 内建摘要 + diff 编辑，前缀天然稳定 |
| Roo Code 🥈         | ⭐⭐⭐     | 需手写摘要锁进 system instructions          |
| Claude Code 转接 🥉 | ⭐⭐       | cache_control 被静默忽略，前缀基本每轮断    |
