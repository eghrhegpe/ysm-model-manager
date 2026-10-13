# ADR-335：创作者按站保存改用意图式契约（siteCreators + detachedNames），消除整站替换的跨站连带删除

- **状态**：📝 提议中（Proposed）
- **日期**：2026-10-13
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **准入理由**：前端不再重建全量列表（方向性）；binding 签名与 web 侧同构契约变更（难逆转）；触及 Go/web/前端/契约测试四域（跨域影响面）
- **相关**：ADR-172（社区增量并入下沉 Go — 同族范式）、ADR-053（网页桥边界）、ADR-071（网页版社区能力补齐）、ADR-003（逻辑下沉精神祖先）；`internal/app/app_workshop.go`、`frontend/src/views/app-content/site/edit.ts`、`frontend/src/views/app-content/site/types.ts`、`frontend/src/backend/web-community.ts`

---

## 1. 背景（Context）

<!-- ⚠️ 本节是「决策当时」的状态快照，ADR 落地后此处的病灶可能已治愈；评估「现在是否还这样」以当前源码树 + 知识卡实施进度为准，勿把本节当现状。 -->
当前写时点契约（以源码树为准）：

**Go 侧是「按站整站替换」**：`internal/app/app_workshop.go|SaveWorkshopCreatorsBySite(siteID, siteCreators)` 的执行序是
Load 全量 → **移除 type 分号段含 siteID 的旧条目** → 追加 `siteCreators` → 原子写。

**前端因此必须重建全量列表**：`frontend/src/views/app-content/site/edit.ts|eeBindToolbarBtns` 的保存路径送出的是
`siteCreators`（本站视图内 type 含本站且非空名）与 `state.detachedCreators`（type 已去本站段的跨站条目）的拼接。

`detachedCreators` 的存在理由：多站点创作者（`type:"A;B"`）在 A 站删除时不能整条删除（会让 B 站一并消失），
故删除处理把它改 type 去 A 段、推入待写回列表，保存时併入——这是 `P1-2 跨站点越权` 的补丁。

**失效模式是静默数据丢失**：Go 第二步无差别移除「type 含本站」的全部旧条目。前端只要在任何一条路径上漏掉
detached 条目（漏併、名字为空被过滤、并发编辑导致列表陈旧），仍属他站的创作者就被从磁盘抹掉，且无任何提示。

**边界问题**：前端算出的「siteCreators + detachedCreators」是**写回派生结果**，与 AGENTS.md
「Go 派生结果只读 / 前端只读不判」的边界精神相悖。

**网页版同构**：`frontend/src/backend/web-community.ts|SaveWorkshopCreatorsBySite` 用同一语义在 localStorage
覆盖层实现，`frontend/src/backend/browser-adapter.contract-b2.test.ts` 锁定「只替换指定站点，其他站点保留」。

**同族先例**：ADR-172 已确立修法范式——不为规避跨调用部分提交而把派生搬进 TS，而是**在 Go 补一个恰好表达
意图的原子入口**（`MergeCommunityCreatorsFromJSON`）。本 ADR 沿此范式处理「保存」。

## 2. 决策（Decision）

把 `SaveWorkshopCreatorsBySite` 的第三参从「重建好的条目对象」改为**意图**：

```go
// siteCreators ：本站新增/修改的创作者（type 至少含 siteID）——语义不变，仍是本站的期望集合
// detachedNames：用户在本站删除、但仍属他站（type 另含他站段）的创作者名
func (a *App) SaveWorkshopCreatorsBySite(siteID string, siteCreators []types.WorkshopCreator, detachedNames []string) error
```

Go 侧语义（单次 Load → 变更 → 备份 → 原子写）：

1. Load 磁盘全量；
2. 逐条判定：`type` 不含 siteID → 原样保留；
3. `type` 含 siteID：
   - `name ∈ detachedNames` → **以磁盘副本为基础**去掉 siteID 段；段非空则保留该条目（只改 type，其余字段一字不动），段空则删除；
   - 否则 → 丢弃（若仍属本站，会由 `siteCreators` 重新追加）；
4. 追加 `siteCreators`；
5. 备份 + 单次原子写（`fsutil.WriteFileAtomic`）。

**关键点：解除关联作用在磁盘副本上，不在前端传来的对象上**——于是前端不可能用陈旧副本覆盖条目的其余字段。

前端随之删除 `detachedCreators` 全链：

- `frontend/src/views/app-content/site/types.ts|SiteViewState.detachedCreators`（`LocalCreatorLike[]`）→ 记录**名字**的 `detachedNames: string[]`；
- `frontend/src/views/app-content/site/edit.ts|eeBindCreatorsEdit` 删除处理：不再 `cr.type = joinSiteIds(...)` 改内存对象，只记 name + `splice` + 局部 DOM 移除；
- 保存路径：`SaveWorkshopCreatorsBySite(site.id, siteCreators, state.detachedNames)`，不再拼 `[...siteCreators, ...detached.filter(...)]`；
- 附带修掉一个副作用：今天改 `cr.type` 会污染 `allCreators` 的内存显示（跨站条目在本站编辑期间「少了一站」），新方案不动内存对象。

**名字键的合法性**：`name` 是创作者唯一身份（`frontend/src/features/community/community-data.ts` 的合并语义即按 name 命中），故用 name 定位跨站条目成立。

**优先级约定**：同名同时出现在 `siteCreators` 与 `detachedNames` 时，**以 detachedNames 为准**（用户意图是「从本站解除」），须有回归锁。

网页版 `frontend/src/backend/web-community.ts|SaveWorkshopCreatorsBySite` 同步改签名与语义（localStorage 覆盖层，复用既有 `enqueueMerge` 模块级串行队列防 lost update）。

## 3. 后果（Consequences）

正面：

- **消除跨站静默丢数据**：跨站归属的段级维护由 Go 基于磁盘最新全量计算，前端不再有机会算错或漏传。
- **条目其余字段不可能被前端覆盖**：解除关联作用在磁盘副本上（只改 type 段）。
- **前端不再承担写回派生**：`detachedCreators` 对象列表、保存路径的拼接重建、`types.ts|SiteViewState.detachedCreators` 字段一并删除。
- **与 ADR-172 同范式**：意图入口 + 单次原子写，桌面/网页版同契约名同语义。

负面 / 已知遗留：

- **binding 签名变更**：须 `cd frontend && npm run generate:bindings`（已内置 `-ts`）重生成；网页版同构实现必须同批改，否则网页版「编辑站点 → 保存」与桌面分叉（`browser-adapter.contract-b2.test.ts` 兜底）。
- **存量测试需按新契约改写**：`frontend/src/views/app-content/site/edit.test.ts`（保存过滤 / 删除 / 跨站解除三例）、`frontend/src/backend/browser-adapter.contract-b2.test.ts`、`internal/app/app_workshop_test.go`、网页版契约测试。
- **名字键的边界**：`detachedNames` 只能表达「解除本站」；若将来要表达「连带删除该创作者在本站的编辑」，须另立意图参数（本 ADR 不做）。
- **不动任何页面交互**：磁盘最终状态与旧语义等价（同输入同结果），属**契约重构**而非功能变更——正因如此，回归锁必须断言磁盘状态而非 UI 表象。
- **回滚**：Go / 网页版 / 前端三处同批改，回滚 = revert 该批提交（签名变更是编译期可查的，不会留下半截静默失效）。

## 4. 数据溯源

前端意图（本站期望集合 `siteCreators` + 解除名单 `detachedNames`）
→ `SaveWorkshopCreatorsBySite(siteID, siteCreators, detachedNames)`
→ Load 磁盘全量 → 段级变更（解除作用在磁盘副本）→ `BackupWorkshopCreators` → 单次 `SaveWorkshopCreators` 原子写
→ `frontend/src/views/app-content/site/site-view.ts|renderSiteView` 重渲染读回落盘结果。

网页版同构：bundled JSON 默认 + localStorage 覆盖层，靠模块级串行队列防 lost update（无 Go 原子写）。

## 5. 实施边界（不在本 ADR 范围）

- **预设搜索词侧不在内**：`internal/app/app_workshop.go|SaveWorkshopPresetsBySite` 同样是整数组替换，且 `q` 字段丢失曾是必现数据损坏（见知识卡 `app-content-site` 不变量），独立评估。
- **不做「按 id 增量 upsert」式全面重构**：那会连带改数据模型与合并语义，超出「消除跨站连带删除」的目标。

<!-- 文件名: workshop-creators-intent-save.md → 实际文件 architecture/ADR-335-workshop-creators-intent-save.md（ADR-320 architecture 全量模板） -->
