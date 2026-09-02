---
kind: utils-misc
name: 常量与调试 constants/debug
tier: architecture
category: utils
source_files:
  - frontend/src/utils/debug/debug.ts
tests:
  - frontend/src/preview-3d/debug-render.test.ts
  - frontend/src/utils/debug/debug.ring.test.ts
  - frontend/src/utils/debug/debug.test.ts
quick_groups:
  - 跨组件通信与页面
quick_intents:
  - 调试日志、dbg、调试开关
  - 环形日志、debugGetSpec、全局常量
quick_risk_lines:
  - 调试日志必须走 debug.ts 的 dbg 工具，禁止 console.log 散落在业务代码
pitfalls:
  - console.log 散落 → 无法按 tag 过滤、生产环境泄漏日志；必须经 dbg
  - 环形缓冲区未限制大小 → 内存累积；必须经环形缓冲的 max 限制

use_when:
  - 调试日志
  - dbg
  - 调试开关
  - 环形日志
  - debugGetSpec
  - 全局常量
invariant_anchors:
  - frontend/src/utils/debug/debug.ts|dbg
  - frontend/src/utils/debug/debug.ts|safeStr
status: active
---

# 常量与调试 constants/debug

## 概览

前端调试基础设施：`debug.ts` 提供带 tag 过滤与环形缓冲的调试日志工具。原 `constants.ts`（预览画布/缩放/下载守护等全局数值常量）因长期无消费方已在死代码清理中移除，本卡同时承接「常量治理」的约定说明。

## 核心职责

- 调试日志输出（console + 最近 200 条环形缓冲复盘）、URL/localStorage 开关、控制台调试助手
- 魔法数值治理约定（常量收编原则）

## 对外 API / 入口

`debug.ts`：
- `dbg(tag: string, ...args: unknown[]): void` — `[DBG:tag]` 前缀 console.log，并写入 `window._DBG_RING` 环形缓冲（上限 200 条）；URL `?nodebug=1` 或 localStorage `_debug=0` 时静默
- `window._DBG_RING` — 最近 200 条日志复盘入口（含时间/tag/level/截断后的参数）
- `window.debugGetSpec(path?)` — 控制台调试助手：动态 import `GetModel3DSpec` binding 取 Go 3D spec 骨骼数据

常量治理（原 constants.ts 移除后的约定）：
- 历史常量域：预览画布尺寸（180/600/60）、缩放范围（0.2-10）、旋转增量（0.5 度/像素）、下载守护时延（STUCK_GUARD_DELAY=2000，对应致命陷阱 #6）、日志上限（500）等
- 新增魔法数值优先在使用它的模块内定义具名常量；跨模块共享的数值再考虑集中文件，避免重新积累死常量

## 与其他子系统关系

- `dbg` 消费方众多：`app-tree`（index / toolbar-events / render）、`app-sidebar`（index / loader）、`app-sync-manager/index.ts`、`app-content/index.ts`、`app-content/community-data.ts`、`app-content/site/events.ts`、`features/community/download-queue.ts`、`core/handlers/sync.ts`、`utils/model2d.ts`
- `window.debugGetSpec` 依赖 [wails_bindings](./wails-bindings.md) 的 GetModel3DSpec
- 下载卡死守护语义对应 AGENTS.md 致命陷阱 #6

## 不变量

- **调试代码用完即删**（frontend/AGENTS.md）：dbg 调用属临时排查手段，提交前应清除；生产环境无控制台，用户反馈问题依赖桌面 `ysm-debug.log` 日志文件（见 `docs/guide/用户指南.md`）。**现状与约定冲突**（P3 观察 2026-08-09）：9+ 模块仍残留大量 `dbg()` 调用（core/handlers/sync、features/community/download-queue、utils/model2d、app-content、app-sidebar、app-sync-manager、app-tree 等），持续占用环形缓冲——需产品层决策「清理残留」或「分层持久日志 vs 临时排查」
- dbg 必须带 tag 便于过滤；参数经内部 safeStr 截断（200 字符）防大对象撑爆环形缓冲，**Error 分支同样截断**（P3 修复：原直接返回 v.message 可突破上限）；**`JSON.stringify` 返回 undefined（函数/symbol）时走 String 兜底**（P3 修复：原直接 `.length` 为 strict 下 TS2532，运行时靠 catch 兜底）
- `window._DBG_RING` / `window.debugGetSpec` 属调试豁免接口，不是 `window.__*` 状态红线（不存页面状态）
- 环形缓冲**一次性截断**到 200 条上限（P3 修复：原 `shift()` 单条收敛，外部预置超量时长期无法回归）
- **`?nodebug=1` 开关语义**（P4 观察）：实现为 `URLSearchParams.has("nodebug")` 存在即关闭——`?nodebug=0` 也会关闭，与文档「=1」语义不符；`RingEntry.level` 为幽灵字段（声明存在但 dbg 永不写入）

## 相关

- [model3d](./model3d.md) — debugGetSpec 排查对象（3D spec）
- [wails_bindings](./wails-bindings.md) — GetModel3DSpec
- AGENTS.md 致命陷阱 §二 #6（下载 99% 卡死）
