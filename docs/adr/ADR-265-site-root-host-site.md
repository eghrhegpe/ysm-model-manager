# ADR-265：site 子模块收窄为最小依赖——root 直传 + 定时器登记函数，host 不再进 site 层

- **状态**：已采纳（Accepted）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-17
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`frontend/src/views/app-content/site/workshop-tabs.ts`、`site/workshop-site-opener.ts`、`init-workshop.ts`、`site/workshop-page-state.ts`；ADR-263（前刀：currentSite 下沉 + 「host 拆最小面」遗留的立项）、ADR-264（avatarCache 上收 + 订阅桶工厂形态）、ADR-261（幂等订阅入桶）

---

## 1. 背景（Context）

ADR-263 留下最后一条遗留：`initWorkshopTabs(host, refs, page)` / `bindSiteEvents(host, page)` 仍收整个 `host`——site 层手握 `AppContentState` 全量可达面，可以越界写 `workshopTimer`（事实上 tabs 正是这么写下它的）、读 `workshopCache`、甚至够到 `pagePanels`。ADR-263 §1.1 的原话：「接口宽度即权限」。

A 刀（ADR-264）落地后复核 site 层的真实依赖清单：

| 模块 | 声明的依赖 | 真实用途 |
|------|-----------|---------|
| `workshop-tabs.ts` | `host` | ① `host.state.root` 查 DOM；② `host.state.workshopTimer = setTimeout(...)` 写壳层字段 |
| `workshop-site-opener.ts` | `host` | 仅 `host.state.root` 查 DOM（`openEmbedded` / `bindSiteEvents` 全部查询走 shadow root） |

opener 的 `host` 是**纯过宽**——它从来只需要 root。tabs 的 `host` 有一个真实用途：登记延迟加载定时器。但这个用途**不需要整个 host**，只需要「把定时器交给壳层」这一条通道。

### 1.1 为什么定时器不经 `WorkshopPageState` 下沉

ADR-263 §1.3 已裁定：`workshopTimer` 的清理点在壳层 `_render()` 开头、**必须早于 `page.init`**，且订阅桶刻意没有「切页」清理粒度——搬到页内自清无法等效。定时器的**所有权必须留在壳层**。

但「所有权留壳层」≠「写入权走 host 全量面」。tabs 只需要**创建**定时器并把句柄交出去，壳层负责持有与清理。这是一个单向的、一次性的交接——一个登记函数就够了。

## 2. 决策（Decision）

1. **`openSite(root, site, browseMode, targetUrl)` / `bindSiteEvents(root, page)` / `initWorkshopTabs(root, refs, page, registerDefaultSiteTimer)`**：site 层三入口全部改收 `root: ShadowRoot`，`AppContentHost` 类型不再出现在 site 目录的任何生产文件里（grep 断言：site 层 `import type { AppContentHost }` 零命中）。
2. **定时器登记函数**：`initWorkshopTabs` 第 4 参 `registerDefaultSiteTimer: (t: Timeout) => void`，由 `init-workshop.ts` 提供 `(t) => { host.state.workshopTimer = t; }`。定时器的**所有权、清理点、生命周期**全部不变（仍是壳层 `_render` 开头清 + `cleanupTransient` 兜底），变的只是写入通道——从「host 全量面」收窄为「一个函数参数」。
3. **`WorkshopPageState` 保持不变**：它承载页私有游标（currentSite），与定时器（壳层跨切）分工依旧，ADR-263 §2.3 的「页私有只给工厂不给单例」裁定不受影响。

**拒绝的替代方案**：

- ① **定时器下沉进 `WorkshopPageState`** —— 直接违反 ADR-263 §1.3 的裁定（清理必须早于 init），且把跨切生命周期伪装成页私有，下一个人会以为切页该清它。
- ② **site 层改收 `{ root, state: Pick<AppContentState, "workshopTimer"> }`** —— 用 Pick 收窄仍然传递可变引用，且 `Pick` 类型写法鼓励「以后再 Pick 多一点」的渐进腐化；函数参数交接比对象借用更明确「这是一次性交接，不是持续共享」。
- ③ **维持 host 不动** —— ADR-261→263 一路都在证明：接口宽度即权限，靠自觉守不住边界。

## 3. 后果（Consequences）

**正面**：

- site 层（`workshop-tabs` / `workshop-site-opener`）与 `AppContentHost` 彻底解耦：越界写 `workshopTimer` 之外的任何壳层字段**在 site 层已无可能**——它们手里没有 host 了。
- `workshopTimer` 的写入点从「site 层经 host 直达」收敛为 `init-workshop.ts` 一处 lambda，壳层字段的所有权语义变得显性。
- 测试假 host 大幅简化：不再需要构造 `{ state: { root } }` 的 AppContentHost 形状，直接传真 root。

**负面 / 代价**：

- `initWorkshopTabs` 四参数、其中一个回调——签名变长；但这是「依赖显性化」的合理代价，与 ADR-260 的清理槽注入同构。
- 定时器登记函数是**一次性交接**：若未来需要「取消并重设」，得再扩通道（当前无此需求）。

**已知遗留（本系列收官后无新增）**：

- 无。ADR-261→265 的 `AppContentState` 归位系列至此收口：`currentSite` 下沉（263）、`avatarCache` 上收（264）、`workshopTimer` 留壳 + site 层解耦（265）。

## 4. 数据溯源

- ADR-263 §3「tabs / opener 仍收整个 host……真正的接口级封堵（把 host 拆成 { root } 等最小面）未做，属下一刀」→ 本刀立项。
- site 层真实依赖清单（复核于 ADR-264 落地后）：opener 仅用 `host.state.root`（`workshop-site-opener.ts` 全文 grep）；tabs 用 `host.state.root` + `host.state.workshopTimer` 一处写（:111）。
- ADR-263 §1.3「清理点必须早于 page.init」→ 定时器所有权留壳层的依据；`index.ts:119-123`（`_render` 开头清）与 `state.ts cleanupTransient` 为现状清理点，本刀未动。
- 反证（teeth check，本刀实测）：把 `init-workshop.ts` 登记函数里的 `host.state.workshopTimer = t` 篡改为空 → 「状态装配」用例当场红（断言登记链必须通到壳层字段）。tab 层 4 例在登记被 noop 时仍绿——暴露了 tab 测试不锁登记行为，故断言放在 `init-workshop.test.ts`（装配层，登记链的真正所在）。
- 契约测试：`init-workshop.test.ts`「状态装配」新增两条——site 层首参为 `raw.state.root`（不再 host）+ 登记链通到 `host.state.workshopTimer`；`openSite` 断言首参改 `expect.anything()`（root 身份不锁死，锁的是透传语义）。
- 验证：前端全量 **404 文件 / 6242 例全绿**；`npm run typecheck` 零错误；`npx vite build` 通过；biome（7 个改动文件）通过。
- grep 断言佐证：site 目录生产文件 `import type { AppContentHost }` 零命中（本刀前 2 处）。

<!-- 文件名: site-root-host-site.md → 实际文件 ADR-265-site-root-host-site.md -->
