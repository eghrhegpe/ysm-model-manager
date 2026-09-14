---
kind: 3d-patterns
name: 3D 区审核与修复模式提炼
tier: architecture
category: ui
source_files:
  - frontend/src/preview-3d/infra/debug-render.ts
  - frontend/src/preview-3d/model/model-group-builder.ts
  - frontend/src/preview-3d/adapters/mount-preview-core.ts
  - frontend/src/preview-3d/infra/cleanup-helper.ts
  - frontend/src/preview-3d/infra/safe-dispose.ts
  - frontend/src/preview-3d/infra/render-loop.ts
  - frontend/src/views/app-preview/preview-library.ts
  - frontend/src/views/app-preview/skeleton.ts
auto_fields:
  symbols_with_lines:
    - _resetSingletons
    - AssembledShell
    - BaseScene
    - buildModelGroup
    - CameraControlScene
    - cleanupPreview
    - closeActive3DOverlay
    - disposeDebugGroup
    - disposeObject3D
    - disposeSceneMeshes
    - getActiveInputSession
    - getRegisteredRoutes
    - GroupedScene
    - hasActivePreview
    - InstalledPreviewInfra
    - invalidatePreview
    - loadModel2D
    - mount3D
    - Mount3DOptions
    - openModel3DFullscreen
    - OpenModel3DOptions
    - PoseScene
    - PreviewAdapter
    - PreviewBuildCtx
    - PreviewHandle
    - PreviewScene
    - rebuildDebug
    - registerPerFrame
    - registerReRoute
    - removePerFrame
    - resetLoopState
    - SafeDisposable
    - safeDispose
    - scanModelsByType
    - ScreenshotScene
    - SemanticScene
    - setActive3DClose
    - setActiveInputSession
    - startGlobalRenderLoop
    - stopIfIdle
    - switchPreview
    - unregisterActiveInputSession
    - UpdateableScene
    - withPreviewExtras
  tests:
    - frontend/src/preview-3d/adapters/mount-preview-core.test.ts
    - frontend/src/preview-3d/infra/cleanup-helper.test.ts
    - frontend/src/preview-3d/infra/debug-render.test.ts
    - frontend/src/views/app-preview/preview-library-cooperate.test.ts
    - frontend/src/views/app-preview/preview-library-replace.test.ts
    - frontend/src/views/app-preview/preview-library.test.ts
    - frontend/src/views/app-preview/skeleton-fill-panel.test.ts
    - frontend/src/views/app-preview/skeleton-render.test.ts
    - frontend/src/views/app-preview/skeleton.test.ts
use_when:
  - 3D 渲染循环优化
  - Vector3 复用
  - 纹理缓存
  - AbortController 事件管理
  - 资源生命周期 dispose
  - 循环依赖破壁
  - 审核驱动开发
  - 并发防护 gen 守卫
quick_groups:
  - 3D 预览与模型追加
quick_intents:
  - 3D 渲染循环优化、Vector3 复用
  - 纹理缓存、AbortController 事件管理
  - 资源生命周期 dispose、循环依赖破壁
quick_risk_lines:
  - 3D 资源释放必须走 dispose 链路，禁止依赖 GC
pitfalls:
  - Vector3 频繁 new 造成 GC 抖动；必须复用或池化
  - AbortController 未清理导致事件泄漏；必须在 dispose 时 abort + removeEventListener
invariant_anchors:
  - frontend/src/preview-3d/infra/debug-render.ts|rebuildDebug
  - frontend/src/preview-3d/model/model-group-builder.ts|buildModelGroup
  - frontend/src/preview-3d/adapters/mount-preview-core.ts|mount3D
  - frontend/src/preview-3d/infra/cleanup-helper.ts|disposeSceneMeshes
  - frontend/src/views/app-preview/preview-library.ts|registerReRoute
  - frontend/src/views/app-preview/skeleton.ts|loadModel2D

status: active
---

# 3D 区审核与修复模式提炼

> **目的**：记录从 2026-08-17 3D 区审核子代理（d30590f0）及后续修复提交（cf781437、0b416054、e0065671）中提炼出的可复用编程模式，供未来 3D 开发及类似审核驱动迭代参考。

---

## 1. 审核驱动开发模式（Audit-Driven Development）

### 问题
大规模重构或功能演进后，代码中可能积累类型松弛、性能隐患、生命周期泄漏等问题，人工审查容易遗漏。

### 解决方案
引入子代理专项审核 + 主模型批量修复的协作模式：
1. **划定范围**：给审核子代理明确的扫描目录（如 `frontend/src/preview-3d/` 和 `frontend/src/views/app-preview/`）和问题分级标准（P1/P2/P3/P4）。
2. **结构化输出**：子代理按优先级分层报告，每项附带文件路径、行号参考和改动建议。
3. **批量消化**：主模型按 P2 → P3 → P4 顺序依次修复，每轮修复后验证（vite build + typecheck + 测试）。
4. **原子提交**：每轮修复独立 commit，便于回滚和追溯。

### 示例
- 审核子代理输出：`P2: mount-preview-core.ts 类型化 + model-group-builder.ts 函数抽取`，`P3: render-loop.ts Vector3 复用 + debug-render.ts 纹理缓存`。
- 主模型分两批提交：`cf781437`（P2 修复）、`e0065671`（P3 修复）。
- 验证门禁：每次提交前跑 `vite build` + `npm run typecheck` + 测试全绿。

### 适用场景
- 大型模块重构后的健康度复查
- 性能敏感模块（渲染循环、高频调用路径）
- 多子代理并行开发后的代码一致性审核

### 不适用场景
- 小而明确的单点 bug 修复
- 紧急 hotfix（时间压力大时）

---

## 2. 类型安全收敛模式

### 问题
Three.js 等第三方库的 TypeScript 类型有时不够精确，或历史遗留代码使用 `any` 绕过类型检查，导致运行时错误难以定位。

### 解决方案
从 `any` 到具体类型的渐变收敛：
1. **局部变量类型声明**：在渲染循环函数中显式声明 `const _camDir = new THREE.Vector3()` 等，避免隐式 `any`。
2. **变量类型收窄**：将 `let composer: any = null` 改为 `let composer: EffectComposer | null = null`，编译器自动捕获 misuse。
3. **预定义常量提取**：将魔法值或重复对象提为模块级常量（如 `UpVec`、`DEBUG_THEME`）。

### 示例
- `mount-preview-core.ts`：`let composer: EffectComposer | null = null`（原为 `any`）
- 模块级缓存：`const UpVec = new THREE.Vector3(0, 1, 0)`
- `debug-render.ts`：`const DEBUG_THEME = { ... } as const`（主题常量收敛）

### 适用场景
- Three.js/WebGL 相关代码（类型边界模糊）
- 涉及 GPU 资源管理的代码（需精确生命周期追踪）
- 多模块共享的接口定义

---

## 3. 渲染循环优化模式

### 问题
per-frame 代码中频繁 `new` 对象（如 `Vector3`）会产生 GC 压力，影响 60fps 稳定性。

### 解决方案
**局部变量复用 + 参数对象传递**：
1. **局部 Vector3 复用**：渲染循环函数内声明 `const _camDir/_forward/_right/_move = new THREE.Vector3()`，每帧通过 `set()` 更新，避免 `new` 产生 GC 压力。
2. **参数对象传递**：`applyWasdCameraMotion(keys, cam, ctr, ..., { camDir, forward, right, move })` 接收复用向量对象。
3. **模块级常量**：不随帧变化的向量（如 `UpVec`）提为模块级常量，避免重复创建。
4. **perFrame 快照迭代**（`RendererHost` 实例私有字段 `_perFrames`）：遍历渲染回调注册表时用快照副本，回调内 `registerPerFrame` / `removePerFrame` 增删注册表不影响本次帧迭代（增删下一帧生效），防回调内删除导致 for-of 跳元素或漏执行。

### 示例
- `adapters/render-host.ts`（`RendererHost` 实例字段）：`private readonly _camDir = new THREE.Vector3(); private readonly _forward = ...`
- 渲染循环内：`camera.getWorldDirection(this._camDir)` 替代 `new Vector3()`
- `applyWasdCameraMotion(keys, cam, ctr, session.camSpeed, dt, ..., { camDir: this._camDir, forward: this._forward, ... })`
- 模块级缓存：`const UpVec = new THREE.Vector3(0, 1, 0)`
- 快照迭代：`for (const fn of this.perFrameIterable())`（`render-host.ts` `RendererHost`；`render-loop.ts` 现为薄门面）

### 适用场景
- 60fps 渲染循环
- 每帧执行的高频路径（相机控制、动画插值）
- 移动端/低功耗设备

### 不适用场景
- 低频触发的工具函数（如调试可视化）
- 一次性初始化代码

---

## 4. 纹理/材质缓存模式

### 问题
调试渲染器中频繁创建 CanvasTexture（每骨骼标签），导致 GPU 内存浪费和帧率波动。

### 解决方案
**LUT 缓存 + 键值检索**：
1. 模块级 `Map<string, THREE.CanvasTexture>` 缓存已创建的纹理。
2. 以 `文本::颜色` 为 key，命中则直接返回，未命中则创建并缓存。
3. 注意：调试场景下需配合 dispose 链清理缓存（否则内存泄漏）。

### 示例
- `debug-render.ts`：`const _labelTexCache = new Map<string, THREE.CanvasTexture>()`
- 命中检查：`const cached = _labelTexCache.get(key); if (cached) return cached;`
- 写入缓存：`_labelTexCache.set(key, tex);`

### 适用场景
- 调试/开发工具渲染
- 频繁创建的不可变纹理（字体、图标）
- 性能敏感的 UI 标签系统

### 注意事项
- 生产环境需确保缓存随资源释放而清理
- 缓存键的设计要足够区分（避免碰撞）

---

## 5. 事件生命周期管理模式

### 问题
模块级单例监听器（如 `_prevWindowMove`）在并发场景下存在竞态风险：旧监听器未及时移除，新监听器覆盖后旧回调仍可能被触发。

### 解决方案
**AbortController 替代手动产消**：
1. 用 `AbortController` 替代手动 `removeEventListener`。
2. 调用 `ac.abort()` 一次性清除所有监听器，无竞态风险。
3. 在 `ctx.unsubs` 中注册清理回调，保证组件销毁时自动清理。

### 示例
- `skeleton.ts`：`let _prevAbort: AbortController | null = null`（替代 `_prevWindowMove/_prevWindowUp`）
- `skeleton.ts`：`_prevAbort?.abort(); const ac = new AbortController(); _prevAbort = ac;`
- `skeleton.ts`：`window.addEventListener(..., opts); ctx.unsubs?.push(() => { ac.abort(); ... });`

### 适用场景
- 窗口级事件监听（pointermove、resize、keydown）
- 高频触发的拖拽/滑动交互
- 多实例共存场景（避免单例污染）

### 对比：旧模式 vs 新模式
| 维度 | 旧模式（手动管理） | 新模式（AbortController） |
|------|-------------------|--------------------------|
| 竞态风险 | 有（旧监听器未清理） | 无（abort 一次性清除） |
| 代码复杂度 | 需维护多个指针变量 | 单一控制器对象 |
| 清理可靠性 | 依赖开发者手动调用 | 接口保证，可组合 |

---

## 6. 函数抽取与圈复杂度控制

### 问题
复杂业务逻辑（如骨骼父子链修复）内联在主函数中，导致圈复杂度高、可读性差、难以测试。

### 解决方案
**内联逻辑 → 独立命名函数**：
1. 识别可独立复用的逻辑块（如"修复断裂的父子链"）。
2. 提取为具名函数，输入参数显式化。
3. 原位置替换为函数调用，保持主流程清晰。
4. 同步修复缩进不一致（间接暴露的代码质量信号）。

### 示例
- `model-group-builder.ts`：提取 `FixOrphanBoneChain(bones, modelBones, pivots): void`
- 调用点：`FixOrphanBoneChain(bones, model.bones, pivots);`
- 原内联段迁移后，`buildModelGroup` 函数圈复杂度显著降低

### 适用场景
- 函数超过 50 行且包含多层嵌套
- 逻辑块可独立测试
- 多处重复的同构逻辑

### 最佳实践
- 函数名应准确描述行为（动词 + 名词，如 `FixOrphanBoneChain`）
- 参数列表不超过 4 个，超出考虑封装为对象
- 注释说明"为什么"而非"做什么"

---

## 7. 资源生命周期管理模式

### 问题
Three.js 资源（几何体、材质、纹理、渲染器）需要成对 dispose，遗漏会导致 GPU 内存泄漏。

### 解决方案
**分层清理契约 + 安全释放原语**：
1. **能力层 dispose**：`SkyCapability.dispose()`、`GroundCapability.dispose()`、`LightCapability.dispose()` 各自管理自己的资源。
2. **后处理层 dispose**：`EffectComposer.dispose()` 清理渲染目标和后处理 Pass。
3. **防御性遍历**：`disposeSceneMeshes()` 遍历场景图释放所有 Mesh 的 geometry/material。
4. **安全释放原语**：`safeDispose(obj)`（`safe-dispose.ts`）捕获 dispose 可能的异常（重复 dispose 场景），适配器各自实现 dispose、个别会抛错——安全释放保证「一个抛错不阻塞后续释放」。

### 示例
- `mount-preview-core.ts`：分层清理链（skyCap/groundCap/lightCap/composer 逐一 dispose）
- `cleanup-helper.ts`：`disposeDebugGroup()` — 遍历 debugGroup 释放 Mesh/Line/Sprite
- `cleanup-helper.ts`：`disposeSceneMeshes()` — 通用场景图清理
- `safe-dispose.ts`：`safeDispose(obj)` — 异常安全包装，零依赖原语

### 适用场景
- 所有 Three.js 相关代码
- Web 应用的 GPU 资源管理
- 长生命周期应用的资源回收

### 清理顺序原则
1. 先清理业务对象（Mesh、Group）
2. 再清理控制器（OrbitControls）
3. 最后清理渲染器（WebGLRenderer）
4. 从内到外，避免悬空引用

### 7.1 缓存纹理的所有权契约（审核 C1 教训，2026-09-03）

**规则**：取自纹理缓存池的 Texture（`loadTextures()` → `textureCache.acquire(url)`）
**所有权归缓存池**，消费方只持**引用**，清理时必须 **release，禁止 dispose**。

| 场景 | 正确做法 | 错误做法 |
|------|----------|----------|
| 用完一批 `loadTextures(urls)` 结果 | `releaseTextureUrls(urls)`（`preview-3d/texture-loader.ts`） | 逐个 `tex.dispose()` |
| 消费 `preloadModel()` 产物 | 调其返回的 `releaseTextures()`（幂等，含 componentTexMap 清单） | 自行遍历 `texArr` dispose |
| 会话整体结束 | 核心 `fullCleanup` 自动 `textureCache.disposeAll()` | —— |

**为何禁止 dispose**（三重后果，实测于 `texture-cache.ts`）：
1. `release` 只减 refs，条目归零后**保留在池**供跨模型复用；`dispose` 留下 refs 恒 ≥1 的
   僵尸条目，而 `evictZeroRefIfNeeded` 只淘汰 `refs===0` ⇒ **LRU 永久失效**，缓存越过
   `maxEntries=200` 单调增长。
2. 每次模型切换都 dispose ⇒ 缓存池正要复用的共享纹理被销毁，「同纹理只 upload 一次」
   的 P0 优化完全失效（`switchTo` 不经 `fullCleanup`，只有关闭预览才 `disposeAll`）。
3. 缓存仍持有该条目并对外分发**已销毁**的 Texture，靠 Three.js 重传兜底，Image 被 GC 后渲染空白。

**两个易错细节**：
- **不去重**：同一 URL 出现 N 次即 acquire N 次（多组件共享 skin 是常态），必须 release N 次才能归零。
- **幂等**：释放器内置 once 标志——dispose 重入会把仍在使用中的共享纹理 refs 多减，
  提前归零后被 LRU 淘汰，造成悬垂已释放纹理。

**失败路径必查**：`loadTextures` 之后、句柄产出之前的任何异常（如 `buildYsmObject` 抛错）
都要归还引用，否则引用永久泄漏。参照 `pack-model-adapter.ts` 的失败路径范式。

---

## 7.2 build 失败路径 ≠ fullCleanup（2026-09 二次审核教训）

### 问题
`mount3D` 的 `adapter.build` 抛错 catch 段，若只移除 escH 而不解绑输入监听/拆菜单/停 rAF，
跨会话反复失败挂载会逐次累积 document/window 监听器与菜单 DOM。但**不能直接套
`runFullCleanup`**——它语义是「完整关闭」（拆 overlay + 清场景能力 + disposeAll 纹理缓存），
而失败路径**有意保留 overlay**（上面要展示 `showLoadFailure` 错误提示），且场景能力/纹理缓存
可能被其他活跃会话共享，全清会误伤。

### 解决方案
轻量失败清理函数 `runFailedMountCleanup(ctx)`（`mount-session.ts`，与 runFullCleanup 并列）：
复刻其 ②③⑦ + perFrame/rAF 收尾段（tip 定时器、menuHandle.dispose、输入监听解绑、
removePerFrame + stopIfIdle），**不做** ④⑤（拆容器/overlay/单例）、⑥ 由调用方自清、
⑧⑨（场景能力/纹理缓存——可能共享）。escH 移除由调用方（catch 段）负责。

### 原则速记
- **区分「build 抛错失败路径」与「加载期打断路径」**：后者（abort/gen 守卫）已正确走
  `runFullCleanup` 完整拆除；前者保留 overlay 展示错误，只做轻量解绑。
- 装配顺序：输入监听/菜单/rAF 在 build **前**已注册（bindInputHandlers / mountPreviewRootMenu /
  startGlobalRenderLoop），故 build 失败时它们必然已存在 → catch 必须逐一解绑。

---

## 7.3 审核疑点需亲自核实（二次审核防误报）

2026-09 二次审核对首轮子代理报告的 6 个 3D 疑点逐一核实，**1/6 是误报**，教训：
- 疑点「skeleton textureImg（ImageBitmap）未 close」→ **误报**：真实类型是
  `HTMLImageElement`（skeleton-render.ts `new Image()`），无 `close()` API，浏览器自动 GC。
  审核方看到变量名 `textureImg` 望文生义为 ImageBitmap，未查类型定义。
- **核实方法**：报「资源泄漏/缺 close/dispose」类问题时，先查变量真实类型与构造处
  （grep 构造 + 类型声明），再下结论——名称暗示 ≠ 实际类型。
- 本次确认属实并修复：build 失败路径泄漏（→ 7.2 runFailedMountCleanup）、skeleton rAF
  自动 3D 无 isConnected 守卫（组件销毁后仍弹全屏）、texture-loader 轮询无超时
  （图片 URL 悬挂 → Promise.all 永久 pending，加 15s 超时兜底）。

### 2026-09-14 第三次审核（preview-3d 全目录扫描）误报规律——三类模式必须核实

主代理派 4 个子代理扫描 `preview-3d/` 全目录（~63,700 行、150+ 文件），输出 ~100 项 P1–P4。
主代理按优先级亲自核实 P1/P2 关键项，发现**子代理报告 1/5 P1 误报、2/5 P1 高估**，
复现 7.3 首轮教训并扩展出三类高频误报模式：

| 误报模式 | 实例（本次） | 核实方法 |
|---------|-------------|---------|
| **① 模块级 `let` 望文生义为单例缺陷** | P1-1 判 `litematic-adapter.ts:263` `let SliceInstance` 为"模块级单例→schema key 碰撞"。实为注释明写「per-scene 唯一 key／多模型并存防互相覆盖」（5329a347 review P2 产物），正是 **ADR-132 红线的正确实现**。子代理见 `let` 即触发模式匹配，未读 263 行注释 | 见模块级 `let`/`const` 计数器，先 grep 其**全部使用点 + 紧邻注释**，确认是否已做 per-scene 唯一化 |
| **② 把 ADR 已落地的改进当遗留债务重报** | P2 判"ADR-233 过渡期 isDisposed 三重复制未收敛"。实测 `mount-preview-core.ts:850-852` 已传 `session.isDisposed`/`session.aborted` **引用共享**（非各自 new），`guardSessionAlive` 已收敛 3 处逐字咒语（switch-preview L153/263/307）——**ADR-233 完全落地**，子代理报的是 ADR 前旧稿 | 报"某 ADR 遗留未做"时，先 grep 该 ADR 的落地点符号（如 `guardSessionAlive`/`SessionStatus`）确认是否已实施，再下结论 |
| **③ 热路径/构建期路径混淆，性能项高估** | P2 判"mesh.ts 环检测 O(n²) 大模型卡顿"、"env-dispatcher 每帧 new Set GC 压力"。实测环检测是**构建期一次性**（非 rAF 热路径，树深 <20 实际 O(n·d)）；`new Set` 每帧仅几个键，GC 可忽略。子代理未区分「构建期」与「渲染热路径」 | 报性能项时，先确认调用频率：rAF 内＝热路径须核实；构建/切换期＝一次性，O(n²) 非缺陷 |

**总教训**：子代理擅长扫描覆盖（广度），但对「注释已声明的权衡」「ADR 已落地」「调用频率」
辨识力不足，见到 `let`/`as unknown as`/长函数/`new` 即触发模式匹配报缺陷。主代理必须
**按优先级核实关键项**，不直接采信——尤其 P1 级，误报代价最高（引导用户做无谓改动）。
本次真正值得动手的仅 1 项（P1-3 env.ts 双源 id 漂移，一行 `new Set(ORDERED_IDS)` 修复）。

### 7.4 第四次审核（刀⑳ 2026-09）——漏报范式：审核记忆只管误报，对孪生不对称失明

刀⑳ 对同一目录（已过刀⑯–⑲ 四轮）再扫一遍，**抓到 4 个此前四轮全部漏掉的 P1 级真缺陷**
（详见 `skills/pitfalls.md` 致命陷阱 #19）。关键不在于又找到 bug，而在于**为什么"多轮审核"
没能收敛**——四例同源，且都落在既有审核方法的盲区里：

| 缺陷 | 真因 | 四轮为何漏 |
|------|------|-----------|
| 输入阻断栈泄漏 → WASD 永久失灵 | a11y 提交新增 `onShow`/`onHide` 配对协议，未回头调和既有的 `dispose()`（仍是"只拆 DOM"旧语义） | 缺陷是**协议换代时的遗漏**，代码"看起来"两处都有 pop |
| 混合模式/面剔除下拉完全失效 | 菜单级测试 `set!(String(x))` + `expect(get()).toBe(String(x))` 是**恒真断言**（string 比 string） | 测试**存在且通过**，扫描器看到"有测试"即认为已覆盖 |
| `"plain"`（素面）渲染成格线 | 分派末尾 `else` 带 `// grid` 注释，**catch-all 吞掉未枚举的模式** | 代码"有分支"，静态扫描看不出 `plain` 落错支 |
| VRM 骨骼数 trace 报 1 | 修复提交只审视**自己新增**的那行（`boneCount`），90 行前更早的同款行未在改动范围 | 修复的**范围惯性**：只见 diff，不见同构同胞 |

**根因（元级）**：`3d-patterns` §7.3 沉淀的对策全部针对**误报（假阳性）**——"子代理报得太多，
主代理要核实"。但刀⑳ 的四例是**漏报（假阴性）**：它们**从未出现在任何报告里**，核实机制
无从发力。**"广度扫描 + 误报压制"范式对孪生不对称天然失明**——它做的是"全目录的缺陷模式
匹配"，而这类缺陷需要的是"**改动范围内的同构搜索**"。

**对策（新增审核动作，与前几轮互补而非取代）**：

1. **审核任务书上加"孪生搜索"一项**：不只问"这里有没有 bug"，还问"**这处逻辑在别处有没有
   同款写法**"。对每个被判定为"正确"的实现，要求审核者给出"它的同胞在哪、是否也正确"。
2. **把"修复提交的范围惯性"列为已知失效模式**：审 `git show <fix-commit>` 时，主动检查
   **同文件未被该提交触及的同构行**——修复者天然只盯着自己引入/新增的那行。
3. **测试质量纳入审核口径**：见到断言先问"这条断言如果被实现写错，会不会仍然通过"。
   `set(X)` → `expect(get()).toBe(X)` 形态（入参原样回读）与 `toBe(String(...))` 形态
   （跨类型不归一）优先复核——**"有测试且通过"不等于"行为正确"**。
4. **分派语句专项**：凡 `else` / `default` 承载具名模式行为（注释写着某个模式名）者，
   要枚举该类型的全部合法值核对——catch-all 是"未处理输入静默变语义"的温床。
5. **成对操作专项**：凡 `push/pop`、`open/close`、`mount/unmount` 类协议，清点**所有既有
   生命周期出口**（尤其 `dispose`、错误 catch、提前 return）是否都接了对应半程。

**一句话**：前几轮的教训是「**别信子代理报的**」，刀⑳ 补上另一半——「**也别信报告里没有的**」。
多轮审核不等于收敛：**反复用同一种方法扫同一片代码，只会反复得到同一批结论**；
要收敛必须换维度（从"找缺陷模式"换到"找同构不对称 + 验证断言有效性"）。
（实证：本次 3 个子代理仍报出若干项，但四例真缺陷**无一由它们发现**，全部来自主模型
对"修一处必查其同胞"的主动搜索。）

---

## 8. 循环依赖破壁模式（注册表反向注入）

### 问题
`preview-library.ts` 需要调用各 `createXxx3D` 函数实现跨类型跳转，但各包装器又 import `preview-library.ts`，形成循环依赖红线（check-circular 阻断）。

### 解决方案
**注册表反向注入**：
1. `preview-library.ts` 定义为**叶子模块**：不反向 import 任何 `createXxx3D`。
2. 各包装器在模块加载时调用 `registerReRoute(type, opener)` 注册自己的入口。
3. `openModel3DFullscreen()` 查表派发，无类型注册时 toast 提示。

### 示例
- `preview-library.ts`：
  ```typescript
  const _openers: Record<string, (path: string) => Promise<void>> = {};
  export function registerReRoute(rtype: string, opener: (path: string) => Promise<void>): void {
    _openers[rtype] = opener;
  }
  ```
- `mmd-3d.ts`：`registerReRoute(RESOURCE_TYPES.MMD, (path) => createMmd3D(path));`
- `ysm-3d.ts`：`registerReRoute(RESOURCE_TYPES.YSM, openYsmFullscreen);`
- `preview-library.ts`：查表派发逻辑（`openModel3DFullscreen` 内 `_openers[rtype]`）

### 适用场景
- 多模块互相依赖的循环引用
- 插件化/可扩展架构（新类型无需修改核心）
- 打破"核心→插件→核心"闭环

### 优势
- 编译期无循环依赖警告
- 运行时动态注册，支持热插拔
- 核心模块保持纯粹（无业务类型感知）

---

## 9. 错误处理模式

### 问题
库加载失败时静默返回空数组，用户无感知，难以排查问题。

### 解决方案
**静默失败 → 用户通知**：
1. catch 块中通过 bus 发送 toast 事件。
2. 使用懒加载 `import("../../bus.ts")` 避免循环依赖。
3. 保留空数组返回，避免中断调用链。

### 示例
- `preview-library.ts`：
  ```typescript
  import("../../bus.ts").then(({ bus }) => 
    bus.emit("toast:show", { msg: "库加载失败", duration: 3000, type: "warn" })
  );
  ```

### 适用场景
- 异步数据加载失败
- 可选功能的降级处理
- 用户可见的错误场景

### 不适用场景
- 内部工具函数的错误（日志即可）
- 测试环境（避免干扰断言）

---

## 10. 并发防护模式

### 问题
快速切换模型时，旧加载任务可能在新任务完成后仍触发状态更新，导致 UI 错乱或资源泄漏。

### 解决方案
**代际守卫 + aborted 标记**（代际计数器自 ADR-227 收敛至 `session-ledger.ts` 的 `sessionLedger` 实例字段，原 `mount-preview-core.ts` 的 `let _gen`）：
1. 会话台账持代际计数器，每次 `mount3D` 经 `beginSession()` 分配新代际。
2. 调用时捕获 `myGen`（`beginSession()` 返回的 `gen`），后续异步回调检查 `myGen !== getGen()` 则丢弃结果。
3. `aborted` 标记处理 ESC/手动关闭场景。
4. `isDisposed` 对象处理 dispose 后的防护。

### 示例
- `session-ledger.ts`：`sessionLedger.beginSession()`（分配新代际 + per-mount 会话 id，取代 `++_gen` / `++_mountSessionSeq`）
- `session-ledger.ts`：`sessionLedger.invalidate()`（新预览派发时作废在途加载，取代 `_gen++`）
- `mount-preview-core.ts`：`const { gen: myGen, sessionId } = sessionLedger.beginSession();`（调用时捕获当前代际）
- `mount-preview-core.ts`：`getGen: () => sessionLedger.gen()`（ctx 暴露给 mount-session / switch-preview 读取代际）
- `switch-preview.ts`：`if (ctx.aborted.v || ctx.isDisposed.v || ctx.myGen !== ctx.getGen()) return;`（过期任务丢弃 / dispose 后防护）

### 适用场景
- 异步加载 + 状态更新
- 快速连续操作（切换模型、刷新数据）
- 用户可能主动取消的场景（ESC、关闭按钮）

### 对比：gen 守卫 vs Promise 链
| 维度 | Promise 链 | gen 守卫 |
|------|-----------|---------|
| 取消支持 | 需 AbortController | 内置 aborted 标记 |
| 并发控制 | 隐式（last one wins） | 显式（唯一活跃 gen） |
| 代码侵入性 | 低 | 中（需维护计数器） |

---

## 11. 防御性编程模式

### 问题
组件销毁后 DOM 操作可能抛错（如 `container.isConnected === false`）。

### 解决方案
**关键路径入口守卫**：
1. 异步回调入口检查 `container.isConnected`。
2. 资源释放时 try-catch 包裹（dispose 可能因已释放而抛错）。
3. typeof 守卫避免 stub 环境误崩。

### 示例
- `skeleton.ts`：`if (!container.isConnected) return;`（异步回调入口守卫）
- `mount-preview-core.ts`：`if (typeof (sc as unknown as { traverse?: unknown }).traverse === "function")`（typeof 守卫）

### 适用场景
- Web Component 生命周期管理
- 异步操作完成后状态检查
- 测试 stub 环境兼容

---

## 12. 子代理协作模式

### 问题
大规模代码审核需要并行处理能力，单代理效率有限。

### 解决方案
**划范围 → 放手改 → 一眼抽查 → 自主汇总**：
1. **划范围**：给审核子代理明确目录和分级标准。
2. **放手改**：子代理自主执行扫描和报告生成。
3. **一眼抽查**：主模型 diff 抽查关键改动，不逐行审。
4. **自主汇总**：子代理汇报总结，主模型统一提交。

### 示例
- 审核子代理（d30590f0）：扫描 preview-3d + app-preview 目录，输出 P1-P4 分级报告。
- 主模型消化：按优先级批量修复 → 验证 → 提交。
- 验证门禁：vite build + npm run typecheck + 测试全绿。

### 适用场景
- 多文件批量重构
- 代码健康度复查
- 跨模块一致性检查

---

## 13. 降级链抽取模式（三级读取器，2026-09）

### 问题
`mmd-build-load.ts|Stage1bFileScan` 原为单函数 108 行、嵌套 8 层：纹理字节读取的
**三级降级链**（带 meta 批量 → 无 meta 批量 → 并发逐个）连同 blob 登记、map 写入全部
内联在扫描主流程里，真正干活的一行（`texBatch[p] = entry.data`）埋在 8 层深处。

### 解决方案
**按「降级层级」而非「代码位置」切分**：
1. **`readTextureBytesWithFallback(c, texFiles)`** — 三级链独立成函数，用**提前返回**替代嵌套
   （每级成功即 `return`，失败才落 catch），嵌套 8→2 层，命名向行为诚实（它实际是
   「带降级的批量读取器」，非单纯批次读取）。
2. **`registerTexture(c, p, texB64)`** — 单张纹理登记（建 blob URL → 推解码任务 → 写归属映射），
   返回 `{url, rel} | null`（null = 跳过），把循环体 6 个局部量 + 2 处 skip 收进一个具名单元。
3. 循环内重复重建的 MIME 表提为模块级 `TEX_MIME_BY_EXT` 常量。

### 关键：降级触发语义不同，勿合并
- **①→② 是「补齐」**（① 成功但覆盖不全，不抛错）→ 故 ①/② 同处一个 `try`。
- **②→③ 是「兜底」**（批量通道整体抛错才走）→ 在 catch 段。
合并两级会改变语义（把「部分成功」误当「整体失败」而全量重读）。

### 适用场景
- 多级 fallback / 降级策略链（尤其嵌套 `try` 包裹能力探测 + 结果判空）
- 循环体内「计算多个局部量 → 若干 skip → 写多个归属表」的登记型逻辑

### 复现度量（实证）
| 指标 | 前 | 后 |
|------|----|----|
| `Stage1bFileScan` 行数 | 108 | 43 |
| 最大嵌套深度 | 8 | 4（余下 2 层为对象字面量，非控制流） |
| 文件总行数 | 320 | 360（净增：注释 + 具名函数签名） |

**行数增加但可读性提升**——别把「文件变长」当退步，拆分的收益是嵌套深度与认知负荷。

---

## 14. 双端容错契约锚定（Go 实测优于推测，2026-09）

### 问题
前端有**三处**独立解析 Bedrock geometry 的 `origin/size/pivot/rotation` 三元组：
`preview-3d/model/spec-builder.ts`（内联 4 处）、`parsers/bedrock-geometry.ts|toArr`、
`parsers/ysm-json.ts|vec3`。三者容错口径互不相同，且**均与 Go 权威实现有偏差**。
（曾有提案"统一三处实现"，但统一到哪个是错的——必须先知道 Go 真值。）

### 方法：用真实语料 + Go 实机探针，而非读代码猜测
1. **Go 实机探针**（决定性）：写临时 Go 程序 unmarshal 各种畸形输入，观测 `[3]float64` 的实际行为。
   结论（`encoding/json` 定长数组语义）：
   | 输入 | Go 行为 |
   |------|---------|
   | `[1,2,3]` | `[1,2,3]` |
   | `[1,2]` 过短 | `[1,2,0]` **补零，不报错** |
   | `[1,2,3,9]` 过长 | `[1,2,3]` **截断，不报错** |
   | `[1,"a",3]` / `{x,y,z}` | **err → 整体解析失败** |
   | 键缺席 | `[0,0,0]` |
2. **真实语料分布**（`upstream/` 238 个 geometry 文件、17,104 骨骼、**51,400 cube**）：
   - `origin`/`size`：**100% 规范 3 元数组**，零对象/过短/过长/字符串
   - `pivot`/`rotation`：34,485 规范 + 16,915 **键缺席**，零异常形态
   - ⚠️ **缺席是「键不存在」，不是 `null` 值**（`"pivot":null` 出现 0 次）

### 结论（推翻了"值得统一"的初始判断）
三处实现的分歧**只存在于真实语料从未出现的畸形输入上**。51,400 个 cube 全部走
"规范 3 元数组"分支——那是三者行为**完全一致**的分支。故：
- **统一收益 ≈ 0**（改的是死路径），**风险实**（`spec-builder` 受 ADR-129 几何口径约束，
  放宽其拒绝语义是真实行为变更）。
- 正确动作 = **写契约测试固化现状**（`preview-3d/model/triple-tolerance.contract.test.ts`），
  把 Go 契约与三处偏差显性化，使未来任一侧改动**显式失败**而非静默漂移。

### 顺带发现的孤儿分支
`bedrock-geometry.ts|toArr` 支持 `{x,y,z}` 对象形态（注释称"某些导出工具输出对象"），
但 **238 个真实模型零命中**，且 Go 明确拒绝该形态——**无数据支撑、与 Go 相悖**的兼容路径。

### 教训（元级）
**"三处代码长得不同" ≠ "三处行为有差异"**。判断差异必须用**真实语料**跑分布，
而非读代码推断——否则会把"分支长得不一样"误报成"契约不一致"（§7.3 误报模式的又一变体）。
且**定契约要先测权威实现**（Go 探针），不能拿前端三处里"看起来最严"的那个当基准：
`vec3` 严校验长度 3 看似最稳，实际比 Go 更严（Go 补零），**它才是偏得最远的那个之一**。

---

## 15. 守卫条件不可无差别套用（"补上缺失条件"反而是 bug，2026-09）

### 问题（疑似缺陷）
`mount-session.ts|guardSessionAlive` 是 ADR-233 的会话存活唯一出口，检查**三条件**：
`aborted.v || isDisposed.v || myGen !== getGen()`。
但 `mount-preview-core.ts` 有两处手写**两条件**版（缺 `isDisposed.v`）：
- `runBuild` 中止分支（build await 之后）
- `recoverMountFailure` 报错守卫（catch 段）

静态看像"ADR-233 未收敛干净的遗漏"——**但这个判断是错的**。

### 核实结论：两处省略均正确，补上会制造真 bug

**① `recoverMountFailure` 绝不能加 `isDisposed.v`（决定性）**
该处位于 catch 段，其上 `runFailedMountCleanup(ctx)` 刚执行 `teardown(failed)`
→ **`isDisposed.v` 必然为 true**。若改用 `guardSessionAlive`，守卫**恒 false** ⇒
`showLoadFailure` 永不执行 ⇒ **用户永远看不到加载失败提示**。
（实测：注入该改动后「build 失败 → 错误提示」相关用例立即失败）

该处真实语义是「本会话是否被**外部**中断」（ESC / 切模型），**不是**「会话是否已 dispose」。

**② `runBuild` 中止分支：`isDisposed` 在该点不可独立为 true**
`teardown(full)` 入口只有 `handle.cleanup()`（需 `commitSession` 已跑）与 `escH`
（`commitSession` 内才替换为 full 版）；`teardown(failed)` 只在 catch 段发生。
本分支位于 build await 之后、`commitSession` 之前 ⇒ 挂起期无任何 teardown 入口
⇒ `isDisposed` 恒 false ⇒ 加与不加行为等价（现写法不构成缺陷）。

### 教训（元级，与 §7.3 同源互补）
1. **"统一出口"不等于"所有守卫都必须调它"**：ADR-233 收敛的是 `switch-preview`
   三处**同语义**咒语，非要求全仓所有「是否继续」判断都复用它。**条件集须随调用点语义裁减**。
2. **发现"某处少了某个条件"时，先问"这个条件在该点可能为真吗"**：若恒为真（或恒为假），
   补上会改变语义；`recoverMountFailure` 正是"恒为真"的反例。
3. **验证方式 = 注入式反证**：把"修复"实际注入代码跑测试，看它是变绿还是变红。
   本次注入后 2 条既有用例立即失败 → 证明"修复"有害。这比读代码推演可靠得多。

---

## 16. 覆盖/还原不对称：快照建得早，覆盖铺得晚（2026-09 实测真 bug）

### 症状
`RenderModeCapability`（线框/X光/混合模式等 5 个材质属性覆盖）在**覆盖生效期间**
新加入 scene 的材质上，`dispose()` **不还原**该属性 ⇒ 覆盖值永久残留。

实测（`npx tsx` 探针）：`matB.blending` 被 cap 写成 `AdditiveBlending(2)`，
`dispose()` 后仍为 `2`（应为 `NormalBlending(1)`）。

### 根因：两个函数的遍历源不同步
| 函数 | 遍历源 | 对新材质的行为 |
|------|--------|--------------|
| `collectSnapshot()` | 当前场景材质（**首次 override 时**） | 晚到材质**不在**快照里 |
| `applyOverrides()` | 当前场景材质（**每次 sync**） | **覆盖它** ← 写了 |
| `restoreSnapshot()` | 当前场景材质 | `if (!orig) continue` **跳过** ← 没擦 |

**不对称**：`applyOverrides` 覆盖了它，`restoreSnapshot` 却不还原它。
即「cap 自己写进去的值，自己没擦掉」。

### 修复：在**覆写点**补拍快照（而非依赖外部同步入口）
`applyOverrides` 内 `collectOne(mat)` —— 首次被本函数触及时就地拍快照，
此刻的值即其原始值。改动极小，与既有快照机制同构。

### ⚠️ 关键陷阱：不要把它误判为「有意设计」而放过
既有一条测试 `还原时场景中新增的无快照材质被跳过` 断言"**保留外部设置的 true**"，
**看似**该跳过是有意的。但二者并非同一问题：

| | 既有用例 | 真 bug 场景 |
|---|---|---|
| 材质新值来源 | **外部**自设 | **cap 亲手**写入 |
| 加入后是否 sync | **否** | **是** |
| 应有行为 | 不误改外部设定 | **擦净自己写过的值** |

**两个诉求可同时成立**，是「且」不是「或」。修复后两条测试同时通过（已实测）。
→ 教训：看到「保留外部值」的测试时，必须再问一句「**这个值是外部写的还是我写的**」。

### 同族对照：`ShadowCapability` 为何没这问题（正确范式）
- `restoreMeshes()` 遍历 **`meshSnaps` 快照表本身**（非当前场景）⇒ 凡入快照者必还原；
- 且有**显式重同步入口** `syncMeshes(roots)`，外部在模型加载完后主动为新 mesh 拍快照。
- render-mode 无此入口 ⇒ 故选「覆写点补拍」作为等价修复。

---

## 模式速查表

| # | 模式名称 | 核心思想 | 适用场景 | 红线/禁忌 |
|---|---------|---------|---------|----------|
| 1 | 审核驱动开发 | 子代理审核 + 主模型修复 | 重构后复查、性能敏感模块 | 不适用 hotfix |
| 2 | 类型安全收敛 | any → 具体类型渐变 | Three.js 代码、GPU 管理 | 避免过度强类型（牺牲灵活性） |
| 3 | 渲染循环优化 | per-frame 对象复用 | 60fps 路径、高频调用 | 低频代码勿池化（增加复杂度） |
| 4 | 纹理缓存 | LUT 缓存不可变纹理 | 调试渲染、字体标签 | 需配合 dispose 清理 |
| 5 | 事件生命周期 | AbortController 替代手动管理 | 窗口级监听、拖拽交互 | 避免混用新旧模式 |
| 6 | 函数抽取 | 内联逻辑 → 命名函数 | 圈复杂度 > 10、重复逻辑 | 函数参数不超过 4 个 |
| 7 | 资源生命周期 | 分层清理契约 | Three.js 资源管理 | dispose 顺序：业务 → 控制器 → 渲染器 |
| 8 | 循环依赖破壁 | 注册表反向注入 | 多模块互相依赖 | 核心模块保持叶子 |
| 9 | 错误处理 | 静默失败 → 用户通知 | 异步加载、可选功能 | 内部工具仅需日志 |
| 10 | 并发防护 | gen 守卫 + aborted 标记 | 异步加载、快速切换 | 避免滥用（增加状态） |
| 11 | 防御性编程 | isConnected 守卫 | Web Component、异步回调 | 不过度防御（可读性下降） |
| 12 | 子代理协作 | 划范围 → 放手 → 抽查 | 大规模审核、并行重构 | 信任为主，抽查为辅 |
| 13 | 降级链抽取 | 按降级层级切分 + 提前返回 | 多级 fallback、登记型循环体 | 勿合并语义不同的降级级 |

### ⚠️ 度量陷阱：`{}` 计数 ≠ 真实嵌套深度
用脚本按花括号计数测「嵌套深度」会**系统性高估**——对象字面量（`push({a,b,c})`、
`new Map<_, {resolve,timer}>`）与回调函数（`w.onmessage = (e) => {…}`）都占括号层，
但**不是控制流**。实证：`createTextureDecoder` 报 8 层，逐层打开后真实控制流仅 3–4 层
（余下是 pending Map 的值对象与 onmessage/onerror 回调）；`Stage1bFileScan` 报 8 层，
其中 5 层是真的嵌套 `try`/`if`/`for`。
**结论**：深度数字只能用于**筛候选**，必须逐层打开确认是控制流还是字面量，再决定是否动手。
（同源教训见 §7.3「子代理报告需主代理核实」——这里是数量口径本身的假阳性。）

## 参考提交

- `cf781437`：资源库路由改为注册表反向注入 + 去壳死导出
- `0b416054`：P2 修复 — composer/bloomPass 类型化 + fixOrphanBoneChain 抽取
- `e0065671`：P3 修复 — Vector3 复用 / 纹理缓存 / AbortController / toast

## 相关文件

- `frontend/src/preview-3d/infra/render-host.ts` — 渲染循环优化（`RendererHost`：Vector3 复用实例字段）；`render-loop.ts` 为薄门面（ADR-227）
- `frontend/src/preview-3d/infra/safe-dispose.ts` — 安全释放原语
- `frontend/src/preview-3d/infra/debug-render.ts` — 纹理缓存
- `frontend/src/preview-3d/model/model-group-builder.ts` — 函数抽取（FixOrphanBoneChain）
- `frontend/src/preview-3d/adapters/mount-preview-core.ts` — 类型收敛、并发防护、资源生命周期
- `frontend/src/preview-3d/adapters/mount-session.ts` — 失败路径清理 runFailedMountCleanup
- `frontend/src/views/app-preview/preview-library.ts` — 循环依赖破壁
- `frontend/src/views/app-preview/skeleton.ts` — AbortController、防御性编程
