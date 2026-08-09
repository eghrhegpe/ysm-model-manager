---
kind: wails-bridge
name: Wails 桥接 app.ts
tier: architecture
category: core
source_files:
  - frontend/src/wails/app.ts
tests:
  - frontend/src/views/app-content/app-content.component.test.ts
  - frontend/src/views/app-preview/app-preview.component.test.ts
  - frontend/src/views/app-sidebar/app-sidebar.component.test.ts
  - frontend/src/views/app-tree/app-tree.component.test.ts
  - frontend/src/views/app-tree/app-tree.state.test.ts
use_when:
  - Wails
  - 桥接
  - getApp
  - Go 调用
  - Binding
  - window.go.main.App
---

# Wails 桥接 app.ts

## 概览

`wails/app.ts` 是前端调用 Go Binding 的唯一入口。所有 Go 端方法通过 `getApp()` 获取，禁止直接通过 `window.go.main.App` 访问。

## 核心职责

- 封装 `getApp()` 异步获取 Wails App 实例
- 提供统一的 Go 端 API 调用入口
- 处理调用异常并转为 Promise rejection

## 使用方式

```js
import { getApp } from "../wails/app.ts";
const App = await getApp();
const result = await App.SomeBinding();
```

## 与其他子系统关系

- `app.go`: Go 端 Binding 入口，注册所有导出方法
- `resource_bindings.go`: 资源相关 Binding 注册
- 前端所有 Go 调用统一走此入口（治理红线 4.2）

## 不变量

- 禁止 `const { SomeBinding } = window.go.main.App`（治理红线 §3.2）——唯一豁免：`getApp()` 内部在动态 import 启动前检查 `window.go.main.App` 作为 E2E/vite dev mock bridge 注入点（单一咽喉点内部豁免，前端业务代码仍禁止直连）
- 改 Go 文件后必须 `wails3 build` + 重启（致命陷阱 #1）
- Binding 函数名写错会返回 undefined（致命陷阱 #5）——import 路径下 TS 类型约束编译期报错；`window.go` 回退路径的 mock bridge 形态与生成模块不同（类型造假风险已加注释，缺失方法穿透到运行时 undefined）
- `getApp` 缓存语义：`_App` 命中直返；并发首调复用 in-flight `_appPromise`；**import 失败重置 `_appPromise` 并 rethrow**（下次调用可重试并重新检查 window.go 回退，防失败永久毒化，P2 修复）
- **window.go 空对象 `{}` 视为未注入**（P3 修复：原守卫仅检查 truthiness，空对象被缓存为 `_App` 后缺失方法运行时穿透 undefined 且粘滞整个会话——现空对象回退动态 import）
- **核心语义已有直接测试**（P2 补测：`wails/app.test.ts` 覆盖缓存命中/window.go 回退/空对象回退/并发复用/失败重试——原 wails/ 目录仅 app.ts 一个文件、84 个消费方测试全部 vi.mock 掉本模块，P2/P3 修复无回归护栏）

## 相关

- 致命陷阱 §三 陷阱 #1 #5
