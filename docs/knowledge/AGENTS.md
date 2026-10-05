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
| `source_files` / `tests` / `symbols` / `auto_fields.symbols_with_lines`（纯符号名无行号，ADR-162） | 机器推导 | gen 脚本自动 | ERROR 阻断 |
| `use_when`(≤8) / `quick_intents`(≤5) / `pitfalls` / `quick_risk_lines` / 正文 | 人工策展：用户自然语言关键词与陷阱 | 手写 | WARN |
| `quick_groups` | **受控词表**（`scripts/_lib/knowledge-cards.ts` QUICK_GROUPS，14 组，数组序 = 路由表渲染序）：词表外组名入 routes-quick「未归类」桶并 WARN；新增合法组名只改词表常量，勿在卡里发明野生组名。`quick_risk_lines` 写面向 AI/人的自然语言，禁写 `文件\|符号` 锚语法（那是 `invariant_anchors` 的语法） | 手写 | 词表外 WARN |
| `invariant_anchors`（`文件\|符号`） | 机制锚点，architecture 卡必须声明 | 手写声明 + 机器校验存在性 | ERROR 阻断 |
| `affected: false` | 仅此值合法：快照/报告型卡退出 `--affected` 匹配 | 手写 | — |
| `status` | 卡生命周期（受控词表 `scripts/_lib/knowledge-cards.ts` CARD_STATUS）：`active`（默认，随源码演进）/ `draft`（起草中，`new-knowledge-card.ts` 模板默认，定稿后改 active）/ `snapshot`（一次性快照/报告，**应配 `affected: false`**）/ `archived`（已归档）/ `superseded`（被取代，应在正文标注取代关系）。区别于 ADR 采纳状态（`adr-status-categories.ts`） | 手写 | 词表外 ERROR；snapshot 缺 `affected: false` WARN |
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
- `quick_groups` 与 `quick_intents` 按位置 1:1 配对：「1 个分组 + 多条意图」是常态（gen-routes-quick 全部并入该组、不鸣笛）；分组数 >1 时须与意图数等长，避免多余意图并入末组造成错位（gen-routes-quick 对多分组不均打 WARN）
- **正文引用一律写「`文件\|符号`」/「`文件`」**，禁止硬编码行号（`L123`）、行号区间（`L100-200`）、行数（`888 行`）、计数（`8 个能力`）——ADR-162 去行号精神延伸到散文层：行号位移会静默漂移且无人维护（实证 mount3d-584-giant 三层行号漂移），符号存在性由机器校验（check-knowledge-drift WARN 检测，见检查 5.9）。快照/报告卡（`affected: false`）豁免——行号是「当时」事实记录
- **快照卡终局 = 归档迁出**：`status: snapshot` 且不再被在途工作引用的一次性报告卡，`git mv docs/archive/`（2026-10-04 首批 8 卡：该目录是 `.vitepress/config.mjs` srcExclude 预留的冻结区——不入站点、sidebar 分区制不收录、退出卡片机器）。迁后正文相对链接改 `../knowledge/`、`../adr/`，全仓入链同步改指新路径
- **迁出前三查：读文档的代码路径也在链上**（2026-10-05 实证：`7b6cec715` 迁 `optimization_log.md` 只改了 md 相对链接，漏改 `go/cli/perf.go|findOptimizationLog` 的代码侧硬编码路径 → `perf-log` 命令与 `go/cli` 全量测试红了 44 个提交才被发现，且 `check-doc-drift` 全绿——它只盯文档链接，看不见代码里的路径字面量）。① 代码/脚本里读 `docs/**` 的路径字面量（`grep -rn "docs/knowledge" --include=*.go --include=*.ts`）；② 吃文档**内容**的解析器测试对路径漂移**失明**（解析成功但路径错，测试照样绿）——须有一条直接断言「能定位到真实文件」的路径测试；③ 生成物/清单类文件（sidebar、索引、baseline 账本）。改法优先「多候选逐个探测」而非硬改单路径：文档再搬家只需加候选，不必记得回来改代码（`go/cli/perf.go` 现有 knowledge→archive 两候选即此范式）
- `index.md` 等生成物禁止手改；卡片正文为人工维护内容
