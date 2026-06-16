# YSM 模型管理器 — AI 代理入职指南

## 第一条：先读文档

在开始任何修改前，**必须依次阅读**：

1. **`.github/copilot-instructions.md`** — 战斗手册（致命陷阱、工作流、约定）
2. **`docs/architecture.md`** — 项目架构
3. **`docs/release-notes/`** — 最新版本的发版说明（看已有的改动）
4. **`docs/bug-chronicle.md`** — 已知 Bug 和排查路径
5. **`docs/pending-cleanup.md`** — 待清除清单（调试代码是否还在）
6. **`docs/Design.md`** — 设计规范（CSS 变量、布局、字号、颜色规则）
7. **`docs/TERMINOLOGY.md`** — 术语对照表（名词统一、UI 文案规范）
8. **`docs/CLEANUP_RULES.md`** — 治理规则（9 条禁止模式 × severity × 检测方式）
9. **`docs/TASK_PLAN.md`** — AI 任务计划（可执行任务清单 + 文件路径 + 验证方式）
10. **`docs/novel/SKELETON.md`** — 技术工程小说骨架（仅续写小说时必读）

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

- **app-sync-manager 动画补齐**（v1.7.4）：`.sm-item`/`.sm-item-btn`/`.sm-tab`/`.sm-status-tab` 的 hover 过渡 + 列表项 `sm-item-in` stagger 入场 + 空状态淡入 + 骨架屏 shimmer。`.no-animations` 已覆盖全部 5 个 class。注意：骨架屏必须在 `.sm-list` 内渲染（`this.querySelector('.sm-list').innerHTML = loadingHTML()`），放兄弟节点会被 `overflow:hidden` 裁掉。

## 第六条：回滚规则

如果 `multi_replace_string_in_file` 后构建失败，检查 import 语句是否完整，修复后继续。

## 七、OpenCode 模型索引

按任务场景选择当前会话使用的模型：

| 角色 | 推荐模型 | 适用场景 |
|------|----------|----------|
| 🏆 **主力 Driver** | Big Pickle | 日常增删改查、简单功能迭代、报错解释。响应快，免费额度内反馈最快 |
| 🧠 **复杂推理** | DeepSeek V4 Flash Free | 架构分析、超长上下文（1M）、绕逻辑死结。免费阵营的定海神针 |
| 🚀 **极速轻量** | North Mini Code Free | 列目录、代码翻译、简单补全。3B 激活参数，延迟极低，别做多步任务 |
| 💡 **创意发散** | MiMo V2.5 Free | 多思路 brainstorm、前端 UI/动画效果。卡住时换它头脑风暴 |
| 📚 **超大仓库** | Nemotron 3 Ultra Free | 一次性喂数百文件梳理项目脉络。1M 上下文，工具调用不太稳，作备用 |
