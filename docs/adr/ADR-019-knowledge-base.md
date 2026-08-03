# ADR-019：知识卡体系

- **状态**：✅ 已采纳
- **日期**：2026-08-03
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`docs/knowledge/`（18 个文件）/ `scripts/gen-knowledge-index.mjs` / `scripts/check-knowledge-drift.mjs` / `scripts/gen-routes.mjs` / `scripts/new-knowledge-card.mjs` / ADR-013 / 联邦 MikuMikuAR `docs/knowledge/`（适配来源）

---

## 1. 背景（Context）

项目知识沉淀分散在架构文档与散落 md 中，AI 与新人检索成本高：

- **无统一 schema**：模块知识散落各处，无 frontmatter 元数据，无法按类型/层级程序化索引；
- **无程序化入口**：AI 检索依赖人工记忆路径，`use_when` 关键词 → 知识卡的映射缺失；
- **漂移无检测**：知识卡 `source_files` 指向的源码路径变更后，卡片悄悄过期，无人知晓；
- **与治理体系脱节**：ADR-013 Phase 3 遗留「`docs/knowledge/` 与 `architecture.md` 职能重叠边界未声明」；
- **联邦已有成熟方案**：MikuMikuAR 已建知识卡体系（frontmatter + 索引生成器 + 漂移检查），可直接适配搬运。

## 2. 决策（Decision）

**决策**：建立 `docs/knowledge/` 知识卡体系——统一 frontmatter schema + 三脚本机制（生成索引 / 漂移检查 / 路由表）+ 脚手架，作为模块知识的程序化入口。技术细节如下。

### 2.1 frontmatter schema（单一事实来源）

每张知识卡首部携带结构化元数据：

| 字段 | 说明 | 校验规则 |
|------|------|---------|
| `kind` | 卡标识（snake_case） | 匹配 `^[a-z][a-z0-9_]*$`；禁止 `<...>` 占位符 |
| `name` | 展示名 | 与 H1 标题一致（WARN 级） |
| `tier` | 层级 | 值域 `architecture` / `leaf` |
| `category` | 分类 | 值域 `core` / `go` / `ui` / `feature` / `utils` / `config` |
| `source_files` | 关联源码路径 | 必须指向磁盘存在的文件（ERROR 级） |
| `use_when` | 检索关键词 | 供路由表生成 |

必填字段：`kind` / `name` / `category` / `tier`（缺失为 ERROR）。

### 2.2 三脚本机制

| 脚本 | 职责 | 触发 |
|------|------|------|
| `gen-knowledge-index.mjs` | 按 category 分组生成 `index.md`（GEN 区） | `node scripts/gen-knowledge-index.mjs` / `--check` |
| `check-knowledge-drift.mjs` | 漂移检查：source_files 存在性、必填字段、值域、kind 命名、H1 一致性、索引链接 | `node scripts/check-knowledge-drift.mjs`（ERROR 阻断） |
| `gen-routes.mjs` | 由 `use_when` 生成 `routes.md`（用户自然语言 → 知识卡映射） | `node scripts/gen-routes.mjs` / `--check` |

辅助：`new-knowledge-card.mjs` 脚手架（`<kind> <name> <category> <source_file> [--leaf]`）生成卡模板。

### 2.3 检索协议

- AI 处理任务时先查 `routes.md` 路由表定位关键词 → 读 `index.md` 枢纽索引 → 按卡的 `source_files` 跳转源码；
- 知识来源优先级：当前源码 > `docs/adr/` > `docs/knowledge/` > `docs/architecture/architecture.md`；
- 知识卡与源码不一致时报告文档漂移，以源码为准。

### 2.4 与 ADR-013 的关系

ADR-013 Phase 3 遗留的「knowledge 与 architecture.md 职能重叠」边界，本 ADR 收口：`docs/knowledge/` 承载**模块级程序化知识卡**（frontmatter 驱动、可校验），`architecture.md` 承载**全局架构叙述**（人工维护、无 schema）。二者互补不重叠。

## 3. 后果（Consequences）

### 正面

- AI 检索从「人工记忆路径」升级为「路由表 → 索引 → 源码」程序化链路；
- 漂移检测（source_files 指向、schema 值域、索引链接）让知识卡不再静默过期；
- 与联邦知识卡 schema 对齐，工具链可双向搬运；
- `kind`/`category`/`tier` 元数据为后续统计、覆盖率分析提供基础。

### 负面

- 新增模块知识需先跑脚手架生成卡模板（多一步仪式）；
- `index.md` / `routes.md` 为生成产物，禁止手改（GEN 区约定）；
- 卡片数量增长后，`use_when` 关键词可能重叠，需维护消歧。

### 已知遗留

- 符号级覆盖率（每张卡对应源码符号的引用追踪）未实现——联邦有该能力，YSM 规模暂不需要；
- `AGENTS.md` 中残留的手写目录树由漂移检查 WARN 提示，人工收敛。

## 4. 数据溯源

| 来源 | 结果 |
|------|------|
| 联邦 MikuMikuAR `docs/knowledge/` | frontmatter schema / 索引生成器 / 漂移检查适配来源（check-knowledge-drift 头注释自述） |
| `scripts/gen-knowledge-index.mjs` | CATEGORY_LABELS 六分类（core/go/ui/feature/utils/config） |
| `scripts/check-knowledge-drift.mjs` | 检查项枚举（必填字段 / 值域 / kind 命名 / source_files / 索引链接） |
| `scripts/gen-routes.mjs` | use_when → 路由表映射机制 |
| `docs/knowledge/` | 18 个文件（含 index.md / routes.md / README.md / AGENTS.md） |
| ADR-013 | Phase 3 遗留「knowledge vs architecture.md 职能重叠」待决 |

<!-- 文件名: knowledge-base.md → 实际文件 ADR-019-knowledge-base.md -->
