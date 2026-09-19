# ADR-278：诊断页按「动作 / 产物」重划性能分组

- **状态**：✅ 已采纳（Accepted）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-19
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：[ADR-262](./ADR-262-perf-diagnostics-payload.md)（性能载荷与目标集选择器；本 ADR 落实其**未落地**的「复用同一套控件」意图）、`views/app-content/tpl.ts`（tab 定义）、`diagnostics/perf.ts`（模式接线）、`diagnostics/perf-concurrent.ts`、`docs/knowledge/app_content_diagnostics.md`

---

## 1. 背景（Context）

诊断页顶部 tab 原有 9 个：`log` / `single` / `gui` / `conc` / `hist` / `trace` / `conflict` / `health` / `sync-conflict`。2026-09 的界面评审实测出三件事：

**① 同一页里并存三套「进入语义」**（已在 commit `f8b70b360` 收口为两级，见 §2.5）：`log` 进即加载；扫描三兄弟进即有**引导空态 + 主按钮**；而性能五兄弟进去是**裸空 div + 工具栏一个孤零零的按钮**——`trace` 的文案甚至自陈「加载模型后自动记录，点击刷新查看」，即**必须先去 3D 预览转一圈**再回来手动刷新。

**② tab 的切分轴是「哪段代码跑」（机制），不是「你想干什么」（意图）**：

| 现象 | 事实 |
|---|---|
| `single` 与 `conc` 是**同一个基准**的串行/并行两态 | 参数面（目标集 / 排序 / 取样上限）**完全重叠**，却拆成两个 tab、各摆一遍 |
| `scan-bench`（引擎对照）是**第 4 个基准** | 却藏在 `single` 的工具条里当按钮——既无自己的 tab，也不共享参数面板 |
| `trace`（加载剖析） | 数据全部来自 **3D 加载管线**（5 个 adapter + `model3d-loader`），与「跑基准」毫无关系，却挂在性能组；它的正确位置应当是「看已收集的数据」 |
| 命名撞车 | `log`（操作日志）与 `hist`（性能日志）两个「日志」 |
| 参数面毫无规律 | `single` 10 个控件 / `gui` **0** / `conc` 5 / `hist` 0 / `trace` 0 |

**③ ADR-262 自己写下的意图没落地**：`tpl.ts|VIEW_TESTIDS` 里为并发 tab 留的注释是

> `// ADR-262 D3 修订：并发 tab 复用同一套目标集 / 排序控件（跨命令同名同义，故不写第二份）`

**但实现写了两份**（`diag-perf-conc-target` / `diag-perf-conc-order`）。同义控件存在两份 DOM，就必然存在**两份默认值、两份选项集、两条漂移路径**——这不是风格问题，是同一事实存两处的老病。

## 2. 决策（Decision）

### 2.1 按两轴重划：**动作** vs **产物**（9 → 7 个 tab）

| 轴 | tab | 内容 |
|---|---|---|
| 动作（要跑东西） | **`bench` 跑基准** | 模式选择器：单模型 / 串行 vs 并行 / 引擎对照；按模式呈现**该模式那一套**参数；三个运行按钮与三个结果容器（**元素 id 全部不变**） |
| 动作 | **`gui` 端到端流程** | 保持独立：它的产物是**阶段时序 + 估算标记**，不是基准数字（形态不同不硬并） |
| 产物（看已收集的数据） | **`record` 性能记录** | ① 基准历史（`diag-perf-log` + `diag-perf-hist`）② 加载剖析（`diag-perf-refresh-trace` + `diag-load-trace`） |
| 只读扫描 | `conflict` / `health` / `sync-conflict` | 不变 |
| 数据 | `log` | 不变 |

判据一句话：**「跑基准」是动词，「性能记录」是名词**——动词 tab 里不该出现需要你先去别处制造数据的图表，名词 tab 里不该塞运行按钮。`trace` 因此从「动作组」移到「产物组」，与 `hist`（跨轮次趋势）同属「已收集数据的查看」，不再类目错位到「日志」子 tab 下（甘特图 + 资产清单不是日志）。

### 2.2 落实 ADR-262 的未落地意图：single / conc **共用**目标集与排序

`#diag-perf-rtype`（目标集）与 `#diag-perf-order`（排序）**跨命令同名同义**，故只保留一份，删除 `#diag-perf-conc-target` / `#diag-perf-conc-order`；`perf-concurrent.ts` 改读共享控件，`populatePerfTargetOptions` 的第二次调用（`includeModel=false`）随之取消。**同义控件只留一处**，从结构上消灭「两处默认值 / 选项集漂移」的可能。

### 2.3 「取样上限」**有意不合并**

`single` 的上限默认 **5**，`conc` 的默认 **20**——这不是笔误，是两个真实口径：单模型基准要**深测**（少而精），并发基准要**广度扫描**（多而快）。合并成一个 `input` 会强迫二选一，等于用「看起来更整洁」换掉两个语义差异。故上限保持两个控件（`#diag-perf-max` / `#diag-perf-conc-max`），各随自己的模式显隐。

同时：共享的目标集选择器**含**「单模型」选项，而并发基准**不能**用单模型（缺路径参数）。原实现是 `readConcParams` 里一句 `if (choice.target === "model") return null;`——**静默 no-op**。现改为：切到并发模式时**禁用该选项**，若原本选中则把选择器回落到「全库扁平」；本地守卫保留作安全网。**把静默失效变成可见的不可选。**

### 2.4 模式显隐走 **class**，查看器降级继续走 **inline style**

新规则 `.perf-mode-off { display: none }` 挂在 `[data-perf-mode]` 行上，按当前模式切换；`dgInHideDesktopOnly` 的查看器降级**继续用 inline `style.display = "none"`**。两者**继承性不同**（inline 胜过 class），故 mode 接线不可能把查看器藏掉的桌面专属按钮又「显示」回来——这正是分开用两种机制的**理由**，不是巧合。

### 2.5 每个 tab 进入即有内容（承接 `f8b70b360` 的两级规则）

- **零成本可渲染的 → 进即渲染**：`trace` 读的是内存 store（`getLoadTraces()`，零 I/O、零 Go/CLI）→ 初始化 + 每次激活都渲染。
- **需要跑进程/CLI 的 → 引导空态 + 显式按钮**：`bench` 各模式的结果容器与 `record` 的历史区预置引导空态；**不做「进 tab 自动 spawn CLI」**（与扫描三兄弟同口径：进 tab 不跑进程）。
- 查看器模式下 `bench` tab **整体隐藏**（其全部入口都依赖 Go/CLI），而 `record` **保留**——`trace` 是性能组里唯一跨模式可用的面板（网页版的 3D 适配器同样在写这个 store），故其入口**不再**随其它桌面按钮一起隐藏。

## 3. 后果（Consequences）

**正面**

- 9 → **7 个 tab**，且每个 tab 进入都有内容（三套进入语义收口为两级）。
- 同义控件去重：目标集 / 排序只剩一处，**结构上不可能再漂移**（原两份实现的注释与实现自相矛盾了一个版本周期）。
- 第 4 个基准（引擎对照）从「藏在别人工具条里的按钮」升格为**一等模式**，与另两个模式同构。
- 静默 no-op（并发选单模型）变为可见的不可选。
- 页面心智模型变成一句话：**动作组（跑基准 / 端到端）+ 产物组（性能记录）+ 只读扫描**。

**负面 / 代价**

- tab id 改名：`single`/`conc` → `bench`，`hist`/`trace` → `record`。**元素 id 全部保留**，故测试面的主要改动是「切 tab 的 6 处 + 单测夹具」而非全部重锚。
- `bench` 的参数分行比原 `single` 多一行（模式选择器），单模型模式下净增 1 行——用一行换「另外两个模式不再需要各自开 tab」。
- 引擎对照不再与「单模型」同屏：它原先是 `single` 工具条里的按钮，现在切模式才出现（同屏少一个入口，换来与并发/单模型同等的地位）。

**已知遗留**

- `gui` 是否并入 `bench` 作第 4 个模式：暂不并——产物是阶段时序，与三个基准的数字表形态不同，硬并会让「结果区」变成两种渲染协议的分支。
- `conflict` / `health` / `sync-conflict` 三个只读扫描仍平级（互不共享参数、各自带引导空态与启动按钮）；若后续再增扫描类，需另立「扫描」聚合轴，不在本 ADR 范围内。

## 4. 数据溯源

- **三套进入语义实测**（2026-09）：`log` 由 `initDiagnostics` 直接 `loadDiagnosticsLogs`；扫描三兄弟的引导空态写在 `tpl.ts` 初始 HTML（`scanHint` / `healthHint`）；性能五兄弟的输出容器是裸空 div，`initPerfPanel` 只挂监听、不渲染；`bindTabs` 的 `TAB_INIT` 懒加载表实际只登记了仓库页三个 tab（`recycle` / `dedup` / `oldest`）。
- **参数面实测**：`single` 10 / `gui` 0 / `conc` 5 / `hist` 0 / `trace` 0。默认值实测：`#diag-perf-max` = **5**、`#diag-perf-conc-max` = **20**。
- **ADR-262 意图 vs 实现**：`tpl.ts|VIEW_TESTIDS` 注释声明「并发 tab 复用同一套目标集 / 排序控件……不写第二份」，而 `diag-perf-conc-target` / `diag-perf-conc-order` 两者都在 `VIEW_TESTIDS` 中登记；`perf.ts` 有第二次 `populatePerfTargetOptions(root, "diag-perf-conc-target", false)` 调用。
- **并发不能选单模型的出处**：`perf-concurrent.ts`——「本 tab 没有单模型路径输入框：target=model 必然缺载荷参数，本地拦掉而不是换 Go 一句报错」。
- **引用面实测**（决定改名成本）：全仓按 tab 切页的引用仅 e2e 6 处（`data-tab="single"` ×4、`data-tab="conc"` ×2）+ 单测夹具 4 处；**无任何** `data-tab="hist"` 点击——`hist` / `trace` 的相关测试都直接按元素 id 操作。
- **e2e 契约同步**：并发 tab 初态断言原为「输出容器 `textContent.length === 0`」，随 §2.5 引入引导空态后失效，已改为更贴本意的「初态文本**不含数字**」（长度 0 也只能证明「没文本」，不含数字才对应「没预置实测值」，且三语引导文案皆无数字）。
