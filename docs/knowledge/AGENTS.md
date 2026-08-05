# 知识卡目录 — AGENTS.md

> 本文件是 AI 代理的知识卡分区路由指南。

## 文件结构

```
docs/knowledge/
├── AGENTS.md              ← 本文件（路由指南）
├── index.md               ← 自动生成，知识卡索引
├── routes.md              ← 自动生成，AI 路由表
├── <kind>.md              ← 单张知识卡（kind 为 kebab-case 标识符，与文件名同源）
```

## 知识卡格式（YAML frontmatter）

```yaml
---
kind: event-bus             # kebab-case 标识符，等于文件名（去掉 .md）
name: 事件总线 bus.ts         # 人类可读名称
tier: architecture | leaf    # architecture=核心架构, leaf=叶子节点
category: core               # core|go|ui|feature|utils|config
source_files:                # 必须真实存在于磁盘；仓库相对 POSIX 路径，禁止反斜杠/绝对路径/..；勿指向 bindings/dist/node_modules 等生成物或测试文件（实现放 source_files，测试放 tests:）
  - frontend/src/bus.ts
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
node scripts/check-knowledge-drift.mjs                  # 文本报告（被动：卡间/卡→源码引用漂移）
node scripts/check-knowledge-drift.mjs --json           # JSON（CI 用，doctor --docs 调用）
node scripts/check-knowledge-drift.mjs --affected <f>…  # 主动：源码变更即列出受影响知识卡（治未病）
# 常与 git 联动：git diff --name-only | xargs -I{} node scripts/check-knowledge-drift.mjs --affected {}
```

> 主动防御：`--affected` 接收变更文件清单（仓库相对 POSIX 路径），输出引用了它们的知识卡，
> 供提交前/CI 提示「这些源码改了，下面 N 张卡该复核」。匹配规则：文件精确命中 / 目录前缀命中。
> `--affected --quiet` 仅吐 card stem（每行一个），供钩子机读消费。

**提交期自动提示（非阻断）**：仓库已启用 `prepare-commit-msg` 钩子（`.githooks/prepare-commit-msg` →
`scripts/hooks/knowledge-affected-hint.mjs`）。提交时自动把受影响卡写入 commit message body，随 commit 进 PR：

```text
📚 受影响知识卡（建议同步复核 docs/knowledge）：
- docs/knowledge/resource-registry.md
📚 ──END──
```

- 非阻断：`exit 0` 永不作为；`--amend` 幂等（自动剥离旧区块再重写）；merge/squash 提交跳过。
- 逃生阀：`YSM_SKIP_KNOWLEDGE_HINT=1 git commit`（与 `YSM_SKIP_GATE` 并列）。
- 设计取舍：放在 `prepare-commit-msg` 而非 `pre-push`——push 处于流程末端、阻断体验差、diff 范围过大（整分支累积），不适合做 advisory。


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

- `source_files` **必须**真实存在于磁盘，否则 `check-knowledge-drift.mjs` 报错（[ERROR]）
- `source_files` 路径格式非法（反斜杠 / 绝对路径 / `..` 逃逸）→ [ERROR]；指向生成物（bindings/dist/node_modules）或测试文件 → [WARN]
- `kind` **必须**是 kebab-case，且等于文件名（去掉 .md 后的 kebab 形式）
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
