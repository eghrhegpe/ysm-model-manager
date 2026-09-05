# features 层收束重构方案（ADR-190 配套）

> 决策依据见 [ADR-190](../adr/ADR-190-features-deps-convergence.md)。本文件只记**分步动作与行号**，不重复决策理由。
> 所有行号于 2026-09-05 以 `sed`/`grep` 逐条复核；审计初稿中的 4 处偏移已在本文修正（见 §5 勘误）。
> **状态：待拍板，未开工。**

## 1. 目标与边界

| 项 | 内容 |
|---|---|
| 目标 | `features/` 回归「交互编排」单一职责；依赖注入由化石变真机制；抽象抽全 |
| 范围 | `frontend/src/features/**`（7976 行源码 / 8 子目录）＋ `views/app-content/init-github.ts` 单点 |
| 不在范围 | `community` 双渲染流水线迁移、下载队列状态机重构、`RESOURCE_TYPES` 全量收窄（详见 ADR-190 §3 已知遗留） |
| 门禁 | 每步结束跑：`cd frontend && npx vite build && npm run typecheck`；`node scripts/check-biome.ts`；相关 `*.test.ts` |

---

## 2. P0 — 止血（可独立提交，建议先做）

| # | 文件:行号 | 现状 | 改法 | 验收 |
|---|---|---|---|---|
| P0-1 | `maintenance/recycle-bin.ts:94` | `await _modalConfirm(...)` 之后**无失效判断**；cleanup 已于 `:297` 跑 `guard.invalidate()`，正在执行的 onclick 闭包仍继续走 `:105-108` 的 `loadRecycleBin()` + toast + bus 副作用 | `setupRecycleActions` 增加 `guard: LoadGuard` 参数；onclick 开头 `const opGen = guard.next()`，确认框 await 后、binding await 后、catch 三处各加 `guard.stale(opGen)` 检查 | 新增集成测试 2 例（确认框期 cleanup / binding 期 cleanup）✅ 已落地，24/24 通过 |
| ~~P0-2~~ | ~~`maintenance/recycle-bin.ts:237-239`~~ | ~~赋值竞态~~ | **复核后撤销（2026-09-05）**：`:226` 的 `guard.stale(gen)` 检查到 `:239` 赋值之间为同步段，单线程下 cleanup 无法插入，竞态不成立。原指控属审计误报 | — |
| P0-3 | `community/render.ts:197` `renderModelList`、`:251` `renderCardsHTML` | 生产侧**零引用**（`grep` 排除测试后仅命中定义与注释）→ 死代码 | 删除两函数及 `:113`、`:230` 的相关注释；同步删除对应测试 | `npm run typecheck` 无未使用告警；`community/render.test.ts` 精简后通过 |
| P0-4 | `views/app-content/init-github.ts:11,147` | 使用 `stripBanSuffix`，而 `features/community/show-repo-models.ts:83` 用 `stripDisableSuffix`。经复核 `utils/dom/display.ts:18-19` 确认前者是后者的 **deprecated 别名**，语义相同（**非逻辑漂移**） | 仅替换调用点：`import` 与 `:147` 改用 `stripDisableSuffix`。**别名本身保留**（源码注释明示「保留别名防外部断链」） | `npx vite build` 通过；社区页模型名展示不变 |

> P0 四项互不依赖，可一次提交或分四次。总改动预计 < 60 行。
>
> **执行状态（2026-09-05）**：P0-1 / P0-3 / P0-4 已完成并验证（vite build ✅、受影响 3 套件 60/60 ✅、biome ✅；全仓 typecheck 因并行会话的 `preview-3d/` 半成品暂挂，错误不在本次改动文件）；P0-2 撤销（见上表）。

---

## 3. P1 — 抽象收全（低风险，收益最高）

| # | 文件:行号 | 现状 | 改法 |
|---|---|---|---|
| P1-1 | `dialogs/modal-core.ts:186-195` | `createDialog` 声明 `title: string` / `icon?: string`，但 `:195` 解构只取 `width, tabIndex, cancelValue, resolve, closable, buildBox`，**两个参数从未使用** | **启用**：在 `appendDialogBox` 之后由 `createDialog` 统一渲染标题行与图标（含 `esc()`），返回结构不变 |
| P1-2 | `dialogs/modal-confirm.ts:36`、`modal-prompt.ts:27`、`modal-select.ts:26-30`、`modal-picker.ts:101`、`modal-progress.ts:47` | 5 个 builder 各自重复渲染标题行（其中 `modal-select.ts:26-43` 用字符串 `+` 拼接，风格还与其余不一致） | 删除 5 处重复标题模板，改为向 `createDialog` 传 `title`（`icon` 按需）；顺带统一 `modal-select.ts` 为模板串风格 |
| P1-3 | `dialogs/rename.ts:21-29`、`adv-filter.ts:176-181`、`tag-editor.ts:94-98`、`batch-rename.ts:236-239` | 4 个业务弹窗绕开 `createDialog`，各写 overlay 六步：`createElement → tabIndex → className → role → aria-modal → onclick`（`adv-filter.ts:176-181` 与 `tag-editor.ts:94-98` 逐行同构） | 改为调用 `createDialog`，仅保留各自 `buildBox`。**注意 `rename.ts:24` 注释已自承「与 modal.ts/adv-filter/batch-rename/tag-editor 自建 overlay 同规」，一并更新** |

> P1-3 涉及 4 个业务弹窗的可见行为（动画/焦点/ESC），建议**逐个提交、逐个手工验证**，不合并成一次大改。
>
> **执行状态（2026-09-05）**：P1-1 / P1-2 / P1-3 已完成并验证（dialogs 全套件 171/171 ✅、vite build ✅[当日]、biome 无新增债）。
> - P1-1 落地形态：`createDialog` 新增 `titleExtra`（标题行内自定义节点，rename 的「读取头部」按钮用）、`boxClass`（四弹窗四种 box 布局类）、`onClose`（关闭生命周期钩子，tag-editor 的 disposed 同步置位用）三个通用参数；
> - P1-3 实际接入 **3/4**：rename ✅、adv-filter ✅、tag-editor ✅（三者测试同步去 mock、改走真实脚手架）；**batch-rename 记账不接入**——其标题为自定义三段式 `dlg-header`（标题+路径+计数），与统一 title 行模型不匹配，且关闭链含 brTimers 清理与 pendingResolve 结算，强行接入需给抽象开「header 模式」口子，违反 D3「抽象要么抽全要么别抽」；待 dlg-header 样式统一时再做；
> - 附带收口：`buildOverlay` 注释更新（业务弹窗统一走 createDialog 自动继承 role/aria-modal，「同规约定」注释失效）。

---

## 4. P2 — 依赖注入真化（分 3 批，期间新旧并存）

| 批次 | 文件 | 现状 | 改法 |
|---|---|---|---|
| **A**（单点，先做） | `maintenance/recycle-bin.ts:3-5,15` | `_getApp` / `_t` / `_modalConfirm` 下划线别名；全库 `_getApp =` **零命中**，无 setter/reset，测试实际走 `vi.mock`。内部不一致：`:149,167` 收 `opts.getApp`，`:209` 直接 `await _getApp()`、`:94` 直接 `_modalConfirm(...)` | 把 `:94`、`:209` 及 `_t` 的 4 处调用（`:222,228,236,253`）统一收进 `opts`；删除全部 `_` 别名；`Deps` 类型显式声明 |
| **B**（纯函数，风险最低） | `dialogs/modal-confirm.ts` / `modal-prompt.ts` / `modal-select.ts` / `modal-picker.ts` / `modal-progress.ts` | 各自直接 `import { t }` 与 `esc` | 增加可选 `Deps = { t?, esc? }` 参数，默认取全局实现。调用点零改动即可平滑迁移 |
| **C**（面最大） | `context-menu/*`（5 处 `resolveDstDir` 复制：`dir-handlers.ts:17,38`、`file-handlers.ts:41,62`、`handlers.ts:95`）、`dnd/import-dnd.ts:223-231` 与 `pack-dnd.ts:263-271`、`maintenance/oldest-models.ts`、`version-updater.ts`、`pack-ops/instance-ops.ts`、`sync.ts`、`require-mcroot.ts` | 共 20 个非测试文件直取 `getApp` | 随各文件下次功能改动**顺手**注入，不单独开一轮全量改造 |

**P2 附带的重复消除**（可在批次 C 时一并处理）：

| 位置 | 重复内容 |
|---|---|
| `context-menu/dir-handlers.ts:17,38`、`file-handlers.ts:41,62`、`handlers.ts:95` | `resolveDstDir → getApp → binding → toast → refreshUI → catch` 六步曲复制 5 遍，差异仅 binding 名与 i18n key → 抽 `runFileOp(tpl, ctx, opts)` |
| `dnd/import-dnd.ts:5-15` ≡ `pack-dnd.ts:7-17` | 11 行 import 逐行同序相同；`:223-231` ≡ `:263-271` 事件绑定 + cleanup 9 行全同 → busy 守卫 / oversize 过滤 / toast 文案 / 绑定清理四套策略下沉 `dnd/shared.ts`（当前 `shared.ts` 只抽了收集原语） |

---

## 5. P3 — 职责回迁（ADR-190 D1）

| # | 文件:行号 | 迁往 | 说明 |
|---|---|---|---|
| P3-1 | `maintenance/oldest-models.ts:91` `buildHeatmapHtml`、`:133` `renderOldestCardsHtml`、`:228` `buildOldestPageHtml` | `views/` | 纯「数据 → HTML 字符串」，含内联 style |
| P3-2 | `maintenance/recycle-bin.ts:44` `renderRecycleListHtml` | `views/` | 同上 |
| P3-3 | `sync.ts:29-214`（`runDownloadMissing:29`、`handleSyncDownloadMissing:91`、`runSyncToggleStatus:132`、`handleSyncToggleStatus:189`、`registerSync:215`） | `services/` | 多次 Go 调用编排成一个业务动作；文件头注释 `:4-6` 亦自承「由 core/handlers 迁来」 |
| P3-4 | `require-mcroot.ts:18-27` | `services/` | 配置读取守卫 |

> P3 触碰 `views/` 既有实现，**须先确认无并行会话占用**再开工。

---

## 6. 勘误（审计初稿 → 本次复核）

| 项 | 初稿 | 实际 |
|---|---|---|
| `recycle-bin.ts` 直连 `_getApp()` | `:210` | `:209` |
| `recycle-bin.ts` cleanup | `:298` | `:297` |
| `renderRecycleListHtml` 定义 | `:53-67` | `:44` |
| `batch-rename.ts` overlay | `:234` | `:236` |
| `init-gateway`/`init-github` 差异 | 判为「逻辑漂移」 | **降级**：`stripBanSuffix` 是 `stripDisableSuffix` 的 deprecated 别名（语义相同），实为废弃 API 未清理 |

## 7. 风险与回滚

| 风险 | 处置 |
|---|---|
| P1-3 改 4 个业务弹窗可能影响动画/焦点/ESC 行为 | 逐个提交 + 逐个手工验证；任一异常即 `git checkout -- <file>` 单文件回退 |
| P3 回迁与并行会话撞车 | 开工前 `git status --short`；提交用路径限定 `git commit -m "..." -- <自己的文件...>` |
| P2 批次 C 横跨 20 文件，周期长 | 不设截止，随功能改动顺手做；新旧风格并存期可接受 |
| `docs/adr/index.md` 由 pre-commit 的 `GEN_CMDS` 自动生成 | 提交时交给钩子，不手工编辑 |

## 8. 建议开工顺序

**P0（4 项，< 60 行）→ P1-1/P1-2（抽象收全，收益最高）→ P1-3（逐个）→ P2-A → P2-B → P2-C（顺手）→ P3（协调后）**

P0 与 P1-1/P1-2 可先行，不依赖本方案其余部分拍板。
