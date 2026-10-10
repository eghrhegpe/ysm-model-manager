# ADR-102：CLI 内嵌模式回归与诊断协同平台

- **状态**：✅ 已采纳（Accepted）
- **日期**：2026-08-19
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`go/cli/ / internal/app/cli_bridge.go / frontend/src/services/cli-bridge.ts / frontend/src/views/app-content/diagnostics/`

---

## 1. 背景（Context）

ADR-059（2026-08-14）决策「移除 CLI、收敛为裸 exe 发布」，理由是发布形态冗余 + `export` 命令触及 ADR-026 伦理红线。该决策针对的是**独立分发的 `ysm-cli.exe`**，其「裸 exe 发布」部分保持有效并延续至今。

后续演进（ADR-102 之前）把 CLI 改为**内嵌于主程序 `--cli` 模式**，并打通 Wails 桥（`ExecuteCLI` → 子进程 → JSON 回流、白名单注入、前端 `cli-bridge.ts` 封装）。全链路盘点发现：**18 个命令的桥已修通，但前端零消费**——`single-bench`/`gui-flow`/`perf-log`/`file-bench`/`benchmark` 等性能诊断命令只注册在白名单常量，没有任何 UI 调用。性能诊断能力停留在「终端手动敲命令」阶段，属「沉睡的金矿」。

## 2. 决策（Decision）

**确立 CLI 的新定位：从「排障工具」升级为「诊断 + 测试协同平台」，并以内嵌 `--cli` 模式回归，明确与 ADR-059 的关系为修订演进而非复辟。**

- **内嵌而非独立分发**：CLI 随主程序 `--cli` 模式运行，不产出独立 exe，沿用 ADR-059 的裸 exe 发布形态；`export` 等触及伦理红线的命令仅源码环境可用，不随包分发。
- **分类定界**：
  - **诊断命令**（`single-bench`/`gui-flow`/`perf-log`/`cache-verify`/`concurrent-bench` 等）通过 `ExecuteCLI` 桥前端可调，走子进程隔离，低频、容忍启动开销；
  - **热路径**禁止 fork 子进程，如未来需要内联执行，须先解决 `app→cli` 循环依赖（当前靠子进程绕开）。
- **消费方先行**：性能诊断面板（Phase A）挂载到前端 `app-content/diagnostics/`，直接消费「已有 CLI 能力 + 已有 `cli-bridge.ts` 封装」，纯前端接线，零 Go 改动。
- **单一事实来源**：CLI 命令白名单以 `go/cli` 注册表为准，前端硬编码仅作网页版降级 fallback，动态拉取走 `GetAllowedCLICommands()`。

**治理红线**：CLI 性能命令只读/测量、不改业务状态；`baseline` 性能锚点文件纳入 git；前端消费必须走 `ExecuteCLI` 桥，禁止绕过桥直接调 Go 函数。

## 3. 后果（Consequences）

**正面**：
- 性能诊断透明化：用户 GUI 内可直接触发 `single-bench` 定位瓶颈阶段，无需开终端。
- CLI 成为 GUI 的「无头验证替身」：`gui-flow` 走共享 `app.App` 业务层，CI 跑通 ≈ 后端加载链健康，前端渲染问题可快速隔离。
- 子进程隔离：CLI 崩溃不影响 GUI；白名单注入保证安全性。

**负面 / 注意**：
- 子进程每次 fork 有 ~50-100ms 启动开销，不适合热路径（战略判断：诊断场景低频，可接受）。
- 前端解析 CLI 文本 `data.output`/`data.lines` 而非结构化 stages——`--json` 全局模式仅把命令文本包装进 `data.output`，阶段耗时柱状图需前端正则解析行格式 `%-20s %10.2fms`。如需原生结构化 stages，属 Phase C 对 Go 侧的增强方向。

**与 ADR-059 关系**：ADR-059 的「裸 exe 发布」「`export` 不随包分发」决策**保持有效，不被取代**；本 ADR 只确立「内嵌 `--cli` 诊断协同平台」这一新增定位。故 ADR-059 状态维持「已采纳」，不做「被取代」标注。

## 4. 数据溯源

- **来源**：ADR-059（CLI 移除与裸 exe 发布，定界发布形态）、ADR-026（伦理铁律 1：不提供模型导出）、ADR-013（ADR 登记占号流程）。
- **实现侧**：`go/cli/`（内嵌命令 + 注册表白名单）、`go/cli/json.go`（统一 JSON 协议 `status/command/data/error/timing/meta`）、`internal/app/cli_bridge.go`（Wails ExecuteCLI 桥 + `makeJsonResponse`）、`frontend/src/services/cli-bridge.ts`（前端封装 + 动态白名单）、`frontend/src/views/app-content/diagnostics/`（Phase A 消费端）。
- **本次决策落地**：新增前端性能诊断面板（消费 `single-bench`/`gui-flow`/`perf-log`），无 Go 侧改动。

<!-- 文件名: cli-embedded-return-diagnostic-platform.md → 实际文件 ADR-102-cli-embedded-return-diagnostic-platform.md -->
