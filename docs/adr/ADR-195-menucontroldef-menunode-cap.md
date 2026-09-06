# ADR-195：cap 控件单类型化——MenuControlDef/renderCapControls 并入 MenuNode schema（渐进根除）

- **状态**：已采纳（Accepted）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-06
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：ADR-193（preview-menu declarative endgame）、ADR-194（MenuControlDef 判别联合，被本 ADR 取代其射程）、ADR-125（settings 状态层/聚合）、ADR-126（面板声明式化）；`frontend/src/preview-3d/caps/scene-capability.ts`、`frontend/src/preview-3d/menu/cap-controls.ts`、`frontend/src/preview-3d/menu/render.ts`、`frontend/src/preview-3d/menu/node-types.ts`

---

## 1. 背景（Context）

### 1.1 双控件体系长期并存

YSM 3D 菜单有**两套声明类型**：

1. **节点体系（MenuNode 生态）**：`PreviewMenuNodeKind`（node-types.ts）= folder/panel/action/slider/toggle/select/button/field/row/divider/sectionTitle/material-row/controls/custom。面板 = `PreviewMenuNode[]`，渲染走 renderMenu 单一渲染器。对齐 MikuMikuAR MenuNode/ADR-238 生态。
2. **cap 控件体系**：`MenuControlDef`/`MenuControlKind`（scene-capability.ts）= toggle/slider/select/button/divider/image/color/timeline/histogram/preset-thumb。cap（SceneCapability）经 `getMenuControls(): MenuControlDef[]` 自报控件，渲染走 `renderCapControls`（cap-controls.ts，独立 cc-* 视觉）。

两套在 renderMenu 的 `controls` 节点桥接（node-types 有 `controls` kind，委托 renderCapControls）。节点自身的 select/slider/toggle 也投影（`nodeControlToCapControl`）给 renderCapControls 渲染。

### 1.2 双体系的代价（2026-09 架构审计确认）

- **cap 控件绕过 renderMenu 分派**：cap 的 toggle/slider/select 等虽经 controls 节点进树，但渲染与视觉（cc-row/cc-row-col/cap-section）独立于节点行（slide-item/lcard/folder），形成「导航行 vs 参数行」两套观感——env 两级跳转暴露最明显（一级 30px 紧凑行 ↔ 二级 50px cc-row）。
- **lcard/卡片分组能力不可用于 cap 控件**：节点行可进 `.lcard`（带标题卡片/裸放两栖），cap 控件不能。
- **新增 UI 功能要双写**：一种控件语义（toggle/slider/select）在 MenuControlDef 与节点 PreviewControlSpec 各声明一次（`nodeControlToCapControl` 投影即症状）。
- **测试面分裂**：cap 测试断言 `getMenuControls()`（90+ 处），节点测试断言 schema——同一能力两套测试语言。

### 1.3 MikuMikuAR 参照：单类型

MikuMikuAR 57 面板全为 `MenuNode[]`（MenuKind 10 种含 slider/toggle/colorSlider/modeSlider/modeRow/folder/action/custom/sectionTitle/divider），控件 bind 到全局状态（StatePath），**无第二控件类型**；复杂控件（preset chip 等）走 `custom` 逃生舱但视觉复用统一行组件，故「50+ 面板完全统一」。其单类型是**多轮砍自研**的结果（非一次到位）。

### 1.4 为何 YSM 长出双体系

YSM cap 是**实例方法自报控件**（`cap.setCloudCoverage(v)` 等闭包），且带复杂渲染（sky 时间轴 timeline、环境亮度 histogram、预设缩略 preset-thumb、HDR 预览 image）——节点体系表达不了，逼出 MenuControlDef 第二层。但深层根因是**历史演进**：cap 体系先于声明式 schema 完整成型，节点体系后到，二者未合并。

## 2. 决策（Decision）

**方向：渐进根除 MenuControlDef/renderCapControls，cap 直产 `PreviewMenuNode[]`，全部 3D 菜单走同一条 renderMenu 路径；复杂 cap 控件（timeline/histogram/preset-thumb/image）走 `custom` 逃生舱（对齐 MikuMikuAR），行视觉统一进节点行/lcard 体系。**

**选「渐进式根除」而非一次性大爆炸**（AGENTS.md 长治久安；MikuMikuAR 亦多轮砍成）。分三段推进：

### 刀序（实施见知识卡，ADR 不记进度）

**2026-09-06 架构审计补正（子代理全仓实证）**：渲染层**早已单源化于 cap 渲染器**——render.ts:598-601 注释明写「rmAppendSelect/Slider/Toggle 已退役」，节点 slider/toggle/select 是**反向投影**（nodeControlToCapControl）成 MenuControlDef 再借 renderCapControls 渲染；rmAppendButton 只是简单行壳（variant/disabled/getHint 全不认）。故「节点体系 = 正统渲染、cap = 旁支」的原刀序前提不成立——**真正分裂的是类型声明层 + 行壳视觉层**。据此插入刀 0（先行收编渲染归属），再走桥接/迁移。

1. **刀 0：渲染归属复位**：节点 slider/toggle/select/button 直走 cap 渲染器官方实现（删 nodeControlToCapControl 反向投影，节点控件即声明为 cap 渲染器输入）；节点行视觉（.slide-item/.cm-row）与参数行视觉（.cc-row）统一进同一组密度/视觉 token（menu-styles），消灭「导航行 30px ↔ 参数行 50px」断裂。此刀后 renderMenu = 唯一渲染入口，节点与 cap 控件共用同一渲染/视觉。
2. **刀 1：建桥接工厂 `cap-to-node`（薄转换层）**：MenuControlDef → PreviewMenuNode 转换器集中一处（spec 一次补齐为 MenuControlDef 超集，nodeControlToCapControl 变纯字段搬运零信息损失）。10 个 cap 的 `getMenuControls()` 暂不改，进 renderMenu 处先经工厂转 `PreviewMenuNode[]`。现有测试不动（中间多一层，行为零变）。
3. **刀 2：逐 cap 迁移**：每 cap 的 `getMenuControls(): MenuControlDef[]` → `getMenuNodes(): PreviewMenuNode[]`（或改 schema 自产节点）。每迁一个删一个 MenuControlDef 消费者 + 改写对应测试。
4. **刀 3：收口删除**：最后一个 cap 迁完时，删 `MenuControlDef`/`MenuControlKind`/cap-controls.ts 整组渲染与 cc-* 视觉层、`controls` 节点 kind、settings 的 `collectSettingsCapControls` 特判。

### 关键映射（刀 0/1 固化，刀 2 按此迁移；2026-09-06 全仓实证）

| MenuControlKind | 迁移目标 | 实证（6 button 全用 action+textKey；4/6 variant；2/6 disabled+getHint） |
|---|---|---|
| toggle/slider/select | 节点控件（spec 补 unit/onCommit/hintKey 后无损） | hintKey 13 控件（toggle/select/slider 共用右侧小字）；slider unit °/h/%/m/x/"" 11 控件 |
| button | 节点 button 扩字段（variant/disabled/getHint/hintKey/action）或刀 0 后并入 cap 渲染器输入 | 6 button：ground 2（textKey/variant/action±getHint）、env 2 HDR（+disabled/getHint/hintKey） |
| color | 节点新增 `color` kind（MikuMikuAR colorSlider 对齐） | 6 color：ground 3 + water 2 + fog 1 |
| divider | 节点 divider + 补 `.menu-divider` 样式（现无样式规则，占位） | cap `.cc-divider` 有完整样式 |
| timeline | sky 光影时间轴：刀 0 后作为 cap 渲染器输入保留 / custom | sky-timeline（unit 无关） |
| histogram | env 亮度直方图（只读）：同上 | env-histogram（16-bin 只读） |
| preset-thumb | env 预设缩略图（64×32 dataURL）：同上 | env-preset |
| image | env HDR 预览（只读，无内容跳过）：同上 | env-hdr-preview |
| group 折叠语义 | 节点 folder（已有）；消灭 cap-controls `.cap-section` 第二折叠 | |

onCommit：仅 settings-pixel-ratio 1 处（节点体系原产，cap 未用）——spec 保留即可。

### 兼容与红线

- `SceneCapability` 接口：`getMenuControls()` 退役，改 `getMenuNodes(): PreviewMenuNode[]`（或返回节点 schema）；`getMasterToggle` 相应改为返回节点/路径。
- `visibleWhen` 铁律（3d 菜单只允许 visibleWhen 谓词）不动，随节点体系保留。
- settings 聚合（ADR-125 settingsOrder 自动并入画质组）迁到节点字段（节点声明 settingsOrder 或改聚合走 schema）。
- 中间态**有界**：桥接工厂存在期间新旧双形制并存，最后一刀删除。

**拒绝的替代方案**：仅视觉统一保留 MenuControlDef（平行类型层永存，回归风险仍在）；一次性 90+ 测试大爆炸（回归面不对称）；推倒重设计控件协议（ADR-125/126/193/194 已收口，推倒违背长治久安）。

## 3. 后果（Consequences）

**正面**：终态 3D 菜单单一 MenuNode schema + 单一 renderMenu；新增 UI 功能写一次即可被全部 schema 菜单调用（AGENTS.md 红线落地）；lcard/卡片/密度 token 全菜单可用；测试单语言；与 MikuMikuAR 架构同构，未来生态对齐成本归零。

**负面 / 代价**：全量迁移 10 cap + 90+ 测试断言改写；迁移期间桥接层双形制噪音（有界）；复杂控件（timeline/histogram/preset-thumb/image）从「声明式控件」退为 custom 逃生舱内容，需保证其视觉复用统一行组件不重蹈 cc-* 覆辙；`.cap-section` 折叠实现并入节点 folder。

**已知遗留**：env 面板已先行改为「行 + navigate 下钻」（9204166e），cap 控件在 env 二级经 navigate 直达 renderCapControls——迁移后该路径改经 renderMenu 渲染节点/custom。ADR-194（MenuControlDef 判别联合）射程被本 ADR 取代（不再需要独立联合化，类型整体退役）。

## 4. 数据溯源

- AGENTS.md（2026-09 更新红线）：「3d 菜单只允许 MenuNode schema，新增 UI 功能必须可被所有 MenuNode schema 菜单调用」→ 本 ADR 立项总纲
- MikuMikuAR `scene/shared/menu-node-types.ts` MenuKind 单类型 + `menus/menu-schema.ts`（57 面板全 MenuNode[]）+ env-sky/ground-levels kind 分布实证 → §1.3 参照与 §2 刀序
- YSM 架构审计（env 面板两级跳转暴露 cc-row vs 节点行视觉断裂 + lcard 不可用于 cap 控件）→ §1.2
- ADR-193（declarative endgame）/ADR-194（MenuControlDef 判别联合，§2.5 明言 PreviewMenuNode 另套不动、交汇在 render.ts cast）/ADR-125（settingsOrder 聚合）/ADR-126（面板声明式化）→ §2 兼容与红线
- `node-types.ts` PreviewMenuNodeKind / `scene-capability.ts` MenuControlDef / `cap-controls.ts` renderCapControls / `render.ts` nodeControlToCapControl + controls 节点 → §1.1 双体系实证

<!-- 文件名: menucontroldef-menunode-cap.md → 实际文件 ADR-195-menucontroldef-menunode-cap.md -->
