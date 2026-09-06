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
3. **adapter 面板「三通道」实为「一臂残留」**（可行性核对 2026-09-06 修正措辞）：`renderAdapterPanelContent`（render.ts）内部三臂中**前两臂已是声明式**（schema-registry 优先 → children 递归 renderMenu），真正过程式的只剩 `renderCustom` 末段，且生产代码仅 **3 个面板**：camera（settings.ts 控件列表）、environment（env.ts renderEnvLevel）——两者照 lighting 的 cap 自报模式迁移即可；**bones**（bones-panel-node.ts，骨骼树浏览器带 raycaster/相机/场景引用，真 3D 交互内容）是唯一硬骨头。litematic 切片这一「真·复杂内容」先例已完成退役（litematic-adapter.ts 注释明写「renderCustom 逃生舱退役」）。

根因：ADR-126 P4 交付了状态层/聚合协议/visibleWhen 三件基建并完成 settings 域收敛，但 model/motion 域与 roles 内容组件的 schema 化未走完，逃生舱（filler + adapter 通路）因此不能拆——每条新需求都面临「走哪条通道」的选择成本，且 `Record<string, …>` 宽表（schemaBuilders/fillers/runners 均无 key 约束）使拼错 panel id 只在运行时静默失效。

## 2. 决策（Decision）

**方向：把最后一条过程式通路迁入声明式 schema，然后物理删除过程式通道——不是「补约束」，是「拆通道」。**

1. **roles 内容组件 schema 化（P4-B 延伸）**：roles.ts 的列表渲染改为导出 `PreviewMenuNode[]` schema（复用 ADR-125 状态层模式 + `settingsOrder` 聚合协议），`fillers` 表随之清空删除；`health.test` 白名单守卫反转为「fillers 表不存在」的编译期/测试期断言。
2. **adapter renderCustom 逐面板退役**（修正后实际范围 = 3 个面板，前两臂已声明式）：camera / environment 照 lighting 的 cap 自报模式迁入 schema-registry（低风险机械活）；**bones 是唯一真决策点**，开刀前必须拍板其二选一：① 给 node 模型加声明式 `tree` kind（骨骼树数据化，raycaster/场景引用经状态层注入）——彻底但最重；② 明示 bones 为唯一永久例外，menu-graph 判定式为其单列 `sanctionedProcedural` 口径而非永远卡死 full——务实但留一个洞。拒绝默认「挂着不动」（那是烂尾路径）。
3. **异步动态内容的标准迁移路径 = litematic 先例**：roles 走 `getModelsByType(): Promise<string[]>`，与同步 builder 签名 `(snapshot) => PreviewMenuNode[]` 不符——照 litematic-adapter 的范式：**数据就绪后按 per-scene key `registerSchema`、dispose 时 `unregisterSchema`**（多模型并存不误伤），roles 照抄即可。
4. **宽表加 key 约束**：`schemaBuilders`/`runners` 收紧为 `Record<KnownPanelId, …>`（panel id 联合由各 schema 模块自声明聚合，模式同右键菜单 `MenuAction` 三层钉死，见 2026-09-06 右键菜单同型修复）。
5. **双注册合并是 coverage:full 的隐藏前置步**：`dualChannelDebt` 的定义是「core schemaBuilders 的 key 不在 fullRegistry 里」（menu-graph.ts 判定）——即 core 六面板（lighting/shadow/postproc/settings/camera/environment）即使全部声明式化，不统一注册进 schema-registry 仍判 partial。此步纯机械，但必须排进刀序，否则判定式永不翻转。
6. **验收标准 = menu-graph 判定式自然翻转**：不做任何 coverage 造假——`proceduralPanels` 与 `dualChannelDebt` 清零后（bones 若走例外路线则扣除 sanctioned 口径）`coverage: "full"` 是结构结果，不是配置开关。
7. **分刀顺序**：camera/env 迁移 → 双注册合并 → 收 key（三件低风险机械活先行）→ roles schema 化（中风险有范式）→ bones 拍板后收尾 → 删 fillers/`renderAdapterPanelContent` 过程式通路。每刀跑 `menu-graph` 对比 `uncoveredLayers` 差量，禁止一次大爆炸重写。

**拒绝的替代方案**：保留 filler 作「复杂面板逃生舱」（永续双通道税，与 3D 菜单只允许 visibleWhen 的宪法冲突）；直接重写 menu/ 目录（6600+ 行带 8 个测试文件的存量，推倒重来风险不对称）。

## 3. 后果（Consequences）

**正面**：`coverage: "full"` 达成且由判定式结构性保证；新面板只有「导出 schema + 注册一行」一条路（选择成本归零）；panel id 拼错从运行时静默失效变编译期报错；`menu-graph` 从债务账本退化为纯文档产物。

**负面 / 代价**：roles 列表（异步数据 + 多模型分组）需走 per-scene 注册范式，状态层 `PreviewStatePath` 域补齐是较重一刀；迁移期间 menu-graph 报告会出现中间态噪音（预期内，按刀递减）。

**已知遗留**：`runners`（close 等纯动作）不在 schema 化范围——动作节点本就是声明式模型的一部分，仅收 key 约束不重构；`switch.ts`/`env.ts` 等旁支机制不在本 ADR 射程；bones 若走例外路线（§2.2 选项②），full 判定永久携带一个 sanctioned 洞，需在 menu-graph 报告中显式标注不可静默。

## 4. 数据溯源

- 锐评 2026-09-06（右键菜单审核连带 3D 菜单体检）P2 #10 → 本 ADR 立项
- 可行性核对 2026-09-06（同日）→ §1 症状 3 措辞修正（前两臂已声明式，renderCustom 仅 camera/env/bones 三面板）、§2.2 bones 决策点预设、§2.3 litematic per-scene 注册范式、§2.5 双注册合并步——四项修正均经代码核实（settings.ts:35 / env.ts:375 / bones-panel-node.ts:64 / litematic-adapter.ts:404,457,263 / menu-graph.ts dualChannelDebt 判定）
- `frontend/src/preview-3d/adapters/menu-graph.ts` coverage 判定式与 dualChannelDebt 结构 → §1 症状 1/2、§2.5
- `frontend/src/preview-3d/menu/core.ts` buildPreviewMenuRouters（fillers roles-only + 宽表）→ §1 症状 2、§2.4
- `docs/knowledge/preview-menu.md` renderPreviewPanel 四路分派 / health.test 白名单 → §1 症状 3、§2.1
- ADR-126 P4 验货对账（2026-08-28）→ §1 根因
- litematic-adapter「renderCustom 逃生舱退役」先例（registerSchema per-scene key + unregister）→ §2.3 范式来源
- 右键菜单 `MenuAction` 三层钉死先例（2026-09-06 已落地）→ §2.4 模式来源

<!-- 文件名: preview-menu-declarative-endgame.md → 实际文件 ADR-193-preview-menu-declarative-endgame.md -->
