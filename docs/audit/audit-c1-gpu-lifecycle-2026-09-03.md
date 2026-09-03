# C1 GPU 资源生命周期专项审核报告

> 审核日期：2026-09-03 ｜ 范围：`preview-3d` 纹理缓存 acquire/release 配对
> 方法：调用链穷举 + 缓存语义源码核实 + 单测实证（texture-cache.test.ts 13/13 通过）

---

## 零、修复状态（2026-09-03 闭环）

🔴→✅ **P0 已按 Option A 修复并验证通过**——纹理所有权归缓存池，消费方只归还引用。

| 验证项 | 结果 |
|--------|------|
| `npx vitest run`（全量） | ✅ **5199 / 5199** 通过（本次新增回归 7 例） |
| `npx tsc --noEmit` | ✅ 0 error |
| `npx vite build` | ✅ 构建成功 |

| 改动 | 文件 |
|------|------|
| 新增共用释放器 `releaseTextureUrls()`（loadTextures 的配对归还器） | `preview-3d/texture-loader.ts` |
| `preloadModel` 返回**幂等**释放闭包；纹理加载两段失败路径均兜底归还 | `views/app-preview/model3d-loader.ts` |
| 契约扩为 `YsmPreloadedModel`；dispose 改归还；build 失败路径归还 | `preview-3d/adapters/ysm-adapter.ts` |
| finally 段循环收编为共用释放器（去重复模式） | `preview-3d/screenshot-render.ts` |
| 回归测试 +3 / +4 | `adapters/ysm-3d.test.ts`、`texture-loader.test.ts` |

**实施与方案的偏差（备查）**：方案原定「preloadModel 返回 URL 清单、适配器自行 release」；
实施改为「preload 一并返回 `releaseTextures()` 闭包」——谁 acquire 谁提供释放器，适配器
不感知 URL 结构，且闭包内置幂等标志：防 dispose 重入把 refs 多减，导致仍在使用中的
共享纹理提前归零被 LRU 淘汰（悬垂已释放纹理）。

---

## 一、总体结论

🔴 **发现 P0 级缺陷 1 项**：`ysm-adapter.ts` 对纹理缓存的释放方式违反所有权契约，
同时**使 ADR-136 的 P0 纹理缓存优化在 YSM/女仆主路径上完全失效**。

| 项 | 结果 |
|----|------|
| 复核 `e1741907`（registry 迁 services） | ✅ 干净，纯搬迁 + 导入路径更新，无行为变更 |
| `pack-model-adapter` acquire/release | ✅ 配对正确（`:211` 正常路径 + `:265-267` 失败路径） |
| `screenshot-render` acquire/release | ✅ 配对正确（`:180-185` finally 兜底） |
| **`ysm-adapter` acquire/release** | 🔴→✅ **已修**（原未配对 + 错误直接 dispose，现按 Option A 归还引用） |

---

## 二、P0 缺陷：YSM/女仆路径纹理缓存所有权违规

### 根因

`ysm-adapter.ts:454-462` 的 `dispose()` 直接销毁纹理对象：

```typescript
// frontend/src/preview-3d/adapters/ysm-adapter.ts:459-462
// 释放预加载纹理 GPU 资源（removeFromScene 的 disposeSceneMeshes 显式跳过纹理）
for (const t of core.texArr) t?.dispose();
if (core.componentTexMap) for (const arr of core.componentTexMap.values()) for (const t of arr) t?.dispose();
```

**但从未调用 `textureCache.release(url)`**，而纹理是经 `texture-loader.ts:13`
`textureCache.acquire(url, ...)` 取出的。

### 三重后果

1. **引用计数永久泄漏**：refs 恒 ≥1。`texture-cache.ts:49-58` 的
   `evictZeroRefIfNeeded()` **只淘汰 `refs === 0` 的条目** ⇒ LRU 淘汰永久失效，
   缓存越过 `maxEntries = 200` 单调增长，仅 `disposeAll()`（fullCleanup）能回收。
   - 单测 `texture-cache.test.ts:126`「全部 refs>0 时超限不淘汰」**恰好锁定了这一失效模式**。
2. **P0 缓存优化被彻底抵消**：`mount-preview-core.ts:838` 明确
   "switchTo 的复用外壳走 switch-preview.ts（不经过此处）" ⇒ `disposeAll()` **只在预览关闭时触发**，
   模型内切换（switchTo）会调用适配器 `dispose()`。于是每次切换都销毁缓存池
   正要复用的共享纹理 —— 「同目录纹理切换 10 次 = 10 份 GPU 副本」的原始问题原样回归。
3. **缓存分发已释放纹理**：条目仍以 refs≥1 驻留，下次 `acquire` 返回**已被 dispose 的 Texture**，
   依赖 Three.js 重传兜底；若 `texture.image`（Image）已被 GC 或 blob URL 已撤销，则渲染为空白/黑块。

### 次生缺陷：失败路径漏网

`mdYsLoadAndBuild`（`:171-188`）在 `:178` acquire 纹理，`:182` `buildYsmObject`
若抛错则纹理既不 release 也不 dispose；调用点 `:533` 无 try/catch/finally 兜底。
`pack-model-adapter:265-267` 已有失败路径 release，此处缺失 —— 属同类疏忽而非设计决策。

### 影响面

`ysm-3d.ts:64` 与 `maid-3d.ts:64` **共用 `makeYsmAdapter` + `preloadModel`**
⇒ YSM 与女仆两条预览主路径**全部命中**。全仓对缓存纹理的直接 dispose 仅 `:460/:462` 一处（单点缺陷）。

### 测试缺口

`grep -rln textureCache --include=*.test.ts` 仅命中 pack-model-adapter / texture-loader /
model3d-loader。**ysm-adapter 无任何 release 断言**（pack-model 有
`it("textureCache.release 在 dispose 时调用")`），故该缺陷无法被 CI 拦截。

---

## 三、修复方案（推荐 Option A）

> 原则：纹理所有权归缓存池。消费者只 `release`（refs-1），由 `disposeAll`/LRU 统一回收 ——
> 与 `pack-model-adapter:211`、`screenshot-render:180` 既有范式一致。

### A1. `model3d-loader.ts` — 返回 URL 清单（释放需要 URL 而非 Texture）

```diff
--- a/frontend/src/views/app-preview/model3d-loader.ts
+++ b/frontend/src/views/app-preview/model3d-loader.ts
@@ -146,6 +146,7 @@
   const componentTexMap = new Map<string, (THREE.Texture | null)[]>();
+  const componentTexUrls = new Map<string, string[]>();
@@ -157,8 +158,9 @@
   if (compTex) {
     for (const [compName, texBase64Arr] of Object.entries(compTex)) {
+      componentTexUrls.set(compName, texBase64Arr ?? []);
       const compTexArr = await loadTextures(texBase64Arr ?? []);
       componentTexMap.set(compName, compTexArr);
     }
   }
@@ -201,3 +203,3 @@
-  return { texArr, spec, componentTexMap };
+  return { texArr, spec, componentTexMap, texUrls: urls, componentTexUrls };
```

### A2. `ysm-adapter.ts:49` — 扩展 preload 返回类型

```diff
-  preload: (model: unknown) => Promise<{ texArr: (THREE.Texture | null)[]; spec: unknown; componentTexMap: Map<string, (THREE.Texture | null)[]> }>;
+  preload: (model: unknown) => Promise<{
+    texArr: (THREE.Texture | null)[];
+    spec: unknown;
+    componentTexMap: Map<string, (THREE.Texture | null)[]>;
+    texUrls?: string[];
+    componentTexUrls?: Map<string, string[]>;
+  }>;
```

`MdYsBuildCore`（`:130/:132` 附近）增列 `texUrls` / `componentTexUrls`，并在 `:187` 一并返回。

### A3. `ysm-adapter.ts` — 抽出共享释放函数，替换直接 dispose

```diff
+/** 释放 preload 阶段 acquire 的纹理引用（所有权归缓存池，禁止直接 dispose）。
+ *  同 URL 在 texArr 与 componentTextures 重复出现时 acquire 两次 → release 两次，refs 精确归零。 */
+function releasePreloadedTextures(
+  texUrls: string[] | undefined,
+  componentTexUrls: Map<string, string[]> | undefined,
+): void {
+  for (const u of texUrls ?? []) textureCache.release(u);
+  for (const arr of componentTexUrls?.values() ?? []) for (const u of arr) textureCache.release(u);
+}
@@ dispose() 内 ~:459
-      // 释放预加载纹理 GPU 资源（removeFromScene 的 disposeSceneMeshes 显式跳过纹理）
-      for (const t of core.texArr) t?.dispose();
-      // componentTexMap 可能缺失（无组件纹理路径，buildYsmObject 同款 instanceof Map fallback）——dispose 不抛
-      if (core.componentTexMap) for (const arr of core.componentTexMap.values()) for (const t of arr) t?.dispose();
+      // 纹理所有权归缓存池：只 release（refs-1），不直接 dispose ——
+      // dispose 会让缓存持有已释放纹理且 refs 永不归零 → LRU 淘汰失效 + 跨模型复用被破坏。
+      // 实际 GPU 释放由 LRU（>200 归零条目）或 fullCleanup 的 disposeAll 统一执行。
+      releasePreloadedTextures(core.texUrls, core.componentTexUrls);
```

### A4. `ysm-adapter.ts:171-188` — 失败路径补 release

```diff
 async function mdYsLoadAndBuild(sc: MdYsSceneCtx): Promise<MdYsBuildCore> {
@@
-  const { texArr, spec, componentTexMap } = await sc.opts.preload(model);
+  const { texArr, spec, componentTexMap, texUrls, componentTexUrls } = await sc.opts.preload(model);
   sc.tPreloadEnd = performance.now();
 
   sc.tBuildStart = performance.now();
-  const obj: YsmObjectHandle = buildYsmObject(spec as Spec3D, texArr, componentTexMap, texIdx);
+  let obj: YsmObjectHandle;
+  try {
+    obj = buildYsmObject(spec as Spec3D, texArr, componentTexMap, texIdx);
+  } catch (e) {
+    // 失败路径：preload 已 acquire（refs+1），必须 release 防引用计数泄漏（对齐 pack-model-adapter:265）
+    releasePreloadedTextures(texUrls, componentTexUrls);
+    throw e;
+  }
   sc.tBuildEnd = performance.now();
   sc.ctx.scene!.add(obj.rootGroup);
   registerModelRoot(obj.rootGroup);
 
-  return { model, texIdx, texArr, spec: spec as Spec3D, componentTexMap, obj };
+  return { model, texIdx, texArr, spec: spec as Spec3D, componentTexMap, texUrls, componentTexUrls, obj };
 }
```

### A5. 回归测试（补缺口，防再犯）

新增 `ysm-adapter` dispose 用例（对齐 `pack-model-adapter.test.ts:254`）：
- `it("dispose 对每个 preload URL 调 textureCache.release")`
- `it("dispose 不直接 dispose 缓存纹理（所有权归缓存池）")`
- `it("buildYsmObject 抛错时仍 release 已 acquire 的 URL")`

---

## 四、权衡与备选

| 方案 | 优点 | 缺点 | 结论 |
|------|------|------|------|
| **A：release，不 dispose**（推荐） | 恢复跨模型复用（缓存池设计初衷）；refs 归零 → LRU 生效；与既有范式一致 | GPU 释放延迟至 LRU(>200)/disposeAll | ✅ 推荐 |
| B：保留 dispose + 追加 `invalidate(url)` | GPU 立即释放，缓存不残留死条目 | 摧毁跨模型复用（同纹理下次重新上传），违背 P0 优化初衷 | ❌ 不推荐 |

**备注**：Option A 下 GPU 释放在模型切换时不再即时，但由 `maxEntries=200` 的 LRU
与 `fullCleanup` 的 `disposeAll()` 兜底，属设计内行为（`texture-cache.ts:4-5` 明载
"归零不立即释放（跨模型复用）"）。

---

## 五、后续审核队列

| # | 项 | 状态 |
|---|----|------|
| C1-1 | YSM/女仆纹理缓存所有权违规 + 失败路径（本报告） | 🔴 待拍板修复 |
| C1-2 | caps（sky/fog/light/reflector/water）dispose 完整性复查 | ⬜ 待审 |
| C1-3 | 各适配器 `addEventListener`/`removeEventListener` 配对（ADR-109 §3） | ⬜ 待审 |
| C1-4 | MMD/VRM blob URL 与 `URL.revokeObjectURL` 时机 | ⬜ 待审 |
