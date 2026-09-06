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
  - frontend/src/parsers/extract.ts
  - frontend/src/backend/browser-adapter.ts
auto_fields:
  symbols_with_lines:
    - AppBindings
    - browserAdapter
    - detectContainerType
    - ExtractResult
    - extractZip
    - getAndroidBridge
    - getApp
    - isWebEntryMode
    - parseZipCentralDir
    - readDeclaredBackend
    - resolveWebMode
    - WailsAndroidBridge
    - ZipEntryMeta
    - ZipType
  tests:
    - frontend/src/views/app-content/app-content.component.test.ts
    - frontend/src/views/app-preview/app-preview.component.test.ts
    - frontend/src/views/app-sidebar/app-sidebar.component.test.ts
    - frontend/src/views/app-tree/app-tree.component.test.ts
    - frontend/src/views/app-tree/app-tree.state.test.ts
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
  - 平台检测与模式路由
  - IndexedDB 模型库
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
> **架构事实已迁移至 **[architecture.md#2-wails-应用骨架](../architecture.md#2-wails-应用骨架)。
> 本卡仅保留 frontmatter 机器字段（symbols/tests/quick_risk_lines），架构描述以 architecture.md 为准。

---

## 符号索引

> 符号列表见 frontmatter `auto_fields.symbols_with_lines`。
