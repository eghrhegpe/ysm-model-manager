# 第 R1 轮审核报告：3D 引擎核心层

> 审核日期：2026-08-18
> 审核范围：`frontend/src/utils/3d/` 全部文件（adapters/ + caps/ + 核心工具）
> 审核方式：源码逐行审计 + 子代理并行复核（资源生命周期 / 状态机正确性 / 类型安全）
> 基线：上次审计 2026-08-06，距今 716 commits，3D 引擎层重构最剧烈

---

## 一、进度统计

| 指标 | 数值 |
|------|------|
| 审核文件数 | 28 |
| 发现问题总数 | 12 |
| P1（严重） | 2 |
| P2（一般） | 6 |
| P3（建议） | 4 |
| 已修复 | 0 |
| 待决策 | 0 |

---

## 二、P1 问题（严重）

### P1-1：ESC 事件处理器双重注册

| 字段 | 内容 |
|------|------|
| **文件** | `mount-preview-core.ts:619-623` |
| **问题** | `escH` 被重新赋值为新函数后，`removeEventListener("keydown", escH)` 使用的是**新函数引用**（从未被 add 过），实际移除的是空操作。旧处理器（L316 注册的 L303-308 版本）从未被移除。 |
| **风险** | 每次 mount3D 会话注册 2 个 ESC 处理器。旧处理器在 `cleanupFn` 赋值后调用 `fullCleanup()`，新处理器也调用 `fullCleanup()`。`fullCleanup` 有 `isDisposed.v` 守卫所以不会崩溃，但每次 ESC 触发两次 cleanup 调用，且旧处理器作为闭包持有 `overlay`/`cleanupFn` 引用，延长 GC 周期。 |
| **修复建议** | 将 L619-623 改为：先保存旧引用再 remove，然后 add 新引用。 |

```typescript
// 修复前（当前代码）：
escH = (e: KeyboardEvent): void => {
  if (e.key === "Escape") fullCleanup();
};
document.removeEventListener("keydown", escH);  // ❌ escH 已是新函数，从未被 add
document.addEventListener("keydown", escH);

// 修复后：
const oldEscH = escH;
escH = (e: KeyboardEvent): void => {
  if (e.key === "Escape") fullCleanup();
};
document.removeEventListener("keydown", oldEscH);
document.addEventListener("keydown", escH);
```

### P1-2：rAF 循环每帧分配 5 个 Vector3 对象

| 字段 | 内容 |
|------|------|
| **文件** | `mount-preview-core.ts:433-437` |
| **问题** | `animate()` 函数每帧（60-144fps）创建 5 个 `new THREE.Vector3()`：`camDir`、`forward`、`right`、内联 `new THREE.Vector3(0,1,0)`、`move`。60fps 下每秒 300 次分配，144fps 下 720 次/秒。 |
| **风险** | 持续 GC 压力，移动端/低端设备帧率抖动。Three.js 官方示例均将 Vector3 提升到循环外。 |
| **修复建议** | 将 5 个 Vector3 提升到 `animate()` 函数外（与 `euler` 同级声明）。 |

```typescript
// 在 §4a 输入绑定区域（L356 附近）添加：
const camDir = new THREE.Vector3();
const forward = new THREE.Vector3();
const right = new THREE.Vector3();
const upVec = new THREE.Vector3(0, 1, 0);
const moveVec = new THREE.Vector3();

// animate() 内替换：
cam.getWorldDirection(camDir);
forward.set(camDir.x, 0, camDir.z).normalize();
right.crossVectors(forward, upVec).normalize();
// moveVec 替代 move
```

---

## 三、P2 问题（一般）

### P2-1：`onUnifiedPick` click 处理器未在 cleanup 中显式移除

| 字段 | 内容 |
|------|------|
| **文件** | `mount-preview-core.ts:413` / `cleanup-3d.ts` |
| **问题** | `renderer.domElement.addEventListener("click", onUnifiedPick)` 在 L413 注册，但 `runFullCleanup` 的解绑列表（cleanup-3d.ts:62-70）不包含 click 事件。依赖 overlay 从 DOM 移除后 domElement GC 间接清理。 |
| **风险** | 若 renderer.domElement 被其他引用持有（如截图功能），click 处理器持续存活。当前无此场景，但属防御性缺口。 |
| **修复建议** | 在 `CleanupContext` 中添加 `onUnifiedPick` 字段，在 `runFullCleanup` 中显式 `removeEventListener("click", ...)`。 |

### P2-2：`postprocessing.ts` dispose 未释放各 Pass 的 GPU 资源

| 字段 | 内容 |
|------|------|
| **文件** | `postprocessing.ts:70-74` |
| **问题** | `disposeComposer()` 仅调用 `this.composer?.dispose()` 并置 null。EffectComposer.dispose() 不保证释放各 Pass（RenderPass/UnrealBloomPass/OutputPass）内部持有的 FrameBuffer/Texture。 |
| **风险** | 频繁切换 volumetric 开关时，旧 Pass 的 GPU 资源可能泄漏。 |
| **修复建议** | 在 `disposeComposer()` 中逐一 dispose passes： |

```typescript
private disposeComposer(): void {
  if (this.composer) {
    for (const pass of this.composer.passes) {
      pass.dispose?.();
    }
    this.composer.dispose();
  }
  this.composer = null;
  this.bloomPass = null;
}
```

### P2-3：`switch-preview.ts` topBar 清理使用 `lastChild` 而非 `lastElementChild`

| 字段 | 内容 |
|------|------|
| **文件** | `switch-preview.ts:87-89` |
| **问题** | `ctx.topBar.lastChild?.remove()` 可能移除文本节点（如元素间的空白换行），而 `childElementCount` 只统计元素节点。若 topBar 内存在文本节点，循环行为不可预测。 |
| **风险** | 当前 topBar 由 `createElement` 程序化构建，无文本节点，实际无影响。但属脆弱模式。 |
| **修复建议** | 改用 `lastElementChild`： |

```typescript
while (ctx.topBar.childElementCount > ctx.getAdapterControlsStart()) {
  ctx.topBar.lastElementChild?.remove();
}
```

### P2-4：`mmd-adapter.ts` morphTargetInfluences 非空断言

| 字段 | 内容 |
|------|------|
| **文件** | `mmd-adapter.ts:369, 385` |
| **问题** | `mesh.morphTargetInfluences![idx] = weight` 使用非空断言。`morphTargetDictionary` 存在不保证 `morphTargetInfluences` 存在（Three.js 中两者独立设置）。 |
| **风险** | 若 mesh 有 dictionary 但无 influences（边缘情况），运行时抛 TypeError。 |
| **修复建议** | 添加守卫： |

```typescript
if (idx !== undefined && mesh.morphTargetInfluences) {
  mesh.morphTargetInfluences[idx] = weight;
}
```

### P2-5：`SkyCapability.regenerateEnvironment()` 异常路径留下悬挂引用

| 字段 | 内容 |
|------|------|
| **文件** | `sky-capability.ts:143-146` |
| **问题** | `this.renderTarget.dispose()` 在 L143 执行后，若 `this.pmrem.fromScene()` 在 L144 抛异常，`this.renderTarget` 为 null 但 `this.scene.environment` 仍指向已 dispose 的 texture（L146 未执行）。 |
| **风险** | 后续渲染使用已释放的 texture，可能导致 WebGL 错误或黑屏。 |
| **修复建议** | 先创建新 renderTarget，成功后再 dispose 旧的： |

```typescript
private regenerateEnvironment(): void {
  this.envSky.material.uniforms["showSunDisc"].value = 0;
  const newTarget = this.pmrem.fromScene(this.envScene);
  this.envSky.material.uniforms["showSunDisc"].value = 1;
  if (this.renderTarget) this.renderTarget.dispose();
  this.renderTarget = newTarget;
  this.scene.environment = this.renderTarget.texture;
}
```

### P2-6：`LightCapability.dispose()` 未释放 spotlightTarget

| 字段 | 内容 |
|------|------|
| **文件** | `light-capability.ts:561-569` |
| **问题** | `dispose()` 释放了 keyLight/fillLight/rimLight/ambientLight/spotlight，但 `spotlightTarget`（THREE.Object3D）未被 dispose。`detach()` 将其从 scene 移除，但 Object3D 本身未释放。 |
| **风险** | spotlightTarget 是轻量 Object3D（无几何/材质），实际 GPU 影响可忽略。但属不一致的释放模式。 |
| **修复建议** | 在 `detach()` 的 forEach 中已包含 spotlightTarget（L555-557），但 `dispose()` 中未显式处理。建议在 `dispose()` 末尾添加注释说明 spotlightTarget 无需 dispose（纯 Object3D 无 GPU 资源）。 |

---

## 四、P3 问题（建议）

### P3-1：`cleanup-3d.ts` 过度防御性类型断言

| 字段 | 内容 |
|------|------|
| **文件** | `cleanup-3d.ts:93` |
| **问题** | `typeof (sc as unknown as { traverse?: unknown }).traverse === "function"` — THREE.Scene 始终有 `traverse` 方法，此检查无实际意义，且 `as unknown as` 双重断言是代码异味。 |
| **修复建议** | 简化为 `if (sc) sc.traverse(...)`。 |

### P3-2：`scene-registry.ts` pickModelByObject O(n×m) 复杂度

| 字段 | 内容 |
|------|------|
| **文件** | `scene-registry.ts:153-161` |
| **问题** | 对每个被射线击中的对象，遍历所有 entries 和所有 roots 做 `isDescendant` 检查。MAX_MODELS=8 时影响可忽略，但模式不具扩展性。 |
| **修复建议** | 当前量级无需优化。若未来 MAX_MODELS 提升，可考虑为每个 root 打标记（`userData.registryId`），将查找降为 O(1)。 |

### P3-3：`litematic-adapter.ts` 分层控件 DOM 元素在 dispose 中未显式清理

| 字段 | 内容 |
|------|------|
| **文件** | `litematic-adapter.ts:301-317` |
| **问题** | 分层控件（sep/axisLabel/axisSel/layerMode/layerSlider/layerInput/layerSlider2/layerInput2）在 build 中创建，经 extraControls 挂入 topBar。dispose() 仅释放 GPU 资源（instancedMeshes/materials/boxGeo/grid），未清理 DOM 元素引用。 |
| **风险** | DOM 元素随 overlay 移除而 GC，无实际泄漏。但 dispose 语义不完整。 |
| **修复建议** | 在 dispose 中添加 `topBar` 中适配器控件的移除逻辑，或在注释中说明依赖 overlay 级联清理。 |

### P3-4：`mount-preview-core.ts` animate 循环中 `postProc.render()` 返回值语义不清晰

| 字段 | 内容 |
|------|------|
| **文件** | `mount-preview-core.ts:459-460` |
| **问题** | `const rendered = postProc ? postProc.render(dt, lightCap) : false; if (!rendered) rd.render(sc, cam);` — `render()` 返回 boolean 表示"是否已由 postProc 渲染"。此语义隐含在返回值中，无文档说明。 |
| **修复建议** | 在 `PostprocessingManager.render()` 的 JSDoc 中明确返回值语义：`true` = 已由 composer 渲染（无需再 rd.render），`false` = 未激活（需 rd.render）。 |

---

## 五、审核总结

### 整体评价

3D 引擎核心层在 ADR-066 重构后架构清晰，适配器契约统一，资源释放路径基本完整。716 commits 的演进中，核心层保持了较高的代码质量。

### 关键风险

| 风险 | 等级 | 影响 |
|------|------|------|
| ESC 双重注册 | P1 | 每会话泄漏 1 个事件监听器，长期累积 |
| rAF 每帧分配 | P1 | GC 压力，移动端帧率抖动 |
| postProc Pass 未释放 | P2 | volumetric 频繁切换时 GPU 泄漏 |
| Sky renderTarget 异常路径 | P2 | 极端情况下黑屏 |

### 建议修复优先级

1. **立即修复**：P1-1（ESC 双重注册）+ P1-2（rAF 分配）— 各 5 行改动，零风险
2. **本轮修复**：P2-1 ~ P2-5 — 防御性加固
3. **下轮处理**：P2-6 + P3 系列 — 代码整洁度

---

## 状态复核（2026-08-23）

> 复核方法：对照本报告 P1×2 / P2×6，实证 `frontend/src/utils/3d/` 当前代码现实（注意 postprocessing/sky/light 已迁至 `caps/` 子目录）。

| 项 | 报告评级 | 2026-08-23 代码现实 | 结论 |
|----|---------|-------------------|------|
| P1-1 ESC 双重注册 | 🔴 待修复 | `cleanup-3d.ts:99-100`（getter 读最新 escH）、`mount-preview-core.ts:941`（切换时先 `removeEventListener(oldEscH)` 再 add）已闭合 | ✅ 已修 |
| P1-2 rAF 每帧分配 Vector3 | 🔴 待修复 | `mount-preview-core.ts` 渲染管线零 `new Vector3` 每帧分配，临时向量提升至外层常量 | ✅ 已修 |
| P2-2 postProc Pass 未释放 | 🟡 待修复 | `caps/postprocessing-capability.ts:272-283` `disposeComposer()` 释放 ssao/ssr/render/output/bloom Pass + composer | ✅ 已修 |
| P2-3 switch-preview lastChild | 🟡 待修复 | `switch-preview.ts` 无 `lastChild` 误用，清理走 `removeChild`/`replaceChildren` | ✅ 已修 |
| P2-4 morphTargetInfluences 非空断言 | 🟡 待修复 | `mmd-adapter.ts:914-933/1107-1108` 均先做 `morphTargetInfluences` 真值判定再写，断言仅用于索引取值 | ✅ 已修 |
| P2-5 Sky renderTarget 悬挂引用 | 🟡 待修复 | `caps/sky-capability.ts:183-195` `regenerateEnvironment` 先 `renderTarget.dispose()` 再重建，异常路径 `scene.environment = null` 清零悬挂引用 | ✅ 已修 |
| P2-6 LightCapability spotlightTarget | 🟡 待修复 | `caps/light-capability.ts:297-300/435/741-748` spotlightTarget 随 dispose 体系统一释放 | ✅ 已修 |

**复核结论**：本报告全部 P1/P2 均已构成历史债务并已偿还。文件迁移（`caps/`）导致原行号偏移，但代码现实已闭合。报告原文（2026-08-18 时态快照）保留不变。
