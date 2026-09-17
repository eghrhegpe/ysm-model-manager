# ADR-263：创意工坊页状态归属：currentSite 下沉、workshopTimer 留壳、avatarCache 上收

- **状态**：已采纳（Accepted）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-17
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`frontend/src/views/app-content/state.ts`、`site/workshop-page-state.ts`、`init-workshop.ts`、`site/workshop-tabs.ts`、`site/workshop-site-opener.ts`、`site/workshop-avatar.ts`、`index.ts`、`features/community/download-queue-store.ts`；ADR-261（同族前刀：幂等订阅入桶，本 ADR 接手其「已知遗留」）、ADR-163（面板常驻化，本 ADR 多处依赖其世代语义）、ADR-260（异步清理入桶）、ADR-091 D22（订阅桶）

---

## 1. 背景（Context）

ADR-261 收尾时留了一条「已知遗留」：`currentSite` / `workshopTimer` / `avatarCache` 仍借宿 `AppContentState`，并判断「真正的下沉需要给这些模块传入页面作用域句柄，另加 `workshopTimer` 存在壳层防御性清理……待专刀评估」。

本刀即那专刀。评估的第一结论是：**三者不该一刀切**——它们只是「住在同一个容器里」，毒性、根因、正确方向各不相同。打包下沉会同时误伤两个不该动的字段。

### 1.1 借宿的真实代价（不是命名不雅，是契约过宽）

| 字段 | 谁写 | 谁读 | 语义归属 |
|------|------|------|----------|
| `currentSite` | `site/workshop-tabs.ts:89` | `site/workshop-site-opener.ts:105,115`、`init-workshop.ts`（注入链读写） | **工坊页私有** |
| `workshopTimer` | `site/workshop-tabs.ts:111` | `index.ts:119-123`（`_render` 开头清）、`state.cleanupTransient()` | **app 壳层跨切** |
| `avatarCache` | `site/workshop-avatar.ts:22`（整表替换）、`init-workshop.ts:171-172`（增量） | `init-workshop.ts` ctx 注入 → `site/*` 渲染链 | **跨页**（写入方是模块级下载队列） |

三个模块（tabs / opener / avatar）拿到的都是**整个 `AppContentState`**。接口宽度即权限：tabs 只需要读写一个站点，却持有了 `root` / `pagePanels` / `resizeMove` / `workshopTimer` 的可达面——而它**确实**顺手写下了 `workshopTimer`（上表第二行即是）。这不是某次手滑，是接口给错了。

⚠️ **收益边界（勿夸大）**：本轮只把**站点游标**收窄进 `WorkshopPageState`——`initWorkshopTabs(host, refs, page)` / `bindSiteEvents(host, page)` **仍收 `host`**（tabs 还要 `host.state.root` 查 DOM 并写 `workshopTimer`），因此「越界写入编译不过」**只对 `currentSite` 成立**：该字段已删，`host.state.currentSite = x` 编译不过，且 `page` 上无其他字段可写。要封死全部越界（含 `workshopTimer`），需把 `host` 一并拆成最小面——属已知遗留，见 §3。

### 1.2 `avatarCache` 的根因：写入方比页面长寿

`init-workshop.ts:168` 用 `addGlobalOnce("workshop:avatar-refresh", …)` 注册；`features/community/download-queue-store.ts:287-288` 的 `_registered` 守卫包住 `Events.On` 组，其中 `queue:file-done` 回调在 `:319-354`、`bus.emit("avatar:refresh")` 在 `:354`——**模块加载时一次性注册**（知识卡 `community-feature.md` 明示「页面切换不丢事件」）。下载队列由 Go 侧驱动，**离页照跑**，`avatar:refresh` 随时可能在非工坊页派发。

因此若把 `avatarCache` 改为「工坊页私有、随页清理」，会产生**静默数据丢失**：进工坊 → 切仓库页看模型（下载仍在跑）→ 期间 5 次 `avatar:refresh` 全部丢弃 → 切回工坊时面板常驻（ADR-163）**init 不重跑**，故既不会重提也不会自愈，用户看到「?」且永不自愈。

⇒ `avatarCache` 的正确方向**不是下沉，是上收**：归到与下载队列同寿命的 community 层 store（`download-queue-store` 已是这个形态：模块级 `STATE` + `subscribe`/`notify`）。

### 1.3 `workshopTimer` 的清理点在壳层，且**必须**早于 `page.init`

`index.ts:119-123` 在 `_render()` **开头**清定时器，`:150` 才 `page.init(this)`。这个次序不是随手写的：`index.ts:43-45` 注释明示那次初始 `nav:changed` 可能早于 `app-content` 加载，面板常驻下切页也不重跑 init——只有「壳层在每次进入渲染时统一清」才覆盖全部进入路径。

若改由工坊页自清，需同时补齐三条：① 页内自订阅 `nav:changed` 清定时器；② 入 `subs.addPage` 兜卸载；③ 处理「尚未 init 就被切走」的窗口。而订阅桶**刻意没有「切页」这一清理粒度**（`subscription-bucket.ts` 文件头 ⚠️：切页清会造僵尸页）。三项齐备才与现状等价，属**净增复杂度**。

⇒ `workshopTimer` 的壳层清理是**有意的跨切生命周期**，非历史债。本 ADR 把它**固化**下来（字段注释 + 契约测试），封死后续「看着碍眼顺手下沉」的路。

## 2. 决策（Decision）

1. **`currentSite` 下沉为工坊页作用域**：新增 `site/workshop-page-state.ts`，导出 `createWorkshopPageState()` 工厂 → `WorkshopPageState { getCurrentSite() / setCurrentSite(site) }`。从 `AppContentState` 删除该字段。
2. **`initWorkshopTabs(host, refs, page)` / `bindSiteEvents(host, page)` 新增页作用域参数**：tabs 与 opener 的站点读写改经 `page`。`init-workshop.ts` 是唯一创建者，负责把**同一实例**下传。**注**：`host` 参数本轮保留（两模块仍需 `root` 查 DOM、tabs 仍需写 `workshopTimer`），故收窄的是「站点游标这一条读写路径」，而非「整个 `AppContentState` 可达面」。
3. **形态对齐 `createWorkshopRefs()`（同因同治）**：只给工厂，**不给模块级单例**。历史教训是「形状相同、实例不同」的 stale 闭包错位，故单源靠调用方共享实例，而非靠模块变量兜底。
4. **`avatarCache` / `workshopTimer` 本刀不动，但把归属写死在字段注释里**并加契约测试：前者标注「跨切：写入方是模块级下载队列，正解是上收 community 层 store」；后者标注「跨切：清理点在壳层且须早于 `page.init`」。

**拒绝的替代方案**：

- ① **三字段一刀全下沉** —— 把 `avatarCache` 随页清理会造出 §1.2 的静默丢失（不可自愈），把 `workshopTimer` 搬进页内则是 §1.3 的净增复杂度。三者方向相反（一个该下沉 / 一个该留壳 / 一个该上收），打包即误伤。
- ② **`avatarCache` 随页下沉 + 订阅仍留 global** —— 订阅活着但读写一个已随页清理的表，等于「回调存在、数据不存在」，比 ①更隐蔽。
- ③ **维持现状，只补注释** —— 注释拦不住越界：`currentSite` 的写入口依旧散在三个模块的 `host.state` 上，无人能把“仅工坊页可写”这条规则变成机制。收窄接口至少让该字段的越界写入编译不过。
- ④ **页作用域用模块级单例**（`let currentSite` + getter/setter 导出）—— 复刻 ADR-261 拒绝过的「模块级变量 + 手工复位」老路，且多实例/测试串扰风险更高。

## 3. 后果（Consequences）

**正面**：

- 工坊页的站点游标有了**名字**（`WorkshopPageState`），且越界写入从「靠自觉」变为「编译不过」。
- `AppContentState` 少一个字段，其头注释从「借宿状态」这一含糊词，改为**逐字段标注归属与理由**——下一个读它的人不必重新考古。
- 两条「跨切」结论被固化进字段注释与测试，堵住「顺手下沉」的回头路。

**负面 / 代价**：

- `init-workshop.ts` 多一个局部变量与三处传参；`WorkshopPageState` 与 `WorkshopRefs` 两个页作用域对象并存，读者需分清分工（refs 收**可替换的整份数据**，page-state 收**页面级游标**）——已在模块头注释写明。
- `currentSite` 的读取从属性访问变为方法调用（`page.getCurrentSite()`），调用点略啰嗦；`backToSite` / `avatar:refresh` 两处改为先取局部再判空，顺带消除重复读取。

**已知遗留（未做，属另一刀）**：
- ~~tabs / opener 仍收整个 `host`~~ → **已由 [ADR-265](./ADR-265-site-root-host-site.md) 落地**：site 层三入口改收 `root: ShadowRoot`，定时器经登记函数交回壳层（所有权与清理点不变）。`AppContentHost` 已从 site 目录生产文件零命中，本条遗留关闭。
- `avatarCache` 借宿 → **已由 [ADR-264](./ADR-264-avatarcache-community-store.md) 落地**：上收为 `features/community/creator-avatar-store.ts`（与 `download-queue-store` 同寿命、同形态），本条遗留关闭。
- `workshopTimer` 仍借宿。本 ADR 的立场是**它就该留在壳层**；若未来订阅桶新增「切页」粒度，可重新评估。

## 4. 数据溯源

- ADR-261 §3「已知遗留」原文 → 本刀立项依据（§1 开篇）。
- `download-queue-store.ts:287-288`（`_registered` 守卫）「一次性注册全部后端事件 / Wails 脚本加载时执行一次，页面切换不受影响」+ `:319-354`（`.ysm` 成功 + `[作者]` 前缀 → `bus.emit("avatar:refresh")`）→ §1.2 结论「写入方比页面长寿」。
- `init-workshop.ts:168` 注册走 `addGlobalOnce`（global 桶）；`subscription-bucket.ts` 文件头「globalUnsubs 连入注册、卸载清除，不随切页清空」+ `cleanupPage()` 注释「**仅** lang:changed 全量重建 / 卸载调用；切页不调」→ §1.2 场景链（切页后订阅仍在、缓存若清则增量丢失）。
- `index.ts:119-123`（`_render` 开头清）早于 `:150`（`page.init`）；`index.ts:43-45` 注释「app-content 经 app-modules.ts 动态加载，可能晚于 app-nav 派发的初始 nav:changed」→ §1.3「清理必须早于 init」结论。
- `subscription-bucket.ts` 文件头 ⚠️「不要在 `_render()` 开头清：……否则 DOM 还在但事件已死（僵尸页）」→ §1.3「桶刻意没有切页粒度」结论，及替代方案 ① 的否决理由。
- 反证（teeth check，本刀实测）：把 `workshop-tabs.ts` 的 `page.setCurrentSite(site)` 篡改为 `setCurrentSite(null)` → `workshop-tabs.test.ts` **4/4 全红**；把 enrich 路径的 `_showSiteView(page.getCurrentSite())` 篡改为渲染快照 `_showSiteView(site)` → 对应用例红。证明新断言绑真实行为而非恒真。
- 契约测试：`site/workshop-page-state.test.ts` 6 例（初始空 / 往返 / 覆盖写 / 置 null 实时可见 / 实例隔离 / 引用身份）；`site/workshop-tabs.test.ts` 4 例（默认站点写入 + 重渲染、tab 点击实时值、`find` 未命中不污染游标、enrich 路径）；`init-pages.test.ts`「AppContentState 字段归属」2 例（`currentSite` 已不在容器内 + 两个跨切字段仍在）。
- 验证：app-content 36 文件 491 例全绿；`npm run typecheck` 通过；`npx vite build` 通过；`check-biome --files`（10 个改动文件）通过。
- 附带捕获（测试价值实证）：本刀重构中 `state.ts` 的 `avatarCache` 字段声明曾被编辑误删，仅剩 JSDoc——`init-pages.test.ts` 的新断言当场转红拦下。若无该断言，此缺失会静默进入构建（该字段只在工坊页路径被读写，其余测试不覆盖）。

<!-- 文件名: currentsite-workshoptimer-avatarcache.md → 实际文件 ADR-263-currentsite-workshoptimer-avatarcache.md -->
