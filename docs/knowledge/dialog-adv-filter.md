---
kind: dialog-adv-filter
name: 高级筛选 adv-filter
tier: architecture
category: ui
source_files:
  - frontend/src/utils/dom/dialogs/adv-filter.ts
  - frontend/src/utils/dom/dialogs/adv-filter-util.ts
auto_fields:
  symbols_with_lines:
    - AdvFilterResult:19
    - AdvFilterValue:7
    - modalAdvFilter:181
    - parseFilterNumber:22
    - validateAdvFilter:33
  tests:
    - frontend/src/utils/dom/dialogs/adv-filter-util.test.ts
    - frontend/src/utils/dom/dialogs/adv-filter.test.ts
  quick_groups:
    - UI 交互与弹窗
  quick_intents:
    - 高级筛选、骨骼数 / 立方体 / 纹理尺寸数值范围
    - 按标签筛选、条件过滤
    - modalAdvFilter
  quick_risk_lines:
    - adv-filter 弹窗必须复用 modal.ts 的 Promise API，禁止手写弹窗 DOM
  pitfalls:
    - 手写 adv-filter 弹窗 DOM → 与全局弹窗样式 / 焦点陷阱不一致；必须复用 modal.ts 的 registerDlg
    - adv-filter 输入不校验就提交 → min > max 传后端报错；必须在 validate() 拦截并在 #afv-err 显示
  use_when:
    - 高级筛选
    - 筛选
    - 骨骼数
    - 立方体
    - 纹理尺寸
    - 按标签筛选
    - 条件过滤
  invariant_anchors:
    - frontend/src/utils/dom/dialogs/adv-filter.ts|modalAdvFilter
    - frontend/src/utils/dom/dialogs/adv-filter-util.ts|validateAdvFilter
tests:
  - frontend/src/utils/dom/dialogs/adv-filter-util.test.ts
  - frontend/src/utils/dom/dialogs/adv-filter.test.ts
quick_groups:
  - UI 交互与弹窗
quick_intents:
  - 高级筛选、骨骼数 / 立方体 / 纹理尺寸数值范围
  - 按标签筛选、条件过滤
  - modalAdvFilter
quick_risk_lines:
  - adv-filter 弹窗必须复用 modal.ts 的 Promise API，禁止手写弹窗 DOM
pitfalls:
  - 手写 adv-filter 弹窗 DOM → 与全局弹窗样式 / 焦点陷阱不一致；必须复用 modal.ts 的 registerDlg
  - adv-filter 输入不校验就提交 → min > max 传后端报错；必须在 validate() 拦截并在 #afv-err 显示

use_when:
  - 高级筛选
  - 筛选
  - 骨骼数
  - 立方体
  - 纹理尺寸
  - 按标签筛选
  - 条件过滤
invariant_anchors:
  - frontend/src/utils/dom/dialogs/adv-filter.ts|modalAdvFilter
  - frontend/src/utils/dom/dialogs/adv-filter-util.ts|validateAdvFilter
status: active
---

# 高级筛选 adv-filter

## 概览

`adv-filter.ts` 提供模型高级筛选弹窗：关键字 + 骨骼数/立方体数/纹理尺寸三组数值范围 + 标签名，采集后返回结构化条件对象交给调用方执行搜索。控件集合与后端 `SearchModels` 的能力严格对齐（6 个范围参数 + 关键字 + 标签），不提供后端不支持的控件（如文件大小、排序）。输入控件样式 `.afv-inp` 已提取到 frontend/css/components.css，弹窗不再注入 `<style>`。

## 核心职责

- `modalAdvFilter(opts)`：Promise 化弹窗，`opts.value` 回填上次条件
- 条件采集：`collect()` 输出 `AdvFilterValue`（keyword/minBones/maxBones/minCubes/maxCubes/minTex/maxTex/tag），空输入归一为 `null`（表示不限），负数/NaN 同样归 null
- 范围校验：`validate()` 仅在两端都填写时检查 min ≤ max，错误显示 `#afv-err` 并阻止提交
- 标签提示：打开后异步 `AllTags()` 在输入框旁展示「已有标签: …」
- 三种结果：应用 → resolve(条件对象)；「🧹 清除全部」→ resolve(`{ cleared: true }`)；取消/Esc/点遮罩 → resolve(null)
- 任意输入框 Enter 即提交（先校验）

## 对外 API / 入口

- 导出：`modalAdvFilter(opts?: { value?: Partial<AdvFilterValue> }): Promise<AdvFilterResult>`、`interface AdvFilterValue`、`type AdvFilterResult = AdvFilterValue | { cleared: true } | null`
- 监听/派发 bus：无
- getApp() 调用：`AllTags`
- 依赖：`esc`/`closeDlg`/`registerDlg`（dialogs/modal.ts）
- 调用方：app-tree 高级筛选入口（结果经 `filter:results` 等流程消费）

## 与其他子系统关系

- 弹窗基座复用 [dialog_modal](./dialog-modal.md)
- 后端搜索能力见 [wails_bindings](./wails-bindings.md)（SearchModels 的 6 范围 + 关键字参数）
- 标签条件与 [dialog_tag_editor](./dialog-tag-editor.md) 写入的标签同源（go/tags，见 [go_tags](./go-tags.md)）
- 筛选结果展示在 [app_tree](./app-tree.md)（`filter:results` 事件）

## 不变量

- 控件集合与后端 SearchModels 参数一一对应，禁止添加后端不支持的筛选控件（避免展示无效控件）
- `null` 语义固定为「不限制」，仅在 min/max 双端有值时才做区间校验
- 清除与取消是两种不同结果（`{ cleared: true }` vs `null`），调用方据此区分「清空条件」与「放弃修改」
- 回填值必须过 `esc` 再进 value 属性；弹窗经 `registerDlg` 登记；**数字回填用 `?? ""` 而非 `|| ""`**（P3 修复：`0` 是合法下限值，`|| ""` 会折叠成空——最小骨骼数 0 的回填丢失）
- 弹窗未做 `trapFocus`（modal 家族其余成员有，此处一致性缺口 P3 观察）；Enter 提交与 OK 点击共享 `closeDlg` 的防重复结算守卫（模块级 WeakSet）

## 相关

- [dialog_modal](./dialog-modal.md) — 弹窗基座
- [app_tree](./app-tree.md) — 筛选入口与结果展示
- [go_tags](./go-tags.md) — 标签数据来源
- [dialog_tag_editor](./dialog-tag-editor.md) — 标签编辑
