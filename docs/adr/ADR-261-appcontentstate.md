# ADR-261：页面级状态下沉——幂等订阅入桶，退役 AppContentState 页私有字段

- **状态**：已采纳（Accepted）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-17
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`frontend/src/views/app-content/subscription-bucket.ts`、`state.ts`、`init-pages.ts`、`init-workshop.ts`、`index.ts`、ADR-091 D22（订阅桶）、ADR-163（面板常驻化，本 ADR 的世代语义基础）、ADR-260（同族收口：异步清理入桶）

---

## 1. 背景（Context）

`AppContentState`（ADR-091 D22 延伸）从组件抽出的字段里，**混装了两类东西**：

| 类别 | 字段 | 真正归属 |
|------|------|----------|
| app 壳层基础设施 | `root` / `current` / `pagePanels`（ADR-163 面板缓存）/ `resizeMove` / `resizeUp`（预览拖拽） | 协调器 —— 理应留 |
| **页私有状态** | `insListenerReg` / `avatarRefreshRegistered` | 实例页 / 工坊页 —— **借宿** |

**借宿的具体代价**（以两个幂等标志为例）：它们的语义是「监听只注册一次」，但**幂等的重置时机必须与「面板世代」对齐**——`lang:changed` 会 `clearPanels()` 重建全部面板并重跑 init，此时必须允许重新注册。而这些标志住在共享容器里：

- 置位：`init-pages.ts` / `init-workshop.ts`（页面）
- **复位：`index.ts` 的 lang:changed 处理器 + `state.cleanupTransient()`**（协调器）

⇒ 一个页面级不变量的维护点**横跨两处**。任何一方漏改即静默失效：漏复位 → 语言热切换后页面永久失去监听（与 ADR-260 「僵尸页」同族的沉默缺陷：DOM 在、事件不在）；提前复位 → 重复注册双份监听。

**关键前提**：`addPage` / `addGlobal` 只是把退订函数**聚集成数组**，**没有身份**——故调用方无法问「我这个监听是否已注册」，只能各自另开布尔标志。缺的是**幂等原语**，不是更多标志。

## 2. 决策（Decision）

1. **桶提供幂等注册原语**（key 即身份）：
   - `addPageOnce(key, fn)` / `addGlobalOnce(key, fn)`：同 key 在同一生命周内只注册一次。
   - key 集合的寿命**刻意与订阅集合绑定**：`drainPage()` 清 `pageUnsubs` 时一并清 `pageKeys`，`cleanupAll()` 清 `globalUnsubs` 时一并清 `globalKeys`。
2. **世代语义因此自动成立**：lang:changed → `cleanupPage()` → 订阅与 key 同刻清空 → 下一次 init 天然可重新注册。**不需要任何外部复位**，也不存在「漏复位」的窗口——原先必须手工同步的那两处，一处被删除（`index.ts`）、一处被收口（`cleanupTransient`）。
3. **退役两个页私有布尔标志**：`AppContentState.insListenerReg` / `.avatarRefreshRegistered` 从字段表中删除。调用点改为：
   - `init-pages.ts`：`host.subs.addPageOnce("instances:package-selected", bus.on("package:selected", …))`
   - `init-workshop.ts`：`host.subs.addGlobalOnce("workshop:avatar-refresh", bus.on("avatar:refresh", …))`
4. **字段归属校订（一并写进 `state.ts` 头注释）**：`resizeMove` / `resizeUp` 标为 **app 壳层预览拖拽**，**非页私有**——同名共居的假象清除，后续「下沉」不得再误伤它。

**拒绝的替代方案**：
- ① **继续用布尔标志，但把复位收进页面闭包**——闭包随 init 重建，正好能自复位；但幂等需要**跨 init 调用**持存（见下「测试锁定的契约」），闭包变量做不到，除非改用模块级变量（即另一种幽灵状态）。
- ② **删掉守卫**——错。我最初判断「ADR-163 保证同次挂载内 init 只跑一次，故守卫冗余」，被 `app-content.methods.test.ts` 的「initInstancesPage 幂等（33）：二次调用不再注册监听」当场证伪：导出入口被二次调用必须仍幂等（合约存在且被测试锁定）。
- ③ **模块级 `let` + 导出 reset 函数**——把耦合从 state 换成模块，且仍要 `index.ts` 手工调 reset，没解决问题。

## 3. 后果（Consequences）

**正面**：页面级不变量的维护点**从两处收成一处**（桶自持 key，与它已掌管的订阅同寿命）；`AppContentState` 少两个字段；`index.ts` 少一行跨模块复位；幂等能力**可复用**（任何页面/全局订阅均可 `*Once` 而无需自建标志）。语义也更诚实："注册过没有"本就该问订阅表，而不是另开一面旗。

**负面 / 代价**：`addPageOnce` / `addGlobalOnce` 的 key 是**字符串字面量**，拼错即静默退化为「每次都注册」（与不加 Once 等价）——属可接受的弱约束（与 `bus.on` 事件名同级），未引入枚举以避过度设计。

**已知遗留（未下沉，属另一刀）**：`currentSite` / `workshopTimer` / `avatarCache` 仍借宿共享 state，但它们的消费者**跨模块**——`site/workshop-tabs.ts`（读 currentSite、写 workshopTimer）、`site/workshop-site-opener.ts`（读 currentSite）、`site/workshop-avatar.ts`（写 avatarCache）均经 `host.state` 直达。真正的下沉需要给这些模块传入**页面作用域句柄**（`WorkshopPageState`）以替掉整个 `AppContentState`；另加 `workshopTimer` 存在 app 壳层防御性清理（`_render` 开头清，防空跑网络请求），即**有意的跨切生命周期**。待专刀评估。

## 4. 数据溯源


- 2026-09 页面标准化体检：`state.ts` 头注释自述「借宿状态」，且字段维护点横跨 `init-workshop.ts` / `index.ts` / `cleanupTransient` → §1 表。
- 反例（阻止我「删守卫」的错误结论）：`app-content.methods.test.ts:604` 「initInstancesPage 幂等（33）：二次调用不再注册监听」——二次调用（非二次挂载）也必须幂等。
- `subscription-bucket.ts` 的 `addPage` / `addGlobal` 无身份（仅 push 数组）→ §1「缺的是幂等原语」。
- 反证（teeth check）：临时注释 `drainPage` 里的 `pageKeys.clear()` → 新契约测试立即红（`世代重建后必须允许重新注册: expected [] to have length 1 but got 0`），证明该断言绑真实行为而非恒真。
- 契约测试：`subscription-bucket.test.ts` 6 例（幂等 / 不同 key / **世代重置后可再注册** / 清理执行 / 失败不中断）。
- 验证：`typecheck` 通过（唯一报错来自并行会话在 `app-tree-styles.ts` 的未提交 WIP，与本刀无关）/ app-content 32 文件 459 用例全绿。

<!-- 文件名: appcontentstate.md → 实际文件 ADR-261-appcontentstate.md -->
