# ADR-227：preview-3d 模块级单例收敛为实例（P1 战役）

- **状态**：🔄 部分采纳（Partial）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-11
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`frontend/src/preview-3d/adapters/render-host.ts`；兄弟会话 A1(`625958fb8`) `createPerceptionPauseRef`；架构锐评 P1；方案 A（PreviewSession 类化）

---

## 1. 背景（Context）

preview-3d 运行态长期依赖大量**模块级可变单例**。架构锐评（P1）盘点出 4 个文件约 15 处：

- `mount-preview-core.ts`：`_gen` / `_singletonOverlay` / `_singletonBody` / `_singletonViewContainer` / `_handles[]`
- `shared-infra.ts`：`_singletonScene` / `_singletonCamera` / `_singletonRenderer` / `_singletonControls` / `_sceneCaps[]`
- `render-loop.ts`：`_globalAnimId` / `_globalPerFrames[]` / `_activeInputSession` / `_liveInputSessions[]`
- `scene-registry.ts` / `scene-capability-registry.ts`：`export const` 模块级注册表

P1 判定这是最严重结构病：① 不可能存在两个独立 3D 预览实例；② 测试隔离靠 `_resetSingletons()` 手动调用，漏调即串用例；③ 多会话共存（coop）完全靠手写簿记维护（gen-scoped handles、live session 晋升、幂等 `finishSession`）。

兄弟会话已在感知子系统先行落地同一战役的先例：删除全局 `_globalPause` 单例，改为 `createPerceptionPauseRef()` 工厂 + **必选构造参数**，每个 controller 自查 `ref.paused`（commit `625958fb8`，A1）。本 ADR 将该临时修复升格为 preview-3d 的联邦正式约定。

## 2. 决策（Decision）

采用 **「模块级单例 → 实例 / 必选参数」增量收敛范式**，与兄弟 A1 同一步伐、同一步调：

1. **约束边界先判定**——WebGLRenderer 受浏览器 WebGL context 数量硬约束（通常 ≤16）必须唯一，单一 rAF loop 天然合理。故**渲染宿主允许为单例实例**，但内部 `perFrame` / 活跃输入会话等状态须收为实例字段。
2. **最终目标**：把 `mount-preview-core` / `shared-infra` / `mount-session` 的运行态进一步收敛为 `PreviewSession` 类实例（方案 A）——renderer 保持模块级唯一，scene/camera/controls/overlay/handles/perFrame 全部实例字段。
3. **护栏**：新增任何「模块级单例状态」前，须先论证为何不可改为实例字段或必选参数；能实例化的不留在模块级。**例外须在代码注释或知识卡中写明硬约束依据**（如 renderer 唯一、`_sceneCaps` 每 build 重指派）——无依据的模块级 `let` 视为违规。

## 3. 后果（Consequences）

**正面**
- 运行态不再靠模块级全局变量撑着，多会话共存的手写簿记可由实例生命周期替代。
- 外部 API 兼容：收敛以「具名门面函数 / host 实例 + 签名零变更」方式进行，外部消费方（`views/app-preview/` 5 个入口函数 + `sceneRegistry`）不需感知内部搬移。
- 测试隔离改善：host 实例天然隔离，`_resetSingletons()` 仅降为兼容壳。测试缝（如会话序号重置）以显式方法暴露，语义不变。
- 未来多窗口 / 嵌入式 3D 预览可行（各自持 host / session 引用）。

**负面 / 已知遗留**
- 受硬约束的状态**保留单例**：renderer（WebGL context 数量上限）、单一 rAF loop、单一全屏 overlay；此类单例须在注释写明依据。
- `_sceneCaps` 为「每 build 重建并实时重指派」的共享全局，抽成实例反而破坏 rebuild 可见性，故例外保留。
- 阵列/代际类状态（如存活句柄表、代际计数器）的「实例化」收益弱于真·资源类状态——其收益主要在命名、文档化与未来子系统整体实例化，而非当前多实例能力。

## 4. 数据溯源

- 架构锐评 P1 → 识别 4 文件 ~15 处模块级单例，判定为最严重结构病。
- 兄弟会话 A1 (`625958fb8`) → `createPerceptionPauseRef` 工厂 + 必选参数范式先例（感知子系统）。
- 约束边界依据：Three.js 官方「单 renderer 多 scene」推荐模式；浏览器 WebGL context 数量上限。
- 实施进度与逐项落点见知识卡：`docs/knowledge/mount-preview-module-singleton-race.md`、`docs/knowledge/3d-patterns.md`（§10 并发防护模式）、`docs/knowledge/mount3d-584-giant.md`。
