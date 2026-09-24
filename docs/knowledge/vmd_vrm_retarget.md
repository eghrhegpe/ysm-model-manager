---
kind: vmd_vrm_retarget
name: VMD→VRM 动作重定向 vmd-retarget
tier: leaf
adr:
  - ADR-243
  - ADR-306
category: rendering
status: active
source_files:
  - frontend/src/preview-3d/adapters/vrm/vmd-retarget.ts
  - frontend/src/preview-3d/adapters/vrm/vmd-retarget-map.ts
  - frontend/src/preview-3d/adapters/vrm/vmd-expression-map.ts
  - frontend/src/preview-3d/bone/vrm-foot-ik.ts
  - frontend/src/preview-3d/bone/leg-chain.ts
  - frontend/src/preview-3d/bone/semantic-bones.ts
  - frontend/src/preview-3d/adapters/vrm/vrm-adapter.ts
auto_fields:
  symbols_with_lines:
    - autoVmdPositionScale
    - buildVmdRetargetClip
    - buildVrmScene
    - collectVmdBoneNames
    - collectVmdExpressionMap
    - collectVmdMorphNames
    - createVrmFootIKController
    - estimateVrmHeight
    - extractLegChains
    - FootIKSampler
    - FootIKSamplers
    - getSemanticBone
    - LegChain
    - makeVrmAdapter
    - matchSemanticBone
    - MMD_SEMANTIC_CANDIDATES
    - mmdSemanticBoneMap
    - readVmdPositionScale
    - readVrmMeta
    - rebuildVmdMotionClips
    - resolveSemanticBones
    - resolveVmdBindings
    - rewriteVmdTracks
    - scaleForHeight
    - SEMANTIC_BONE_IDS
    - SemanticBoneEntry
    - SemanticBoneId
    - SemanticBoneMap
    - VMD_EXPRESSION_CANDIDATES
    - VMD_EXPRESSION_UNMAPPED
    - VMD_FOOT_IK_CANDIDATES
    - VMD_POSITION_SCALE_DEFAULT
    - VMD_REFERENCE_HEIGHT
    - VMD_RETARGET_CANDIDATES
    - VMD_RETARGET_UNMAPPED
    - VMD_ROOT_TRANSLATION_CANDIDATES
    - VMD_TOE_ROTATION_CANDIDATES
    - VmdBindingPlan
    - VmdExpressionManagerLike
    - VmdFootIKTarget
    - VmdFootIKTargets
    - VmdHumanoidRig
    - VmdRetargetOptions
    - VmdRetargetResult
    - VrmAdapterDeps
    - VrmDataPort
    - VrmExpressionPreset
    - VrmFootIKController
    - vrmMenuItems
    - VrmMenuItemsOpts
    - VrmMetaInfo
    - vrmMetaSummary
    - VrmMetaSummary
    - VrmModelInfoCtx
    - VrmPanelHooks
    - VrmPositionScaleControl
    - vrmSemanticBoneMap
    - writeVmdPositionScale
    - ysmSemanticBoneMap
use_when:
  - 要把 MMD 的 .vmd 动作播到 VRM 模型上（或改对应的发现/加载逻辑）
  - 要增删骨骼/表情映射（MMD 骨名/morph 名 → VRM humanoid 骨 / expression preset）
  - 排查「VMD 动作在 VRM 上腿部不动 / 轨道为空 / 动作卡点顿挫」
  - 排查「VMD 带表情帧但 VRM 脸不动（表情通道）」
pitfalls:
  - 重建 KeyframeTrack（而非原地改 track.name）会静默丢掉 MMD 逐轴贝塞尔插值——视觉卡点顿挫且不报错
  - 幽灵网格 morphTargetDictionary 不可留 undefined（上游 buildMorphAnimation 解引用必抛）；填「可映射子集」= ADR-306 表情改道，空对象 = v1 行为（morph 全丢弃）
  - 足 IK 的「足静止世界位置」必须创建期快照；每帧现读会自反馈漂移
  - 轨道绑 uuid 而非 name（归一化节点名是 Normalized_ + 模型作者自定义骨名，可能含空格/日文）；表情轨道例外——绑 `VRMExpression_` 前缀 + preset 名的 name（载体对象由 VRM 规范命名）
  - 表情载体对象（VRMExpression_*）的 `.weight` 必须预初始化（真实 VRMExpression 构造即 weight=0）——three PropertyBinding.bind 遇 undefined 属性即 not-found 静默停写
  - 脚趾链 CCD（vrm-foot-ik）防乱挂校验：toes 的 parent 必须就是踝骨（leg endEffector），否则跳过不猜
quick_groups:
  - 3D 预览与模型追加
quick_intents:
  - 把 MMD 动作放到 VRM 模型上播放
  - 为什么 VMD 动作在 VRM 上腿部不动
  - 为什么 VMD 表情帧在 VRM 上脸不动
  - 新增一个 MMD 骨名/表情映射
quick_risk_lines:
  - 重建 track = 丢贝塞尔插值（卡点且不报错）
  - 幽灵网格 morphTargetDictionary 留 undefined = 必抛 TypeError
  - 表情载体 weight 未初始化 = mixer 静默不写（不报错）
invariant_anchors:
  - frontend/src/preview-3d/adapters/vrm/vmd-retarget.ts|createGhostMesh
  - frontend/src/preview-3d/adapters/vrm/vmd-retarget.ts|createInterpolant
  - frontend/src/preview-3d/bone/vrm-foot-ik.ts|restWorld
  - frontend/src/preview-3d/bone/leg-chain.ts|extractLegChains
  - frontend/src/preview-3d/adapters/vrm/vrm-adapter.ts|loadMotionClips
  - frontend/src/preview-3d/adapters/vrm/vmd-expression-map.ts|VMD_EXPRESSION_CANDIDATES
---

# VMD→VRM 动作重定向 vmd-retarget

## 概览

VRM 生态长期缺动作：MMD 圈产 `.vmd`、动捕产 FBX，几乎无人专门产 `.vrma`。本卡对应的模块把 **VMD 身体 FK 重定向到 VRM humanoid 归一化骨骼**，让 VRM 预览直接吃 MMD 动作（ADR-243）。

管线：

```
.vmd 字节 → VmdObject.ParseFromBuffer
         → resolveVmdBindings（映射表 + 归一化骨存在性 + 去重；含足 IK 骨 / つま先ＩＫ 改道路标）
         → collectVmdExpressionMap（VMD morph 名 ∩ 表情候选表 ∩ 模型侧存在性 → preset，ADR-306）
         → 幽灵骨架（骨名 = MMD 名 + 可映射 morph 白名单，静止 position = 目标归一化骨的局部位置）
         → buildAnimation（白拿轴系翻转 + 逐轴贝塞尔 + 位置合成 + morph 轨道）
         → rewriteVmdTracks（原地改 track.name 绑 uuid；摘出足 IK 目标轨道；morph 轨道改道
            `VRMExpression_<preset>.weight`，与官方 .vrma 表情轨道同路）
         → AnimationMixer(vrm.scene) 播放 → vrm.update() 烘回原始骨 + expressionManager.update() 消费表情
```

「幽灵骨架」是整套设计的枢轴：`buildAnimation` 只从传入的 `mesh.skeleton` 取**骨骼名**（白名单过滤）与**静止 position**（`basePosition`），于是可以造一副假骨架骗它产出带 MMD 贝塞尔插值的轨道，再把轨道名换绑到真实归一化节点。`CubicBezierInterpolation` 是模块私有的，这是唯一能白拿它的路子。

ADR-306 表情通道（P2）：morph 轨道不再整体丢弃——幽灵 morph 表白名单只填「VMD 实际驱动 ∩ 候选表 ∩ 模型有该表情」的子集，上游按表过滤后产出 `.morphTargetInfluences[N]` 轨道，rewrite 阶段原地改名成 `VRMExpression_<preset>.weight` 进 clip，AnimationMixer 统一驱动，**零新增每帧驱动器**（官方 `createVRMAnimationClip` 对 .vrma 表情的处理同构）。解析序：preset 优先、MMD 原名为自定义表情兜底。

## 核心职责

| 文件 | 职责 |
|---|---|
| `adapters/vrm/vmd-retarget-map.ts` | 纯数据：`VMD_RETARGET_CANDIDATES`（53 骨映射 + 候选顺序即优先级）/ `VMD_RETARGET_UNMAPPED`（显式不映射 + 原因）/ `VMD_FOOT_IK_CANDIDATES` / `VMD_TOE_ROTATION_CANDIDATES`（つま先ＩＫ quaternion FK 源，P1b）/ 缩放常量 |
| `adapters/vrm/vmd-expression-map.ts` | 纯数据（ADR-306）：`VMD_EXPRESSION_CANDIDATES`（MMD morph 名 → VRM 表情 preset，五母音/眨眼/情感）/ `VMD_EXPRESSION_UNMAPPED`（neutral/单眼 wink/视线族显式不映射 + 原因） |
| `adapters/vrm/vmd-retarget.ts` | 纯逻辑：绑定解析 / 表情映射解析（`collectVmdExpressionMap`）/ 幽灵骨架（骨 + morph 白名单）/ 轨道重写（含 morph 改道）/ 足 IK 目标采样器 |
| `bone/vrm-foot-ik.ts` | VMD 足ＩＫ → CCD 求解（写**原始骨**，晚于 `vrm.update`）；脚尖链（ADR-306 P1b：`semanticBones["leftToes"/"rightToes"]` + 防乱挂校验，`TOE_IK_CONFIG` 钳制比腿保守） |
| `bone/leg-chain.ts` | 腿链提取（链根取大腿的**直接父骨**，`endEffectorId` = 足骨），MMD 待机锚地与 VRM 足 IK 共用 |
| `adapters/vrm/vrm-adapter.ts` | 接入：`loadMotionClips`（同目录 `.vrma` + `.vmd`，追加 `CustomAnim` 动作库；`.vmd` 经 `buildVmdRetargetClip` 传 `expressionManager` 启用表情通道）+ 每帧驱动 |

## 对外 API / 入口

- `buildVmdRetargetClip(vmd, rig, opts)` → `{ clip, report, footIK }`——**主入口**。`rig` 传 `vrm.humanoid`（结构上满足窄接口 `VmdHumanoidRig`）。`opts.expressionManager`（鸭子类型 `VmdExpressionManagerLike`，传 `vrm.expressionManager ?? null` 即启用 ADR-306 表情通道；缺省 null = ADR-243 v1 行为，morph 全丢弃）。
- `resolveVmdBindings(present, rig, expressionMap?)` → `VmdBindingPlan`（诊断面板与测试直读；`expressionMap` 缺省空表）。
- `collectVmdExpressionMap(present, expressionManager)` → MMD morph 名 → VRM preset（ADR-306 §2.1，`collectVmdMorphNames(vmd)` 喂 present；模型侧存在性过滤：preset 或原名任一解析不出轨道名即不进表）。
- `rewriteVmdTracks(clip, plan, scale, expressionManager?)` → `{ tracks, droppedTracks, ikTracks }`（第 4 参缺省 = 不做表情改道）。
- `createVrmFootIKController(boneTree, semanticBones)` → `{ apply(timeSeconds, targets), dispose() }`（semanticBones 含 toes 键时追加脚尖链 CCD）。
- `autoVmdPositionScale(rig)` → 自动位移缩放（P3 单一事实源：`buildVmdRetargetClip` 缺省回退值 = 按身高外推、失败退 `VMD_POSITION_SCALE_DEFAULT`；校准滑块用它镜像「自动值」显示）。
- **P3 位移缩放校准（ADR-243 锐评对账）**：`readVmdPositionScale()`/`writeVmdPositionScale(v)`（`vrm-adapter.ts`，经 `safeGet/safeSet/safeRemove` 持久化 `vmd.positionScale`，ADR-044）+ `rebuildVmdMotionClips(...)`（重建 `.vmd` 重定向 clip 并按 label 换绑活动 action，`.vrma` 条目对象保留不重放）。菜单走 MenuNode schema：`vrmMenuItems` 在 `o.positionScale.vmdCount>0` 时注入 `kind:"slider"` 节点（`onCommit` 松手才触发持久化 + 重建，拖动过程 `set` 空操作抑制）+ 复位按钮（清持久化回自动）。
- 接入点：`vrm-adapter.ts` 的 `loadMotionClips()`；每帧在 `update()` 中**晚于** `vrm.update(dt)` 调 `vrmFootIK.apply(action.time, clip.footIK)`。表情轨道进 clip 后无需额外每帧代码——`vrm.update(dt)` 内的 `expressionManager.update()` 消费 `VRMExpression_*.weight`。
- **采样源不变量（review 64c24cf3e P1 修复，1dc31247d）**：足 IK 的 targets 必须按 **live action 实播 clip** 反查（`motionClips.find(c => c.clip === motionClipOf(action))`），而非独立维护的索引——索引与 mixer 实际播放脱钩时（`select` 切动作后），身体 FK 与腿 IK 会来自不同动作，脚底打滑。`VrmMotionState.motionIdx` 已删除（脱钩根源）。
- **three r185 API 注**：`AnimationAction` 的 `.clip` 属性已移除，clip 经**公开方法 `action.getClip()`** 读取；本仓统一走 `motionClipOf()`（vrm-adapter.ts），勿直接碰 three 私有字段 `_clip`（无跨版本契约，升级即静默失配）。
- **P3 留档（可选优化，当前 N 小可略）**：每帧 `update` 的 clip 反查是 O(n) find（原 `motionIdx` 为 O(1)）。动作条目数 = 目录内 `.vrma` + `.vmd` 数量，常规场景个位数~几十，每帧成本可忽略；若将来动作库规模化（单目录数百 vmd），再在 `select` 时缓存命中项（`VrmMotionState` 加 clip 引用字段），`update` 改 O(1) 直读，勿为当前量级预优化。

## 与其他子系统关系

- **ADR-081 语义骨骼层**：重定向映射表**刻意不复用**语义层的形状（语义层是「感知层实际需要的子集」），但沿用同一套「候选顺序即优先级、首个命中胜出」约定。注意 toes（`leftToes`/`rightToes`）于 ADR-306 P1b 起**已进语义层**（`semantic-bones.ts` `SemanticBoneId`，MMD/YSM/VRM 三表均有 toes 候选）——脚链 CCD（`vrm-foot-ik`）与感知层共用该语义；重定向映射表自身仍独立。
- **`bone/ik-solver.ts`**：CCD 求解器（自写，参考 babylon-mmd）。`solveIK` 的关节遍历**跳过链根**，因此链根取谁决定几节参与解算——取大腿自身则只有膝盖能动。脚尖链（`vrm-foot-ik` `TOE_IK_CONFIG`）链根取踝（2 节链 ⇒ 只转脚尖关节）。
- **`bone/mmd-foot-ik.ts`**：待机锚地，与本模块的 VMD 足 IK 以 `animActive` **互斥**（待机走锚地、动画走 VMD 目标）。
- **`adapters/mmd/mmd-anim-library.ts`**：复用其 `getCustomAnimPath()`（`GetRepoRoot("CustomAnim")`）取 MMD 动作库根。
- **归属红线**：磁盘枚举一律走 Go 交付的 `listAllFilePaths`，前端不自行扫描磁盘（AGENTS.md）。

## 不变量

1. **必须原地改 `track.name`**，禁止 `new QuaternionKeyframeTrack(...)` 重建——贝塞尔插值是挂在**原 track 对象**上的 `createInterpolant` 实例覆写（`CubicBezierInterpolation` 未导出），重建即丢插值、退化成线性（视觉卡点顿挫，且**不会报错**）。测试哨兵：`expect(kept).toBe(track)` + `createInterpolant` 存活。
2. **幽灵网格 `morphTargetDictionary` 不可留 `undefined`**（上游 `buildAnimation` 无条件调 `buildMorphAnimation`，其首行解引用 `mesh.morphTargetDictionary[morphName]`，普通 `BufferGeometry` 下该字段停在 `undefined` ⇒ 必抛 TypeError）。ADR-306 起填**可映射 morph 子集**（键 = morph 名、值 = 轨道索引，与 `plan.morphNameByIndex` 同源）；空对象 = v1 行为（morph 全丢弃），可映射子集 = 表情改道。
3. **幽灵骨静止 position 填目标归一化骨的局部位置**（足 IK 骨例外，填零；つま先ＩＫ FK 骨填 toes 归一化骨的静止位置）：`buildAnimation` 的 `basePosition + offset` 会把它加进每条 position 轨道，填错会把骨骼每帧拽到错误位置。
4. **足 IK 目标公式**：`目标世界 = 足静止世界 + ikOffset × k`——`センター` 的 `centerOffset` 项在代数上相消（推导见 ADR-243 §2.8.1）。且「足静止世界位置」必须是**创建期快照**，每帧现读会自反馈漂移。脚尖链目标 = 脚尖静止世界 + 同一偏移。
5. **轨道绑 uuid 而非 name**：归一化节点名是 `"Normalized_" + 模型作者自定义骨名`（可能含空格/日文），uuid 零歧义。归一化骨必须处于 mixer root（`vrm.scene`）子树内，否则 PropertyBinding 只打警告后静默失效。**表情轨道例外**：绑 `VRMExpression_<preset>` name（VRM 规范命名，载体对象由 three-vrm 挂在 `vrm.scene`）。
6. **写归一化骨 = 天然落在 `vrm.update()` 之前**（FK 通道）；足 IK 写**原始骨**则必须晚于它（归一化 → 原始是单向烘焙）。表情轨道同理：mixer 写 `VRMExpression_*.weight`，`vrm.update()` 内 `expressionManager.update()` 消费——每帧顺序契约零改动。
7. **映射表覆盖性**：`VMD_RETARGET_CANDIDATES` 与 `VMD_RETARGET_UNMAPPED` 的并集须覆盖 `VRMHumanBoneList` 全 55 项——VRM 侧新增骨骼时靠这条测试拦住静默漏映射。
8. **表情改道原地改名、不重建、不新造驱动器**（ADR-306 §2.2）：morph 轨道经 `expressionManager.getExpressionTrackName`（鸭子 `VmdExpressionManagerLike`）换成 `VRMExpression_<preset>.weight`，解析序 preset 优先、MMD 原名自定义表情兜底；模型缺该表情（两路都解析不出轨道名）→ 不进改道表 → 上游白名单跳过 → 计入 `droppedTracks`。感知层眨眼在 `animActive` 下由 `perceptionPauseRef` 自查静默（ADR-306 §2.3，不新增门控）。
9. **位移缩放 k 在加载时 bake 进位移轨道（`scaleTranslationTrack`），非运行期旋钮**（ADR-243 锐评对账 P3）：改 k = 重跑 `buildVmdRetargetClip`（`rebuildVmdMotionClips`）+ 按 label 换绑活动 action。故校准滑块**只在 onCommit（松手）触发重建**、拖动过程抑制（`set` 空操作），避免每 tick 重解析 VMD。自动值单一事实源 = `autoVmdPositionScale`（`buildVmdRetargetClip` 回退与滑块显示共用，防两份算法漂移）。持久化走 `safeGet/safeSet`（`vmd.positionScale`，ADR-044）；`.vrma` 条目对象保留不重放（只换 `.vmd` 子集）。**菜单归属**：`vrm-adapter.ts|vmdPositionScaleNodes` 产出的滑块 + 复位须挂 `vrma-play` 面板 `children`（叶子层）——根项白名单只允许 panel/action/divider（`check-menu-health` 的 ROOT_KINDS），写成根项既违规又不可达（`motionDetailView` 只列 `kind==="panel"` 的 motion 项），面板 children 两通道皆空时才回退 `VRM_PLAY_EMPTY_NODE` 空态。

## 相关

- ADR-243（重定向决策 + 足 IK 推导 + 两期实施注记）、ADR-306（VMD morph → VRM expression 表情通道，含 P1b 脚尖链 CCD）、ADR-081（语义骨骼层）、ADR-231（preview-3d adapters 层）、ADR-242（菜单空态）
- 知识卡：`bone-tools.md`、`ysm-anim-pipeline.md`、`3d-patterns.md`
