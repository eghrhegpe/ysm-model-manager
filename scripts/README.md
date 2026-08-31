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

> 执行状态：本仓库已落地 `check-script-hygiene.mjs`（与 MikuMikuAR 同款，五口径：退出码失效 / 共享层内联 / `--json` 契约 / 文件头 5 字段 / positional 脚本走 parse-args）；运行 `node scripts/check-script-hygiene.mjs [--json|--strict]` 即可机检本规范。

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
| `rollback-impact.mjs` | `node scripts/rollback-impact.mjs <commit>` / `--json` / `--quiet` / `--scope <dir>` | revert 影响面分析（audit-split 逆向镜像）：给定 commit，逆向跑一遍 funcMigration 找被删顶层声明 → 扫描当前 HEAD 引用 → 报潜在断链（⚠️ 或 ✅），情报型不阻断 |
| `bloat-history.mjs` | `node scripts/bloat-history.mjs <path>` / `--json` / `--limit N` / `--first N` | 单文件膨胀轨迹：遍历 git log 中每次触及该文件的 commit，记录行数/导出符号数/顶层声明数，标出单次 +30 行跳点（author + subject + 前后行数/符号数），前置 ADR-040 红线的事前情报 |
| `api-break.mjs` | `node scripts/api-break.mjs <older> <newer>` / `--json` / `--quiet` / `--scope <dir>` / `--redline` / `--compact` | 任意两 ref 间破坏性变更检测（audit-split 通用化）：git diff --name-only 拿变更文件清单 → 对源码文件对比新旧顶层声明 → 报被删导出符号 + 当前 HEAD 潜在断链 + 新增导出入口 + ADR-040 红线；可跨分支/标签比对，用于合分支前或发版前检查 |

### 实用级

| 脚本 | 调用方式 | 说明 |
|------|---------|------|
| `funcmap.mjs` | `node scripts/funcmap.mjs -o funcmap.md` | 提取 Go/JS/TS 导出符号映射表（按模块分组，参考 MikuMikuAR 风格） |
| `doctor.mjs` | `node scripts/doctor.mjs` | **薄派发器**：三模式全部委托 pre-push-gate.mjs（单一实现源头，2026-08-14 合并消除双端漂移）——默认 = `--all --dry-run`（Go 编译/单测/vet + 前端构建/vitest/tsc + 文件 + 红线 + 静态分析 + Git，含 check-layering 分层守护）；`--docs` = `--docs --dry-run`（轻量文档检查）；`--gate [ref]` = `--dry-run`（域感知门禁，不触发 push）；`--json` 透传 |
| `comment-checker.mjs` | `node scripts/comment-checker.mjs` / `--json` / `--full` | 注释质量（废话/JSDoc/TODO/调试日志）；`--json` 默认每类截断 50 条 + `_summary` 分类计数，`--full` 全量（防 wasm base64 超长行误报/爆炸） |
| `event-audit.mjs` | `node scripts/event-audit.mjs` / `--json` | EventsOn/bus.on 注册位置检查 |
| `binding-check.mjs` | `node scripts/binding-check.mjs` | Go 导出函数 vs v3 bindings 产物（`-ts` 契约 app.ts）一致性 |
| `adr-check.mjs` | `node scripts/adr-check.mjs` | ADR 登记表 vs 磁盘对账（防撞号/漏登/幽灵） |
| `ai-mistake-tracker.mjs` | `node scripts/ai-mistake-tracker.mjs` / `--limit N` / `--json` | 分析 git 历史找 AI 高频犯错区（fix 分类统计 / 连续修复链 / 文件热力图 / 规则违反扫描），反哺 AGENTS.md 陷阱清单 |
| `codemod.mjs` | `node scripts/codemod.mjs help` / `rename-function` / `move-function` / `add-param` | AST 感知重构（ts-morph）：批量重命名 / 移函数（自动迁 import）/ 加参数；move 不重写外部引用方，改后跑 tsc |
| `inspect_ysm.mjs` | `node scripts/inspect_ysm.mjs <文件>` / `--json` | YSM 文件格式诊断（合并 v1-v5 的统一版） |
| `test-coverage-report.mjs` | `node scripts/test-coverage-report.mjs` / `--json` / `--top N` | 读 vitest v8 coverage 产物输出未覆盖清单（文件+行+函数，升序），供补测决策；需先跑 `npm run test:coverage` |
| `android-install.mjs` | `node scripts/android-install.mjs` / `--no-launch` | 一键编译安装 Android debug 版到已连接设备（gradle installDebug + 自动拉起应用；签名不兼容时自动卸载旧版重装；依赖 ANDROID_HOME + JDK） |
| `android-check.mjs` | `node scripts/android-check.mjs` / `--full` | Android Java 语法/API 编译检测（gradle compileDebugJavaWithJavac，无需设备；`--full` 完整 assembleDebug） |
| `line-counter.mjs` | `node scripts/line-counter.mjs` / `--funcs` / `--funcs --json` / `--funcs --scope <dir>` / `--funcs --threshold N` | 双粒度健康度分析：默认=文件级（Go/前端分布 + 大文件预警 >700 行，由 line-counter.py 迁移）；`--funcs`=函数级（Go + TS/JS 双栈，括号匹配定边界 + 新顶层声明护栏截断，三档分级 🟨>N / 🟧>2N / 🟥>3N，默认 N=30；生成/测试文件/node_modules 自动豁免；情报型工具不阻断）；`--json` 子代理消费 |
| `audit-split.mjs` | `node scripts/audit-split.mjs <commit>` / `--json` / `--redline` / `--compact` | refactor 提交主动审计（**情报型**，与防御 check-* 互补）：文件清单/±行数/分类（拆·新·改）+ 函数级迁移（顶层声明去向：保留/搬家/真删，导出+私有双口径）+ 新文件导出入口 + ADR-040 ≤400 红线校验 + 受影响文件历史提交；把手工审计拆分的 40+ 条 pwsh 指令合成一条口令，自动暴露红线违规 |
| `gui-flow-gate.mjs` | `node scripts/gui-flow-gate.mjs` / `--files-root` / `--model` / `--threshold-ms` / `--require-model` / `--verbose` | **性能集成门禁（B-1 真跑层）**：真跑 `go run . --cli gui-flow --json`，验证 Go 后端加载链健康（CLI 当 GUI 无头替身）。必绿：配置加载+模型扫描；检测到可分析模型（或 `--require-model`）时强验证 ③ 分析/④缓存/⑤数据+总耗时阈值，无模型输入时降级通过并提示。⚠️ 真跑会经 DispatchCommand 落盘 files-root 到用户配置，宜在 CI/无真实用户环境执行 |
| `perf-gate.mjs` | `node scripts/perf-gate.mjs --init [--model <path>]` /（默认对比）/ `--threshold-ratio` / `--warn-only` / `--verbose` | **single-bench 性能回归守卫（B-2）**：把各阶段耗时存为 `scripts/baseline/perf-baseline.json` 锚点，后续运行逐阶段对比，任一阶段耗时超 baseline×ratio（默认 1.5）即 fail（性能护栏防倒退）。⚠️ baseline 须用**真实模型库** `--init` 建立（fixtures 小模型耗时 ms 级噪声无锚定价值）；真跑同样落盘 files-root 到用户配置 |
| `pre-push-gate.mjs` | `node scripts/pre-push-gate.mjs <remote> <url>`（.githooks/pre-push 调度器）/ `--dry-run` / `--all` / `--docs` | 本地质量门禁（doctor 全部模式的单一实现源头）：按变更域（Go/前端/数据/文档）只跑相关检查；Go 域含 updater helper 前置构建 + `./internal/app/` 测试；前端域含 **check-layering 分层硬门禁** + vitest + **tsc --noEmit**；gofmt 修复在 pre-commit 自动完成，pre-push 只读检出不阻断（格式类债务，2026-08-13 决策）；构建/断链/契约失败/红线扫描不可用（fail-closed）阻断推送；契约测试并行执行（~31s vs 串行 ~43s）；结果双写 stderr + `.git/push-log`（带 ISO 时间戳，持久可查）；`--all` = 全量体检（含静态分析工具 + 关键文件），`--docs` = 轻量文档检查 |
| `commit-with-check.mjs` | `node scripts/commit-with-check.mjs -m "<msg>"` / `--docs` / `--check` | **验证 + 自动提交的 thin wrapper**（ADR-086）：验证全部委托 pre-push-gate（单一源头），门禁全绿才 commit；`--check` 只验不交；按 staged 文件自动裁剪门禁 |
| `e2e-coverage-report.mjs` | `node scripts/e2e-coverage-report.mjs` / `--input <path>` / `--all` / `--json` | 端到端广度报告（ADR-035 G-4）：读 Playwright V8 coverage 产物，输出「哪些源文件被真实交互走到」的广度报告（函数级覆盖比例，不做行级精确统计） |
| `test-decode-from-memory.mjs` | `node scripts/test-decode-from-memory.mjs` | YSMParser WASM 解码冒烟测试：Node + callMain + MEMFS 路径，与 `internal/app/wasm_decoder.go` 同调用方式 |
| `verify-wasm-mt.mjs` | `node scripts/verify-wasm-mt.mjs <path.ysm>` | ADR-079 M3/M4 验证：pthread 多线程 WASM 在模拟 Worker 全局下实例化 + 解码（结构级验证，真 spawn 需浏览器 crossOriginIsolated） |
| `build-ysm-wasm.mjs` | `node scripts/build-ysm-wasm.mjs` / `--skip-build` | 统一 YSMParser WASM 构建（一份 web 产物服务前后端）：em++ 编译 → base64 打包前端 + Go embed 拷贝 |
| `android-build.mjs` | `node scripts/android-build.mjs` / `--arch` / `--production` / `--rust-backend` | 一键构建 Android APK：前端构建 + NDK 交叉编译 libwails.so + gradle assembleDebug（补 android-install 只装不编的缺口） |
| `compile-android-rust.mjs` | `node scripts/compile-android-rust.mjs` / `--arch amd64|all` | 编 Rust scanner bridge 为 Android staticlib（.a）供 Go CGO 链接（android-build 前置单步） |
| `compile-rust-static.mjs` | `node scripts/compile-rust-static.mjs` / `--target <triple>` | 编 Rust scanner bridge 为 staticlib 供 Go CGO 静态链接（Linux 构建链，build/linux/Taskfile.yml 调用） |
| `compare-maid-packs.mjs` | `node scripts/compare-maid-packs.mjs` | 实战比对：单女仆 zip vs 多合一女仆包（L0 清单 vs L1 枚举差异；⚠️ 依赖 `_tools/` 暂缺失，当前不可运行） |
| `analyze-knowledge-refs.mjs` | `node scripts/analyze-knowledge-refs.mjs` / `--json` / `--no-write` | 知识卡引用深度与耦合分析（一次性诊断）：卡→源码 / 卡→卡 / 分类膨胀度 / 引用孤岛，产出 docs/review/knowledge-ref-analysis.* |
| `drift-scan.mjs` | `node scripts/drift-scan.mjs` / `--json` | 双轨漂移自动侦察兵：Go 硬编码常量 / 内联切片 / 路径归一化 / 错误链断裂 / 资源泄漏 / 重复实现 + 前端同逻辑异实现 |
| `gpu-leak-analyze.mjs` | `node scripts/gpu-leak-analyze.mjs <logfile>` / `--json` | 解析 `[gpu-leak] before/after` 日志，逐对计算差值标出 GPU 内存泄漏点（支持 stdin） |
| `translucency-probe.mjs` | `node scripts/translucency-probe.mjs <模型目录...>` | 面级透明分类增益探针：量化 mesh 级 vs 面级透明误路由面积比，为引入面级透明路径提供数据依据 |
| `texture-golden.mjs` | `node scripts/texture-golden.mjs` / `--dir` / `--json` / `--limit N` | upstream 真实 .ysm 全量 golden 扫描：组件序 + 纹理名契约回归（B 层真实模型回归，与 go/geometry 合成夹具 A 层互补） |
| `trace-analyze.mjs` | `node scripts/trace-analyze.mjs <trace.json> [trace2.json]` / `--json` / `--top N` / `--pid <pid> --tid <tid>` | **Chrome DevTools trace 性能瓶颈分析**：解析 DevTools 录制的 JSON trace（动辄 10 万+ 事件），输出 Top 最长事件 / name+cat 聚合 / 线程 dur 饼图 / 指定线程明细 / Worker 聚合 / 最忙时间片；双 trace 模式对比 A vs B 差异摘要。定位渲染主线程瓶颈、JS 执行密度、图片解码开销等。 |
| `port-align.mjs` | `npm run verify:port`（等价 `node scripts/port-align.mjs`） | cube/spec 坐标端口「多样性对齐」校验（手动工具）：内嵌 Blockbench 权威 oracle，esbuild 打包真实 TS 端口真跑比对，输出覆盖矩阵 + 分歧报告 |
| `perf/vitest-env-switch.mjs` | `node scripts/perf/vitest-env-switch.mjs` | 给已确认无 DOM 依赖的纯逻辑测试文件批量加 `@vitest-environment node` 标注，省 happy-dom 环境重建开销（~1.2s/文件） |
| `.githooks/pre-commit`（薄壳） | commit 时自动执行（无需手打） | 秒级文档/索引自动同步：跑 10 个 gen（docs 分区索引 / funcmap / 知识卡 index+字段 / novel 索引 / project-map / vitepress sidebar）后 `git add docs/`（幂等：无漂移零副作用）；失败仅提示不阻断；输出走 stderr；逃生阀 `YSM_SKIP_GEN=1` |

### 治理检查（check-* 系列；唯一登记处，AGENTS.md §1.2 仅作指针）

| 脚本 | 调用方式 | 说明 |
|------|---------|------|
| `check-doc-drift.mjs` | `node scripts/check-doc-drift.mjs` / `--fix` | 文档三一致：ADR 登记 + 知识卡 + 架构树引用（ERROR 阻断；`--fix` 刷新架构树基线） |
| `check-adr-drift.mjs` | `node scripts/check-adr-drift.mjs` / `--json` | **ADR 描述 vs 代码现实漂移检测**：A) 文档侧——已还债但仍标开放的旧表述；B) 代码侧——正向断言源码现实（app_install.go 薄壳 / DownloadQueue 无 *App 循环）。双向对账，阻止 AI 把完成的活反复当开放债 |
| `check-adr-health.mjs` | `node scripts/check-adr-health.mjs` / `--debt` | ADR 状态机值域 / 登记表同步 / 技术债清单 |
| `check-adr-status.mjs` | `node scripts/check-adr-status.mjs` / `--check` / `--json` | ADR 状态分类精简统计：只输出 6 桶计数 + 问题清单（未标注/未知），`--check` 模式 unknown 时 exit 1（比 check-adr-health 更精简，供 CI 快速判定） |
| `check-biome.mjs` | `node scripts/check-biome.mjs` / `--strict` / `--write` / `--json` | **Biome 委托检查器**（P0）：TS 7 太新 dependency-cruiser 静默漏检，Biome 自研 Rust 解析器全解析；增量策略 `biome check --changed`（仅查相对 main 的变更文件），`--write` 自动修复；空变更集判通过 |
| `check-inline-error.mjs` | `node scripts/check-inline-error.mjs` / `--fix` | 内联错误模式检测：`e instanceof Error ? e.message : String(e)` 应统一收敛 safeErrorMessage / friendlyError（Worker 安全 / 用户侧 toast） |
| `check-menu-health.mjs` | `node scripts/check-menu-health.mjs` / `--json` | **3D 预览菜单表健康门禁**（ADR-085 配套）：6 条校验（id 唯一 / labelKey 非空且入语言包 / dockGroup 类型 / kind 合法 / panel 有渲染通道 / action 有 run），正则解析 4 个菜单表文件 |
| `check-proc-adoption.mjs` | `node scripts/check-proc-adoption.mjs` / `--json` / `--strict` | 子进程直调收敛检查（ADR-043 落地率守护）：扫描 scripts/ 直调 `execFileSync`/`execSync` 而未走 `_lib/proc.mjs` 的脚本（WARN 报告，`--strict` 时 exit 1） |
| `check-readme-index.mjs` | `node scripts/check-readme-index.mjs` / `--json` | **README 索引对账**（登记处漂移守护）：扫描 scripts/（含 hooks/，排除 _lib 与测试）与 scripts/README.md 全文对账，零提及脚本 → 阻断。让「唯一登记处」声明可机检 |
| `check-toast-duration.mjs` | `node scripts/check-toast-duration.mjs` | toast 时长单一事实源守护（防回流闸）：扫 frontend/src 生产代码捕捉写死裸数字的 toast 时长（bus.emit / toast() helper），当前观察期非阻断 |
| `check-deadcode-baseline.mjs` | `node scripts/check-deadcode-baseline.mjs` / `--update-baseline` | knip+jscpd 与 `scripts/baseline/deadcode-baseline.json` 对比，新增项阻断 |
| `check-orphan-exports.mjs` | `node scripts/check-orphan-exports.mjs` / `--strict` / `--min-consumers N` | 孤儿导出审计（零消费者符号；默认审计仅报告 rc=0，`--strict` 孤儿>0 时 rc=1 阻断；与联邦 check-consumers 同名异实，ADR-241 §Phase 2） |
| `check-circular.mjs` | `node scripts/check-circular.mjs` | frontend/src ESM import 图找环（ERROR 阻断） |
| `check-layering.mjs` | `node scripts/check-layering.mjs` / `--json` / `--update` | 前端分层依赖方向守护：R1/R2 零容忍（utils/services 不碰 UI 层）+ R3/R4 基线防新增（core→上层 / features→views，现有债务入 `docs/.layering-baseline.json` 待清理）；`import type` 豁免；源自 MikuMikuAR ADR-242 骨架适配，配套 `tests/test_check_layering.mjs` |
| `check-circular-go.mjs` | `node scripts/check-circular-go.mjs` / `--json` | Go 包级循环依赖检测（`go/` 目录下 import 图找环；ERROR 阻断，`--json` 供 CI 消费） |
| `check-boolean-naming.mjs` | `node scripts/check-boolean-naming.mjs` / `--strict` | 布尔变量命名规范 |
| `check-script-hygiene.mjs` | `node scripts/check-script-hygiene.mjs` / `--json` / `--strict` | 脚本卫生（五口径）：退出码失效（裸 main + return 失败码无 process.exit）/ 共享层内联（walk/rg/ROOT/parseArgs 样板）/ 检查类缺 `--json` 契约 / 文件头 5 字段 / positional 脚本未走 `_lib/parse-args.mjs`（WARN 不阻断） |
| `check-workflow-refs.mjs` | `node scripts/check-workflow-refs.mjs` / `--json` | 工作流引用完整性：`.github/workflows/*.yml` 的 `run:` 中 `scripts/`、`cmd/` 路径引用必须存在（迁移类死引用守护，如 cmd/build-*.ps1 → scripts/ 后 release.yml 漏同步） |
| `css-layer-check.mjs` | `node scripts/css-layer-check.mjs` / `--strict` / `--json` | **Shadow DOM 样式越界检查**：shadow 内 `animation:` 引用无同层 @keyframes 定义 → ERROR（跨 shadow keyframe 静默失效）；全局 components.css 残留已回迁类 → ERROR；shadow 类无定义 → WARN（自动发现 shadow 域，无手写清单） |
| `i18n-key-naming.mjs` | `node scripts/i18n-key-naming.mjs` / `--list-violations` / `--check key...` / `--entity <词>` | i18n 键名三段式规范检查（ADR-124）：只卡「新增键」必须 `<模块>.<子命名空间>.<实体>`（旧键保留作语义注释），`--list-violations` 输出迁移清单 |
| `jscpd-go.mjs` | `node scripts/jscpd-go.mjs` / `--update` / `--json` | **Go 端复制粘贴检测**（jscpd v5 Rust 内核）+ 独立 baseline 账本：增量门禁只拦新增重复对、不惩罚存量；只扫 go/ 目录，baseline 独立存 scripts/baseline/jscpd-go-baseline.json（与前端 deadcode 零耦合） |
| `event-graph.mjs` | `node scripts/event-graph.mjs` / `--check` / `--json` / `--strict` / `--root <dir>` | **Bus 事件契约守护者**：从 bus.ts 的 BusEvents 接口提取权威清单，报告未声明事件 / 孤儿发射 / 鬼订阅 / emit 缺参 / void 多传 / VOID_EVENTS 清单漂移（--strict 硬错误阻断；--check 供 pre-commit 自动重生成校验） |
| `auto-import.mjs` | `node scripts/auto-import.mjs` / `--fix` / `--watch` / `--strict` | TS/JS 缺失 import 检测（ADR-014 伴生，已接入 doctor 静态分析） |
| `gen-adr-supersede.mjs` | `node scripts/gen-adr-supersede.mjs` / `--check` | ADR 取代关系判定（五层证据：已登记 / 漏标 / 废弃未指明 / 可疑 / 表格弱宣称）；`--check` 仅漏标失败退出 1（供 check:docs） |
| `check-dynamic-import.mjs` | `node scripts/check-dynamic-import.mjs` / `--json` | 动态 import() 合理性审查（对照 app_modules 规范：失败处理缺失 / 空 catch 吞错 / .js 后缀残留 / 轻量工具模块误动态导入；WARN 阻断） |
| `check-tpl-refs.mjs` | `node scripts/check-tpl-refs.mjs` / `--json` | 前端 JS id 引用 ↔ 模板定义交叉核对：引用有定义无 → ERROR 断链阻断（幽灵 id 守护） |
| `wails3-cli-check.mjs` | `node scripts/wails3-cli-check.mjs` / `--json` | Wails v3 CLI 拼写检查：活跃路径裸 `wails X`（非 wails3）→ ERROR（v2→v3 回归守护，2026-08-05 绑定教训） |
| `i18n-check.mjs` | `node scripts/i18n-check.mjs` / `--strict` / `--json` | i18n 语言包一致性：key parity（en/ja vs zh-CN）/ 占位符一致性 / zh-CN 漏译 / SUPPORTED_LANGS 与 locales/ 文件集漂移；warning 模式恒 0，`--strict` 缺口时 exit 1 |
| `i18n-ui-check.mjs` | `node scripts/i18n-ui-check.mjs` / `--strict` / `--json` | i18n UI 漂移检查（治本：堵住"动态菜单漏译"盲区）：扫描 frontend/src 下 .ts 文件，命中「含 HTML 标记 + 含中文 + 未包 t()」的字符串即判为漂移；warning 模式恒 0，`--strict` 有漂移时 exit 1 |
| `check-diff-coverage.mjs` | `node scripts/check-diff-coverage.mjs` / `--json` / `--suggest` / `--staged` / `--uncommitted` / `--threshold N` | 变更文件覆盖率门禁（diff-coverage gate）：只查本次 git 变更的非测试源码「变更行覆盖率」，低于阈值阻断（保护新代码有测试）；`--suggest` 非阻断建议（输出 commit message 区块）；源自 MikuMikuAR P8-A 适配，配套 `tests/test_check_diff_coverage.mjs` |
| `check-go-diff-coverage.mjs` | `node scripts/check-go-diff-coverage.mjs` / `--json` / `--suggest` / `--staged` / `--uncommitted` / `--threshold N` | **Go 变更文件覆盖率门禁**（前端 check-diff-coverage 的 Go 镜像）：只查本次 git 变更的 Go 非测试源码「变更行覆盖率」，低于阈值阻断；对受影响包现跑 `go test -coverprofile`（无持久产物，单包 ~0.5s）；`--suggest` 非阻断建议；配套 `tests/test_check_go_diff_coverage.mjs` |

> 基线文件位于 `scripts/baseline/`（`deadcode-baseline.json` / `doc-drift-baseline.json`），刷新基线用对应脚本的 `--update-baseline` / `--fix`。

### 生成器（Node）

| 脚本 | 说明 |
|------|------|
| `gen-knowledge-index.mjs` | 知识卡索引生成（docs/knowledge/index.md） |
| `check-knowledge-drift.mjs` | 知识卡漂移检查（含代码→卡片覆盖盲区 WARN；`--affected <文件...>` 主动列出受源码变更影响的知识卡；`--affected --quiet` 机读模式供钩子消费） |
| `hooks/knowledge-affected-hint.mjs` | `prepare-commit-msg` 钩子辅助脚本：stderr 摘要提示受影响知识卡（非阻断、幂等，AI 终端可见），并检测「本次 diff 已引入新写法而卡仍写过时旧词」的疑似过时句精确指行（ADR-047 增强，迁移对表 STALE_KEYWORD_PAIRS），归一化 Git Bash msys 路径 |
| `hooks/coverage-suggest-hint.mjs` | `prepare-commit-msg` 钩子辅助脚本：低于语句覆盖率阈值的源文件写入 commit message body，随 commit 进 PR 供 review 参考补测方向（非阻断、幂等；逃生阀 `YSM_SKIP_COVERAGE_HINT=1`）；v2：并入 **check-diff-coverage --suggest --staged** 的「📈 变更行覆盖率建议」区块（本次暂存变更文件，双区块幂等剥离） |
| `hooks/go-coverage-hint.mjs` | `prepare-commit-msg` 钩子辅助脚本（**Go 版**，逃生阀 `YSM_SKIP_GO_COVERAGE_HINT=1`）：仅本次 staged 改动 Go 包实跑 `go test -coverprofile`，终端提示「🧪 低于 80% 的函数」+「📈 check-go-diff-coverage --suggest --staged 的变更行覆盖率」双区块，非阻断 |
| `gen-knowledge-symbols.mjs` | 知识卡 `symbols:` 字段同步（源码导出符号提取，JS/TS + Go 双栈，gen/--check） |
| `gen-knowledge-h1.mjs` | 知识卡正文补 `# <name>` 标题（frontmatter 后插入，已有 h1 跳过） |
| `gen-knowledge-adr.mjs` | 知识卡 `adr:` 关联补全（扫描源码 `[doc:adr-NNN]` 标记，仅 architecture 卡） |
| `gen-knowledge-tests.mjs` | 知识卡 `tests:` 登记（扫描 frontend/src 测试文件按名匹配补登） |
| `new-knowledge-card.mjs` | 知识卡脚手架 |
| `new-adr.mjs` | 新 ADR 脚手架：双源占号 + 四段模板 + 登记表登记 + 自动 adr-check；用法 `node scripts/new-adr.mjs "标题" [--slug kebab-name] [--related 关联内容] [--supersedes ADR-0XX,...] [--dry-run]` |
| `gen-docs-index.mjs` | 分区索引：**`docs/adr/index.md` 单文件承载全部**（状态分布 + 登记表 + 使用规则 + 状态分组，整文件重写，ADR 双文件合并后 README 为指针页）+ releases 最近版本/版本全览（GEN 标记区），knowledge 委托校验 |
| `gen-project-map.mjs` | 项目结构地图生成（`docs/project-map.md`）：扫描磁盘目录，目录用途直接维护在 `docs/project-map.md` 表格内（脚本读回复用，无外部基线，消除双源漂移）；4 个 GEN 标记区；`--check` 已挂 doctor 防漂移；未登记用途的新目录 WARN 提醒 |
| `gen-cli-doc.mjs` | **CLI 命令参考生成（`docs/cli-commands.md`）**：静态提取 `go/cli/` 的 `RegisterCommandC` 注册表 + `print*Usage` 子命令文本 → 命令/分类/子命令/选项表格（GEN 区）；单一事实来源 = 源码注册，新增命令改源码即同步；`--check` 已挂 doctor/pre-push，配套 `tests/test_cli_doc_parity.mjs` 锁注册表↔文档双向一致 |
| `gen-cli-completion.mjs` | **CLI shell 补全生成（`completions/ysm.bash` / `_ysm.ps1` / `_ysm`）**：与 gen-cli-doc 同源（`_lib/cli-registry.mjs` 共享解析层），生成 bash/pwsh/zsh 三份 Tab 补全（顶层命令/子命令/选项）；`--check` 已挂 doctor/pre-push，配套 `tests/test_cli_completion_parity.mjs`；pre-commit 快照已含 `completions/` 自动 stage |
| `gen-guide-gap.mjs` | 指南覆盖缺口扫描：提取 app-modules.ts 组件/服务功能面，与 docs/guide 对照列出缺口（WARN 不阻断；`--strict` 缺口时退出码 1） |
| `build-novel-index.mjs` | 小说总索引生成（`docs/novel/index.md`）：扫 `docs/novel/` 目录树（act-\* + 01..10 区域 + appendix），整文件重写；区域文件夹内**禁放 README**（索引唯一来源即本脚本）；`--check` 已挂 doctor 防漂移 |
| `gen-vitepress-sidebar.mjs` | VitePress 侧边栏生成：扫 `docs/` 全量 md 按目录树组织导航 → `docs/.vitepress/sidebar.gen.mjs`（勿手改），`docs/package.json` build 脚本前置调用（ADR-022） |
| `gen-doc-next-steps.mjs` | 文档体系「待补地图」诊断聚合：聚合 `check-knowledge-drift` / `link-checker` / `adr-check` 的 `--json` → `docs/.doc-next-steps.md`（只读报告，不修改源文件） |
| `gen-routes.mjs` | AI 知识库路由表自动生成（`docs/knowledge/routes.md`）：从知识卡 frontmatter `use_when` 生成「意图 → 首选卡 → 关联阅读」路由表；`--check` 已挂 doctor/pre-push |
| `gen-routes-quick.mjs` | AI 急速版路由表自动生成（`docs/knowledge/routes-quick.md`）：从 `quick_groups` / `quick_intents` / `quick_risk_lines` / `pitfalls` 生成；配对不均恒打 WARN 绝不静默丢弃；`--check` 已挂 doctor/pre-push |
| `generate-locale-json.mjs` | 语言包 TS → JSON 构建（ADR-045）：以 `frontend/src/core/i18n/locales/*.ts` 为单一事实源，产出 `frontend` 运行时 locales 目录下的 `*.json` 供 fetch 消费（pre-commit GEN_CMDS 调用） |

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
| `resource_types.json` → `extensions.ts` 派生链路校验（ADR-014 单一事实来源，非字面量比对） | `type-consistency.mjs` |
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
| `_lib/git-ref.mjs` | `showAt`（跨 ref 读文本）、`existsAt`、`gitMaybe`、`logPath`/`logPathDetail`（路径提交历史）、`lsTree`/`diffTree`（ref 间文件清单对比）、`renamePairs`（rename 检测）、`lineCountAt`（跨 ref 行数）、`showAllAt`（批量快照） | git 历史任意 ref 下的源码读取；与 `source-graph.mjs` 的 `textOverride` 参数对接，避免把历史 blob 落盘再读盘的双重开销 |
| `_lib/source-graph.mjs` | `getExportedSymbols`（JS/TS）、`getGoExportedSymbols`（Go）、`getExportedSymbolsAny`（自动分发，支持 `textOverride` 传历史文本直接入参）、`walkSourceFiles`/`scanSourceGraph` | 源码导出符号提取；`textOverride` 是"拿历史某版本源码文本做符号分析"的统一接口，供 rollback-impact / bloat-history / api-break 等复用 |
| `_lib/domain-classify.mjs` | `classify()`（文件→域）、`planFromFiles()`（文件集→检查计划）、`DATA_FILES` | 变更域分类共享层，pre-push-gate / doctor --gate 共用，消除双端漂移 |
| `_lib/contract-tests.mjs` | `collectContractTests()`（列出测试文件）、`runContractTestsParallel()`（并行执行，spawn + Promise.all） | 契约测试并行执行共享层，doctor / pre-push-gate 共用，~31s vs 串行 ~43s |
| `_lib/log-push.mjs` | `logPush()`（双写 stderr + .git/push-log）、`clearPushLog()` | 推送门禁日志共享层，解决 git pre-push 钩子 stdout 被吞问题，日志带 ISO 时间戳 |

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

