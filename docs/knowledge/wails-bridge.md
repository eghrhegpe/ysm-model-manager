---
kind: wails-bridge
name: Wails 桥接 app.ts
tier: architecture
adr:
  - ADR-049
category: core
source_files:
  - frontend/src/backend/app.ts
  - frontend/src/backend/platform.ts
  - frontend/src/backend/extract.ts
  - frontend/src/backend/browser-adapter.ts
auto_fields:
  symbols_with_lines:
    - AppBindings
    - arrayBufferToBase64
    - browserAdapter
    - detectZipType
    - ExtractResult
    - extractZip
    - getAndroidBridge
    - getApp
    - getFsaAuthState
    - importWebFiles
    - isWebEntryMode
    - MAX_IMPORT_BYTES
    - parseZipCentralDir
    - readDeclaredBackend
    - reauthorizeFsaRoot
    - rescanFsaRoot
    - resolveWebMode
    - selectLocalRepo
    - WailsAndroidBridge
    - WEB_ROOT
    - WebUnsupportedError
    - ZipEntryMeta
    - ZipType
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
    - 网页版
    - browser adapter
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
  - 网页版
  - browser adapter
invariant_anchors:
  - frontend/src/backend/app.ts|getApp
  - frontend/src/backend/platform.ts|resolveWebMode
quick_groups:
  - 后端桥接与平台路由
  - 网页版与 IndexedDB
quick_intents:
  - 调用 Go Binding / getApp 获取后端
  - 网页版路由 / browser adapter
  - 检测平台类型 / 网页模式
  - IndexedDB 模型库（browser 模式）
quick_risk_lines:
  - 前端所有 Go 调用必须走 getApp()，禁止直接访问 window.go.main.App（治理红线 4.2）
  - 改 Go 文件后必须 wails3 build + 重启，纯 dev 模式看不到新 Binding
  - Binding 函数名写错穿透到运行时 undefined（Mock bridge 形态与生成模块不同，类型造假风险）
  - window.go 空对象 {} 会被缓存为 _App（P3 修复前），导致缺失方法静默穿透整个会话
pitfalls:
  - 「const { SomeBinding } = window.go.main.App」解构直连 → 绕过 getApp 缓存/路由，违反红线 §3.2
  - 忘记 wails3 build 就运行 → 新 Binding 在桌面端不可见、报 undefined
  - getApp 首次调用失败后直接返回错误，没有重试语义（P2 修复：import 失败会重置 _appPromise 并 rethrow，防永久毒化）
  - 认为 browserAdapter 有状态会被缓存 → 实际是无状态 Proxy，每次调用 getBrowserAdapter 直接返回，不走 _App 缓存
  - 拼错 webImpls 键名 → 原先运行时静默无响应，Phase 3 修复后通过 satisfies Record 保留字面量键 + AssertSubset 在编译期暴露
status: active
---
# Wails 桥接 app.ts

## 概览

`backend/app.ts` 是前端调用后端 Binding 的唯一入口。所有 Go 端方法通过 `getApp()` 获取，禁止直接通过 `window.go.main.App` 访问。**ADR-049 平台双路由**：网页版（无 Wails 壳的纯浏览器）由 `platform.ts` 的 `resolveWebMode()` 判定后路由到 `browserAdapter`（`browser-adapter.ts`），桌面/Android 走 Wails 原逻辑——业务调用零改动。

## 核心职责

- 封装 `getApp()` 异步获取后端 App 实例（Wails Go 绑定 / browser adapter 二选一）
- **平台路由判定**（`platform.ts`，同步判定，ADR-049 Phase 1）：Tier 0 = 入口 HTML 显式声明 `globalThis.__YSM_BACKEND__`（`'go' | 'browser'`，权威信号，web.html 置 `'browser'` 后即便误嵌进 WebView 也强制走 browserAdapter）；Tier 1 = `__YSM_WEB__ === true` 或 `import.meta.env.MODE === "web"`；Tier 2 = 运行时探测 `window.go`（Wails 桌面）或 `window.wails`（Android 桥）——纯浏览器两者都不存在。`import.meta.env.MODE` 必须直接书写（vite define 是文本替换，中间变量/可选链会失效）
- **browser adapter**（`browser-adapter.ts`，ADR-049 Phase 1 骨架 + Phase 2 IndexedDB 模型库）：Proxy 生成与 Wails AppBindings 同形状的后端；已实现 binding 走真实数据（IndexedDB 模型库 + localStorage 配置，`idb.ts`），未实现 binding **fail-fast 抛 `WebUnsupportedError`**（杜绝 undefined 穿透静默失败）；虚拟根 `/web` 让前端路径语义（GetRepoRoot → ScanModelEntries → ReadFileBytes）与桌面一致；导入白名单复用 `dnd-shared`（.json 仅放行 ysm.json，其余须 ALL_EXTS 成员）
- **Proxy has trap 契约**（第七轮修复）：`has` 用 `Object.prototype.hasOwnProperty.call(webImpls, name)` 仅看自有键——`'toString' in adapter` 等原型成员返回 false（原沿原型链恒 true，与 get trap 的 PROTOTYPE_MEMBERS 豁免不对称，Phase 3 能力门控误报）；`webImpls` 键集加类型级对账（`satisfies Record` 保留字面量键 + `AssertSubset<keyof AppBindings>`），拼错键/漏实现编译期暴露
- 处理调用异常并转为 Promise rejection

## 使用方式

```js
import { getApp } from "../backend/app.ts";
const App = await getApp();
const result = await App.SomeBinding();
```

## 与其他子系统关系

- `app.go`: Go 端 Binding 入口，注册所有导出方法
- `resource_bindings.go`: 资源相关 Binding 注册
- `platform.ts`: 网页版判定（`resolveWebMode`）——路由双后端的前置闸门（ADR-049 Phase 1，参考 MikuMikuAR ADR-176/177 Tier 分层）
- `browser-adapter.ts` / `idb.ts`: 网页版后端（IndexedDB 模型库 + localStorage 配置；未实现 binding fail-fast）
- 前端所有 Go 调用统一走此入口（治理红线 4.2）

## 不变量

- 禁止 `const { SomeBinding } = window.go.main.App`（治理红线 §3.2）——唯一豁免：`getApp()` 内部在动态 import 启动前检查 `window.go.main.App` 作为 E2E/vite dev mock bridge 注入点（单一咽喉点内部豁免，前端业务代码仍禁止直连）
- **browserAdapter 路由置于缓存检查之前**（app.ts browserAdapter 路由）：browserAdapter 无状态（Proxy），每次返回即可，不污染 `_App`/`_appPromise` 缓存
- 改 Go 文件后必须 `wails3 build` + 重启（致命陷阱 #1）
- Binding 函数名写错会返回 undefined（致命陷阱 #5）——import 路径下 TS 类型约束编译期报错；`window.go` 回退路径的 mock bridge 形态与生成模块不同（类型造假风险已加注释，缺失方法穿透到运行时 undefined）
- `getApp` 缓存语义：`_App` 命中直返；并发首调复用 in-flight `_appPromise`；**import 失败重置 `_appPromise` 并 rethrow**（下次调用可重试并重新检查 window.go 回退，防失败永久毒化，P2 修复）
- **window.go 空对象 `{}` 视为未注入**（P3 修复：原守卫仅检查 truthiness，空对象被缓存为 `_App` 后缺失方法运行时穿透 undefined 且粘滞整个会话——现空对象回退动态 import）
- **核心语义已有直接测试**（P2 补测：`backend/app.test.ts` 覆盖缓存命中/window.go 回退/空对象回退/并发复用/失败重试——原 backend/ 目录仅 app.ts 一个文件、84 个消费方测试全部 vi.mock 掉本模块，P2/P3 修复无回归护栏）

## 相关

- 致命陷阱 §三 陷阱 #1 #5
