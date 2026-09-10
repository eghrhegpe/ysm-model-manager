# ADR-220：解散 ui 收容所——3D 菜单组件归位 preview-3d

- **状态**：已采纳（Accepted）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-10
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`frontend/src/ui, frontend/src/preview-3d/menu, frontend/src/preview-3d/adapters, frontend/src/views/app-tree`

---

## 1. 背景（Context）

`frontend/src/ui/`（自称 "ui-helpers 组件库"）是 MikuMikuAR 迁移物的收容所，存在三类错位：

- **名不副实**：9 个源文件中真正的组件只有 3 个（slide-menu / header-toggle / slider-controller），其余是常量叶子（`ui-constants.ts` 仅 1 个常量、`overlay-active.ts` 单消费者查询函数、`dom-contract.ts` 字符串常量、`style-install.ts` 脚手架）。
- **归属错位**：全部生产消费者集中在 `preview-3d/`（menu 主力 + adapters/mount-preview-core），仅 `views/app-tree` 引用 `overlay-active` 一个查询函数。组件与唯一消费方分居两地，靠 `@/ui/` 别名跨目录互引。
- **同类分居**：`preview-3d/menu/` 已有 `menu-styles.ts` 样式常量先例，而 `ui/` 下的 `ui-components-styles.ts` / `ui-slide-menu-styles.ts` 是同一性质迁移物，却留在外面——收容所与归属地并存，边界无法收敛。

`preview-3d` 不在 `check-layering.ts` 分层序（views→features→services→utils→core）内，`views/app-tree` import `@/preview-3d/...` 无层规障碍，下沉可行。

## 2. 决策（Decision）

解散 `frontend/src/ui/` 目录，组件按唯一消费方归位：

- **归位 `preview-3d/menu/`**（3D 菜单子系统）：slide-menu、header-toggle、slider-controller、components-styles、slide-menu-styles、style-install、dom-contract 及其测试，符号名去 `ui-` 前缀（`installUiComponentsStyles` → `installComponentsStyles` 等）。
- **下沉 `preview-3d/adapters/`**（挂载者旁）：`overlay-active.ts` + `ui-constants.ts`（PREVIEW_OVERLAY_ID）——3D overlay 事实源查询就近挂载核心，`app-tree` 键盘门禁经 `@/preview-3d/adapters/overlay-active.ts` 查询。
- **不并入 `menu-styles.ts`**：components-styles 是 3K 字符巨型字符串，与"同值多源收敛"轻量常量定位不同；`style-install.ts` 保留（两样式文件共用脚手架）。

本 ADR 只记**归位**（纯移动 + import 改写 + 符号去前缀 + 注释缩水，零行为变化）。内容整改（a11y aria-valuenow/role=menuitem、`--accent` 主题依赖决策、`snapToStep` 浮点噪声）另行决策，不混入本决策。

## 3. 后果（Consequences）

正面：

- 组件与唯一消费方同目录，`@/ui/` 别名依赖面清零，跨目录互引消失。
- `ui/` 目录整体退场，收容所不再存在，后续新增 3D 菜单 UI 自然落在 `preview-3d/menu/`。
- `overlay-active` 的"为什么不下沉"辩护注释失去存在意义，可压缩。

负面 / 已知遗留：

- `views/app-tree` 首次 import `preview-3d` 目录（层规不拦，属"查 3D 模态会话"的跨模块查询）——语义上合理，但引入 views→preview-3d 的显式依赖，后续若有通用 UI 查询应评估放 `utils/` 或公共层。
- CSS 仍是字符串常量 + `--uih-*` 私有 token（内容整改待决策），归位不解决样式债本身。

## 4. 数据溯源

来源 → 结果：

- `grep "from \"@/ui/" frontend/src` → 21 处引用，消费者穷举为 `preview-3d/menu/*`、`preview-3d/adapters/mount-preview-core.ts`、`views/app-tree/index.ts` 三簇。
- `scripts/check-layering.ts` layerOf → preview-3d 不在 LAYER_ORDER，天然跳过分层判定。
- `frontend/src/preview-3d/menu/menu-styles.ts` → 目录内样式常量先例存在，归位有据。

<!-- 文件名: ui-shelter-dissolve.md → 实际文件 ADR-220-ui-shelter-dissolve.md -->
