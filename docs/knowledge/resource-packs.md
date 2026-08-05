---
kind: resource_packs
name: 资源包功能 resource-packs
tier: architecture
category: feature
source_files:
  - frontend/src/features/resource-packs.ts
use_when:
  - 资源包
  - 光影包
  - 蓝图
  - 投影
  - resourcepack
  - shaderpack
  - 资源管理
---

# 资源包功能 resource-packs

## 概览

`resource-packs.ts` 是一个薄 wrapper：把仓库页的各类资源包 tab（资源包/光影包/蓝图/MMD/VRC/投影）统一委托给 `<app-resource-manager>` 组件渲染。文件本身不含业务逻辑，仅负责挂载组件、以 `rtype` 属性区分资源类型，是「tab 页 → 通用资源管理组件」的适配层。

## 核心职责

- 组件注册走**模块顶层静态副作用导入** `import "../views/app-resource-manager/index.ts"`（ADR-039 动态导入静态化，提交 50635b3）；函数体内不再有 `await import(...)`
- `initResourcePacks(container, host, rtype?)`：向容器写入 `<app-resource-manager rtype="...">` 字符串，除此之外无其他动作
- `rtype` 缺省为 `RESOURCE_TYPES.PACK`（`"resourcepack"`）；app-content 按 tab 分别传入 `RESOURCE_TYPES.SHADER` / `BLUEPRINT` / `MMD` / `VRC` / `LITEMATIC`
- 返回空清理函数 `() => {}` 以兼容上层「init 必返回 cleanup」的调用契约（Toast 由 app-resource-manager 内部直接 `bus.emit("toast:show")`，此处不桥接游离 DOM 事件）
- 签名保留 `async` / `Promise<() => void>`，仅为兼容上层 `await initResourcePacks(...)` 调用形态，内部已无异步等待

## 对外 API / 入口

- 导出：`initResourcePacks(container: HTMLElement, host: object, rtype?: string): Promise<() => void>`
- 监听 bus：无
- 派发 bus：无（由 app-resource-manager 自行派发）
- 依赖常量：`RESOURCE_TYPES`（frontend/src/utils/resource/types.ts）
- 静态导入组件：`frontend/src/views/app-resource-manager/index.ts`（注意是 `views/` 而非 `components/`）

## 与其他子系统关系

- 由 [app_content](./app_content.md) 的 `_bindTabs` 在首次切到对应 tab 时调用（app-content 顶层静态 import 本模块，非动态 import 懒加载），返回的 cleanup 收进 `_unsubs`
- 实际业务（扫描、导入、启用/禁用、删除）在 [app_resource_manager](./app_resource_manager.md) 组件内
- 资源类型定义以 [resource_registry](./resource_registry.md)（resource_types.json）为单一事实来源，本文件不硬编码子目录/扩展名
- 资源包 mcmeta 解析等后端能力见 [go_packs](./go_packs.md)

## 不变量

- 本文件只做组件挂载，禁止在此添加游离 DOM 事件桥接（Design.md §14.6 D3：反馈由组件内部直接走 bus）
- `rtype` 必须来自 `RESOURCE_TYPES` 常量或 app-content 传入的注册类型，不得手写新类型 ID
- 返回值必须是清理函数（即使为空），保持上层 `init 返回 cleanup` 契约一致
- 组件注册只能用顶层静态导入，禁止退回 `await import(...)`；更禁止写 `.js` 后缀（目录重命名后曾漂移，靠 vite `.js→.ts` 兜底，已在 7bb9f7c 修正）

## 相关

- [app_resource_manager](./app_resource_manager.md) — 实际渲染与业务逻辑
- [app_content](./app_content.md) — tab 懒加载宿主
- [resource_registry](./resource_registry.md) — 资源类型注册表
