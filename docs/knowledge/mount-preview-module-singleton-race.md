---
kind: mount-preview-module-singleton-race
name: mount3D 并发竞态（已闭环 — _gen 代际守卫）
tier: leaf
category: rendering
source_files:
  - frontend/src/preview-3d/adapters/mount-preview-core.ts
auto_fields:
  symbols_with_lines:
    - _resetSingletons
    - cleanupPreview
    - hasActivePreview
    - invalidatePreview
    - mount3D
    - Mount3DOptions
    - PreviewAdapter
    - PreviewBuildCtx
    - PreviewHandle
    - PreviewScene
    - switchPreview
quick_groups:
  - 3D 预览与模型追加
quick_intents:
  - mount3D 并发竞态、模块级单例守卫
  - previewShell / sceneInfraHost / rendererHost（ADR-227 收敛后）
quick_risk_lines:
  - ✅ _gen 代际守卫已落地（原模块级声明/自增/三处守卫已随 ADR-227 收敛至 sessionLedger.gen() / beginSession()），历史竞态已消除
pitfalls:
  - ❌ 已闭环：_gen 代际守卫 + finishSession 幂等 = 多并发安全
  - ✅ 已收敛：模块级单例整体经 ADR-227 收为 host 实例字段（PreviewShellHost / SceneInfraHost / RendererHost / SessionLedgerHost），不再散落模块级 let
use_when:
  - mount3D 并发竞态（已闭环）
  - 评审模块级单例守卫（历史）
perf:
  - concurrent
status: archived
affected: false
last_verified: 2026-09-11
---

# mount3D 并发竞态（已闭环 — _gen 代际守卫）

> **状态：已闭环**。历史竞态问题（多 mount3D 并发时单例创建竞态窗口）已通过代际守卫消除。此卡保留作历史参考与回归防线。**行号基准已失效**（原文以闭包内嵌阶段布局为准）：守卫逻辑现外置于 `mount-session.ts` / `switch-preview.ts`，代际计数收敛于 `session-ledger.ts`——查 `sessionLedger.gen()` / `beginSession()` 而非旧 `_gen` 行号。

## 概览

**已闭环**。代际计数器（原 `mount-preview-core.ts` 模块级 `let _gen = 0`，ADR-227 后为 `session-ledger.ts` 的 `sessionLedger` 实例字段）在 `mount3D` 入口经 `sessionLedger.beginSession()` 分配本次挂载代数（返回 `gen`，即原 `myGen = ++_gen`）。此后三处 `await` 后守卫检查 `ctx.myGen !== ctx.getGen()`，发现代数已被后续 mount3D 覆盖则静默返回——**旧会话的迟到结果不会覆盖新会话**。

## 已落地的并发守卫

- **代际计数器**：原 `mount-preview-core.ts` 模块级 `let _gen`，现 `session-ledger.ts` 的 `sessionLedger`（`beginSession()` 分配 / `invalidate()` 推进 / `gen()` 读当前值）——`cleanupPreview` 与 `invalidatePreview` 均调 `invalidate()`
- **`beginSession()`**：每次 mount3D 入口分配 `{ gen, sessionId }`（取代 `++_gen` + `++_mountSessionSeq`）
- **守卫 1**：`await adapter.build()` 后，`if (ctx.myGen !== ctx.getGen()) return` ——加载期间用户已切其他模型则弃旧
- **守卫 2**：build 完成后 `if (ctx.aborted.v || ctx.myGen !== ctx.getGen())` ——加载期间被 ESC/invalidate 打断则 fullCleanup 弃旧
- **守卫 3**：catch 块 `if (ctx.aborted.v || ctx.isDisposed.v || ctx.myGen !== ctx.getGen()) return` ——迟到失败不弹错
- **`finishSession` 幂等**（`mount-session.ts`）：`session.finished` 标记保证「摘句柄 + 通知调用方 + 焦点归还」只发生一次
- **存活句柄表按 gen 索引**（`mount-session.ts` 经 `ctx.handles` 消费台账表）：`handles.findIndex(h => h.gen === ctx.myGen)` 精准定位当前会话句柄（见 `ownHandle` / `removeOwnHandle`）

## 单例外壳复用（非问题，设计特征）

外壳/场景状态首次创建、后续复用。**在 JS 单线程模型下，单例创建本身无竞态**——代际守卫处理的是异步挂载重叠场景。

> **ADR-227（2026-09-11）**：原模块级 `let` 单例已收敛为四类 host 实例字段——
> `PreviewShellHost`（`previewShell`：overlay/body/viewContainer + mpc 样式，`preview-shell.ts`）、
> `SceneInfraHost`（`sceneInfraHost`：scene/camera/renderer/controls/caps，`shared-infra.ts`）、
> `RendererHost`（`rendererHost`：rAF loop/perFrame/活跃输入会话，`render-host.ts`）、
> `SessionLedgerHost`（`sessionLedger`：代际 / 会话序号 / 存活句柄表，`session-ledger.ts`）。
> 「单 WebGL context」硬约束不变：**renderer 跨 session 复用**（`reset` 不再置 null，旧实现每次开关泄漏一个 context）；scene/camera/controls 由 `reset` 每 session 重建——`controls.dispose()` 摘掉绑在常驻 canvas 上的监听器、`camera` 置 null 后由各适配器 `fitCameraToScene` / `fitCameraToRoots` 重新取景。状态不再散落模块级全局，`_resetSingletons` 降为 host 的 reset 门面。

## 与其他子系统关系

- `buildSharedInfra`（已外置 `shared-infra.ts`）**只复用 `renderer` 一个单例**（唯一 WebGL context，ADR-227）；`scene`/`camera`/`controls` 每 session 重建，经 `sceneInfraHost` 实例字段持有
- `runFullCleanup`（已外置 `mount-session.ts`，旧行号 mount3D 内 L771-832）统一释放内容层 + 句柄 + 菜单 + rAF，原 cleanup-3d.ts 僵尸实现已删除
- `switch-preview.ts`（`switchToSession`）复用外壳切换模型，不重新 mount

## 不变量

- 单例外壳「首次创建、后续复用」语义。
- 代际守卫（`sessionLedger.gen()` 比对）= 多挂载并发安全的核心机制。
- `finishSession` 幂等 = closeOverlay 早期路径与 fullCleanup 共用同一出口。

## 相关

- 兄弟卡：`mount3d-584-giant`（同文件，mount3D 巨函数现状——已部分拆分）
- 统一核心：`preview_core`（ADR-066 D2 统一外壳）
