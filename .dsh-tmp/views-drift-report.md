# Views 域脱节锐评（子代理 A）

## 总判（≤80 字）
本轮 2 处硬伤：`app_content_site.md` 漏了站点 JSON 导入下沉 Go 的架构迁移（P1）；`app-sync-manager.md` 列了新符号却没解释容器级委托替换逐元素绑定的架构动机（P2）。其余 6 文件纯 bug fix，无语义脱节。

## 逐文件锐评

### `frontend/src/views/app-content/site/edit.ts`
- 改动：`71d5c52a` — 社区站点并入从 TS `mergeCommunitySites` + `SaveWorkshopSites(allSites)` 改为 Go `MergeCommunitySitesFromJSON`，前端仅做内存展示层合并（ADR-172 对称收口）。
- 对应卡：`app_content_site.md`
- 卡现状：卡正文只提"site 拖拽排序未回写 workshop-data"的 pitfall（这是指卡片重排，非 JSON 导入），对 JSON 导入路径**完全沉默**。源码已下沉 Go，卡却未提 `MergeCommunitySitesFromJSON` 绑定。
- 严重度：**P1**
- 建议：卡 `app_content_site.md` 的"核心职责"或"不变量"§ 补一段："站点 JSON 导入（edit.ts eeBindFetchBtn / drag.ts dropZone）已收口 Go `MergeCommunitySitesFromJSON` / `MergeWorkshopSitesFromJSON`——前端不再 `SaveWorkshopSites(allSites)` 整存，计数以 Go 返回为准（ADR-172）。"

### `frontend/src/views/app-content/site/drag.ts`
- 改动：`0d454160` — 站点 JSON 拖入导入从 TS 合并 + `SaveWorkshopSites` 改为 Go `MergeWorkshopSitesFromJSON` + `DefaultWorkshopSites` 刷新内存。
- 对应卡：`app_content_site.md`
- 卡现状：同上。卡把 drag.ts 的两种行为（JSON 导入 / 卡片重排）混为一谈，只提重排 pitfall，漏了 JSON 导入已下沉 Go。
- 严重度：**P1**（与 edit.ts 同卡同问题，合并计 1 处）
- 建议：同上。

### `frontend/src/views/app-content/workshop-tabs.ts`
- 改动：`1cd8e305` — 修 `(e as Error)?.message || t(...)` 运算符优先级 bug（`||` 绑定比 `+` 松），纯 bug fix。
- 对应卡：`app-content.md`
- 卡现状：卡只列了文件，无行为断言。
- 严重度：**无脱节**

### `frontend/src/views/app-tree/index.ts`
- 改动：`a46e1b06` — 方向键导航 selectSingle 前捕获 oldKey 清旧行高亮，修连续 ArrowDown 多行同时 selected 的 bug。
- 对应卡：`app-tree.md`
- 卡现状：卡提了"方向键导航（P2 观察）"但未描述高亮机制，无行为断言被违反。
- 严重度：**无脱节**

### `frontend/src/views/app-content/diagnostics/perf-cli.ts`
- 改动：`31c95b3d` — `perfCopyBound` 模块级 boolean 改为 `WeakSet<Element>` 按容器归属跟踪，修面板重建（lang:changed）后复制按钮失效 bug。
- 对应卡：`app_content_diagnostics.md`
- 卡现状：卡只列了 `bindPerfCopyHandlers` 符号，未描述绑定机制。
- 严重度：**无脱节**

### `frontend/src/views/app-sync-manager/events.ts`
- 改动：`c6ccfc77` — **架构级**：`bindEvents`（逐元素绑定，每次 render 后 .then 全量重绑）→ `bindDelegatedEvents`（一次性容器级委托，render 重建无需重绑，消除并发 _doRender 双绑竞态）。`04cce754` 补 btn 分支 `e.stopPropagation()` 恢复对等性。
- 对应卡：`app-sync-manager.md`
- 卡现状：symbols_with_lines 已列 `bindDelegatedEvents`（新符号命中），但**正文完全没解释架构动机**：旧逐元素绑定为何被淘汰、双绑竞态是什么、容器级委托为何 render 安全。卡读起来像"一直如此"。
- 严重度：**P2**
- 建议：卡 `app-sync-manager.md` 的"核心职责"或"不变量"§ 补一句："`bindDelegatedEvents` 在 `_init` 一次性绑定于组件根（light DOM），render 重建 DOM 不影响委托——消除原 `bindEvents` 每次 render 后重绑导致的并发双绑竞态（目录行点一次=翻转两次）。"

### `frontend/src/views/app-sync-manager/index.ts`
- 改动：`c6ccfc77` — `_doRender` 不再 `.then(bindEvents)`，事件绑定移至 `_init` 一次性委托。
- 对应卡：`app-sync-manager.md`
- 卡现状：同上。卡描述了 `_doRender` 是"渲染统一入口"，但未说明它**不再负责事件绑定**。
- 严重度：**P2**（与 events.ts 同卡同问题）
- 建议：同上。

### `frontend/src/views/app-tree/toolbar-events.ts`
- 改动：`9ae21456` — `ImportByType` 从 `const err = await ...; if(err)` 改为 `try/catch`（Go binding 失败走 reject，旧 string 签名判错残留）。
- 对应卡：`toolbar-search.md` / `search.md`
- 卡现状：卡只列了文件，未描述 `ImportByType` 调用模式。
- 严重度：**无脱节**

## 汇总脱节清单

| 严重度 | 卡 | 一句话问题 |
|---|---|---|
| P1 | `app_content_site.md` | 站点 JSON 导入（edit.ts / drag.ts）已下沉 Go `MergeCommunitySitesFromJSON` / `MergeWorkshopSitesFromJSON`，卡未提此架构迁移，仍暗示前端整存 |
| P2 | `app-sync-manager.md` | 已列 `bindDelegatedEvents` 符号，但未解释从逐元素 `bindEvents` → 容器级委托的架构动机（双绑竞态） |

## 缺口提示
- `app_content_site.md` 完全未覆盖 `edit.ts` 的"社区站点 JSON 导入"行为（只覆盖卡片重排），新开发者读卡会误以为前端仍做 merge+save。

## 给主模型的 3 处最强断言（供抽查）
1. 「卡 `app_content_site.md` 的 pitfall 只提"site 拖拽排序未回写 workshop-data"，但 `71d5c52a` / `0d454160` 之后 edit.ts 和 drag.ts 的 JSON 导入已下沉 Go 绑定，卡对此完全沉默——归属层脱节。」
2. 「卡 `app-sync-manager.md` 的 symbols_with_lines 已列 `bindDelegatedEvents`（新符号），但正文未解释 `c6ccfc77` 的架构迁移：旧 `bindEvents` 每次 render 后重绑导致并发双键竞态（目录行点一次=翻转两次），新方案是一次性容器级委托——动机层脱节。」
3. 「`wails-bindings.md` 已正确列出 `MergeCommunitySitesFromJSON` / `MergeWorkshopSitesFromJSON`（line 87/89），说明绑定层维护及时，但上层业务卡（app_content_site）未同步引用——跨卡断链。」
