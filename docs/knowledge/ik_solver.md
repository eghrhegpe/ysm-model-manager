---
kind: ik_solver
name: CCD IK 求解器 ik-solver / 足部锚地 mmd-foot-ik
tier: leaf
category: core
source_files:
  - frontend/src/utils/3d/ik-solver.ts
  - frontend/src/utils/3d/mmd-foot-ik.ts
use_when:
  - IK 求解
  - 骨骼 IK
  - 足部锚地
  - foot IK
  - 极向量 / pole
  - CCD
---

# CCD IK 求解器 ik-solver / 足部锚地 mmd-foot-ik

## 概览

自写精简版 CCD（Cyclic Coordinate Descent）IK 求解器（ADR-072 工具层纯净、零 DOM / 零 backend），
参考 babylon-mmd 的 ik-solver 但不依赖其运行时。用途：MMD/YSM 骨骼的足部锚地（foot anchoring）
与手部定位——给定骨骼链 + 目标位置，逐关节调整旋转使末端逼近目标。

- `solveIK`：核心求解器，支持角度约束（minAngle/maxAngle）、极向量（poleTarget/poleWeight）、阻尼（damping）。
- `extractIKChainFromTree`：从 BoneTree 沿 parentId 上溯提取 root→endEffector 的骨骼链（防环、缺 object 校验）。
- `createFootIKController`（mmd-foot-ik.ts）：程序化锚地，待机态下把双足拉回初始锚地高度，防脚底悬空/穿模。

## 核心职责

- **CCD 迭代**：从倒数第二个关节向根逐关节旋转，使末端沿旋转轴朝目标靠拢；每轮检查收敛
  （`distance < tolerance` 提前退出）。最大迭代 `iterations`（默认 8），容差默认 0.001。
- **角度约束**：旋转角经 minAngle/maxAngle 钳制 + damping 衰减；钳制后零角跳过。
- **极向量约束**：`applyPoleConstraint` 把关节朝向拉向 poleTarget（肘/膝朝向矫正），
  仅对 `j < chain.length - 2` 的关节生效（末关节不参与，避免与末端定位打架）。

## 对外 API / 入口

- `solveIK(chain, target, config): IKResult` — `achieved` / `distance` / `iterations`。
- `extractIKChainFromTree(tree, rootId, endEffectorId): Object3D[] | null`。
- `createFootIKController(boneTree, semanticBones): FootIKController`（`apply(dt, isIdle)` / `dispose`）。

## 与其他子系统关系

- bone-tools.BoneTree（骨骼树）→ semantic-bones 语义映射（leftUpperLeg/leftFoot 等）→ mmd-foot-ik 组装腿链。
- MMD 内置 IK（updateWithMixer）之后运行作后处理修正；有动画时跳过（isIdle=false 早退）。

## 不变量

- **链根锚点约定**：遍历 `j >= 1`，root 不参与旋转——旋转根部会带动整链乃至父链（全身）漂移。
  因此三骨腿链（upperLeg→lowerLeg→foot）只剩膝部一个自由度，"向锚地靠拢"而非精确到达
  **是设计预期**（foot-ik 定位是待机防悬空/穿模的毫米级修正，不需精确到达）。勿随手放开 j=0。
- **极向量独立于 CCD 角度项**：`angle >= 1e-6` 包裹的只是旋转项；极向量项始终执行（零夹角时
  旋转跳过、pole 照常 → 末端已到位仍可矫正肘/膝姿态）。`applyPoleConstraint` 内部有轴退化早退。
- 退化保护：关节与末端重合（toEnd 退化）→ 整个关节跳过（含 pole）；方向相反（轴退化）→ 跳过旋转。
- 测试锚点：ik-solver.test.ts 以闭式数值断言固化上述语义（含"target=末端现位 → pole 独立执行"用例）。

## 相关

- ADR-072（工具层纯净）/ ADR-066（babylon-mmd 提及）
- frontend/src/utils/3d/bone-tools.ts、semantic-bones.ts、ik-solver.test.ts、mmd-foot-ik.test.ts