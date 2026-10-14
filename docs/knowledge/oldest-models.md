---
kind: oldest-models
name: 资历最深模型 oldest-models
tier: architecture
category: feature
source_files:
  - frontend/src/features/maintenance/oldest-models.ts
  - frontend/src/views/app-content/tpl-oldest.ts
auto_fields:
  symbols_with_lines:
    - clearRepoStatsCache
    - loadOldestModel
    - ModelEntry
    - OldestDeps
    - OldestModelHandle
    - renderOldestPage
    - RepoStats
  tests:
    - frontend/src/features/maintenance/oldest-models.test.ts
quick_groups:
  - 模型扫描与仓库管理
quick_intents:
  - 资历最深、老模型、仓库评分
  - 每日推荐、月度活动、热力图、仓库健康
quick_risk_lines:
  - 资历排行必须经 oldest-models.ts 统一计算，禁止各页面各自实现评分逻辑
pitfalls:
  - 各页面各自实现评分 → 结果不一致、排名错乱；必须经 oldest-models 单点
  - bus.emit 未带 payload → 下游无法渲染推荐卡；必须经 bus.emit 携带完整 payload

use_when:
  - 资历最深
  - 老模型
  - 仓库评分
  - 每日推荐
  - 月度活动
  - 热力图
  - 仓库健康
perf:
  - io-bound
invariant_anchors:
  - frontend/src/features/maintenance/oldest-models.ts|bus.emit
status: active
---

# 资历最深模型 oldest-models

## 概览

`oldest-models.ts` 实现仓库页「资历」tab（diagnostics/oldest 页面）的仪表盘：围绕 `ScanModelEntries` 扫描结果做本地统计，渲染四大板块——仓库评分（健康环）、资历最深 Top4（按 `ModTime` 升序）、月度活动热力图（近 12 个月文件数柱状图）、每日推荐（Fisher-Yates 洗牌随机 3 个）。响应全局资源类型切换重新渲染。

## 核心职责

- `loadOldestModel(container, _esc, deps)`：主入口，返回 `{ cleanup, onShow }` 句柄（`_esc` 保留位仅与 views 调用点传参形状兼容，DOM 构建后 textContent 自转义，本函数不再消费）
- 数据获取：`GetRepoRoot(currentType)` 取当前类型仓库根（未配置显示提示），`ScanModelEntriesWithLabel` 取条目列表（`{ Name, Size, Path, Ext, Hash, ModTime }`）
- 仓库评分/禁用/重复统计：统一调 Go `RepoHealthAudit`（与诊断页/CLI health-report 同源单一口径，ADR-143 P1 后 typed 报告 + `parseHealthReport` 运行时校验），**前端不自算评分**；分档走 verdict 单源（`VERDICT_BANDS` verdict→外观映射，verdict 越域才回退分数带 80/60，2026-09 锐评④收尾，与诊断页 health.ts 同构）。**统计失败降级不杀主列表（2026-09 对接锐评②）**：RepoHealthAudit 失败只把统计条渲染为失败提示行（`oldest.statsFailed` + friendlyError 缘由，tpl-oldest 的 `renderStatsBarHtml` stats=null 分支），模型卡片/热力图/推荐不依赖报告照常渲染
- 资历最深：过滤有 `ModTime` 的条目升序取前 4，展示大小/日期/入库天数
- 月度活动：`buildMonthHeatmap` 统计近 12 个月文件数（**DOM 模板与热力图已按 ADR-190 D1a 回迁 `views/app-content/tpl-oldest.ts`**，数据获取/分档留守本文件，经 `deps.renderPage` 注入模板），归一化柱高与分段配色
- 每日推荐：Fisher-Yates 洗牌取前 3 渲染卡片（卡片模板亦在 tpl-oldest.ts）
- 交互：卡片事件委托（命名函数 `handleContainerClick`，重绑前先 remove），点击 `bus.emit("model:select", { path })`；经 `useCurrentResourceType` 订阅类型切换（`repo:rtype-changed` 事件由 repo-rtype.ts 统一消费）后重渲染
- **感知性绑定（2026-09 对接锐评②，对齐 dedup tab P2-2 范式）**：RepoHealthAudit 每次全库读盘+SHA256（go/dedup 无指纹缓存），**隐藏面板的类型切换只记脏账（`dirty` 标志）不扫盘**；补渲染由 `onShow` 在用户切进面板时按需发起——首次激活走懒初始化路径不经 onShow，初始渲染由入口处 `await render()` 承担
- **RepoHealthAudit 结果缓存（锐评性能 #5，2026-10-14）**：`cachedRepoStats` 按 filesRoot 键做模块级 Map 缓存，TTL 30s（对齐 `community-data.ts` 的 `SCAN_LITE_AUTHORS_TTL_MS`）；只缓存不随语言变的字段（score/verdict/计数），`healthLabel` 每次现算（语言热切换不缓存旧文案）。filesRoot 随类型切换变化，天然分键。`stats:refresh`/`tree:reload` 触发 render，TTL 兜底陈旧度。**测试钩子 `clearRepoStatsCache`**（对齐 go/dedup.computeHash 的包级注入范式）清空模块级缓存供用例隔离；测试须在 beforeEach 清缓存 + 每个 `loadOldestModel` 用例 `cleanup()`——`useCurrentResourceType` 订阅残留会让后续 `repo:rtype-changed` emit 触发陈旧回调

## 对外 API / 入口

- 导出：`loadOldestModel(container: HTMLElement, _esc: (s: string) => string, deps?: OldestDeps): Promise<OldestModelHandle>`，句柄 `{ cleanup, onShow }` 对应 bindTabs 懒初始化双形态契约（R8 后状态行零 HTML 字面量：本地 `statusRow()` DOM 构建，整页仍走 `deps.renderPage` 注入；`deps.renderPage` 签名 `(entries, stats | null, statsError?)` 支持统计降级）
- 监听 bus：`repo:rtype-changed`（经 `useCurrentResourceType` 订阅，见 features/repo/repo-rtype.ts）
- 派发 bus：`model:select`
- getApp() 调用：`ScanModelEntriesWithLabel`、`GetRepoRoot`、`RepoHealthAudit`
- 依赖：`renderDisplayName`（utils/dom/display.ts）、`parseHealthReport`（utils/health-report.ts）、`useCurrentResourceType`（features/repo/repo-rtype.ts，替代直接监听 rtype 事件）、DOM 模板 `tpl-oldest.ts`（views/app-content/）

## 与其他子系统关系

- 由 [app_content](./app-content.md) 的 `_bindTabs` 在 oldest tab 首次激活时懒加载，清理函数收进 `_unsubs`
- 条目扫描后端与去重统计口径相关：[go_types](./go-types.md)（ModelEntry）、[go_dedup](./go-dedup.md)（重复判定同样基于 hash）
- 卡片点击后由 [app_preview](./app-preview.md) 展示模型详情
- 健康度配色/字号全走 CSS 变量（`var(--status-success)`/`var(--status-error)`/`var(--tag-amber)` 等），见 [shared_styles](./shared-styles.md) 与主题系统

## 不变量

- 清理函数必须同时 `removeEventListener("click", handleContainerClick)` 与调 `useCurrentResourceType` 返回的 `cleanup()`，二者缺一即泄漏
- 重绑点击监听前先移除旧监听（命名函数引用），防止 render 多次执行导致重复绑定
- 状态行（扫描中/空/错）经 `statusRow()` DOM API 构建、`replaceChildren` 上屏，动态文本 textContent 自转义；显示名过 `renderDisplayName`；`container` 为空直接返回空句柄（`{ cleanup, onShow }` 均为 noop）
- 扫描失败/仓库为空/未配置目录均有对应空态文案，不渲染半成品
- 隐藏面板的类型切换不得触发扫描/体检（感知性绑定）——回归锁见 oldest-models.test.ts「隐藏面板类型切换 → 只记脏账不扫盘」用例；改动渲染触发链时先问「面板不可见时这条链还该不该跑全价 RPC」
- **⚠️ 感知性绑定是【三个】随类型联动面板的共同契约，缺一个就出现两种心智模型（锐评 2026-10-13 P1-2 收口）**：dedup（`init-pages.ts|initDedupTab`）/ oldest-models（本卡）/ recycle-bin（`initRecycleBin`）三个面板都订阅 `useCurrentResourceType` 做类型联动，收口时回收站曾是唯一缺 `container.hidden` 守卫 + `onShow` 补扫的一个——停在「文件树」tab 切类型会在隐藏面板上发 `GetRepoRoot` + `ListRecycleBin` 两次 RPC、写进用户没看的面板、并占用 `guard` 世代（用户切进来看到的不是自己触发的那次结果）。现三者同款 `{ if (container.hidden) { dirty = true; return; } load() }` + `onShow` 按「已呈现类型 ≠ 当前类型」补扫。**新增随 rtype 联动的面板必须同款**，判据：面板不可见时这条链还要不要发 RPC？`initRecycleBin` 的 `container` 形参缺省时视为可见（守卫只在能确知隐藏时生效，不得拦掉首屏加载）；其返回值是**函数兼 handle**（`Object.assign(cleanup, { cleanup, onShow })`）——旧调用点/测试直接当清理函数调、新路径解构取 `onShow`，两种形态并存勿改回裸函数。**派生执法闸（2026-10-14 P1b）**：`tests/test_rtype_panel_perceptual_binding.ts`（引擎 `scripts/_lib/rtype-panel-gate.ts`，同 write-surface-gate 范式）——候选面板从 `useCurrentResourceType(` 调用点自动派生（不手工枚举），每个候选文件须含 hidden 守卫 + onShow 两 token，漏一即红；有意例外进 exemptFiles（带 reason，僵尸条目反查防烂尾）。诚实边界：token 是文件级检查（守卫位置/闭包归属不验，行为正确性归三面板的回归测试）

## 相关

- [app_content](./app-content.md) — tab 懒加载宿主
- [app_preview](./app-preview.md) — 卡片点击后的预览
- [go_dedup](./go-dedup.md) — 重复统计的同源 hash 口径
