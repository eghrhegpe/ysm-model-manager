# ADR-108：相机取景包围盒计算策略

- **状态**：✅ 已采纳
- **日期**：2026-08-20
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`frontend/src/preview-3d/infra/camera-setup.ts` / `ysm-adapter.ts` / `vrm-adapter.ts` / `mmd-adapter.ts` / ADR-041（scale 对齐）
- **问题**：YSM 模型相机镜头拉得很远（约 18000 单位），与 MMD/VRM 模型显示比例不一致

---

## 1. 背景（Context）

YSM（基岩版模型）使用 1/16 scale（16 像素 = 1 米），`rootGroup.scale.set(1/16, 1/16, 1/16)`。
相机取景需要根据模型实际渲染尺寸计算距离，公式为：

```
dist = max(size.x, size.y, size.z) * 1.5 + 2
```

### 问题重现

**第一轮尝试**：用 `scene.traverse + expandByObject`
```typescript
scene.traverse((child) => {
  if ((child as THREE.Mesh).isMesh) box.expandByObject(child);
});
```
结果：包围盒忽略父节点 scale，算出像素单位尺寸（大 16 倍）→ 相机距离放大 16 倍。

**第二轮尝试**：改用 `setFromObject(scene)`
```typescript
const box = new THREE.Box3().setFromObject(scene);
```
结果：sky capability 的 scale=12000 污染包围盒 → 相机距离约 18000 单位。

**最终方案**：adapter 显式传入 contentRoot
```typescript
const box = new THREE.Box3().setFromObject(contentRoot);
```

---

## 2. 决策（Decision）

### 2.1 相机取景使用显式 contentRoot，不依赖 scene.children 顺序

**决策**：`fitCameraToScene` 签名改为接收 `contentRoot: Object3D | null`，由 adapter 显式传入模型根节点。

**理由**：
1. `children[length-1]` 假设脆弱——若 sky/ground 在模型后 add，再次被污染
2. 与 VRM/MMD 口径统一：它们都传根节点（`vrm.scene` / `mesh`）
3. 语义清晰：adapter 知道自己加了什么

**对比**：

| 适配器 | 包围盒计算方式 | 是否显式传根 |
|--------|--------------|------------|
| VRM | `setFromObject(vrm.scene)` | ✅ |
| MMD | `setFromObject(mesh)` | ✅ |
| YSM（修复后） | `setFromObject(obj.rootGroup)` | ✅ |
| YSM（修复前） | `setFromObject(scene)` 或 `children[length-1]` | ❌ |

### 2.2 合并 fitCameraToScene 和 fitCameraToRoots 为统一内部实现

**决策**：提取 `fitCameraToBounds(roots, camera, controls)` 内部函数，两个公开接口复用同一实现。

**理由**：
- 消除 60% 代码重复
- 测试一处覆盖全部路径
- 未来修改只需改一处

### 2.3 sky/ground capability 在 adapter.build 之前 add 进 scene

**既有契约**：`mount-preview-core.ts` 中所有 capability（sky、ground、light 等）在 `adapter.build()` 之前 add 进 scene。这个顺序是隐式契约，本次修复强化了它（显式传 root 不依赖顺序）。

---

## 3. 实施（Implementation）

### 3.1 签名变更

```typescript
// 旧
export function fitCameraToScene(
  scene: THREE.Scene,
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
): { ... }

// 新
export function fitCameraToScene(
  contentRoot: THREE.Object3D | null,
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
): { ... }
```

### 3.2 调用点变更

```typescript
// ysm-adapter.ts:121
// 旧
fitCameraToScene(ctx.scene, ctx.camera, ctx.controls);
// 新
fitCameraToScene(obj.rootGroup, ctx.camera, ctx.controls);
```

### 3.3 内部实现统一

```typescript
function fitCameraToBounds(
  roots: THREE.Object3D[],
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
): { ... } {
  const box = new THREE.Box3();
  for (const root of roots) {
    root.updateMatrixWorld();
    box.expandByObject(root);
  }
  // ... 相机位置计算逻辑
}

export function fitCameraToScene(contentRoot, camera, controls) {
  return fitCameraToBounds(contentRoot ? [contentRoot] : [], camera, controls);
}

export function fitCameraToRoots(roots, camera, controls) {
  return fitCameraToBounds(roots, camera, controls);
}
```

---

## 4. 后果（Consequences）

### 正面
- 相机距离与 MMD/VRM 一致（约 5 单位 vs 修复前 18000 单位）
- 代码更简洁（减少重复，统一接口）
- 测试覆盖完整（7 个用例全绿）
- 与 VRM/MMD 口径统一，降低维护认知负担

### 负面 / 风险
- **破坏性变更**：`fitCameraToScene` 签名改变，需更新所有调用点（目前仅 ysm-adapter 一处）
- **测试依赖真实 Three.js**：需要 mock `document.createElement`（已有模式）

### 已知遗留
- `fitCameraToScene` 和 `fitCameraToRoots` 仍是两个公开函数（只是内部共享实现），未来可考虑进一步合并
- `children[length-1]` hack 的注释已从源码中删除，但 git history 保留

---

## 5. 数据溯源

- **问题报告**：用户反馈「YSM 模型相机镜头拉得很远」
- **根因定位**：`camera-setup.ts` 的 `fitCameraToScene` 用 `scene.traverse` 或 `setFromObject(scene)` 都会包含 sky（scale=12000）
- **验证**：浏览器 console 输出 `[Camera] Box size: 12000` → 修复后 `[Camera] Box size: 1.00 2.50 1.00`
- **回归防护**：新增 `camera-setup.test.ts`（7 个用例）

<!-- 文件名: ADR-108-camera-framing-bounding-box.md -->
