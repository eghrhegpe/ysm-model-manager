# 开发者文档索引

> 面向开发者的技术文档入口。用户手册请看 [README.md](../../README.md) → [用户指南](用户指南.md)

---

## 📐 核心架构

| 文档 | 说明 |
|------|------|
| [architecture.md](architecture.md) | 前端架构规范：组件拆分、三层解耦、共享工具 |
| [Design.md](../frontend/Design.md) | UI 设计规范：CSS 变量、4 套主题、布局、字体、颜色规则 |
| [TERMINOLOGY.md](../core/TERMINOLOGY.md) | 术语对照表：名词统一、UI 文案规范、AI 术语索引 |
| [PROJECT_STATUS.md](PROJECT_STATUS.md) | **项目当前状态**：已完成功能、遗留问题、下一步方向 |
| [SESSION_HANDOFF.md](../tasks/SESSION_HANDOFF.md) | **会话交接日志**：AI 代理间的信息传递记录 |

---

## 🐛 问题排查

| 文档 | 说明 |
|------|------|
| [bug-chronicle.md](bug-chronicle.md) | Bug 排查记录 + Debug Path Review（核心参考） |
| [pending-cleanup.md](../frontend/pending-cleanup.md) | 待清理清单：调试代码、临时方案、技术债 |
| [CLEANUP_RULES.md](../core/CLEANUP_RULES.md) | 治理规则：9 条禁止模式 × severity × 检测方式 |
| [DEPRECATED_NAMES.md](../frontend/DEPRECATED_NAMES.md) | 废弃别名对照：可 grep 批量替换清单 |

---

## 🎬 动画系统

| 文档 | 说明 |
|------|------|
| [animation-roadmap.md](../frontend/animation-roadmap.md) | 动画路线图：统一 keyframe、stagger 系统、设计令牌 |
| [animations.md](../frontend/animations.md) | 前端动画系统文档：11 种动画清单 + 无障碍支持 + 性能考量 |

---

## 🎨 UI 改进

| 文档 | 说明 |
|------|------|
| [ui-improvement-plan.md](../frontend/ui-improvement-plan.md) | UI 修改计划：P0-P2 优先级 + 仓库元老页优化 + 执行记录 |

---

## 📊 参考数据

| 文档 | 说明 |
|------|------|
| [pack-format-versions.md](pack-format-versions.md) | Minecraft `pack_format` 编号 ↔ 游戏版本映射表（与 `frontend/js/utils/pack-format.js` 同步维护） |

---

## 📦 发版记录

| 文档 | 说明 |
|------|------|
| [release-notes/](../release-notes/) | 各版本发版说明（按版本号组织） |
| [release-notes/README.md](../release-notes/README.md) | 发版说明索引表 |

### 构建发布流程

1. `go generate ./go/...` — 代码生成（litematic block_ids 等，源 JSON → Go map 字面量）
2. `npx vite build`（`frontend/`）— 前端构建
3. `wails build -clean -ldflags "-X ysm-model-manager/go/version.Version=vX.Y.Z"` — 编译 exe
4. `build-release.ps1 vX.Y.Z` — 一键执行 1-3 + 打包 ZIP + 生成 SHA256SUMS + 上传 GitHub Release

---

## 🎯 战略与任务

| 文档 | 说明 |
|------|------|
| [vision.md](../tactics/vision.md) | 产品愿景与长期方向 |
| [ANNUAL_ROADMAP.md](ANNUAL_ROADMAP.md) | 年度规划大纲（英文） |
| [TASK_PLAN.md](../tasks/TASK_PLAN.md) | **AI 任务计划**：可执行任务清单 + 文件路径 + 验证方式 |
| [3D-RENDERING-PLAN.md](../3D/3D-RENDERING-PLAN.md) | **3D 骨骼渲染攻关**：多 AI 分工流程 + 提示词 + 已知陷阱 |

---

## 🎮 3D 渲染引擎

| 文档 | 说明 |
|------|------|
| [3d-rendering-report.md](../3D/3d-rendering-report.md) | **开发报告**：14 项修复 + Go/WASM 能力对比 + 排查方法论（v1.8.6-v1.8.8） |
| [2026-06-17-summary.md](../3D/2026-06-17-summary.md) | 修复总结：坐标/顶点/合并/纹理/解析 5 类 14 项 |
| [3D/](../3D/) | 3D 渲染文档与测试数据目录 |

---

## 🗂️ 归档文档

历史文档已移至 [archive/](../archive/)（**禁止 AI 读取，已冻结**）：

| 子目录 | 内容 |
|--------|------|
| `postmortem/` | 各阶段复盘（9 篇） |
| `sessions/` | 会话记录与开发笔记（4 篇） |
| `design/` | 计划草案、重构/审计报告、UI 架构（7 篇） |
| `reference/` | 事件目录、分析文档、变更日志（5 篇） |
| `old/` | 早期规划、路线图、QA 清单 |

---

## 🔗 快速跳转

- 根目录：[AGENTS.md](../../AGENTS.md) — AI 协作规则 + 痛苦教训
- 知识卡索引：[knowledge/index.md](../knowledge/index.md) — AI 索引（后端绑定 + 事件总线 + 组件清单，自动生成）
- ADR 索引：[adr/README.md](../adr/README.md) — 架构决策记录登记表（写 ADR 前先占号）
- 前端入口：[frontend/js/app-modules.js](../../frontend/js/app-modules.js)
- Go 入口：[internal/app/](../../internal/app/) — Wails Binding 目录（app.go 已下沉于此）
