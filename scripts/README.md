# 脚本体系全景

> 所有 Node 工具脚本的索引（2026-08-03 由 Python 全量迁移，统一运行时便于多项目共用）。
> 由 `doctor.mjs` / CI / 手动命令直接调用（口令约定见 AGENTS.md 硬约束；原 `.agents/skills/` 已于治理收敛中删除，能力由本目录脚本承接）。

## 脚本文件头规范（统一约定）

> 本仓库与 MikuMikuAR 共用同一套 `.mjs` 文档约定，确保跨项目可迁移、可机读。
> 规范由 `scripts/check-script-hygiene.mjs` 校验（`--json` / `--strict`）；决策基线见联邦仓库 **ADR-241**（MikuMikuAR/docs/adr/adr-241-mjs-script-doc-convention.md）。

每个 `scripts/*.mjs`（不含 `_` 前缀共享层 `_lib/`）必须在文件顶部保留 JSDoc 头，且至少包含以下字段：

1. **文件名 + 一句话描述**：`* <name>.mjs — <功能描述>。`
2. **设计意图**（推荐）：1–2 句说明为什么存在 / 适用场景。
3. **依赖声明**：`零依赖（node:fs / node:path / node:url）` 或列出外部依赖。
4. **用法**：`用法：` 块，含默认行为 + `--json`（如适用）示例，命令统一 `node scripts/<name>.mjs ...`。
5. **退出码**：`退出码：发现 ERROR → 1；否则 0（WARN/INFO 不阻断）。`

硬规则：
- 检查类脚本（`check-*` / `*-check` / `review` / `doctor` / `link-checker` / `type-consistency` / `event-audit` / `binding-check`）必须支持 `--json` 或默认输出 JSON，供 CI / 子代理稳定消费。
- 共享能力（`walk` / `rg` / `ROOT` / `frontmatter` 解析）一律 `import` 自 `scripts` 共享层，**禁止内联通用样板**；领域专用的文件收集器（带扩展名过滤 / 跳过集合 / 回调，如 `gen-vitepress-sidebar` 的 md walker）属合法内联，不计入违规。
- 公共函数需写 `/** */` 简述；纯内部小工具可不写。

范例见 `comment-checker.mjs`、`adr-check.mjs`（已按本规范整改）。

> 执行状态：本仓库已落地 `check-script-hygiene.mjs`（与 MikuMikuAR 同款，四口径：退出码失效 / 共享层内联 / `--json` 契约 / 文件头 5 字段）；运行 `node scripts/check-script-hygiene.mjs [--json|--strict]` 即可机检本规范。

---

## 按用途分档

### 生产级（`--json` 支持子代理消费）

| 脚本 | 调用方式 | 说明 |
|------|---------|------|
| `check-redlines.mjs` | `node scripts/check-redlines.mjs` / `--json` / `--audit` | 12 条治理红线（R1-R9 + W1/W2/W5）+ `--audit` 设计审查 checklist（B 类盘问锚点）；W3/W4 已移交 comment-checker |
| `type-consistency.mjs` | `node scripts/type-consistency.mjs` / `--json` | resource_types.json vs JS 扩展名一致性 |
| `link-checker.mjs` | `node scripts/link-checker.mjs` / `--json` | 所有 md 内部链接断链检测 |
| `release-notes-gen.mjs` | `node scripts/release-notes-gen.mjs` | git diff + commit 归类 → 结构化 JSON |
| `bug-search.mjs` | `node scripts/bug-search.mjs <关键词>` / `--json` | 搜索 bug-chronicle.md |

### 实用级

| 脚本 | 调用方式 | 说明 |
|------|---------|------|
| `funcmap.mjs` | `node scripts/funcmap.mjs -o funcmap.md` | 提取 Go/JS/TS 导出符号映射表（按模块分组，参考 MikuMikuAR 风格） |
| `doctor.mjs` | `node scripts/doctor.mjs` | Go 编译 + 单测 + 前端构建 + **前端单测（vitest，ADR-023 P3）** + tsc + 文件 + 红线 + 静态分析（含 check-layering 分层守护）+ Git（原 ultrawork 一键三连已并入，ultrawork.mjs 删除） |
| `comment-checker.mjs` | `node scripts/comment-checker.mjs` / `--json` / `--full` | 注释质量（废话/JSDoc/TODO/调试日志）；`--json` 默认每类截断 50 条 + `_summary` 分类计数，`--full` 全量（防 wasm base64 超长行误报/爆炸） |
| `event-audit.mjs` | `node scripts/event-audit.mjs` / `--json` | EventsOn/bus.on 注册位置检查 |
| `binding-check.mjs` | `node scripts/binding-check.mjs` | Go 导出函数 vs v3 bindings 产物（`-ts` 契约 app.ts）一致性 |
| `adr-check.mjs` | `node scripts/adr-check.mjs` | ADR 登记表 vs 磁盘对账（防撞号/漏登/幽灵） |
| `ai-mistake-tracker.mjs` | `node scripts/ai-mistake-tracker.mjs` / `--limit N` / `--json` | 分析 git 历史找 AI 高频犯错区（fix 分类统计 / 连续修复链 / 文件热力图 / 规则违反扫描），反哺 AGENTS.md 陷阱清单 |
| `codemod.mjs` | `node scripts/codemod.mjs help` / `rename-function` / `move-function` / `add-param` | AST 感知重构（ts-morph）：批量重命名 / 移函数（自动迁 import）/ 加参数；move 不重写外部引用方，改后跑 tsc |
| `inspect_ysm.mjs` | `node scripts/inspect_ysm.mjs <文件>` / `--json` | YSM 文件格式诊断（合并 v1-v5 的统一版） |
| `test-coverage-report.mjs` | `node scripts/test-coverage-report.mjs` / `--json` / `--top N` | 读 vitest v8 coverage 产物输出未覆盖清单（文件+行+函数，升序），供补测决策；需先跑 `npm run test:coverage` |
| `line-counter.mjs` | `node scripts/line-counter.mjs` | 代码行数统计与文件健康度分析（由 line-counter.py 迁移，含 package_lines 按文件计数行为） |
| `pre-push-gate.mjs` | `node scripts/pre-push-gate.mjs <remote> <url>`（.githooks/pre-push 调度器）/ `--dry-run` | 本地质量门禁：按变更域（Go/前端/数据/文档）只跑相关检查；前端域含 **check-layering 分层硬门禁**（反向依赖阻断）；gofmt 自动修复并 amend，构建/断链/契约失败阻断推送 |
| `.githooks/pre-commit`（薄壳） | commit 时自动执行（无需手打） | 秒级文档/索引自动同步：跑 10 个 gen（docs 分区索引 / funcmap / 知识卡 index+字段 / novel 索引 / project-map / vitepress sidebar）后 `git add docs/`（幂等：无漂移零副作用）；失败仅提示不阻断；输出走 stderr；逃生阀 `YSM_SKIP_GEN=1` |

### 治理检查（check-* 系列；唯一登记处，AGENTS.md §1.2 仅作指针）

| 脚本 | 调用方式 | 说明 |
|------|---------|------|
| `check-doc-drift.mjs` | `node scripts/check-doc-drift.mjs` / `--fix` | 文档三一致：ADR 登记 + 知识卡 + 架构树引用（ERROR 阻断；`--fix` 刷新架构树基线） |
| `check-adr-health.mjs` | `node scripts/check-adr-health.mjs` / `--debt` | ADR 状态机值域 / 登记表同步 / 技术债清单 |
| `check-deadcode-baseline.mjs` | `node scripts/check-deadcode-baseline.mjs` / `--update-baseline` | knip+jscpd 与 `scripts/baseline/deadcode-baseline.json` 对比，新增项阻断 |
| `check-orphan-exports.mjs` | `node scripts/check-orphan-exports.mjs` / `--strict` / `--min-consumers N` | 孤儿导出审计（零消费者符号；默认审计仅报告 rc=0，`--strict` 孤儿>0 时 rc=1 阻断；与联邦 check-consumers 同名异实，ADR-241 §Phase 2） |
| `check-circular.mjs` | `node scripts/check-circular.mjs` | frontend/src ESM import 图找环（ERROR 阻断） |
| `check-layering.mjs` | `node scripts/check-layering.mjs` / `--json` / `--update` | 前端分层依赖方向守护：R1/R2 零容忍（utils/services 不碰 UI 层）+ R3/R4 基线防新增（core→上层 / features→views，现有债务入 `docs/.layering-baseline.json` 待清理）；`import type` 豁免；源自 MikuMikuAR ADR-242 骨架适配，配套 `tests/test_check_layering.mjs` |
| `check-circular-go.mjs` | `node scripts/check-circular-go.mjs` / `--json` | Go 包级循环依赖检测（`go/` 目录下 import 图找环；ERROR 阻断，`--json` 供 CI 消费） |
| `check-boolean-naming.mjs` | `node scripts/check-boolean-naming.mjs` / `--strict` | 布尔变量命名规范 |
| `check-script-hygiene.mjs` | `node scripts/check-script-hygiene.mjs` / `--json` / `--strict` | 脚本卫生：退出码失效（裸 main + return 失败码无 process.exit）/ 共享层内联（walk/rg/ROOT 样板）/ 检查类缺 `--json` 契约（WARN 不阻断） |
| `auto-import.mjs` | `node scripts/auto-import.mjs` / `--fix` / `--watch` / `--strict` | TS/JS 缺失 import 检测（ADR-014 伴生，已接入 doctor 静态分析） |
| `gen-adr-supersede.mjs` | `node scripts/gen-adr-supersede.mjs` / `--check` | ADR 取代关系判定（五层证据：已登记 / 漏标 / 废弃未指明 / 可疑 / 表格弱宣称）；`--check` 仅漏标失败退出 1（供 check:docs） |
| `check-dynamic-import.mjs` | `node scripts/check-dynamic-import.mjs` / `--json` | 动态 import() 合理性审查（对照 app_modules 规范：失败处理缺失 / 空 catch 吞错 / .js 后缀残留 / 轻量工具模块误动态导入；WARN 阻断） |
| `check-tpl-refs.mjs` | `node scripts/check-tpl-refs.mjs` / `--json` | 前端 JS id 引用 ↔ 模板定义交叉核对：引用有定义无 → ERROR 断链阻断（幽灵 id 守护） |
| `wails3-cli-check.mjs` | `node scripts/wails3-cli-check.mjs` / `--json` | Wails v3 CLI 拼写检查：活跃路径裸 `wails X`（非 wails3）→ ERROR（v2→v3 回归守护，2026-08-05 绑定教训） |
| `check-diff-coverage.mjs` | `node scripts/check-diff-coverage.mjs` / `--json` / `--suggest` / `--staged` / `--uncommitted` / `--threshold N` | 变更文件覆盖率门禁（diff-coverage gate）：只查本次 git 变更的非测试源码「变更行覆盖率」，低于阈值阻断（保护新代码有测试）；`--suggest` 非阻断建议（输出 commit message 区块）；源自 MikuMikuAR P8-A 适配，配套 `tests/test_check_diff_coverage.mjs` |

> 基线文件位于 `scripts/baseline/`（`deadcode-baseline.json` / `doc-drift-baseline.json`），刷新基线用对应脚本的 `--update-baseline` / `--fix`。

### 生成器（Node）

| 脚本 | 说明 |
|------|------|
| `gen-knowledge-index.mjs` | 知识卡索引生成（docs/knowledge/index.md） |
| `check-knowledge-drift.mjs` | 知识卡漂移检查（含代码→卡片覆盖盲区 WARN；`--affected <文件...>` 主动列出受源码变更影响的知识卡；`--affected --quiet` 机读模式供钩子消费） |
| `hooks/knowledge-affected-hint.mjs` | `prepare-commit-msg` 钩子辅助脚本：stderr 摘要提示受影响知识卡（非阻断、幂等，AI 终端可见），并检测「本次 diff 已引入新写法而卡仍写过时旧词」的疑似过时句精确指行（ADR-047 增强，迁移对表 STALE_KEYWORD_PAIRS），归一化 Git Bash msys 路径 |
| `hooks/coverage-suggest-hint.mjs` | `prepare-commit-msg` 钩子辅助脚本：低于语句覆盖率阈值的源文件写入 commit message body，随 commit 进 PR 供 review 参考补测方向（非阻断、幂等；逃生阀 `YSM_SKIP_COVERAGE_HINT=1`）；v2：并入 **check-diff-coverage --suggest --staged** 的「📈 变更行覆盖率建议」区块（本次暂存变更文件，双区块幂等剥离） |
| `gen-knowledge-symbols.mjs` | 知识卡 `symbols:` 字段同步（源码导出符号提取，JS/TS + Go 双栈，gen/--check） |
| `gen-knowledge-h1.mjs` | 知识卡正文补 `# <name>` 标题（frontmatter 后插入，已有 h1 跳过） |
| `gen-knowledge-adr.mjs` | 知识卡 `adr:` 关联补全（扫描源码 `[doc:adr-NNN]` 标记，仅 architecture 卡） |
| `gen-knowledge-tests.mjs` | 知识卡 `tests:` 登记（扫描 frontend/src 测试文件按名匹配补登） |
| `new-knowledge-card.mjs` | 知识卡脚手架 |
| `new-adr.mjs` | 新 ADR 脚手架：双源占号 + 四段模板 + 登记表登记 + 自动 adr-check；用法 `node scripts/new-adr.mjs "标题" [--slug kebab-name] [--related 关联内容] [--supersedes ADR-0XX,...] [--dry-run]` |
| `gen-docs-index.mjs` | 分区索引：**`docs/adr/index.md` 单文件承载全部**（状态分布 + 登记表 + 使用规则 + 状态分组，整文件重写，ADR 双文件合并后 README 为指针页）+ releases 最近版本/版本全览（GEN 标记区），knowledge 委托校验 |
| `gen-project-map.mjs` | 项目结构地图生成（`docs/project-map.md`）：扫描磁盘目录 + 合并基线 `scripts/baseline/project-dirs.json` 用途说明，4 个 GEN 标记区；`--check` 已挂 doctor 防漂移；未登记基线的新目录 WARN 提醒 |
| `gen-guide-gap.mjs` | 指南覆盖缺口扫描：提取 app-modules.ts 组件/服务功能面，与 docs/guide 对照列出缺口（WARN 不阻断；`--strict` 缺口时退出码 1） |
| `build-novel-index.mjs` | 小说总索引生成（`docs/novel/index.md`）：扫 `docs/novel/` 目录树（act-\* + 01..10 区域 + appendix），整文件重写；区域文件夹内**禁放 README**（索引唯一来源即本脚本）；`--check` 已挂 doctor 防漂移 |
| `gen-vitepress-sidebar.mjs` | VitePress 侧边栏生成：扫 `docs/` 全量 md 按目录树组织导航 → `docs/.vitepress/sidebar.gen.mjs`（勿手改），`docs/package.json` build 脚本前置调用（ADR-022） |
| `gen-doc-next-steps.mjs` | 文档体系「待补地图」诊断聚合：聚合 `check-knowledge-drift` / `link-checker` / `adr-check` 的 `--json` → `docs/.doc-next-steps.md`（只读报告，不修改源文件） |

### 生成器维护约定（2026-08-03 新增）

- **单一事实来源 = ADR 文件首部**：登记表 / 状态统计 / status 表全部由文件驱动，改状态只改文件首部，跑 `gen-docs-index.mjs` 全量同步。
- **GEN 标记区**：混合文档（人工段 + 生成段）用 `<!-- GEN: xxx --> ... <!-- /GEN: xxx -->` 包裹生成区，脚本只重写区内，缺标记会 FAIL 提示一次性插入。
- **占号闭环**：新 ADR 一律 `node scripts/new-adr.mjs "标题" [--slug kebab-name] [--related 关联内容] [--supersedes ADR-0XX,...] [--dry-run]`，禁止手写编号；`--dry-run` 只算号不落盘。

### 已删除（2026-08-03 Python 迁移）

| 原脚本 | 原因 |
|------|------|
| `check_*.py` / `fix_*.py` / `restore_nico.py` / `transform_creators.py` / `validate_data.py` | 一次性数据修复脚本，历史使命完成，随迁移清理 |
| `compare-*.py` | 一次性对比工具 |
| `safe-edit-service.py` / `safe-edit.bat` | 半成品（`do_GET` 备份逻辑为空 `pass`），删除 |

### 已删除（2026-08-06 清理）

| 原脚本 | 原因 |
|------|------|
| `gen-status-index.mjs` | 僵尸脚本：目标 `docs/architecture/PROJECT_STATUS.md` 已冻结迁移至 `docs/archive/`（2026-08-03），脚本必失败且无实际消费者，删除；状态映射职责由 `gen-docs-index.mjs` 承接 |

---

## 覆盖场景

### YSM 文件解析（inspect_ysm.mjs）

| 场景 | 覆盖 |
|------|------|
| YSM V3 裸格式（`YSM` + null 分隔 preamble） | ✅ |
| YSGP V2 格式（BOM + `YSGP` magic + 文本头） | ✅ |
| UTF-8 BOM 前置（`\xef\xbb\xbf`） | ✅ |
| BOM 后紧跟 CRLF 换行（Windows 风格） | ✅ |
| 多段 `===` 分隔的文本头（Metadata/Tips/Export/Codec） | ✅ |
| ZIP 伪装 `.ysm`（`PK\x03\x04`） | ✅ |
| 嵌套 YSGP（binary 里又套一个 YSGP header） | ✅ |
| 二进制段全零填充 | ✅ |
| XXTEA 加密二进制 blob | ⚠️ 检测到但不解密 |
| 内嵌文件名搜索（7 种常见文件） | ✅ |
| 二进制熵检测（判断是否加密） | ✅ |

### 治理红线

> 规则条文与严重度分级以 `docs/governance-rules.md` 为唯一事实来源；下表仅为红线→检测工具映射。

| 红线 | 工具 |
|------|------|
| `window.__*` 全局变量 | `check-redlines.mjs R1` + `doctor.mjs` |
| 硬编码颜色 `#xxxxxx` / `rgb()` / `hsl()` | `check-redlines.mjs R5` + `doctor.mjs` |
| `innerHTML` 拼接 | `check-redlines.mjs R8` + `doctor.mjs` |
| `display:none/block` 做动画 | `check-redlines.mjs R4` |
| `window.go.main.App` 直接调用 | `check-redlines.mjs W2` + `doctor.mjs` |
| 反斜杠路径 | `check-redlines.mjs W1` |
| 空 JSDoc 模板 | `comment-checker.mjs`（原 review W3 并入） |
| TODO 无 ticket 编号 | `comment-checker.mjs`（原 review W4 并入，覆盖 go+frontend） |
| magic string 资源类型 | `check-redlines.mjs R7` |
| 回调式 `.file()` API | `check-redlines.mjs R3` |

### 一致性校验

| 校验项 | 工具 |
|--------|------|
| `resource_types.json` ↔ `extensions.js` 双向比对 | `type-consistency.mjs` |
| Markdown 内部链接断链检测 | `link-checker.mjs` |
| `EventsOn`/`bus.on` 注册位置审计 | `event-audit.mjs` |
| AI 废话注释（「用于」「这是」「检查…是否」） | `comment-checker.mjs` |
| 注释掉的代码行 | `comment-checker.mjs` |
| `console.log` 调试残留 | `comment-checker.mjs` |
| Go 导出函数 vs v3 bindings 产物（`-ts` 契约 app.ts）一致性 | `binding-check.mjs` |

---

## 已修复盲区

| 盲区 | 修复状态 |
|------|---------|
| CSS 变量覆盖率（`rgb()`/`hsl()`/3 位 hex） | ✅ `check-redlines.mjs R5` 已扩展 |
| Wails Binding 签名一致性 | ✅ `binding-check.mjs` 新建 |
| inspect_ysm 1-5 分散 | ✅ 合并为 `inspect_ysm.mjs` + `--json` |
| Python/Node 双运行时分裂 | ✅ 全量迁移 Node（2026-08-03），契约测试同步 mjs |
| 脚本自身零测试覆盖 | ✅ `tests/test_scripts_lib.mjs`（共享层边界）+ `tests/test_scripts_json.mjs`（--json 契约） |
| review / comment-checker 重复 rg() 封装 | ✅ 抽 `_lib/ripgrep.mjs` 共享层，两脚本接入 |

---

## 共享层强制接入约定

`scripts/_lib/` 下共享层**不允许复制样板到新脚本**，新脚本一律 `import`：

| 共享层 | 提供 | 强制场景 |
|--------|------|---------|
| `_lib/scan-files.mjs` | `walk`（.js/.ts 双扩展名）、`resolveImport`（.ts/.js/index 补全）、`toPosix`/`relPosix`、`readText`（BOM/CRLF 容错）、`getRoot` | 扫描 frontend/src 源码、解析 import、路径输出 |
| `_lib/ripgrep.mjs` | `rg`（严格：exit 1 → []；rg 缺失/坏正则 → 抛错）、`rgSafe`（容错：抛错 → WARN + []） | 需要 ripgrep 扫描的任何脚本（恒 exit 0 提示工具用 `rgSafe`） |
| `_lib/frontmatter.mjs` | frontmatter 解析 | 读取 md 文档 frontmatter |

违规形态：内联「通用」 `walk`（即 scan-files.walk 的等价递归、无扩展名/跳过定制）/ 内联 `rg(...)` / 内联 `path.resolve(path.dirname(fileURLToPath(import.meta.url)))`。带显式过滤的领域专用收集器（如 `endsWith('.md')` / `EXCLUDE` / `symbolExclude` / `onFile`）为合法内联，不计入违规；doctor/静态检查不会自动拦截（脚本是自由 Node），靠 code review 约定 + `comment-checker` 抽查。

---

## AI 工具链配置（opencode / reasonix）

### opencode（编辑器 Agent）

| 文件 | 层级 | 内容 |
|------|------|------|
| `opencode.json` | 项目级（入库） | 启用的插件：`opencode-vibeguard`、`@tarquinen/opencode-dcp`（动态上下文裁剪） |
| `~/.config/opencode/opencode.jsonc`（或 `%APPDATA%/opencode/`） | 用户级（不入库） | 默认模型 `opencode-go/deepseek-v4-flash`；agent 分模型：plan=`deepseek-v4-pro`，explore/build=`deepseek-v4-flash` |

### reasonix（CLI Agent）

`reasonix.toml` 为本地 AI 终端配置（**不入库不校验**，AGENTS.md 约定）：

- `subagent_model`：默认 `deepseek-v4-flash`
- `subagent_models`：per-skill 覆盖，如 `review = "deepseek-v4-pro"`
- `subagent_efforts`：per-tool/skill 覆盖，如 `deep-init / doctor / ultrawork = "high"`

> 插件/模型变更同步更新本表；配置细节以 opencode 官方 schema 与 reasonix 内置默认为准。

