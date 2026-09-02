# ADR-161：渲染会话词汇章程:spec 契约单一镜像 + 尺度词消歧(组件/模型/内容层/条目)+ built 黑话退役

- **状态**：已采纳（Accepted）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-02
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`frontend/src/preview-3d/adapters/mount-preview-core.ts、frontend/src/preview-3d/model3d.ts、go/threejs/spec.go、frontend/src/bindings/ysm-model-manager/go/threejs/models.ts、frontend/src/preview-3d/adapters/scene-registry.ts、frontend/src/preview-3d/adapters/unload-role.ts、docs/knowledge/model3d.md、docs/knowledge/preview_core.md、ADR-066、ADR-093、ADR-159、ADR-160`

---

## 1. 背景（Context）

ADR-160 修掉了「子实体一物多名」（maid 角色 = BedrockSubModel/subModel/Entry/L0/spec.models[i]/组件）。但渲染会话层（3D 会话域）的词汇盘点暴露同类病根的**四个变体**，搜索「组件统计」「当前场景里有几个模型」「vrm 挂载入口」均需多轮试错：

1. **spec 数据跨层双名**：同一份 JSON 契约，Go/绑定侧称 `Model3DSpec`/`ModelGroup`/`BoneData`/`MeshData`（`go/threejs/spec.go:20/31/42/52`），前端类型枢纽另立 `Spec3D`/`SpecModelGroup3D`/`SpecBone3D`/`SpecMeshGroup3D`（`model3d.ts:11/23/35/43`）。两套类型无声明式等价，双向映射靠人肉；`SpecModelGroup3D` 甚至未 export（:35），类型枢纽呈半成品状。
2. **「模型/model group」一词三尺度**：Go `ModelGroup` 与前端同名类型指**组件**（= zip 内一个 geo 文件，spec.go:107 `comp_<i>`）；Three 场景中实际挂载的 `Group`/rootGroup 指**整模型根**；sceneRegistry `ModelEntry` 指**会话注册的模型实例**。同一词按层猜，跨层追数据必踩空。
3. **built 黑话**：会话内容层实例（一个格式内容 = PreviewScene）在 mount-preview-core 内部叫 `built`/`allBuilt`/`getBuilt()`——动词名词化、语义不可达；搜「内容层/实例/场景」全落空，而其同实体的注册表侧叫 `ModelEntry`、菜单侧叫「模型」。
4. **「角色」一词两义复活**：ADR-160 已把 maid 详情 L0「角色」退役为「组件」；但 3D 会话域「角色」仍现行——`unload-role.ts`（角色面板 ⚙ 卸载角色 = sceneRegistry 注销 + 内容层 GPU 释放）。同一联邦内「角色」= 包内子实体（已废）与 = 场景模型实例（现行）两口径并存。
5. **适配器工厂命名不齐**：`makeYsmAdapter`（ysm-adapter.ts:534）/`makePackAdapter`（pack-model-adapter.ts:66）为 make 前缀，vrm/mmd 的文件导出却是菜单项 `vrmMenuItems`/`mmdMenuItems`，内容适配器主入口函数名不可预期。
6. **路径漂移放大搜索成本**：多处文档基线记 `utils/3d/`，统一核心实际位于 `src/preview-3d/adapters/`——首轮搜索必空。

## 2. 决策（Decision）

### 2.1 spec 契约单一镜像：Go JSON 为唯一事实源，前端禁另立名族

- spec 数据契约（`Model3DSpec`/`ModelGroup`/`BoneData`/`MeshData`，JSON tag 不变）为**唯一事实源**，由 Go 定义、Wails 绑定导出。
- 前端 `model3d.ts` 的 `Spec3D` 族降级为**镜像层**：与绑定类型声明式等价（`export type Model3DSpec = Spec3D` 等别名或直接改引绑定类），**禁止新增第四套 spec 类型名**。跨层搜索以绑定类名为锚，前端镜像必须可 grep 到同一契约。
- `SpecModelGroup3D` 补 export 或并入绑定类引用，类型枢纽不留半成品。
- JS 侧 `model3d-spec.ts buildSpecFromModel`（WASM 兜底）与 Go `threejs.Build()` 双实现**口径不一致是已知遗留**（model3d.md:716），本 ADR 不解决实现合并，但两者产出的数据结构名必须同锚契约。

### 2.2 尺度词消歧：组件 / 模型 / 内容层 / 条目 四级词表

渲染会话域禁用歧义词「model group」指代组件，统一四级词表：

| 统一词 | 指代 | 代码锚点（现行/待改） |
|--------|------|----------------------|
| **组件 component** | spec.models[i] = zip 内一个 geo 文件 | Go `ModelGroup`（JSON 契约名保留） |
| **模型 model** | 一个资源（zip/文件/目录），用户视角的「一个模型」 | 资源路径、详情卡 |
| **内容层 scene content** | 会话中一个格式实例 = PreviewScene（可多模型同框，ADR-093） | mount-preview-core `built`→`content` |
| **注册条目 entry** | sceneRegistry 中的一个模型实例（MAX_MODELS=8，ADR-159） | `ModelEntry` |

跨层追数据路径：**资源 path → model → spec.models[i]（组件）→ 3D 场景（整模型挂进内容层）→ registry entry（会话实例）**。任何代码注释/命名不得再让「模型」一词跨两尺度。

### 2.3 built 黑话退役

mount-preview-core 内部 `built`/`allBuilt`/`getBuilt()` 及派生命名一律改 `content`/`allContent`/`getContent()` 口径（对外契约词「会话内容层」），注释同步。搜索「内容层/实例」须可直达。

### 2.4 「角色」收敛为「模型实例」

- 3D 会话域（挂载/切换/同框/卸载）的操作对象统一称**模型实例 model instance**；`unload-role.ts` 及其「角色面板 ⚙ 卸载角色」用户文案为退役候选，实施期改「卸载模型」口径。
- 「角色 role」仅在 MikuMikuAR 联邦域与用户可见层保留（车万女仆域内语义），maid L0 子实体角色由 ADR-160 退役、不复活；代码内部不得再以 role 指代会话实例。

### 2.5 适配器工厂命名章程

每个内容适配器文件必须导出 `make<Format>Adapter`（对齐 `makeYsmAdapter`/`makePackAdapter`），作为该格式的挂载主入口；`vrmMenuItems`/`mmdMenuItems` 等仅作菜单项，不得再承担「找挂载入口」的职责。适配器注册点统一消费工厂，新增格式照此章程。

### 2.6 目录职责（方向）

`preview-3d/adapters/` 收敛为「内容适配器 + 其专属基础设施」；通用 parser/worker 等设施分批迁出（实施期定具体目录），不属本 ADR 实施主体。

## 3. 后果（Consequences）

**正面**：跨层类型可 grep 对齐，spec 数据流搜索从「两套名猜映射」降为「单锚点」；「当前场景有 4 个模型」直达 registry/content，不再在 built/ModelEntry/模型 三词兜圈；新格式适配器入口名可预期。

**负面/成本**：内容层改名（2.3）与 unload-role 文案（2.4）触及 mount-preview-core 及全部适配器/视图引用，须分批实施、测试兜底（mount-preview-core.behavior.test.ts 等）；前端 spec 类型改名可能波及相关视图 import，由类型别名过渡。

**已知遗留**：JS/Go spec 双实现口径不一致不属本 ADR 范围；`ModelGroup` JSON 契约名长期保留（改 tag 属破坏性变更，另立 ADR）；路径漂移类文档基线（utils/3d）由知识卡同步逐步修正。

**兼容红线**：JSON 契约（tag/字段）零改动；Wails 绑定签名零改动；Go/绑定层不承担本次改名成本。

## 4. 数据溯源

来源 → 结果：

- `go/threejs/spec.go`（`Model3DSpec`/`ModelGroup`/`BoneData`/`MeshData`）→ JSON 契约唯一事实源（2.1）
- `bindings/.../go/threejs/models.ts` → 绑定镜像，前端类型锚点（2.1）
- `frontend/src/preview-3d/model3d.ts`（`Spec3D` 族）→ 降级镜像层，声明式等价（2.1）
- `mount-preview-core.ts`（`built`/`allBuilt`/`getBuilt`）→ 改 `content` 口径（2.3）
- `scene-registry.ts`（`ModelEntry`，ADR-159）→ 注册条目尺度锚点（2.2/2.4）
- `unload-role.ts`（角色卸载）→ 文案与内部词收敛「模型实例」（2.4）
- `ysm-adapter.ts`/`pack-model-adapter.ts`（make 工厂）→ 工厂命名章程范式（2.5）
- `docs/knowledge/model3d.md`/`preview_core.md` → 词汇字典落点（2.2 词表同步）

<!-- 文件名: render-vocabulary-charter.md → 实际文件 ADR-161-render-vocabulary-charter.md -->
