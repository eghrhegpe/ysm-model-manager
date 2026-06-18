# 文件命名规范

> 统一全项目文档与源码命名，让 grep/搜索/向量检索更精准。

---

## 一、文档文件（`docs/` 下所有 .md）

### 规则

| 场景 | 规范 | 示例 |
|------|------|------|
| **技术文档** | `kebab-case`（全小写 + 连字符） | `bug-chronicle.md`、`animation-roadmap.md` |
| **英文专有名词** | 保持原样 | `README.md`、`AI-MODEL-MATRIX.md` |
| **给用户看的文档** | 中文文件名 | `用户指南.md`、`项目意义.md` |
| **版本号文件** | `v{major}.{minor}.{patch}.md` | `v1.8.11.md` |
| **日期前缀** | `YYYY-MM-DD-` 开头 | `2026-06-17-summary.md`、`Continue-2025-06-03.md` |

### ❌ 禁止

- **混用大小写**：同一个目录内不要 `Design.md` 和 `bug-chronicle.md` 混用
- **全大写 + 下划线**（除极少数专有名词外）：`CLEANUP_RULES.md` 是历史遗留，新文件禁止
- **中文 + 英文混写文件名**：标题可以，文件名不行
- **空格**：一律用 `-` 代替

---

## 二、目录命名

| 规则 | 示例 |
|------|------|
| 全小写 + 连字符 | `release-notes/`、`bug-chronicle.md` |
| 英文优先（除非面向用户） | `architecture/` 不是 `架构/` |
| 单数形式 | `tactics/` 不是 `tactic/`，但整体一致即可 |
| 禁止缩写 | `frontend/` 不是 `fe/`，`3D/` 除外（公认缩写） |

### 当前目录（已合规）

```
core/  architecture/  frontend/  tasks/  3D/  release-notes/  tactics/  novel/  archive/  preview/
```

---

## 三、源码文件

详见各子目录约定，以下为全局规则：

| 场景 | 规范 | 示例 |
|------|------|------|
| **Go 文件** | `snake_case` | `app_config.go`、`resource_bindings.go` |
| **JS 模块** | `kebab-case` | `download-queue.js`、`context-menus.js` |
| **JS 组件** | `app-{name}/` 目录 | `app-tree/`、`app-sidebar/` |
| **CSS** | `kebab-case` | `variables.css`、`content-css.js` |

---

## 四、历史遗留（不要模仿）

以下文件命名不符合规范，但因历史悠久暂不重命名。**新文件禁止仿照：**

| 文件 | 问题 | 应改为 |
|------|------|--------|
| `CLEANUP_RULES.md` | SCREAMING_SNAKE_CASE | `cleanup-rules.md` |
| `SKILL.md` | 全大写 | `skill.md` |
| `TERMINOLOGY.md` | 全大写 | `terminology.md` |
| `Design.md` | PascalCase | `design.md` |
| `DEPRECATED_NAMES.md` | SCREAMING_SNAKE_CASE | `deprecated-names.md` |
| `PROJECT_STATUS.md` | SCREAMING_SNAKE_CASE | `project-status.md` |
| `ANNUAL_ROADMAP.md` | SCREAMING_SNAKE_CASE | `annual-roadmap.md` |
| `SESSION_HANDOFF.md` | SCREAMING_SNAKE_CASE | `session-handoff.md` |

---

## 五、新文件 checklist

创建新文档前，依次确认：

- [ ] 文件名全小写 + `-`（除非是用户向中文文档）
- [ ] 放对目录（查 `AGENTS.md` 文档地图）
- [ ] 目录已存在（不在文档地图的目录 = 不存在）
- [ ] 没有同义文件（先 grep 关键词）
- [ ] 在 `AGENTS.md` 文档地图中注册（如果是常用参考文档）
