# 知识卡系统

> 可验证的文档联邦 — 每卡一份源码快照，机器可校验

## 快速开始

```bash
# 新建知识卡
node scripts/new-knowledge-card.mjs <kind> <name> <category> <source_file> [--leaf]

# 漂移检查
node scripts/check-knowledge-drift.mjs

# 重新生成索引 + 路由
node scripts/gen-knowledge-index.mjs
node scripts/gen-routes.mjs
```

## 文件

| 文件 | 说明 |
|------|------|
| `AGENTS.md` | 分区路由指南（必读） |
| `index.md` | 分类索引（自动生成） |
| `routes.md` | AI 路由表（自动生成） |
| `<kind>.md` | 知识卡（kind 为 snake_case） |

## 约束

- `source_files` **必须**真实存在于磁盘
- `kind` = 文件名，snake_case
- 生成物（`index.md`/`routes.md`）**禁止手改**
- H1 标题 = `name` 字段
