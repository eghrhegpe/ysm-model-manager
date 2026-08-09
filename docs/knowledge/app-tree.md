---
kind: app-tree
name: 资源树 app-tree
tier: architecture
category: ui
source_files:
  - frontend/src/views/app-tree/index.ts
  - frontend/src/views/app-tree/
tests:
  - frontend/src/views/app-nav/index.test.ts
  - frontend/src/views/app-resource-manager/index.test.ts
  - frontend/src/views/app-sync-manager/index.test.ts
  - frontend/src/views/app-toast/index.test.ts
  - frontend/src/views/context-menu/index.test.ts
use_when:
  - 树形
  - 资源列表
  - tree
  - 节点
  - 树
  - 目录树
invariant_anchors:
  - frontend/src/views/app-tree/bus-handlers.ts|selectState
---

# 资源树 app-tree

## 概览

`app-tree` 是 YSM 核心的资源目录树组件，使用 Web Components 实现，支持展开/折叠、右键菜单、文件图标显示。

## 核心职责

- 渲染模型资源目录树
- 节点选择与多选
- 右键菜单触发
- 节点悬停快捷操作（ha-preview 🔍：解析模型名作者并在 B站搜索）

## 对外 API / 入口

- `AppTree` 生命周期：`connectedCallback`（绑定事件 + `_unsubs` 收集订阅）→ `disconnectedCallback`（清理订阅 / keydown / 虚拟滚动）
- `_load` — 加载条目数据；`_renderTree` — 渲染树（grid/list 双模式）
- `_initKeyboardShortcuts` / `_deleteSelected` — 键盘快捷键 / 批量删除
- 子模块：`bus-handlers.ts`（事件处理）/ `events.ts`（委托）/ `virtual-scroll.ts`（虚拟滚动）

## 与其他子系统关系

- `app-content/`: 选中节点内容在 content 区域渲染
- `app-sidebar/`: 侧栏面板状态联动
- `context-menu.ts`: 右键菜单事件路由
- 通过 bus 发出节点选择事件

## 不变量

- 文件名显示统一走 `renderDisplayName()`（治理红线 4.3）；搜索态走 `hl(e.name, search)`（utils/dom/html.ts，同源转义但美化样式在搜索时丢失——P3 观察）
- 使用 Shadow DOM 隔离样式
- 组件拆分遵循 app-xxx 规范（index/tpl/row-tpl/data/render/events）
- 动态 import 链路带 `.catch` 兜底（如 ha-preview 解析模块加载失败以 toast 提示，见 events.ts:196）
- **选中态在数据变更链路（回收/重命名）成功后必须清空**（P2 修复：`selectState` 是模块级单例，bus-handlers 的 dir:recycle / batch:rename / dir:batch-rename 成功后清 keys+lastKey——原旧路径滞留会显示「已选 N 个文件」并对已不存在路径误删）
- **instance-actions 契约口径**（2026-08-09 收敛）：① 同步键口径 = Go `sync_push.go` `SyncCustomToRepo` 的去重规则（Hash 优先 + 原始 Name 兜底、复制保留相对路径）——前端**不**自行按 `.ban` 剥离裸名 Set 计数，`uploaded` 直接信任 Go 返回值（单一事实来源，防「📤 N」撒谎/漏同步）；② `addImportLog` 参数契约 = Go `Logger.Add` 签名（modelName/sourcePath/targetDir/fileSize/status/errMsg），sourcePath=源、targetDir=目标，调用方不得装反/漏传

## 相关

- `frontend/src/utils/dom/display.ts` — 文件名渲染
- `frontend/src/views/app-tree/` — 组件目录
