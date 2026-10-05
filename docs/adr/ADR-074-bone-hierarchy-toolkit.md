# ADR-074：3D 骨骼层级通用工具：统一 YSM/MMD/VRM 的骨骼列表·拾取·显隐

- **状态**：✅ 已采纳
- **日期**：2026-08-16
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`ADR-066 全资源预览器, ADR-072 3D 适配器层下沉, ADR-073 联邦渲染能力共享`

---

## 1. 背景（Context）

### 1.1 骨骼交互目前是 YSM 独占且自建

3D 预览里「点骨骼看路径/坐标、列表勾选显隐、全显/全隐」这套交互，目前只有 YSM 有，且是**自建绑定 ysm 数据结构**：

- `utils/3d/bone-list.ts` — `getBoneList(spec: Spec3D)`，依赖 ysm 的 `Spec3D.bones` 提取 `{id,name,parentId}`。
- `utils/3d/bone-raycast.ts` — `buildBoneHierarchy(spec)` + `registerBoneRaycast(renderer, camera, scene, boneGroupMap, nameMap, parentMap, childrenMap, state)`，核心依赖 `boneGroupMap: Map<string, THREE.Group>`（boneId → 骨骼 Group）与「`Group.name === boneId`」约定。
- `utils/3d/bone-visibility.ts` — `setBoneVisible/toggleBone(boneGroupMap, name, visible)`，**已天然通用**（只吃 `Map<string, Object3D>`），是三者里唯一无 Spec3D 耦合的。

### 1.2 MMD / VRM 的骨骼数据闲置

- **MMD**（`@moeru/three-mmd`）：`pmx.bones`（骨骼元数据：name/position/parentIndex）+ `skeleton`（THREE.Skeleton 蒙皮）。当前 adapter **只在日志打印 `bones=n`**，零交互。
- **VRM**（`@pixiv/three-vrm`）：`vrm.humanoid`（标准人形骨骼，`getNormalizedBoneNode(...)` 返回 Object3D）。当前 adapter **只 `vrm.update` 驱动 SpringBone/表情**，零骨骼交互。

三者都有「骨骼 = Object3D 树 + id/name 元数据」的同构事实，但只有 YSM 实现了交互，且实现绑死 ysm 的 `Spec3D`/`boneGroupMap`，mmd/vrm 复用不了。

### 1.3 与 ADR-073 联邦能力方向呼应

ADR-073 确立「联邦渲染能力共享」（天空能力已落地 L1）。骨骼交互同属「格式无关的预览能力」，应走同一治理语言：**能力收敛到通用工具，格式只提供适配器**。

---

## 2. 决策（Decision）

**抽通用骨骼工具层，三格式经「格式 → BoneRef」适配器接入**，复用同一套列表/拾取/显隐/详情。

### 2.1 核心抽象：`BoneNode`（实现落地命名，见 `utils/3d/bone-tools.ts`）

```ts
// 骨骼节点：格式无关的「骨骼 = Object3D + 元数据」最小契约
interface BoneNode {
  id: string;                 // 稳定标识（ysm boneId / mmd bone name / vrm humanoid bone name）
  name: string;               // 显示名
  parentId: string | null;    // 父骨骼 id（根为 null）
  object?: THREE.Object3D;    // 骨骼对应的 Object3D（ysm Group / mmd Bone / vrm normalized node），可选
}
```

> 注：本 ADR 初稿用 `BoneRef` 命名，与并行落地的 `bone-tools.ts` 实现（`BoneNode`）撞车；以实现为准统一为 `BoneNode`。

### 2.2 通用工具（`utils/3d/bone-tools.ts`，纯逻辑零 DOM）

| 函数 | 职责 | 对应旧 ysm 散件 |
|------|------|---------|
| `buildBoneTree(bones)` | 建树（byId/childrenMap/roots） | `buildBoneHierarchy(spec)` |
| `listBonesWithDepth(tree)` | 深度缩进列表 | `bone-list.ts getBoneList(spec)` |
| `getBonePath` / `getBonePosition` / `getBoneDetail` | 路径/坐标/详情 | `bone-raycast.ts` 内联 |
| `setBoneVisible` / `toggleBoneVisible` | `object.traverse(visible)` | `bone-visibility.ts` |
| `pickBone(raycaster, meshes, tree)` | Raycaster 命中 mesh → 沿父链归属骨骼 | `registerBoneRaycast` |

**策略（对齐实现）**：不推倒旧 `bone-list`/`bone-raycast`/`bone-visibility`，通用工具独立成层；ysm 是否桥接进通用工具属后续任务（实现注释「任务 #5」），当前 ysm 仍走旧散件、mmd/vrm 走通用工具。

**mmd 骨骼拾取特殊性**：`THREE.Bone` 无几何（`intersectObjects` 不命中），改「射线到骨骼世界坐标距离」法（`mmd-bones.ts pickMmdBone`），故 mmd 独立实现拾取，未并入 `pickBone`。

### 2.3 格式适配器（各提供一个「格式 → 通用/独立工具」输入）

- **ysm**：`Spec3D.bones` + `boneGroupMap` → `BoneNode`（object = `boneGroupMap.get(id)`），暂走旧散件。
- **mmd**：`pmx.bones`（name/parentBoneIndex/position）+ `mesh.skeleton.bones`（索引对齐）→ `mmd-bones.ts`（`buildMmdBoneTree`/`pickMmdBone`/`getMmdBoneDetail`，已落地）。
- **vrm**：`vrm.humanoid` 骨骼名 → `getNormalizedBoneNode(name)`，待接。

### 2.4 分阶段

- **S1（进行中）**：通用工具 `bone-tools.ts` + mmd 适配 `mmd-bones.ts` 落地（并行代理实现，主模型抽查通过）。
- **S2**：mmd 骨骼交互接 UI（拾取/列表/显隐 → 预览面板）。
- **S3**：vrm 接入（Humanoid 骨骼列表/拾取）。
- **S4**：ysm 桥接进通用工具（评估后，旧散件收敛）。

---

## 3. 后果（Consequences）

### 正面
- **三格式共享骨骼交互**：mmd/vrm 的骨骼数据不再闲置，点骨骼/列表/显隐一套代码，与 ADR-073 联邦方向一致。
- **贴合 three 生态**：`BoneRef.object` 直接是 `THREE.Object3D`（ysm Group / mmd Bone / vrm node），拾取用 `THREE.Raycaster`、显隐用 `visible`、层级用 parent 链——不发明并行结构。
- **消除 ysm 独占**：`bone-*` 散件从「绑 Spec3D」收敛为「吃 BoneRef」，新增格式只写 `xxxToBoneRefs`。

### 负面 / 风险
- 🔴 **ysm 拾取行为回归风险**：拾取判定从「name 匹配」改「object 引用匹配」，ysm 的 cube mesh 与骨骼 Group 的挂载约定（`getMeshBoneId` 沿父链找 isGroup）须在 `specToBoneRefs` 里保持等价，否则点骨骼命中错位。S1 须迁移 `bone-raycast` 相关测试（`model3d.test.ts` 骨骼拾取用例）。
- 🟡 **mmd 骨骼 parentIndex → parentId**：pmx 的 parentIndex 是索引非 id，需在 `pmxBonesToRefs` 里转成 id 链，且部分 mmd 骨骼（IK/物理刚体）无对应 Object3D，需过滤。
- 🟢 **vrm Humanoid 覆盖面**：Humanoid 只覆盖标准人形骨骼，扩展骨骼（SpringBone 链）不在列表内（与 ysm 的 arm 组件独立树同理，先覆盖 main 骨骼）。

### 已知遗留
- 动画统一（自写 `animation.ts` 插值 → `THREE.AnimationMixer`）不在本 ADR 范围，属后续（本 ADR 只收敛「骨骼层级」交互，不含动画驱动）。

---

## 4. 数据溯源

- **来源**：用户反馈「mmd 也有骨骼层级，是不是得视为通用工具」+ 代码审计 `utils/3d/bone-*`（bone-list 绑 Spec3D、bone-raycast 绑 boneGroupMap、bone-visibility 已通用）+ `adapters/mmd-adapter.ts`（pmx.bones 仅日志）、`adapters/vrm-adapter.ts`（仅 vrm.update，无骨骼交互）→ 结果：三格式骨骼数据同构、交互 ysm 独占自建，立项通用工具。
- **落点**：`utils/3d/bone-hierarchy.ts`（新）+ 三格式适配器 + `bone-list`/`bone-raycast`/`bone-visibility` 收编。

<!-- 文件名: bone-hierarchy-toolkit.md → 实际文件 ADR-074-bone-hierarchy-toolkit.md -->
