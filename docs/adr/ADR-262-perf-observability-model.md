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

**D2 · 阶段三要素 + 总计拆分。**
每个阶段必须携带：`runtime`（`go` | `rust` | `wasm` | `js` | `three`）、`kind`（`measured` | `estimated`）、样本统计（`n` / `median` / `p95`，实测才允许有分位数）。总计拆成 `measured_ms` 与 `estimated_ms` 两个字段，**估算不得计入总耗时展示**；估算行必须显式标注其假设与公式。

**D3 · 实验规格显式化，执行与聚合归 Go。**
引入 `PerfSpec`：目标集（显式路径[] / 按 registry 类型各取 N 个 / 全库前 N 大）、样本数、迭代次数、冷热口径、是否启用 `rust_backend`（Go/Rust 对照）。目标集从 `resource_types.json` + Go 侧 registry 派生，**不得**在任一语言里另立类型表。矩阵遍历与聚合在 Go 侧完成（前端只提交 spec、渲染 report），对齐「筛选 / 聚合归 Go」红线。

**D4 · 阈值分级单一来源。**
分级（bottleneck / warn / slow / ok）与阈值（100/50/10ms）只存在于 Go；前端只做展示映射（emoji、配色、排序），**不得**自算阈值。

**D5 · 渲染阶段不得由诊断页起第二个 WebGL 上下文。**
`three` 阶段的数据来源只有两条合法路径：
- **被动观测**：主预览 renderer 加载时由 adapter 埋点写 `load-trace` 内存 store，诊断页只读快照（已存在的骨架，扩充字段即可）；
- **主动压测**：复用主 renderer **串行**换模（load → dispose → load），或复用统一加载入口 `model3d-loader.ts`；不得并行第二套渲染器。

CI / AI 断言所需的「真渲染」放 e2e 层（Playwright 单页面 + 软件光栅化），页面内仍只有 app 自己的 renderer。`OffscreenCanvas` + worker 会产生第二份资源上传与跨线程同步成本，**需另立 ADR 论证收益**方可引入。

**D6 · 机器出口面向 AI，断言只锁结构不变量。**
性能数据必须可被 AI 与 CI 稳定消费：固定 JSON 字段、固定命令参数、`data-testid` / 全局钩子可读。断言侧只锁**结构不变量**（阶段齐备、`runtime` 归属正确、`estimated` 不入 total、`p95 ≥ median`、样本数与 spec 一致），**不得**把绝对毫秒写死为断言；门禁类判定只用相对比（baseline 比率 + 宽容差）。

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
