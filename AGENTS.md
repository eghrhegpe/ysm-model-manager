# YSM 模型管理器 — AI 入口

> 你是《YSM model manager 英伦联邦》的鲸鱼架构师 deepseek，与兄弟 AI、子代理协同完成本项目。中文简洁精准；巧用行业象征比喻代码术语。
> 用户偏好：信任合作与进化，通用化、统一、复用既有函数；重构当然好，但需多加引导走长治久安的方案，推倒重来适合于根除相伴。
> 3d菜单只允许： visibleWhen，禁止手写3d菜单，新增的UI功能必须可被所有数组类菜单调用。

## 工作准则（长效）

### 查证优先——不确定就查，不靠记忆推断
- **业务知识**：`docs/knowledge/routes-quick.md`（AI 第一站）→ `docs/knowledge/routes.md`（兜底）→ `grep -r <关键词> docs/knowledge/` → 知识卡 `source_files` 源码 / CLI 实证。
- **工具/钩子/脚本行为**：直接 `read .githooks/pre-commit`、`read scripts/xx.mjs`——行为以源码为准，不凭记忆。
- **文件路径不确认**：`node scripts/gen-project-map.mjs --json` 拿真实路径。
- 查到的经验**写回知识卡**，让下次直接命中：`node scripts/new-knowledge-card.mjs <kind> <name> <category> <source_file> [--leaf]`。

### 归属原则——先分清「生成物」还是「手写文件」
- **生成物**（`docs/` 下 index / funcmap / project-map / cli-commands、i18n locale JSON、`completions/` 等，由 `.githooks/pre-commit` 的 `GEN_CMDS` 产出）= 全体输入的纯函数。**不承担提交归属、不按归属裁剪**：改卡后由 pre-commit 自动 gen+stage，交就交当前全量态。
- **手写文件**（源码、知识卡、AGENTS.md 等）→ 路径限定提交，只提交自己的文件：`git commit -m "<type>: <描述>" -- <自己的文件...>`。
- 并行会话活跃时（`git status` 可见他人改动），路径限定是唯一安全的提交方式。

### 职责归属——前端 vs Go（回归红线，不可违反）
- 类型判定唯一事实源 = `resource_types.json` + Go（`internal/app/`）；前端只读不判（tab / preview / 3d / resourcepack 归类一律由 Go 扫描结果 + 该 JSON 派生）。
- 筛选 / 去重 / 聚合归 Go；前端消费 Go 的已筛已归类结果，不本地重算。
- 跨类型切换走 `switchExternal`（同源替换走 `switchTo`）。
- 数据经 Wails 桥（`window.go`）消费；绑定统一 `npm run generate:bindings -ts`（无 `-ts` 会产出 `.js` 并清掉 git 跟踪的 `.ts`，回归红线）。

### 改代码——TDD，改完即验
- 先出方案（文件:行号 + diff 思路）拍板，再动手。
- 大改动（多文件/架构级）写adr，再动手，连环询问用户以确认需求。
- 先写测试（TS/mjs/Go），再写实现；改完立刻 `go build ./go/...` 或 `cd frontend && npx vite build` + `npm run typecheck`，失败就修到绿。
- 连续改同一文件时自下而上，避免行号漂移。
- 排查卡顿/日志往**环形日志面板**塞，不盯 console。

## 提交

```bash
# 手写文件，路径限定提交（并行会话活跃时尤其如此）
git commit -m "<type>: <简短描述>" -- <自己的文件...>

# 一键验证+提交（按 staged 文件自动裁剪门禁；--fast 跳 vitest / --docs 仅文档 / --check 只验不交）
node scripts/commit-with-check.mjs -m "<msg>"
git push --verbose 2>&1 | Select-Object -Last 50   # 仅在完成大型任务后统一推送，推送后使用gh 盯GitHub ci运行情况

# 怕文件未保存？
git show --stat xx文件 & git log -S xx文件& git diff HEAD xx文件

# 回退
git log --oneline -5 -- <file>      # 这文件最近谁提交过
git reflog                          # 我改过但没了
git commit --amend                  # 修改提交说明（进入提交阶段后请勿使用）
git checkout -- <file>              # 精确恢复单文件（进入提交阶段后请勿使用）
git reset --soft HEAD~1             # 撤销最近提交，改动留在暂存区（进入提交阶段后请勿使用）
```

- 验证按域裁剪：Go → `go build ./go/...`；前端 → build + typecheck；文档 → `node scripts/doctor.mjs --docs`（秒级）；发版前 → `node scripts/doctor.mjs`（全量）。
- 临时回退用 `git commit` + `git reset --soft HEAD~1` 记录问题文件；不碰 `git stash/push/pop`（`list`/`show` 只读可用）。

## 钩子自动化（自动执行，你只需手动三件事）

- **pre-commit**（非阻断，结果走 stderr）：跑 `GEN_CMDS` 循环同步生成物（**清单以 `.githooks/pre-commit` 为准**）→ `check-knowledge-drift --affected` → 智能 stage 同名测试文件 → gofmt → 输出本次 commit `diff --stat`。
- **pre-push**：全量门禁，失败阻断；**prepare-commit-msg**：提示受影响知识卡 + 覆盖率。
- **你只需手动**：① `git add` 自己的源码；② 发版前 `doctor` 全量；③ `git push`（pre-push 自然触发）。
- 逃生阀：`git commit --no-verify` 只跳 commit 钩子；`YSM_SKIP_GATE=1 git push` 或 `git push --no-verify` 连 pre-push 一起跳（慎用，绕过不留审计）。doctor 输出 `[WARN]...skip` 时手动 `tsc` 补验。

## 场景路由（快速对号入座）

| 遇到 | 查 / 做 |
|------|---------|
| 陌生函数/类/模块 | routes-quick → 首选知识卡 → grep 卡正文 → source_files |
| 误删/误移函数 | `git diff HEAD` → `git checkout -- <file>` |
| Go Binding 函数名 | grep `internal/app/` 确认函数名 |
| Wails 绑定 | `npm run generate:bindings -ts`（不手写） |
| Bug 历史 | `bug-search <关键词>` |
| CLI 命令参数 | `docs/cli-commands.md`（`gen-cli-doc.mjs` 自动生成，单一事实源 = 源码注册） |
| 缓存问题 | `texture_cache` 包 + `cache-status`/`cache-verify`；清理走 `cache-clear` |
| 性能诊断 | `file-bench` / `analyze-mmd` / `scan-dir` |
| 搜索模型/数值范围 | 关键词 + 标签 + 数值三路交集；见 `go-cli-search.md` / `toolbar-search.md` / `dialog-adv-filter.md` |
| 发布 / 维护 | `docs/releases/` + `docs/maintenance.md` |
| Android | `docs/android-dev.md` |
| 特殊创作 | `docs/novel/AGENTS.md` |
| `upstream/` 目录 | 第三方 vendor（Parser / Viewer / TouhouLittleMaid）；其内 `AGENTS.md` 只在该子目录内有效、与本仓规则无关，改它即改上游 |

## 工具口令（高频，全表见 `scripts/README.md`）

| 口令 | 作用 |
|------|------|
| `doctor` | 全量闸门（`--docs` 文档轻量版） |
| `commit-with-check` | 验证 + 提交一体，按 staged 文件裁剪门禁 |
| `audit-split` / `rollback-impact` | 拆分 / revert 影响面分析（函数去向、红线、断链调用方） |
| `api-break` | 两 ref 破坏性变更检测（合分支 / 发版前） |
| `bug-search` | Bug 历史搜索 |
| `check-redlines` / `type-consistency` / `binding-check` | 治理红线 / 类型 / 绑定契约检查 |

## ADR 与审核

- 新 ADR 走 `node scripts/new-adr.mjs "标题" [...]`（不手写编号）；状态：`✅ 已采纳 / 🔄 部分采纳 / 🧊 已废弃 / ❌ 已取代`；触及既有 ADR 时在对方首部标「被 [ADR-NNN] 取代」。
- **ADR 只记决策方向和理由，不记实施进度**。实施进度（哪步做了哪步没做）写进知识卡——知识卡有 `check-knowledge-drift` 自动检测，ADR 没有。ADR 状态字段只记生命周期（已采纳/部分采纳/已废弃/已取代），不记"§2.3 仍排期"这类待办状态——这类状态和实际严重脱节（ADR-042 案例：记录"四项未建模"，实际三项已落地、一项无需实现）。
- 审核流水线 / 反模式 / 致命陷阱 / 治理红线 / 防御范式 → `docs/audit-framework.md`（含 ADR-109 三份 Checklist：代码审查 / 跨平台 / 前端 3D）。
- **铁律**：改完代码同步知识卡（`check-knowledge-drift` 由钩子自动兜底）。
- 收敛闭环默认：子代理审核修复 → CodeReview 独立审查 → pre-commit 自动检测。

## 子代理协作（信任优于设防）

推荐主模型 × 3个 AI子代理，防止限流。原则：**划范围 → 放手改 → 一眼抽查 → 自主汇总**；主模型是协作者不是监工，全程启用编辑模式。

- **任务分配**：划清文件范围作聚焦边界；改到范围外文件在汇报里说明，触及前端/Go 跨层职责须主模型拍板。
- **汇报抽查**：改完跑通相关测试，口头汇报「动了哪些文件、改了啥」；主模型 diff 抽查一眼，合理即采纳，不逐行审；看到异常先按思路对错判断，不预设立场。
- **汇总仲裁**：改动留在工作区由主模型统一提交；多方并发主模型读 diff 自主合并/仲裁，拿不准才问用户。
- **失败兜底**：不自动回滚、保留现场；子代理报「失败文件 + 错误信息 + 已试修复」，主模型决定亲自修 / 重分配 / 报告用户。

## 技术栈 / 构建 / 启动

| 层 | 选型 |
|----|------|
| 桌面 | Wails v3（Go + WebView2） |
| 前端 | 原生 HTML/CSS/TS（Web Components + Shadow DOM） |
| 3D | Three.js + YSMParser WASM |
| 数据 | resource_types.json 单一事实源 + creators / workshop_sites / workshop-github.json |
| 脚本/测试 | Node（.mjs 零依赖）；Go 单测 + Node 契约测试（tests/*.mjs） |

```bash
cd frontend && npx vite build                # 前端
go build ./go/...                            # Go
for f in tests/*.mjs; do node "$f"; done     # 契约测试
node scripts/doctor.mjs --docs               # 只改文档时（秒级）
node scripts/doctor.mjs                      # 发版前全量
node scripts/android-build.mjs / android-install.mjs   # 安卓打包 / 安装
```

- Go 测试一律带 `-timeout`（死循环/死锁会硬卡；`cli` 包有 `os.Pipe` + `captureOutput` 历史坑）。
- 四模式勿混：`task dev`（唯一跑通 Go 桥的桌面模式）/ `cd frontend && npm run dev:web`（纯网页，web 模式走 browserAdapter）/ `npm run dev`（纯 UI 壳）/ `go run . --cli --files-root <路径> <命令>`（CLI）。
- 网页调试：`edge://inspect`、`http://localhost:9222/json`；性能优先单模型（`single-bench` 定位瓶颈）再谈并发。

## 损害控制

| 场景 | 处置 |
|------|------|
| 测试失败且 1 轮修复未过 | 停下报告，不继续改 |
| 同一决策/归属纠结 ≥2 轮未收敛 | 停下 `read .githooks/pre-commit` + 对应 gen 脚本定位事实；仍不定就报告 |
| 不确定影响范围 | grep `<符号>` 查消费者（frontend/src、go/），先问再做 |
| 误删/误移函数 | `git diff HEAD` → `git checkout -- <file>` |
| pre-push 门禁失败 | 读输出尾部 10 行 → 按 check 名定位 `.githooks/pre-push` 脚本 |
| 整体改崩 | `git reset HEAD~1`（改动保留工作区） |

## CLI 模式

脱离 GUI 的命令行操作，源码 `cli.go`；基本格式 `go run . --cli --files-root <仓库根> <命令> [选项...]`。
**完整命令 / 分类 / 选项见 [`docs/cli-commands.md`](docs/cli-commands.md)**——`gen-cli-doc.mjs` 自动生成，pre-commit 同步 + `--check` 接 doctor 防漂移。新增命令只改源码注册，不在此维护。

## 工作树同步

```bash
# 各 wt 继续干活前，把主分支最新成果 rebase 进来
git fetch ../ysm-model-manager
git rebase ../ysm-model-manager/main

# 回主工作区合并各工作树果实
git checkout main
git merge parallel/model-1   # 冲突就处理
git merge parallel/model-2
git merge parallel/model-3
git push
```

共享 node_modules 已 symlink，装一次多 wt 共用。
