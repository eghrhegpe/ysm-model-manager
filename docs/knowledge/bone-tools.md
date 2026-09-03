---
kind: bone-tools
name: 跨格式骨骼工具层 bone-tools
tier: leaf
adr:
  - ADR-109
category: rendering
source_files:
  - frontend/src/preview-3d/bone-tools.ts
  - frontend/src/preview-3d/adapters/vrm-bone.ts
  - frontend/src/preview-3d/adapters/vrm-bone-ui.ts
  - frontend/src/preview-3d/mmd-bones.ts
auto_fields:
  symbols_with_lines:
    - BoneDetail
    - BoneListItem
    - BoneNode
    - boneRowActiveBg
    - BoneTree
    - buildBoneTree
    - buildVrmBoneNodes
    - buildVrmBoneTree
    - findAncestorBoneId
    - getBoneDetail
    - getBonePath
    - getBonePosition
    - listBonesWithDepth
    - makeBonePanelRenderer
    - MmdBonePickResult
    - mmdBonesToBoneNodes
    - pickBone
    - pickMmdBone
    - RenderVrmBonePanel
    - setBoneNodeVisible
    - toggleBoneVisible
    - VrmBonePanelCtx
  tests:
    - frontend/src/preview-3d/bone-tools.test.ts
    - frontend/src/preview-3d/adapters/vrm-bone.test.ts
    - frontend/src/preview-3d/adapters/vrm-bone-ui.test.ts
    - frontend/src/preview-3d/mmd-bones.test.ts
tests:
  - frontend/src/preview-3d/bone-tools.test.ts
  - frontend/src/preview-3d/adapters/vrm-bone.test.ts
  - frontend/src/preview-3d/adapters/vrm-bone-ui.test.ts
  - frontend/src/preview-3d/mmd-bones.test.ts
quick_groups:
  - 3D 预览与模型追加
quick_intents:
  - 骨骼工具、骨骼树、骨骼列表
  - 骨骼拾取、骨骼显隐、BoneNode / BoneTree
  - buildBoneTree / makeBonePanelRenderer
quick_risk_lines:
  - 骨骼树必须走 bone-tools 的 buildBoneTree，禁止在 adapter 里手写骨骼树构建
pitfalls:
  - adapter 手写骨骼树 → 与 bone-tools 输出不一致、缺骨骼显隐控制；必须经 buildBoneTree
  - VRM 骨骼映射未走 vrm-bone.ts → 骨骼名不匹配、动画错乱；必须经 vrm-bone.ts 映射

use_when:
  - 骨骼工具
  - 骨骼树
  - 骨骼拾取
  - BoneNode
  - BoneTree
  - buildBoneTree
perf:
  - cpu-bound
invariant_anchors:
  - frontend/src/preview-3d/bone-tools.ts|buildBoneTree
  - frontend/src/preview-3d/adapters/vrm-bone-ui.ts|makeBonePanelRenderer
status: active
---

# 跨格式骨骼工具层 bone-tools

## 概览

`frontend/src/preview-3d/bone-tools.ts` 是 ADR-072 落地后新增的**跨格式骨骼工具层**，屏蔽 YSM spec 扁平 bones 声明与 VRM humanoid Object3D 层级树两种形态的差异，统一为 `BoneNode` / `BoneTree` 抽象。纯逻辑零 DOM——UI 渲染不在本层（ADR-072 工具层纯净）。

## 核心职责

- `BoneNode` — 统一骨骼节点：`{ id, name, parentId, object? }`，来源无关（YSM: `bone.id`；VRM: humanoid bone 名如 `leftUpperArm`）
- `BoneTree` — 骨骼树：`byId` / `childrenMap` / `roots` / `objectToId`（object 反查供拾取沿父链匹配）
- `buildBoneTree(bones)` — 从任意扁平骨骼声明（`{id, name, parentId?, object?}`）构建层级树；YSM 扁平 bones、VRM humanoid 提取结果均可直接喂入
- `listBonesWithDepth(tree)` — 枚举骨骼+父子+深度，供面板渲染（深度缩进）
- `pickBone(tree, x, y, cam, scene, renderer)` — `Raycaster` 命中 → 沿父链匹配 `objectToId` → 返回命中骨骼 id
- `hideBone(tree, id, visible)` — 显隐骨骼及其子树（`object.visible` 切换）
- `getBoneDetail(tree, id)` — 骨骼详情：路径（从根到当前）/ 坐标（含 parent 相对位置）/ 子骨骼列表

## 适配器接线

| 格式 | 输入 | 转换 | 输出 |
|------|------|------|------|
| **YSM** | `spec.bones[]` 扁平 | `mmd-bones.ts` 不接（YSM 直接 `buildBoneTree`） | `BoneTree` → `makeBonePanelRenderer` |
| **VRM** | `vrm.humanoid` Object3D 树 | `vrm-bone.ts` 的 `buildVrmBoneNodes` + `buildVrmBoneTree` | `BoneTree` → `makeBonePanelRenderer` |
| **MMD** | `pmx.bones[]` 带 parentId | `mmd-bones.ts` 的 `mmdBonesToBoneNodes` + `buildBoneTree` | `BoneTree` → `makeBonePanelRenderer` |

**`makeBonePanelRenderer(tree)`**（`vrm-bone-ui.ts`）：通用骨骼面板渲染器（ADR-077 三端接入），返回 `RenderVrmBonePanel` 函数：
- 深度缩进列表（`└─`/`├─`，`listBonesWithDepth` 驱动）
- 显隐勾选（`hideBone` 开关，含父子联动：父 hidden 子全 hidden）
- 详情区（`getBoneDetail` 展示路径/坐标/子骨骼数）
- 拾取联动（`pickBone` 高亮命中项，点击同步）
- 测试：`vrm-bone-ui.test.ts` 8 例覆盖列表/详情/显隐/拾取

## 已知边界

- **不做 UI 渲染**：纯逻辑层，DOM 操作由 `vrm-bone-ui.ts` 的 `makeBonePanelRenderer` 消费
- **不替代既有层**：YSM 侧的 `bone-list.ts` / `bone-raycast.ts` / `bone-visibility.ts`（`model3d.md` 已有）不推倒，本层是**通用工具**；是否桥接见任务 #5 检查结论（ADR-077 后决策）
- **object 可选**：纯列表/路径/详情场景可缺省 `object` 字段（无 3D 节点也构建完整树结构）

## 不变量

- `objectToId` 是唯一可靠拾取索引——不依赖 name 约定、不依赖场景图遍历
- `buildBoneTree` 输入契约足够宽：仅要求 `{id, name, parentId?, object?}`；`parentId` 为 `null` 视为根
- `hideBone` 父子联动但**不影响 scene 图结构**（仅 `object.visible` 切换）

## 相关

- [preview_core](./preview_core.md) — 通用外壳 + 骨骼面板接线（`setAdapterItems` 收编）
- [model3d](./model3d.md) — YSM 侧既有 `bone-list`/`bone-raycast`/`bone-visibility`（未桥接，见边界）
- ADR-077（三端骨骼面板通用外壳）