# 通用骨骼工具层架构经验

> 本文档沉淀 YSM 项目中 `features/preview-3d/bone-tools.ts` 的架构设计经验，供其他 3D 项目参考。

## 背景

YSM 需要同时支持多种 3D 格式（YSM/VRM/MMD），各格式的骨骼数据结构差异大：

| 格式 | 骨骼数据来源 | 层级结构 |
|------|-------------|---------|
| YSM | spec.bones (扁平数组) | parentId 引用 |
| VRM | humanoid.humanBones (命名索引) | 沿 Object3D 父链推导 |
| MMD | pmx.bones (索引数组) + mesh.skeleton.bones | parentBoneIndex |

## 核心抽象：BoneNode + BoneTree

```typescript
/** 统一骨骼节点：来源无关 */
interface BoneNode {
  id: string;           // 唯一标识（YSM: bone.id; VRM: humanoid bone 名）
  name: string;         // 显示名
  parentId: string | null;  // 父骨骼 id（无 = 根）
  object?: THREE.Object3D;  // 可选 3D 节点（拾取/显隐需要）
}

/** 骨骼树：id 索引 + 子映射 + 根集合 */
interface BoneTree {
  byId: Map<string, BoneNode>;
  childrenMap: Map<string, string[]>;
  roots: string[];
}
```

**设计要点**：
1. `object` 可选——纯列表/路径/详情场景不需要 3D 节点
2. `parentId` 统一为字符串引用，格式专属适配层负责转换
3. `BoneTree` 提供 O(1) 查找 + O(n) 遍历能力

## 分层架构

```
┌─────────────────────────────────────────┐
│         UI 渲染层 (vrm-bone-ui.ts)       │  ← 格式专属 UI
├─────────────────────────────────────────┤
│      格式适配层 (vrm-bone/mmd-bones)     │  ← 格式转换
├─────────────────────────────────────────┤
│      通用工具层 (bone-tools.ts)          │  ← 格式无关逻辑
├─────────────────────────────────────────┤
│         Three.js 原生 API                │  ← 底层依赖
└─────────────────────────────────────────┘
```

**分层原则**：
- 通用层零 DOM 依赖，纯逻辑
- 格式适配层只做数据转换，不实现业务逻辑
- UI 层消费通用层，不直接访问格式数据

## 通用能力清单

| 能力 | 函数 | 说明 |
|------|------|------|
| 树构建 | `buildBoneTree()` | 扁平声明 → 层级树 |
| 列表枚举 | `listBonesWithDepth()` | 前序遍历 + 深度缩进 |
| 路径查询 | `getBonePath()` | id → "root/spine/head" |
| 坐标查询 | `getBonePosition()` | id → WorldPosition |
| 详情查询 | `getBoneDetail()` | 完整信息卡片 |
| 显隐控制 | `setBoneVisible()` / `toggleBoneVisible()` | 子树可见性传播 |
| 父子回溯 | `findAncestorBoneId()` | Object3D 父链 → 骨骼 id |
| 射线拾取 | `pickBone()` | Raycaster → 骨骼归属 |

## 格式适配模式

### YSM 适配（已有）
```typescript
// bone-list.ts / bone-raycast.ts 提供 YSM 专属转换
// 输出 BoneNode[] 供通用层消费
```

### VRM 适配（vrm-bone.ts）
```typescript
export function buildVrmBoneNodes(vrm: VRM): BoneNode[] {
  // 沿 Object3D 父链推导 parentId
  // 输出标准 BoneNode[]
}
```

### MMD 适配（mmd-bones.ts）
```typescript
export function mmdBonesToBoneNodes(pmxBones, meshBones): BoneNode[] {
  // pmx.bones 索引 → BoneNode.id
  // meshBones[i] → BoneNode.object
}
```

## 拾取策略分离

**关键决策**：拾取策略不放入通用层，各格式自管。

| 格式 | 拾取策略 | 原因 |
|------|---------|------|
| YSM | `bone-raycast.ts` intersectObjects + name 归属 | cube mesh 有几何 |
| MMD | `pickMmdBone()` 射线到骨骼距离 | Bone 无几何 |
| VRM | 待实现 | humanoid node 有几何 |

通用层仅提供 `findAncestorBoneId()` 和 `pickBone()` 作为基础能力，具体策略由适配层组合。

## 测试策略

```typescript
// bone-tools.test.ts — 纯逻辑测试（无需 Three.js 实例）
describe("buildBoneTree", () => {
  it("扁平 → 层级", () => { ... });
  it("环边防御", () => { ... });
});

// vrm-bone.test.ts — 格式适配测试（mock VRM 对象）
describe("buildVrmBoneNodes", () => {
  it("标准 humanoid 提取", () => { ... });
  it("无 humanoid 降级", () => { ... });
});
```

**测试原则**：
- 通用层测试零 Three.js 依赖（纯数据结构）
- 适配层测试 mock 格式对象（不加载真实文件）

## 性能考虑

1. **BoneTree 缓存**：`byId` Map 提供 O(1) 查找，适合高频查询
2. **路径计算守卫**：`guard++ < 1000` 防止环边无限递归
3. **对象引用复用**：`object` 字段直接引用 Three.js 节点，避免重复查询

## 迁移指南

其他项目引入本架构的步骤：

1. **定义 BoneNode/BoneTree 接口**（可调整字段名）
2. **实现 buildBoneTree()**（核心算法）
3. **实现通用能力函数**（list/detail/path/visible）
4. **各格式适配层**（仅做数据转换）
5. **UI 层消费 BoneTree**（不直接访问格式数据）

## 相关文件

- `frontend/src/features/preview-3d/bone-tools.ts` — 通用工具实现
- `frontend/src/features/preview-3d/adapters/vrm-bone.ts` — VRM 适配
- `frontend/src/features/preview-3d/mmd-bones.ts` — MMD 适配
- `frontend/src/features/preview-3d/bone-tools.test.ts` — 通用层测试
- `frontend/src/features/preview-3d/adapters/vrm-bone.test.ts` — 适配层测试
