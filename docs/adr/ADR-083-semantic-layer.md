# ADR-083：语义层双抽象——跨格式语义骨骼 + 语义 morph + 感知层程序化生命力

- **状态**：✅ 已采纳
- **日期**：2026-08-17
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`frontend/src/preview-3d/bone/semantic-bones.ts`、`frontend/src/preview-3d/infra/semantic-morphs.ts`、`frontend/src/utils/3d/perception/`、`frontend/src/preview-3d/adapters/mmd/mmd-adapter.ts`、`vrm-adapter.ts`、`docs/adr/ADR-081-semantic-bone-layer.md`、借鉴 [MikuMikuAR](https://github.com/eghrhegpe/MikuMikuAR) `motion-algos/`、`scene/perception/`

---

## 1. 背景（Context）

### 1.1 三格式骨骼/morph 命名天差地别

YSM 模型管理器同时管理 **YSM / VRM / MMD** 三种 3D 格式。各自的骨骼和 morph 命名完全不同：

| | 骨骼命名 | morph/表情命名 |
|---|---|---|
| **VRM** | humanoid.humanBones 52 个标准名（hips/chest/head/...） | expressionManager 标准表达（blink/lookLeft/aa/ee...） |
| **MMD** | pmx.bones 随意命名（上半身/頭/左腕/...），日英混用 | pmx.morphs 随意命名（まばたき/あ/い/...） |
| **YSM** | spec.bones 作者自由命名（root/head/arm...） | ❌ 无标准 morph 系统 |

现有 `BoneNode`（`bone-tools.ts`）只有 `id/name/parentId/object`，**无语义维度**。这导致：
- 感知层（呼吸/眨眼/注视/LipSync/AutoDance）无处下手
- 每个格式各自写一套骨骼操作代码，违反「通用化、统一、复用」的设计偏好

### 1.2 隔壁 MikuMikuAR 的解法与局限

MikuMikuAR 用**候选名匹配表**解决 MMD 内部多命名变体（`BONE_SHOULDER_L_CANDIDATES` 等）。但这只覆盖 MMD 单一格式，无法跨 YSM/VRM/MMD 统一。且其程序化动作全部生成 VMD 字节（需 `encoding-japanese` 依赖）。

### 1.3 用户诉求

> 「当前是个横跨三个资源的项目呢，是不是得整点通用骨骼映射啥的」

用户明确要求**通用骨骼映射**，让跨格式的消费方（感知层/程序化动作）能统一调用。

### 1.4 VMD 文件实际结构调研

通过解析测试文件夹中的 VMD 文件（`斜坐_by_raven10086.vmd`、`街舞《Booty Music》...vmd` 等），确认：
- three-mmd 的 `VmdObject.ParseFromBuffer` 已正确处理 Shift-JIS 骨骼/morph 名
- VMD 中确实包含 `まばたき`（眨眼）、`あ/い/う/え`（口型）等 morph 关键帧
- **不需要引入 `encoding-japanese`**——three-mmd 内置解析

### 1.5 morph 权重运行时写入机制

通过分析 three-mmd 源码（`dist/index.js` line 3956-3959、4086-4102），确认：
- PMX morphs 被转为 Three.js `morphTarget`，通过 `mesh.morphTargetDictionary`（name→index）暴露
- 直接写 `mesh.morphTargetInfluences[index] = weight` 即可控制 morph
- **无需 VMD writer，无需 encoding-japanese**

---

## 2. 决策（Decision）

### 2.1 语义骨骼层（SemanticBoneLayer）

**语义枚举基准**：直接采用 VRM humanoid 52 骨骼名中的 23 个核心 id（覆盖感知层实际需要）。

**MMD 适配**：从 MikuMikuAR `proc-motion-shared.ts` 移植候选名匹配表，补充 VRM 语义名英文变体。关键歧义消解：
- `上半身` → `chest`（呼吸主骨）
- `上半身2` → `upperChest`（独占，不污染 chest）
- `腰` → `hips`（pelvis 位置，对齐 VRM 语义）

**YSM 不接入**：spec.bones 作者自由命名无标准，低模方块人骨骼通常只有 `root/head/arm` 等几个，语义映射命中率极低；维护候选表成本高、收益有限。YSM 骨骼面板等功能不受影响。

**VRM 直产**：humanoid.humanBones 的键天然就是语义名，零候选匹配。

**接口设计**（`semantic-bones.ts`）：
- `matchSemanticBone(tree, candidates)` — BoneTree 中按候选名匹配首个骨骼
- `resolveSemanticBones(tree, candidates)` — BoneTree + 候选表 → SemanticBoneMap（缺键跳过，宽容）
- `getSemanticBone(map, id)` — 消费方唯一入口，缺失返回 null
- `vrmSemanticBoneMap(humanBones)` — VRM 特化：零匹配直产
- `mmdSemanticBoneMap(tree)` — MMD 特化：内置候选表

**PreviewScene 新增**：`semanticBones?: SemanticBoneMap`（可选字段，向后兼容）

### 2.2 语义 morph 层（SemanticMorphLayer）

与语义骨骼层对称设计：

**语义 morph id（7 个）**：
```
blink, blinkLeft, blinkRight, lipOpen, lipClose, lipPucker, lipSmile
```

**MMD 候选名表**（`semantic-morphs.ts`）：
- `blink`: `まばたき/blink/Blink/眨眼/wink/EyeClose/眼/目/閉眼`
- `lipOpen`: `あ/ア/A/a/口/mouth/open`
- 其他 morph 类似

**VRM 适配**：通过 `vrm.expressionManager` 的标准表达名匹配（`blink/lookLeft/aa/ee...`）。

**接口设计**（`semantic-morphs.ts`）：
- `matchSemanticMorph(morphNames, candidates)` — morph 名列表中按候选匹配
- `resolveSemanticMorphs(morphNames, candidates)` — 解析为 SemanticMorphMap
- `mmdSemanticMorphMap(morphs)` — MMD 特化
- `getSemanticMorph(map, id)` — 消费方唯一入口

### 2.3 感知层程序化生命力（Perception Layer）

消费方只认语义层接口，不关心格式：

| 模块 | 驱动方式 | 适用格式 | 待机态 |
|---|---|---|---|
| **呼吸**（breath） | 骨骼 position/rotation 正弦偏移 | VRM/MMD | ✅ |
| **注视**（gaze） | 骨骼 rotation 跟随相机 yaw/pitch | VRM/MMD | ✅ |
| **眨眼**（blink） | morph weight 三角波（随机间隔 2-5s） | MMD/VRM | ✅ |
| **LipSync** | amplitude→morph weight（待机用呼吸相位模拟） | MMD/VRM | ✅ |
| **AutoDance** | BPM 节拍驱动骨骼正弦律动（4拍呼吸调制） | MMD/VRM | ✅ |

**关键设计**：
- 所有感知层在 VMD 动画播放时自动暂停（`!action || action.paused` 守卫），不跟动画打架
- Gaze 始终生效（动画中头也跟随相机，增强生命力）
- Blink/LipSync 通过 callback 解耦：controller 负责时序，callback 负责格式特化写入
- AutoDance 直接改骨骼变换（不生成 VMD），与 breath/gaze 同模式叠加

### 2.4 VPD 姿势导入

MMD 专属功能，使用 three-mmd 已有的 `VPDLoader` + `applyVPD` API。Adapter build 时扫描同目录 `.vpd` 文件，缓存 parsed VpdObject，通过 `PreviewScene.applyPose(index)` 触发应用。

---

## 3. 后果（Consequences）

### 3.1 正面

- **消费方一次写、两种格式通用**：呼吸/注视/AutoDance 写一次，VRM/MMD 通吃
- **语义 morph 层让 blink/lipSync 也可跨格式**：MMD 走 morphTargetDictionary，VRM 走 expressionManager，消费方统一接口
- **宽容缺省不崩**：某模型缺 chest 骨或 blink morph → 该感知模块静默降级
- **零新依赖**：不引入 `encoding-japanese`，不引入 Babylon.js
- **为后续功能铺路**：语义层地基已稳，AutoDance 完整版、多 morph 表情预设、动作重定向等可直接消费

### 3.2 负面

- **候选表维护责任**：MMD 骨骼/morph 命名变体无穷——新模型可能含未覆盖的命名，需要持续扩展候选表
- **语义层新增格式需手动接入**：每新增一个 3D 格式，需在对应 adapter build 时构建并填入 semanticBones/semanticMorphs
- **语义枚举固定**：骨骼 23 个、morph 7 个；未来需要更多时需扩展枚举

### 3.3 已知遗留

- **YSM 语义层未接入**：待 YSM 出标准骨骼/morph 命名约定后再评估
- **AutoDance 简化版**：当前是简化实现（单正弦源 + 4拍呼吸调制），未移植 MikuMikuAR 的 beatBounce/downbeatWeight/肘部 follow-through 完整算法
- **LipSync 无真实音频源**：当前用呼吸相位模拟待机张嘴，真实 Web Audio API 分析待后续接入
- **语义 morph 层 VRM 适配未完成**：目前仅 MMD 走语义 morph 层，VRM 的 blink 仍直接操作 expressionManager（可后续统一）

---

## 4. 数据溯源

| 来源 | 内容 | 落地 |
|---|---|---|
| 用户对话（「跨三个资源」「通用骨骼映射」） | 提出跨格式语义需求 | §1.3 |
| MikuMikuAR `motion-algos/proc-motion-shared.ts` | 候选名匹配表 + matchBone 逻辑 | §2.1/2.2 |
| MikuMikuAR README（"程序化生命力"特性） | 呼吸/眨眼/注视/节拍律动需求印证 | §1.2 |
| three-mmd 源码分析（`dist/index.js` line 3956-3959, 4086-4102） | morphTargetDictionary/influences API 发现 | §1.5 |
| VMD 文件二进制解析（实际测试文件） | 确认 Shift-JIS 解析正确 + morph 帧存在 | §1.4 |
| `docs/knowledge/bone-tools.md` | 现有 BoneNode/BoneTree 抽象已跨 YSM/VRM，但无语义维度 | §1.1 |
| VRM 规范（52 humanoid bones） | 语义枚举基准选择 | §2.1 |

---

<!-- 文件名: semantic-layer.md → 实际文件 ADR-083-semantic-layer.md -->
