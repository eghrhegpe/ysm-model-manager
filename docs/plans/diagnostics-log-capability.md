# 诊断日志面板：能力面盘点与演进方向（只读分析）

> 范围：诊断页日志面板（`diagnostics/logs.ts` + `init.ts` 子 tab 分派 + `tpl.ts` 工具栏 + Go `logs` / `internal/app`）。
> 性质：**只读分析**，不动代码。源于 2026-09-28 日志面板改版（搜索框上移行1 + 状态筛选补 warn 档）后的复盘。
> 相关：`docs/plans/diagnostics-dedup-audit.md` 的 D4（两路日志源必要差异论）是本文的展开；决策红线见根 AGENTS「职责归属」。

## 一、两条日志流的真实拓扑（单一事实源）

| | 流 A：操作日志（环形账本） | 流 B：运行时日志（环形缓冲） |
|---|---|---|
| 入口 | `AddOpLog(op, model, src, dst, size, status, errMsg)` → `logger.AddOp` | `log.SetOutput(io.MultiWriter(os.Stderr, runtimeLogs))`（`internal/app/app.go:168`） |
| 结构 | `Operation + Status + Level + 4 文本字段`（`types.ImportLog`） | 单 `Message` + `Timestamp`，`Level` 恒 `info`（`go/logs/runtime.go:36`） |
| 持久化 | 磁盘 `ysm-import-logs.json`，重启保留 | 内存，重启清零，无清空后端能力 |
| 容量 | 500（`go/logs/logs.go:19`，`LogConfig.LogMaxEntries` 可配置） | 200（`go/logs/runtime.go:11` `DefaultRuntimeCap`） |
| 状态语义 | `success/failed/warn/skipped`（由 Go `StatusToLevel` 派生 Level） | 无状态 |
| 搜索域 | 模型 / 报错 / 目标路径 / 源路径 / Operation（4+ 维） | 仅 Message |
| 前端窗口 | `slice(-500)`（`logs.ts:102`） | `slice(-300)`（`logs.ts:209`） |

**关键不对称**：两流在 Go 侧就分灶——流 A 是「结构化账本」（审计/回溯），流 B 是「stderr 尾巴」（debug）。前端子 tab 切换、搜索分派、状态 chip 只作用操作日志，**全是如实映射 Go 结构差异**，非前端偷懒。

## 二、筛选语义：横纵正交模型

面板实际承载一个 **二维语义空间**：

- **横向（结果好坏）**：`Status` 四值，`dgLsMakeStatusLabel` 优先读 `Level` 再按 `Status` 兜底（Go 冻结判据，前端只映射图标）。
- **纵向（做什么事）**：`Operation` 七类（import/scan/download/sync/rename/delete/ui），`OP_META` 映射中文标签+图标。

现状是 **「半正交」**：
- 行2 chips = 纯横向（全部/成功/失败/警告/跳过——2026-09-28 补「警告」档）。
- 搜索框 = **横纵混合**（既匹配模型名/报错=横，又匹配 Operation 标签=纵）。
- 组合语义（成功+扫描 / 失败+警告）靠「chip × 搜索」AND 交集实现，**无独立纵向筛选入口**。

## 三、复核后的事实修正与遗留洞察

### ✅ 修正一个初判
- **`skipped` chip 不是「为未来预留」**：`go/sync/sync_push.go:310,322` 在推送到仓库出现同哈希/同名文件时真实写 `Status:"skipped"`。该档有效。
- **`warn` 并非只来自扫描**：`ui`（前端 error-diary `DiaryStatus = "failed"|"warn"`）与 `scan`（`app.go:183` 错误 sink）都会产生 warn。警告 chip 无法区分「界面报错」还是「扫描断链」，除非展开看内容。

### 遗留洞察（按价值排序）
1. **纵向（操作类型）筛选缺位**：用户筛「扫描」「界面」得靠搜关键词，没有独立入口。OP_META 已有 7 类映射，是现成的事实源。
2. **warn 混类可见性**：`ui` 与 `scan` 的 warn 同行同标，用户无法从 chip 层面分辨来源。
3. **容量口径双轨**：Go 操作日志 500 / 运行时 200，前端各自 `slice(-500)` / `slice(-300)`——运行时永远不满 300，`slice(-300)` 是防御性空操作；两处口径各写各的，**Go 改容量前端不会同步**（单一事实源缺失）。
4. **流 B 价值递减**：运行时日志 = 整进程 stderr 尾巴，无级别/无分类/无语义。用户期望「业务运行信息」，实际看到库的嘈杂输出。长期应推动 Go 侧把「该给用户看的结构化信息」走流 A，流 B 当 debug 尾巴。

## 四、演进方向（候选，未经拍板）

| 方向 | 内容 | 风险 / 代价 |
|---|---|---|
| ~~**A. 操作类型纵向筛选**~~ | ✅ **已落地**（2026-09-28）：行2 加「操作类型」下拉（`#diag-log-op-filter`），单选，与状态 chips 正交叠加 | — |
| ~~**B. warn 分流**~~ | ✅ **随 A 自然达成**：`ui` / `scan` 可各自单独筛出，warn 混类可见性缓解（但警告 chip 内仍混类） | — |
| ~~**C. 容量口径单点化**~~ | ✅ **已落地**（2026-09-28）：`DIAG_OP_WINDOW` / `DIAG_RUNTIME_WINDOW` 具名常量 + Go 来源注释 | — |
| ~~**D. 流 B 语义化**~~ | ✅ **已立项并落地**（ADR-289，2026-09-20）：捕获层提取 `[tag]`（实测覆盖 **91.1%**，41 个 tag）+ 推断 `Level`，前端据此出图标/tag 徽标/让 chips 在运行时子 tab 真正生效 | 推断是启发式（实测 error 60% 为真实分布，非误判） |

## 五、本次已落地（2026-09，两批）

**第一批（commit 5673a5b2b）**
- 搜索框上移行1、紧跟子 tab（视图范围控件与子 tab 同层语义）。
- 状态 chips 补「警告」(warn) 档，三语 i18n `diagnostics.warn` + 重新生成 locale JSON。
- `content-diag-classes.test.ts` 判据修正（交互控件 = 按钮/输入框，`.diag-log-filter` 归布局容器）。
- 新增 vitest「警告 chip → 筛出 warn」用例；e2e 布局用例同步（行1=子tab+搜索+动作，行2=筛选）。

**第二批（方向 A + C）**
- 行2 新增操作类型下拉（纵向筛选），`logs.ts|dgLsFilterDiagLogs` 加第三条 AND 条件；`init.ts|dgInBindLogOpFilter` 绑 change（与 chips 同口径：运行时子 tab 不回落拉列表）。
- 三语 i18n `diagnostics.opAll`；`tpl.test.ts` 锁选项集 = OP_META 七类 + 全部；类名契约纳入 `.diag-log-op-filter`（判据补 `select`）。
- 容量口径具名常量（`DIAG_OP_WINDOW` / `DIAG_RUNTIME_WINDOW`）+ Go 来源注释。
- e2e 两行归属断言扩展：下拉必在行2 内、位于末位 chip 右侧（防漂回行1）。

> 实施坑记：e2e 初版误写 `filter.right <= opFilter.left` —— 下拉是 `filter`（`flex:1` 容器）的**子元素**，容器 right 天然包住子元素，该断言恒假（实测 1268 vs 1165）。正确锚点是「末位 chip 的 right ≤ 下拉的 left」。

**第三批（方向 D → ADR-289，分两轮）**

- **轮 1（Go 捕获层）**：`go/logs/runtime.go|RuntimeBuffer.Write` 提取行首 `[tag]`（`extractRuntimeTag`）+ 按词表推断级别（`inferRuntimeLevel`，fatal > error > warn > info，保守优先）；`types.RuntimeLog` 增 `Tag` 字段。**零调用点改动**。
- **轮 2（前端消费）**：`logs.ts|dgLsFilterRuntimeLogs` 接入 chips 级别筛选 + Tag 搜索命中域；`dgLsRuntimeStatusIcon` 按 Level 出图标；`.log-tag` 徽标；`init.ts` chips 在运行时子 tab 下改调 `loadRuntimeLogs`（仍不回落拉操作日志）。绑定已重生成。
- **关键设计坑**：chip 的 `data-status` 沿用**操作日志 Status 词汇**（success/failed/skipped），而运行时日志是 **Level 词汇**（info/error/debug）——**不同族，须显式映射**。warn 档语义也不同：操作日志是精确 `Status === "warn"`，运行时是**级别阈值**（warn + error + fatal）。
- **实证**：247 条真实日志中 225 条（91.1%）带 tag；级别分布 fatal 2% / error 60% / warn 12% / info 26%（error 高是真实分布——Go 只在出问题时写日志）。