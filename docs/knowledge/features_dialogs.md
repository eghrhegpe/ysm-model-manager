---
kind: features_dialogs
name: 业务对话框 features/dialogs(批量重命名/标签编辑/高级筛选)
tier: architecture
category: ui
source_files:
  - frontend/src/features/dialogs/rename.ts
  - frontend/src/features/dialogs/tag-editor.ts
  - frontend/src/features/dialogs/adv-filter.ts
  - frontend/src/features/dialogs/batch-rename.ts
  - frontend/src/features/dialogs/modal.ts
tests:
  - frontend/src/features/dialogs/adv-filter-util.test.ts
  - frontend/src/features/dialogs/adv-filter.test.ts
  - frontend/src/features/dialogs/batch-rename-util.test.ts
  - frontend/src/features/dialogs/batch-rename.test.ts
  - frontend/src/features/dialogs/modal.test.ts
  - frontend/src/features/dialogs/rename-format.test.ts
  - frontend/src/features/dialogs/rename.test.ts
  - frontend/src/features/dialogs/tag-editor.test.ts
auto_fields:
  symbols_with_lines:
    - __resetModalStateForTest
    - AdvFilterResult
    - AdvFilterValue
    - BatchRenameChange
    - closeActiveDialog
    - closeDlg
    - fmtMB
    - modalAdvFilter
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
    - modalTagEditor
    - registerDlg
    - showBatchRenameDialog
    - showRenameDialog
    - trapFocus
    - VIEW_TESTIDS
use_when:
  - 批量重命名 / 标签编辑 / 高级筛选对话框
  - 找对话框入口符号
quick_groups:
  - 业务对话框
quick_intents:
  - 批量重命名实现 / 标签编辑器定位 / 高级筛选弹窗
quick_risk_lines:
  - features/dialogs 是业务 UI,勿被调回 utils/dom(分类事故复发)
  - dialogs 各文件内部引用深度以 features/dialogs 为基准,vi.mock 路径须同步
  - modal.ts VIEW_TESTIDS 增删 data-testid 须同步本数组(ADR-133 阶段 B 契约测试静态聚合)
  - rename.ts 路径变更时需同步 vi.mock 字符串路径(ADR-170 实测教训:非 import 语句正则扫不到)
  - batch-rename.ts stagger 动画依赖 animation/stagger.ts,改路径须保持同簇引用
  - adv-filter.ts 后端约束:Go SearchModels 仅支持 6 范围 +1 关键字,前端不呈现其他控件(代码注释已注明)
pitfalls:
  - 目录层级变动后,vi.mock 字符串路径与 import 同步重算(ADR-170 实测:非 import 语句正则扫不到 mock 路径变更)
  - modal.ts VIEW_TESTIDS 是契约测试静态聚合的单一事实源,增删 data-testid 必须同步本数组,否则契约测试静默漏检
  - tag-editor.ts 标签建议列表未做去重,上游标签集含重复时 UI 会渲染重复条目(已知限制,非 bug)
  - batch-rename.ts 批量改名失败时 TOAST_MS 显示错误但 bus 未 emit tree:reload,需手动触发刷新
  - adv-filter.ts keyword 字段 trim 后为空串时 Go 侧视为无关键字过滤(非报错,静默降级)
invariant_anchors:
  - frontend/src/features/dialogs/rename.ts|showRenameDialog
---

# 业务对话框 features/dialogs(批量重命名/标签编辑/高级筛选)

## 概览

`frontend/src/features/dialogs/`：业务对话框目录，自 `utils/dom/dialogs/` 升格（ADR-170 第一段）。批量重命名、标签编辑器、高级筛选、通用 modal 底座九对源+测试在此归位——它们本是完整业务功能，不再误住 utils 叶子层。

## 核心职责

| 文件 | 职责 |
|---|---|
| modal.ts | 通用对话框底座（trapFocus/closeDlg/registerDlg/modalConfirm/modalPicker） |
| rename.ts + rename-format.ts | 重命名对话框 + 文件名拼接/校验纯逻辑 |
| batch-rename.ts + batch-rename-util.ts | 批量重命名 + 解析名重建纯逻辑 |
| tag-editor.ts + tag-set.ts | 标签编辑器 + 标签集合运算 |
| adv-filter.ts + adv-filter-util.ts | 高级筛选 + 校验纯逻辑 |

纯逻辑（*-util/format/set）与 UI 分离，供单测覆盖（ADR-023 传统）。

## 对外 API / 入口

顶层导出即入口：`showRenameDialog` / `showBatchRenameDialog` / `modalTagEditor` / `modalAdvFilter` / `modalConfirm` 等。消费方：core/context-menu 族、features/recycle-bin、views/app-tree（bus-handlers/toolbar-search）等 12 生产 + 10 测试。

## 与其他子系统关系

- 桥依赖：adv-filter/rename/tag-editor 经 `getApp` 调 backend（业务正确调桥，非穿透）。
- i18n：核心文案走 `core/i18n/t.ts`。
- modal.ts 是共享底座，被 core/features/views 测试 vi.mock 拦截。

## 不变量

- 本目录文件引用 src 下其他层用 `../../` 起（features/dialogs → src 两级）；**改动目录层级时 vi.mock 字符串路径须与 import 同步重算**（ADR-170 实测教训：非 import 语句正则扫不到）。
- 不反向迁回 utils/dom（分类事故复发）。

## 相关

- ADR-170（dialogs 升格 features,二段式第一段）
- ADR-023（纯逻辑抽 util 供单测）
