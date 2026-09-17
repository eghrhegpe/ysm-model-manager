# ADR-260：页面级拆除单源——SubscriptionBucket 收异步清理，退役 repoEventsCleanup 旁路

- **状态**：已采纳（Accepted）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-17
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`frontend/src/views/app-content/subscription-bucket.ts`、`state.ts`、`index.ts`、`init-github.ts`、`init-workshop.ts`、`frontend/src/features/community/show-repo-models.ts`、ADR-163（页面面板常驻化，本 ADR 的清理时机与其绑定）、ADR-091 D22（订阅桶）

---

## 1. 背景（Context）

`app-content` 的页面级拆除此前有**两条通道**，同一件事（页面作用域的资源释放）两套写法：

| 通道 | 类型 | 清理点 | 使用者 |
|------|------|--------|--------|
| `host.subs.addPage(fn)` | `() => void` | 桶：`lang:changed` 全量重建 + 卸载 | 实例页 / 仓库页 / 设置页 / `bindTabs` 懒初始化 |
| `state.repoEventsCleanup` | `() => Promise<void>` | `index.ts|disconnectedCallback` **手工** | github / workshop 两页 |

**成因**：`addPage` 只收同步函数，而仓库视图的事件绑定 cleanup 是**异步**（内含 `queue.cancel` 等）。于是异步清理被迫在共享 `AppContentState` 上开了一个专用字段，并经 `init-github.ts` / `init-workshop.ts` 的 getter/setter 注入 `features/community/show-repo-models.ts`（该 helper 住在 features 层，够不到页面状态，故只能收访问器）。

**代价**：① 同一概念两条路，卸载路径要记得两处都清（`index.ts` 手工 3 行）；② 页面私有状态借宿共享 state 容器；③ `lang:changed` 时该 cleanup **不被立即执行**，而是拖到下次重绑才被 `await` 掉，拆除时机不确定。

**关键事实**：`bindRepoEvents` 绑定的是**页面自己的容器**（github 的 `#gh-results-body` / workshop 的 `searchResults`），不是全局监听——共享槽并非为「防两页各绑一份」而存在，纯粹是注入变通。

## 2. 决策（Decision）

1. **`SubscriptionBucket.addPage` 收异步**：签名放宽为 `(fn: () => void | Promise<void>) => void`；桶内统一 `swallowError(Promise.resolve(fn()))`（同步抛错包成 rejected promise 走同一出口）——**`cleanupPage` / `cleanupAll` 保持同步签名**，异步清理 fire-and-forget，与旧实现的错误语义一致（拆除不得因单项失败中断）。
2. **退役 `state.repoEventsCleanup` 专用字段**及其经两页的 getter/setter 注入链。异步清理不再需要旁路。
3. **清理槽下沉为页内闭包**：`init-github` / `init-workshop` 各持 `let _repoEventsCleanup`（**沿用同文件既有的 `_currentRepo` 闭包范式**），并 `host.subs.addPage(async () => { const p = _repoEventsCleanup; _repoEventsCleanup = null; await p?.(); })` 登记。`showRepoModels` 的**参数形状不变**（仍收「前一次 cleanup 值 + 写回 setter」），只有形参更名为 `prevRepoEventsCleanup`（值口径，避免与退役字段同名混淆）。
4. **不给桶加 keyed 可替换槽**（`setPageCleanup(key, fn)`）：更通用，但当前只有 1 个消费者 → YAGNI。**升级触发条件**：当出现第 2 个「页面级可替换清理」消费者（如另一个共享 helper 需要重绑覆盖旧），再把它提升为桶的一等 API，并把本决策改为引用该 API。
5. **清理时机与 ADR-163 绑定**：页面面板常驻缓存 + 每页 init 只跑一次 ⇒ 页面级清理**不可**在 `_render()` 开头执行（清了会得到「DOM 还在、事件已死」的僵尸页）。本 ADR 与 ADR-259 刀 2 的注释订正同源，正式化了这条约束。

**接受的唯一行为变化**：`lang:changed` 全量重建时，仓库视图 cleanup 由「拖到下次重绑才执行」变为**随桶立即执行**。新行为更确定（拆除与面板清除同拍、不留悬空监听），须由测试覆盖。

**拒绝的替代方案**：① 保持两条通道——同一概念两个出口，卸载需双清；② 把 `showRepoModels` 挪进 app-content 层以省掉注入——越层丑于注入，且 helper 本属 features；③ 让桶内 await 所有清理再返回——会改 `cleanupPage` 为 async，波及全部调用点与卸载路径，收益不抵风险。

## 3. 后果（Consequences）

**正面**：页面级拆除单源（`host.subs.addPage` 一条路）；`AppContentState` 少一个专用字段、头注释不再需要「异步清理」分组；`index.ts` 卸载路径减 3 行手工清理；`lang:changed` 拆除时机变确定；测试断言从「戳内部槽」升级为**行为口径**（重绑清旧 / 桶清理即拆除），并在反证中验明有牙。

**负面 / 代价**：桶的 `pageUnsubs` 元素类型变宽（`() => void | Promise<void>`）；异步清理的完成时刻仍不可 await（fire-and-forget，与旧实现同），需要「确保完成」的场景不能用它。

**已知遗留**：`showRepoModels` 的参数仍需两个访问器（getter/setter 对）——若第 2 个消费者出现，按 §2.4 升级为 keyed 槽；页私有状态（`currentSite` / `workshopCache` / `workshopTimer` 等 7 个字段）仍借宿共享 state，属另一刀（页状态下沉），本 ADR 未涉。

## 4. 数据溯源

- 2026-09 页面标准化体检：`grep repoEventsCleanup` 显示同一概念两条通道 → §1 表。
- `subscription-bucket.ts:27`（`addPage(fn: () => void)`）+ `index.ts:116-119`（手工清理）+ `init-github.ts:42,299-301` / `init-workshop.ts:108-110`（注入链）→ §1「成因」。
- `features/community/show-repo-models.ts:76-79,155-157,197`（消费访问器；重绑前 await 旧 cleanup）→ §2.3 参数形状保持不变。
- `init-github.ts:292`（`let _currentRepo` + getter/setter 闭包范式）→ §2.3「沿用既有范式」。
- 反证（teeth check）：临时断开 `init-github.ts` 的 `host.subs.addPage(...)` 登记 → `init-github.test.ts` 立即红（`桶清理应执行最新登记的 repo 事件 cleanup`），证明新断言绑定真实接线而非恒真。
- 验证：typecheck 0 错 / 全量单测 397 文件 6186 用例 / 完整 e2e 58 项（真实 Chromium）/ biome 变更文件通过。

<!-- 文件名: subscriptionbucket-repoeventscleanup.md → 实际文件 ADR-260-subscriptionbucket-repoeventscleanup.md -->
