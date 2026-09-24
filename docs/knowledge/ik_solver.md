---
kind: ik_solver
name: CCD IK 求解器 ik-solver / 足部锚地 mmd-foot-ik
tier: leaf
category: core
source_files:
  - frontend/src/preview-3d/bone/ik-solver.ts
  - frontend/src/preview-3d/bone/leg-chain.ts
  - frontend/src/preview-3d/bone/mmd-foot-ik.ts
auto_fields:
  symbols_with_lines:
    - createFootIKController
    - extractIKChainFromTree
    - extractLegChains
    - FootIKController
    - IKChain
    - IKConfig
    - IKResult
    - LegChain
    - solveIK
quick_groups:
  - 3D 预览与模型追加
quick_intents:
  - IK 求解、骨骼 IK、足部锚地
  - foot IK、极向量 / pole、CCD
  - 腿链提取、链根取谁
quick_risk_lines:
  - IK 求解必须走 ik-solver 的 CCD 求解器 + mmd-foot-ik 的足部锚地，禁止手写 IK 逻辑
  - 腿链链根取大腿的「直接父骨」；改成大腿自身 = 只有膝盖能动
pitfalls:
  - 手写 IK 逻辑 → 与 babylon-mmd 参考行为不一致、足部漂移；必须经 ik-solver
  - extractIKChainFromTree 未做防环 → 骨骼链循环死循环；必须校验 parentId 链防环
  - 硬编码语义 id 作链根（如 hips）→ MMD 的「腰」不保证是大腿祖先，extractIKChainFromTree 直接返回 null ⇒ 整腿静默失效；必须取直接父骨

use_when:
  - IK 求解
  - 骨骼 IK
  - 足部锚地
  - foot IK
  - 极向量 / pole
  - CCD
  - 腿链提取
perf:
  - cpu-bound

status: active
---

# CCD IK 求解器 ik-solver / 足部锚地 mmd-foot-ik

## 概览

自写精简版 CCD（Cyclic Coordinate Descent）IK 求解器（ADR-072 工具层纯净、零 DOM / 零 backend），
参考 babylon-mmd 的 ik-solver 但不依赖其运行时。用途：MMD/YSM/VRM 骨骼的足部锚地（foot anchoring）
与手部定位——给定骨骼链 + 目标位置，逐关节调整旋转使末端逼近目标。

- `solveIK`：核心求解器，支持角度约束（minAngle/maxAngle）、极向量（poleTarget/poleWeight）、阻尼（damping）。
- `extractIKChainFromTree`：从 BoneTree 沿 parentId 上溯提取 root→endEffector 的骨骼链（防环、缺 object 校验）。
- `extractLegChains`（leg-chain.ts）：把「语义骨 id → 腿链」的提取连同**链根取谁**的约定收成一处。
- `createFootIKController`（mmd-foot-ik.ts）：程序化锚地，待机态下把双足拉回初始锚地高度，防脚底悬空/穿模。

两个消费方（共享 `extractLegChains`）：

| 消费方 | 时机 | 目标 |
|---|---|---|
| `mmd-foot-ik.ts` | 待机（`isIdle`）作 MMD 内置 IK 的后处理修正 | 锚地常量高度（防悬空/穿模） |
| `vrm-foot-ik.ts` | 动画播放中（与待机锚地以 `animActive` 互斥） | VMD `左足ＩＫ`/`右足ＩＫ` 目标（ADR-243 §2.8） |

## 核心职责

- **CCD 迭代**：从倒数第二个关节向根逐关节旋转，使末端沿旋转轴朝目标靠拢；每轮检查收敛
  （`distance < tolerance` 提前退出）。最大迭代 `iterations`（默认 8），容差默认 0.001。
- **角度约束**：旋转角经 minAngle/maxAngle 钳制 + damping 衰减；钳制后零角跳过。
- **极向量约束**：`applyPoleConstraint` 把关节朝向拉向 poleTarget（肘/膝朝向矫正），
  仅对 `j < chain.length - 2` 的关节生效（末关节不参与，避免与末端定位打架）。
- **链根选择**（`extractLegChains`）：链根取大腿的**直接父骨**（骨盆语义），不是大腿自身——
  这决定几节参与解算（见「不变量」第 1 条）。

## 对外 API / 入口

- `solveIK(chain, target, config): IKResult` — `achieved` / `distance` / `iterations`。
- `extractIKChainFromTree(tree, rootId, endEffectorId): Object3D[] | null`。
- `extractLegChains(boneTree, semanticBones): LegChain[]` — 双侧腿链（顺序恒为 left → right；
  缺骨/链不可提取的腿直接缺席）。返回 `{ side, chain, endEffector }`。
- `createFootIKController(boneTree, semanticBones): FootIKController`（`apply(dt, isIdle)` / `dispose`）。

## 与其他子系统关系

- bone-tools.BoneTree（骨骼树）→ semantic-bones 语义映射（leftUpperLeg/leftFoot 等）→
  leg-chain 组装腿链 → mmd-foot-ik / vrm-foot-ik 各自驱动。
- MMD 内置 IK（updateWithMixer）之后运行作后处理修正；有动画时跳过（isIdle=false 早退）。
- VRM 侧 VMD 足 IK（ADR-243）：写在**原始骨**上且晚于 `vrm.update(dt)`（归一化 → 原始是单向烘焙）。

## 不变量

- **链根锚点约定**：遍历 `j >= 1`，链根不参与旋转——旋转根部会带动整链乃至父链（全身）漂移。
  因此**链根取谁决定几节参与解算**：
  `[大腿, 膝盖, 踝]` → 只有膝盖能动；`[骨盆, 大腿, 膝盖, 踝]` → 大腿与膝盖都参与、骨盆保持锚定。
  ADR-243 §2.8 采纳后者，实现为「取大腿的**直接父骨**」——刻意**不**硬编码语义 id（如 `hips`），
  因为 MMD 的「腰」不保证是大腿的祖先（不同模型派系里 腰/下半身 归属不一），硬编码会让链提取
  返回 null ⇒ 整腿静默失效；父骨缺失（大腿即树根）或悬空 → 回退大腿自身。
  待机锚地场景的「向锚地靠拢而非精确到达」**是设计预期**（毫米级防悬空/穿模修正，不需精确到达）。
  勿随手放开 `j=0`，也勿只在一处改链根（两消费方共用 `extractLegChains` 正是防这个）。
- **极向量独立于 CCD 角度项**：`angle >= 1e-6` 包裹的只是旋转项；极向量项始终执行（零夹角时
  旋转跳过、pole 照常 → 末端已到位仍可矫正肘/膝姿态）。`applyPoleConstraint` 内部有轴退化早退。
- 退化保护：关节与末端重合（toEnd 退化）→ 整个关节跳过（含 pole）；方向相反/近共线
  （轴退化，叉积 lengthSq < 1e-8）→ **确定性回退轴**（`toEnd×世界Y`，仍退化再 `toEnd×世界X`）
  + 步长封顶 π−0.05（整 180° 翻转病态且一步冲过目标）。旧契约「轴退化跳过旋转」会让垂直
  抬脚时整关节冻结、近共线时微小叉积被数值噪声主导而甩反侧——实机校准已改（ADR-243 §2.8，
  探针见 `frontend/src/preview-3d/bone/vrm-foot-ik-quality.test.ts`：S1 抬脚残差 0.55→0.13）。
- 测试锚点：ik-solver.test.ts 以闭式数值断言固化上述语义（含"target=末端现位 → pole 独立执行"、
  "轴退化 → 回退轴继续逼近"用例）；mmd-foot-ik.test.ts 断言链长 4（有父骨）/ 3（回退路径）。

## 相关

- ADR-072（工具层纯净）/ ADR-066（babylon-mmd 提及）/ ADR-243 §2.8（链根取直接父骨 + VMD 足 IK 驱动）
- 知识卡：`vmd_vrm_retarget.md`（VRM 侧消费方）、`bone-tools.md`
- frontend/src/preview-3d/bone/bone-tools.ts、bone/semantic-bones.ts、bone/leg-chain.ts、
  bone/vrm-foot-ik.ts、bone/ik-solver.test.ts、bone/mmd-foot-ik.test.ts、bone/vrm-foot-ik.test.ts、
  bone/vrm-foot-ik-quality.test.ts
