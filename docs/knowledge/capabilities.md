---
kind: capabilities
name: 能力门控 capabilities
tier: leaf
category: utils
source_files:
  - frontend/src/utils/dom/capabilities.ts
  - frontend/src/backend/platform-web.ts
auto_fields:
  symbols_with_lines:
    - ANDROID_UNAVAILABLE
    - can
    - canBinding
    - canWebAction
    - isViewerPlatform
    - isWebPlatform
    - PlatformMode
    - resolvePlatformMode
    - VIEWER_PURE_ACTIONS
    - VIEWER_WEB_ACTION_BINDINGS
quick_groups:
  - 能力门控与平台判定
quick_intents:
  - can binding 可用性
  - canWebAction viewer 模式右键菜单
  - VIEWER_PURE_ACTIONS 纯前端动作
  - VIEWER_WEB_ACTION_BINDINGS web 可达 action
pitfalls:
  - 消费方禁止重复实现 can(binding) 三态矩阵——统一走 can()，platform-web.ts 的 canBinding() 是唯一判定源
  - VIEWER_WEB_ACTION_BINDINGS 仅声明「哪些 action 在 web 上可达」；can() 三态判定逻辑不重复
  - VIEWER_PURE_ACTIONS 纯前端恒可达（DOM/剪贴板/下载已下沉 utils/dom），不依赖 can()
use_when:
  - can binding 门控
  - viewer 模式右键菜单过滤
  - web 可达性判定
  - 平台能力矩阵
status: active
---

# 能力门控 capabilities

## 概览

前端能力门控唯一对外入口。`can(binding)` 将「当前平台是否可用指定 binding」的三态判定（desktop 全量 / web adapter has / Android 黑名单）委托给 `backend/platform-web.ts` 的 `canBinding()` 三态矩阵；`canWebAction()` 在此基础上叠加 viewer/web 模式右键菜单的 action 可达性判定（`VIEWER_PURE_ACTIONS` 纯前端恒可达 + `VIEWER_WEB_ACTION_BINDINGS` 走 `can()` 探测）。

ADR-071 后判定逻辑收拢至 `canBinding()`，`utils/dom/capabilities.ts` 保留对外 API 与消费方清单注释——消费方（app-nav/app-tree/context-menus 等）零改动。

## 核心职责

- **`can(binding: string): boolean`** — 绑定级门控，唯一对外入口；所有「该 binding 当前平台是否可用」的判定统一走它，禁止各消费方重复实现三态矩阵。
- **`canWebAction(action: string): boolean`** — viewer/web 模式右键菜单 action 可达性：先查 `VIEWER_PURE_ACTIONS`（纯前端恒可达），再查 `VIEWER_WEB_ACTION_BINDINGS[action]` 走 `can()` 探测。
- **`VIEWER_WEB_ACTION_BINDINGS`** — viewer 模式 action → binding 需求映射表（`file.rename`/`file.move`/`file.copy`/`batch.move`/`batch.copy`/`dir.batch-rename`/`file.edit-tags`）；新增 web 可达 action 只改此表。
- **`VIEWER_PURE_ACTIONS`** — 纯前端动作集（`noop`/`batch.copy-paths`/`batch.export-list`/`file.copy-path`），不调 Wails binding，viewer 模式恒可达。

## 对外 API / 入口

- `can(binding: string): boolean` — 绑定级门控（app-nav `ListVersionInstances` 判定 viewer 模式、app-tree `ToggleEnable`/`DeleteResourcePack` 门控、diagnostics `ClearImportLogs` 门控等）
- `canWebAction(action: string): boolean` — viewer/web 模式右键 action 可达性（context-menus.ts 消费）
- `VIEWER_WEB_ACTION_BINDINGS: Readonly<Record<string, string>>` — action → binding 映射表
- `VIEWER_PURE_ACTIONS: ReadonlySet<string>` — 纯前端动作集

## 与其他子系统关系

- **`backend/platform-web.ts` `canBinding()`** — 三态能力矩阵唯一实现源（desktop 全量 / web adapter has / Android 黑名单）；`can()` 是其纯委托。
- **`core/context-menus.ts`** — 右键菜单 viewer 模式全局过滤消费 `canWebAction()`。
- **`views/app-nav/index.ts`** — `can("ListVersionInstances")` 判定 viewer 模式（导航栏切换器门控）。
- **`views/app-tree/bus-handlers.ts` / `events.ts` / `index.ts`** — `can("ToggleEnable")` / `can("DeleteResourcePack")` 树操作门控。
- **`views/app-content/diagnostics/init.ts`** — `can("ClearImportLogs")` 诊断操作门控。

## 不变量

- **canBinding() 唯一事实源**：禁止任何消费方绕过 `can()` 直接探测平台或重写三态矩阵。
- **VIEWER_WEB_ACTION_BINDINGS 不重复 can() 逻辑**：仅声明「哪些 action 在 web 上可达」，判定统一走 `canWebAction()`。
- **纯前端动作恒可达**：`VIEWER_PURE_ACTIONS` 不依赖 `can()`，任何平台/模式都可达。
- **新增消费方前核对语义**：`can()` 语义为「该 binding 当前平台是否可用」，勿误作查看器模式判定（查看器模式用 `can("ListVersionInstances")` 或 `resolveWebMode()`）。

## 相关

- `docs/knowledge/android-bridge.md`（Android 黑名单门控）
- `docs/knowledge/wails-bridge.md`（binding 桥接）
