# 开发者文档索引

> 面向开发者的技术文档入口。用户手册请看 [README.md](../README.md) → [用户指南](用户指南.md)

---

## 📐 核心架构

| 文档 | 说明 |
|------|------|
| [architecture.md](architecture.md) | 前端架构规范：组件拆分、三层解耦、共享工具 |
| [Design.md](Design.md) | UI 设计规范：CSS 变量、4 套主题、布局、字体、颜色规则 |
| [TERMINOLOGY.md](TERMINOLOGY.md) | 术语对照表：名词统一、UI 文案规范、AI 术语索引 |
| [PROJECT_STATUS.md](PROJECT_STATUS.md) | **项目当前状态**：已完成功能、遗留问题、下一步方向 |

---

## 🐛 问题排查

| 文档 | 说明 |
|------|------|
| [bug-chronicle.md](bug-chronicle.md) | Bug 排查记录 + Debug Path Review（核心参考） |
| [pending-cleanup.md](pending-cleanup.md) | 待清理清单：调试代码、临时方案、技术债 |
| [CLEANUP_RULES.md](CLEANUP_RULES.md) | 治理规则：9 条禁止模式 × severity × 检测方式 |
| [DEPRECATED_NAMES.md](DEPRECATED_NAMES.md) | 废弃别名对照：可 grep 批量替换清单 |

---

## 📦 发版记录

| 文档 | 说明 |
|------|------|
| [release-notes/](release-notes/) | 各版本发版说明（按版本号文件夹组织） |
| [release-notes/README.md](release-notes/README.md) | 发版说明索引表 |

---

## 🗂️ 归档文档

历史文档已移至 [archive/](archive/)：

- `old/` — 早期规划、路线图、QA 清单
- `postmortem-*.md` — 各阶段复盘
- `Continue-*.md` / `dev-notes*.md` — 开发笔记
- `plan-p7-*.md` — P7 计划草案
- `audit-summary-*.md` / `refactor-report-*.md` — 审计/重构报告
- `arch-changelog.md` / `event-catalog.md` / `events.md` / `ui-architecture.md` / `test-strategy.md` / `download-mirror-arch.md` / `mmdskin-analysis.md` / `pcl2-comparison.md` / `pack-format-versions.md` / `settings-persistence-postmortem.md`
- 测试数据：`博丽灵梦ysm.json`、`各操作单价（估算）.txt`

---

## 🎯 战略文档

| 文档 | 说明 |
|------|------|
| [tactics/vision.md](tactics/vision.md) | 产品愿景与长期方向 |

---

## 🔗 快速跳转

- 根目录：[AGENTS.md](../AGENTS.md) — AI 协作规则 + 痛苦教训
- 根目录：[AI_INDEX.md](../AI_INDEX.md) — AI 索引（后端绑定 + 事件总线 + 组件清单）
- 前端入口：[frontend/js/app-modules.js](../frontend/js/app-modules.js)
- Go 入口：[app.go](../app.go)