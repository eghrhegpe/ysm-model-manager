---
name: release-notes-gen
description: 发版说明生成器。分析 git 改动数据，按项目模板写出 v{X.Y.Z}.md。
runAs: subagent
---

# 发版说明生成器

## 工作流程

1. **收集数据**：运行 `python3 scripts/release-notes-gen.py`，获取结构化 JSON
2. **读模板**：读取 `docs/release-notes/README.md` 了解格式规则和最新版本号
3. **读最新版本**：读取最近一条发版说明（如 `docs/release-notes/v1.9.1.md`）了解格式
4. **确定版本号**：在最新版本号上 +1（patch 或 minor，根据改动量判断）
5. **写文件**：创建 `docs/release-notes/v{X.Y.Z}.md`，格式参照现有版本

## 格式规范

- 标题：`# vX.Y.Z — 简短短语`
- 日期：`**发布日期：** YYYY-MM-DD`
- 用 `## 🏗` / `## 🐛` / `## ✨` / `## 📚` / `## 🔧` / `## 🧪` 等 emoji 小节标题
- 表格 > 段落
- 末尾加 `## 📊 统计` 列出文件数/增删行数

## 输出

完成后在当前目录创建 `docs/release-notes/v{X.Y.Z}.md`。
