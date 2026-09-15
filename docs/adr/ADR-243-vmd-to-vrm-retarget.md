# ADR-243：VMD 动作重定向到 VRM 人形骨骼（跨格式动作复用）

- **状态**：已采纳（Accepted）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-15
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`frontend/src/preview-3d/adapters/vrm/vrm-adapter.ts; frontend/src/preview-3d/adapters/mmd/mmd-build-anim.ts; frontend/src/preview-3d/bone/semantic-bones.ts; frontend/src/preview-3d/bone/ik-solver.ts; frontend/src/preview-3d/bone/mmd-foot-ik.ts; frontend/src/preview-3d/adapters/mmd/mmd-anim-library.ts; 依赖 @moeru/three-mmd 的 buildAnimation 与 @pixiv/three-vrm 的 getNormalizedBoneNode; ADR-066（通用资源预览）; ADR-081（语义骨骼层）; ADR-231（preview-3d adapters 层）`

---

## 1. 背景（Context）

### 1.1 生态现实：VRM 动作面板常年空态

VRM 预览的动作通道只认 `.vrma`（`vrm-adapter.ts:381` 扫同目录、`:401` 走 `createVRMAnimationClip`）。而 `vrm-adapter.ts:788` 的注释早已自认这个现实：

> VRMA 在现实生态里极稀少（MMD 圈产 VMD、动捕产 FBX，无人专门产 .vrma）

结果是 VRM 模型的动作面板绝大多数时候是空态引导（`vrma-play-empty`）。与此同时，项目**已经能播 VMD**——但只在 MMD 适配器里，且只喂给 PMX 网格。动作资产在仓库里躺着，VRM 侧够不着。

### 1.2 两条通道各自为政，中间无桥

| 侧 | 入口 | 目标骨骼 | 轴系处理 |
|---|---|---|---|
| MMD | `mmd-build-anim.ts:48` `buildAnimation(vmd, c.mesh)` | PMX 骨架（`mesh.skeleton.bones`） | 内建 |
| VRM | `vrm-adapter.ts:401` `createVRMAnimationClip(anims[0], vrm)` | VRM humanoid | 由 `.vrma` 格式自带 |

两者都通了，缺的是中间那一段**跨格式重定向**。

### 1.3 反例实证：直接喂会得到空轨道

`@moeru/three-mmd/dist/index.js:4110-4118`（`buildSkeletalAnimation`）的过滤逻辑：

```js
const bones = mesh.skeleton.bones;
for (...) boneNameDictionary[bones[i].name] = true;
...
if (boneNameDictionary[boneName] == null) continue;   // ← VMD 的「頭」「左腕」在 VRM 骨架里一个都不存在
```

即：**把 VRM 的 SkinnedMesh 直接传给 `buildAnimation` 会全部 skip，产出 `tracks: []` 的空 clip**。这不是猜测——上游 SystemAnimatorOnline 的 issue #107 报的正是这个症状，作者答复「You can't directly apply VMD motion on VRM model, because the bone naming and struture are different. **You need retargeting.**」

### 1.4 关键利好：three-vrm 已把「静止位姿校正」白送

重定向通常在「静止位姿差」上花掉大半精力——MMD 骨骼局部静止旋转是单位四元数，而一般 VRM 骨骼带任意静止旋转，直接的公式是 `l = P_parent⁻¹ · q · P_parent · r_bone` 这类带父链累积的共轭。

但 `@pixiv/three-vrm-core` 的 `VRMHumanoidRig._setupTransforms` 构造归一化骨骼时**只 `position.copy(...)`，从不设 `quaternion`**；`VRMHumanoid.update()` 负责把归一化位姿用 `_parentWorldRotations` / `_boneRotations` 烘回原始骨骼（`autoUpdateHumanBones` 默认 `true`）。`normalizedHumanBonesRoot` 由 loader 挂到 `gltf.scene`（`three-vrm-core.cjs:2275`）。

⇒ **归一化骨骼的静止位姿同样是单位四元数，与 MMD 同构**。往 `getNormalizedBoneNode(name)` 上写即得正确结果，静止位姿校正这一项整个消失。

旁证方向一致：官方 `.vrma` 路径（`@pixiv/three-vrm-animation`）里 `getNormalizedBoneNode(name)` 正是 humanoid 轨道创建的落点——**归一化骨骼就是官方设计的重定向靶面**。

### 1.5 MIT 之外的既有资产（本次不新增轮子）

- `bone/ik-solver.ts:98` `solveIK()` —— 自写 CCD 求解器 + 极向量 + 角度钳制（`ik-solver.ts:14` 记参考 babylon-mmd）；`:219` `extractIKChainFromTree()`。
- `bone/mmd-foot-ik.ts:27` `createFootIKController()` —— **格式无关**（吃 `BoneTree` + `SemanticBoneMap`），`vrm-adapter.ts:478` 已把它接进 VRM 适配器。
- `bone/semantic-bones.ts` —— MMD 候选名匹配表 + `matchSemanticBone()` 匹配算法。
- `adapters/mmd/mmd-anim-library.ts:12` `getCustomAnimPath()` / `:24` `filterAnimFiles()` —— MMD 动作库路径与筛选。

### 1.6 用户诉求

> 「VMD→VRM 重定向，想实现这个功能，难度如何」

---

## 2. 决策（Decision）

在两条已通的通道之间，新增一段**窄的重定向层**。管线（本 ADR 只裁这一刀）：

```
VMD 文件
  ↓ VmdObject.ParseFromBuffer（已有）
重定向层（本次新增：映射表 → 幽灵骨架 → 轨道名重写 → 位移缩放）
  ↓ 写 VRM 归一化骨骼（getNormalizedBoneNode）
vrm.update()  ← 静止位姿校正由 three-vrm 自动完成
  ↓
原始骨骼 → 渲染
```

### 2.1 复用 `buildAnimation` 的三样白送产物，用「幽灵骨架」绕开它的网格绑定

`buildAnimation` 对本次有价值的三件事（均已在源码核实）：

| 产物 | 出处 | 价值 |
|---|---|---|
| 手性翻转 `(-rx,-ry,rz,rw)` | `index.js:4137-4140` | MMD（左手系）→ three.js（右手系）的轴系转换，**不必重写** |
| 逐轴贝塞尔插值 | `index.js:4041-4069` `_createTrack` 把 `CubicBezierInterpolation` 挂为 track 的 `createInterpolant` 实例方法 | MMD 关键帧的 X/Y/Z/R 四曲线平滑，**模块私有、未导出，无法复用其代码** |
| 位置偏移合成 | `index.js:4134-4136` `basePosition + (px, py, -pz)` | VMD 位移是「相对静止位置的偏移」，需与靶骨骼静止位置相加 |

第二项是关键：`CubicBezierInterpolation` **没有导出**，自己重写整个 MMD 贝塞尔求值不现实。但 `buildAnimation` 只从传入的 `mesh.skeleton` 取两样东西——**骨骼名**（做白名单过滤）与**骨骼静止 position**（做 `basePosition`）。所以可以反用它：

**幽灵骨架（ghost skeleton）构造**：

1. 遍历映射表（§2.2）中所有「有候选名」的 VRM 骨 id，对每个 id 在 VMD 侧解析出的 MMD 骨骼名，创建一个 `THREE.Bone`，`bone.name = <MMD 骨骼名>`（含日文/全角字符无妨——我们只读 `clip.tracks` 的 `values`，不走 PropertyBinding 解析这些名字）。
2. `bone.position` = 该 MMD 骨映射到的 **VRM 归一化骨骼节点的局部 position**。
   ⚠️ 这一步不是可选项：`basePosition` 会被加到每条 position 轨道上，若填幽灵自己的坐标，重写轨道名绑到 VRM 归一化节点后会把骨骼每帧拽到错误位置。
3. 组装成 `THREE.Skeleton(bones)` + 一个极简 `SkinnedMesh` 承载它（只为满足 `buildAnimation(vmd, mesh)` 的签名）。
4. `buildAnimation(vmd, ghostMesh)` → 得到带 MMD 贝塞尔插值的 `AnimationClip`。

### 2.2 轨道名重写：原地改 `name`，不重建 track

`buildAnimation` 产出的轨道名为 `.bones[<MMD骨骼名>].position` / `.quaternion`（`index.js:4144-4146`），另有一批 morph 轨道（`buildMorphAnimation`）对 VRM 无效。

重写规则：
- `.bones[<MMD名>].quaternion` → `<VRM归一化骨骼节点 uuid>.quaternion`
- `.bones[<MMD名>].position` → `<VRM归一化骨骼节点 uuid>.position`（仅根位移骨需要，见 §2.4）
- 以 `.morphTargetInfluences` 开头的轨道 → 丢弃（表情走另一个决策，见 §2.9）

绑 uuid 而非 name 的理由：归一化节点名是 `"Normalized_" + <原始骨骼名>`，而原始骨骼名是模型作者自定义的（可能含空格/日文），PropertyBinding 的名字解析有风险；而 `Object3D.getObjectByName` 同时匹配 `name` 与 `uuid`，uuid 是零歧义路径。`vrm-adapter.ts:408` 的 mixer root 是 `vrm.scene`，`normalizedHumanBonesRoot` 是其直接子节点 ⇒ 遍历可命中。

⚠️ **必须原地改 `track.name`，禁止 `new QuaternionKeyframeTrack(...)` 重建**——贝塞尔插值是挂在原 track 对象上的 `createInterpolant` 覆写方法，重建即丢失，MMD 动作会从平滑贝塞尔退化成线性插值（视觉上「卡点顿挫」，且这种劣化不会报错，极易漏检）。这是本 ADR 最容易被实现者踩掉的一条。

### 2.3 骨架映射表 v1（新表，不动语义层）

**靶面**：VRM humanoid 全量骨骼。以 `@pixiv/three-vrm-core` 的 `VRMHumanBoneList` 为权威清单，实为 **55 项**（`VRMHumanBoneName.d.ts`；项目文档惯称「52」是 VRM 0.x 时代的旧数，本次以依赖清单为准）。

**表形状**：`Record<VrmHumanoidBoneName, readonly string[]>`（候选名列表，顺序即优先级），**不扩 `SemanticBoneId`**。

不扩语义层的理由：ADR-081 §2.1 明确语义层 23 骨是「感知层实际需要的子集」，Fingers/Toes/Jaw 与呼吸/眨眼/注视无关。让语义层承担动作重定向职责会模糊其边界，且改动 `semantic-bones.ts` 会牵动感知层回归面。本表独立成文件，但**匹配算法复用已导出的 `matchSemanticBone()`**（`semantic-bones.ts:249`），不重复实现。

**v1 草案**（`—` = v1 显式不映射，记入已知遗留）：

| VRM humanoid | MMD 候选名（顺序即优先级） |
|---|---|
| `hips` | `腰`、`下半身`、`hips` |
| `spine` | — （v1 无源骨，见 §2.5 遗留） |
| `chest` | `上半身`、`chest` |
| `upperChest` | `上半身2`、`上半身２`、`upperChest` |
| `neck` | `首`、`首元`、`neck` |
| `head` | `頭`、`head` |
| `leftEye` / `rightEye` | `左目` / `右目` |
| `jaw` | — |
| `leftShoulder` / `rightShoulder` | `左肩` / `右肩`（含 `P`/`C`/`捩` 变体） |
| `leftUpperArm` / `rightUpperArm` | `左腕` / `右腕` |
| `leftLowerArm` / `rightLowerArm` | `左ひじ` / `右ひじ`（含 `左肘` 等变体） |
| `leftHand` / `rightHand` | `左手首` / `右手首` |
| `leftUpperLeg` / `rightUpperLeg` | `左足` / `右足` |
| `leftLowerLeg` / `rightLowerLeg` | `左ひざ` / `右ひざ` |
| `leftFoot` / `rightFoot` | `左足首` / `右足首` |
| `leftToes` / `rightToes` | `左つま先` / `右つま先` |
| `{L,R}ThumbMetacarpal` | `左親指０` / `右親指０` |
| `{L,R}ThumbProximal` | `左親指１` / `右親指１` |
| `{L,R}ThumbDistal` | `左親指２` / `右親指２` |
| `{L,R}IndexProximal` / `Intermediate` / `Distal` | `左人指１` / `左人指２` / `左人指３` |
| `{L,R}MiddleProximal` / `Intermediate` / `Distal` | `左中指１` / `左中指２` / `左中指３` |
| `{L,R}RingProximal` / `Intermediate` / `Distal` | `左薬指１` / `左薬指２` / `左薬指３` |
| `{L,R}LittleProximal` / `Intermediate` / `Distal` | `左小指１` / `左小指２` / `左小指３` |

**v1 显式丢弃的 MMD 骨骼**（VRM 无对应，或叠加需按轴混合、易引入扭曲）：扭骨（`左腕捩`/`左手捩` 等四组）、形变辅助骨（`足D`/`ひざD`/`足首D`/`足先EX`）、`グルーブ`、`全ての親`。

**测试要求（AGENTS.md TDD）**：映射表需一条覆盖性测试——`VRMHumanBoneList` 中每个 id 必须或出现在表中、或被显式列入「v1 不映射」白名单，防止 VRM 侧新增骨骼时静默漏映射。

### 2.4 位移通道：以 `センター` 为主源，合成到 `hips`

MMD 惯例把全身位移放在 `センター`（或 `グルーブ`），旋转放在 `腰`；而 VRM 只有一个 `hips` 同时承担两者。**决策**：`hips` 的旋转取自 `腰`，`hips` 的 position 偏移合并 `センター` + `グルーブ`（若存在）。非根骨骼的 VMD position 偏移通常为零，按 §2.1 的 `basePosition + offset` 语义直接透传。

### 2.5 比例缩放：参考比例 + 可视校准

VMD 位移是 MMD 单位，VRM 是米制。VMD 本身**不含源模型比例信息**，无法严格反推。**决策**：引入可配置缩放系数

```
k = k0 × (VRM 身高 / 1.6m)，  k0 = 0.08 m/unit
```

`0.08 m/unit` 是 three.js MMD 生态惯例（标准 MMD 模型约 20 单位 ≈ 1.6 m）；VRM 身高可由归一化 `head` 至 `hips` 的静止位置差估得。k 作为配置项暴露，默认对标准比例动作可用，非标模型靠可视校准。

### 2.6 每帧顺序契约（不动，这是白拿的）

`vrm-adapter.ts:613-638` 现有顺序为：

```
motionMixer.update(dt) → vrm.update(dt) → breath/gaze（写原始骨骼） → footIK.apply(dt, !animActive)
```

VMD 重定向写的是**归一化骨骼**，天然落在 `vrm.update(dt)` 之前 ⇒ 后续感知层仍在其后覆盖原始骨骼，`animActive` 门控语义、`perceptionPauseRef` 全局暂停标志一律不变。**本 ADR 不改这一顺序**。

（契约变更点仅在采纳 §2.8 方案 A 时才出现：`footIK.apply` 的驱动源要从「锚地常量」换成「VMD 足ＩＫ 目标」，`isIdle` 门控改为「存在 VMD IK 轨道时交给 VMD 驱动」。）

### 2.7 动作发现与菜单接入

- **发现**：`vrm-adapter.ts:381` 从「仅同目录 `.vrma`」扩为「同目录 `.vrma` + `.vmd`」；并追加 MMD 动作库来源——复用 `mmd-anim-library.ts:12` `getCustomAnimPath()`（`GetRepoRoot("CustomAnim")`）+ `:24` `filterAnimFiles()`。文件列表一律走 `effectivePort.listAllFilePaths`（Go 已交付），**前端不自行扫描磁盘**（AGENTS.md 归属红线）。
- **菜单**：复用 ADR-241/242 的声明式 `MenuNode`，扩展既有 `vrma-play` 桥（`vrm-adapter.ts:752/787/800/858-865`）的 clips 来源与空态文案（不再只说 `.vrma`）。**不新增节点类型**（AGENTS.md「3d 菜单只允许 MenuNode schema」红线）。
- **落点**：新增 `frontend/src/preview-3d/adapters/vrm/vmd-retarget.ts`（重定向器）与 `.../vmd-retarget-map.ts`（映射表）。放 VRM 侧的理由：靶面是 VRM humanoid，且 §2.2 的 uuid 绑定依赖 VRM 归一化节点，非格式无关物。

### 2.8 IK 决策项（**待拍板**，本 ADR 不替用户定）

VMD 的腿部动作主要活在 `左足ＩＫ`/`右足ＩＫ` 上，由 MMD 的 CCDIK 在**运行时**解算成 FK（`mmd-build-result.ts:61` `updateWithMixer(dt, mixer, { ik: true, grant: true })`）。而 `buildAnimation` 是纯关键帧搬运、**不解 IK**（`buildAnimation` 版 `buildSkeletalAnimation` 内无 IK 分支）；VRM 侧也无解算器。三个候选：

| 方案 | 做法 | 评估 |
|---|---|---|
| **A. 复用 in-repo CCD** | `solveIK(chain, target)` 驱动 VRM 归一化腿链，target 由 VMD 足ＩＫ 的 position 经 §2.5 缩放后给出 | **推荐**。求解器已在仓库（`ik-solver.ts:98`），边际成本低 |
| **B. 只转 FK** | 忽略 IK 目标，接受腿部降级 | 站桩/idle 勉强能看，**舞蹈会明显不对**（IK 开启时 FK 的足/ひざ被 IK 覆盖） |
| **C. 隐藏 MMD 骨架跑 `MMDIKSolver` 再烘 FK** | 用真实 IK 解算后采样 | **否决**：VRM 预览场景无 PMX，IK 需要真实骨长，无法构造等价骨架 |

若采纳 A，有两处必须先验证的实现细节（**不能照抄 `mmd-foot-ik.ts`**）：

1. **链起点必须是 `hips`，不是 `upperLeg`**。`mmd-foot-ik.ts:48` 用 `extractIKChainFromTree(tree, leftUpperLeg, leftFoot)` 得到 `chain=[upperLeg, lowerLeg, foot]`，而 `solveIK` 的关节遍历是 `for (let j = chain.length - 2; j >= 1; j--)`（`ik-solver.ts:122`）——**跳过链根**。该链下 j 只能取 1（膝盖），大腿不动。改起点为 `hips`（语义 id 已存在）⇒ `chain=[hips, upperLeg, lowerLeg, foot]`，j 取 2、1 ⇒ **大腿与膝盖都参与、hips 保持锚定**。零求解器改动。
2. **角度钳制与符号方向**。膝/肘需单向钳制（`minAngle`/`maxAngle` 同号区间），而 `solveIK` 是 axis-angle 形式按角度**大小**钳制（`ik-solver.ts:146`），反向旋转的符号行为需实测；`poleTarget`/`poleWeight` 用于膝盖朝向矫正，MMD 的极向量约定需对照确定。

一期若先落 B（FK only），需在 UI 明示「腿部动作已降级」，避免用户误判为 bug。

### 2.9 范围

**In（本 ADR 覆盖）**：VMD 身体 FK → VRM 归一化骨骼；hips 旋转与位移合成；同目录 + MMD 动作库的动作发现；play 菜单接入；幽灵骨架 + 轨道名重写的实现与单测。

**Out（明确不在本次）**：
- **表情**：VMD morph（`まばたき`/`あいうえお`/`笑い`…）→ VRM expression 映射，另开决策（ADR-081 §2.5 已把 morph 语义层列为未建立的遗留）。
- **物理/刚体**：MMD 的头发/裙摆刚体与 VMD 物理开关，VRM 侧由 springbone 自行跟随，不做转换。
- **相机轨道**：`buildCameraAnimation` 已实现，属 MMD 侧职责。
- **扭骨分摊**：需要按轴混合，v1 直接丢弃（见 §2.3）。
- **导出/写回**：只做预览播放，不产出 `.vrma` 或回写 VMD。

---

## 3. 后果（Consequences）

### 3.1 正面

- **动作资产复用面打开**：MMD 圈的海量 VMD 从「只在 MMD 预览可用」变为「VRM 预览同样可用」，直接消解 `vrm-adapter.ts:788` 记录的空态困境。
- **成本被既有资产压低**：轴系翻转、贝塞尔插值（幽灵骨架复用 `buildAnimation`）、静止位姿校正（three-vrm 归一化骨骼）、IK 求解器（`ik-solver.ts`）四项都不是新增。
- **不破坏既有层级**：语义层 23 骨不动、每帧顺序契约不动、菜单 schema 不扩、磁盘筛选仍归 Go——四个红线全部保持。
- **可单测**：映射表与轨道重写是纯函数（无 DOM、无 Wails），轨道名/值可断言，符合 TDD 与 `check-layering` 要求。

### 3.2 负面

- **映射表维护责任**：MMD 骨骼命名变体无穷（`腕捩`/`手捩`/`D` 骨/`EX` 骨），与 ADR-081 §3.2 同类负担，需持续扩表。
- **依赖上游私有行为**：幽灵骨架技巧依赖 `buildAnimation` 内部的 `boneNameDictionary` 过滤与 `basePosition` 加法语义。上游若重构（如导出 `CubicBezierInterpolation`、或改为按骨架校验名），此路会失效——需在上游升级时回归验证。
- **比例不可严格求解**：VMD 无源模型比例，§2.5 只能给参考值 + 肉眼校准，非标模型必然需要手动调参。
- **IK 未决**：§2.8 拍板前，腿部质量是已知短板。

### 3.3 已知遗留

- **`spine` 无源骨**：MMD `上半身` 覆盖 spine+chest 两段，VRM 分成三段（spine/chest/upperChest）。v1 采取「`上半身`→chest、`上半身2`→upperChest、spine 静止」，躯干会略偏刚硬。二期可考虑按比例分配旋转到 spine/chest。
- **扭骨丢弃**：前臂/手腕的自转丢失，快速翻腕动作会显单薄。
- **表情未映射**：morph 通道留白。
- **知识卡未建**：按 AGENTS.md，知识卡需锚定真实 `source_files`；`vmd-retarget.ts` / `vmd-retarget-map.ts` 落地后应用 `new-knowledge-card.ts` 补卡（本 ADR 完成时文件尚不存在，故不建，防 `check-knowledge-drift` 漂移）。
- **影响面未做实测**：本 ADR 基于依赖源码与仓库现状的查证（含上游 issue 实证），尚未跑通端到端；幽灵骨架的 `SkinnedMesh` 最小构造是否被 `buildAnimation` 完整接受，属实现期首个验证点。

---

## 4. 数据溯源

| 来源 | 内容 | 落地 |
|---|---|---|
| 用户 2026-09-15：「VMD→VRM 重定向，想实现这个功能，难度如何」 | 提出需求 | §1.6 |
| `vrm-adapter.ts:788` 注释 | 自认「VRMA 在现实生态里极稀少」 | §1.1 |
| `vrm-adapter.ts:381/401`（现状） | VRM 动作通道只认 `.vrma` | §1.2 |
| `@moeru/three-mmd/dist/index.js:4110-4118` | `boneNameDictionary` 白名单过滤 → 名不匹配即 skip | §1.3 |
| SystemAnimatorOnline issue #107（ButzYung） | 「You need retargeting」+ `tracks: []` 空 clip 实证 | §1.3 |
| `three-vrm-core.cjs` `VRMHumanoidRig._setupTransforms` | 归一化骨骼只设 position、不设 quaternion | §1.4 |
| `three-vrm-core.cjs:2275` `gltf.scene.add(normalizedHumanBonesRoot)` | 归一化 rig root 挂在 vrm.scene 下 | §2.2 |
| `@pixiv/three-vrm-animation` 内 `getNormalizedBoneNode(name)` | 官方 `.vrma` 亦写归一化骨骼（方向旁证） | §1.4 |
| `@moeru/three-mmd/dist/index.js:4137/4134-4136/4041-4069/4144-4146` | 旋转翻转、位置合成、贝塞尔插值私有、轨道命名 | §2.1 / §2.2 |
| `three-vrm-core` `VRMHumanBoneName.d.ts` / `VRMHumanBoneList` | VRM humanoid 权威 55 项清单 | §2.3 |
| `bone/ik-solver.ts:98/122/219`、`bone/mmd-foot-ik.ts:48` | CCD 求解器存在但跳过链根 → IK 链须取 hips 起 | §2.8 |
| `mmd-build-result.ts:61` | MMD 侧运行时 IK 由 `updateWithMixer({ik:true})` 驱动 | §2.8 |
| `vrm-adapter.ts:613-638/629` | 每帧顺序与 footIK 仅 idle 生效 | §2.6 |
| `semantic-bones.ts:249` `matchSemanticBone` | 匹配算法可复用（避免新表重写） | §2.3 |
| `mmd-anim-library.ts:12/24` | MMD 动作库路径解析与文件筛选可复用 | §2.7 |
| ADR-081 §2.1/§2.5、ADR-066、ADR-231、ADR-241/242 | 语义层边界 / 预览通道 / adapters 层 / 菜单 schema | §2.3 / §2.7 |
| 外部参考：Blender「Vmd Retargeting」(xianran)、3dretarget.com「VMD conversion」指南 | 难点清单（臂旋速率、高跟鞋忽略脚旋、比例自动缩放）、先分离 body 与 camera/light/facial/physics 轨道 | §2.5 / §2.8 / §2.9 |

<!-- 文件名: vmd-to-vrm-retarget.md → 实际文件 ADR-243-vmd-to-vrm-retarget.md -->
