# 知识卡目录 — AGENTS.md

> 本文件是 AI 代理的知识卡分区路由指南。

## 文件结构

```
docs/knowledge/
├── AGENTS.md              ← 本文件（路由指南）
├── index.md               ← 自动生成，知识卡索引
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
affected: false              # 可选，仅接受 false：快照/报告型卡（如整包审计）退出 --affected 匹配——source_files 只服务覆盖率统计，不随单次文件变更提示复核
perf:                        # 可选，性能画像标签（受控词表 = scripts/_lib/knowledge-cards.ts PERF_TAGS）
  - cpu-bound                # 词表：cpu-bound|io-bound|gpu-bound|concurrent|single-thread|memory-heavy
---
# {name}

## 概览 / 核心职责 / 对外 API / 与其他子系统关系 / 不变量 / 相关
```

## 工作流

### 查询

1. 用户提问 → 查 `routes-quick.md`（AI 第一站）→ `routes.md`（意图路由表，自动生成）兜底命中首选知识卡
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
`scripts/hooks/knowledge-affected-hint.mjs`）。提交时自动把受影响卡以**终端 stderr** 提醒（不写入 commit message body，因为 code review 不核验文档，写入 body 无受益方）：

```text
[prepare-commit-msg] 📚 2 张知识卡受影响，建议复核：
  - docs/knowledge/resource-registry.md
  - docs/knowledge/go-avatar.md ⚠️ 疑似过时（本次 diff 已引入新写法）:
      L23 mouseDown handler（仍用 mousedown，建议 pointerdown）
（仅终端提醒）
```

- 非阻断：`exit 0` 永不作为；merge/squash 提交跳过
- 疑似过时句检测：diff 新增行引入新关键词（如 `pointerdown`）而卡正文仍写旧词（如 `mousedown`），精确指行
- 逃生阀：`YSM_SKIP_KNOWLEDGE_HINT=1 git commit`
- 设计取舍：放在 `prepare-commit-msg` 而非 `pre-push`——push 处于流程末端、阻断体验差、diff 范围过大（整分支累积），不适合做 advisory

**索引/生成物同步（pre-commit）**：`.githooks/pre-commit` 在 commit 时自动跑秒级 gen（清单以 `GEN_CMDS` 为准）并以 mtime/size 快照 diff 只 stage 本次 gen 实际 touch 的文件，不再无差别 `git add docs/`；失败仅提示不阻断；逃生阀 `YSM_SKIP_GEN=1`。知识卡 index/字段同步无需手动跑。

**暂存残留自清（post-commit）**：`.githooks/post-commit` 在 commit 后自动清「路径限定提交（`git commit -- <paths>`）遗留的索引残留」——pre-commit 钩子 gen+stage 的生成物在 --only 语义下不被路径限定提交消费，索引残留导致 `git status` 恒显示 MM 噪音（实测 `git diff HEAD` 为空但 MM 常驻，高推理 AI 误判工作区脏空转多轮）。钩子遍历有暂存差异的文件，仅当「工作树 == HEAD（无真实未提交改动）」时 `git restore --staged` 清残留；真实改动（工作树 != HEAD，含并行会话半成品）保持诚实显示不动。逃生阀 `YSM_SKIP_POSTCLEAN=1`。
- **对照实验（2026-08-31 实战复现）**：无 pre-commit 钩子 + 路径限定提交 → status 干净、提交 1 文件；有钩子（gen+stage）+ 路径限定提交 → 提交含钩子 stage 的生成物**且 MM 残留复现**。残留确为钩子引入的真实现象（非理论臆测）；post-commit 实测清掉。兄弟 AI 再质疑「残留子虚乌有」时以此数据为准。
- **陷阱**：`git commit -- <path>`（--only）从 HEAD 派生 temp index，**不记录索引中的 mode 变更**（`git update-index --chmod=+x` 后路径限定提交 HEAD 仍 100644 → 永久 mode 残留且 post-commit 守卫把 mode 差异当真实改动跳过）；钩子脚本的 mode 修正需**全量提交**（无 paths）落索引 mode。


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
- `perf` 标签**必须**在 PERF_TAGS 词表内（cpu-bound / io-bound / gpu-bound / concurrent / single-thread / memory-heavy），词表外 → [ERROR]；扩展新维度只改词表常量
- 生成物（`index.md`）**禁止手改**
- 卡片正文为人工维护内容，生成物仅为索引

## 脚本体系

| 脚本 | 用途 |
|------|------|
| `scripts/_lib/frontmatter.ts` | frontmatter 解析共享库 |
| `scripts/_lib/knowledge-cards.ts` | 知识卡常量共享层（KNOWLEDGE_ORDER / CATEGORY_LABELS / NON_CARDS / PERF_TAGS） |
| `scripts/gen-knowledge-index.mjs` | 按分类生成 `index.md` |
| `scripts/gen-routes.mjs` | AI 意图路由表自动生成（`routes.md`） |
| `scripts/gen-routes-quick.mjs` | AI 高频路由表自动生成（`routes-quick.md`，第一站） |
| `scripts/check-knowledge-drift.mjs` | 知识卡漂移检查（ERROR/WARN） |
| `scripts/new-knowledge-card.mjs` | 卡片模板生成器 |
