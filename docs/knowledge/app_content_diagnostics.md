---
kind: app_content_diagnostics
name: 诊断与冲突页 diagnostics
tier: architecture
category: ui
source_files:
  - frontend/src/views/app-content/diagnostics/init.ts
  - frontend/src/views/app-content/diagnostics/logs.ts
  - frontend/src/views/app-content/diagnostics/dedup.ts
  - frontend/src/views/app-content/diagnostics/dedup-policy.ts
  - frontend/src/views/app-content/diagnostics/health.ts
  - frontend/src/views/app-content/diagnostics/conflicts.ts
  - frontend/src/views/app-content/diagnostics/perf.ts
  - frontend/src/views/app-content/diagnostics/perf-common.ts
  - frontend/src/views/app-content/diagnostics/perf-single-bench.ts
  - frontend/src/views/app-content/diagnostics/perf-gui-flow.ts
  - frontend/src/views/app-content/diagnostics/perf-log.ts
  - frontend/src/views/app-content/diagnostics/perf-trace.ts
auto_fields:
  symbols_with_lines:
    - bindPerfCopyHandlers
    - CLIResp
    - createDedupSession
    - DedupConfigShape
    - DedupFileLike
    - DedupSession
    - errorHTML
    - EscFn
    - formatSize
    - getDefaultKeepIdx
    - getOutBox
    - initDiagnostics
    - initPerfPanel
    - loadDiagnosticsLogs
    - loadRuntimeLogs
    - populatePerfRtypeOptions
    - renderHealthReport
    - renderLoadTraceSection
    - respHasOutput
    - runGuiFlow
    - runHealthAudit
    - runPerfLog
    - runSingleBench
    - scanConflicts
    - scanSyncConflicts
    - sectionHeader
    - setBusy
    - setErrorCatch
    - setErrorMsg
    - setErrorResp
    - syncPerfBaselineControls
  tests:
    - frontend/src/views/app-content/diagnostics/conflicts.test.ts
    - frontend/src/views/app-content/diagnostics/health.test.ts
    - frontend/src/views/app-content/diagnostics/init.test.ts
    - frontend/src/views/app-content/diagnostics/perf.test.ts
    - frontend/src/views/app-content/diagnostics/perf-common.test.ts
quick_groups:
  - 模型扫描与仓库管理
quick_intents:
  - 诊断页、仓库体检、冲突 / 去重
  - 日志查看、性能分析
  - initDiagnostics、createDedupSession
  - oldest 资历排行
quick_risk_lines:
  - 去重 / 体检必须经 diagnostics 页发起，禁止在其他页直接调 doDedup
pitfalls:
  - 在仓库页直接调 doDedup → 缺上下文、无法展示冲突视图；必须走 diagnostics 页 initDiagnostics
  - 性能 trace 未释放 → 长时占用内存；file-bench / perf-trace 完成后必须 stop 回收
use_when:
  - 诊断页
  - 冲突
  - 去重流程
  - 诊断页日志 tab
  - 性能
  - oldest
perf:
  - cpu-bound
  - gpu-bound
  - concurrent
invariant_anchors:
  - frontend/src/views/app-content/diagnostics/dedup.ts|createDedupSession
status: active
---

# 诊断与冲突页 diagnostics

## 概览

`diagnostics/` 是 `app-content` 的「诊断与冲突」页子域，顶部 8 个 `repo-tab`（log / single / gui / hist / trace / conflict / health / sync-conflict，ADR-258 由左栏分段收敛而来），由主卡 `app-content` 的 `init-pages.ts` 经 `bindTabs(host, ".repo-tab", "diag", [...])` 接入全站统一范式分发初始化。内部高内聚：`init.ts` 汇聚全部子模块，子模块之间只依赖 `logs.ts`（操作日志渲染），对外只依赖 `core/i18n` / `bus` / `backend` / `utils` 基础设施，**不反向依赖 app-content 其他子域**（归属边界干净，ADR-138 拆分依据）。

> 导航结构演进（ADR-258）：原左栏 `diag-left`（6 个 `diag-btn` + 复制/刷新/清空）已删除，分段提升为顶部 `repo-tab`；日志合并为 1 个 tab（op/runtime 子 tab 切换），性能拆为 single/gui/hist/trace 4 个 tab；清空按钮归位日志面板工具栏且仅操作日志视图可见（仅 `ClearImportLogs` 生效，运行时日志无清空后端能力）。

## 核心职责

- `init.ts` — 诊断页 `initDiagnostics`；去重会话 `createDedupSession`（由 `init-pages.ts` 持有会话实例，`session.start` 派发 `model:select` / `stats:refresh` / `tree:reload`）
- `health.ts` — 仓库体检面板：调 Go 端 `RepoHealthAudit`（go/repoaudit 同源，GUI/CLI 消双轨），渲染分数环/完整性/缓存/资源/去重/警告
- `dedup.ts` — 去重检测（读 `services/resource-registry.ts` 资源类型注册表 + Go 绑定）；`createDedupSession()` 会话工厂把 busy/exec 重入守卫与去重配置收进闭包，经 `init.ts` re-export 接线。keep 保留策略纯函数于 2026-09-03 抽至 `dedup-policy.ts`（策略决策零 DOM/会话依赖，渲染默认保留索引与 exec 删除共用同一决策源，防规则漂移）
- `dedup-policy.ts` — keep 保留策略纯函数层（`getDefaultKeepIdx` + `pickByTime` 共享 pick 辅助 + `DedupFileLike`），自 `dedup.ts` 抽出（2026-09-03，ADR-040 拆分线延续）；零 mock 单测聚焦策略分支
  - `toTimestamp` 缺失/非法返回 `null`（「无时间信息」），不参与时间裁决；全缺失时 `pickByTime` 严格比较保序回退首项（2026-09-12 P0 收口，修「newest 侧 MAX 哨兵反判最新」潜伏语义缺陷——Go 扫描恒带回 modTime，生产不可达）
- `conflicts.ts` — 冲突列表渲染（依赖 `logs.ts` 的操作日志数据）
- `logs.ts` — 操作日志渲染：`OP_META` 七种中文标签+图标，状态图标优先读 `Level`（error→❌ / warn→⚠️ / debug→🔍 / fatal→💀 / info→✅），无 Level 按 `Status` 兜底；消费 Go `logs` 包（见知识卡 `go_logs`）
- `perf.ts` — 性能面板 facade：事件接线 + re-export，业务逻辑拆至：
  - `perf-common.ts` — 共享工具层（sectionHeader / 复制按钮 / 守卫 / 错误辅助）
  - `perf-single-bench.ts` — single-bench（CLI 文本流消费 + 柱状图 + 趋势图）
  - `perf-gui-flow.ts` — gui-flow（6 阶段结构化消费）
  - `perf-log.ts` — perf-log（优化历史卡片）
  - `perf-trace.ts` — 加载剖析（load-trace store 消费）

## 对外 API / 入口

- 由主卡 `app-content` 的 `init-pages.ts` 调用：切诊断页 → `diagnostics/init.ts` 的 `initDiagnostics(root)`
- 监听 bus：`model:select` / `stats:refresh` / `tree:reload`（去重流程派发）
- 样式：`.diag-*` / `.perf-*` / `.log-row` / `.conflict-row` / `.scan-*` 动画定义在 `app-content` 样式层 `content-diag.ts`（跨子域共享，不随本卡迁移）

## 与其他子系统关系

- `go-logs`（Go 操作日志）→ `diagnostics/logs.ts` 消费端
- `go-repoaudit`（Go 仓库审计）→ `diagnostics/health.ts` 消费端
- `preview-3d/infra/load-trace.ts` → `diagnostics/perf-trace.ts` 加载轨迹
- 主卡 `app-content` 负责页面编排与分发；本卡只管诊断页自身的初始化与渲染

## 不变量

- 去重会话 `session.start` 派发的 `model:select` / `stats:refresh` / `tree:reload` 必须齐全，否则去重后界面不刷新
- 性能轨迹读取 `preview-3d` 的 `getLoadTraces` 为只读快照，不写回
- 冲突列表顺序与 `logs.ts` 的 `Operation` 分组一致（`OP_META` 标签为单一事实源）
- exec 读用户选中态按组容器查 `input[type="radio"]:checked`（2026-09-03）：组容器按渲染平铺序与 `allResults.groups` 一一对应，替代按 `name="dedup-keep-<gi>"` 全局拼串——组间插入其它控件不致错位，消除「渲染计数 gi / exec 计数 gi2」双轨对齐依赖；keep-all 值为 `-1` 的 radio 同属组内

- **面板结构由 `renderTabs` 工厂单点产出**（ADR-259，2026-09-17 事故收口）：诊断页此前是全仓唯一的例外范式——「一个共享 `.tab-body` 包 8 个 `.diag-panel`」。该范式更脆：`.diag-log-bar` 漏一个 `</div>` 就让 `#diag-tab-log` 把后续 7 个面板吞进自己内部，而 `bindTabs` 切页时把 `#diag-tab-log` 置 `display:none`，嵌在里面的面板一并消失 → **切任何 tab 都只剩空 tab 栏**。现改用 `views/app-content/tabs-shell.ts|renderTabs`（与其他 tab 页同构：每 tab 一个 `.tab-body`），面板 id 与 `bindTabs` 的 `${prefix}-tab-${id}` 共享同一条规则；`.diag-panel` 退化为纯入场动画钩子（布局归 `.tab-body`）。防线三层：`tabs-shell.test.ts`（工厂产出契约）+ `tpl-structure.test.ts`（各页 div 配平 / 按钮↔面板一一对应 / 面板必为 `.tab-body` 且等深同层）+ `e2e/diagnostics.spec.ts`（真实浏览器逐 tab 测 `getBoundingClientRect` 尺寸——`display` 口径对此失明）。泛化规则见 `skills/pitfalls.md` #20。
- **日志面板工具栏按语义分两行**（2026-09-17 版面收口，方案 A）：行1 = 子 tab（操作 / 运行时）+ 动作（刷新 / 复制 / 清空日志），行2 = 状态筛选 chips + 搜索框；两行容器为 `.diag-log-row`，`.diag-log-bar` 退化为纵向堆叠的框。立因：9 按钮 + 1 输入框挤单行时，`flex:1` 的 spacer 把「清空」（破坏性动作、且只清操作日志）与筛选 chips 划成一组、却把刷新 / 复制推到行尾，视觉分组 ≠ 功能分组，且窄宽下 spacer 随 `flex-wrap` 折行挤散动作组。清空恒排行尾；行2 搜索框 `flex:1; min-width:110px; max-width:320px` 吃掉腾出的宽度。类名 ↔ 规则同步由 `css/content-diag-classes.test.ts` 兜底（`.diag-log-row` 属布局类，有规则即通过）。
- **日志搜索是「共用输入框 + 按子 tab 分派」**（2026-09-17 收口）：`#diag-log-search` 同时服务操作日志与运行时日志，`init.ts|dgInBindLogSearch` 按当前子 tab 分派（op → `loadDiagnosticsLogs`，runtime → `loadRuntimeLogs`）。命中域：操作日志用 `logs.ts|dgLsMatchDiagSearch` 把 ModelName / ErrorMsg / TargetDir / SourcePath / Operation 拼成串做子串匹配（此前只匹配 ModelName，搜报错内容必然空手）；运行时日志只匹配 Message（无 Status/路径概念）。两侧同为「最新 N 条窗口内检索」（op 500 / runtime 300），超窗口历史条目不召回；无命中统一落 `diagnostics.noMatchLogs` 占位。状态 chips 只作用于操作日志（运行时日志 Level 恒为 info），运行时子 tab 下点击仅更新选中态、**不回落拉 op 列表**（避免白跑一次 GetImportLogs）。placeholder 因此改为「搜索日志内容...」（key 未改名，值在 `src/locales/*.ts`）。
- **single-bench 走结构化出口，不再正则解析中文文案**（ADR-262 D1，2026-09-17 切片 1）：前端 `perf-single-bench.ts` 传 `--format json` 并消费 `resp.data`（`SingleBenchPayload`，字段与 `go/cli/bench_concurrent.go|singleBenchJSON` 逐字对齐）；Go 侧 `ctx.SetResult(&output)` + `AttachSidecar`（ADR-200 D5）让桥的 data 承载对象本体，`output` 只作「复制原文」。**total 双口径**：`total_ms` = N 次迭代累计墙钟，`per_iteration_ms` = 单次平均——旧 UI 拿累计当单次展示（「6ms 谁信」的机制性来源之一）。阶段分级（bottleneck / warn / slow / ok）由 Go `stageStatus` 单一口径给出（阈值 100/50/10ms 只在 Go），前端只做 emoji/配色映射，不得自算阈值；`stagesToJSON` 改两趟识别唯一最慢阶段（旧实现可产出多个 `bottleneck=true`）。Go 侧 `hints` 仍是中文散文，未 i18n 前不上 UI（结构化保留供 AI 消费）。契约由 `go/cli/bench_internal_test.go` 锁字段名 + sidecar 注入。
- **性能报告带 identity 身份块**（ADR-262 D2，2026-09-17）：`go/cli/perf_identity.go|buildPerfIdentity` 产出 `{rtype, rtype_source, rtype_label, form, filesRoot, relPath, absPath}`，`single-bench`（`runSingleBenchJSON`）与 `benchmark`（`perf.go|runBenchIterations`）都填。判定**复用** `classifyForScan` 三段口径（目录归属 > 扩展名 > 容器兜底，`flow.go`），不另立类型表：`rtype_source` ∈ location / extension / container 说明「凭什么判成这个类型」；`form` ∈ dir / file 由 `registry.IsYsmEntryJSON(base)` 派生（打包形态不可能以 ysm.json 结尾）。立因：旧的 `format`（YSM/PMX/…）是 `detectModelFormat` 扩展名表派生的展示标签，推不出归属（`.zip` 被 14 类型声明、MMD 子类型共享 `.vpd`/`.vmd`），且载荷只有绝对路径 → 换机器后测试/AI 无法回溯识别。**测试只断言 `rtype` + `relPath`，不断言 `absPath`**（`bench_internal_test.go|TestBuildPerfIdentity_Sources` 覆盖三段来源）。
- **目录式模型 = `<dir>/ysm.json`，入口单点归一化**（ADR-262 D7，2026-09-17 切片 C）：目录形态**不是散的**——`scanner.go` 把 ysm.json 条目的 `Path` 保持文件路径、`Name` 取父目录名，`fileops`/`avatar`/`importer`/`app_model` 全用 `registry.IsYsmEntryJSON` 判定，所以新功能**不需要**各自实现目录分支。唯一缺口在 perf 入口：`resolveBenchModelTarget`（`perf_identity.go`）把目录折叠为 `<dir>/ysm.json`，经 `perf.go|resolveTargetModel` 供 single-bench 与 perf-snapshot 共用；传目录曾直接 ① 读盘失败（`os.ReadFile(目录)`）+ 失败被吞 → 载荷全绿。目录内无 ysm.json 时明确报 param 错误，不静默降级。端到端锁在 `go/cli/bench_dirform_test.go`（复用 `tests/fixtures/ysm/shen-fengling` 极简目录样本，ADR-054）。
- **阶段失败优先于耗时分级**（ADR-262 D8，2026-09-17）：`singleBenchStage.Failed` 独立成字段，`stagesToJSON` 中 `failed` 覆盖 `stageStatus(ms)`（失败常为 0ms，只按 ms 分级会被判 `ok`）；`avgBenchStages` 保留 `Notes`（首个非空）/`Bytes`（平均）/`Failed`（或），原实现只留 Duration → 失败原因在到达载荷前就丢了。前端 `STAGE_STATUS_META.failed = ❌ + perf-bar-danger`。另修 `detectModelFormat(".../ysm.json")` 返回 `JSON` 与 `identity.rtype=ysm` 打架 → 现按 `IsYsmEntryJSON` 归 `YSM`；目录式 `size_bytes` 记 0（ysm.json 只是清单一角，模型体量看 ④⑤ 阶段），① 阶段名在目录形态下如实标「① 清单读取」。
- **类型矩阵 `--rtype` / `--all-types`**（ADR-262 D3，2026-09-17 切片 C）：`go/cli/perf_targets.go` 提供目标集解析——`scanBenchTargets`（单类型/默认可分析类型）与 `scanTargetsGrouped`（按类型归并，供 `--all-types`），发现权复用 `scanner.ScanEntries`（**发现权单点**）、类型判定复用 `classifyForScan`、类型与组内路径均**字典序**（Walk 顺序依文件系统而变，测试/AI 断言需可复现）。载荷 `{spec:{rtype,all_types,max_models,iterations,analyzed,unsupported,cli_analyzable,types[]}, models:[单模型载荷…]}`，与 `--model` 互斥、仅 `--format json`（text 模式明确拒绝而非静默降级）。**样本清单 = `perfTypeManifest`（Go 表）**：登记 `{cli_analyzable, expected_stages, note}`，`cliAnalyzable()` 未登记即不可分析；**发现白名单 ≠ 可分析白名单**——PMX/PMD/VRM/FBX/GLTF 的解析器只在前端 3D adapter，CLI 拿到是空模型 → 这类类型在矩阵里**只出身份、`stages` 为空**并附解释性 hint，绝不拿空模型阶段数据冒充实测。清单的 `expected_stages` 是**运行期自检依据**：实际阶段链长度不符即置 `types[].stage_mismatch`（如 MMD 缺 ④⑤⑥）。`scanFirstModel` 同时补认目录式入口（`IsYsmEntryJSON`），纯解包目录仓库不再「未找到模型」。测试 `go/cli/bench_matrix_test.go`（fixtures 跑 2 个真实目录样本 + 不可分析类型不伪造 + 清单一致性 + text/互斥拒绝）。
- **gui-flow 实测 / 估算分离 + 「能测的不要估」**（ADR-262 D2/D8，2026-09-17）：`guiFlowStageItem` 增 `kind`（measured/estimated）、`estimated_ms`、`note`，`guiFlowStructured` 增顶层 `estimated_ms` 合计；`total_ms` 语义 = **实测墙钟**，估算**不计入**。⑤ 数据准备 = **实测** JSON 序列化（载荷字节数 `len(json.Marshal(model))` + 实测耗时）+ 仅传输时间按 `ipcAssumedBytesPerSec`（50MB/s）假设外推进 `estimated_ms`（`note` 同时说明「实测了什么/假设了什么」）；⑥ 渲染预估 = `kind=estimated`、`ms=0`（无实测工作量）+ 首帧公式区间中值进 `estimated_ms` + `note` 写公式。**能测的不要估**：只有 CLI 观测不到的环节（Wails IPC 传输时间）才允许估算；single-bench ⑥ 的 IPC 字节数同样从 `(几何+纹理)*4/3` 估算改为实测 `len(json.Marshal)`，随之删除失去唯一消费者的 `estimateTextureSize`。文本报告标 `[估算]` 并单列「其中估算 X ms（不计入总耗时）」；前端 `perf-gui-flow.ts` 渲染 `估算` 角标 + 「实测 + 估算」分列 + 估算单独一行（i18n key `diagnostics.perfEstimated` / `perfEstimatedHint` / `perfEstimatedTotal`，CSS `.perf-gui-est`）。**同一工作不重复计时**：③⑤⑥ 曾各调一次 `AnalyzeBedrockModel`（同一解析计 3 次），现 ③ 分析一次传模型给 ⑤⑥。`estimated_ms` 用**纳秒精度**换算——`Microseconds()` 截断会让亚毫秒估算恒为 0 并被 `omitempty` 整个吞掉。测试 `go/cli/flow_estimated_test.go`（计数桩锁「只分析一次」+ 估算/实测分离 + 合计契约）与 `go/cli/bench_serialize_measured_test.go`（⑥ 字节数 = 实测序列化长度）。
- **类型矩阵前端接入**（ADR-262 D3，2026-09-17）：单模型 tab 的控制条新增类型选择器 `#diag-perf-rtype`（选项由 `perf-matrix-render.ts|populatePerfRtypeOptions` 从 `loadResourceRegistry()` 填充——**类型表单一事实源是 Go/`resource_types.json`，前端不写死**；注册表不可用时保留「单模型」项回落旧行为）与每类上限 `#diag-perf-max`。`perf-single-bench.ts|singleBenchReadMode` 派发三态：空值 → 单模型（需路径）、`__all__` → `--all-types`、类型 id → `--rtype`；矩阵载荷 `{spec, models[]}` 由 `perf-matrix-render.ts|renderPerfMatrix` 渲染（类型汇总表 + 逐模型 identity 行）。**诚实红线在展示层同样成立**：`cli_analyzable=false` 的类型显示「未采集」而**不是 0.00ms**——空模型数据不得当实测。Go 侧 `single-bench` 的 `rtype/all-types/max-models` 已登记 ParamSpec（ADR-173，否则桥走 legacy 告警路径）。测试：`perf-matrix.test.ts`（分发参数 / 渲染 / 未采集诚实 / 空态 / 选项来自 registry）+ e2e `diagnostics.spec.ts`（真实浏览器断言选择器选项来自 mock 注册表）。⚠️ 连带修 `e2e/mock-data.ts` 的 `LoadResourceTypes`：此前用 `JSON.stringify` 返回**字符串**，违反 ADR-143 P0「去 string-JSON 化」（Go binding 返回结构体），导致 e2e 里 `loadResourceRegistry()` 恒判空注册表 → 所有注册表驱动 UI（含新选择器）在 e2e 中静默降级为 fallback。
- **阶段三要素补齐：`runtime` 归属 + 样本统计 `n`/`median`/`p95`**（ADR-262 D2，2026-09-17）：此前阶段只有 N 轮**均值**且无归属——ADR-262 §背景 #6 记的「无样本统计、无方差可言」+「Go / Rust / WASM / Three 耗时构成是黑箱」。**数据本已在手**（`runSingleBenchSamples` 一直保留全部原始样本），只是被 `avgBenchStages` 当场平均掉，故本次**不新增仪表**，只新增汇总：`collectStageStats(allStages)` 按阶段名归集 `msOf` 样本 → `benchStageStats{n, median_ms, p95_ms}`，经 `stagesToJSON(avg, allStages)`（签名新增第二参，5 处调用点同步；传 `nil` 的纯汇总路径**不产出 stats**，不伪造 `n=0`）。
  - **分位数口径 = 最近秩法**（`percentileNearestRank`，升序取 `ceil(p*n)-1` 号），非线性插值：默认只跑 3 轮，插值会产出「不存在的样本」（从未实测到的值），与「数字必须来自实测」冲突；最近秩保证结果必是某次真实样本，且对 `p` 单调 → **`p95 >= median` 对任意 n 恒成立**（ADR-262 D6 要的结构不变量）。`n=1` 退化但如实（median=p95=该唯一样本），故前端**仅在 `n>1` 时渲染分布**——展示单样本的 p95 等于把退化包装成分布，`n` 仍留在 tooltip 供追问。`n` 是**该阶段实际出现次数**（阶段可因失败提前返回而缺席某轮），不是迭代轮数。
  - **runtime 归属如实报，不为好看编造分层**：single-bench 全链路（`os.ReadFile` / `AnalyzeBedrockModel` / 校验 / 几何 / 纹理 / `json.Marshal` / 缓存）确实全在 Go，故 `runSingleModelBench` 出口统一打 `singleBenchRuntime = "go"`（不逐个 stage 字面量重复写，漏一个就是一个无归属阶段）。gui-flow 归属在**装配点**按「调了哪个阶段函数」打（`withRuntime`）：② 模型扫描取 `scanner.ScanBackend`（新增构建期常量——`rust_backend.go` = `"rust"` / `rust_backend_stub.go` = `"go"`），③④⑤ 为 `go`，⑥ 渲染预估归 `three`（它估的是 Three.js 首帧，**估算性质由 `kind=estimated` 承载**，二者不互相替代）。② 的归属是「Rust 扫描器收益可被度量」的落点；边界：`ScanBackend` 是**构建期事实**而非单次调用实际处理方——`rust_backend` 构建下 Rust 仍可能运行时不可用而静默回退 Go（`rust_backend.go` 返回 `handled=false`），报告口径以构建为准。**未采用**：给 `ScanEntriesWithHitCtx` 加「本次由谁处理」返回值——该函数多 return 点 + goto/缓存/单飞/重试逻辑，穿新返回值风险远大于收益。
  - 契约：`bench_internal_test.go|TestSingleBenchJSON_JSONShape` 字段锁增 `runtime`/`stats`/`n`/`median_ms`/`p95_ms`；`bench_stage_stats_test.go` 锁最近秩数学、`p95 >= median`、ragged 时 `n` 如实、runtime 在 `avgBenchStages` 聚合与出荷两段不丢、gui-flow 各阶段归属（②=`scanner.ScanBackend`、⑥=`three`）；`tests/test_cli_gui_flow_contract.ts` 新增 `SB_STAGE_FIELDS` 双端字段锚定；前端 `perf.test.ts` 锁徽标逐阶段与 `n=1` 不渲染分布。前端不重算任何判据：归属与分位数全由 Go 给出，i18n key `diagnostics.perfStageRuntimeHint` / `perfStageStats` / `perfStageStatsHint`，CSS 新增共用类 `.perf-rt-tag`（徽标）/`.perf-stats`（等宽数字）。
- **「CLI 可分析模型」判定收编为单点**（ADR-262 D3 收口，2026-09-18）：ADR-262 记的「三张硬编码类型表」**数得少了**——审计发现同一问题「这个文件 CLI 能不能真分析」在 `go/cli` 里散在四处，各写各的扩展名白名单：① `bench_concurrent.go` 并发基准 `ext == ".ysm"`（且无命中时**退化为取任意条目**）；② `perf.go|scanFirstModel|allowedExts`（ADR 漏记的第 4 张）；③ `flow.go|scanSummaryByType` 首模型 `ext == ".ysm"`；④ `detectModelFormat`（属展示标签，另案）。而两个事实源**早已存在**：可分析性 = `perfTypeManifest`/`cliAnalyzable`（`perf_targets.go`，D3 已落地）、归属 = `classifyForScan`（三段口径）。本次只新增一个谓词把它们合起来：`cliAnalyzablePath(path, ext, reg)` + 从条目挑选的 `pickCliAnalyzable(entries)`——**不新建表，只删表**。
  - ⚠️ **这不只是 DRY，是诚实缺陷**：`scanFirstModel` 原白名单含 `.vrm/.gltf/.glb/.litematic`，而这些类型的解析器只在前端 3D adapter（CLI 拿到是空模型）；它的两个消费方 `perf.go|resolveTargetModel` 与 `health --bench` **直接把返回值喂进 `runSingleModelBench`** → 产出「空模型数据当实测」，直接违反 D3 与 D8。故 `perf_test.go|TestScanFirstModel` 原断言「跳过 .txt 命中 .vrm」是**锁住了缺陷**，本次就地改写为正确口径（不是等价重构，故必预改测试）。
  - `scanFirstModel` 现 = `scanBenchTargets(filesRoot, "", 1)[0]`：顺带得到路径字典序（原为 Walk 首命中，依文件系统而变→测试/AI 不可复现）、目录式入口 `<dir>/ysm.json` 由 scanner 折叠工序覆盖（不再需单独的 `IsYsmEntryJSON` 分支）、以及新的容器形态能力（ysm 目录下的 `.zip` 也算可分析）。**语义变化须知情**：发现权归 `scanner.ScanEntries` 后**继承其目录缓存**（TTL 内同目录复用，变更由 `InvalidatePath` 失效）——原直读 Walk 无缓存；命令级调用只调一次无实际影响，但测试必须先落盘再调用（故相关用例按场景各用独立 root）。
  - **已核查、判定为非类型表（不改）**：`bench_concurrent.go|collectTestFiles` 的 `case ".ysm", ".json", ".zip", ".7z"` 是**并发文件读取的取样集**（其契约由 `cli_test.go` 明确锁定「任意 .json 都算候选」——其集合与 registry 里 ysm 的扩展名重合只是巧合），改用 `cliAnalyzablePath` 会反而破坏它。**仍待办的展示层遗留**：`detectModelFormat`/`parseStageName`（扩展名→展示标签，非归属；`format` 字段已被 `identity.rtype_label` 取代，退役需同步载荷契约与前端回落，另案）。
  - 测试：`perf_cli_analyzable_test.go`（归属驱动真值表含 location 优先的 ysm `.zip` 与 mmd `.pmx` / 挑选保持扫描序 / 并发基准只含不可分析类型时**如实报错**而非跑空模型 / 首模型随清单与归属自动扩展）；`bench_matrix_test.go|TestScanFirstModel_DirForm` 与 `TestScanBenchTargets_DeterministicAndTyped` 无需改动即绿（它们本就走 scanBenchTargets，正是本次对齐的目标口径）。
- **gui-flow ④⑤⑥ 门控改为「有没有真分析出模型」**（ADR-262 D3/D8，2026-09-18，上一条牵出的缺陷）：`runGUIFlow` 原按 `ext != ".pmx" && ext != ".pmd"` 门控派生阶段，而 `runPhaseModelAnalyze` 只在 PMX/PMD 上短路。于是三类**空数据当实测**同时存在：① `--model x.vrm`（及 FBX/GLTF/litematic）→ ③ 报「❌ 分析失败」**但 ④⑤⑥ 照跑**，在空 `types.BedrockModel{}` 上产出三个阶段；② 损坏的 `.ysm` 同理——**按类型门控永远挡不住这一类**（类型判定会说「ysm 可分析」）；③ VRM 等连一句提示都没有（只有 PMX 有）。
  - 两处改动：**③ 的分派依据**由扩展名改为 `cliAnalyzablePath`（同一条单点谓词；PMX/PMD 保留专属人话点明 `@moeru/three-mmd`，其余类型统一告知「解析器只在前端 3D adapter」）——至此 `flow.go` 里最后一张扩展名表（`ext == ".pmx" || ext == ".pmd"`）消失；**④⑤⑥ 的门控**改为 `len(model.Bones) > 0`，即「真实产出」而非类型：它比类型谓词更强，同时覆盖「前端专属类型」与「解析失败/损坏」两种空数据来源，且不依赖任何名单。
  - 测试：`flow_analyze_gate_test.go`——不可分析类型**不得调 AnalyzeBedrockModel**（省一次必然失败的分析）且 ④⑤⑥ 全不产出；损坏模型时 ③ 如实标 ❌ 且 ④⑤⑥ 全不产出；**正向护栏**：真能分析时 ④⑤⑥ 必须照常产出（防「一刀切跳过」误伤好路径）。既有 `cli_test.go|TestGUIFlow_PmxTarget`（③ 提示 + 无 ④ + 不报「分析失败」）无需改动即绿。
- **基准判决入载荷 + 基准槽 + stdout 纯度**（ADR-262 D8/D1，2026-09-18）：退化门禁（`--baseline` / `--save-baseline` / `--threshold`）此前**只有 CLI 能用、GUI 用不了**，且两个消费者都拿不到东西——这就是背景缺陷 #2「永远没有好还是坏的判定」的机制：判决只活在 stdout 散文与 error 字符串里，载荷（`SetResult`）没有它，界面顶多转述一句「退化超过 50%」。
  - **纯搬运式拆分**：`compareSingleBenchBaseline` 原先「边遍历阶段边 `fmt.Println`，退化时返回 error」；现拆为 `evaluateBaseline`（**只算不说**，零 stdout 副作用，返回 `perfBaselineDiff`）与 `compareSingleBenchBaseline`（text 模式渲染人话）。判据（阈值 / **两层**噪声下限 / 六类判决 regressed·slower·ok·faster·new·noise）逐字沿用，`pre_push_gate` 记录的两侧断言无需改动。基准特性独立成文件 `go/cli/bench_baseline.go`。
  - **判决进载荷**：`singleBenchJSON.baseline = {saved_to?, diff?}`，`diff = {path, threshold_pct, noise_floor_ms, verdict, degraded, stages[{name, base_ms, now_ms, delta_pct, verdict}]}`——前端因此能逐阶段说「哪个慢了、慢了多少」，且 `base_ms`/`now_ms` 都给，前端**不重算**百分比。未用基准参数时连 `baseline` 键都不出现（`omitempty` 的诚实性：缺席就是缺席，不是 `{"diff":null}`）。
  - ⚠️ **顺带修掉 stdout 纯度缺陷（同一处代码的另一面）**：JSON 模式下 `compareSingleBenchBaseline` 把中文散文打在 JSON _后面_，`--format json --baseline` 的输出不再可 `json.Unmarshal`——与 `runSingleBenchJSON`「静默运行，输出结构化数据」的契约直接冲突。现 JSON 路径改走 `buildBaselineJSON`（装配载荷），人类文案只走 text 路径；**写入者也静默**（`saveBenchBaseline` 不再打印，「💾 基准已保存到」由 text 模式的 `applyBenchBaseline` 宣布）——端到端实证正是这条抓出来的：`--save-baseline` 时 JSON 后仍跟一行中文。基线：`ysm` 包的加载日志走 **stderr**，验证 `--format json` 纯度时必须分离 1>/2>，否则会把它当成 stdout 污染（`2>&1` 会把 `2026/...` 混进来，`JSON.parse` 报 `position 4`）。
  - **「基准放哪里」的策略留在 Go**：哨兵值 `default`（`--baseline default` / `--save-baseline default`）解析到标准基准槽 `os.UserConfigDir()/YSM-Model-Manager/perf-baseline.json`（与 `avatar`/`texture_cache` 同根，ADR-046 P2，避免多套基准目录分叉）；平台配置根不可用时**报错而非静默**。前端只说「要基准」，不编路径——与「类型判定唯一事实源在 Go」同一条职责红线。CI/高级用法仍可传显式路径。
  - **矩阵模式拒绝基准参数**：基准是**单模型**概念，而 `--rtype`/`--all-types` 的载荷是 `models[]`——原先这三个参数被**静默吞掉**（用户以为在跟基准比，其实没有）。现用 `fs.Visit` 精确判断「显式传入」并报 param 错误（对比默认值更准：用户可能手写同一个数）。
  - 测试：`go/cli/bench_baseline_test.go`。判据数学用**合成 stages** 锁（确定性）；集成用例只锁「stdout 纯 JSON」与「判决装配进载荷」——**不锁判决取值**，因为 fake app 的真实采集只耗几十微秒、正确落进 1ms 噪声下限判 noise（那是判据在起作用），且自对比在整包负载下可能偶发误判（既有 flake，见 `pre_push_gate`）。⚠️ **本仓测试坑**：`captureOutput` 接管的是**进程级** stdout，并行用例的打印会漏进另一用例的捕获 → 「单跑必绿、并跑偶红」；故凡抓/写 stdout 的用例一律**不并行**（Go 顶层并行用例在串行用例结束后才启动，串行即 stdout 独占），覆盖包级变量（`defaultBaselinePath`）的用例同理。
- **⚠️ 独立复核抓到的真缺陷：对比失败不得吞掉记录动作**（2026-09-18，`710f4cc72` 的补丁）。审核子代理实测：`--baseline <不存在> --save-baseline <文件>` → **退出 1 且保存文件根本没生成**，stderr 还指引用户「请先用 --save-baseline 记录一次基准」——而他刚刚点过。
  - 根因：`buildBaselineJSON` / `applyBenchBaseline` 在 `evaluateBaseline` 出错时**早退**（`return nil, err`），后面的 save 分支永不执行。而 GUI 新入口最自然的首次用法正是**两个勾同时打上**（记录 + 对比），此刻基准文件本来就不存在 → 首次必踩。属本仓诚实红线「参数被吞 = 不诚实」的**内部违例**：参数没被拒，而是被静默丢弃（比报错更坏——报错至少说明发生了什么）。
  - 修法：只记 `compareErr` 不早退，继续 save；`reconcileBaselineErrors` 在「记录确实发生」时把说明改成「（本次已记录新基准到 X，下次运行即可对比）」——**不能让错误文案指引用户去做他刚做完的事**。顺序仍是先比后存（先比旧基准再覆盖）。**规律**：`A 失败则跳过 B` 在「A、B 是同一用户意图的两半」时是错的——首次路径天然满足「A 必然失败」，于是 B 永不发生。
  - ⚠️ **包错误的二次包装陷阱**：`ErrRuntime.Error()` 自带「运行时错误: 」前缀，`newRuntimeErrf("%v", errRuntime)` 会打成「运行时错误: 运行时错误: …」（实测）。要在新文案里引用内层原因，必须先 `errors.Unwrap` 一层（对本包 `ErrParam`/`ErrRuntime` 都适用）。凡 `fmt.Errorf`/`newXxxErrf` 拼接既有 error 的地方都该按这条自查。
- **契约断言的强度：断言「组装点」而非字段名子串**（2026-09-18，同一次复核）。原断言 `singleCode.includes('"save-baseline"')` 想守「GUI 真的会传参」，但类型声明 `"save-baseline"?: BaselineSlot;` 本身就含该子串——**把整个组装分支删掉，门禁照样绿**（典型空转门禁）。改为正则锚定赋值形态（`/\[\s*"save-baseline"\s*\]\s*=/`、`/\.baseline\s*=\s*"default"/`、`/\.threshold\s*=/`），并**用「删掉组装点后断言必转红」实证非空转**（一次性脚本核验后删除）。**规律**：凡语义为「X 真的发生了」的门禁，必须能指出「把它删掉就变红」的反例，否则它只是在重复声明。
- **基准的 GUI 入口与判决渲染**（ADR-262 D8，2026-09-18，同一切片的前端半）：单模型 tab 控制条新增「记录基准 / 对比基准 / 退化阈值 %」三件套（`#diag-perf-baseline-save|compare|th`，testid 同名并登记 `VIEW_TESTIDS`）；`perf-single-bench.ts|singleBenchReadMode` 只在**单模型**模式读它们，勾了就传 `--save-baseline default` / `--baseline default` / `--threshold N`——**值传哨兵 `default`，路径由 Go 解析**（与「类型判定唯一事实源在 Go」同一条职责红线：前端不编文件路径）。
  - **⚠️ 载荷守卫必须放宽 `status === "success"`**（本切片最容易踩空的一步）：基准判「退化」时 Go 返回 **error 状态**，但载荷已随 `SetResult` 交出（规律六）。而 `singleBenchParsePayload` 原本第一句就是 `if (resp.status !== "success") return null;`——判决会被**整块丢弃**，UI 上「退化」只剩一句错误文案，「永远没有好还是坏的判定」等于没修。现改为「形状校验通过即可消费」，并在 status=error 时**额外叠加**错误横幅（`out.innerHTML = 柱状图 + banner`）——数字是实测的、判决是结构化的、错误原因是必要的，三者都要给。为此把 `perf-common.ts|errorHTML` 导出（`setErrorResp` 是整块替换 innerHTML，无法叠加）。
  - **判决渲染只做映射，不重算**（同 `STAGE_STATUS_META` 口径）：`BASELINE_VERDICT_META` 把 Go 的六类 token（regressed/slower/ok/faster/noise/new）映射成 emoji + 既有配色类；`base_ms`/`now_ms`/`delta_pct` 全部**直接展示**，前端不做除法、不判阈值。`noise`/`new` 的 `delta_pct` 在 Go 侧恒为 0（不编造无意义百分比），故这两类**改说原因**（「噪声区间，不判退化」/「基准里没有该阶段」）而非显示 `+0.0%`。`saved_to` 正文只说「基准已记录」，长路径进 `title` 不占版面。未用基准参数时 `baseline` 键缺席 → 整个基准块零存在感（不渲染空框）。
  - **矩阵模式禁用而非吞参**：`perf.ts` 在 `#diag-perf-rtype` 的 `change` 上同步 `syncPerfBaselineControls`（切到类型/全部类型即 `disabled` 三件套）——Go 侧对矩阵模式的基准参数是**明确拒绝**的，「被禁用」比「勾了却没生效」诚实。
  - 测试：`perf.test.ts` 新增 7 例（参数只组装勾选项且传哨兵 / 退化时结果+判决+错误横幅三者并存 / 未用基准零元素 / 只保存不回显路径 / 矩阵模式禁用且不传参 / 畸形基准载荷被守卫拒绝 / `iterations=0` 全零空载荷被拒）；契约测试加第 5 条断言面（基准字段双端锚定 + **前端真的传** `--baseline`/`--save-baseline`——只声明接口不传参 = 功能不可达）；e2e `diagnostics.spec.ts` 断言三件套就位 + 切矩阵即禁用。**e2e 抓到一个静态门禁抓不到的缺陷**：`perfBaselineHint` 带 `{noise}` 占位符却在模板期（拿不到载荷）被 `tpl.ts` 使用，页面残留字面量 `{noise}` 并触发 i18n 运行时告警——占位符键只允许在能拿到数据的渲染路径用，模板期文案另立无占位符键（`perfBaselineHint` vs `perfBaselineJudgeHint`）。
- **concurrent-bench 结构化出口 + GUI tab**（ADR-262 D1/D5，2026-09-18）：`concurrent-bench` 此前**只有文本**——没有 `--format`、没有 ParamSpec 登记（桥因此走 legacy 告警路径）、GUI 里连入口都没有，而「串行 vs 并行的加速比」正是 D5 主动压测的第一手数据。现新增 `go/cli/bench_concurrent_json.go|concurrentBenchJSON`（`{workers, max_models, model_count, models[perfIdentity], serial{total_ms, per_model_ms}, parallel[{workers, total_ms, speedup, verdict}], file_read?, hints?}` + ADR-200 D5 sidecar），`--format json` 时 `runConcurrentBenchJSON` 静默采集 + `SetResult`；**text 路径仍是流式打印**（每阶段跑完即出结果，长跑时看得见进度），两条线共用同一批底层函数（`benchSerialAnalyze`/`benchParallelAnalyze`/`benchSerialRead`/`benchParallelRead`/`collectTestFiles`）与同一份判据（`concurrentWorkerCounts`/`concurrentSpeedVerdict`/`concurrentVerdictLabel`/`concurrentHints`）。**断言加速比判决必须单点**：text 的「优秀/良好/一般/无提升」与载荷的 `verdict` token（excellent/good/fair/none）都出自 `concurrentSpeedVerdict` 一处阈值，前端只做 emoji/配色/i18n 映射（同 `stageStatus` 口径）。
  - **重构 text 输出必须实证「逐字未变」**：用 `git worktree add <tmp> HEAD` 检出旧版、补上 `go:embed` 需要的构建产物（`frontend/dist`、`ysm-updater-helper.exe`——worktree 里缺这两样 `go build` 直接失败），两版二进制同跑同一夹具，输出**把数字归一化后逐行 diff**。这一步当场抓出两个旧缺陷：`并行(4 workers): 0.00ms` 与 `加速比: +Infx`——根因都是 `float64(d.Microseconds())/1000`（亚毫秒截断成 0）与除零。故本命令的耗时换算统一改走 `durationMs`（纳秒精度，`msOf` 的重载语义是 `singleBenchStage`，两者不可混用），并给 Phase 3 加速比加除零守卫；截断还会把「并行快得多」显示成 `0.0x 🔴 无提升`——**截断制造的不只是难看的数字，是假结论**。
  - **档位去重 / 越界**：原 `{2,4,*workers}` 在目标值为 2/4 时把同一档位测两遍（报告出现两行同名「并行(4 workers)」，新载荷里会带两条 `workers: 4`），且 `--workers 1` 时竟跑 2 个 worker。现 `concurrentWorkerCounts` 取 `{2,4,目标值}` 并集（≤目标值、去重），实测 1/2/4/5 分别得 1/1/2/3 档。
  - **测量字段禁 `omitempty`**：`per_model_ms` 与 single-bench 的 `total_ms` 同属实测值，`omitempty` 会把「测到 0」和「没测」合并（ADR-262 D2 的 `estimated_ms` 被整个吞掉就是这坑）；缺席语义只留给**整块**没测的东西（`file_read` 无候选文件时整块不出现）。
  - **测试夹具要「量得到」**：假 app 无耗时 + 单文件 512KB 读，会让 `SerialMs/ParallelMs` 在时钟粒度下随机为 0（单跑 5 次里 2 次为 0），把断言变成测时钟——改用 `benchTimedFakeApp`（每次分析 sleep 200µs）+ 30 × 512KB（≈15MB，恰为 `benchFileLimit` 上限）后稳定。契约：`go/cli/bench_concurrent_json_test.go`（stdout 纯度 + 字段齐备 + 档位不重复不越界 + 判决 token 域 + text 模式 `ctx.result` 保持 nil + 无候选时 `file_read` 缺席）。
  - **前端半**：新 tab `conc`（`tpl.ts` 的 `renderTabs` 列表 + `VIEW_TESTIDS` 三项），`perf-concurrent.ts` 传 `{workers, "max-models", format:"json"}` 并消费载荷——`concParsePayload` 显式校验形状（`serial.total_ms` 是 number、`parallel` 非空数组且每项有 `workers`），**不要求 `status === "success"`**（规律六：判决为「无提升」时 Go 返回 error 但载荷是实测的）；判决 token 用**字面量联合类型**当 i18n 键（`ConcVerdictKey`），未知 token 按最保守的 `none` 渲染（不假装优秀）。`hints` 是未 i18n 的中文散文 → 结构化保留但**不在界面渲染**（与 single-bench 同口径）。契约测试新增第 6 条断言面（Go json tag ↔ TS 接口 ↔ 判决 token 域双端一致 + `--max-models`/`format=json` 组装点 + 反文本解析），e2e 断言 tab 真实可见且初始为空容器（不预置假数据）。
- **基准不可用的结构化原因 + 本地化横幅（D-7）**（2026-09-18，基准切片收尾）：`--baseline` 指向的文件不存在/损坏/读不了时，原因原本**只以中文散文**出现在 error 串里——`未找到基准文件 C:\Users\…\perf-baseline.json：请先用 --save-baseline 记录一次基准`。GUI 原样上屏 → ① 英文/日文界面冒出未翻译中文；② 泄露本机绝对路径；③ 把 CLI 口令当给 GUI 用户的指引。修法：载荷加 `baseline.error`（token：missing / unreadable / invalid / slot_unavailable）与 `baseline.detail`（中文细节含路径），前端 `BASELINE_ERR_KEYS` 映射 token → i18n 句，`detail` **只进 title**（追问问得到，版面不泄露）。
  - **token 只说「为什么不可用」，不说「本次是否已记录」**：后者由既有 `saved_to` 承载，前端把两个事实组合成句子（`perfBaselineErrSavedNote`）。同一事实存两份必然漂移——D-1 的教训（首次「记录+对比」时对比必然失败）正落在这条上：GUI 现在说「还没有记录过基准（本次已记录新基准，下次运行即可对比）」，不再指引用户去做他刚做完的事。
  - **包装层与二次前缀陷阱**：新增 `baselineUnavailable{Token, Err}`，其 `Unwrap()` 让 `ExitCodeOf` 的 errors.As 与文本观感（`运行时错误: ` 前缀、退出码 1）逐字不变——D-7 只**增加**出口，不改 CLI。连带把 `reconcileBaselineErrors` 的 `errors.Unwrap` 一层换成 `unwrapCliPrefix`（errors.As）：多一层包装后原写法只会拿到 `*ErrRuntime` 本身，「运行时错误: 运行时错误: …」立刻复发（本次实测抓回）。
  - **契约与测试**：`test_cli_gui_flow_contract.ts` 第 7 条断言面——Go json tag（error/detail）↔ TS 接口、四个 token 双端一致、**每个 i18n 键都要在 zh-CN/en/ja 三语有落点且真被映射使用**（加了键却漏接线 = 界面显示 key 名）。Go：`TestBuildBaselineJSON_UnavailableCarriesToken`（四类原因各一个 token + detail 含路径 + 没比成不给判决）、`TestReconcileBaselineErrors_NoDoublePrefix`、`TestEvaluateBaseline_TextProseUnchanged`；前端 `perf.test.ts` 新增 4 例（本地化正文 + 中文散文/绝对路径/CLI 口令都不上屏 + detail 进 title + 结果本体照旧渲染 / 已记录时同句说明 / 未知 token 走通用兜底而非中文散文 / 非基准类错误仍转述 Go 原话）。真 CLI 实证：`--format json --baseline <缺失>` → `exit=1`、stdout 纯 JSON 且 `baseline.error=missing`、`iterations`/`total_ms` 照旧；`--baseline <缺失> --save-baseline <文件>` → token + `saved_to` 并存且文件真的写出（D-1 不回归）。
- **性能面板真实渲染断言（ADR-262 D5，2026-09-18）**：性能面板的渲染断言此前只在 vitest（jsdom + mock `executeCLI`）——jsdom 不跑布局/CSS，「元素被 display:none 吞掉」「i18n 占位符原样上屏」这类缺陷全都漏网。新增 `frontend/e2e/perf-fixtures.ts`（**真实 CLI 输出**，只用 `go run . --cli --files-root tests/fixtures/ysm … --format json` 采一遍，裁掉界面不读的键，数值原样）+ `diagnostics.spec.ts` 四例：阶段条/基准判决行按载荷成行、红条数 = 载荷里 bottleneck/failed 阶段数（映射一致，前端不重算阈值）、并发档位与加速比取 Go 给的数字、D-7 本地化横幅（按**界面当前语言**断言，`detail` 只进 title）、以及通用的 `/\{[a-z_]+\}/` 占位符残留守卫。
  - **两条只在真实浏览器踩得到的坑**（helper 注释里钉住）：① mock CLI 必须**页面加载后**注入（`page.evaluate` 改 `window.go.main.App.ExecuteCLI`）——fixture 的 mock bridge 脚本会整体重建 `window.go`，用 `addInitScript` 抢跑会被覆盖，`ExecuteCLI` 退回 undefined，`parseCLIResponse` 拿 undefined 去 `.slice` 抛一句无信息量的 TypeError；② mock 必须给**完整响应信封** `{status, command, data}`，裸载荷会被判「CLI 响应 status 非字符串」——载荷正确但被信封挡在门外，界面同样空白（两次都不是产品缺陷，而是测试夹具踩坑，值得记）。
  - **e2e 立刻抓出一个真缺陷**：读几百字节时 `time.Since` 常返回 0（时钟粒度），`float64(bytes)/0s` 把 ① 阶段文案打成「✅ 115B, **+Inf MB/s**」——GUI 上真的显示了 `+Inf`。修法：抽 `singleBenchReadNote(bytes, d)` 纯函数，`d <= 0` 只报体量、不报速率（诚实红线：测不出的速率宁可不报），判据由纯函数单测确定性锁定（真实计时不可控，不在集成层赌 0 时长），集成层只加「任何阶段不得出现 Inf/NaN」的粗保护。真 CLI 复验：note 变为 `✅ 115B`。
## 相关

- 主卡：`docs/knowledge/app-content.md`
- 知识卡：`go-logs`、`go-repoaudit`、`app-content`
- `frontend/src/views/app-content/css/content-diag.ts` — 诊断/工坊样式层（主卡持有）
