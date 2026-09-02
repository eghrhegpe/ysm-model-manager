---
kind: 3d-patterns
name: 3D 区审核与修复模式提炼
tier: leaf
category: ui
source_files:
  - frontend/src/preview-3d/debug-render.ts
  - frontend/src/preview-3d/model-group-builder.ts
  - frontend/src/preview-3d/adapters/mount-preview-core.ts
  - frontend/src/preview-3d/cleanup-helper.ts
  - frontend/src/views/app-preview/preview-library.ts
  - frontend/src/views/app-preview/skeleton.ts
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
  - frontend/src/preview-3d/debug-render.ts|rebuildDebug
  - frontend/src/preview-3d/model-group-builder.ts|buildModelGroup
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
- 验证门禁：每次提交前跑 `vite build` + `npm run typecheck` + 501 项测试全绿。

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
1. **接口先行**：在 `LoopContext` 接口中显式声明字段类型（如 `_cd: THREE.Vector3`），即使暂时未被消费也提前定义契约。
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
**对象池化 + 上下文复用**：
1. **LoopContext 扩展**：在 `LoopContext` 接口中新增 `_cd`、`_fwd`、`_right`、`_mv` 字段，声明为 `THREE.Vector3`。
2. **per-frame 复用**：渲染循环内直接使用 `ctx._cd.set(...)` 替代 `new THREE.Vector3()`。
3. **模块级常量**：不随帧变化的向量（如 `UpVec`）提为模块级常量，避免重复创建。

### 示例
- `render-budget.ts`：接口新增四个 Vector3 复用字段
- 渲染循环内：`ctx.camera.getWorldDirection(ctx._cd)` 替代 `new Vector3()`
- 模块级缓存：`const UpVec = new THREE.Vector3(0, 1, 0)`

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
- `model-group-builder.ts`：提取 `fixOrphanBoneChain(bones, modelBones, pivots): void`
- 调用点：`fixOrphanBoneChain(bones, model.bones, pivots);`
- 原内联段迁移后，`buildModelGroup` 函数圈复杂度显著降低

### 适用场景
- 函数超过 50 行且包含多层嵌套
- 逻辑块可独立测试
- 多处重复的同构逻辑

### 最佳实践
- 函数名应准确描述行为（动词 + 名词，如 `fixOrphanBoneChain`）
- 参数列表不超过 4 个，超出考虑封装为对象
- 注释说明"为什么"而非"做什么"

---

## 7. 资源生命周期管理模式

### 问题
Three.js 资源（几何体、材质、纹理、渲染器）需要成对 dispose，遗漏会导致 GPU 内存泄漏。

### 解决方案
**分层清理契约 + cleanup-helper 三件套**：
1. **能力层 dispose**：`SkyCapability.dispose()`、`GroundCapability.dispose()`、`LightCapability.dispose()` 各自管理自己的资源。
2. **后处理层 dispose**：`EffectComposer.dispose()` 清理渲染目标和后处理 Pass。
3. **防御性遍历**：`disposeSceneMeshes()` 遍历场景图释放所有 Mesh 的 geometry/material。
4. **安全包装**：`safeDisposeRenderer()` 捕获 dispose 可能的异常（重复 dispose 场景）。

### 示例
- `mount-preview-core.ts`：分层清理链（skyCap/groundCap/lightCap/composer 逐一 dispose）
- `cleanup-helper.ts`：`disposeDebugGroup()` — 遍历 debugGroup 释放 Mesh/Line/Sprite
- `cleanup-helper.ts`：`disposeSceneMeshes()` — 通用场景图清理
- `cleanup-helper.ts`：`safeDisposeRenderer()` — 异常安全包装

### 适用场景
- 所有 Three.js 相关代码
- Web 应用的 GPU 资源管理
- 长生命周期应用的资源回收

### 清理顺序原则
1. 先清理业务对象（Mesh、Group）
2. 再清理控制器（OrbitControls）
3. 最后清理渲染器（WebGLRenderer）
4. 从内到外，避免悬空引用

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
**代际守卫 + aborted 标记**：
1. 模块级 `_gen` 计数器，每次 `mount3D` 调用自增。
2. 调用时捕获 `myGen = ++_gen`，后续异步回调检查 `myGen !== _gen` 则丢弃结果。
3. `aborted` 标记处理 ESC/手动关闭场景。
4. `isDisposed` 对象处理 dispose 后的防护。

### 示例
- `mount-preview-core.ts`：`let _gen = 0;`（模块级代际计数器）
- `mount-preview-core.ts`：`const myGen = ++_gen;`（调用时捕获当前代际）
- `mount-preview-core.ts`：`let aborted = false;`（ESC/手动关闭标记）
- `mount-preview-core.ts`：`if (aborted || myGen !== _gen) { fullCleanup(); return; }`（过期任务丢弃）
- `mount-preview-core.ts`：`if (aborted || isDisposed.v || myGen !== _gen) return;`（dispose 后防护）

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
- 审核子代理（d30590f0）：扫描 80+ 源文件，输出 P1-P4 分级报告。
- 主模型消化：按优先级批量修复 → 验证 → 提交。
- 验证门禁：501 测试全绿，vite build 通过，tsc --noEmit 0 错。

### 适用场景
- 多文件批量重构
- 代码健康度复查
- 跨模块一致性检查

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

---

## 参考提交

- `cf781437`：资源库路由改为注册表反向注入 + 去壳死导出
- `0b416054`：P2 修复 — composer/bloomPass 类型化 + fixOrphanBoneChain 抽取
- `e0065671`：P3 修复 — Vector3 复用 / 纹理缓存 / AbortController / toast

## 相关文件

- `frontend/src/preview-3d/render-loop.ts` — 渲染循环优化
- `frontend/src/preview-3d/debug-render.ts` — 纹理缓存
- `frontend/src/preview-3d/model-group-builder.ts` — 函数抽取
- `frontend/src/preview-3d/adapters/mount-preview-core.ts` — 类型收敛、并发防护、资源生命周期
- `frontend/src/views/app-preview/preview-library.ts` — 循环依赖破壁
- `frontend/src/views/app-preview/skeleton.ts` — AbortController、防御性编程
