# ADR-264：avatarCache 上收 community 层 store + 订阅桶改收工厂堵孤儿订阅

- **状态**：已采纳（Accepted）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-17
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`frontend/src/features/community/creator-avatar-store.ts`、`download-queue-store.ts`、`views/app-content/state.ts`、`init-workshop.ts`、`site/workshop-avatar.ts`、`subscription-bucket.ts`、`init-pages.ts`；ADR-263（前刀：三字段分向裁定，本刀执行其「avatarCache 上收」遗留）、ADR-187 D3（download-queue-store 单例豁免声明，本 store 同构援引）、ADR-261（幂等订阅入桶，本刀修正其 API 形态）、ADR-216（listener-set 原语）

---

## 1. 背景（Context）

ADR-263 裁定 `avatarCache` 方向为「上收」而非下沉，留下两条已知遗留：①本刀（上收）；②tabs/opener 的 `host` 拆最小面（另一刀）。

### 1.1 上收的理由（承 ADR-263 §1.2，此处只述要点）

写入方 `download-queue-store.ts` 是**模块级持久层**——`Events.On("queue:file-done")` 在脚本加载时一次性注册（`_registered` 守卫），下载队列由 Go 侧驱动，**用户离开工坊页后照跑**。`avatar:refresh` 随时可能在任意页面派发。

原借宿 `AppContentState` 的代价：为了不丢增量，工坊页只能把订阅挂进 **global 桶**（`addGlobalOnce`）——人已离开工坊页，回调仍在替页面写数据、甚至触发离屏重渲染。寿命错配的字段就该跟着长寿的那一方走：与 `download-queue-store` 同住 `features/community/`，同寿命、同形态。

### 1.2 顺带发现并修复的缺陷：`add*Once` 的孤儿订阅

上收后跑测试时发现：`init-workshop.test.ts` 中三个 `avatar:refresh` 用例在全文件跑时红、单跑绿——一次 emit 触发 **3 次**处理器。

排查链：订阅注册正常 → 桶内 1 条 → `cleanupAll` 后 0 条残留 → 最终定位：

```
addGlobalOnce("workshop:avatar-refresh", bus.on("avatar:refresh", ...))
```

`bus.on(...)` 在**实参位置被立即求值**。桶的幂等分支 `if (globalKeys.has(key)) return` 挡住了**登记**，却挡不住**订阅已生效**——第二次 `initWorkshopPage`（如「二次 init 幂等」用例、或生产中 lang:changed 重建与组件重建的竞态）造出一个**已挂到 bus 上、但没人持有退订函数、桶也清不掉**的孤儿订阅。每重复 init 一次多一个，emit 时逐个触发。

这**不只是测试假象**：生产中 `initWorkshopPage` 二次调用路径真实存在（组件重挂载、lang:changed 全量重建），每个孤儿订阅 = 多一次冗余 store 写入 + 多一次潜在的离屏重渲染。

**修复**：`addGlobalOnce` / `addPageOnce` 改收**工厂** `() => unsubscribe`，订阅只在 key 真正认领时才创建——孤儿在结构上不可能产生。调用点（`init-workshop.ts` / `init-pages.ts`）同步改为 `() => bus.on(...)`。

## 2. 决策（Decision）

1. **新建 `features/community/creator-avatar-store.ts`**：模块级单例（`STATE` + `subscribeAvatars`/`notify`），形态与 `download-queue-store` 同构，底层复用 ADR-216 的 `createListenerSet` 原语。导出面刻意窄：`getAvatarSnapshot`（活体引用）/ `getAvatar` / `setAvatars`（整表替换）/ `setAvatar`（原地增量）/ `clearAvatars` / `subscribeAvatars`。
2. **模块级单例是有意设计**（援引 ADR-187 D3 的同款裁决）：状态生命周期与 `Events.On` 常驻注册绑定。**与 ADR-263「只给工厂不给单例」不矛盾**——那条规则针对**页私有**状态（怕跨页泄漏）；本 store 是**跨页**状态，单例正是其正确形态。
3. **`AppContentState` 删除 `avatarCache` 字段**。至此三个借宿字段全部归位：`currentSite` 下沉（ADR-263）、`avatarCache` 上收（本刀）、`workshopTimer` 留壳（ADR-263 固化）。
4. **两种写语义刻意不同、勿统一**（契约测试锁定）：
   - `setAvatars` = 整表引用替换（对应批量提取 `avatarCache = avatars` 的既有语义）——替换后旧 ctx 看不到新值，与上收前一致，由「提取后重渲染」兜底；
   - `setAvatar` = 原地增量改写（对应下载完成的单作者增量）——已渲染 ctx 立即可见，单卡片更新不闪整页。
5. **`setAvatars` 空表不覆盖**：`BatchExtractCreatorAvatars` 在「无 .ysm / 无 avatar 目录」时返回空表，那是「这次没提取到」而非「头像都没了」——照单全收会把已知头像抹掉，切回工坊页时卡片全变「?」。
6. **订阅桶 `add*Once` 改收工厂**（§1.2），并加两条回归锁（防孤儿订阅：工厂在幂等分支命中时**不得被调用**）。
7. **工坊页不再在进页时清零头像**（删 `init-workshop.ts` 的 `host.state.avatarCache = {}`）：清零动作会把下载期间累积的增量一并抹掉。

**拒绝的替代方案**：

- ① **avatarCache 继续借宿 + 只把订阅移进 store** —— 只治标：字段寿命仍错配，工坊页仍是「替页面写数据」的错位方。
- ② **store 返回深拷贝快照**（照抄 `getStateSnapshot`）—— 增量写的「已渲染卡片立即更新」依赖活体引用；拷贝会把 `v1.8.10` 修掉的整页闪烁引回来。
- ③ **`add*Once` 保持现成函数形态，只修调用点**（如「先查 key 再 bus.on」）——把防孤儿的责任交给每个调用方的手工纪律；API 层一次修复一劳永逸，且回归锁绑定的是桶的行为而非调用方记忆。
- ④ **给 bus 加「同一 handler 去重」** —— 掩盖问题：孤儿订阅在桶侧不可见，bus 去重会让幂等语义跨 host 泄漏。

## 3. 后果（Consequences）

**正面**：

- `AppContentState` 只剩壳层基础设施 + `workshopTimer`（唯一有意跨切字段）——「借宿」一词从头注释中退役。
- 工坊页不再持有跨页订阅的「跳页令牌」：`avatar:refresh` 回调现在写的是与数据源同寿命的 store，「替页面写数据」的错位消除。
- 孤儿订阅这一整类缺陷在 API 层封死（工厂惰性求值），且两条回归锁防回退。
- 空表守卫堵住「重提取失败抹掉已知头像」的回归路径。

**负面 / 代价**：

- 头像表全局存活、永不清理（与下载队列同寿命）——内存占用与作者数成正比（dataUri 表，量级可接受；与上收前借宿时实际相同，只是语义诚实了）。
- `add*Once` 的调用点必须写 `() => bus.on(...)` 而非 `bus.on(...)`——多一层箭头；写错（直接传现成函数）TypeScript 会拦截（`() => () => void` vs `() => void` 不兼容）。
- `getAvatarSnapshot` 返回活体引用，「只读」是君子协定（与 download-queue 的 `notify` 传引用一致），无类型强制。

**已知遗留（未做，属另一刀）**：

- tabs/opener 的 `host` 拆最小面（ADR-263 §3 遗留 ②，本刀未动）。
- `workshopTimer` 留壳（ADR-263 固化的立场，非缺陷）。

## 4. 数据溯源

- ADR-263 §3「已知遗留」→ 本刀立项。
- 缺陷发现链（实测）：`init-workshop.test.ts` 三用例全文件红/单跑绿 → 探针确认一次 emit 触发 3 次处理器 → 桶清理后残留 0 条（排除「清理失效」）→ `addGlobalOnce` 20 次调用 vs 桶内 1 条 → `bus.on` 实参急切求值 + 幂等分支 return = 孤儿订阅。复现最小化：同 host 二次 init 即可复现（`init-workshop.test.ts`「已有缓存/已注册的 host 二次 init」用例就是天然复现器）。
- 反证（teeth check，本刀实测）：
  - 删 `setAvatars` 空表守卫 → 「空表不覆盖」用例红；
  - 把 `addGlobalOnce` 改回「先求值工厂再判 key」→ 「key 已存在时不调用工厂」用例红；
  - 恢复后 store 11 例 + 桶 8 例 + workshop 16 例全绿。
- 契约测试：`creator-avatar-store.test.ts` 11 例（单源 / 命中未命中 / 通知 / 整表替换 / **空表不覆盖** / 退订 / 清空 / **两种写语义的引用行为** / 活体引用）；`subscription-bucket.test.ts` 8 例（原 6 例迁移到工厂形态 + **新增 2 例防孤儿锁**）。
- 验证：前端全量 6186 例通过（4 个 suite 级 transform 失败均为并行会话 `tpl-settings.ts` 的 `cards` 重复声明 WIP，与本刀无关——该文件不在本刀改动集）；`tsc --noEmit` 仅报同一处并行会话错误；biome 9 个改动文件通过。
- 注：本刀期间未删任何并行会话的 WIP 文件；`init-workshop.test.ts` 的 afterEach 曾存在「手清 `globalUnsubs` 数组绕过 `cleanupAll` → `globalKeys` 未清 → 下一例静默跳过注册」的测试缺陷，已一并修正为 `cleanupAll()`（附注释）。

<!-- 文件名: avatarcache-community-store.md → 实际文件 ADR-264-avatarcache-community-store.md -->
