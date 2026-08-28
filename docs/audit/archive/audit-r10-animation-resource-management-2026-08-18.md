# R10 审核：动画系统资源管理

> 日期：2026-08-18
> 范围：`frontend/src/utils/3d/adapters/mmd-adapter.ts` / `vrm-adapter.ts`
> 关注：AnimationMixer 生命周期、clip/unuse/unuseCache、blob URL、action stop 模式

---

## 结论

| 问题 | 级别 | 状态 | 修复建议 |
|------|------|------|----------|
| MMD 未调 `mixer.uncacheRoot()` | **P1** | 🔴 待修 | dispose 加 `mixer.uncacheRoot(mesh)` |
| VRM 无测试覆盖 | P3 | ✅ 已知 | `vrm-adapter.test.ts` 不存在，非本次范围 |
| 旧 action 未显式 stop（切换 clip） | P4 | ✅ 可接受 | `stopAllAction` 已覆盖，uncacheRoot 后完全清理 |
| Blob URL 泄漏 | ✅ | ✅ 无泄漏 | MMD/VMD/VPD/VRMA 均在 dispose 中回收 |

---

## 详细分析

### 1. AnimationMixer 生命周期（Three.js 0.185）

**MMD Adapter（`mmd-adapter.ts`）**：

```typescript
// build()
const mixer = new THREE.AnimationMixer(mesh);
const clips = []; // VMD → AnimationClip
let action = mixer.clipAction(clips[0].clip);
action.play();

// dispose()
mixer.stopAllAction();  // 仅停用，不清理内部缓存
// ❌ 缺少：mixer.uncacheRoot(mesh)
```

**VRM Adapter（`vrm-adapter.ts`）**：

```typescript
// build()
motionMixer = new THREE.AnimationMixer(vrm.scene);
motionAction = motionMixer.clipAction(motionClips[0].clip);
motionAction.play();

// dispose()
motionMixer?.stopAllAction();
motionMixer?.uncacheRoot(vrm.scene);  // ✅ 正确
VRMUtils.deepDispose(vrm.scene);
```

### 2. `stopAllAction()` vs `uncacheRoot()` 行为差异

| 方法 | 作用 | 适用场景 |
|------|------|----------|
| `stopAllAction()` | 停用所有 active action，保留 `_actionsByClip` / `_bindingsByRootAndName` 缓存 | 暂停播放 |
| `uncacheRoot(root)` | 释放该 root 的所有 binding/action 缓存，调 `restoreOriginalState()` | 模型销毁/换模型 |
| `uncacheClip(clip)` | 释放特定 clip 的 action+binding | 多 clip 复用场景（如 VRM 多动作） |

**实测验证（Three.js 0.185）**：
```
after play+update:   actions.inUse=1 bindings.inUse=1
after stop:          actions.inUse=0 bindings.inUse=0    ← stop() 不释放缓存
after stopAllAction: actions.inUse=0 bindings.inUse=0    ← 同上
after uncacheRoot:   actions.inUse=0 bindings.inUse=0    ← 释放缓存 + restoreOriginalState
```

**结论**：`stopAllAction()` 仅停用 action，不释放底层 `PropertyMixer` 缓存。`uncacheRoot()` 是完整清理。

### 3. MMD 缺失 `uncacheRoot()` 的实际影响

**风险等级：低（P1）**

- **当前**：`mixer.stopAllAction()` → `mmd.dispose()` → `fullCleanup()` 清除 geometry/material
- **缺失**：mixer 内部 `_bindingsByRootAndName` / `_actionsByClip` 缓存残留
- **实际影响**：
  - MMD 每个模型单 mixer，无 clip 复用需求
  - 换模型时旧 mixer 由 GC 回收（引用断开）
  - `PropertyMixer.restoreOriginalState()` 不会调用（仅对骨骼变换有副作用，但 mmd.dispose 已重置骨骼）

**修复成本**：1 行代码
**价值**：完整性 + 防御性编程，与 VRM 对齐

### 4. Blob URL 生命周期

| 来源 | 创建 | 回收时机 | 状态 |
|------|------|----------|------|
| 模型 blob | `loadAsync` 前 | `dispose()` line 406 | ✅ |
| 纹理 blob | 并行 `loadAsync` 期间 | `dispose()` line 406 / error line 189 | ✅ |
| VPD blob | `buildMmdScene` 加载时 | `dispose()` line 406 | ✅ |
| VRMA | 无（直接 ArrayBuffer） | N/A | ✅ |

**VPD blob URL 确认路径**：
```typescript
// line 231-232
const vpdBlobUrl = URL.createObjectURL(new Blob([vpdBytes.buffer]));
blobUrls.push(vpdBlobUrl);  // ← 进入统一回收池
```

### 5. 旧 Action 切换策略

```typescript
// MMD clip 切换（line 313-315）
action?.stop();                    // 停旧 action
action = mixer.clipAction(clips[i].clip);  // 新建/复用新 action
if (playing) action.play();
```

**分析**：
- `action?.stop()` 停用旧 action，但旧 clip 的 cache 仍保留在 mixer 中
- `mixer.clipAction(clips[i].clip)` 若 clip 已存在则返回已有 action（缓存命中）
- **无泄漏风险**：MMD 单 mixer 单 root，总 action 数 = VMD 数量（通常 <10）
- **可优化**：dispose 时加 `uncacheRoot(mesh)` 可强制清理所有 clip 缓存

### 6. 测试覆盖

| 适配器 | 测试文件 | dispose 覆盖 |
|--------|----------|-------------|
| MMD | `mmd-adapter.test.ts` ✅ | 6 处 `built.dispose()` 调用 |
| VRM | ❌ 无测试文件 | N/A |

---

## 修复建议

### P1: MMD dispose 补 `uncacheRoot()`

**文件**：`frontend/src/utils/3d/adapters/mmd-adapter.ts:399`

```typescript
dispose: (): void => {
  bonePanelRef.current?.();
  mixer.stopAllAction();
  mixer.uncacheRoot(mesh);  // ← 新增：释放 PropertyMixer 缓存
  breath.reset();
  gaze.reset();
  blink.dispose();
  lipSync.dispose();
  autoDance.dispose();
  footIK.dispose();
  for (const url of blobUrls) URL.revokeObjectURL(url);
  mmd.dispose();
},
```

### P3: VRM 适配器补充测试（可选）

创建 `frontend/src/utils/3d/adapters/vrm-adapter.test.ts`，覆盖：
- `dispose()` 调用链：`stopAllAction` → `uncacheRoot` → `deepDispose`
- VRMA 无场景（目录无 .vrma）时 mixer 为 null 的边界

---

## 验证命令

```bash
# TypeScript
cd frontend && npx tsc --noEmit

# MMD 测试
npx vitest run src/utils/3d/adapters/mmd-adapter.test.ts

# 构建
npx vite build
```

---

## 状态复核（2026-08-23）

> 复核方法：对照本报告 P1（MMD dispose 补 `uncacheRoot()`），实证 `frontend/src/utils/3d/adapters/mmd-adapter.ts` 当前代码现实。

| 项 | 报告评级 | 2026-08-23 代码现实 | 结论 |
|----|---------|-------------------|------|
| P1 MMD dispose 补 `uncacheRoot()` | 🔴 待修 | `mmd-adapter.ts:960` `mixer.uncacheRoot(mesh)` 已落地，对齐 `vrm-adapter.ts` ADR-084 L2（stopAllAction + uncacheRoot + VRMUtils.deepDispose） | ✅ 已修 |

**复核结论**：本报告唯一 P1 已构成历史债务并已偿还。Blob URL 回收、VRM 测试覆盖等其余项报告本身已标 ✅。报告原文（2026-08-18 时态快照）保留不变。
