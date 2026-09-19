# ADR-270：preview-3d/menu 目录物理分层（七层隐式收敛为显式子目录）

- **状态**：📝 提议中（Proposed）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-19
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`frontend/src/preview-3d/menu/ · ADR-195 控件/节点同构 · ADR-193 声明式化 · ADR-146 路径别名 · check-layering 门禁`

---

## 1. 背景（Context）

`frontend/src/preview-3d/menu/` 是「菜单即数据」（`PreviewMenuNode` schema，AGENTS.md 红线）的落点，当前 **28 个源文件平铺一个目录**。调研（2026-09 灵感风暴，借鉴隔壁 `.dsh` 的 `plugins/skins/profiles` 物理分层）确认：**注册/装配逻辑早已分层收敛**，但**目录结构没有反映这层分层**——依赖边界只靠 import 口头约定和 ADR 编号维系，无门禁兜底。

已存在的三条隐式通道（本 ADR 不改动其语义，只是把目录对齐到既有逻辑）：

- **面板内容**：`schema-registry.registerSchema(id, wrapper)`——6 个 core 面板声明在 `core.ts:schemaBuilders` 表，`for CORE_PANEL_IDS → registerSchema` 统一汇入 registry；adapter 面板走**同一 API**（ADR-193 §2.5 双注册合并）。
- **底栏 dock 按钮**：`[...CORE_MENU_ITEMS, ...adapterItems]` 合并 + `setAdapterItems` 的 id 冲突守卫（defs.ts 静态表 ∪ adapter 注册）。
- **领域节点工厂**：`bones/material/morph/perception/multi-model` 由 adapter 当工厂调用、core 不 import。

**动机**：逻辑分层既成事实，把目录从「扁平 7 层混杂」升级为「物理子目录 = 契约边界」，让 `check-layering` 能按目录卡依赖方向，替代目前的口头约定。这是纯工程收敛，不改运行时行为。

## 2. 决策（Decision）

将 `menu/` 按隐式职责收敛为显式子目录，映射关系：

| 子目录 | 承载文件 | 依赖方向（只能引下层，禁引上层） |
|--------|----------|-----------------------------------|
| `menu/schema/` | `menu-node-types` · `node-types` · `dom-contract` | 零依赖叶，仅引 `state/preview-paths` `utils/icon` |
| `menu/engine/` | `core` · `render` · `menu-graph` · `defs` | → schema / panels / shell / style |
| `menu/panels/` | `env` `roles` `roles-views` `settings` `stats` `material-controls` `morph-controls` `perception-controls` `cap-controls` `cap-to-node` `bones-panel-node` `multi-model` `camera-schema` | → schema（不反向引 engine，经 registry 注册） |
| `menu/shell/` | `slide-menu` `fab` `header-toggle` `slider-controller` `switch` | → schema |
| `menu/style/` | `menu-styles` `components-styles` `slide-menu-styles` `style-install` | 零依赖叶 |

**方向规则（写入 check-layering 门禁）**：
1. `schema/` 与 `style/` 为叶子——禁止引本目录内其它子目录。
2. `panels/` **只依赖 `schema/`**，不得 `import engine/`（面板经 `registerSchema` 注册、由 engine 读表装配，反转依赖）。
3. `engine/` 是唯一装配根，可向下引全部。
4. 跨子目录 import 一律 `@/preview-3d/menu/<子目录>/<file>`（ADR-146，禁 `../` 上跳、禁目录桶入口）。

**取代关系**：本 ADR 不改 ADR-195 的控件/节点同构与 `cap-to-node` 零接线，仅在其之下补目录维度。与 ADR-146 路径别名互补（别名已就位，本 ADR 是其「按目录卡方向」的下一刀）。

## 3. 后果（Consequences）

**正面**：
- 依赖方向从「口头 + ADR 记忆」升级为「目录 + 门禁」，防「面板反向 import core」这类退化。
- 新面板/新外壳落点唯一确定，减少「该放哪」的决策摩擦。
- 28 文件平铺的可读性债一次性清偿。

**负面 / 风险**：
- **全仓 import 路径 churn**：`menu/*` 被 `preview-3d/adapters/*`、`views/app-preview/*`、`infra/*` 引用（实测 15+ 处），每次迁移都动消费者 import。缓解：按子目录**逐层迁**（先 `style/` 零依赖叶，再 `schema/`，最后 panels/engine/shell），每片独立可验证。
- **知识卡 source_files 漂移**：路径变更触发 `check-knowledge-drift`，需同步迁移对应卡正文路径。
- **测试共位**：`*.test.ts` 随源文件同迁，注意 R6（测试禁引桶入口）——迁移不得顺手引入 `menu/xxx/index` 聚合桶。
- **git 历史**：`git mv` 保留 rename 追溯，提交按 AGENTS.md「git mv 类直接 commit，勿用 --files 漏 rename 半身」。

**已知遗留**：`CORE_PANEL_IDS` + `core.ts:schemaBuilders` 仍是 core 面板的硬编码枚举表（加一个 core 面板要改两处）。本 ADR 暂不处理——是否让 core 面板也「自注册」是独立决策，留待后续切片评估净收益。

## 4. 数据溯源

- **来源**：`grep` 实测 `/menu` 引用面（`adapters/*` 引领域工厂、`core.ts:24-44` 直接 import env/roles/settings/switch、`core.ts:220-261` schemaBuilders→registerSchema 装配、`core.ts:442` CORE_MENU_ITEMS∪adapterItems）。
- **结论**：逻辑分层三通道已存在 → 目录仅缺物理对齐 → 迁移是纯结构调整、无行为变更、可分片验证。

<!-- 文件名: menu-directory-layering.md → 实际文件 ADR-270-menu-directory-layering.md -->
