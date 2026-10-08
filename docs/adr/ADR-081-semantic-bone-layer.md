# ADR-081：语义骨骼层——跨格式语义骨骼统一抽象

- **状态**：❌ 已取代
- **被取代**：被 [ADR-083](./ADR-083-semantic-layer.md) 同日重写为双抽象（语义骨骼 + 语义 morph + 感知层）——本 ADR 的语义骨骼层为 ADR-083 §2.1 子集，MMD 歧义消解三条与「YSM 不接入」裁定逐字保留；23 个语义 id 清单见源码 `semantic-bones.ts`
- **日期**：2026-08-17
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`frontend/src/preview-3d/bone/semantic-bones.ts`、`frontend/src/utils/3d/perception/`、`frontend/src/preview-3d/adapters/mmd/mmd-adapter.ts`、`vrm-adapter.ts`、`mount-preview-core.ts`、借鉴 [MikuMikuAR](https://github.com/eghrhegpe/MikuMikuAR) `motion-algos/proc-motion-shared.ts`（候选名匹配表）、`scene/perception/`（感知层）

---

## 1. 背景（Context）

### 1.1 三个资源格式的骨骼命名天差地别

YSM 模型管理器同时管理三种 3D 格式：**YSM**（方块人自定义皮肤）、**VRM**（VRChat 头像标准）、**MMD**（MikuMikuDance 模型）。三者的骨骼结构完全不同：

| | 骨骼形态 | 语义来源 |
|---|---|---|
| **VRM** | `vrm.humanoid.humanBones` 52 个标准骨骼 | ✅ VRM 规范天然语义化，`id = HumanoidBoneName`（如 `hips`/`chest`/`leftUpperArm`） |
| **MMD** | `pmx.bones[]` 索引结构，名字随意（`上半身`/`頭`/`左腕`…） | ❌ 无标准语义，日英混用、繁简体变体共存 |
| **YSM** | `spec.bones[]` 作者自由命名（`root`/`head`/`arm`…） | ❌ 无标准，低模方块人骨骼随意，命中率低 |

现有的 `BoneNode`（`bone-tools.ts`）只有 `id/name/parentId/object`，**没有任何语义维度**。这导致：

- 感知层（呼吸/眨眼/注视）无处下手——呼吸该动哪根骨？不同格式叫法完全不同
- 程序化动作（AutoDance/LipSync）无法跨格式复用
- 每个格式各自写一套骨骼操作代码，违反「通用化、统一、复用」的设计偏好

### 1.2 隔壁 MikuMikuAR 的解法

MikuMikuAR（隔壁 MMD 查看器）用**候选名匹配表**解决 MMD 内部的多命名变体问题（`BONE_SHOULDER_L_CANDIDATES = ['左肩','left shoulder','LeftShoulder',...]`）。但这只覆盖 MMD 单一格式，无法跨 YSM/VRM/MMD 统一。

### 1.3 用户诉求

> 「当前是个横跨三个资源的项目呢，是不是得整点通用骨骼映射啥的」

用户明确要求**通用骨骼映射**，让跨格式的消费方（感知层/程序化动作）能统一调用。

---

## 2. 决策（Decision）

### 2.1 语义枚举基准：直接采用 VRM humanoid 52 骨骼名

**选择**：以 VRM humanoid 标准骨骼名为基准，定义 23 个核心语义骨骼 id（覆盖感知层实际需要的子集）。

**理由**：
- VRM 的 humanoid 规范是业界最成熟的人形骨骼语义标准，three-vrm 直接提供（白送）
- 未来新增格式只需把骨骼名映射到这 23 个 id 上，零枚举变更
- 比自建命名空间更贴近社区惯例，降低维护成本

**当前语义骨骼 id（23 个）**：
```
center, hips, spine, chest, upperChest, neck, head,
leftEye, rightEye,
leftShoulder, rightShoulder,
leftUpperArm, rightUpperArm, leftLowerArm, rightLowerArm,
leftHand, rightHand,
leftUpperLeg, rightUpperLeg, leftLowerLeg, rightLowerLeg,
leftFoot, rightFoot
```

> `center` 为 MMD 特有（センター/全ての親 整体位移根），VRM 无等价——命中时填入，缺失时消费方优雅降级。

### 2.2 候选名匹配表：MMD 移植自 MikuMikuAR，YSM 暂不接入

**MMD**：从 `MikuMikuAR/frontend/src/motion-algos/proc-motion-shared.ts` 移植候选名表，补充 VRM 语义名的英文变体（如 `leftUpperArm` 加入 MMD 常见导出名 `LeftArm`/`left arm`）。关键歧义消解：
- `上半身` → `chest`（呼吸主骨）
- `上半身2` → `upperChest`（独占，不污染 chest）
- `腰` → `hips`（pelvis 位置，对齐 VRM 语义）

**YSM 不接入**：spec.bones 作者自由命名无标准，低模方块人骨骼通常只有 `root`/`head`/`arm` 等几个，语义映射命中率极低；维护候选表成本高、收益有限。YSM 的骨骼面板等功能不受影响（仍走原有 `bone-tools.ts`）。

**VRM**：humanoid.humanBones 的键就是语义名，零候选匹配，直产映射。

### 2.3 解析器设计：宽容缺省 + 格式特化入口

**核心接口**（`semantic-bones.ts`）：
- `matchSemanticBone(tree, candidates)` —— BoneTree 中按候选名匹配首个骨骼（name 优先、id 兜底；候选顺序 = 优先级）
- `resolveSemanticBones(tree, candidates)` —— BoneTree + 候选表 → SemanticBoneMap（缺键跳过，宽容）
- `getSemanticBone(map, id)` —— 消费方唯一入口，缺失返回 null（优雅降级）
- `vrmSemanticBoneMap(humanBones)` —— VRM 特化：零匹配直产
- `mmdSemanticBoneMap(tree)` —— MMD 特化：内置候选表

**SemanticBoneMap**：`Partial<Record<SemanticBoneId, { id: string; object?: Object3D }>>`，缺省语义不进 map，消费方 `getSemanticBone` 返回 null。

### 2.4 PreviewScene 新增可选字段

`mount-preview-core.ts` 的 `PreviewScene` 接口新增：
```ts
semanticBones?: SemanticBoneMap;
```
可选字段，向后兼容——YSM/Litematic 无此字段，消费方检查 undefined 跳过。

### 2.5 感知层消费方：骨骼驱动 vs morph 驱动分层

- **骨骼驱动**（呼吸/注视）：消费语义骨骼 map，Three.js 直接改 `object.rotation/position`，YSM/VRM/MMD 通吃
- **morph 驱动**（眨眼/LipSync）：各格式机制不同（MMD: `mmd.morphs[name]`，VRM: `vrm.expressionManager.setValue(name, weight)`），暂由各适配器自行实现，不走语义层——待未来统一 morph 语义层后再抽象

---

## 3. 后果（Consequences）

### 3.1 正面

- **消费方一次写、三种格式通用**：呼吸/注视写一次，VRM 拿 humanoid 免费映射，MMD 走候选匹配，未来新格式只要建候选表
- **宽容缺省不崩**：某模型缺 chest 骨 → 呼吸静默跳过该骨，不阻断预览
- **语义层与格式层解耦**：`semantic-bones.ts` 纯逻辑零 DOM 零 backend（ADR-072 工具层纯净），可独立测试
- **为后续功能铺路**：语义层地基已稳，AutoDance/LipSync/姿势预设等 A 档功能可直接消费语义骨骼

### 3.2 负面

- **候选表维护责任**：MMD 骨骼命名变体无穷——新模型可能含未覆盖的命名（如 `chest2`/`upperBody`），需要持续扩展候选表
- **语义层新增格式需手动接入**：每新增一个 3D 格式，需在对应 adapter build 时构建并填入 `semanticBones`
- **语义枚举固定为 23 个**：若未来消费方需要更多语义骨骼（如手指），需扩展枚举

### 3.3 已知遗留

- **YSM 语义骨骼未接入**：待 YSM 出标准骨骼命名约定后再评估
- **morph 语义层未建立**：眨眼/LipSync 仍各适配器自行实现，未统一
- **候选表未自动化覆盖检测**：暂无机制发现"某模型骨骼名未命中任何语义"的情况（监控/告警）

---

## 4. 数据溯源

| 来源 | 内容 | 落地 |
|---|---|---|
| 用户对话（「当前是个横跨三个资源的项目呢，是不是得整点通用骨骼映射啥的」） | 提出跨格式语义骨骼需求 | §1.3 背景 |
| MikuMikuAR `motion-algos/proc-motion-shared.ts` | 候选名匹配表（BONE_*_CANDIDATES）+ matchBone 逻辑 | §2.2 MMD 移植 |
| MikuMikuAR README（"程序化生命力"特性） | 呼吸/眨眼/注视追踪的需求印证 | §1.2 动机 |
| three-vrm `VRMHumanBoneName`（52 标准骨骼） | VRM humanoid 语义基准 | §2.1 枚举选择 |
| 本机调研（`grep VRM humanoid bone`） | YSM 无标准、MMD 多命名变体、VRM 天然语义 | §1.1 现状分析 |
| `docs/knowledge/bone-tools.md` | 现有 BoneNode/BoneTree 抽象已跨 YSM/VRM，但无语义维度 | §1.1 缺口分析 |

---

<!-- 文件名: semantic-bone-layer.md → 实际文件 ADR-081-semantic-bone-layer.md -->
