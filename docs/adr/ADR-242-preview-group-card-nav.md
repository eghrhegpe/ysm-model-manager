# ADR-242：3D 动作/模型组一级卡壳收纳（面板入口行 array，内容跳转后渲染）

- **状态**：已采纳（Accepted）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-15
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`frontend/src/preview-3d/menu/env.ts (envCapRow/buildEnvCards 范式); frontend/src/preview-3d/menu/render.ts (rmAppendCard); frontend/src/preview-3d/menu/roles-views.ts (modelDetailView/motionDetailView); frontend/src/preview-3d/menu/bones-panel-node.ts`

---

## 1. 背景（Context）

内容密集面板（骨骼数十至上百行、表情数十个 morph、材质多材质球）当前在动作/模型组一级**直接铺开**：
- `motionDetailView`（roles-views.ts）把 `motionItems`（骨骼/表情/播放/感知）**全部平铺** `renderMenu`——
  骨骼面板是 `renderCustom` 手写 DOM，一进动作组就铺出整棵骨骼树。
- `modelDetailView` 把 primary（模型信息）**本体直渲内联**在详情页。

与环境组（`env`）对照明显不一致：环境一级是 `kind:"card"`（`env-card-basic`）+ 卡内
**跳转入口行**（`envCapRow`：icon + label + 可选 headerToggle + `>`，`action: ctx.navigate(子视图)`），
**内容仅在跳转后的次级菜单渲染**。用户 2026-09 反馈：「环境有收纳，动作没有」「骨骼、表情、材质
必须跳转到次级菜单，主按钮使用折叠收纳，内容仅在跳转后渲染」。

ADR-240（内容型 panel 统一折叠卡）解决了「新旧样式混排」，但其做法是把 renderCustom 内容
**内联进卡 body**——对骨骼这类巨多内容面板，内联 = 一级就铺满整棵树，正是本次要推翻的部分
（ADR-240 的视觉统一保留，内联内容改为跳转入口 array）。

## 2. 决策（Decision）

**环境组的「卡壳收纳 + 跳转入口行」范式推广到动作/模型组**：一级菜单只渲染**面板入口行 array**，
面板内容仅在 `navigate` 到次级菜单后渲染。复用既有积木，零新增节点类型：

- **一级**：`kind:"card"` + `collapsible:true`（`rmAppendCard` 折叠收纳卡）包住入口行；
  卡内每行 = `kind:"row"` + `icon` + `labelKey` + `rowDensity:"compact"` +
  `action: (ctx) => ctx.navigate?.(该面板的内容视图)`（照抄 `envCapRow` 形态）。
- **二级**：`navigate` 落点渲染该面板内容——骨骼继续走 `makeBonePanelRenderer`（renderCustom
  逃生舱，动态树 + 跨域拾取联动，schema 化 ROI 为负，见 bones-panel-node.ts 注释）；表情/材质
  继续走既有声明式 `children`（`morphNodes`/`materialNodes`）。**只把「入口」声明化，内容不着**。

范围（本次）：
- `motionDetailView`：平铺 motionItems → 卡壳 + 入口行 array（骨骼/表情/播放/感知），点行 navigate。
- `modelDetailView`：模型工具项（材质/截图等）→ 同样入口行形态（primary 模型信息保留直渲，
  它本身是「状态概览」不是「巨多条目列表」）。

`row` 节点的 `headerToggle` 复用 `envCapRow` 语义：有主开关的面板（如某能力总开关）开关置行尾，
一眼可切、免展开；`_` 无则不渲染。

> 实施注记（2026-09 审查）：`headerToggle` 实际由 `env.ts` 的 `envCapRow`（经 cap
> `getMasterNodeId/isEnabled/setEnabled` 驱动）在环境组落地；`panelEntryRow`（本 ADR 的动作/模型
> 入口行）仅透传 icon/label/action——动作/模型组面板当前无能力总开关（`getMasterNodeId` 仅
> env 的 caps 体系拥有），暂无可挂开关面。若未来该组面板引入 master toggle，再按 envCapRow
> 同法扩展 `panelEntryRow`。

## 3. 后果（Consequences）

- **正面**：动作组一级不再铺满骨骼树，视觉收敛为少量入口行；与环境组形态统一（都有卡壳收纳）；
  符合 AGENTS.md「3d菜单只允许使用 MenuNode schema」红线（card/row/navigate 均既有节点类型）。
- **正面**：骨骼逃生舱边界更清晰——一级入口是声明式，逃生舱只在二级内容层。
- **代价**：进入骨骼列表多一跳（一级 → 二级）——换取一级不被巨多条目淹没；与 env 一致。
- **已知遗留**：`modelDetailView` 的 primary 模型信息直渲保留（状态概览类，非巨多列表）；
  若未来模型信息也膨胀成列表，可同法收敛。

## 4. 数据溯源

- 用户 2026-09 反馈：「骨骼、表情、材质必须跳转到次级菜单，它们的主按钮使用折叠收纳，
  内容仅在跳转后渲染？」+ 贴 `env-card-basic` DOM 实证「环境怎么做的，动作应该也能怎么做」。
- 范式来源：`frontend/src/preview-3d/menu/env.ts` 的 `buildEnvCards` + `envCapRow` + `envCapSubview`
  （`kind:"card"` collapsible + 入口行 navigate）。
- 对照（环境有收纳、动作没有）：环境一级 card 收纳 sky/ground/water 入口行；动作一级曾平铺骨骼树。

<!-- 文件名: preview-group-card-nav.md → 实际文件 ADR-242-preview-group-card-nav.md -->
