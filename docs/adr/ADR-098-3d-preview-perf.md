# ADR-098: 3D 预览性能优化——纹理复用 + 视锥裁剪 + 按需更新

- **状态**：✅ 已采纳
- **日期**：2026-08-18
- **决策人**：Jieling、AI 代理
- **相关**：`ADR-066 ADR-097 ADR-099`

## 背景

模型切换时每次重建完整 3D 内容层（几何体 + 纹理 + 材质 + 动画），无任何复用。同纹理文件每次 fetch → decode → upload GPU，显存浪费严重。多模型场景中离屏模型仍逐帧渲染 + 驱动 IK/感知层，白白消耗 CPU/GPU。

## 决策

建立三级优化体系：纹理缓存池 → 视锥裁剪 → 按需更新。

### P0：纹理缓存池 `texture-cache.ts`

- `TextureCacheImpl` 类：`acquire(url, make)` 缓存命中返回已有纹理，未命中调 make 创建
- `release(url)` 引用 -1，归零不 dispose（跨模型复用）
- `disposeAll()` session 结束统一释放
- 全局单例 `textureCache`

**消费端改造**：
- `model3d-loader.ts`：`loadTextures` 改用 `textureCache.acquire(url, make)` 替代每次 new Image + new Texture
- `pack-model-adapter.ts`：`textureFor` 改用 `textureCache.acquire(dataUrl, make)` 替代 TextureLoader.loadAsync
- `cleanup-3d.ts`：session 结束调 `textureCache.disposeAll()`

**收益**：同纹理跨模型复用，显存省 30-50%；不同模型切换时纹理零重建。

### P4：Frustum Culling `frustum-cull.ts`

- `registerModelRoot(obj)` / `unregisterModelRoot(obj)` — adapter 注册/注销模型根节点
- `cullModelGroups(camera)` — 每帧遍历已注册 modelRoots，计算 BoundingBox → Sphere，与 camera frustum 测试，设 visible=false
- 内部复用 `_frustum/_projScreenMatrix/_box/_sphere` 避免 per-frame GC
- `clearModelRoots()` session 结束清空

**消费端改造**：
- 4 个 adapter（YSM/MMD/VRM/Litematic）在 build 时 `registerModelRoot`，dispose 时 `unregisterModelRoot`
- `litematic-adapter`：所有 instancedMesh 加到 `modelGroup`（新建 Group）而非 scene，整体注册
- `mount-preview-core.ts`：render loop 中 `perFrame(dt)` 之后、`rd.render(sc, cam)` 之前调用 `cullModelGroups(cam)`
- `cleanup-3d.ts`：session 结束调 `clearModelRoots()`

**收益**：离屏模型 Three.js 跳过整组遍历（Group 级 BoundingSphere 测试），GPU 渲染 + CPU 遍历双省。

### Adapter skip invisible models

在 MMD/VRM adapter 的 `update(dt)` 入口添加可见性检查：

```typescript
// mmd-adapter.ts
update: (dt: number): void => {
  if (!mesh.visible) return; // Frustum Culling 不可见 → 跳过 IK/感知层，省 CPU
  mmd.updateWithMixer(dt, mixer, { ik: true, grant: true });
  // ...
}

// vrm-adapter.ts
update: (dt: number): void => {
  if (!vrm.scene.visible) return; // Frustum Culling 不可见 → 跳过 springBone/感知层，省 CPU
  if (motionMixer) motionMixer.update(dt);
  // ...
}
```

**YSM adapter**：无 update 函数（纯静态模型），无需改造。

**收益**：离屏模型跳过 IK 解算、springBone 物理、呼吸/眨眼/注视/LipSync 等感知层，CPU 大幅节省。

## 多模型场景分析

`keepInScene` 模式下旧模型已有双重保护：
1. `perFrame` 只指向最新 built 的 update，旧模型动画天然冻结
2. `cullModelGroups` 不可见时 `visible=false`，Three.js 跳过渲染

无需额外优化。

## 各 adapter 复用边界

| 层 | 复用（外壳） | 重建（内容层） |
|----|-------------|--------------|
| WebGL | renderer, scene, camera, controls | — |
| 灯光 | Sky, Ground, Light caps | — |
| 后处理 | Postprocessing (Bloom) | — |
| 循环 | rAF + Resize/Key events | — |
| YSM | — | buildYsmObject → rootGroup + Mesh[] |
| MMD | — | MMDLoader → Mesh + Mixer |
| VRM | — | VRMLoaderPlugin → VRM |
| Litematic | — | 体素 InstancedMesh 分块 |
| **纹理** | **textureCache（跨模型复用）** | 仅首次创建 |

## P1-P3 评估（已排除）

| 项目 | 结论 |
|------|------|
| P1 几何体缓存 | geometry 创建 1-5ms（vs 纹理 100-500ms），ROI 低 |
| P2 材质工厂 | 材质轻量且每材质唯一（不同纹理引用），ROI 低 |
| P3 骨骼树缓存 | buildBoneTree 是纯函数，输入 spec 已缓存，ROI 低 |
| LOD 管理 | 成品模型无预制 LOD 变体，实时网格简化非 trivial，暂不实施 |

## 测试

- `texture-cache.test.ts`：8 个测试（同 url 复用、不同 url 独立、release 归零保留、disposeAll 释放、disposeAll 后重建）
- `frustum-cull.test.ts`：8 个测试（register/unregister/clear/重复注册/移除后自动清理/空组裁剪/多模型独立裁剪）

## 文件清单

| 文件 | 变更 |
|------|------|
| `frontend/src/utils/3d/texture-cache.ts` | 新建：纹理缓存池 |
| `frontend/src/utils/3d/frustum-cull.ts` | 新建：视锥裁剪 |
| `frontend/src/utils/3d/texture-cache.test.ts` | 新建：纹理缓存测试 |
| `frontend/src/utils/3d/frustum-cull.test.ts` | 新建：视锥裁剪测试 |
| `frontend/src/utils/3d/model3d-loader.ts` | 改造：loadTextures 用 textureCache |
| `frontend/src/utils/3d/pack-model-adapter.ts` | 改造：textureFor 用 textureCache |
| `frontend/src/utils/3d/adapters/cleanup-3d.ts` | 改造：textureCache.disposeAll + clearModelRoots |
| `frontend/src/preview-3d/adapters/mount-preview-core.ts` | 改造：cullModelGroups(cam) |
| `frontend/src/preview-3d/adapters/ysm-adapter.ts` | 改造：registerModelRoot |
| `frontend/src/utils/3d/adapters/mmd-adapter.ts` | 改造：registerModelRoot + skip invisible |
| `frontend/src/utils/3d/adapters/vrm-adapter.ts` | 改造：registerModelRoot + skip invisible |
| `frontend/src/preview-3d/adapters/litematic-adapter.ts` | 改造：modelGroup + registerModelRoot |
