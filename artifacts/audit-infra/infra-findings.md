# 巡检报告：`frontend/src/preview-3d/infra/`（第 5 轮 · 轮转模块巡检）

- **范围**：`frontend/src/preview-3d/infra/`，35 个源文件（~3.7k 行），32 个测试文件
- **方法**：逐文件读源码 + 对每个候选缺陷写一次性探针测试实证（临时 `__proof*.test.ts`，读毕即删；**未改动任何源文件**）
- **仓库规则遵守**：注释只作线索、结论一律以当前源码树 + 可执行实证为准；每条findings 均标注**可达性**（生产路径如何走到）

> ⚠️ 工作区状态说明：审计期间 `postproc-cost-probe.ts` 与 `postproc-cost-probe.gpu-timer.test.ts`、`internal/app/app_files_toggle_test.go` 处于**并行会话的在途修改**状态（`git status` 可见）。本报告对这些文件的结论以 **HEAD 已提交版本**为准，并在 §附录 A 单列「已被并行会话认领」的发现，避免重复劳动。

---

## 结论摘要

| 严重度 | 数量 | 主题 |
|---|---|---|
| 🔴 高 | 2 | `unloadModel` 不注销 frustum 根（跨会话泄漏 + 剔除误判）；`debug-render` 标签纹理缓存跨会话不清（复用已 dispose 纹理） |
| 🟡 中 | 3 | 5 个 adapter 的 `unregisterModelRoot` 隔离度不一致（MMD/YSM/Litematic 裸 try）；探针 MSAA 常量双源；`stopIfIdle` 判据面窄于不变量面 |
| 🟢 低 | 2 | `unloadModel` 无 `MAX_MODELS`/`modelRoots` 契约测试；`getMaxFps` 无上限校验 |
| ✅ 已查无恙 | 14 项 | 见 §已检查且正常 |

---

## 🔴 F1 — `unloadModel` 从不注销 frustum 模型根：跨会话泄漏 + 单模型豁免失效

**位置**
- `frontend/src/preview-3d/infra/unload-model.ts:31-66`（卸载主流程；**全函数无 `unregisterModelRoot` 调用**）
- `frontend/src/preview-3d/infra/frustum-cull.ts:15`（`modelRoots` 模块级数组）、`:41-46`（`registerModelRoot`）、`:49-54`（`unregisterModelRoot`）、`:68-70`（自愈仅存在于 `cullModelGroups` 内）

**问题**

`unloadModel` 做齐了「释放 GPU（`safeDispose(entry.content)` :40）→ 出场景（`scene.remove(r)` :43-45）→ 注销注册表（`sceneRegistry.unregister(id)` :50）」，**唯缺 `unregisterModelRoot`**。它把注销责任外包给适配器的 `content.dispose()`，形成一条隐式契约。

`modelRoots` 是**模块级数组**，其清理只有两条路径：

1. `frustum-cull.ts:69` 的 `if (!modelRoots[i].parent) splice` —— 只在 `cullModelGroups` **内部**；
2. `clearModelRoots()`（`frustum-cull.ts:155`）—— 只由 `teardown("full")` 且**本会话是最后一个存活会话**时调用（`mount-session.ts:285-293`）。

而 `cullModelGroups` 的调用点（`render-host.ts:303-315`）被 `isFrustumCullEnabled()` 门控，**该开关默认关闭**（`frustum-cull.ts:174-180`：`v === null ? false`）。默认关闭时每帧走 `restoreModelGroupsVisible()`（`render-host.ts:315`），**自愈代码根本不执行**。

**实证（探针，已跑通）**

```
F1 modelRootCount with 8 loaded: 8
F2 scene.children: 0   modelRootCount: 8   registry.count: 0
   ← 8 个模型全部卸载完毕：场景空、注册表空，但 modelRoots 仍持有 8 个已脱离文档的 Object3D 子树
D1 modelRootCount after unload (cull OFF): 1
D2 modelRootCount after 100 frames (cull OFF): 1     ← 100 帧后仍不自愈
E2 after unload: modelRootCount = 2  rootA.parent = null  rootA.visible = false
E3 after restore: rootA.visible = true               ← 对已卸载的死亡对象写入 visible
```

**用户可见后果（分两档）**

- **(a) 内存无限增长**：`modelRoots` 强引用每个卸载模型的整棵子树。模型 `content.dispose()` 只释放 GPU 侧资源，**JS 侧 `Object3D`/`geometry`/`material`/`texture` 包装对象仍被数组钉住**，GC 无法回收。长会话中「加载→卸载模型」循环 N 次即累积 N 棵子树。`MAX_MODELS = 8` 限的是 `sceneRegistry`（`scene-registry.ts:243`），**不限** `modelRoots`。
- **(b) 剔除判定被幽灵根污染**：残留根让 `modelRoots.length` 虚高，**绕过 `frustum-cull.ts:72` 的 `length === 1` 单根豁免分支**，使「用户眼中单模型」的场景误入多根剔除路径。实证 G：

```
G1 modelRootCount: 3  (1 live + 2 dead)
G2 after cull: modelRootCount: 1  live.visible: true
G3 dead roots' visible mutated: [ true, true ]      ← 每帧对死亡对象做视锥测试与 visible 写入
```
  存活单模型时 `modelRoots` 已含 2 个幽灵根 → 多根路径启动。命中 `_culled` 的死亡引用还会被 `restoreModelGroupsVisible`（`:202-208`）反向写入 `visible = true`（E3），`modelRoots.includes(root)` 守卫（`:206`）**恰恰因为脏条目未被清除而通过**。

**可达性：生产可达，无需异常。** 路径：多模型同框/资源包场景 → 角色面板 ⚙「卸载模型」→ `unloadSessionModel`（`mount-session.ts:405-420`）→ `unloadModel`。`frustum-cull-visibility-ownership.test.ts` 甚至在注释里确认了「`roots` 与 `modelRoots` 是同一批对象」这一前提——但该测试每例都手动 `unregisterModelRoot`，**从未走过 `unloadModel`**，故缺口未被覆盖。`unload-model.test.ts` 全 13 例亦无一涉及 frustum（其 mock 里根本没有 `unregisterModelRoot`）。

**建议**：`unloadModel` 内对 `entry.roots` 直接 `unregisterModelRoot(r)`（与 `scene.remove(r)` 同循环、同行位置），使注销不再依赖适配器 `dispose()` 的内部实现顺序；并把「注销责任」从隐式契约改为显式调用。同时给 `unload-model.test.ts` 补一条 `modelRoots` 计数归零断言。

---

## 🔴 F2 — `debug-render` 标签纹理缓存只在 `rebuildDebug` 内清空，会话终结路径绕开它

**位置**
- `frontend/src/preview-3d/infra/debug-render.ts:18`（`const _labelTexCache = new Map<string, THREE.CanvasTexture>()`，模块级）
- `frontend/src/preview-3d/infra/debug-render.ts:71-72`（`clearLabelTexCache()` **唯一调用点**，位于 `if (state.debugGroup)` 块内）
- `frontend/src/preview-3d/adapters/ysm-adapter.ts:590-593`（生产终结路径：直接 `disposeDebugGroup` + 置 null，**不经 `rebuildDebug`**）

**问题**

`_labelTexCache` 是模块级 `const` Map（正是 `render-host.session-restart.test.ts:6-7` 自陈「`check-singleton-hygiene` 只测顶层 `let`，不测 `const` 容器 Map/Set」的那一类）。它的清理（`debug-render.ts:71-72`）**只在 `rebuildDebug` 被再次调用时**发生。

而会话终结走的是另一条路：`ysm-adapter.ts:590-593` 直接 `disposeDebugGroup(debugState.debugGroup)` 然后置 `null`，**从不调用 `rebuildDebug`**。于是 F 键调试模式开着时关闭预览 → 缓存留存 → 下个会话继续命中。

**实证（探针，已跑通）**

```
P1 within-session F-cycle: same texture reused? false   ← 会话内 F 键循环：缓存被清、重建新纹理
P2 across-teardown: same texture reused (STALE, was disposed)? true
   ← 跨会话终结：命中旧缓存，复用「已被 dispose 的」纹理实例
M3 texture disposed by teardown? 1
M4 new session reuses SAME texture instance (cache hit)? true
M5 that reused texture was already disposed: true
```

**用户可见后果**

- **主症状（确定）**：缓存**跨会话无界累积**。每进入一个新模型（骨名不同，如 `頭`/`head_01`/各模型自有骨名）就多一批 `CanvasTexture`（256×64 RGBA ≈ 64KB canvas + GPU 副本）永久驻留。模型浏览型长会话中「进 3D → 开 F 调试 → 退出」循环即单调增长。这与该文件 `:71` 注释自称已修的「长时使用 OOM」是**同一条内存，只是修在了不生效的路径上**——注释解释了 WHY，但代码只覆盖了会话内重建，**未覆盖会话终结**。
- **次症状（已核实为非可视破损）**：复用「已 dispose」的纹理实例。实证 N 显示 three 的 `Texture.dispose()` 只派发事件、**不在对象上留标记**（`version`/`needsUpdate` 不变，`image` 引用仍在），`WebGLTextures` 会在下次使用时重新上传 → 表现为**多余的 GPU 重传**，而非黑块/花屏。故此项**不构成 🔴 的视觉理由**，仅加重 (1) 的资源浪费。

**可达性：生产可达。** 路径：YSM 模型预览 → 按 F 键进入 `pivot`/`bone` 调试模式（`ysm-adapter.ts:527` 调 `rebuildDebug`）→ 关闭预览。`teardown("full")` 走 `unloadSessionModel` 之外的适配器 `dispose`（`ysm-adapter.ts:576+`）→ `:590-593` 直接拆组。全程无异常需求。

**注意**：`debug-render.test.ts:186-188` 明确把「纹理 dispose 两次」钉为**有意且无害**（`Texture.dispose` 幂等）。该判断经实证成立，**不是缺陷**——本 finding 针对的是**清理函数从未被调用**，而非重复 dispose。

**建议**：在 `ysm-adapter.ts:590-593` 的调试组拆除处补 `clearLabelTexCache()`（需先导出），或让 `disposeDebugGroup` 承担缓存清理；更稳的做法是把该缓存挂到 `RendererHost`/会话宿主上，随会话一道消亡。

---

## 🟡 F3 — `unregisterModelRoot` 的异常隔离度在 5 个 adapter 间不一致，MMD/YSM/Litematic 会静默漏注销

**位置**（同一职责、三种写法）

| 格式 | 写法 | file:line |
|---|---|---|
| FBX | ✅ `safeCall(() => unregisterModelRoot(group), …)` 独立隔离 | `fbx-adapter.ts:335` |
| VRM | ✅ 面板清理被 try/catch 单独包住，`unregisterModelRoot` 无条件执行 | `vrm-adapter.ts:601-606` |
| **MMD** | ❌ 裸 `try`，面板清理（`:183`）在注销（`:186`）**之前**，catch（`:196`）只 `dbg` 不补注销 | `mmd-build-result.ts:182-196` |
| **YSM** | ❌ 完全无 try，`rayCleanup()`（`:577`）/`bonePanelRef`（`:578`）在注销（`:579`）**之前** | `ysm-adapter.ts:576-580` |
| **Litematic** | ❌ 无隔离，`unregisterSchema`（`:480`）/`scene.remove`（`:484-485`）在注销（`:486`）**之前** | `litematic-adapter.ts:479-495` |

**问题**：这 5 处承担的是**同一个不变量**——「根必须在 dispose 时注销」。其中 3 处把它放在可能抛错的语句**之后**且无隔离，一旦前置语句抛错，就退化为 F1 描述的状态（根永久残留）。VRM 用 try/catch、FBX 用 `safeCall` 各自独立修了这个坑，**说明该风险已被认识，但没有统一收口**。

**实证（A/B 对照，已跑通）**

```
L1 count (VRM-shape 有守卫):  0   ← 面板清理抛错，注销仍执行，无泄漏
K1 count (MMD-shape 裸 try):  1   mesh.parent: null   registry.count: 0
   ← 面板清理抛错 → 注销被跳过：模型已出场景、已出注册表，但整棵子树仍在 modelRoots
```

**可达性：条件可达（依赖前置语句抛错）。** `bonePanelRef.current?.()` / `rayCleanup()` 是面板与射线资源的清理回调，属外部注入、无异常保证；MMD 侧 `c.mixer.stopAllAction()` 等同样无保证。此路径**不像 F1 那样无条件触发**，故定级 🟡 而非 🔴；但一旦触发，后果与 F1 完全叠加且**对用户完全静默**。

**建议**：把 `unregisterModelRoot` 提到各自 `dispose()` 的**首行**（在任何可能抛错的动作之前），与 VRM/FBX 的写法对齐；或由 `safeDispose` 范式统一收口。

---

## 🟡 F4 — 探针 MSAA 采样数常量双源（单一事实源违规）

**位置**
- `frontend/src/preview-3d/infra/postproc-cost-probe.ts:36-37`：
  `/** 与 postprocessing-capability.ts 的 POSTPROC_MSAA_SAMPLES 对齐（不反向 import：cap 属上层） */`
  `const DEFAULT_MSAA_SAMPLES = 4;`
- `frontend/src/preview-3d/caps/postprocessing-capability.ts:100-101`：`const POSTPROC_MSAA_SAMPLES = 4;`

**问题**：同一物理量（composer 离屏缓冲 MSAA 采样数）存在**两份字面量 4**。探针用它经 `estimateComposerRtBytes`（`:353`）算出报告的核心数字 `rtBytesSingle` / `rtBytesBoth` / `msaaSamples`（`:366-367`），并在 `buildNote`（`:272`）里以「另常驻 X MB 读写缓冲」的口径输出给决策者。cap 侧那份改档（如 4→8，或未来按设备自适应）时，探针会**静默报告错误字节数**，而报告本身没有任何交叉校验。

注释解释了「为什么不反向 import」（分层方向），这是**成立的理由**；但理由成立 ≠ 双源可接受——正确做法是把常量下沉到两者都能引用的叶层（`infra/` 本就是 cap 的下层）。这是典型的「一个数、两处写、改一漏一」形状，与上一轮 sky 轮「硬编码渐变无视单一事实源」同型。

**可达性：静默错误，非崩溃。** 任何一次改 `POSTPROC_MSAA_SAMPLES` 即触发。

**建议**：把采样数常量下沉 `infra/`（如 `postproc-cost-probe.ts` 或新的叶常量），cap 侧改为 import 该叶；探针注释同时改为陈述依赖方向。

---

## 🟡 F5 — `stopIfIdle` 判据面窄于不变量面（早退路径不停环，`start()` 幂等守卫会误拦）

**位置**
- `frontend/src/preview-3d/infra/render-host.ts:204-209`（`stopIfIdle` 只查 `this._perFrames.length === 0`）
- `frontend/src/preview-3d/infra/render-host.ts:248-249`（`animate` 首行无条件 `requestAnimationFrame` 续期，**在**局部态早退守卫 `:255` **之前**）
- `frontend/src/preview-3d/infra/render-host.ts:238`（`start` 的 `if (this._animId !== 0) return` 幂等守卫）

**问题**：`animate` 是「先续期、后判断」。当 `_infra`/`_viewContainer` 等局部态缺失时，`:255` 早退**但仍会续期下一帧**，故早退不停环；停环唯一手段是 `stopIfIdle`。而 `stopIfIdle` 的判据只看 `_perFrames`，**不看 `_animId` 是否指向在飞帧**。

`render-host.raf-contract.test.ts:202-223` 与 `render-host.session-restart.test.ts:185-190` 都**已把这条语义钉死并留了注释**——即团队已知悉。故此项**不是新发现**，我把它列入清单是因为它解释了 F1 的一个放大因素：rAF 在无 `perFrame` 时仍可能多跑若干帧，期间 `cullModelGroups`/`restoreModelGroupsVisible` 照常执行，与 F1 的幽灵根交互（E3 的写入即发生在这类窗口帧）。

**可达性：已知且已被测试固化。** 不计为新缺陷，建议维持现状或按既有测试注释的指引评估。

---

## 🟢 F6 — `unloadModel` 缺少 `modelRoots` / `MAX_MODELS` 契约测试

`unload-model.test.ts`（13 例）覆盖了 `allContent` 精确移除、perFrame 按引用注销、菜单归属转移、早退契约、取景重算——**覆盖面在 `sceneRegistry` 与 `allContent` 两个集合上是完整的**，但对 `modelRoots`（第三个平行集合）**零断言**。这正是 F1 能长期存在的原因：三集合中有一个没人看。属「未钉契约」，与 F1 同源，单列以便排期。

---

## 🟢 F7 — `getMaxFps` 无上限校验（`Infinity`/超大值可入缓存）

**位置**：`frontend/src/preview-3d/infra/render-budget.ts:39-47`

```ts
const n = Number(v);
if (!Number.isFinite(n) || n < 0) return MAX_FPS_DEFAULT;   // :44 只挡 NaN/负
_maxFpsCache = n;
```

`Number.isFinite` 已挡住 `Infinity`/`NaN`，故 `Infinity` 不会入缓存——**初判的 `Infinity` 风险不成立**。剩余的是 `"1e9"` 这类有限超大值：`getFrameIntervalMs()`（`:50-53`）得 `1000/1e9 = 1e-6` ms，`shouldRenderAtFps`（`:132-141`）恒真 → 等效「不限制」。后果与 `fps=0`（已有语义）相同，**无实质危害**，故定 🟢。仅当「用户设 30fps 省电」却被手改 localStorage 成大值时才有一致性偏差。**不建议修**（仓库明令不为不可能场景加防御）。

---

## 已检查且正常（审计范围可见性）

以下各项均**读了源码并核对调用点**，未发现缺陷；列出以免范围含糊：

1. **`render-budget` 自适应地板 vs 用户上限**——`MIN_PIXEL_RATIO = 0.75`（`:56`）与 `TD_PIXEL_RATIO.min = 0.5`（`settings-schema.ts:61`）看似冲突。实证 H/I：用户设 0.5 时 `sampleAdaptivePixelRatio` 因守卫 `budget.pixelRatio <= MIN_PIXEL_RATIO`（`:120`）**返回 null 且从不回抬**，返回序列为空 → **地板不会把像素比抬过用户上限**。自洽，非缺陷。
2. **`sampleAdaptivePixelRatio` 的 FPS cap 豁免**——`threshold = max(SLOW_FRAME_MS, capIntervalMs || 0)`（`:117`）与测试 `render-budget.test.ts:45-61` 一致；30fps 下不误降级。
3. **GPU 软线单源**——`GPU_SATURATION_RATIO`（`render-budget.ts:77`）= 硬顶 50%，经 `resolveGpuLoadLimits()`（`gpu-load-calibrate.ts:112`）跟随真机标定，**非第二份字面量**；测试 `render-budget.test.ts:161-170` 已锁「标定放宽后不再误降」。
4. **`gpu-load-calibrate` clamp 自锁防线**——`clampLimit`（`:103-106`）对脏存储值 clamp 到 `[0.1×, 10×]` 默认，`LIMIT_MIN_RATIO`/`LIMIT_MAX_RATIO` 单处定义；`resolveGpuLoadLimits`（`:112-121`）对非对象/损坏 JSON fail-open 回落默认。测试 `:114-150` 全覆盖。
5. **`suggestGpuLimits` 零峰值回落默认**（`:82`）——不把预算压成 0 误拦一切，与注释一致。
6. **`evaluateGpuLoad` 的 `textureBytes` 可选性**（`gpu-load.ts:83`）——`!== undefined` 判据正确区分「未提供」与「0」，与 `render-host` 饱和采样「故意不传」的口径一致（`:67-70` 注释所述与 `render-host.ts:328` 实参 `sampleGpuLoad(infra.renderer)` 单参调用吻合）。
7. **`texture-bytes` 快照生命周期**——`resetSceneTextureBytes()`（`:100`）由 `mount-session.ts:292` 在**最后会话**拆除时调用，与 `clearModelRoots()`（`:293`）配对；`gpu-budget.ts:27-29` 取「场景快照 vs 池累计」较大者，保守优于漏拦，逻辑自洽。
8. **`scene-registry` 去重与索引一致性**——`register` 命中 dedup 时先 `objToEntry.delete` 旧根再填新根（`:135`、`:145-148`），`unregister` 同时清 `byPath`、`objToEntry`、`entries`（`:164-175`）；测试 `scene-registry.test.ts:162-195` 已锁 WeakMap 一致性。
9. **`scene-registry` 模块级单例复位**——`reset()`（`:114-121`）清 5 个字段含 `objToEntry` 重建；调用点 `mount-preview-core.ts:270`（`cleanupPreview`，全部关闭语义）+ `mount-session.ts:277`（最后会话）。复位口径完整。
10. **`overlay-style-bridge._resets` 无界增长风险**——`onOverlayStyleTargetReset` 仅在**模块装载期**被调用 3 次（`overlay-style-bridge.ts:38`、`menu/shell/fab.ts:49`、`menu/render/render.ts:54`），运行期无增量。非泄漏。
11. **`input-and-animation` 监听配对**——`bindInputHandlers` 注册 7 个监听（`document` keydown/keyup、`canvas` pointerdown、`window` pointerup/pointercancel/pointermove/resize），逐一对应 `mount-session.ts:324-333` 的 `unbindInputsAndStopLoop`；`cancelPendingResize`（`:216-221`）配对处理在飞 rAF，`resizeRaf` 归零。**逐条配对完整**。
12. **`input-and-animation` 双轨键与输入框守卫**——`heldCodes` Set（`:127`）正确实现「一动作多键、松其一不误清」（`:152`）；`isEditableTarget`/`isInputBlocked` 守卫在 `:130-131`。逻辑与注释一致。
13. **`frustum-cull` 抑制态归属**——`_culled` 只登记「本模块写下的隐藏」（`:76`、`:100`、`:112`、`:119-120`），`restoreModelGroupsVisible`（`:202-208`）据此精确还原，不覆盖 `sceneRegistry.setVisible` 的用户意图。`frustum-cull-visibility-ownership.test.ts` 6 例全绿。**这是上一轮同类问题的正确修复样板**。
14. **`keymap` / `settings-schema` 单一事实源**——`loadTdKeymap`（`keymap.ts:65-81`）对非法值回落默认、未知字段忽略；`settings-schema.ts` 的值域/步进/默认三处声明与 `loadTdCamSpeed`（`keymap.ts:84-90`）、`getMaxPixelRatio`（`render-budget.ts:14-21`）的 clamp 同源；`settings-schema.test.ts:68-77` 断言 key 与默认值一致性。
15. **`semantic-morphs` / `scene-stats` / `texture-bytes` 去重口径**——`estimateTextureSetBytes` 按实例 `Set` 去重（`texture-bytes.ts:33-39`）；`collectSceneStats` 骨骼取 `skeleton.bones ∪ 裸 Bone` 去重、材质/纹理按实例去重（`scene-stats.ts:71-92`）；三处共用 `collectMaterialTextures` / `ALL_TEXTURE_KEYS`（`mesh.ts:24`）。口径统一。
16. **`load-trace` 环形上限**——`recordLoadTrace` 超 `MAX_RECORDS` 用 `slice(-50)` 截断（`:99-102`），`getLoadTraces` 返回浅拷贝防调用方绕过上限（`:104-108`）。有界。
17. **`large-model` 有界去重**——`warnedPaths` 超 200 淘汰插入序最旧（`large-model.ts:58-61`），与 `t.ts|warnedResiduals` 既有范式一致。有界。
18. **`safe-dispose` 去重释放**——`disposeObject3D` 用 `seenGeo`/`seenMat` uuid Set 防共享 geometry/material 重复 dispose（`:40-41`）；贴图槽清扫刻意 opt-in（`:28-29` 注释说明误伤 `scene.environment` 的理由），代码与注释一致。
19. **`unified-pick` 监听配对**——`makeUnifiedPickHandler` 在 `:28` 注册 `pointerdown`，`dispose`（`:73-75`）移除同引用；调用点 `mount-preview-core.ts:559-560` 与拆除点 `mount-session.ts:336-337` 配对。**配对完整**。
20. **`postproc-cost-probe` 纯函数段**——`median`/`percentile` 空数组回落 0 防 NaN（`:115-130`）；`estimateComposerRtBytes` 对 `samples=0` 取 `max(1, …)` 防「常驻显存显示 0MB」（`:145`）；`summarizeArm` GPU 样本缺失记 `null` **绝不用 CPU 值顶替**（`:162-163`）；`buildNote` 的 `taxMeaningful` / `composerArmFrames === 0` / `gpuTimingAvailable` 三分支判读口径互斥且都有测试（`postproc-cost-probe.test.ts:105-131`）。
21. **`preview-shell` 单例复位**——`resetRefs()`（`:38-42`）由 `cleanupPreview`（`mount-preview-core.ts:274`）、`_resetSingletons`（`:283`）、`teardown("full")` 经 `clearSingletons`（`mount-session.ts:254`）三处调用；`ensureViewContainer`（`:132-151`）对 `body` 为 null 的复用路径有兜底补建并回写 host（`:141`）。与注释所述不变量一致。

---

## 附录 A — 已被并行会话认领的发现（本报告不重复计分）

`postproc-cost-probe.ts` 的 **GPU query 孤儿泄漏**（`poll()` 仅在 `QUERY_RESULT_AVAILABLE === true` 时 `deleteQuery`，而收尾轮询有 `DRAIN_MAX_FRAMES = 30` 上限；窗口内未就绪的 query 既不产数字也不被删除，探针反复跑则逐次累积）是一处**真实缺陷**。

审计期间发现该文件已处于**在途修改**状态，修复方案（新增 `GpuTimer.dispose()` + `finally` 出口无条件删除、并导出 `createGpuTimer` 供单测）与新建的 `postproc-cost-probe.gpu-timer.test.ts` 均已在工作区。**故本报告不将其列为新发现**，结论与其修复一致。

---

## 附录 B — 无同名测试的源文件（未钉契约）

`infra/` 下 35 个源文件中，6 个无同名测试。按「是否含真实契约」分类：

| 文件 | 性质 | 是否承载契约 |
|---|---|---|
| `camera-controls.ts`（19 行） | **纯类型**（仅 `CameraControlBridge` interface） | 否 —— 纯类型声明，无运行期行为，不需要测试 |
| `postprocessing.ts`（14 行） | **纯类型**（`PostprocessingLike` interface） | 否 —— 同上 |
| `ui-constants.ts`（5 行） | 单常量 `PREVIEW_OVERLAY_ID` | 否 —— 常量字面量，消费点 `overlay-active.ts:16` 与 `preview-shell.ts:73` 已间接覆盖 |
| **`content-bridges.ts`（113 行）** | **纯类型桥契约**（6 个 interface/type） | **边缘** —— 无运行期行为，但其「类型归位」决策靠 `views` 侧 re-export 保面；无测试即无编译期守卫，重命名字段不会被测试发现（会被 `tsc` 发现，风险低） |
| **`load-trace.ts`（112 行）** | **含运行期契约**：`_store` 环形上限 50、`getLoadTraces` 浅拷贝防绕过、`MAX_RECORDS` 截断语义、`TRACE_FORMAT_OTHER` 哨兵、`DECODE_SOURCE` 值域 | **是** —— 有界性与只读快照是实打实的契约，**无测试钉住** |
| **`preview-shell.ts`（151 行）** | **含运行期契约**：`PreviewShellHost` 单例、`resetRefs` 三字段归零、`ensureOverlayShell` 首建/复用分支、`ensureViewContainer` 的 body 兜底补建与**权威引用回传** | **是** —— 单例复位与 shadow/降级双路径是高风险区（其自身注释 `:127-128` 即自陈兜底必要性），**无同名测试**（经 `mount-preview-core` 集成测试间接覆盖，但无独立契约锁） |

**结论**：题述「3 个无同名测试的源文件」经核查为 **6 个**；扣除 3 个纯类型/常量文件（`camera-controls`、`postprocessing`、`ui-constants`）后，**恰为 3 个含真实契约者**：

1. **`load-trace.ts`** —— 缺「`recordLoadTrace` 超 50 条后只留最新 50、`getLoadTraces` 返回快照（外部 push 不影响内部）」的断言。
2. **`preview-shell.ts`** —— 缺「`resetRefs` 后 `ensureOverlayShell` 重建而非复用 detached 元素」「`ensureViewContainer` 在 `body === null` 时补建并回传权威引用」的断言（`preview-shell.ts:127-130` 注释明确这条不变量易被误用）。
3. **`content-bridges.ts`** —— 纯类型，契约由 `tsc` 承担；无运行期契约可钉，建议**不补测试**，但注意其 `YsmContentHandle.onBoneSelect`（`:92`）等字段在 `views` 侧 re-export 面的一致性无独立守卫。

---

## 修复优先级建议

1. **F1（🔴）先修** —— 无条件触发、后果随会话长度单调恶化（内存 + 剔除误判），且修复面极小（`unload-model.ts` 一行循环内加一次 `unregisterModelRoot`）。是本次巡检中「投入产出比最高」的一条。
2. **F3（🟡）紧随 F1** —— 与 F1 同源、同一不变量；既然要动 `unload-model.ts`，顺手把 3 个 adapter 的注销提到首行，可一次消灭整类「根残留」。
3. **F2（🔴）次之** —— 独立成因、独立修复点（`ysm-adapter.ts:590-593` 或 `disposeDebugGroup`），不阻塞 F1/F3。定 🔴 是因「缓存无界累积 + 复用已 dispose 纹理」两重后果，但实际触发需用户开 F 调试，实测频率低于 F1。
4. **F4（🟡）** —— 常量下沉，纯机械改动，可在任意空档做。
5. **F5/F6/F7** —— 已知/低危/建议不修，仅登记。
