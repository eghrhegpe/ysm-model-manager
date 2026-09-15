---
kind: vmd_vrm_retarget
name: VMD→VRM 动作重定向 vmd-retarget
tier: leaf
adr:
  - ADR-243
category: rendering
status: active
source_files:
  - frontend/src/preview-3d/adapters/vrm/vmd-retarget.ts
  - frontend/src/preview-3d/adapters/vrm/vmd-retarget-map.ts
  - frontend/src/preview-3d/bone/vrm-foot-ik.ts
  - frontend/src/preview-3d/bone/leg-chain.ts
  - frontend/src/preview-3d/adapters/vrm/vrm-adapter.ts
auto_fields:
  symbols_with_lines:
    - buildVmdRetargetClip
    - buildVrmScene
    - collectVmdBoneNames
    - createVrmFootIKController
    - estimateVrmHeight
    - extractLegChains
    - FootIKSampler
    - FootIKSamplers
    - LegChain
    - makeVrmAdapter
    - readVrmMeta
    - resolveVmdBindings
    - rewriteVmdTracks
    - scaleForHeight
    - VMD_FOOT_IK_CANDIDATES
    - VMD_POSITION_SCALE_DEFAULT
    - VMD_REFERENCE_HEIGHT
    - VMD_RETARGET_CANDIDATES
    - VMD_RETARGET_UNMAPPED
    - VMD_ROOT_TRANSLATION_CANDIDATES
    - VmdBindingPlan
    - VmdFootIKTarget
    - VmdFootIKTargets
    - VmdHumanoidRig
    - VmdRetargetOptions
    - VmdRetargetResult
    - VrmAdapterDeps
    - VrmDataPort
    - VrmFootIKController
    - vrmMenuItems
    - VrmMenuItemsOpts
    - VrmMetaInfo
    - vrmMetaSummary
    - VrmMetaSummary
    - VrmModelInfoCtx
    - VrmPanelHooks
use_when:
  - 要把 MMD 的 .vmd 动作播到 VRM 模型上（或改对应的发现/加载逻辑）
  - 要增删骨骼映射（MMD 骨名 → VRM humanoid 骨名）
  - 排查「VMD 动作在 VRM 上腿部不动 / 轨道为空 / 动作卡点顿挫」
pitfalls:
  - 重建 KeyframeTrack（而非原地改 track.name）会静默丢掉 MMD 逐轴贝塞尔插值——视觉卡点顿挫且不报错
  - 幽灵网格必须显式置 mesh.morphTargetDictionary = {}，否则上游 buildMorphAnimation 解引用 undefined 必抛
  - 足 IK 的「足静止世界位置」必须创建期快照；每帧现读会自反馈漂移
  - 轨道绑 uuid 而非 name（归一化节点名是 Normalized_ + 模型作者自定义骨名，可能含空格/日文）
  - VMD 的骨骼 position 是相对 bind pose 的偏移、不是绝对坐标——足 IK 目标公式的代数前提
quick_groups:
  - 3D 预览与模型追加
quick_intents:
  - 把 MMD 动作放到 VRM 模型上播放
  - 为什么 VMD 动作在 VRM 上腿部不动
  - 新增一个 MMD 骨名映射
quick_risk_lines:
  - 重建 track = 丢贝塞尔插值（卡点且不报错）
  - 幽灵网格漏 morphTargetDictionary = {} = 必抛 TypeError
invariant_anchors:
  - frontend/src/preview-3d/adapters/vrm/vmd-retarget.ts|morphTargetDictionary = {}
  - frontend/src/preview-3d/adapters/vrm/vmd-retarget.ts|createInterpolant
  - frontend/src/preview-3d/bone/vrm-foot-ik.ts|restWorld
  - frontend/src/preview-3d/bone/leg-chain.ts|extractLegChains
  - frontend/src/preview-3d/adapters/vrm/vrm-adapter.ts|loadMotionClips
---

# VMD→VRM 动作重定向 vmd-retarget

## 概览

VRM 生态长期缺动作：MMD 圈产 `.vmd`、动捕产 FBX，几乎无人专门产 `.vrma`。本卡对应的模块把 **VMD 身体 FK 重定向到 VRM humanoid 归一化骨骼**，让 VRM 预览直接吃 MMD 动作（ADR-243）。

管线：

```
.vmd 字节 → VmdObject.ParseFromBuffer
         → resolveVmdBindings（映射表 + 归一化骨存在性 + 去重）
         → 幽灵骨架（骨名 = MMD 名、静止 position = 目标归一化骨的局部位置）
         → buildAnimation（白拿轴系翻转 + 逐轴贝塞尔 + 位置合成）
         → rewriteVmdTracks（原地改 track.name 绑 uuid；摘出足 IK 目标轨道）
         → AnimationMixer(vrm.scene) 播放 → vrm.update() 烘回原始骨
```

「幽灵骨架」是整套设计的枢轴：`buildAnimation` 只从传入的 `mesh.skeleton` 取**骨骼名**（白名单过滤）与**静止 position**（`basePosition`），于是可以造一副假骨架骗它产出带 MMD 贝塞尔插值的轨道，再把轨道名换绑到真实归一化节点。`CubicBezierInterpolation` 是模块私有的，这是唯一能白拿它的路子。

## 核心职责

| 文件 | 职责 |
|---|---|
| `adapters/vrm/vmd-retarget-map.ts` | 纯数据：`VMD_RETARGET_CANDIDATES`（53 骨映射 + 候选顺序即优先级）/ `VMD_RETARGET_UNMAPPED`（2 骨显式不映射 + 原因）/ `VMD_FOOT_IK_CANDIDATES` / 缩放常量 |
| `adapters/vrm/vmd-retarget.ts` | 纯逻辑：绑定解析 / 幽灵骨架 / 轨道重写 / 足 IK 目标采样器 |
| `bone/vrm-foot-ik.ts` | VMD 足ＩＫ → CCD 求解（写**原始骨**，晚于 `vrm.update`） |
| `bone/leg-chain.ts` | 腿链提取（链根取大腿的**直接父骨**），MMD 待机锚地与 VRM 足 IK 共用 |
| `adapters/vrm/vrm-adapter.ts` | 接入：`loadMotionClips`（同目录 `.vrma` + `.vmd`，追加 `CustomAnim` 动作库）+ 每帧驱动 |

## 对外 API / 入口

- `buildVmdRetargetClip(vmd, rig, opts)` → `{ clip, report, footIK }`——**主入口**。`rig` 传 `vrm.humanoid`（结构上满足窄接口 `VmdHumanoidRig`）。
- `resolveVmdBindings(present, rig)` → `VmdBindingPlan`（诊断面板与测试直读）。
- `rewriteVmdTracks(clip, plan, scale)` → `{ tracks, droppedTracks, ikTracks }`。
- `createVrmFootIKController(boneTree, semanticBones)` → `{ apply(timeSeconds, targets), dispose() }`。
- 接入点：`vrm-adapter.ts` 的 `loadMotionClips()`；每帧在 `update()` 中**晚于** `vrm.update(dt)` 调 `vrmFootIK.apply(action.time, clip.footIK)`。
- **采样源不变量（review 64c24cf3e P1 修复，1dc31247d）**：足 IK 的 targets 必须按 **live action 实播 clip** 反查（`motionClips.find(c => c.clip === motionClipOf(action))`），而非独立维护的索引——索引与 mixer 实际播放脱钩时（`select` 切动作后），身体 FK 与腿 IK 会来自不同动作，脚底打滑。`VrmMotionState.motionIdx` 已删除（脱钩根源）。
- **three r185 API 注**：`AnimationAction` 公开 `.clip` getter 已移除，clip 存于私有 `action._clip`；本仓统一经 `motionClipOf()`（vrm-adapter.ts）读取，勿直接散落 `_clip` 访问。

## 与其他子系统关系

- **ADR-081 语义骨骼层**：映射表**刻意不复用** 23 骨语义层的形状（语义层是「感知层实际需要的子集」），但沿用同一套「候选顺序即优先级、首个命中胜出」约定。不扩语义层是为了不动感知层回归面。
- **`bone/ik-solver.ts`**：CCD 求解器（自写，参考 babylon-mmd）。`solveIK` 的关节遍历**跳过链根**，因此链根取谁决定几节参与解算——取大腿自身则只有膝盖能动。
- **`bone/mmd-foot-ik.ts`**：待机锚地，与本模块的 VMD 足 IK 以 `animActive` **互斥**（待机走锚地、动画走 VMD 目标）。
- **`adapters/mmd/mmd-anim-library.ts`**：复用其 `getCustomAnimPath()`（`GetRepoRoot("CustomAnim")`）取 MMD 动作库根。
- **归属红线**：磁盘枚举一律走 Go 交付的 `listAllFilePaths`，前端不自行扫描磁盘（AGENTS.md）。

## 不变量

1. **必须原地改 `track.name`**，禁止 `new QuaternionKeyframeTrack(...)` 重建——贝塞尔插值是挂在**原 track 对象**上的 `createInterpolant` 实例覆写（`CubicBezierInterpolation` 未导出），重建即丢插值、退化成线性（视觉卡点顿挫，且**不会报错**）。测试哨兵：`expect(kept).toBe(track)` + `createInterpolant` 存活。
2. **幽灵网格必须 `mesh.morphTargetDictionary = {}`**：上游 `buildAnimation` 无条件调用 `buildMorphAnimation`，其首行解引用 `mesh.morphTargetDictionary[morphName]`，而普通 `BufferGeometry` 下该字段停在 `undefined` ⇒ 必抛 TypeError。
3. **幽灵骨静止 position 填目标归一化骨的局部位置**（足 IK 骨例外，填零）：`buildAnimation` 的 `basePosition + offset` 会把它加进每条 position 轨道，填错会把骨骼每帧拽到错误位置。
4. **足 IK 目标公式**：`目标世界 = 足静止世界 + ikOffset × k`——`センター` 的 `centerOffset` 项在代数上相消（推导见 ADR-243 §2.8.1）。且「足静止世界位置」必须是**创建期快照**，每帧现读会自反馈漂移。
5. **轨道绑 uuid 而非 name**：归一化节点名是 `"Normalized_" + 模型作者自定义骨名`（可能含空格/日文），uuid 零歧义。归一化骨必须处于 mixer root（`vrm.scene`）子树内，否则 PropertyBinding 只打警告后静默失效。
6. **写归一化骨 = 天然落在 `vrm.update()` 之前**（FK 通道）；足 IK 写**原始骨**则必须晚于它（归一化 → 原始是单向烘焙）。
7. **映射表覆盖性**：`VMD_RETARGET_CANDIDATES` 与 `VMD_RETARGET_UNMAPPED` 的并集须覆盖 `VRMHumanBoneList` 全 55 项——VRM 侧新增骨骼时靠这条测试拦住静默漏映射。

## 相关

- ADR-243（重定向决策 + 足 IK 推导 + 两期实施注记）、ADR-081（语义骨骼层）、ADR-231（preview-3d adapters 层）、ADR-242（菜单空态）
- 知识卡：`bone-tools.md`、`ysm-anim-pipeline.md`、`3d-patterns.md`
