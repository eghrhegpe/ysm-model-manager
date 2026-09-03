# 知识卡目录 — AI 路由指南

> 按需细读本文件；注入场景只保留核心规则。生成物/命令细节见 `scripts/README.md`。

## 文件结构与查询

`docs/knowledge/` 下：`AGENTS.md`（本文件）+ `index.md`（生成物，禁手改）+ `<kind>.md`（单卡，kind = 文件名 kebab-case）。

查询：`routes-quick.md`（第一站）→ `routes.md` 兜底 → 打开 `kind.md` → 按 `source_files` 跳源码。

## 卡片格式

frontmatter 必填字段：`kind`（kebab-case，=文件名）/ `name`（=H1 标题）/ `tier`（architecture|leaf）/ `category`（core|go|ui|feature|rendering|utils|config）/ `source_files`（真实存在的仓库相对 POSIX 路径）。正文骨架：概览 / 核心职责 / 对外 API / 与其他子系统关系 / 不变量 / 相关。

完整 YAML 示例与字段语义：`node scripts/new-knowledge-card.ts` 生成的模板即是范本。补充语义：

| 字段 | 语义 | 维护 | drift |
|------|------|------|-------|
| `source_files` / `tests` / `symbols` / `auto_fields.symbols_with_lines`（纯符号名无行号，ADR-159） | 机器推导 | gen 脚本自动 | ERROR 阻断 |
| `use_when`(≤8) / `quick_intents`(≤5) / `pitfalls` / `quick_groups` / `quick_risk_lines` / 正文 | 人工策展：用户自然语言关键词与陷阱 | 手写 | WARN |
| `invariant_anchors`（`文件\|符号`） | 机制锚点，architecture 卡必须声明 | 手写声明 + 机器校验存在性 | ERROR 阻断 |
| `affected: false` | 仅此值合法：快照/报告型卡退出 `--affected` 匹配 | 手写 | — |
| `perf` | 受控词表（`scripts/_lib/knowledge-cards.ts` PERF_TAGS）：cpu-bound\|io-bound\|gpu-bound\|concurrent\|single-thread\|memory-heavy | 手写 | 词表外 ERROR |

## 常用命令

```bash
node scripts/new-knowledge-card.ts <kind> <name> <category> <source_file> [--leaf]  # 新建（模板即格式范本）
node scripts/check-knowledge-drift.ts --affected <f>…  # 源码变更 → 受影响卡清单；--quiet 吐卡名供钩子机读
node scripts/check-knowledge-drift.ts [--json]         # 被动全量漂移检查（--json 供 doctor --docs/CI）
```

index.md 由 pre-commit 钩子自动 gen+stage，无需手动 `gen-knowledge-index.ts`。

## 钩子行为（全部非阻断，细节读 .githooks/ 对应脚本）

- **pre-commit**：GEN_CMDS 秒级 gen + 只 stage 实际 touch 的生成物（逃生阀 `YSM_SKIP_GEN=1`）
- **prepare-commit-msg**：终端 stderr 提示受影响知识卡及疑似过时句（不写入 commit body；逃生阀 `YSM_SKIP_KNOWLEDGE_HINT=1`）
- **post-commit**：清「路径限定提交遗留的索引残留」——识别口诀 **MM 但 `git diff HEAD` 为空 = 索引残留，钩子自清，勿空转排查**（实验证据与 --only 不记录 mode 变更的陷阱：`docs/archive/bug-chronicle.md` #27；逃生阀 `YSM_SKIP_POSTCLEAN=1`）

## 约束（drift 检查硬规则）

- `source_files` 必须真实存在（[ERROR]）；格式非法（反斜杠/绝对路径/`..` 逃逸）[ERROR]；指向生成物（bindings/dist/node_modules）或测试文件 [WARN]
- `kind` = 文件名 kebab-case；`name` = H1 标题
- `perf` 标签必须在 PERF_TAGS 词表内；扩展新维度只改词表常量
- `index.md` 等生成物禁止手改；卡片正文为人工维护内容
