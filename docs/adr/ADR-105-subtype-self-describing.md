# ADR-105：subtype 完整自描述化：零继承识别单元（MMD 落地，光影包预留）

- **状态**：✅ 已采纳（Accepted）
- **日期**：2026-08-19
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`ADR-092`（分组路由）、`ADR-094`（MMD 位置路由）、`ADR-104`（三层架构 subtypes 注册表化）

---

## 1. 背景（Context）

ADR-104 将 subtypes 注册表化后，subtype 仅有 `name/label/userImportable/default/installDir/scanDir`——**识别能力（extensions/detector/zipEntries）仍由父类型统一声明**。这留下两个隐患：

1. **MMD 识别靠父类型**：`mmd-skin` 声明 `zipEntries: [.pmx, .pmd]`，8 个 subtype 共享。场景 `.pmx` 与角色 `.pmx` 扩展名重合（ADR-094 已确立靠物理路径区分），但 subtype 自身无任何识别声明——导入/校验链路只能回溯父类型，下游想按 subtype 校验内容必须自造识别器。
2. **光影包同构隐患（确认）**：`shaderpack` 的 `zipEntries: [shaders/]` 只识别到「整包是光影包」，内部 `.vsh/.fsh/.glsl` 顶点/片段/几何着色器混在 `shaders/` 下不分离——与 MMD 当初的困境一模一样。未来若要按着色器类型筛选/预览/单独同步/编辑，整条链路要重做。

对比两种架构：

| 维度 | 继承式（subtype 只写差异） | 自描述式（零继承） |
|------|---------------------------|-------------------|
| JSON 体积 | 小 | 大（每 subtype 完整声明） |
| 识别链路 | 回溯父类型补全字段 | subtype 自身完整，物理路径定位后直接用 |
| 新增 subtype | 改父类型可能影响所有 subtype | 只改目标 subtype，零耦合 |
| 校验逻辑 | 合并父子字段后校验 | subtype 自声明内容校验，无合并 |
| 扩展到光影包 | subtype 需继承 shaderpack 的 shaders/ 前缀 | subtype 自带声明，独立完整 |

## 2. 决策（Decision）

**subtype 完整自描述、零继承**——每个 subtype 是完整的识别 + 校验 + 预览单元：

1. **字段补全**：`ResourceSubType` 扩为 `name/label/icon/userImportable/default/extensions/detector/zipEntries/preview/installDir/scanDir`。缺字段 = 无该能力（不回溯父类型）。
2. **识别链路**：`物理路径定位 subtype + subtype 自声明内容校验`——导入/检测先按容器指纹识别到父类型（rt 级不变），再按目标物理路径（子目录）定位 subtype，用 subtype 自己的 `zipEntries` 做内容校验（不匹配则拒绝）。物理路径是唯一 subtype 裁决（呼应 ADR-094）。
3. **MMD 落地（本批）**：`mmd-skin` 8 个子类全部补全自描述字段（EntityPlayer/SceneModel 认 `.pmx/.pmd`，CustomAnim/StageAnim/DefaultAnim 认 `.vmd`，CustomMorph/DefaultMorph 认 `.vpd`，shader 认 `.glsl/.vsh/.fsh`）；preview 按能力声明（shader=none，其余 3d）。
4. **光影包预留（future work，本批不动）**：未来加 `shaderpack.subtypes[]`（vertex/fragment/geometry）即纯增量，不改识别链路。当前不动的理由：内部目录结构因光影模组而异（Iris/OptiFine/Vanilla 各不同）、无实际用户场景驱动、当前优先级是验证 MMD 架构。

## 3. 后果（Consequences）

**正面**：
- subtype 自身就是完整的识别/校验/预览单元，下游零回溯、零自造识别器；
- 新增 subtype 只改目标条目，零耦合（改父类型不再波及子类）；
- 光影包未来下手是纯增量，识别链路一次定型；
- 与 ADR-104 三层架构一脉相承：大类装饰 → subtype 路径锚定 → 自声明防御检验。

**负面 / 已知遗留**：
- JSON 体积增大（8 个 subtype 各声明一份 extensions/zipEntries，存在重复——自描述代价，接受）；
- `ResourceSubType` 结构体扩字段，`SubtypesFor` 返回结构变化，消费方（scanner/instance/sync/打开文件夹）需适配；
- 光影包 subtype 化明确列为 future work，未排期（依赖实际用户场景驱动）；
- 前端 `MMD_SUBTYPES` 派生逻辑需同步（icon/preview 字段新增可选消费）。

**全资源自描述一致性审查（2026-08-20，用户裁定「先移植、后去重」）**：
- ✅ 8 类型 detector ↔ zipEntries 全部匹配（mcmeta↔pack.mcmeta / shader↔shaders/ / ysm↔ysm.json+models/ / zipentry↔各后缀指纹），自洽；
- ✅ zipEntries 全部为内容指纹、无任何 `.zip` 引用，区分度正常（用户「zipEntries 全员 zip」印象实为 extensions 的 `.zip`，字段已核实）；
- ✅ mmd-skin 顶层 extensions = subtypes 扩展集并集（EntityPlayer 全量、其余子集），无冲突；
- 🔜 **去重候选（后置，未实施）**：`.zip` 在 8/8 类型 extensions 中全员存在、零识别区分度——是容器准入标记（`importer_file.go:69` 硬编码 `ext==.zip||.7z` 触发内容检测，与注册表无关）。候选去重方向：从 extensions 移除 `.zip` 或改为顶层声明一次；影响面 `ExtBelongsTo(".zip")` 歧义兜底，须与 importer 容器触发解耦后实施。

## 4. 数据溯源

- 现象：MMD 导入只能识别「是 mmd-skin」，无法按 subtype 校验内容；shaderpack 内部 `.vsh/.fsh/.glsl` 混在 `shaders/` 无法分离。
- 根因：`resource_types.json` subtype 缺 `extensions/detector/zipEntries/preview` 字段（ADR-104 只落地了路径字段）；`MatchZipEntry`（go/types/extensions.go:266）与 `DetectResourceType`（go/packs/mcmeta.go）均只遍历父类型级。
- 方案对照：继承式需回溯父类型补全 + 合并校验（复杂度随层级增长）；自描述式零回溯、零耦合（用户拍板）。
- 修复验证：`go build ./go/...` + go/types 测试（SubtypesFor 字段断言）+ 前端 vitest（MMD_SUBTYPES 派生）+ `npm run typecheck` + `npx vite build`。

<!-- 文件名: subtype-self-describing.md → 实际文件 ADR-105-subtype-self-describing.md -->
