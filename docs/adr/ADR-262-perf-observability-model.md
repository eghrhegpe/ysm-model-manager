# ADR-262：性能可观测性模型：统一报告 schema、运行时归属与机器出口

- **状态**：已采纳（Accepted）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-17
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：ADR-200（结构化载荷 / 渲染与数据分离）、ADR-258（诊断页顶部 tab 范式）、ADR-230（代际守卫）、`frontend/src/preview-3d/infra/load-trace.ts`、`go/cli/flow.go`、`go/cli/bench_concurrent.go`、`docs/knowledge/app_content_diagnostics.md`

---

## 1. 背景（Context）

诊断页的「性能」由 4 个平级 tab 承载（单模型 / 加载链路模拟 / 性能历史 / 加载轨迹），它们是 4 条 CLI 命令（`single-bench` / `gui-flow` / `perf-log` / `load-trace`）的 1:1 门面，而不是一套领域模型。由此产生的具体缺陷（均已源码实证）：

1. **目标选择口径互不相同**：`single-bench` 手动填路径；`gui-flow` 无输入、吃「扫描到的第一个模型」（`flow.go` Phase 3）；`concurrent-bench` 写死 `ext == ".ysm"` 优先挑样本、且**前端没有 tab 接它**；`load-trace` 依赖用户真在 3D 里加载过模型。
2. **参数暴露碎且被前端砍掉**：`single-bench` Go 侧有 `model/iterations/baseline/save-baseline/threshold/format` 六参（含 CI 退化门禁），前端只传 `model` + `iterations`——`threshold`/`baseline`/`format` 全被丢弃，于是永远没有「好还是坏」的判定。
3. **报告范式双轨**：`gui-flow` 走结构化 `resp.data.stages`（ADR-200 D2），`single-bench` 却**正则解析中文人类文案**（`perf-single-bench.ts` 旧实现），甚至把 `"总计"` 这个中文标签硬编码成解析锚点；`tests/test_cli_gui_flow_contract.ts` 还把 Go 的人类文案模板（`"[%d] %s (%.2fms)"`）钉成契约——**人类文案被当成了 API**。
4. **口径混用致数字不可信**：`single-bench` 的 `stages` 是 N 次平均值，而 `total_ms` 是 N 次迭代的**累计墙钟**（`runSingleBenchSamples` 的 `totalStart` 包整个循环），UI 直接把累计值当「一次加载总耗时」渲染——迭代 3 次即虚高 3 倍。
5. **估算混入总计**：`gui-flow` ⑤「数据准备」的耗时其实是重复调用的 `AnalyzeBedrockModel`（③也调过一次，同一分析计 3 次），IPC 大小按「假设 50MB/s」估算；⑥「渲染预估」无渲染管线，公式是 `boneCount*0.01+50 ~ *0.02+100`（Go 自承「真实首帧须在 GUI 验证」）。二者与实测阶段混在同一个 total 里。
6. **阶段无归属、无样本统计**：阶段结构 `{status,name,ms,desc}` 没有「这段属于 Go / Rust 扫描器 / WASM 解析器 / JS / Three.js」的归属字段，也没有样本数与分位数；`gui-flow` 跑一次就出总耗时，无方差可言。
7. **阈值分级三处并存**：Go 有 `stageMark`（人类 emoji）与 `stageStatus`（机器 token）同阈值（100/50/10ms），前端 `perf-single-bench.ts` 又自算一份 `ms > 100 / > 50` 决定配色。
8. **类型表硬编码三张**：Go 的 `concurrent-bench` 写死 `.ysm`；`detectModelFormat` 写死扩展名→格式；前端 `LoadTrace.format` 是 `"mmd"|"vrm"|"fbx"|"ysm"|"litematic"|"other"` 字面量联合、6 个 adapter 各写死自己——最后一张**与「类型判定唯一事实源 = resource_types.json + Go」的职责红线直接冲突**。

结论：缺的不是更多命令，而是**领域模型**——实验规格（跑谁 / 多少 / 几轮 / 什么口径）、报告 schema（阶段 / 运行时归属 / 实测或估算 / 可信度）、以及面向 AI 与 CI 的稳定出口。

### 渲染阶段的双写约束（背景）

「到 GUI 了该拉 Three.js 不拉」的直觉正确，但解法受 WebGL 现实约束：同一个文档里再起一个 `WebGLRenderer` 会带来三件事——每页 WebGL context 有上限、纹理与几何要**各自再上传一份**（显存翻倍）、context lost 互相牵连；Three.js 共享 context 需手工接管 state，脆弱易崩。因此「真渲染」的归属必须先定死（见 D5），否则任何方案都会以「双写 WebGL」收场。

## 2. 决策（Decision）

**D1 · 报告是唯一事实源，人类文案只能是它的派生。**
性能命令一律提供结构化载荷，并同时满足两个出口：CLI stdout 的 JSON（供 CLI 用户与 AI 直读）与 Wails 桥的 `data` 对象（供前端消费）。桥侧统一走 `CmdContext.SetResult` + `SidecarOutput.AttachSidecar`（ADR-200 D1/D5），`output` 字段只用于「复制原文」。**禁止**前端再以正则反解析人类文案；**禁止**把中文标签（如「总计」）作为契约锚点，既有此类契约测试改锁 JSON 字段名。

**D2 · 阶段三要素、总计拆分与身份块。**
每个阶段必须携带：`runtime`（`go` | `rust` | `wasm` | `js` | `three`）、`kind`（`measured` | `estimated`）、样本统计（`n` / `median` / `p95`，实测才允许有分位数）。总计拆成 `measured_ms` 与 `estimated_ms` 两个字段，**估算不得计入总耗时展示**；估算行必须显式标注其假设与公式。阶段失败独立成 `failed`（见 D8），不得混进耗时分级。

**gui-flow 的落地形态**：阶段条目带 `kind` / `estimated_ms` / `note`，顶层带 `estimated_ms` 合计且**不计入 `total_ms`**（`total_ms` 语义 = 实测墙钟）。⑤ 数据准备 = 实测的尺寸估算工作 + IPC 传输估算（50MB/s 假设，进 `estimated_ms`）；⑥ 渲染预估 = `kind: "estimated"`、`ms: 0`（**没有实测工作量可报**）+ 首帧公式区间取中值进 `estimated_ms` + `note` 写明公式与「真实首帧须在 GUI 验证」。文本报告同步标 `[估算]` 并单列「其中估算 X ms（不计入总耗时）」。

报告必须携带**身份块** `identity`：`rtype`（registry 类型 id，判定复用 `classifyForScan` 的三段口径：目录归属 > 扩展名 > 容器兜底）、`rtype_source`（location / extension / container，说明凭什么这么判）、`rtype_label`（registry 显示名，前端不得自建类型映射）、`filesRoot` + `relPath`（相对仓库根，跨机器可比）+ `absPath`（诊断用）。**理由**：`format`（YSM/PMX/…）是扩展名表派生的展示标签，推不出归属——`.zip` 被 14 个类型声明、MMD 子类型共享 `.vpd`/`.vmd`；只给绝对路径则换机器后报告无法回溯识别，测试与 AI 断言只能靠绝对路径（必脆）。**测试与断言一律用 `rtype` + `relPath`，不用 `absPath`。**

**D3 · 实验规格显式化，执行与聚合归 Go。**
引入 `PerfSpec`：目标集（显式路径[] / 按 registry 类型各取 N 个 / 全库前 N 大）、样本数、迭代次数、冷热口径、是否启用 `rust_backend`（Go/Rust 对照）。目标集从 `resource_types.json` + Go 侧 registry 派生，**不得**在任一语言里另立类型表。矩阵遍历与聚合在 Go 侧完成（前端只提交 spec、渲染 report），对齐「筛选 / 聚合归 Go」红线。

已落地的形态：`--rtype <id>`（单类型）与 `--all-types`（仓库里有什么类型就跑什么，每类型各取 `--max-models` 条），均仅 `--format json`、与 `--model` 互斥；目标集由 `perf_targets.go|scanTargetsGrouped` 从 `scanner.ScanEntries` + `classifyForScan` 派生（发现权与类型判定各自单点，类型与组内路径均按字典序，保证可复现），载荷为 `{spec{all_types,max_models,iterations,analyzed,unsupported,types[]}, models[]}`。

**样本清单**（`perfTypeManifest`，Go 表）是「CLI 侧性能采集能力」的单一登记处，登记 `{cli_analyzable, expected_stages, note}`：**发现白名单 ≠ 可分析白名单**——解析器只存在于前端 3D adapter 的类型（PMX/PMD/VRM/FBX 等）在矩阵里**只出身份、不采集阶段耗时**并给出解释性 hint（拿空模型的阶段数据冒充实测正是「数字不可信」的来源之一）。清单里的 `expected_stages` 不只是文档：矩阵运行时会比对实际阶段链长度并置 `types[].stage_mismatch`，**清单因此是运行期自检依据**（阶段链断裂——如 MMD 缺 ④⑤⑥——会被显式标出而不是静默通过）。清单 key 必须存在于 registry、可分析类型必须声明阶段链长度，由 `bench_matrix_test.go` 断言。新增类型的 CLI 分析链路时同步登记该表。

**D4 · 阈值分级单一来源。**
分级（bottleneck / warn / slow / ok）与阈值（100/50/10ms）只存在于 Go；前端只做展示映射（emoji、配色、排序），**不得**自算阈值。

**D5 · 渲染阶段不得由诊断页起第二个 WebGL 上下文。**
`three` 阶段的数据来源只有两条合法路径：
- **被动观测**：主预览 renderer 加载时由 adapter 埋点写 `load-trace` 内存 store，诊断页只读快照（已存在的骨架，扩充字段即可）；
- **主动压测**：复用主 renderer **串行**换模（load → dispose → load），或复用统一加载入口 `model3d-loader.ts`；不得并行第二套渲染器。

CI / AI 断言所需的「真渲染」放 e2e 层（Playwright 单页面 + 软件光栅化），页面内仍只有 app 自己的 renderer。`OffscreenCanvas` + worker 会产生第二份资源上传与跨线程同步成本，**需另立 ADR 论证收益**方可引入。

**D6 · 机器出口面向 AI，断言只锁结构不变量。**
性能数据必须可被 AI 与 CI 稳定消费：固定 JSON 字段、固定命令参数、`data-testid` / 全局钩子可读。断言侧只锁**结构不变量**（阶段齐备、`runtime` 归属正确、`estimated` 不入 total、`p95 ≥ median`、样本数与 spec 一致），**不得**把绝对毫秒写死为断言；门禁类判定只用相对比（baseline 比率 + 宽容差）。

**D7 · 目标路径归一化单点：目录式模型 = `<dir>/ysm.json`。**
目录式模型（解包 YSM 目录）在仓里已有既有约定：`scanner.go` 扫到 `ysm.json` 时条目 `Path` 保持该文件路径、`Name` 取父目录名，全体消费方（`fileops` 整组移动/复制/删除/禁用、`avatar` 元数据、`importer`、`app_model` 的 `.json` 分支）统一用 `registry.IsYsmEntryJSON` 判定。因此 perf/bench 只需在**入口单点**把用户/测试传入的目录折叠成该约定路径（`resolveBenchModelTarget`，经 `resolveTargetModel` 供单模型基准与 perf-snapshot 共用），**禁止各消费方自写目录分支**。理由：目录分支若散落到每个读盘点，就是「每加一个功能都要补一次目录支持」的成因；而实际唯一缺的就是这个入口归一化——`os.ReadFile(目录)` 会直接失败。

**D8 · 报告不得掩盖失败。**
阶段失败必须独立成字段（`failed`）并**优先于耗时分级**：失败阶段常是 0ms，只按 ms 分级会被判 `ok`，一次全链路失败的 bench 在载荷里看起来全绿（2026-09-17 实测）。平均/聚合环节必须保留诊断信息（`notes` / `bytes` / `failed`），禁止只留耗时——否则失败原因在到达消费方之前就已丢失。**同一份工作不得重复计时**：gui-flow 的 ③⑤⑥ 曾各自调一次 `AnalyzeBedrockModel`，同一份解析被计 3 次耗时、⑤⑥ 的"阶段耗时"因此不是自己的工作量的度量——现 ③ 分析一次并把模型传给 ⑤⑥（`flow_estimated_test.go` 用计数桩锁死「每次运行只分析一次」）。

## 3. 后果（Consequences）

**正面**
- 数字可信：口径（累计 / 单次、实测 / 估算、样本数）显式化，消除「迭代 N 次却显示单次总耗时」这类机制性误读。
- 可断言：AI 与 CI 消费同一份 schema，不再依赖中文文案稳定性；`test_cli_gui_flow_contract` 一类的文本模板契约可以退役。
- 可泛化：目标集由 registry 派生，类型矩阵（每类各取 N 个）不需要前端重算归属。
- 归属可见：Go / Rust / WASM / Three 的耗时构成不再是黑箱，Rust 扫描器与 WASM 解析器的收益可被度量。

**负面 / 代价**
- Go 侧报告 schema 迁移，text 模式与正则消费路径逐步退役（迁移期靠 sidecar `output` 兼容「复制原文」）。
- Go 侧 `hints` 等中文散文在人机两用前需 i18n 或结构化，暂不上 UI。
- 每类样本模型缺失（仓库 fixtures 目前仅 YSM）会限制类型矩阵的实际覆盖，样本补全属于独立工作项。

**已知遗留（不在本 ADR 决策范围）**
- 三张硬编码类型表的收编（Go `.ysm` / `detectModelFormat` / 前端 `LoadTrace.format`）需按 D3 逐项落地。
- `gui-flow` ⑤⑥ 的重复分析计时与估算公式的修正属具体实现，不在本 ADR 记进度。

## 4. 数据溯源

| 结论 | 来源 |
|---|---|
| 4 个性能 tab = 4 条 CLI 命令门面 | `frontend/src/views/app-content/tpl.ts`（`diagnosticsHTML` tabs 声明）、`frontend/src/views/app-content/diagnostics/*.ts` |
| `single-bench` 有 `baseline/threshold/format`，前端未传 | `go/cli/bench_concurrent.go`（`runSingleBench` flag 集）、`frontend/.../perf-single-bench.ts` |
| `stages` 为平均、`total_ms` 为累计 | `go/cli/bench_concurrent.go`（`runSingleBenchSamples` 的 `totalStart` 包循环 + `avgBenchStages`） |
| ⑥ 渲染预估为拍脑袋公式、⑤ 假设 50MB/s | `go/cli/flow.go`（`runPhaseRenderEstimate` / `runPhaseDataPrep`） |
| 人类文案被当契约 | `tests/test_cli_gui_flow_contract.ts`（断言 `"[%d] %s (%.2fms)"` / `"总耗时: %.2fms"`） |
| 类型表硬编码 | `go/cli/bench_concurrent.go`（`.ysm` 过滤、`detectModelFormat`）、`frontend/src/preview-3d/infra/load-trace.ts`（`format` 字面量联合 + 各 adapter 写入） |
| 阈值三处并存 | `go/cli/bench_concurrent.go`（`stageMark` / `stageStatus`）、`frontend/.../perf-single-bench.ts`（旧 `ms > 100 / > 50`） |
| 顺带观测骨架已存在 | `frontend/src/preview-3d/infra/load-trace.ts`（`recordLoadTrace` 由 6 个 adapter + `model3d-loader.ts` 调用，环形 50 条，`getLoadTraces()` 只读快照） |
| WebGL 双写代价 | Chromium/WebView2 每页 WebGL context 上限与逐 context 资源上传语义（平台事实，非本仓代码） |
