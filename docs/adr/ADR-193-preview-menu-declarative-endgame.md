# ADR-193：3D 菜单终局收口：roles 过程式内容组件声明式化，退役双通道

- **状态**：已采纳（Accepted）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-06
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`docs/knowledge/preview-menu.md`、`frontend/src/preview-3d/menu/core.ts`、`frontend/src/preview-3d/adapters/menu-graph.ts`、ADR-126（本 ADR 是其 P4 的收官刀，不取代）

---

## 1. 背景（Context）

锐评（2026-09-06，右键菜单审核连带 3D 菜单体检）确认：「菜单即数据」在 preview-3d 侧至今是半成品，症状三条，全部可机器验证：

1. **`coverage` 常年 `partial`**（`menu-graph.ts` coverage 判定式）：`proceduralPanels.length === 0 && dualChannelDebt.length === 0 ? "full" : "partial"` 两项债务均非零。
2. **filler 逃生舱仅剩 roles 但未拆**（`core.ts` `fillers` 表，G3 删 fill* 后唯一残留）：roles 是**既是 filler 又是 closure builder** 的双注册体（menu-graph 组装处需 `Set` 去重即为结构性证据）——`buildPreviewMenuRouters` 里同一面板走两条渲染通路（fillers 过程式直吃 `HTMLElement` vs schemaBuilders 声明式出 `PreviewMenuNode[]`）。
3. **adapter 面板三通道衰退**（`renderAdapterPanelContent`，知识卡 preview-menu.md「renderPreviewPanel 四路互斥分派」）：四路分派中仍有一条 adapter 过程式通路，与 core 注册面板双轨并行。

根因：ADR-126 P4 交付了状态层/聚合协议/visibleWhen 三件基建并完成 settings 域收敛，但 model/motion 域与 roles 内容组件的 schema 化未走完，逃生舱（filler + adapter 通路）因此不能拆——每条新需求都面临「走哪条通道」的选择成本，且 `Record<string, …>` 宽表（schemaBuilders/fillers/runners 均无 key 约束）使拼错 panel id 只在运行时静默失效。

## 2. 决策（Decision）

**方向：把最后一条过程式通路迁入声明式 schema，然后物理删除过程式通道——不是「补约束」，是「拆通道」。**

1. **roles 内容组件 schema 化（P4-B 延伸）**：roles.ts 的列表渲染改为导出 `PreviewMenuNode[]` schema（复用 ADR-125 状态层模式 + `settingsOrder` 聚合协议），`fillers` 表随之清空删除；`health.test` 白名单守卫反转为「fillers 表不存在」的编译期/测试期断言。
2. **adapter 三通道收编为单通道**：`renderAdapterPanelContent` 的面板逐个迁入 core `schemaBuilders` 注册（或直接导出 schema 由 core 聚合），迁完即删该函数——`renderPreviewPanel` 四路分派收敛为「schema 节点 + 动作节点」两路。
3. **宽表加 key 约束**：`schemaBuilders`/`runners` 收紧为 `Record<KnownPanelId, …>`（panel id 联合由各 schema 模块自声明聚合，模式同右键菜单 `MenuAction` 三层钉死，见 2026-09-06 右键菜单同型修复）。
4. **验收标准 = menu-graph 判定式自然翻转**：不做任何 coverage 造假——`proceduralPanels` 与 `dualChannelDebt` 清零后 `coverage: "full"` 是结构结果，不是配置开关。
5. **分刀顺序**：roles schema 化 → adapter 面板逐个迁移（每面板一提交，迁移一片删一片通路）→ 删 fillers/`renderAdapterPanelContent` → 宽表收 key。每刀跑 `menu-graph` 对比 `uncoveredLayers` 差量，禁止一次大爆炸重写。

**拒绝的替代方案**：保留 filler 作「复杂面板逃生舱」（永续双通道税，与 3D 菜单只允许 visibleWhen 的宪法冲突）；直接重写 menu/ 目录（6600+ 行带 8 个测试文件的存量，推倒重来风险不对称）。

## 3. 后果（Consequences）

**正面**：`coverage: "full"` 达成且由判定式结构性保证；新面板只有「导出 schema + 注册一行」一条路（选择成本归零）；panel id 拼错从运行时静默失效变编译期报错；`menu-graph` 从债务账本退化为纯文档产物。

**负面 / 代价**：roles 列表（含动态加载、多模型分组等过程式逻辑）schema 化需要状态层 `PreviewStatePath` 域补齐，是本 ADR 最重的一刀；迁移期间 menu-graph 报告会出现中间态噪音（预期内，按刀递减）。

**已知遗留**：`runners`（close 等纯动作）不在 schema 化范围——动作节点本就是声明式模型的一部分，仅收 key 约束不重构；`switch.ts`/`env.ts` 等旁支机制不在本 ADR 射程。

## 4. 数据溯源

- 锐评 2026-09-06（右键菜单审核连带 3D 菜单体检）P2 #10 → 本 ADR 立项
- `frontend/src/preview-3d/adapters/menu-graph.ts` coverage 判定式与 dualChannelDebt 结构 → §1 症状 1/2
- `frontend/src/preview-3d/menu/core.ts` buildPreviewMenuRouters（fillers roles-only + 宽表）→ §1 症状 2、§2.3
- `docs/knowledge/preview-menu.md` renderPreviewPanel 四路分派 / health.test 白名单 → §1 症状 3、§2.1
- ADR-126 P4 验货对账（2026-08-28）→ §1 根因
- 右键菜单 `MenuAction` 三层钉死先例（2026-09-06 已落地）→ §2.3 模式来源

<!-- 文件名: preview-menu-declarative-endgame.md → 实际文件 ADR-193-preview-menu-declarative-endgame.md -->
