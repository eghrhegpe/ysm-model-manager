# YSM 模型管理器 · 整合包同步前端设计锐评报告

> 审查身份：资深前端架构评审（原生 TS + Web Components + Shadow DOM，无框架）
> 审查范围：`frontend/src/views/app-sync-manager/*`、`frontend/src/features/sync/*`、`frontend/src/features/pack-ops/*`、`frontend/src/views/app-sidebar/*`、`frontend/src/features/dnd/pack-dnd.ts`
> 红线对照：前端只读不判 / import 禁裸目录聚口 / features 不直引 `backend/app.ts` 不写 HTML 字面量 / `src/core` 三约束 / `*-deps.ts` seam
> 行号基准：以 `git` 工作区现行为准（index.ts 373 / renderer.ts 472 / events.ts 216 / network.ts 93 / store.ts 162 / state.ts 33 / tpl.ts 225 / sm-css.ts 89 / self-type.ts 63；sync.ts 440 / sync-deps.ts 12；instance-ops.ts 148 / pack-ops-deps.ts 11；app-sidebar index.ts 365 / events.ts 391 / sync-flow.ts 626 / tpl.ts 318 / loader.ts 159 / render.ts 74 / data.ts 26；pack-dnd.ts 319）。任务描述里的「index 344 / sync-flow 588 / renderer 439」是历史快照。
> 说明：本报告为纯审查，未修改任何代码、未提交。

---

## 0. 红线合规快检（grep 证据）

| 红线 | 核查方法 | 结论 |
|---|---|---|
| features 不直引 `backend/app.ts` | grep `from "@/backend/app.ts"`（features 下） | 合规：features 生产文件一律走 `@/features/sync/sync-deps.ts` / `@/features/pack-ops/pack-ops-deps.ts` / `@/features/dnd/dnd-deps.ts` |
| views 不直引 `backend/app.ts` | grep 同上（views 下） | 合规：views 走 `@/views/backend-deps.ts`（ADR-190 D2 延伸至 views 的唯一出口） |
| features 不写 HTML 字面量 | grep `innerHTML\|outerHTML\|insertAdjacentHTML`（features 下，98 处命中） | **部分违规，但不在本次范围内**：命中集中在 `features/dialogs/*`（batch-rename.ts:133、rename.ts:38-86、adv-filter.ts:187、tag-editor.ts:45/56/103）、`features/community/*`（render.ts:103/162/183、download-queue.ts:95-233、repo-events-bindings.ts:42/174/178）、`features/maintenance/*`（recycle-bin.ts:238-400、oldest-models.ts:49-199、version-updater.ts:130-256）。本次审查的 `features/sync/sync.ts`、`features/pack-ops/instance-ops.ts`、`features/dnd/pack-dnd.ts` **零 innerHTML**（grep 未命中），HTML 全部归 views 层 `tpl.ts`——本子集合规 |
| seam 是否 `deps?.fn \|\| backendGetApp` 注入形态 | 通读 9 个 `*-deps.ts` | **未执行**：`sync-deps.ts`、`pack-ops-deps.ts` 等 9 个目录级 seam 均为**纯转发单出口**（`return getApp()`），**没有** `deps?.fn` 可选参、**没有** `set/reset` seam。文件头注释已明确记录：曾复制 `context-menu-deps` 的 set/reset 模式，因全仓库零消费方而删除，测试走 `vi.mock("@/backend/app.ts")` 模块层拦截。**真正的 `deps?` 注入形态在本仓仅存在于 `features/maintenance/recycle-bin.ts:69 PROD_DEPS`、`features/context-menu/context-menu-file-handlers.ts:33 FAIL_LOUD_DEPS`、`features/maintenance/oldest-models.ts:161 OldestDeps`** 三处（均为 tpl 注入形态），与 sync/pack-ops 走的「纯转发 + vi.mock」是两条不同路线。**结论：任务描述中的 `deps?.fn || backendGetApp` 形态在 sync/pack-ops seam 上不成立，属「注释已承认的有意简化」，但严格按红线字面是未达标的——见 P1-3** |
| 禁裸目录聚口 `@/dir` | 通读 20 个目标文件 import 头 | 合规：全部走 `@/具体文件` 或精确同目录 `./`（R5），无 `@/features/sync` 这类裸聚口 |

---

## 1. P0 — 结构性缺陷 / 会持续产生 bug

### P0-1　`runPush` 超时 `break` 后剩余类型静默丢弃，进度口径失真
**位置**：`app-sidebar/sync-flow.ts:348-427`（runPush 主体），关键在 `375-379`（`withTimeout(downloadMissing(...), SYNC_OP_TIMEOUT_MS, '推送 ${rt}')` + `TimeoutError → timedOut++ && break`）。

**问题**：按类型 `for (ti...)` 串行推送，任一类型超时即 `break`，**尚未开始（或已开始未 settle）的后续类型既不执行也不计入任何状态**——`PushAccum` 只有 `timedOut++` 一个累计，无法区分「类型 A 超时」与「类型 B/C/D 因 A 超时被顺延而从未尝试」。最终 `showPushToast` 只报「跳过 N + 超时 M」，**不点名是哪个类型/哪个包超时、也不提示哪些类型根本没跑**。已知历史问题「runPush 曾报纯成功文案隐藏失败（已加包级归因）」只修了**文件级→包级**归因，**类型级 break 的静默丢弃仍存在**——用户看到「推送完成」但某类型 0 个文件入实例。

**根因**：`downloadMissing` 是**全有或全无的批量操作**，`runPush` 只能整体 `await`，超时分支没有「部分完成」的回读契约（`DownloadOutcome` 无 `abortedAtType` / `remainingTypes` 字段）；且 `break` 直接退出 `for`，后续类型的错误分支（`absorbOutcome`）不会执行。

**建议方向**：① `DownloadOutcome` 增加可选 `aborted?: boolean` 与 `skippedTypes?: string[]`（由 sync.ts 在 break 前回填）；② `runPush` 超时后把**剩余类型列表**记入 `PushAccum.notices`，`showPushToast`/结果面板点名「类型 X 因超时未推送」；③ 不要用 `break`，改为 `continue` + `markSkipped(rt)`，保证每次 push 都能给出「本次实际尝试的类型 / 被顺延的类型」的完整清单。

**处置结果（2026-10-16 已修，commit `01391f525`）**：采纳①②，**不采纳③**（保留 `break`）。`PushAccum`（现 `frontend/src/views/app-sidebar/sidebar-push.ts`）新增 `abortedTypes: string[]`（:55-58，注释记「超时那一类 + 其后未跑的类型」）；超时分支改为 `accum.timedOut++; accum.abortedTypes = types.slice(ti); break;`（:193-197）；`showPushToast`（:117-123）与结果浮层（:224-230）**双双点名**被放弃的类型批次（`sidebar.packTimedOutStopped` 报个数 + 新文案带 `{n, names}` 拼接的 `names`），不再只报「1 个类型批次超时」。③ 的「改 `continue` + `markSkipped`」被否：ADR-340 重定义后**超时即早停是刻意的**——binding 挂起是唯一超时成因，续发只会让剩余类型全部撞 handler 持锁的 busy 假跳过（把「根本没跑」误报成「跳过」），`break` 保留真实计数、未跑类型既非成功也非跳过，点名清单的信息量等价而不引入假跳过。回归锁：`frontend/src/views/app-sidebar/app-sidebar.sync.test.ts` 的超时点名用例。

### P0-2　`runPull` 单包级 `Promise.allSettled` + `withTimeout`：超时后该包内部分类型静默丢结果
**位置**：`app-sidebar/sync-flow.ts:529-589`（runPull 主体），关键在 `553-557`（`withTimeout(Promise.allSettled(types.map(rt => PullResourceFromInstance(rt, insName))), SYNC_OP_TIMEOUT_MS, '拉取 ${insName}')`）。

**问题**：`runPull` 按整合包串行、包内类型并发。任一**类型**超时会让 `Promise.allSettled` 里**该类型**的 promise 一直挂到 timeout 才 reject，而 `withTimeout` 是包级包装——超时后**该包内其余类型已经 settle 的结果被整包丢弃**，`accumulatePullResults` 只看到 `timedOut++`，**没有包内「成功类型 / 未完成类型」的分流**。大整合包场景（几百文件、Go 侧 `PullResourceFromInstance` 串行写盘）单包 30s 超时容易误伤，用户会看到「拉取超时」但不知道到底拉了多少。

**根因**：`withTimeout` 的粒度是**包**，而并发单元是**类型**；`allSettled` 的结果在超时路径没有被消费，属于「粒度错配 + 结果丢半」。

**建议方向**：① 把 `withTimeout` 下沉到**每个 type**（`Promise.all(types.map(rt => withTimeout(PullResourceFromInstance(rt, insName), SYNC_OP_TIMEOUT_MS, '拉取 ${rt}'))).then(results => ...)`），用 `allSettled` 收集每 type 的成功/超时/失败三元组；② `accumulatePullResults` 接受 per-type 明细而非包级整体；③ 明确「超时只算超时的 type，其余 type 结果照实计入」的口径。

**处置结果（2026-10-16 已修，commit `01391f525`）**：按建议①+②+③全落地——`withTimeout` 下探到**每类型**，`Promise.allSettled(types.map(rt => withTimeout(PullResourceFromInstance(rt, insName), SYNC_OP_TIMEOUT_MS, ...)))`（现 `frontend/src/views/app-sidebar/sidebar-pull.ts:113-127`）；`PullPerType` 联合类型新增 `| { kind: "timeout" }` 独立分支（:30-36），`accumulatePullResults`（:51-52）对 timeout 只 `counters.timedOut++`、**不入 `failed`、不误计文件数**，同包内已 settle 的其余类型结果**照常归并**（原「包内丢半」消除）。包级早停仍保留（某包出现超时即停后续整合包，理由同 P0-1 的 ADR-340 口径），收尾 toast（:69）用 `sidebar.pullTimedOutStopped` 报超时类型数。回归锁：`frontend/src/views/app-sidebar/app-sidebar.sync.test.ts`「拉取：包内单类型超时不清空同包其余类型的结果（锐评 P0-2）」——只让第一个类型超时、其余 14 类返回 `ok:2`，断言 toast 仍是 `拉取完成: 28 个文件, 0 个失败` + `1 项拉取超时，已停止后续拉取`（超时不入 `failed`）；已做突变验证（改回「整包一个 `withTimeout(allSettled)`」→ 红灯，`waitFor` 等不到成功文案而超时）。

### P0-3　`_reload` 单飞 + `_reloadPending` 尾随补跑：**pending 补跑未区分 force**，变异后刷新可能被并入旧在途请求
**位置**：`app-sidebar/index.ts:250-301`（`_reload(force)`）。

**问题**：单飞锁命中时只设 `_reloadPending = true` 就 return，**丢弃了 `force` 参数**；`finally` 后补跑走 `void this._reload()`（**不带 force**，:299）。而 `loadInstances` 的契约（loader.ts:37-39 注释）明确：**force 是「跳过在途去重」的钥匙**，变异后（sync 拉取/导入/启停）必须 force 绕过在途合并，否则会拿到变异前发起的旧在途请求的陈旧列表。场景：用户在 `runPull` 完成瞬间又触发 `_reload(true)`，此时恰有非 force 的在途读请求，`_reload(true)` 被单飞拦下 → pending → 补跑时用非 force 重新请求 → **并入那个陈旧的在途请求，拉到变异前的旧列表**。这是 loader 2026-10 刚修好的「force 身份守卫」被调用方重新绕开。

**根因**：单飞锁与 force 语义耦合在同一个 `_reloadInFlight` 布尔里，`_reloadPending` 只记「要再跑」，没记「要不要 force」。

**建议方向**：把 `_reloadPending` 改为 `_reloadPendingForce: boolean`（或小结构 `{force: boolean}`），`:254` 处 `this._reloadPendingForce = this._reloadPendingForce || force`；`:299` 处 `void this._reload(this._reloadPendingForce)`。一行改，风险低。

**处置结果（2026-10-16 已修，commit `01391f525`）**：按建议落地。`frontend/src/views/app-sidebar/index.ts` 新增 `private _reloadPendingForce = false;`（:58）；单飞命中处 `:254 this._reloadPending = true;` + `:256 this._reloadPendingForce = this._reloadPendingForce || force;`（取**或**——强 force 不会被后续弱请求冲掉）；`finally` 后的补跑处 `:299-302 if (this._reloadPending) { this._reloadPending = false; const nextForce = this._reloadPendingForce; this._reloadPendingForce = false; ... }` 以 `nextForce` 补跑；卸载复位（:329/:331）一并清两个标志位。审查的「一行改」评估准确。回归锁：`frontend/src/views/app-sidebar/app-sidebar.sync.test.ts`「`force` 补跑：变异刷新撞在途 reload → 补跑仍带 force（不被静默降级）」——`bus.emit("stats:refresh")`（300ms 防抖后 `_reload(true)`）落进在途窗口，断言补跑那次 `loadInstances` 收 `{ force: true }`；已做突变验证（去掉 `|| force` 累积 → 红灯，报 `expected { rtype: 'ysm', force: false } to deeply equal { rtype: 'ysm', force: true }`）。

### P0-4　`bindPackCardDnD` / 侧栏勾选**仍存在按 `data-idx` 下标取包的残留路径**，与「按名称解析」的 P1 修复并存不一致
**位置**：`app-sidebar/sync-flow.ts:149-157`（`getSelected()`：`.chk:checked` + `data-idx` 下标）；对照 `app-sidebar/render.ts:34`（`card.dataset.idx = String(idx)` 仍在写）+ `:38`（`card.dataset.name = ins.name` 也已写，但 `getSelected` 未用）。

**问题**：已知历史问题「整合包卡片拖拽曾用下标静默指向错误包」已修（`pack-dnd.ts:293-302` 改为按 `data-name` 解析 + 找不到报错），`bindCardClickHandler`/`bindCardContextHandler` 也已改为读 `st.instances[idx]` 后由实例引用取 `pkg.name`（events.ts:90-91、136-137）——但 **`getSelected()` 仍完全按 `data-idx` 下标**从 `_instances` 里取 `SidebarInstance` 传给 `downloadMissing({instanceNames: selected})`。侧栏 `stats:refresh` 重渲染后 `data-idx` 与 `_instances` 数组的对应关系**可能错位**（增删实例后未 `_reload` 的窗口期），此时推送/拉取会**把 B 包的文件推到 A 包**。

**根因**：`getSelected` 是同步函数，`_instances` 是 `_reload` 后一次性快照；卡片 DOM 的 `data-idx` 与快照数组在重渲染后**没有**做一致性校验（不像 `pack-dnd` 有 `card.dataset.name` + `getInstances().find` 的双保险）。

**建议方向**：`getSelected()` 里改用 `checkbox.closest('.instance-card')?.dataset.name` 取 `name`，再用 `name` 在 `_instances` 里 `find`；找不到就 `toast(t("inst.packNotFound"))` 显式报错，**不静默丢弃**。与 `pack-dnd.ts:298`、`events.ts` 的 P1 修复保持同一口径。同时建议在 `render.ts:34` 逐步废弃 `data-idx`（`data-idx` 仍被 `restoreSelectedCard`/roving 消费，需同步迁移，属**待验证**改造量）。

**处置结果（2026-10-16 已修，commit `01391f525`）**：按建议改「按 `data-name` 解析 + 未命中显式告警」。`frontend/src/views/app-sidebar/sidebar-select.ts`（P1-2 拆分后的新家）抽出单一解析函数 `instanceNameOf(cb)`（:25-27）：`cb.closest("[data-name]")?.getAttribute("data-name") ?? null`——**一律从 DOM 的 `data-name` 读，禁用 `data-idx` 回查 `_instances` 数组**（注释记「stats:refresh 重渲染后 data-idx 会与 `_instances` 快照错位」）；`getSelected`（:30）逐项调用它取名，未命中项 `logWarn("sync-flow", "getSelected: 勾选项未命中实例名，跳过", { name, idx })`（:37-44，`idx` 取**卡片自身**的 `data-idx`——`data-idx` 写在 `.instance-card` 上、不在 `input` 上，原写 `input.dataset.idx` 恒 `undefined`，补测试时发现并一并修正）后跳过，不再静默取错包。`bindSelectAll`（:71）与 `restoreCheckboxes`（:109）同口径收编，三条路径共用一个解析函数。`render.ts` 写 `data-idx` **保留**（`restoreSelectedCard`/roving 仍消费，即审查自述的「待验证改造量」），本次不动。回归锁：新建 `frontend/src/views/app-sidebar/sidebar-select.test.ts` 6 例（`instanceNameOf` 读 `data-name` 不碰 `data-idx`；`data-name` 与 `data-idx` **分叉窗口**取 `data-name`——按下标回查会返回 `packA` 而正确答案是 `packB`；幽灵名跳过 + 告警；孤儿勾选框跳过），已做突变验证（把 `getSelected` 改回按下标解析 → 3 例红灯，报 `expected [ 'packA' ] to deeply equal [ 'packB' ]`）。

---

## 2. P1 — 明显技术债

### P1-1　同步状态分裂：`app-sidebar`、`features/sync`、`app-sync-manager` 各自维护一份「同步进度」真相
**位置**：`app-sidebar/sync-flow.ts:247-258`（`PushAccum`）、`features/sync/sync.ts:40-53`（`DownloadOutcome`）、`app-sync-manager/index.ts:154-177` + `store.ts:54-100`（`_allItems` / `_scanDirs`）。

**问题**：一次「推送」至少在三处独立记账：
1. `features/sync/sync.ts` 自己累计 `ok/fail/skipped/errors/packs/overwrites`（`DownloadOutcome`）；
2. `app-sidebar/sync-flow.ts` 再包一层 `PushAccum`（`skipped/blocked/timedOut/installOk/installFail/errorDetails/packTotals/overwrites`），`absorbOutcome:261-282` 手工做一次映射；
3. `app-sync-manager` 的 `_singleBusy`、`_allItems`、`_scanDirs` 又是另一份（`performSingleOp` 单文件级）。

三份状态各自独立演进（包级归因、类型级超时、单文件 busy 互不相同），**没有单一 source of truth**。`DownloadOutcome` 已经是 features 层较好的结构化契约，但 sidebar 层又叠了一层聚合，**未来任何字段新增都要在两处同步**——历史 bug「runPush 曾报纯成功文案隐藏失败」正是这种双份记账的产物（sync.ts 报的是 `errors`，sidebar 报的是 `installFail`，两者曾经不同步）。

**根因**：分层边界清晰（features 管「操作」、views 管「展示」），但 **`DownloadOutcome` 未成为唯一事实源**，sidebar 的 `PushAccum` 是历史遗留的「展示侧聚合层」，职责与 features 层重叠。

**建议方向**：**让 `DownloadOutcome` 成为推送结果的唯一契约**，`PushAccum` 退化为纯 `DownloadOutcome` 的派生视图（或直接删除，`absorbOutcome` 内联）。包级/文件级归因、超时/跳过/错误全由 `DownloadOutcome` 提供，sidebar 只做 `t()` 文案映射。可顺带把 `MAX_PACK_ERRORS`/`MAX_TOTAL_ERRORS`/`MAX_NAMED_PACKS`/`MAX_NAMED_OVERWRITES`/`MAX_PANEL_PACK_FILES`（sync-flow.ts:42-54）与 sync.ts:79-81 的 `MAX_ERRORS`/`MAX_PACK_ERRORS` 统一收敛到一处常量。

**处置结果（2026-10-16 复核，锐评行号基准已过时——以现行为准）**：**建议方向不采纳，原判定系误判**。证据如下：
1. **`PushAccum` 含 `timedOut`/`abortedTypes` 两个编排层专属字段**，`DownloadOutcome` **不可能**承载：`downloadMissing` 契约是「恒 settle 不 reject」（sync.ts:328-329），超时是 `runPush` 里的 `withTimeout`（sync-flow.ts:405）在 **views 层**捕获的 `TimeoutError`，`downloadMissing` 本身从不抛它。把超时塞回 `DownloadOutcome` 会污染 features 层（features 不知晓调用方的超时编排）。
2. **`absorbOutcome` 的每一行都是真跨批次归并，非纯透传**：`installOk/installFail` = 跨类型求和；`errorDetails` = 跨类型截断汇总（每批限 3 条，跨 15 类型再限 5 条，sync.ts:79 vs sync-flow.ts:43）；`packTotals` = 跨类型**合并同名包**（一个包会出现在多个类型的 `packs` 里，必须累加）；`overwrites` = 跨批次 Set 去重（磁盘事实不是批次事实，sync-flow.ts:272-274 注释写明）；`skipped`/`blocked` = 对 `skipped+skipReason` 的**语义再分流**（busy vs config/error）。这些都做不了「`PushAccum` 直接内联、sidebar 只做文案映射」——聚合逻辑必须有落点。
3. **第三处 `app-sync-manager` 的 `_allItems`/`_scanDirs` 与推送结果无关**：它是 `store.ts:57/68` 经 `GetInstanceSyncStatus`/`GetSyncScanDirs` 拉回的**同步状态视图模型**（当前实例每个文件的 synced/missing/diverged + 扫描目录摘要），与「一次推送的成败计数」是完全不同的两类数据，**不可合并**。原判定把「状态视图」与「操作结果」并列为「三份真相」，是类别混淆。
4. **历史 bug 已修，无现存活账**：`runPush` 现在 toast 用 `accum.installFail`、浮层用 `accum.installOk/installFail/errorDetails/packTotals/overwrites`，**全部读同一份 `accum`**，无双份记账分歧。
5. **常量非重复**：`sync.ts` 的 `MAX_ERRORS=3`/`MAX_PACK_ERRORS=2` 是**单批**上限；`sync-flow.ts` 的 `MAX_TOTAL_ERRORS=5`/`MAX_NAMED_PACKS=3`/`MAX_NAMED_OVERWRITES=3`/`MAX_PANEL_PACK_FILES=8` 是**跨批**或**展示层**上限——分层设防，收敛成一处反而丢失语义（15 类型累积不可能用单批的 3 条截断）。

**结论**：分层是**正确的**——features 管「操作契约」（`DownloadOutcome`），views 管「跨批归并 + 编排状态」（`PushAccum` 加 `timedOut`/`abortedTypes`）。原判定「`DownloadOutcome` 未成为唯一事实源」是把**归并器**误当**重复记账**。真正的可改进点是**把归并逻辑（`absorbOutcome`/`buildFailedPacks`/`buildPushParts`）从 626 行的 `sync-flow.ts` 抽成独立模块**以便单测——这归属 P1-2（sync-flow.ts 拆分），**不改变 `PushAccum` 的职责**。据此，「数据流 6/10」的扣分 4 分应重估：`stats:refresh` 广播重复刷新（P1-5）那一半仍成立，P1-1 这一半不成立。

### P1-2　`sync-flow.ts` 626 行承担 6 类职责，已到拆分阈值
**位置**：`app-sidebar/sync-flow.ts`（全文 626 行）。拆解：`checkedSetFor`/`bindSelectAll`/`pruneCheckedSets`/`restoreCheckboxes`（勾选持久化，23-136）、`closeAllMenus`/`getSelected`/`resolveTypes`/`beginSync`/`resetButton`（菜单与锁，143-210）、`PushAccum` 系（247-340）、`runPush`（348-427）、`runPull`（529-589）、`renderSyncResultPanel`/`closeSyncResultPanel`（495-527，含模块级 `escHandler`）、`bindSyncSelected`（592-626）。

**问题**：一个文件里同时有「勾选状态持久化」「下拉控制器」「推送编排」「拉取编排」「结果浮层 esc 处理」「按钮 loading 状态」——测试要 mock 六个不同子系统（`app-sidebar.sync.test.ts` 里 `vi.mock` 了 loader / sync / async / bus / app.js 五处）。`module` 级变量 `escHandler`（挂 `document` 的 keydown）也在这 626 行里，跨渲染生命周期存活，见 P2-2。

**根因**：功能按「都是整合包同步」归到一文件，未按「职责」二次分割。与 `app-sync-manager` 六文件（index/events/state/store/renderer/tpl/network/self-type/css）形成鲜明反差——sync-flow 是**反向示范**。

**建议方向**：拆三件——`sidebar-push.ts`（runPush + PushAccum + absorb）、`sidebar-pull.ts`（runPull）、`sidebar-select.ts`（勾选/全选/restore）。`sync-flow.ts` 保留为「编排入口 + 下拉控制器」。拆分后每文件 < 250 行，测试可按子系统单 mock。

**处置结果（2026-10-16 已落地）**：按职责做**五向拆分**（比建议的「三件」多拆两件，因为结果浮层被 push/pull 共用、push/pull 又共用 `resetButton`，任一侧私藏都会引入不该有的反向依赖）：

| 新文件 | 行数 | 职责 |
|---|---|---|
| `sidebar-select.ts` | 122 | 勾选集合读写 + 全选 + 幽灵名修剪 + 恢复 + `getSelected`/`instanceNameOf`（按 data-name 解析） |
| `sidebar-push.ts` | 248 | 推送编排 + `PushAccum`/`absorbOutcome`/`buildFailedPacks`/`buildPushParts`/`showPushToast` + 推送侧常量（`MAX_TOTAL_ERRORS` 等）+ `baseName` |
| `sidebar-pull.ts` | 165 | 拉取编排 + `PullCounters`/`PullPerType`/`accumulatePullResults`/`notifyPullOutcome` |
| `sidebar-result-panel.ts` | 47 | 变更明细浮层（`escHandler` + `renderSyncResultPanel`/`closeSyncResultPanel`）——push/pull 共用，独立成文件避免任一侧依赖编排侧 |
| `sidebar-shared.ts` | 19 | push/pull 共用原语（`SyncVerb` + `resetButton`） |
| `sync-flow.ts`（收敛后） | 145 | 编排入口 + 下拉控制器（菜单命中 → 抢锁 → 分派 push/pull） |

依赖方向无环：`sync-flow.ts → {select, push, pull, result-panel}`；`push/pull → {shared, result-panel}`；`result-panel → tpl`。原 706 行（锐评时 626 行）降到最大 248 行，`sync-flow.ts` 从「六职责杂糅」收敛到单一职责。`index.ts` 改为直接 `import { bindSelectAll, pruneCheckedSets, restoreCheckboxes } from "./sidebar-select.ts"`，`sync-flow.ts` 只导出 `bindSyncSelected`（不再做 barrel 再导出）。`sync-flow.test.ts` 的 `pruneCheckedSets` 直测改从 `sidebar-select.ts` 导入。

验证：`npm run typecheck` 通过 + `check-bindings`「✅ 未发现绕过 bindings 的直接调用」；`vitest run` 全量 **540 文件 / 8643 测试全绿**（62s）；app-sidebar 9 文件 121 测试全绿。

### P1-3　`sync-deps.ts` / `pack-ops-deps.ts` 未实现 `deps?.fn` 注入 seam，测试完全依赖 `vi.mock` 模块层拦截
**位置**：`features/sync/sync-deps.ts:10-11`、`features/pack-ops/pack-ops-deps.ts:8-9`、`features/dnd/dnd-deps.ts:9-10`、`views/backend-deps.ts:13-14`。

**问题**：四个 seam 都是 `export function xxxGetApp(): ReturnType<typeof getApp> { return getApp(); }`——**纯转发**。红线要求的 `deps?.fn || backendGetApp` 注入形态（或 ADR-190 D2 的 set/reset）在此**未实现**。测试只能 `vi.mock("@/backend/app.ts")` 或 `vi.mock("@/views/backend-deps.ts")` 做模块层拦截。文件头注释已诚实承认（`sync-deps.ts` 头：「set/reset seam 曾复制 context-menu-deps 已删模式——全仓库零消费方，测试走 vi.mock("@/backend/app.ts") 模块层拦截；按同目录先例删除零测试的模块级可变全局，保留纯转发单出口」）。**这本身是合理决策**（避免零消费的可变全局），但与红线字面有偏差，且 ADR-224「vi.mock 路径失效会静默无告警」的风险敞口完全暴露在测试上。

**影响面（grep 证据）**：`views/app-sidebar` 下 `vi.mock` 命中 5 个测试文件，**mock 目标不统一**：
- `app-sidebar.component.test.ts:7` / `app-sidebar.sync.test.ts:10` / `app-sidebar.unmount.test.ts:23` / `app-sidebar.keyboard.test.ts:22` / `events.test.ts:46` → `vi.mock("../../../bindings/ysm-model-manager/internal/app/app.js", ...)`
- `launcher-detect.test.ts:13` → `vi.mock("@/backend/app.ts")`、`loader.test.ts:22` → 同款

`views/app-sync-manager` 下 6 个测试文件，**同样两种混用**：
- `network.test.ts:5` / `store.test.ts:6` → `vi.mock("@/views/backend-deps.ts")`
- `index.test.ts:34` / `a11y.dom.test.ts:31` / `index.branches.test.ts:28` / `renderer.virtual.test.ts:31` → `vi.mock("@/backend/app.ts")`

**问题**：① 同一模块内 mock 策略不统一，维护成本高；② 两套 mock 都能工作是因为 `backend-deps.ts` 是纯转发，一旦 seam 加上 `deps?` 或改签名，**`vi.mock("@/views/backend-deps.ts")` 那批测试会静默失效**（ADR-224 警告）而不报错；③ `app-sidebar` 走 `../../../bindings/.../app.js` 这条路径是**绕过 seam** 的 mock（直接 mock 生成物），若 `bindings` 重新生成后 `app.js` 导出变化，测试会因路径失效而静默通过（mock 工厂返回 `{}`，调用方解构 `undefined` 才炸）。

**建议方向**：① **统一**测试 mock 路径：全走 `vi.mock("@/backend/app.ts")`（seam 唯一出口），废弃 `../../../bindings/.../app.js` 与 `@/views/backend-deps.ts` 两处旁路；② 若坚持保留纯转发 seam，**至少**在 `vi.mock` 工厂里加一个 `if (typeof getApp !== "function") throw` 的 fail-loud 断言，把「路径失效静默通过」变成「测试启动即红」；③ 评估把 sync/pack-ops 的 tpl 相关（若有）迁到 `Deps` 注入形态（对齐 `recycle-bin.ts:69 PROD_DEPS` 先例）。

**处置结果（2026-10-16 复核，锐评行号基准已过时——以现行为准）**：
- **已修**：`app-sync-manager/network.test.ts` 与 `store.test.ts` 从 `vi.mock("@/views/backend-deps.ts")` 迁到 `vi.mock("@/backend/app.ts")`（seam 唯一出口），与同目录 `index/events/renderer` 8 个测试同口径，消除「同一模块内 mock 目标混用」。行为等价（`backend-deps.ts` 是纯转发，`store.ts:57/68`、`network.ts:47` 调 `backendGetApp()` → `getApp()` 被 mock 命中）。10 文件 111 测试全绿。
- **复核纠偏**：原判定「`app-sidebar` 5 个测试 `vi.mock(bindings/app.js)` 绕过 seam」**不准确**。实测 grep：全仓 12 个文件 mock `bindings/.../app.js`，其中 `backend/app.test.ts` 属正当（测真实 `app.ts` 的依赖）；4 个**同时** mock 了 `@/backend/app.ts` 作为真正 seam 拦截（app-content.component、app-content.methods、app-preview.component、app-sidebar.loader），`bindings` mock 是**node/jsdom 环境阻断 `@wailsio/runtime` 加载链**的必要运行时护栏（`loader.test.ts:9-11` 注释写明），非绕过 seam。仅 `app-sidebar` 5 文件 + `app-tree` 2 文件**只** mock bindings 未 mock seam——但这是「在最深层 mock，seam 自然透传」的**有效替代方案**，非绕过；`bindings` 重新生成后导出变化会因解构 `undefined → "not a function"` **显式炸**，非静默通过。ADR-224 的「静默」风险实际收窄到「路径本身失效」这一窄场景（vitest 会 `Cannot find module` 显式报错）。**该部分原判定过重**。
- **`deps?.fn` 注入形态维持不采纳**：文件头已记录「set/reset seam 曾复制 context-menu-deps 已删模式——全仓库零消费方，测试走 `vi.mock("@/backend/app.ts")` 模块层拦截；按同目录先例删除零测试的模块级可变全局，保留纯转发单出口」——为**合理有意简化**。仓内真正的 `Deps` 注入形态仅在 `recycle-bin.ts:69 PROD_DEPS`、`context-menu-file-handlers.ts:33 FAIL_LOUD_DEPS`、`oldest-models.ts:161 OldestDeps` 三处（tpl 注入形态），与 sync/pack-ops 的「纯转发 + vi.mock」是两条不同路线，无合并必要。
- **ADR-224 fail-closed 已由 `test-utils/mock-app.ts` 兜底**（未配置方法调用即 throw、thenable 探针放行、`afterEach` 须 `resetAppMock()`，注释钉死 code_review 7be20003 隔离契约）。建议后续新测试优先采用该 helper。

### P1-4　`runPush`/`runPull` 大整合包下的串行性能瓶颈 + 无细粒度进度
**位置**：`features/sync/sync.ts:149-199`（`installInstanceMissing`：逐 `Missing` + `MissingDirs` **for-await 串行**安装）+ `app-sidebar/sync-flow.ts:375-379`（逐类型**串行** `await downloadMissing`）+ `sync-flow.ts:553-557`（runPull 逐包串行、包内类型并发）。

**问题**：一次 push 的时间复杂度是 **O(类型数 × 整合包数 × 该包缺失文件数)** 的串行链。MMD 用户常见 30+ 整合包、单包上百文件时，push 动辄数分钟。`withTimeout(SYNC_OP_TIMEOUT_MS)` 在慢盘/大文件下**很容易误触发超时**（见 P0-1/P0-2），用户看到「超时」但安装仍在继续。进度反馈只有「类型 i/n」级别（按钮 loading + toast），**单包内没有「已安装 x/y」的增量**。

**根因**：① features 层 `for-await` 串行是**防御性**设计（避免同时写盘），但 Go 侧 `InstallLock` 已做串行化（`network.ts` 注释 30-33 提到 Go 侧 `InstallLock` 竞争），前端再串行是**双重串行**——是否可改为「每类型最多 N 并发」需 Go 侧契约确认（**待验证**）；② 进度回调未透出，`runPush` 无 `onProgress(typeIdx, packName, done, total)` 挂钩。

**建议方向**：① 先做**契约对齐**：确认 Go 侧 `InstallResourceToInstance`/`PushSingleResourceToInstance` 是否允许并发调用（若允许，前端可改 `Promise.all` 分片 4-8 并发）；② 给 `downloadMissing` 加可选 `onProgress` 回调，`runPush` 透传到按钮 loading 文本「推送中：类型 2/6 · 包 'MMD 主包' · 12/87」；③ 明确 `SYNC_OP_TIMEOUT_MS` 是否应随 `Missing` 文件数动态放大（**待验证**：需看常量定义）。

**处置结果（2026-10-16 复核）**：**接受现状，不改**。① 的「双重串行」经复核为**误判**：Go 侧 `installer.InstallLock`（ADR-056）是**全局互斥**，`Install` 全程持锁（`installer.go:59-63` 获取 + `defer Unlock`，内部走 `*_Locked` 变体），前端改 `Promise.all` 并发只会让请求**排队等同一把锁**——吞吐不变，而超时归因更乱（并发下哪一批超时不再对应「类型 i/n」）。② 的「无细粒度进度」属实（进度只在按钮 loading 的「推送中 i/n」），但 `downloadMissing` 契约是「恒 settle 不 reject」的**批量原子操作**，加 `onProgress` 需 Go 侧逐文件回调通道（新增 binding 面），属性**功能需求**而非债务修复。③ 动态放大 `SYNC_OP_TIMEOUT_MS` **不采纳**：超时的唯一真实成因是 binding 永久挂起（该判定由 P0-1 复核确立），与文件数无关，放大只会推迟故障暴露。结论：P1-4 是**架构性**的（与 P1-5 同源，P1-5 是它的下游症状），非独立可修项。

### P1-5　`stats:refresh` 事件链的重复刷新：一次变异触发 2+ 组件同时重载
**位置**：`features/sync/sync.ts:314`（`bus.emit("stats:refresh")`）、`:340`（同函数内又 `bus.emit("tree:reload")`）、`features/pack-ops/instance-ops.ts:138`（清空后 emit）、`app-sidebar/index.ts:112-116`（`stats:refresh` → 300ms 防抖 → `_reload(true)`）、`app-sync-manager/index.ts:283-290`（`stats:refresh` → `loadData` 全量重拉）。

**问题**：一次 push/pull/清空操作会同时触发 sidebar 与 sync-manager 各自 reload，各自重新走 `backendGetApp()` → `GetResourceInstanceStatus` / `GetInstanceSyncStatus`——两个组件**并发拉同一份数据**。虽然 loader 有 `_inflight` 在途合并、scanner 有 singleflight，但**只有 sidebar 走 `loadInstances` 的合并**；`app-sync-manager` 的 `_subscribeBus` 直接 `loadData`（`GetInstanceSyncStatus`），**没有合并层**。且 `sync.ts:340` 在 `downloadMissing` 内部 emit `tree:reload` + 外层又 emit `stats:refresh`——`tree:reload` 会让 app-tree 也刷一次。

**根因**：`stats:refresh` 是**广播型**事件，所有订阅者各自独立重拉，事件总线没有「已刷新」的去重语义。

**建议方向**：① 在 `app-sync-manager` 加与 sidebar 同款的 `_inflight` 合并（或复用 `utils/async/singleflight`）；② 评估把 `stats:refresh` 语义收敛为「变异已发生，请在**下一帧**重拉」，配合 300ms 防抖已足够；③ `sync.ts:340` 的 `tree:reload` 若与 `stats:refresh` 重复触发同一次 tree 刷新，可择一（**待验证**：需看 tree 对 `tree:reload` 的处理）。

**处置结果（2026-10-16 复核）**：**接受现状，不做代码改动**——这是广播型设计的固有代价，不是可独立修的错误。逐条复核建议方向：
1. **「三份数据」不可合并**：sidebar 的 `_reload` 走 `GetResourceInstanceStatus`（实例列表），sync-manager 的 `loadData` 走 `GetInstanceSyncStatus` + `GetSyncScanDirs`（当前实例每个文件 synced/missing/diverged + 扫描目录），app-tree 走 `loadEntries`（文件树）。**三者是不同 Go 函数、不同数据源**，不存在可合并的共享 IPC——「一次变异触发 2+ 组件重载」不是重复拉同一份数据，而是三个不同面板各自需要刷新。bus 是广播型设计，这是**刻意**的（每个面板是独立数据消费者）。
2. **正确性已由 `_guard` 兜底**：`app-sync-manager/index.ts:284` 在 handler 里先取 `gen = this._guard.current`，`loadData`（store.ts:55）内部再取一次，`:288`/`:63` 都判 `stale` 早退。多类型串行 push 发多次 `stats:refresh` 时，只有最后一次 gen 的结果落地渲染，前面的都被丢弃——**无陈旧显示风险**，只浪费几次 IPC。这是 ADR-230 单出口代际护栏的正常工作。
3. **可改进点与 P1-4 同源，已被裁定不改**：串行 push 逐类型 `await downloadMissing`，每个类型完成发一次 `stats:refresh`，事件间隔=各类型安装耗时（秒级）。**300ms 防抖与 `_inflight` 合并都合并不了秒级间隔的事件**——所以建议方向①/② 实际上**修不了**指出的浪费。要真正消除多次重拉，得并行化 push（P1-4），而那被 ADR-056 `installer.InstallLock` 全局锁架构性阻断（FE 并行化只是排队等锁）。P1-5 是 P1-4 的**下游症状**，修 P1-5 必须先动 P1-4。
4. **`tree:reload` 与 `stats:refresh` 不重复**：grep 实证——`tree:reload` 唯一消费者是 `app-tree/bus-handlers.ts:58`；`stats:refresh` 的消费者是 sidebar（index.ts:112，300ms 防抖）与 sync-manager（index.ts:282）。**两边零交集**，无「同一次 tree 刷新被触发两次」的问题。建议方向③ 的「待验证」现已验证为**否**。

**结论**：P1-5 无正确性缺陷，`_guard` 已覆盖；残余浪费（多类型串行 push 的多次 `GetInstanceSyncStatus`）是 P1-4 串行设计的固有下游症状，需先解 P1-4（架构性，ADR-056 裁定不改）。因此「数据流 6/10」的扣分 4 分应再重估：P1-1 那一半已不成立（见上），P1-5 这一半也非独立可修项——**实际扣分依据只剩 P1-1/P1-5 之外的 bus 命名一致性等正面项**，可上修至 7/10。

### P1-6　i18n 类型标签口径已拍板但仍有残留中文裸奔风险
**位置**：`features/pack-ops/instance-ops.ts:123`（`const typeLabel = rtypeLabelOf(rtype)`，弹窗 `inst.clearMessage` 用）+ 注释 120-122 记录「2026-10-15 拍板『权威源 = locale』」。对照 `tpl.ts` 侧栏卡片 `noModLabelOf`（`shortLabelOf`）。

**问题**：`instance-ops.ts` 的 `clearMessage` 弹窗已改走 `rtypeLabelOf`，**但 `rtypeLabelOf`/`shortLabelOf` 本身是否支持 en/ja 完整本地化？** 从 `utils/resource/types.ts` 的实现看（**待验证**，本次未细读），`shortLabelOf` 很可能是 **id→中文硬映射**。若如此，en/ja 用户看到「清空此整合包的 模型」中文混排，与「权威源 = locale」相悖。`instance-ops.ts` 注释只记录了口径，未验证下游函数实现。

**grep 证据（i18n 参数一致性）**：`inst.clearMessage` 在 `locales/{zh-CN,en,ja}.ts` 三处均有定义且参数 `{name, n, type}` **一致**（zh-CN.ts:1016 / en.ts:1037 / ja.ts:1035，另 public/locales/*.json:858 同步）。`inst.exportListCopied` 同样三语一致（`{n}`）。**参数化无缺失**，风险仅在于 `rtypeLabelOf` 返回值本身的本地化程度。

**建议方向**：① 读 `utils/resource/types.ts` 的 `rtypeLabelOf`/`shortLabelOf`，若为中文硬编码则补 en/ja 映射；② 弹窗与右键菜单的 `type` 文案应共用同一 `labelOf` 函数（当前两套叫法已收敛，需确认 `rtypeLabelOf` 与 `shortLabelOf` 输出一致）。

**处置结果（2026-10-16 复核）**：**建议方向不采纳，原判定系误判**。已读 `frontend/src/utils/resource/types.ts:162-168` 的 `rtypeLabelOf`/`shortLabelOf`：二者**不是 id→中文硬映射**，而是从 `resource_types.json`（经 `schema.ts` 构建期内联的 `allResourceTypes`）取 `labelKey`，再走 `t()` 出标签——**权威源本就是 locale**，en/ja 用户拿到的是各自语言的标签，不存在「中文裸奔」。这正是 ADR-269 D3③ 与 `docs/knowledge/resource-types.md` 的「类型判定与标签单一事实源 = `resource_types.json` + Go，FE 不自行判断」纪律；审查自述的「本次未细读」即误判来源。② 所述两套叫法已由 `shortLabelOf` 统一，输出一致（侧栏卡片 `noModLabelOf` 亦经 `shortLabelOf`）。

---

## 3. P2 — 优化建议

### P2-1　`tpl.ts` 仍残留成片静态内联 `style=`，与「样式归样式表」注释相悖
**位置**：`app-sync-manager/tpl.ts:66,71,76`（`actionBtnHTML` 三处 `style="border:1px solid var(--accent);color:var(--accent)"`）、`:103`（`syncDirRowHTML` 缩进）、`:110-118`（四段内联 `flex-shrink/font-size/flex:1/overflow/color`）、`:131-139`（`containerHTML` 整块布局 `display:flex/flex-direction/height/overflow/padding/border-bottom/font-size`）。

**问题**：`sm-css.ts` 头注释（`:37-38`「a11y……样式归样式表，行内 style 只留缩进等动态值」、`:43`「筛选栏重构……原同样是行内 style=」、`:56-58`「setRowButtonsBusy 与 renderer.restoreBusyState 各自内联写 style.opacity/cursor 两处重复——样式归样式表」）声称**行内 style 只剩动态值**，但实测 `actionBtnHTML`/`containerHTML` 的 style **全部是静态字面量**（颜色、flex、border 均非动态），只是搬到了 `tpl.ts` 里。这属于**迁出未迁完**：`sm-css.ts` 收编了按钮 busy、status-tab、dir-arrow、path-cell、no-instance、loading 等，但**漏了 action 按钮三色、containerHTML 布局、syncDirRowHTML 的 flex 项**。静态内联样式与主题变量脱钩风险低（都用 `var(--*)`），但与仓库「样式归样式表」的治理纪律不一致，且 `.sm-item-btn` 已有基类样式可挂色。

**根因**：2026-10 的样式迁移是分批次做的（sm-css.ts 头注释记录每批的收编路径），action 按钮/容器布局属于最后一批未清。

**建议方向**：把 `actionBtnHTML` 三处色值迁到 `sm-css.ts`（`.sm-item-btn[data-action="push"]{border:1px solid var(--accent);color:var(--accent)}` 等），`containerHTML` 的布局迁到 `.sm-wrap`/`.sm-status-tabs`/`.sm-summary`/`.sm-list` 类里。`syncDirRowHTML` 的缩进 `padding-left:${indent}px` 是**真动态值**，保留合规。

**处置结果（2026-10-16 已修）**：按建议方向落地，但**弃用建议里的 `[data-action=...]` 属性选择器、改用修饰类**——`legacy` 的 pullHere 按钮与 `optional` 的 pull 按钮**同为 `data-action="pull"`**（`tpl.ts|actionBtnHTML`），属性选择器会把两者染成同色，分辨不出「拉取」与「拉到这里」的语义差。改用 `.sm-item-btn--accent`（missing/diverged→push）/ `--optional`（optional→pull）/ `--muted`（legacy→pullHere）。实际收编范围**比建议更完整**：除 `actionBtnHTML` 三色与 `containerHTML` 整块布局外，还把 `syncDirRowHTML` **与 `itemHTML`** 逐值同款的行内布局（`flex-shrink/flex:1/overflow/text-overflow/white-space/color/font-size`）合并为通用 `.sm-row-status/.sm-row-icon/.sm-row-name/.sm-row-size`（`itemHTML` 原不在审查清单内但属同一违规类）。收编后 `tpl.ts` 仅剩两处**真动态**行内 style：`padding-left:${indent}px`（渲染层按树深算）×2 与 `color:${statusColor}`（按状态取色）。回归锁 `tpl.test.ts`「静态内联 style 收编（P2-1）」4 例（禁止 `flex:`/`flex-shrink:`/`overflow:`/`font-size:` 子串回归、`containerHTML` 零 `style=`），已做突变验证（把一处 span 改回内联 `style="flex:1"` → 红灯）。知识卡 `docs/knowledge/app-sync-manager.md` 的 `sm-css.ts`/`tpl.ts` 两条同步更新。

### P2-2　`renderSyncResultPanel` 的 `escHandler` 是模块级变量，跨组件实例共享
**位置**：`app-sidebar/sync-flow.ts:495-527`。

**问题**：`escHandler` 在模块级声明，`renderSyncResultPanel` 挂 `document.keydown`，`closeSyncResultPanel` 精确移除。若组件**卸载时未关闭面板**（`disconnectedCallback` 未调用 `closeSyncResultPanel`），`escHandler` 永久挂在 `document` 上——`index.ts:303-352` 的 `disconnectedCallback` 清理清单（`_unsubs`/`_syncLock`/`_guard`/`_debounceTimer`/`_cardCleanup`/`_errorCleanup`/`_packDndCleanup`/`_dropdownCleanup`/`_roving`）**没有 `closeSyncResultPanel`**。单实例场景泄漏无感，多实例（未来复用）会串扰。**待验证**：`bindSyncSelected`（sync-flow.ts:592-626）是否在返回的 cleanup 里带了面板关闭。

**根因**：面板 esc 处理没纳入组件的生命周期清理契约（对齐 ADR 的「connected/disconnected 成对」）。

**建议方向**：① `bindSyncSelected` 的返回 cleanup 追加 `closeSyncResultPanel()`；② 或把 `escHandler` 收敛为 `utils/dom/` 原语（如 `bindEscapeToClose`），随组件生命周期注册/注销。

**处置结果（2026-10-16 已修，commit `cff19665b`）**：按建议①落地。`bindSyncSelected` 的 cleanup（现 `frontend/src/views/app-sidebar/sync-flow.ts:131-134`，经 P1-2 五向拆分后位置与语义不变）追加 `closeSyncResultPanel(root)`——该函数**幂等**（`frontend/src/views/app-sidebar/sidebar-result-panel.ts:37-41` 内部 `if (escHandler)` 才 remove），已关面板时调用无害。审查的「**待验证**：`bindSyncSelected` 是否在返回的 cleanup 里带了面板关闭」已确证为**否**（原 cleanup 只 `disposePush()`/`disposePull()`），故本条是**真缺陷**而非误判。链路：`disconnectedCallback` → `_dropdownCleanup` → 该 cleanup（`index.ts:335-337`），卸载即摘掉 `document` 上的 ESC 监听，跨实例复用不再残留旧句柄。建议②（收敛为 `utils/dom/` 原语）未采纳：单点使用，抽原语无收益。回归锁：`frontend/src/views/app-sidebar/app-sidebar.sync.test.ts`「卸载时释放浮层的 document ESC 监听（锐评 P2-2）」——拉取打开浮层后 `unmountElement`，断言卸载过程调用了 `document.removeEventListener("keydown", …)`（app-sidebar 里 document 级 keydown 监听只有浮层这一处，故等价于 cleanup 走到了 `closeSyncResultPanel`）；已做突变验证（注释掉 cleanup 里的 `closeSyncResultPanel(root)` → 红灯 `expected false to be true`）。

### P2-3　`app-sidebar/events.ts:88` `setTimeout(500)` 涟漪复位未持有句柄
**位置**：`app-sidebar/events.ts:88`。

**问题**：`setTimeout(() => hdr.classList.remove("ripple"), 500)` **未保存 timer 句柄**，组件卸载后该 timer 仍会执行并操作已游离的 `hdr`（`hdr` 是从 `card.querySelector` 取的当前节点，节点游离后 `classList.remove` 无害，但**不符合**「计时器须 clear」的仓库纪律）。同类模式在 `app-sync-manager` 已收敛（`renderer.ts` 的 `pendingRaf` 入 state 去重）。

**根因**：涟漪是纯视觉、无害副作用，历史上未纳入计时器治理。

**建议方向**：保存 `hdr._rippleTimer` 或统一走 `utils/animation/` 原语；`disconnectedCallback` 清理。

**处置结果（2026-10-16 已修）**：采纳「保存句柄 + 卸载清理」，但**不选** `hdr._rippleTimer` 挂 DOM 属性（游离节点上的私有属性无人回收，且需再查一次节点才清得到），改挂 **per-root 绑定态 `CardBindState`**（`events.ts` 的 `WeakMap<ShadowRoot, CardBindState>`）新增 `rippleTimer` 字段——该 state 本就跨重绑存活、随 cleanup `bindStates.delete(root)` 一起被回收，是既有的正确容器。点击时先 `clearTimeout(st.rippleTimer)` 再存新句柄（重入不堆积）；`bindCardEvents` 内新增局部 `clearRippleTimer()`，在**两处**调用：① list 被替换的旧监听解绑分支（原 `st.list.removeEventListener(...)` 之后）；② 返回的 cleanup（`disconnectedCallback` 经 `_cardCleanup` 已调用它，`index.ts:335-337`，故卸载路径自动覆盖）。回归锁 `events.test.ts`「涟漪复位计时器持句柄：cleanup（卸载语义）后到点回调不再执行（锐评 FE P2-3）」：点击后有 ripple → `cleanup()` → 等 560ms → **ripple 仍在**（计时器已被 clear，复位回调从未执行）；已做突变验证（删掉 cleanup 里的 `clearRippleTimer()` → 红灯）。原页面行为不变（未卸载时 500ms 后照常复位）。

### P2-4　`sync-flow.ts` 的 `MAX_*` 常量与 `sync.ts` 的 `MAX_ERRORS` 命名/数值两套
**位置**：`sync-flow.ts:42-54` vs `sync.ts:79-81`。

**问题**：`sync.ts` 有 `MAX_ERRORS=3`、`MAX_PACK_ERRORS=2`，`sync-flow.ts` 有 `MAX_TOTAL_ERRORS=5`、`MAX_NAMED_PACKS=3`、`MAX_NAMED_OVERWRITES=3`、`MAX_PANEL_PACK_FILES=8`——**同一推送链路两处截断常量**，语义有重叠（`MAX_PACK_ERRORS` vs `MAX_NAMED_PACKS`）。改一处忘另一处会造成「包级归因被截断」与「结果面板截断」口径不一致。

**根因**：分层边界各自定义，未抽公共常量。

**建议方向**：把两组的截断常量**统一**到一个地方（建议 `features/sync/sync.ts` 导出 `SYNC_LIMITS`，sidebar 引用），或至少加注释交叉引用。

**处置结果（2026-10-16 复核）**：**建议方向不采纳，原判定系误判**。六个数并非「同一推送链路两处截断」的重复，而是**两层不同量纲**的上限：`features/sync/sync.ts:79-81` 的 `MAX_ERRORS=3`/`MAX_PACK_ERRORS=2` 是**单批 `DownloadOutcome` 的收集上限**（控制单次 `downloadMissing` 返回的 `errors`/`packs` 数组长度），`frontend/src/views/app-sidebar/sidebar-push.ts` 的 `MAX_TOTAL_ERRORS=5`/`MAX_NAMED_PACKS=3`/`MAX_NAMED_OVERWRITES=3`/`MAX_PANEL_PACK_FILES=8` 是**跨批归并后的展示层上限**（控制 toast 文案与结果浮层的条目数）。量纲不同：15 个类型各 2 条错误累积 30 条，用单批的 3 条去截会丢归因；反之展示层 5 条截断不影响 features 层契约。语义亦不重叠——`MAX_PACK_ERRORS`（单批内每包错误明细）与 `MAX_NAMED_PACKS`（跨批点名的包数）服务于不同对象。分层设防是刻意的，不存在「改一处忘另一处」的截断口径风险。若仍想提升可读性，可在两处加交叉引用注释（本次未做）。

---

## 4. 已知历史问题核实结论（是否仍在）

| 历史问题 | 现状 |
|---|---|
| `app-sync-manager _init` 无防重入、快速切换 instance 多异步并发、后完成者覆盖先完成者 | **已修**：`index.ts:154` `const gen = this._guard.next()`（ADR-230 唯一出口）+ `:166-172` 的 `stale \|\| !isConnected` 早退 + `:290` stale 判。**但** `_init` 本身**未**用 `busy` 锁防重入——`attributeChangedCallback:99-109` 每次 instance 变更都会 `void this._init()`，若两次变更间隔极短，两个 `_init` 并发，靠 `_guard` 的 `stale` 兜底丢弃过期结果，**行为正确**但**浪费一次 `loadData` IPC**。可接受，无需改。 |
| 原 renderer 全量递归拼串后一次 innerHTML 注入 MMD 上百卡顿 | **已修**：`renderer.ts:245-472` 完整虚拟滚动（定高行 + 窗口化 + padding 撑高 + ResizeObserver + 首帧实测行高），`flattenRows:342-363` 只生成可见窗口行。 |
| 整合包卡片拖拽曾用下标静默指向错误包 | **已修**：`pack-dnd.ts:293-302` 按 `data-name` 解析 + 找不到 `toast(t("inst.packNotFound"))`。**但**侧栏勾选 `getSelected`（sync-flow.ts:149-157）**仍按 `data-idx`**——见 P0-4。 |
| `runPush` 曾报纯成功文案隐藏失败 | **部分修**：文件级→包级归因已加（`PackOutcome`），`showPushToast:323-340` 三分反馈（异常→warn/normal / 仅覆盖→warn/verbose / 全成→success）。**但**类型级超时 `break` 后剩余类型静默丢弃仍在——见 P0-1。 |
| 点击整合包时多组件并发触发 reload 导致重复 IPC/扫描重叠 | **部分修**：sidebar `loadInstances` 有 `_inflight` 在途合并（loader.ts:31） + `scanner` singleflight。**但** `app-sync-manager` 的 `stats:refresh` 订阅直接 `loadData`（`GetInstanceSyncStatus`），**无合并层**，仍会与 sidebar 并发拉同一份数据——见 P1-5。 |

---

## 5. 整体设计评价

| 维度 | 得分 | 一句话理由 |
|---|---|---|
| **组件划分** | **9/10** | `app-sync-manager` 六文件 + `self-type.ts` 编译期对齐 + 事件委托单点构造，是仓内范式范本；~~扣分因 `sync-flow.ts` 626 行六职责混杂~~（P1-2 已五向拆分：`sidebar-select/push/pull/result-panel/shared` + 收敛 145 行的编排入口） |
| **数据流** | **8/10** | bus 命名（`stats:refresh`/`repo:rtype-changed`/`repo:subdir-changed`/`package:selected`/`instance:export-list`/`instance:clear`）全局一致、ADR-340 去总线化（`sync:download:missing` 退役改直调）是亮点；~~扣分因三处同步状态真相分裂（P1-1）~~——P1-1 经复核为误判（三层各管操作契约/跨批归并/状态视图模型）。余下扣分：`stats:refresh` 广播重复刷新（P1-5，接受为广播型设计的固有代价） |
| **渲染范式** | **9/10** | 虚拟滚动实现扎实（定高 + WeakMap 缓存 + 行高实测 + ResizeObserver + padding 撑高）；~~扣分因 tpl.ts 残留成片静态内联 style~~（P2-1 已全量收编进 `sm-css.ts`，仅剩 `padding-left:${indent}px` 与 `color:${statusColor}` 两处真动态值） |
| **异步正确性** | **9/10** | `_guard`/`createLoadGuard` 代际 + per-path `_singleBusy` 防重入 + `withSyncOpTimeout` + `busyLock.tryStart` 原子抢锁 + `finally` 复位，骨架完整；~~扣分因 runPush/runPull 超时丢半结果（P0-1/P0-2）+ `_reload` 尾随补跑丢 force（P0-3）~~——三项均已修（`01391f525`，并加 P2-3 计时器持句柄 `ada475c51`）。余下扣分：P1-4 串行瓶颈属 ADR-056 全局锁架构（接受现状） |
| **可测性** | **9/10** | 测试覆盖很密（每模块均有 .test.ts）；P1-3 复核后 mock 收敛——`*-deps.ts` seam 统一由 `vi.mock("@/backend/app.ts")` 拦截（`app-sync-manager/network.test.ts`/`store.test.ts` 已从 `@/views/backend-deps.ts` 迁入，`036592e87`），12 个 bindings mock 经核实是 node/jsdom 阻断 `@wailsio/runtime` 加载链的**必要护栏**（非绕过 seam），`test-utils/mock-app.ts` 提供 fail-closed 兜底；~~扣分因 `index.test.ts:404` 直接驱动组件私有状态~~——已收口（见下）。余下扣分：`store.test.ts`/`events.test.ts`/`renderer.counts.test.ts` 仍以手造输入直测抽出的模块函数（属正当的模块级单测，非组件私有面耦合） |

**「私有状态耦合」收口（2026-10-16）**：原扣分点 `frontend/src/views/app-sync-manager/index.test.ts:404` 的 `as unknown as { _selectedType; _allItems; _filteredItems; _typeConfig; _dirOpen; _doRender }` 注入**全部 10 处已删除**，改为走生产数据路径——新增 `mountWithItems(type, items)`（写 `localStorage.repo_rtype` 决定 `_selectedType` + `GetInstanceSyncStatus.mockResolvedValueOnce(items)`）与 `clickStatusTab(el, status)`（公开页签点击替代直接写 `_statusFilter`）；`beforeEach` 增清 `repo_rtype`。同款收口另覆盖 `frontend/src/views/app-sync-manager/renderer.virtual.test.ts`（原 `SyncSelfProbe` + `mountWith(n)` 注入五字段 + `_doRender()`，改为 `stats:refresh` 总线事件与页签点击）与 `frontend/src/views/app-sync-manager/a11y.dom.test.ts`（原读 `el._statusFilter` 13 处改为读公开 DOM 事实 `.sm-status-tab[aria-checked="true"]` 的 `data-status`，并删掉未使用的 `SyncSelfProbe` 声明与 `SyncItem` import）。三文件用例数不变（24/8/8）且全绿。

### 最该先做的 1-2 件事（2026-10-16 更新：两条均已完成）

1. ~~**修 P0-1/P0-2 的「超时后静默丢结果」**~~ **已完成**（`01391f525`）：`PushAccum` 增 `timedOut`/`abortedTypes` 并双向点名，`runPull` 把 `withTimeout` 下沉到每类型（新增 `{ kind: "timeout" }` 分支只计超时、不入 both-failed 口径）。
2. ~~**修 P0-3 的 `_reload` 尾随补跑丢 force**~~ **已完成**（`01391f525`）：新增 `_reloadPendingForce`，补跑以 `nextForce` 执行；P1-3 的 mock 旁路亦已收口（`036592e87`）。

### 处置状态总览（2026-10-16）

14 条发现全部有结论，无悬空项。

| 状态 | 条目 | 备注 |
|---|---|---|
| **已修** | P0-1 `01391f525`、P0-2 `01391f525`、P0-3 `01391f525`、P0-4 `01391f525`、P2-1 `8de271547`、P2-2 `cff19665b`、P2-3 `ada475c51` | 前三项即审查自陈的「会持续产生 bug 的结构性缺陷」 |
| **已落地（拆分/收口）** | P1-2 `522d88bfa`（`sync-flow.ts` 五向拆分）、P1-3 `036592e87`（mock 统一到 seam 唯一出口）、P1-5 `3838b8065`（重复刷新——判定为广播型固有代价，附复核记录） | |
| **评分项收口（非条目）** | 「可测性」扣分点 `index.test.ts:404` 私有状态注入——3 个测试文件的私有面耦合已清除（见上方「私有状态耦合收口」） | 可测性 8→9 |
| **评定为误判/接受现状** | P1-1（三处状态分裂——三层各管一类数据，非分裂）、P1-4（串行瓶颈——ADR-056 全局锁架构，非缺陷）、P1-6（`rtypeLabelOf` 中文裸奔——本就走 `resource_types.json` + `t()`）、P2-4（两组 `MAX_*`——两层不同量纲） | 均附代码级证据 |

**复核口径**：P1-1/P1-4/P1-6/P2-4 的原判定在本轮被推翻或降级（审查时未细读对应文件，已在各条目「处置结果」块补证）。两篇锐评的后续引用应以本总览为准。

---

## 附：grep 结论汇总

| 搜索内容 | 范围 | 命中 |
|---|---|---|
| `vi.mock\|backendGetApp\|mockResolvedValue` | `src/views/app-sync-manager` | 68 处（6 个测试文件） |
| 同上 | `src/views/app-sidebar` | 40 处（6 个测试文件） |
| `innerHTML\|outerHTML\|insertAdjacentHTML\|document.write` | `src/features` | 98 处（其中 `features/sync` 0 处、`features/pack-ops` 0 处、`features/dnd/pack-dnd.ts` 0 处；集中命中 `features/dialogs`/`features/community`/`features/maintenance`） |
| `from "@/backend/app.ts"` | `src/features` | 仅出现在 `*-deps.ts`（9 个目录级 seam），生产业务文件 0 命中 |
| `deps?\.\|Deps = {\|Deps: Deps` | `src/features` | 9 处：`recycle-bin.ts:69`、`context-menu-file-handlers.ts:33`、`oldest-models.ts:161` 等（真注入 seam）；`*-deps.ts` 内 0 命中（均纯转发） |
| `inst\.clearMessage\|inst\.exportListCopied` | `src/locales/*` + `src/public/locales/*` | zh-CN/en/ja 三语参数一致（`{name,n,type}` / `{n}`），无缺失 |
| `attachShadow\|shadowRoot\|WebComponentBase` | `src/utils/dom/web-component-base.ts` | 2 处（`:6-7`），确认 `WebComponentBase` 实为 `HTMLElement`，无 Shadow DOM |

> 本报告所有行号以审查时工作区实际文件内容为准；原标「待验证」的四项已于 2026-10-16 全部落实：`SYNC_OP_TIMEOUT_MS` = `frontend/src/features/sync/sync.ts` 的 `SYNC_OP_TIMEOUT_MS`（`withTimeout` 单源）、`rtypeLabelOf`/`shortLabelOf` 支持 en/ja（走 `resource_types.json` → `labelKey` → `t()`）、`bindSyncSelected` cleanup 原**不含**面板关闭（故 P2-2 是真缺陷，已修 `cff19665b`）、`data-idx` 全量迁移改造量评估后**仅收敛读取侧**（`sidebar-select.ts` 一律从 `data-name` 解析；`render.ts` 写 `data-idx` 保留供 `restoreSelectedCard`/roving 消费）。