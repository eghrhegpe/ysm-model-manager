---
kind: app-resource-manager
name: 资源管理页 app-resource-manager
tier: architecture
category: ui
source_files:
  - frontend/src/views/app-resource-manager/index.ts
  - frontend/src/views/app-resource-manager/tpl.ts
tests:
  - frontend/src/views/app-nav/index.test.ts
  - frontend/src/views/app-resource-manager/index.test.ts
  - frontend/src/views/app-sync-manager/index.test.ts
  - frontend/src/views/app-toast/index.test.ts
  - frontend/src/views/context-menu/index.test.ts
use_when:
  - 资源管理
  - 资源包
  - 光影包
  - resourcepack
  - shaderpack
  - 导入资源
  - 启用禁用
  - 通用资源
invariant_anchors:
  - frontend/src/views/app-resource-manager/index.ts|_initGen
---

# 资源管理页 app-resource-manager

## 概览

`app-resource-manager` 是通用资源管理组件（light DOM），以 `rtype` 属性驱动，管理资源包/光影包及未来任意注册类型的列表、详情、导入、启用/禁用与删除。类型行为（可用操作、扩展名、安装目录）全部从 `resource_types.json` 读取，是「注册表优先」治理红线的前端落点；仓库页对应标签页与整合包内资源子页都复用它。

## 核心职责

- `index.ts` — `<app-resource-manager>` 组件：`observedAttributes: ["rtype", "instance"]`；`_init` 读取类型配置、推导根目录（全局走 `GetRepoRoot`，带 `instance` 属性时从 `mcRoot + installDir` 经 `ListVersionInstances` 查实际版本目录做实例隔离）、绑定导入/打开目录/列表点击/搜索过滤；`_loadList` 扫描条目并按扩展名过滤（`.disabled` 后缀表禁用态）；`_showDetail` 渲染详情（光影包走 `ReadShaderpackLang` 提取显示名，其余走 `ReadPackMeta`），以 `_detailGen` 代际守卫作废快速切换条目时在途的回写
- 异步事件 handler 全包 try/catch：导入按钮（`index.ts:202`–`227`，`SelectImportZip` / `SelectImportFile` / `ImportByType` 抛错转 `_toast("error","导入失败")`）与列表点击（`index.ts:247`–`266`，`ToggleResourcePack` / `_showDetail` 抛错转 `_toast("error","操作失败")`）；删除按钮同样自带 try/catch（`index.ts:426`–`448`）。async handler 的 rejection 无处可传，不接住就是按钮静默失效
- `tpl.ts` — 布局模板：`sidebarHTML`（路径+操作栏+搜索+列表）/ `itemHTML` / `detailHTML` / `placeholderHTML` + `PackMetaDetail` 类型

## 对外 API / 入口

- 自定义元素：`<app-resource-manager rtype="resourcepack">`、`<app-resource-manager rtype="shaderpack" instance="1.20.1-Fabric">`
- 导出类：`AppResourceManager`
- 监听 bus：`config:resource-types-changed`（模块级订阅：清空类型配置缓存并触发所有实例重新 `_init`）
- 派发 bus：`toast:show`（统一反馈出口 `_toast`）
- getApp 调用：`LoadResourceTypes`、`GetRepoRoot`、`ScanModelEntries`、`IsResourcePackEnabled`、`ToggleResourcePack`、`SelectImportZip` / `SelectImportFile`、`ImportByType`、`DeleteResourcePack` / `DeleteModelDir`（按 `isDir` 字段分流）、`OpenFolder`、`ReadPackMeta`、`ReadShaderpackLang`、`LoadAppConfig`、`ListVersionInstances`

## 与其他子系统关系

- 类型定义唯一事实来源是 `resource_types.json`（`actions` / `extensions` / `installDir` / `isDir` 字段），经 Go `LoadResourceTypes` 加载（见知识卡 `resource_registry`）
- 由 `app-content` 仓库页标签（resourcepacks / shaderpacks）与整合包内子页实例化；`config:resource-types-changed` 由设置页自定义类型修改后派发（见知识卡 `app_content`）
- Go binding 位于 `internal/app/resource_bindings.go` / `app_scan.go`（`ScanModelEntries`）
- 删除走 Go 回收站策略（`go/recycle`），前端以 `modalConfirm`（`views/dialogs/modal.ts`）二次确认防呆，不用原生 `confirm`

## 不变量

- 不在前端手写资源类型/扩展名/安装目录逻辑，一切以 `resource_types.json` 条目为准（治理红线：注册表优先）
- 模块级 `STORE._config` 缓存仅在 `config:resource-types-changed` 或强制刷新时失效
- 所有反馈统一走 `_toast` → `bus.emit("toast:show")`，不派发游离 DOM 事件；破坏性删除前置 `modalConfirm`（`danger: true`）
- 所有 `async` DOM 事件 handler 必须自带 try/catch 并把异常转成 `_toast`：`addEventListener` 不会消费返回的 Promise，未捕获的 rejection 只会进 `unhandledrejection`，用户侧表现为「点了没反应」。**`attributeChangedCallback`（rtype/instance 变更）与 `config:resource-types-changed` bus handler 调 `_init()` 同样必须 `.catch`**（P2 修复：原两处无 catch，_init 内 await LoadAppConfig/ListVersionInstances/GetRepoRoot reject → 陷阱 #1「改类型/配置后没反应」）
- `await` 之后回写 DOM 前先比对 `_detailGen` 代际，防快速点条目时旧详情覆盖新详情
- 注册带 `customElements.get` 守卫（`if (!customElements.get("app-resource-manager"))`）防重复 define
- 该组件为 light DOM（直接 `this.innerHTML`），样式继承页面级 CSS 变量

## 相关

- `resource_types.json` — 资源类型单一事实来源
- `internal/app/resource_bindings.go` — 资源类 binding
- 知识卡：`resource_registry`、`app_content`、`app_sync_manager`、`go_recycle`
