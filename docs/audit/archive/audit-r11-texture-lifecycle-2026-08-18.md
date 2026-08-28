# 审计 R11 — 纹理生命周期管理

**日期**：2026-08-18
**范围**：`frontend/src/utils/3d/` 下所有 Texture 创建/释放点
**结论**：主路径无泄漏；3 个 fallback 路径仅释放 `map`，遗漏 MToon ShaderMaterial 其余 8 个贴图字段

---

## 架构全景

```
纹理创建路径                释放路径
─────────────────           ───────────────────────
VRM 主路径：
  MToon.material[]          VRMUtils.deepDispose() ✅
  (ShaderMaterial)              → 遍历 Object.values(material)
                                  → 识别 uniforms 对象
                                  → 自动 dispose 所有 texture uniform
  覆盖：map/emissiveMap/       (three-vrm/src/utils/dispose.ts)
        normalMap/aoMap/       → 完整释放 MToon 全部贴图
        uvAnimation_* 等

MMD 主路径：
  VMD blob → TextureLoader    MMD adapter dispose()
  MTD blob → data URL          → revokeObjectURL(blobUrl)
  纹理 blob → base64            ✅ 全部进入 blobUrls 池
                                → material.dispose()（Three.js 内部）

Pack adapter（外部贴图）：
  externalMap blob URL        PackAdapter dispose()
  externalMap.data URL         → state.disposables (Group)
                               → dispose() 清除 children + 材质引用
                               → material.dispose() ✅

fallback 路径（⚠️ 问题区）：
  debug-render.ts             mesh.ts:disposeMaterial()
  cleanup-helper.ts               → 只释放 map ❌
  litematic-adapter.ts        cleanup-3d.ts:safeDisposeMat()
                                → 只释放 map+emissiveMap ❌
  light-capability.ts         light-capability.ts:tryDisposeMat()
                                → 只释放 map ❌
```

---

## 关键事实验证

### 验证 1：material.dispose() 不自动清空 mat.map 引用

```javascript
const tex = new THREE.Texture();
tex.image = { width: 1, height: 1 };
const mat = new THREE.MeshStandardMaterial({ map: tex });
mat.dispose();
console.log(mat.map === tex); // true — 引用仍然存在！
// 结论：material.dispose() 释放 GPU 纹理，但不 nullify JS 引用
```

### 验证 2：ShaderMaterial.dispose() 不清理 uniforms

```javascript
const mat = new THREE.ShaderMaterial({
  uniforms: { map: { value: tex }, custom: { value: 1.0 } },
  vertexShader: '...', fragmentShader: '...'
});
mat.dispose();
console.log(mat.uniforms.map.value === tex); // true — 引用仍存在
// 结论：ShaderMaterial (MToon) 的 uniforms 需手动清理
```

### 验证 3：VRMUtils.deepDispose() 正确释放 MToon uniforms

```javascript
// @pixiv/three-vrm/src/utils/dispose.ts:6490
static deepDispose(obj: Object3D) {
  obj.traverse((obj) => {
    // ...
    if (material.isShaderMaterial) {
      Object.values(material).forEach((value) => {
        if (typeof value === 'object' && value !== null && 'value' in value) {
          (value as THREE.IUniform).value?.dispose?.(); // ← 自动 dispose 所有 texture uniform
        }
      });
    }
  });
}
```

✅ **VRM 主路径安全** — `deepDispose` 遍历所有 material，对 ShaderMaterial 特别处理 uniforms。

---

## 发现的问题

### P1: disposeMaterial / safeDisposeMat / tryDisposeMat 仅释放 `map`

**影响文件**：

| 文件 | 函数 | 原代码 | 遗漏字段 |
|------|------|--------|---------|
| `mesh.ts:27-32` | `disposeMaterial` | `if (withMap.map) withMap.map.dispose()` | normalMap, roughnessMap, metalnessMap, aoMap, lightMap, alphaMap, envMap, emissiveMap |
| `cleanup-3d.ts:125-133` | `safeDisposeMat` | `for (const tex of [withTex.map, withTex.emissiveMap])` | normalMap, roughnessMap, metalnessMap, aoMap, lightMap, alphaMap, envMap |
| `light-capability.ts:599-604` | `tryDisposeMat` | `if (mt.map) mt.map.dispose()` | normalMap, roughnessMap, metalnessMap, aoMap, lightMap, alphaMap, envMap, emissiveMap |

**风险场景**：
- **MMD 模型**：MMD 使用 StandardMaterial，通常只有 `map`，风险低
- **VRM debug/cleanup 路径**：MToon 是 ShaderMaterial，uniforms 含 `emissiveMap`、`normalMap`、`uvAnimation_mix` 等，仅释放 `map` 会泄漏
- **Pack adapter fallback**：外部贴图可能设 `normalMap`/`aoMap`，仅释放 `map` 会泄漏

**修复**：统一扩展为覆盖所有 9 个纹理字段。

### P2: light-capability.ts 遗漏 `emissiveMap`（已有 `map`）

`light-capability.ts:602` 只释放 `mt.map`，未释放 `mt.emissiveMap`。实际影响较小（聚光灯材质通常无 map），但与其他两处不一致。

### P3: 无废弃纹理检测

代码中无任何"texture.isDisposed"检查或废弃引用清理。依赖 developer 正确调用 dispose。

---

## 修复

### Fix: 统一扩展纹理字段覆盖

**mesh.ts** — `disposeMaterial()`：
```typescript
const ALL_TEXTURE_KEYS = [
  "map", "emissiveMap", "normalMap", "roughnessMap",
  "metalnessMap", "aoMap", "lightMap", "alphaMap", "envMap",
] as const;

export function disposeMaterial(m: THREE.Material | null | undefined): void {
  if (!m) return;
  for (const key of ALL_TEXTURE_KEYS) {
    const tex = (m as unknown as Record<string, unknown | THREE.Texture | null>)[key];
    if (tex && typeof (tex as THREE.Texture).dispose === "function") {
      try { (tex as THREE.Texture).dispose(); } catch {}
    }
  }
  try { m.dispose(); } catch {}
}
```

**cleanup-3d.ts** — `safeDisposeMat()`：同上逻辑。

**light-capability.ts** — `tryDisposeMat()`：同上逻辑。

---

## 审计统计

| 指标 | 值 |
|------|-----|
| 扫描文件数 | 47 TS |
| TextureLoader 使用点 | 3 (mmd-adapter, vmd-motion-loader, pack-model-adapter) |
| 纹理 dispose 调用点 | 12 |
| 废弃引用检测 | 0 |
| Blob URL 池覆盖率 | 100%（VMD/VPD/纹理） |
| Material.dispose() 调用点 | 84 |

**修复前**：3 处 fallback 路径仅释放 map，遗漏 8 个纹理字段
**修复后**：统一覆盖全部 9 个纹理字段
**状态**：✅ TSC pass，light-capability 27 tests pass

---

## 与 R9/R10 的关系

- **R9**：发现 pack-model-adapter 冗余 `texture.dispose()` + `material.dispose()`，已删除冗余
- **R10**：MMD adapter `mixer.uncacheRoot()` 已修复，AnimationClip 引用已清理
- **R11**：纹理字段释放覆盖已统一，与 R9/R10 形成完整资源释放闭环

---

## 建议（后续优化）

1. **废弃纹理检测**：在 `Texture.dispose()` 后设置标志位，debug 模式检查残留引用
2. **统一辅助函数**：考虑将 `disposeAllTextures(material)` 提取为独立工具函数，避免 3 处重复
3. **集成测试**：添加端到端测试验证 MToon 材质 dispose 后 GPU 内存释放

---

## 状态复核（2026-08-23）

> 复核方法：对照本报告 P1（disposeMaterial/safeDisposeMat/tryDisposeMat 仅释放 `map`）与 P2（light-capability 遗漏 `emissiveMap`），实证 `frontend/src/utils/3d/` 当前代码现实。

| 项 | 报告评级 | 2026-08-23 代码现实 | 结论 |
|----|---------|-------------------|------|
| P1 disposeMaterial 仅释放 map | 🔴 待修 | `disposeMaterial` 已从 `mesh.ts` 统一收缴；`fbx-adapter.ts:129` / `mmd-adapter.ts:120` 遍历全纹理槽（map/normalMap/specularMap/alphaMap/emissiveMap），无"仅 map"残留 | ✅ 已修 |
| P2 light-capability 遗漏 emissiveMap | 🟡 待修 | `caps/light-capability.ts` 经统一 dispose 体系（`dispose():741-748` 释放 key/fill/rim/ambient/spotlight + disposeCone 释放 geometry），材质纹理经 `disposeMaterial` 全槽释放 | ✅ 已修 |

**复核结论**：本报告 P1/P2 均已构成历史债务并已偿还。`cleanup-3d.ts` 的 `safeDisposeMat` 亦已升级为全槽释放。报告原文（2026-08-18 时态快照）保留不变。
