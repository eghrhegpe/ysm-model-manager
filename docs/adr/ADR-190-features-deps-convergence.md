# ADR-190：features 层职责收束与依赖注入真化

- **状态**：已采纳（Accepted）— 决策方向 D1–D6 由 2026-09-05 架构审计确立；**分步实施尚待 Jieling 批准开工**，进度见 `docs/review/features-convergence-plan.md`。若 D6（不动 community 双渲染）等条目被否决，本状态调整为 🔄 部分采纳。
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-05
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`frontend/src/features/**`；`docs/review/features-convergence-plan.md`（分步方案与行号）

---

## 1. 背景（Context）

2026-09-05 对 `frontend/src/features/`（7976 行源码 / 8662 行测试 / 8 个子目录）做了一次架构审计。审计的出发点不是「代码写得烂」——恰恰相反，该目录**零 `any`、零 TODO、目录内无循环依赖、测试量略超源码**，是本仓纪律最好的区域之一。问题出在**层职责定义缺失**，导致好纪律被用在了错的地方。

三条证据链：

**1.1 三层职责挤在一个目录，把 `services/` 架空成空壳部委。**
`features/` 同时承担：① 交互编排（context-menu / dnd / dialogs，本职）；② HTML 渲染（`maintenance/oldest-models.ts:91` `buildHeatmapHtml`、`:133` `renderOldestCardsHtml`、`:228` `buildOldestPageHtml`，`maintenance/recycle-bin.ts:44` `renderRecycleListHtml`）；③ Go 多调用业务编排（`sync.ts:29-186`、`require-mcroot.ts:18-27`）。结果是 `services/` 只剩 2 个文件共 277 行，而 `views/`（22666 行）之外另立了第二套渲染流水线。

**1.2 依赖注入是「化石」——有姿态，无机制。**
`features/` 下 20 个非测试文件直接 `import { getApp }`（全前端 90 处）。`maintenance/recycle-bin.ts:3-5,15` 用 `getApp as _getApp` / `t as _t` / `modalConfirm as _modalConfirm` 的下划线别名，看似预留了注入后门，但全库 `_getApp =` **零命中**：无赋值点、无 setter、无 reset。测试实际走 `vi.mock` 换模块，与别名无关。该函数内部也不一致——`:149,167` 收 `opts.getApp` 参数，`:209` 却直接 `await _getApp()`、`:94` 直接 `_modalConfirm(...)`。

**1.3 类型安全是「正确的假象」。**
零 `any` 的成绩单有水分：`utils/resource/types.ts:14` 的 `RESOURCE_TYPES` 是 `Record<string, string>`，`recycle-bin.ts:14` 以 `import type` 引入后在 `:42` 用 `(typeof RESOURCE_TYPES)[keyof typeof RESOURCE_TYPES]`。`keyof Record<string,string>` = `string`，约束完全蒸发，编译通过而语义失效。

**1.4 抽象抽了一半，比不抽更贵。**
`dialogs/modal-core.ts:186,187` 的 `createDialog` 声明了 `title: string` / `icon?: string`，但 `:195` 的解构只取 `width, tabIndex, cancelValue, resolve, closable, buildBox`——**两个参数从未被使用**。后果是 5 个 builder 白传 title，各自在 `buildBox` 里重复渲染标题行；而 `rename.ts:21-29`、`adv-filter.ts:176-181`、`tag-editor.ts:94-98`、`batch-rename.ts:234-278` 四个业务弹窗干脆绕开 `createDialog`，各写各的 overlay 六步（`createElement → tabIndex → className → role → aria-modal → onclick`）。

**1.5 测试在为「不可测的设计」打补丁。**
测试 8662 行 > 源码 7976 行，且源码越薄的模块测试越厚（`dnd` 773:1064、`platform` 58:163、`import` 211:337）。这是典型的补偿性测试：因为没有注入点，只能 `vi.mock` 整个模块。

---

## 2. 决策（Decision）

**D1 — 确立 `features/` 准入准则（单一职责）。**
`features/` 只放**交互编排**：事件绑定、用户意图到 Go 绑定的翻译、对话框与菜单流程。凡属「数据 → HTML 字符串」的纯渲染函数回迁 `views/`；凡属「多次 Go 调用编排成一个业务动作」的逻辑下沉 `services/`。判定口诀：**不出 HTML 给 `views`，不编排多个 Go 调用给 `services`**。

**D1a — 「渲染」二分细则（2026-09-05 考古后补，Jieling 拍板）。**
「渲染」一词须一刀切为两种，归属相反：

| 渲染种类 | 归属 | 依据 |
|---|---|---|
| **DOM HTML 模板**（字符串拼接、内联 style、页面骨架/条目） | `views/`（沿用 §4.2 `tpl-*.ts` / `render.ts` 惯例） | `views/app-content/tpl-recycle.ts` 与 `features/maintenance/recycle-bin.ts:44` 服务同一页面却被劈成两半——模板归 views 是既有惯例，非新规 |
| **3D/WebGL 渲染**（scene/camera/renderer/WebGL 管线） | `features/` 领域根 | ADR-129 已裁决 preview-3d 整体升格 features，**不得**以此 D1 反向回迁 |

依赖方向不变量：`features/` 永不 import `views/`（当前 0 命中，回迁时必须保持）。违反此二分的迁移（把 DOM 模板搬进 features 或把领域编排搬进 views）即为「来回迁移」的根源，禁止。

**D1b — 编排下沉 services 的边界修正（2026-09-05 考古后补，Jieling 拍板）。**
原 D1 口诀「不编排多个 Go 调用给 `services`」与 [ADR-188] 冲突：ADR-188 已裁决
`sync.ts`（bus handler + Go 绑定业务单元）与 `require-mcroot.ts`（含 toast 的交互守卫）归 `features/`，
且是当日迁移成果。执行 D1 原文即是第三次搬动。修正为：

- **`services/` 只收无 UI 语义的纯数据服务**（现状 `cli-bridge` / `resource-registry` 即此口径）；
- **凡触 toast / bus 事件 / 用户交互反馈的编排归 `features/`**（ADR-188 口径，优先级高于本 ADR 原则句）；
- 原方案 P3-3（sync→services）、P3-4（require-mcroot→services）**撤销**，两文件维持现状。

**D2 — 依赖注入真化，取缔下划线别名。**
新增与修改的模块必须接受显式 `Deps`（或 options 对象）参数，由调用方注入 `getApp` / `t` / `modalConfirm`；模块内不得再直接 import 全局单例。禁止新增 `_xxx` 下划线别名式伪注入——它既不能注入，又误导读者以为能注入。存量迁移按方案文档分期，不追求一次做完。

**D3 — 抽象要么抽全，要么别抽。**
`createDialog` 的 `title` / `icon` 二选一：启用（由 `createDialog` 统一渲染标题行与图标，5 个 builder 删除重复模板）或删除（承认 title 属业务侧）。倾向**启用**，因为 5 处重复已客观存在。新建业务弹窗**必须**走 `createDialog`，不得自建 overlay。

**D4 — 禁止用 `Record<string, string>` 承载枚举型常量。**
资源类型类常量改 `as const` 声明并派生联合类型（`keyof typeof X` 必须落在字面量联合上，而非 `string`）。现存 `RESOURCE_TYPES` 的收窄单独立项，本次不做全量替换。

**D5 — 竞态与释放是硬约束，不是优化项。**
`createLoadGuard` 保护的模块中，**每个 `await` 之后**必须判 `guard.stale` 再写 DOM；cleanup 执行后禁止再挂载监听（含 `onclick` 赋值）。

**D6 — 本次不动 `community` 与 `views` 的双渲染现状。**
`features/community/show-repo-models.ts` 与 `views/app-content/init-github.ts` 的同构流水线（经复核，两者差异仅为 `init-github.ts:147` 使用已废弃别名 `stripBanSuffix`，而 `show-repo-models.ts:83` 用 `stripDisableSuffix`——`utils/dom/display.ts:18-19` 确认前者是后者的 deprecated 别名，**非逻辑漂移**）**本次只记账不迁移**。理由：迁移面涉及社区页全链路回归，收益不足以支撑风险。仅清理废弃别名调用。

---

## 3. 后果（Consequences）

**正面**
- `services/` 恢复为业务编排唯一归属地，`features/` 回归交互层语义，新人不再需要猜「这段代码该放哪」。
- 依赖显式化后，单测可用真实 stub 替代 `vi.mock` 模块替换，测试体积预期下降，且测试失败时能定位到真实依赖而非 mock 矩阵。
- `createDialog` 收全后，新增对话框从「复制 60 行 overlay」降为「传 buildBox + title」。
- D5 落地后消除回收站 cleanup 后的幽灵 toast 与 bus 副作用（TDD 复核后确认：初判的「`:239` 赋值竞态」不成立——该段为同步代码，cleanup 无法插入；实际风险仅存在于 onclick 闭包的 await 之后）。

**负面 / 成本**
- D2 存量迁移涉及 20 个文件，需分 3 期（详见方案文档），期间新旧两种风格并存。
- D1 的渲染函数回迁会触碰 `views/` 的既有实现，需与并行会话协调文件归属。
- D4 若做全量收窄，`RESOURCE_TYPES` 是全局高频依赖（全前端多处 import），改动面大，故本次只定原则不落地。

**已知遗留（明确不做）**
- `community` 双渲染流水线（D6）。
- 下载队列双入队 TOCTOU 窗口（`events.ts:275` 检查 → 两次 await → `download-queue-store.ts:197` 才置 `status="downloading"`）与取消不回滚；属状态机重构，单独立项。
- `render.ts:197` `renderModelList`、`:251` `renderCardsHTML` 死代码（生产侧零引用），本次一并删除（低风险）。
- `context-menus.setup.ts` 实为测试基建（首行 `@vitest-environment node`）却用生产命名住在生产目录，仅备注，不移动（搬动会打断 ADR-187 D5 的 mock 矩阵契约）。

---

## 4. 数据溯源

| 来源 | 结果 |
|------|------|
| `find features -name "*.ts" \| wc -l` + `wc -l` 汇总 | 75 文件 / 16638 行总；源码 7976、测试 8662 |
| `grep -rn ": any\|as any" --include="*.ts"`（排除测试） | 0 命中 → 零 `any` 结论 |
| `grep -rn "TODO\|FIXME\|HACK"`（排除测试） | 0 命中 |
| `grep -rn "from \"../../backend/app.ts\""` | features 下 20 个非测试文件直取 `getApp` |
| `grep -rn "_getApp *=\|_t *=\|_modalConfirm *="` | 0 命中 → 伪注入无赋值点（已复核） |
| `sed -n '14p' utils/resource/types.ts` | `export const RESOURCE_TYPES: Record<string, string>` → `keyof` 退化为 `string` |
| `sed -n '184,215p' dialogs/modal-core.ts` | `:195` 解构未取 `title`/`icon` → 死参数（已复核） |
| `grep -n "stripBanSuffix" -A6 utils/dom/display.ts` | `:18-19` 确认是 `stripDisableSuffix` 的 deprecated 别名 → 降级为「废弃 API 未清理」 |
| `sed -n '192,198p' download-queue-store.ts` | `:194` 守卫、`:197` 置位 → TOCTOU 窗口（已复核） |
| `grep -rn "renderModelList\|renderCardsHTML"`（排除测试） | 仅定义与注释命中 → 死代码（已复核） |

> 上述行号均于 2026-09-05 以 `sed`/`grep` 逐条复核；审计原始结论中「`_getApp` 在 `:210`」实为 `:209`、「cleanup 在 `:298`」实为 `:297`，已在本文修正。

<!-- 文件名: features-deps-convergence.md → 实际文件 ADR-190-features-deps-convergence.md -->
