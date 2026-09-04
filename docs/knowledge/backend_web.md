---
kind: backend_web
name: 网页版后端 backend-web
tier: architecture
category: core
source_files:
  - frontend/src/backend/app.ts
  - frontend/src/backend/browser-adapter.ts
  - frontend/src/backend/idb.ts
  - frontend/src/backend/platform.ts
  - frontend/src/backend/web-common.ts
  - frontend/src/backend/web-fs.ts
  - frontend/src/backend/web-store.ts
  - frontend/src/backend/web-stats.ts
  - frontend/src/backend/web-community.ts
auto_fields:
  symbols_with_lines:
    - __resetDBForTest
    - __resetWebLogStateForTest
    - __setStatsRunnerForTest
    - AppBindings
    - arrayBufferToBase64
    - base64ToBytes
    - batchStatsWebModels
    - browserAdapter
    - collectAllWebEntries
    - consumeWebSearchDegraded
    - getAndroidBridge
    - getApp
    - getStatsPoolSize
    - idbDel
    - idbGet
    - idbGetAll
    - idbKeys
    - IdbOp
    - idbSet
    - idbTx
    - importWebFiles
    - isWebEntryMode
    - isWebPath
    - MAX_IMPORT_BYTES
    - onStatsProgress
    - openDB
    - parseWebDirPath
    - parseWebPath
    - prefetchStatsWorker
    - readDeclaredBackend
    - readWebFile
    - resolveWebMode
    - scanAllWebModels
    - scanWebModels
    - Store
    - terminateStatsWorker
    - typeFromWebDir
    - u8ToBase64
    - WailsAndroidBridge
    - WEB_ROOT
    - webCommonBindings
    - webCommunityBindings
    - webDirType
    - webFsBindings
    - WebModelStats
    - webStoreBindings
    - WebUnsupportedError
  tests:
    - frontend/src/app-modules.boot.test.ts
    - frontend/src/app-modules.test.ts
    - frontend/src/backend/app.test.ts
    - frontend/src/backend/browser-adapter.contract-b1.test.ts
    - frontend/src/backend/browser-adapter.contract-b2.test.ts
    - frontend/src/backend/browser-adapter.contract-b3.test.ts
    - frontend/src/backend/browser-adapter.test.ts
    - frontend/src/backend/idb.test.ts
    - frontend/src/backend/platform-parity.test.ts
    - frontend/src/backend/platform-web.test.ts
    - frontend/src/backend/platform.test.ts
    - frontend/src/backend/web-common.test.ts
    - frontend/src/backend/web-fs-shared.test.ts
    - frontend/src/backend/web-fs.bindings.test.ts
    - frontend/src/backend/web-fs.test.ts
    - frontend/src/backend/web-stats.test.ts
    - frontend/src/backend/web-store.logs.test.ts
    - frontend/src/views/app-content/app-content.component.test.ts
    - frontend/src/views/app-content/app-content.methods.test.ts
    - frontend/src/views/app-preview/app-preview.component.test.ts
    - frontend/src/views/app-preview/app-preview.methods.test.ts
    - frontend/src/views/app-sidebar/app-sidebar.component.test.ts
    - frontend/src/views/app-sidebar/app-sidebar.sync.test.ts
    - frontend/src/views/app-tree/app-tree.component.test.ts
    - frontend/src/views/app-tree/app-tree.state.test.ts
tests:
  - frontend/src/app-modules.boot.test.ts
  - frontend/src/app-modules.test.ts
  - frontend/src/backend/app.test.ts
  - frontend/src/backend/browser-adapter.contract-b1.test.ts
  - frontend/src/backend/browser-adapter.contract-b2.test.ts
  - frontend/src/backend/browser-adapter.contract-b3.test.ts
  - frontend/src/backend/browser-adapter.test.ts
  - frontend/src/backend/idb.test.ts
  - frontend/src/backend/platform-parity.test.ts
  - frontend/src/backend/platform-web.test.ts
  - frontend/src/backend/platform.test.ts
  - frontend/src/backend/web-common.test.ts
  - frontend/src/backend/web-fs-shared.test.ts
  - frontend/src/backend/web-fs.bindings.test.ts
  - frontend/src/backend/web-fs.test.ts
  - frontend/src/backend/web-stats.test.ts
  - frontend/src/backend/web-store.logs.test.ts
  - frontend/src/views/app-content/app-content.component.test.ts
  - frontend/src/views/app-content/app-content.methods.test.ts
  - frontend/src/views/app-preview/app-preview.component.test.ts
  - frontend/src/views/app-preview/app-preview.methods.test.ts
  - frontend/src/views/app-sidebar/app-sidebar.component.test.ts
  - frontend/src/views/app-sidebar/app-sidebar.sync.test.ts
  - frontend/src/views/app-tree/app-tree.component.test.ts
  - frontend/src/views/app-tree/app-tree.state.test.ts
affected: false
quick_groups:
  - 后端桥接与数据存储
quick_intents:
  - 网页版 / 浏览器模式 / web mode
  - IndexedDB / IDB / 浏览器后端
  - browser adapter、跨域隔离 COI
  - NBT 解析 / 体素 / 网页版文件系统
quick_risk_lines:
  - 网页版后端必须经 browserAdapter 代理，禁止 Wails 与浏览器后端混合调用
pitfalls:
  - 网页版直调 window.go → 无 wails runtime 时报错；必须经 browserAdapter
  - 跨域资源共享不处理 COI → SharedArrayBuffer 等 API 不可用；必须设置 cross-origin-isolation 头

use_when:
  - 网页版
  - 浏览器模式
  - browser adapter
  - IndexedDB
  - 跨域隔离
invariant_anchors:
  - frontend/src/backend/app.ts|getApp
  - frontend/src/backend/browser-adapter.ts|browserAdapter
status: active
---

# 网页版后端 backend-web
> **架构事实已迁移至 **[architecture.md#23-web-版-backend-adapter](../architecture.md#23-web-版-backend-adapter)。
> 本卡仅保留 frontmatter 机器字段（symbols/tests/quick_risk_lines），架构描述以 architecture.md 为准。

---

## 符号索引

> 符号列表见 frontmatter `auto_fields.symbols_with_lines`。
