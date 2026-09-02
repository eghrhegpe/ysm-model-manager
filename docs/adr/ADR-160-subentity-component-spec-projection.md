# ADR-160：子实体统一为组件视图:GetModel3DSpec spec.models 唯一源 + 详情统计 = spec 投影(maid L0 清单退役)

- **状态**：已采纳（Accepted）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-02
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`frontend/src/views/app-preview/maid-3d.ts`、`frontend/src/views/app-preview/skeleton-render.ts`、`frontend/src/views/app-preview/tpl.ts`、`go/threejs/spec.go`、`frontend/src/bindings/ysm-model-manager/go/threejs/models.ts`、ADR-093、ADR-101、ADR-131、ADR-132

---

## 1. 背景（Context）

车万女仆（TLM）详情页的「角色（L0）」与 3D 预览的「组件」是同一概念，但长期**一物多名**，
且统计口径走**双管线并存**，导致一次 UI 优化排查需跨 ~12 次代码搜索，远超任务范畴——
症状指向代码职责不清，须架构级收敛而非继续打补丁：

1. **一物多名**：maid「角色」在代码里至少有 8 个名字——`BedrockSubModel` /
   `subModels[]` / `subPath` / `subModelIdx` / `Entry` / `L0` / `spec.models[i]` /
   `comps` / 菜单「组件」。同一概念每层换名，跨层追踪靠人肉 grep。
2. **双管线并存**：详情快照管线（`AnalyzeBedrockModel` 聚合 + `AnalyzeBedrockModelEntry`
   逐角色预取）与 3D spec 管线（`GetModel3DSpec` 一次返回全量组件级统计）对同一统计
   维护两套口径，前端需二次拼接、spec 与聚合值可能打架。
3. **职责错位**：详情页 L0 交互清单（dp-submodels）承担了「选中角色 → 传 subPath 进 3D」
   的加载职责，与 3D「组件」下拉（ADR-132 `multiModelSelectNode`）重复。用户实证
   （zhi_ban-1.0.0 截图：组件/全部组件/骨骼 457/立方体 2204/shimoe_koharu 声明 256×256）
   表明：**3D 组件下拉才是角色加载/切换的通道，L0 清单的定位是统计而非加载**。

## 2. 决策（Decision）

**容器内子实体统一为「组件（component）」视图，以 `GetModel3DSpec` 的 `spec.models[]` 为唯一源：**

1. **词汇表归一化（三层对齐）**：zip 内每个 geo 文件 = 一个组件（Go `ModelGroup` →
   前端 `spec.models[i]` → 菜单「组件」）。前端统一口语用「组件」，`subModel` /
   `Entry` / `L0` / `subPath` / `subModelIdx` 降级为 Go/内部实现名，不再作为前端
   交互/展示概念暴露。详情卡、统计面板、3D 组件下拉三处共用同一视图与命名。
2. **详情统计 = spec 投影**：凡 zip 内子实体级统计（逐组件骨骼/立方体）一律由
   `GetModel3DSpec(zip)` 的 `spec.models` 投影（骨骼 = `bones.length`；立方体 =
   Σ `bones[]._cubeCount`）；spec 不可得（解析失败）时回落 Go 聚合口径大字，
   降级可见、不静默。聚合大字 = 组件合计。
3. **共享映射 helper**：`componentCountsFromSpec(spec)`（skeleton-render.ts）为
   spec → 逐组件统计的单一映射实现，YSM 详情（buildStatsCard）与 maid 详情共用，
   杜绝各视图各自手写一遍口径。
4. **maid 3D = 整包加载**：`createMaid3D` 不再接受 `subModelIdx` / `subPath`；
   角色切换收敛到 3D「组件」下拉内完成。详情页与 3D 打开的语义 =「这个包」，
   而非「这个包里的某个角色」。
5. **退役**：详情页 dp-submodels L0 交互清单（含 chip 选择交互）与
   `AnalyzeBedrockModelEntry` 逐角色预取链路整体移除——交互角色加载由 3D 组件下拉
   承担，详情回归「统计 + 元数据」定位。

## 3. 后果（Consequences）

**正面**
- 一物一名：跨 Go 类型 / 前端类型 / i18n 三层的「组件」语义统一，搜索成本显著下降。
- 详情统计与 3D 组件下拉同构（同一 spec、同一映射 helper），消除双口径打架。
- L0 交互清单退役 → maid 详情渲染为纯字符串拼接 + 静态行，无选中态、无事件绑定。
- maid 与 YSM 详情在模型结构蓝卡上共享同一渲染路径（statsCardHTML + componentCounts）。

**负面 / 已知遗留**
- `spec.models[]` 的**语义随格式漂移**：YSM = main/arm/arrow 部件、maid = 角色、
  资源包 = 包内模型。「组件」是容器内 geo 文件的通用词，具体含义由格式适配器解释——
  通用层不得假设「组件 = 角色」，各适配器负责向用户呈现正确称谓。
- 逐组件统计行是纯展示：含「备用」等非主名组件时，用户须理解其来源（zip 内独立 geo），
  无可点击语义；需要时可挂 tooltip 说明，不恢复交互。
- 详情与 3D 数据获取仍是两个 Go 调用（AnalyzeBedrockModel + GetModel3DSpec）——
  统计已归一为 spec 投影，但聚合纹理/尺寸/metadata 仍由 AnalyzeBedrockModel 承载，
  属「职责不同」而非「口径重复」，暂不合并。

## 4. 数据溯源

- 用户实证截图：zhi_ban-1.0.0「组件 / 全部组件 / 骨骼 457 根 / 立方体 2204 个 /
  shimoe_koharu / player · 256×256 · 加载 24」——3D 组件下拉 = 角色加载/切换通道，
  L0 清单定位是统计而非加载（用户原话：「其定位是统计而非加载角色」）。
- 源码实证：`tpl.ts:166-167`（statsCardHTML componentCounts 静态行早已存在，
  收敛落点天然就绪）、`skeleton-render.ts:88-99`（componentCountsFromSpec 提取）、
  maid-3d.ts 旧版 `dpRenderSubList` / `MaidOpenOptions.subModelIdx|subPath` /
  `MaidPreviewState.selSubIdx` / `prefetchEntryStats`（本 ADR 退役项）。
- 用户质询：一次 UI 优化搜索 ~12 次代码 → 职责不清致搜索困难，须架构收敛而非补丁。
