---
kind: mount-preview-module-singleton-race
name: mount-preview-module-singleton-race
tier: leaf
category: utils
source_files:
  - frontend/src/preview-3d/adapters/mount-preview-core.ts
use_when:
  - 修 mount3D 并发竞态
  - 评审模块级单例守卫
---

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
