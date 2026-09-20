# ADR-288：诊断页布局词汇统一与扫描类参数栏常驻化

- **状态**：✅ 已采纳（Accepted）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-20
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：[ADR-278](./ADR-278-diagnostics-perf-ia.md)（诊断页分组；本 ADR 修正其 §2.5「只读扫描带引导空态 + 启动按钮」的**落点**）、[ADR-259](./ADR-259-tab-rendertabs.md)（面板结构走 renderTabs）、`views/app-content/tpl.ts`（tab body）、`diagnostics/conflicts.ts` / `diagnostics/health.ts` / `diagnostics/init.ts`（接线）、`css/content-diag.ts`（布局规则）、`docs/knowledge/app_content_diagnostics.md`

---

## 1. 背景（Context）

<!-- ⚠️ 本节是「决策当时」的状态快照，ADR 落地后此处的病灶可能已治愈；评估「现在是否还这样」以当前源码树 + 知识卡实施进度为准，勿把本节当现状。 -->

用户实测同步冲突页要**跳三次**才拿到结果：切 tab → 点外层「扫描同步冲突」→ 点面板内「扫描同步冲突」。其中第一次点击**零信息增量**——它只把结果容器里的引导空态换成参数面板，不发起任何扫描。

顺着这条线查下去，真正的问题不是「多两次点击」，而是**同一页里三套布局词汇并存**：

| tab | 结构 | 布局类 |
|---|---|---|
| `log` | 常驻上栏（2 行）+ 独立滚动结果区 | `.diag-log-bar` / `.diag-log-row` / `.diag-log-scroll` |
| `bench` / `scan` / `record` | 常驻上栏 + 独立结果区 | `.perf-wrap` / `.perf-controls` / `.perf-row` / `.perf-hint` |
| `health` / `sync-conflict` | **单容器内「引导空态 + 按钮 → 参数面板 → 结果」互相替换** | 无布局类（全靠 inline style） |

即：日志与跑基准已经长出「上栏常驻 / 结果独立」的骨架（两套词汇、同一形状），两个只读扫描**根本没长出骨架**。

**比三次点击更严重的硬缺陷（本次实测确认）**：`#diag-scan-sync-conflict` 按钮是 `#diag-sync-conflict-list` 的**后代**（`tpl.ts` 的 tab body），而结果渲染走 `list.innerHTML = header + rows + resolve`（`conflicts.ts`）——首次扫描把引导空态与按钮**一起**抹掉。更致命的是 `app-content/index.ts` 的 `_render` **按页缓存面板**（`getCachedPanel` / `cachePanel`）且 `init` 只在 `isNew` 时执行 ⇒ **同一会话内该按钮永不复活**：换实例、复扫、甚至重看引导都做不到，只能重载应用。`health` 同形同病（`#diag-scan-health` 住在 `#diag-health-list` 内，体检一次后无法复检）。

**测试为何失明**：`init.test.ts` 的夹具把按钮与结果容器建成**兄弟**（两个平级 div），真实 tpl 是**父子**——夹具比真相宽松，于是这条 dead-end 一路绿灯。这是「测试固化了比实现更弱的契约」的又一例。

ADR-278 当初把「引导空态 + 主按钮」一起放进结果容器（§2.5 统一进入语义），出发点正确（进 tab 即有话说），但未预料「结果整块 `innerHTML` 替换」会连带吃掉入口本身。

## 2. 决策（Decision）

**D1 布局词汇统一为中性三件套。** `.perf-wrap` / `.perf-controls` / `.perf-row` / `.perf-hint` → `.diag-pane` / `.diag-bar` / `.diag-bar-row` / `.diag-bar-hint`，**规则逐字不变（纯改名）**，`bench` / `scan` / `record` 三个 tab 同步改名。日志栏 `.diag-log-bar` / `.diag-log-row` **保留**：它的 padding 与子控件（`.diag-log-subtabs` / `.diag-log-filter` / `.diag-log-search` / `.diag-log-bar-spacer`）确属日志专属，且 2026-09-17/09-28 的版面配方已被 e2e 与类名契约测试钉住，动它要重验版面而收益不抵风险。**新增布局一律抄 `diag-pane` / `diag-bar` / `diag-bar-row`。**

**D2 扫描类 tab 参数栏常驻。** `health` / `sync-conflict` 改为 `pane > (bar + 结果区)` 两段式：

```
.diag-pane
  .diag-bar            ← 常驻：参数 + 主按钮（+ 一行 hint）
  #<tab>-list          ← 结果区：空态 / 扫描中 / 结果（+ 解决区）
```

栏内：`health` = 「开始体检」+ `healthHint`；`sync-conflict` = 资源类型 + 整合包 + 「扫描同步冲突」+ `scanHint`。结果区只承担结果与空态。

**D3 栏在页面挂载时初始化，扫描仍显式按钮触发。** `initDiagnostics` 调 `initSyncConflictPanel` / `initHealthPanel`，进 tab 即有参数可读。ADR-278「进 tab 不跑进程」**不变**：初始化只做 `LoadAppConfig` + `ListVersionInstances` 两次轻量 Go 读（与 `log` tab 进即 `GetImportLogs` 同级），`DetectConflicts` 的全量哈希扫描不由初始化触发。未采用 `bindTabs` 的 `TAB_INIT` 懒加载登记（`dedup` / `oldest` 先例）：栏必须在「用户第一次看向它」之前就绪，否则"第一次点击"又会以「进 tab 才渲染参数」的形态回潮。

**D4 空态与失败提示归结果区，不可用时禁用按钮。** 无游戏目录（`configGameDir`）或无可用实例（`noInstances`）→ 结果区说明原因并**禁用扫描按钮**：点不了好过点了报错。扫描进行中同样禁用按钮，替代原先「重复点击被 busy 守卫静默吞掉」的外观。

**D5 解决区留在结果区。** 它作用于「本次扫描出的冲突集」（策略建议来自 Go 的冲突数据），不做「所有控件都上栏」的形式主义。

**未采用：**

- **新增第三套 `.diag-scan-*` 类**：与「统一」目标反向，页内会变三套词汇。
- **保留 `perf-*` 命名给非性能面板用**：`health` / `sync-conflict` 挂 `.perf-wrap` 名不副实，且本次既要改结构，一次到位胜过留命名债。
- **重命名 i18n 键 `diagnostics.perfIdle`**：其文本「点上方按钮开始；结果将显示在此处」本就通用，改名只会让 `ADR-285` 与知识卡的键名引用变陈旧，收益仅为命名整洁——保留键名，知识卡注明它是**页级引导空态文案**。
- **把日志栏也并入中性词汇**：见 D1。

## 3. 后果（Consequences）

**正面**

- 同步冲突 **1 次点击出结果**（原 3 次），且换实例 / 复扫**不离页、不重载**；体检可反复执行。
- 两个只读扫描与 `log` / `bench` 视觉同构，页内「上栏常驻 + 结果独立」成为默认形状。
- 布局词汇收敛为两套（日志专属 + 页级通用），新增 tab 有唯一可抄范式。
- dead-end 留下墓碑：测试夹具改为**真实父子嵌套** + 「首次扫描后扫描按钮仍在」回归用例。

**负面 / 代价**

- 诊断页挂载时多 2 次 Go 读（仅 `sync-conflict`；`health` 为 0 次）。
- `.perf-*` 改名触及 `tpl.ts` + `content-diag.ts` + `perf-mode.test.ts`（该测试用字符串解析 `perf-row` 归属，须同步改名）。
- 日志栏仍是第二套词汇，全页「唯一一套」未达成（有意保留，见 D1）。

**已知遗留**

- 上次选择（rtype / instance）未做持久化，每次进页回到首项。
- 日志栏词汇未并入通用层。

## 4. 数据溯源

- **三套并列**：`tpl.ts` 各 tab body + `css/content-diag.ts` 的 `.diag-log-*` / `.perf-*` 规则块。
- **dead-end 三要素**：`tpl.ts` 的父子嵌套（按钮在结果容器内）+ `conflicts.ts` `renderSyncConflictsResult` 的整块 `innerHTML` + `app-content/index.ts` `_render` 的面板缓存语义（`getCachedPanel` / `cachePanel`，`init` 仅 `isNew`）。
- **测试失明**：`init.test.ts` 夹具里按钮与结果容器是兄弟。
- **平台判定**：`backend/platform.ts|isViewerPlatform` = web ∪ android ⇒ 网页版下 `desktopOnly` tab 整块不渲染，栏元素缺席使初始化自然早退（`webGate` 作为二道防线保留）。

<!-- 文件名: diagnostics-scan-bar-persistent.md → 实际文件 ADR-288-diagnostics-scan-bar-persistent.md -->
