# ADR-341：busy 语义归一——互斥锁唯一形态 BusyLock

- **状态**：✅ 已采纳（Accepted）
- **日期**：2026-10-14
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **准入理由**：全仓六族 busy 守卫语义并存，手写三段式分散于 9 处入口，归一为原语属跨域纪律决策
- **相关**：`frontend/src/utils/base/primitives/lock.ts`（唯一形态）、`features/dnd/{import-dnd,pack-dnd}.ts`、`features/maintenance/recycle-bin.ts`、`views/app-sidebar/{index,sync-flow,launcher-detect,events}.ts`、`views/app-tree/{index,events,bus-handlers}.ts`、`views/app-content/{settings/store.ts,diagnostics/{conflicts,health}.ts}`；前序 [ADR-340](./ADR-340-sync-push-direct-call.md)

---

## 1. 背景（Context）

<!-- ⚠️ 本节是「决策当时」的状态快照，ADR 落地后此处的病灶可能已治愈；评估「现在是否还这样」以当前源码树 + 知识卡实施进度为准，勿把本节当现状。 -->

锐评 P2-2 对账（2026-10-14，全部经当前源码树 grep 复核）：全仓「异步入口防重入/互斥」存在六族并存——

1. **抢锁式** `BusyLock {tryStart/finish}` + `withLock`（`utils/base/primitives/lock.ts`）：sync.ts 双锁、context-menu 三 verb——**机制化，抛错必释放**；
2. **布尔包装式** `withBusy→boolean`（`settings/store.ts`）：模块级裸 `let busy` 手写三段，签名与 BusyLock 同构但自成一派，且 `resetSettingsStore` 靠外部纪律复位；
3. **查询式三件套** `{isBusy/setBusy}` 状态对：import-dnd `handleTreeDrop`、pack-dnd `PackDndBusy`、recycle-bin `getEmptyBusy/setEmptyBusy`、launcher-detect `BusyGuard`（getBusy/setBusy）、app-sidebar `SyncBusyFlag`（get/set）——检查与置位**分离**，调用方自行保证「先查后置」；其中 recycle-bin 病发实证：`getEmptyBusy()` 检查在 `modalConfirm` **之前**、`setBusy(true)` 在确认**之后**，确认框打开期间的连点全部通过检查 → 多个确认框叠挂、双双放行清空 RPC；
4. **手写布尔守卫**：conflicts `diagSyncBusy`、health `_healthBusy`、app-tree `_toggleBusy/_batchBusy`（组件双布尔互查）——「检查+置忙+finally 复位」三段样板各处重抄，忘 finally 即永久锁死（module-global-state 卡红线专防此疾）；
5. **per-key 在途集合** `Set<string>`：import executor `inFlight`（name+size+lastModified 指纹）、sync-manager `_singleBusy`（按 path）——键粒度防重入，异键可并发；
6. **状态机字段**：preview switch `inFlight`（已并入 "switching" 代际态）、dedup `state.busy`（与 pendingType 补扫记账耦合）。

族 1-4 语义同源（单资源互斥），形态却四种；每新增一个异步入口都要在「查哪族」上再做一次自由选择——这正是 ADR-340 反思的「同一问题多套心智模型」在并发守卫维度的再现。

## 2. 决策（Decision）

**互斥类 busy（族 1-4）全部归一到 `BusyLock` 一种形态**：

- `BusyLock` 增补 `isBusy(): boolean` 读面（UI 高亮层需要查询，如 bindTreeDnD 的 drop hint），保持「抢锁 tryStart / 释放 finish / 查询 isBusy」三面一体；
- 手写三段一律改 `tryStart()` 单步原子抢锁（检查与置位合并，杜绝竞态窗口）；能整体包锁的走 `withLock`，跨回调生命周期（如 app-tree 乐观更新链在 `.finally` 释放）走显式 `tryStart/finish`；
- 各族本地接口（`PackDndBusy`/`BusyGuard`/`SyncBusyFlag`/`{getEmptyBusy,setEmptyBusy}` 对）退役，签名直接吃 `BusyLock`；`settings/store.ts|withBusy` 保留对外签名（返回是否获得锁），内核换 BusyLock，`resetSettingsStore` 的复位走 `finish()`；
- app-tree 双布尔 `_toggleBusy/_batchBusy` 收敛为单锁——两族互查（A 在途拦 B、B 在途拦 A）在互斥语义下本就是「一把锁两个名字」；
- **豁免不改（族 5/6）**：per-key 在途集合与互斥锁是天然异质语义（「同一资源在途」≠「整个入口在途」，强并把不同文件/行的并发请求误伤成串行）；状态机字段是代际守卫的分体，归并低 ROI。豁免边界写进 `lock.ts` 头注与知识卡，作为判据而非空洞。

**判据口诀**：问「挡的是不是同一个临界区」——是，则 BusyLock；挡的是「每个 key 各自一份在途」，则 Set；挡的是「本代际是否切换中」，则是状态机字段，不混。

## 3. 后果（Consequences）

- **正面**：「带不带守卫、锁何时释放」从每题必答的开放题变成原语默认；recycle-bin 连点双确认框竞态被结构性堵死（tryStart 在弹框前占用，取消路径 finally 释放）；module-global-state 卡的「模块级 busy 须有 reset 路径」红线覆盖面收窄到豁免族；新增异步入口只需知道 BusyLock 一件事。
- **成本**：约 15 个生产文件 + 10 个测试文件的同族机械迁移；app-tree 锁并入单锁后，原「toggle 与 batch 各自可观测」的测试替身改为锁句柄断言。
- **已知遗留**：`isBusy()` 读面只服务 UI 查询，不得用于「查了再抢」两段式（一律 tryStart）；dedup/switch 状态机字段维持现状，若未来第三族状态再现再议。

## 4. 数据溯源

- 六族现场：`frontend/src/utils/base/primitives/lock.ts`（族1）、`views/app-content/settings/store.ts`（族2）、`features/dnd/{import-dnd,pack-dnd}.ts`、`features/maintenance/recycle-bin.ts`、`views/app-sidebar/{launcher-detect,sync-flow,index}.ts`（族3）、`views/app-content/diagnostics/{conflicts,health}.ts`、`views/app-tree/{index,events,bus-handlers}.ts`（族4）、`features/import/executor.ts`、`views/app-sync-manager/network.ts`（族5）、`preview-3d/adapters/switch-preview.ts`、`views/app-content/diagnostics/dedup.ts`（族6）。
- recycle-bin 竞态证据：`recycle-bin.ts|onRecycleEmptyClick` 检查-确认-置位三步分离（族3 查询式的结构性缺口）。
- 互查证据：`events.ts`「toggleBusy || batchBusy」双向互拦 = 单临界区两布尔。

<!-- 文件名: busy-lock-unification.md → 实际文件 architecture/ADR-341-busy-lock-unification.md（ADR-320 architecture 全量模板） -->
