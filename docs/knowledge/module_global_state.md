---
kind: module_global_state
name: 模块级全局状态治理
tier: leaf
category: ui
source_files:
  - frontend/src/features/dialogs/modal.ts
  - frontend/src/core/i18n/locale.ts
  - frontend/src/backend/web-store.ts
  - frontend/src/utils/cache/with-cached.ts
auto_fields:
  symbols_with_lines:
    - __resetModalStateForTest
    - __resetWebLogStateForTest
    - CachePolicy
    - clearAllCache
    - closeActiveDialog
    - closeDlg
    - fmtMB
    - getBundle
    - getCacheTtlMs
    - getLang
    - initI18n
    - invalidateCache
    - LangCode
    - loadLocale
    - modalConfirm
    - ModalConfirmOptions
    - modalPicker
    - ModalPickerItem
    - ModalPickerOptions
    - ModalPickerResult
    - modalProgress
    - ModalProgressHandle
    - ModalProgressOptions
    - modalPrompt
    - ModalPromptOptions
    - modalSelect
    - ModalSelectOptions
    - registerDlg
    - setLang
    - SUPPORTED_LANGS
    - trapFocus
    - VIEW_TESTIDS
    - warnedKeys
    - webStoreBindings
    - withCached
use_when:
  - 模块级全局状态
  - 全局 Map 泛滥
  - reset 测试钩子
  - 单例收敛
pitfalls:
  - 模块级状态收敛前先查测试隔离策略——用 vi.resetModules 重载的模块（locale.ts）收敛无测试收益，只有代码组织价值
  - 引用相等分派（ring === webImportLogs）是隐式建模信号——收敛成显式对象能消灭，但改动面大需评估 ROI
  - 收敛只改内部表示不动导出函数签名（modal 范式）——外部/测试零改动是「试点成功」判据
  - 模块级 let busy 锁必须有 reset 路径或注释豁免理由（dedup.ts 案例：tab 卸载后 busy 卡 true → 再进永久卡死）
quick_groups:
  - 状态管理
quick_intents:
  - 全局 Map / 模块级 let 何时收敛成对象
  - 测试污染 reset 钩子怎么处理
quick_risk_lines:
  - 模块级状态收敛 = 状态收进闭包/类对象 + 导出函数签名不变；不改消费方
  - 判断标准：reset 钩子依赖（有 → 收敛有测试收益）vs resetModules 重载（无 → 收敛仅为组织价值）
invariant_anchors:
  - frontend/src/features/dialogs/modal.ts|createModalSlot
---

# 模块级全局状态治理

## 概览

2026-09-04 锐评续刀 + ADR-178 期间对「模块级全局状态」的系统评估：modal 单例槽位试点收敛成功（`ModalSlotState`），locale/web-store 查证后**停止推广**（无净收益）。本卡沉淀判断标准，避免下次重复评估。

## 核心职责

模块级全局状态（7+ 处：`_cache`/`_pending`/`_handles`/`_globalPerFrames`/`_services`/`_controls`/`_currentPage` 等）是「无类、无实例架构」的直接产物。治理判断分两档：

1. **收敛成对象**（modal 范式）：状态收进工厂返回的对象（`createModalSlot()`），**导出函数签名不变**，外部与测试零改动。适用：reset 钩子依赖（`__resetModalStateForTest`）——收敛让「重置语言状态」成为单一操作。
2. **保留模块级**：当测试已用 `vi.resetModules()` 重载（locale.ts——每用例重载模块，不靠 reset 钩子），收敛只有代码组织价值，ROI 低。

## 对外 API / 入口

- modal 收敛范式：`frontend/src/features/dialogs/modal.ts` `createModalSlot()` → `_slot` 单例 → `__resetModalStateForTest()` 内部调 `_slot` 字段重置
- locale.ts 测试策略：`locale.test.ts` `freshModule()` = `vi.resetModules()` + 动态 import（bus 必须同实例重载）

## 与其他子系统关系

- 全局 Map 泛滥 ↔ `__resetXxxForTest` 导出（4 个生产文件：web-store/idb/modal/mount-preview-core）
- 代际守卫（`_gen`/`_langReqGen`）是「请求过期丢弃」模式——3 种语义形态（模块计数/跨模块共享/类字段），不抽统一抽象（为抽象而抽象）

## 不变量

- 收敛只改内部表示，导出函数签名不变（modal 判据：54 测试零改动通过）
- 判断标准：reset 钩子依赖（有 → 收敛有测试收益）vs resetModules 重载（无 → 仅组织价值）
- 引用相等分派是隐式建模信号（web-store `logKeyOf(ring)`），但收敛改动面 ~30 处，需先评估 ROI

## 相关

- [dialog-modal](dialog-modal.md)：modal 槽位收敛体细节
- [frontend_design_critique](frontend_design_critique.md)：全局 Map 泛滥指控源
