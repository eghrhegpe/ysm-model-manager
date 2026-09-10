# ADR-223：社区索引数据层北迁 features/community 与导航焦点跨视图传递范式

- **状态**：✅ 已采纳
- **日期**：2026-09-10
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：ADR-190（features→backend seam）、ADR-163（tab-panel 常驻化）、ADR-040（≤400 行红线）、ADR-146（路径别名）

---

## 1. 背景（Context）

锐评 `frontend/src/views` 时定位两处结构性病灶：

1. **社区索引数据层 split-brain**：`views/app-content/community-data.ts`（414 行，自报"创意工坊纯数据层"——站点/创作者/作者索引拉取与合并、缓存失效）与 `features/community/`（19 文件同域业务：下载队列、事件、渲染、模型列表 `data.ts`）劈成两半。更刺眼的是 `app-tree/bus-handlers.ts` 动态 import `@/views/app-content/community-data.ts`——树视图伸手进内容视图口袋取数据，视图之间长出藤蔓。

2. **导航焦点跨视图传递走 DOM 穿透**：`app-nav/index.ts` 的 `_focusRepoSearch` 挖穿 `app-content.shadowRoot.querySelector("app-tree").shadowRoot` 两层 shadow root，外加 25ms×20 渐进轮询。ADR-163 常驻面板下复用节点不重挂 → `connectedCallback` 不重跑，正是轮询存在的根因。项目自身约定"跨 Shadow 边界用 `bus.emit`，不靠 DOM 透传"，此路径违约。

## 2. 决策（Decision）

### 2.1 社区索引数据层北迁 features/community

- `views/app-content/community-data.ts` → `features/community/community-data.ts`（与既有 `data.ts`——模型列表拉取+进度条——**关注点不同，无语义撞**，保留文件名零 churn）。
- 绑定获取从 `import { getApp } from "@/backend/app.ts"` 切换到 **`community-deps.ts` 注入 seam**（`communityGetApp()`），与 `events.ts` / `show-repo-models.ts` / `download-queue.ts` 同款——合规 ADR-190 D2 features→backend seam（`check-layering` R5 兜底）。
- 类型 import `../../../bindings/...` → `../../bindings/...`（features/community→src 两跳，R3 内）。
- 消费方（index/init-workshop/workshop-tabs/site-edit/app-tree bus-handlers）import 改 `@/features/community/community-data.ts`；**斩断 app-tree→app-content 跨视图藤**。

### 2.2 导航焦点走 bus + 一次性 pending flag

- 新 `utils/dom/focus-pending.ts`：`setRepoSearchFocusPending(v)` / `takeRepoSearchFocusPending()`（take 即清，一次性）。
- `bus.ts` 增 `"repo:focus-search": void`（同步 `VOID_EVENTS` 双向编译期校验）。
- `app-tree`：加 public `focusSearch()` 方法（复用 `_onKeyFind` 的 focus/select 体，DRY）；`bus-handlers` 监听 `repo:focus-search` → `vm.focusSearch()` + `takeRepoSearchFocusPending()` 清残；`connectedCallback` 末尾 `if (takeRepoSearchFocusPending()) this.focusSearch()` 消费未挂载期积压的请求。
- `app-nav`：repository 激活 → `setRepoSearchFocusPending(true) + bus.emit("repo:focus-search")`；非 repository → `setRepoSearchFocusPending(false)`。删 `_focusRepoSearch`、`_focusTimer` 与 25ms 轮询。

**时序覆盖**：树已挂（常驻面板）→ 事件直达 listener → focus；树未挂（首访/动态 import 竞态）→ flag 留存 → `connectedCallback` 取走 → focus。两路径都 take 清 flag，无泄漏、无轮询、无 shadow root 穿透。

## 3. 后果（Consequences）

- **正面**：斩断 views 内部跨视图依赖藤；社区域数据层与功能层归一处；nav 不再穿透 shadow root、不再轮询；新增 void 事件经 bus 契约双向校验兜底。
- **负面/遗留**：`focus-pending.ts` 是单例模块级状态（一次性 take 语义保证不积压，但跨测试用例需 `beforeEach` 清）；`repo:focus-search` 事件名进入 bus 契约表，`locales-consistency`/bus 契约测试自动覆盖。
- **非目标**：`state.ts` 的 setter 形式主义本轮不治——setter 实为 view→feature 注入 seam（`show-repo-models.ts` 取 `setRepoEventsCleanup`/`setCurrentSite` 作回调），删之波及 feature 签名与测试桩，ROI 低，单独立项。

## 4. 数据溯源

- 来源：`views/app-content/community-data.ts`（414 行）、`views/app-nav/index.ts:339-355`（`_focusRepoSearch` 轮询）、`views/app-tree/bus-handlers.ts:265`（跨视图动态 import）。
- 结果：`features/community/community-data.ts`（经 `community-deps` seam）、`utils/dom/focus-pending.ts`、`bus.ts` 增 `repo:focus-search`、`app-tree.focusSearch()`。
