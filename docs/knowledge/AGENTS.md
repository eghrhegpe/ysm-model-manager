# 知识卡目录 — AGENTS.md

> 本文件是 AI 代理的知识卡分区路由指南。

## 文件结构

```
docs/knowledge/
├── AGENTS.md              ← 本文件（路由指南）
├── index.md               ← 自动生成，知识卡索引
├── routes.md              ← 自动生成，AI 路由表
├── <kind>.md              ← 单张知识卡（kind 为 snake_case 标识符）
```

## 知识卡格式（YAML frontmatter）

```yaml
---
kind: event_bus              # snake_case 标识符，也是文件名
name: 事件总线 bus.js         # 人类可读名称
tier: architecture | leaf    # architecture=核心架构, leaf=叶子节点
category: core               # core|go|ui|feature|utils|config
source_files:                # 必须真实存在于磁盘
  - frontend/js/bus.js
use_when:                    # 用户自然语言关键词
  - 事件
  - 事件总线
---
# {name}

## 概览 / 核心职责 / 对外 API / 与其他子系统关系 / 不变量 / 相关
```

## 工作流

### 查询

1. 用户提问 → 查 `routes.md` 匹配关键词
2. 打开对应 `kind.md` 获取上下文
3. 需要源码细节 → 按 `source_files` 路径跳转

### 新建卡片

```bash
node scripts/new-knowledge-card.mjs <kind> <name> <category> <source_file> [--leaf]
# 例: node scripts/new-knowledge-card.mjs go_dedup "去重 go/dedup" go go/dedup/
```

### 更新索引（生成物，不手改）

```bash
node scripts/gen-knowledge-index.mjs
node scripts/gen-routes.mjs
```

### 漂移检查

```bash
node scripts/check-knowledge-drift.mjs            # 文本报告
node scripts/check-knowledge-drift.mjs --json     # JSON（CI 用）
```

## 分类映射

| category | 用途 |
|----------|------|
| core | 核心基础设施（事件总线、页面状态、Wails 桥接） |
| go | Go 后端包（安装、下载、回收站、YSM 解析等） |
| ui | 前端 UI 组件（tree、sidebar、preview、content） |
| feature | 业务功能（导入队列、同步、社区） |
| utils | 工具函数（display、fmt、dom、animation） |
| config | 配置与注册表（resource_types、AppConfig） |

## 约束

- `source_files` **必须**真实存在于磁盘，否则 `check-knowledge-drift.mjs` 报错
- `kind` **必须**是 snake_case，且与文件名一致
- `name` **必须**等于 H1 标题
- 生成物（`index.md`、`routes.md`）**禁止手改**
- 卡片正文为人工维护内容，生成物仅为索引/路由

## 脚本体系

| 脚本 | 用途 |
|------|------|
| `scripts/_lib/frontmatter.mjs` | frontmatter 解析共享库 |
| `scripts/gen-knowledge-index.mjs` | 按分类生成 `index.md` |
| `scripts/gen-routes.mjs` | 按 `use_when` 生成 `routes.md` |
| `scripts/check-knowledge-drift.mjs` | 知识卡漂移检查（ERROR/WARN） |
| `scripts/new-knowledge-card.mjs` | 卡片模板生成器 |
