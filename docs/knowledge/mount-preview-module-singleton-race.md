---
kind: mount-preview-module-singleton-race
name: mount3D 并发竞态（已闭环 — _gen 代际守卫）
tier: leaf
category: rendering
source_files:
  - frontend/src/preview-3d/adapters/mount-preview-core.ts
quick_groups:
  - 3D 预览与模型追加
quick_intents:
  - mount3D 并发竞态、模块级单例守卫
  - _singletonOverlay / _singletonScene / _singletonRenderer
quick_risk_lines:
  - ✅ _gen 代际守卫已落地（L164 声明 / L271 自增 / L681·L706·L862 三处守卫），历史竞态已消除
pitfalls:
  - ❌ 已闭环：_gen 代际守卫 + finishSession 幂等 = 多并发安全
  - ⚠️ 残留：7 个单例全局仍手动清零，若未来引入 async 创建需重新评估
use_when:
  - mount3D 并发竞态（已闭环）
  - 评审模块级单例守卫（历史）
perf:
  - concurrent
status: archived
last_verified: 2026-08-27
---

# mount3D 并发竞态（已闭环 — _gen 代际守卫）

> **状态：已闭环**。历史竞态问题（多 mount3D 并发时单例创建竞态窗口）已通过 `_gen` 代际守卫消除。此卡保留作历史参考与回归防线。

## 概览

**已闭环**。`mount-preview-core.ts:164` 声明模块级 `let _gen = 0`，`mount3D` 入口（L271）`const myGen = ++_gen` 捕获本次挂载的代数。此后三处 `await` 后守卫（L681 / L706 / L862）检查 `myGen !== _gen`，发现代数已被后续 mount3D 覆盖则静默返回——**旧会话的迟到结果不会覆盖新会话**。

## 已落地的并发守卫

- **`_gen` 代际计数器**（L164）：模块级，`cleanupPreview`/`invalidatePreview` 各 `++_gen`
- **`myGen = ++_gen`**（L271）：每次 mount3D 入口捕获本次代数
- **守卫 1**（L681）：`await adapter.build()` 后，`if (myGen !== _gen) return` ——加载期间用户已切其他模型则弃旧
- **守卫 2**（L706）：build 完成后 `if (session.aborted.v || myGen !== _gen)` ——加载期间被 ESC/invalidate 打断则 fullCleanup 弃旧
- **守卫 3**（L862）：catch 块 `if (session.aborted.v || myGen !== _gen) return` ——迟到失败不弹错
- **`finishSession` 幂等**（L452-465）：`session.finished` 标记保证「摘句柄 + 通知调用方 + 焦点归还」只发生一次
- **`_handles` 按 gen 索引**（L456）：`_handles.findIndex(h => h.gen === myGen)` 精准定位当前会话句柄

## 单例外壳复用（非问题，设计特征）

七个模块级单例（`_singletonOverlay` / `_singletonBody` / `_singletonViewContainer` / `_singletonScene` / `_singletonCamera` / `_singletonRenderer` / `_singletonControls`）首次创建、后续复用。**在 JS 单线程模型下，单例创建本身无竞态**——`_gen` 守卫处理的是异步挂载重叠场景。

## 与其他子系统关系

- `mpBuildSharedInfra`（L987-1090）复用四个单例（scene/camera/renderer/controls）
- `fullCleanup`（mount3D 内 L771-832）统一释放内容层 + 句柄 + 菜单 + rAF，原 cleanup-3d.ts 僵尸实现已删除
- `switch-preview.ts`（`switchToSession`）复用外壳切换模型，不重新 mount

## 不变量

- 单例外壳「首次创建、后续复用」语义。
- `_gen` 代际守卫 = 多挂载并发安全的核心机制。
- `finishSession` 幂等 = closeOverlay 早期路径与 fullCleanup 共用同一出口。

## 相关

- 兄弟卡：`mount3d-584-giant`（同文件，mount3D 巨函数现状——已部分拆分）
- 统一核心：`preview_core`（ADR-066 D2 统一外壳）

# mount-preview-module-singleton-race

## 概览

`mount-preview-core.ts:155-170` 模块级 `let _singletonOverlay/_singletonBody/_singletonViewContainer/_singletonScene/_singletonCamera/_singletonRenderer/_singletonControls` 七个可变全局 + `_handles`/`_globalAnimId`/`_globalPerFrames` 三个可变全局。`cleanupPreview` L188-194 手动清零，但**无并发守卫**——多 mount3D 并发时单例创建有竞态窗口。

## 核心职责

3D 预览单例外壳复用：首次 mount3D 创建 DOM/renderer/scene/camera/controls，后续复用避免重建黑屏。

## 对外 API / 入口

- `mount3D()` 内 L294 `if (!overlay)` 与 L303 `_singletonOverlay = overlay` 之间若两次 mount3D 同时进入，会创建两个 overlay 但只保留一个引用，另一个 DOM 孤儿。
- `cleanupPreview()` L188-194 手动清零 7 个单例。
- `_resetSingletons()` L198-208 测试用重置。

## 与其他子系统关系

- `mpBuildSharedInfra` L905-1002 复用 `_singletonScene/_singletonCamera/_singletonRenderer/_singletonControls` 四个单例。
- `fullCleanup`（mount-preview-core.ts 内联）在会话清理时统一释放内容层 + 能力 + 监听（原 cleanup-3d.ts 的 `runFullCleanup`/`CleanupContext` 僵尸实现已删除）。

## 不变量

- 单例外壳「首次创建、后续复用」语义。
- `cleanupPreview` 必须清零所有单例，否则下次 mount3D 复用已脱离文档的 detached element。

## 问题清单（ts-package-review 2026-08-27）

1. **R1 变体**：10 个模块级 `let` 单例/全局，无并发守卫。
2. **竞态窗口**：`if (!overlay) { overlay = document.createElement(...); _singletonOverlay = overlay; }` 之间若两次 mount3D 同时进入，第二次也看到 `_singletonOverlay === null`，创建第二个 overlay，第一个 DOM 孤儿。
3. **实际风险**：WSM 桌面端单线程 JS，用户连续点击触发 mount3D 的窗口期极短，但 e2e 测试或快速双击可触发。

## 建议动作

1. 单例创建加并发守卫：`let _creatingOverlay = false` 显式锁，或 `queueMicrotask` 串行化。
2. 或：单例创建用 `if (!_singletonOverlay) { _singletonOverlay = create(); }` 原子赋值（JS 单线程下 `if` 内无 await 即安全，但 `mount3D` 是 async，`if` 内可能有 await）。
3. 终极方案：单例外壳改用 `WeakRef` + `registry.register`，GC 时自动清零，但改造成本高。

## 相关

- 兄弟卡：`mount3D-584-giant`（同文件，拆 mount3D 巨函数时一并处理单例守卫）
- ADR-066 P3（收缴 vrm/litematic 复制脚手架，单例外壳复用的设计源头）
