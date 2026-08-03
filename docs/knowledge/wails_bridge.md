---
kind: wails_bridge
name: Wails 桥接 app.ts
tier: architecture
category: core
source_files:
  - frontend/js/wails/app.ts
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

- 禁止 `const { SomeBinding } = window.go.main.App`（治理红线 4.2）
- 改 Go 文件后必须 `wails build` + 重启（致命陷阱 #1）
- Binding 函数名写错会返回 undefined（致命陷阱 #5）

## 相关

- 致命陷阱 §三 陷阱 #1 #5
