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
    - __resetDBForTest:145
    - __resetWebLogStateForTest:118
    - __setStatsRunnerForTest:53
    - AppBindings:12
    - arrayBufferToBase64:14
    - base64ToBytes:66
    - batchStatsWebModels:173
    - browserAdapter:70
    - collectAllWebEntries:622
    - consumeWebSearchDegraded:58
    - getAndroidBridge:24
    - getApp:18
    - getFsaAuthState:18
    - getStatsPoolSize:91
    - idbDel:190
    - idbGet:162
    - idbGetAll:246
    - idbKeys:211
    - IdbOp:277
    - idbSet:173
    - idbTx:286
    - importWebFiles:16
    - isWebEntryMode:37
    - isWebPath:27
    - MAX_IMPORT_BYTES:14
    - onStatsProgress:40
    - openDB:23
    - parseWebDirPath:39
    - parseWebPath:32
    - prefetchStatsWorker:113
    - readDeclaredBackend:31
    - readWebFile:91
    - reauthorizeFsaRoot:18
    - rescanFsaRoot:18
    - resolveWebMode:46
    - scanAllWebModels:251
    - scanWebModels:105
    - selectLocalRepo:16
    - STATS_BATCH_LIMIT:19
    - Store:19
    - terminateStatsWorker:65
    - typeFromWebDir:96
    - u8ToBase64:78
    - WailsAndroidBridge:18
    - WEB_ROOT:14
    - webCommonBindings:95
    - webCommunityBindings:252
    - webDirType:46
    - webFsBindings:637
    - WebModelStats:18
    - webStoreBindings:191
    - WebUnsupportedError:8
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

## 概览

`frontend/src/backend/` 是 YSM 网页版（ADR-049 Web Edition）的后端抽象层。在桌面/Android 环境下走 Wails Go 绑定替代，网页版使用 `browser-adapter.ts` + `idb.ts` 的同一前端接口。所有模块通过 `app.ts` 的 `getApp()` 工厂方法统一接入。

## 核心职责

| 模块 | 文件 | 用途 |
|------|------|------|
| 应用入口 | `app.ts` | 统一的 `getApp()` 工厂，桌面走 Wails Go 绑定，网页版走 browser-adapter |
| 浏览器适配 | `browser-adapter.ts` | 网页版后端适配器，将 Wails Binding 调用映射为 IDB/Web API |
| IndexedDB 存储 | `idb.ts` | 网页版持久化存储（模型库/配置/缓存），基于 IndexedDB |
| 平台检测 | `platform.ts` | 运行时平台判定（桌面/网页/Android） |
| 跨域隔离 | `coi-sw.ts` | COOP/COEP 跨域隔离 Service Worker，支持 SharedArrayBuffer |
| 文件系统 | `web-fs.ts` | 网页版虚拟文件系统（OPFS 或 IDB 兜底），含 zip 路径清洗 + DetectZipType 50MB 守卫 |
| 仓库存储 | `web-store.ts` | 网页版模型仓库数据（扫描/索引/缓存） |
| 统计 | `web-stats.ts` | 网页版模型批量统计（Web Worker 协同） |
| 社区下载 | `web-community.ts` | 网页版社区/创意工坊下载 |
| CLI 桥 | `web-cli.ts` | 仅 `GetAllowedCLICommands`（命令列表查询）；`ExecuteCLI` 已移除（ADR-123 P2：原假实现令 `can()` 门控失效，现 `'ExecuteCLI' in browserAdapter`=false 隐藏 web CLI 入口） |
| 通用工具 | `web-common.ts` | 网页版公共工具函数 |
| 提取 | `extract.ts` | 网页版 ZIP 提取 |
| NBT 解析 | `nbt-parse.ts` | 网页版 NBT 格式解析（Litematic 等），含 list 长度 OOM 守卫 |
| 体素 | `voxel-parse.ts` | 网页版体素数据解析，含 per-axis 上限 + total 512M 守卫 |
| 体素颜色 | `voxel-colors.ts` | 体素颜色映射表 |
| 体素颜色数据 | `voxel-colors-data.ts` | 体素颜色数据（Litematic 块色） |
| 包元数据 | `pack-meta.ts` | 网页版资源包/光影包元数据解析 |
| YSM 头 | `ysm-header.ts` | 网页版 YSM 文件头解析 |
| 类型 | `types.ts` | 网页版后端共享类型 |

## 已补齐的关键 binding / fallback 链

以下 binding 过去在 `browserAdapter` 里 fail-fast，导致前端 UI“可见但不可用”；现已由 `web-fs.ts` 接管实现（统一读 IDB → 解字节 → 纯解析 → 返回与 Go 契约一致的对象）：

| Binding | 网页版实现要点 |
|--------|--------------|
| `ScanModelEntriesFiltered` | 根目录按模型组返回主文件；非根目录按前缀列出目录内主文件，修复目录批量重命名误扫全库 |
| `ReadFileBytesBatch` / `ReadFileBytesBatchWithMeta` | 并发读 IDB，MMD/Scene 3D 纹理加载不再静默丢贴图 |
| `GetPackInfo` | 返回最小 `PackInfo`，展开目录不再“无法读取整合包信息” |
| `ListPackModels` / `ReadPackEntry` | 基于 `extractZip` 枚举/读取资源包模型条目，解锁资源包 3D |
| `ListPackModelsDetail` | 镜像 Go `ListPackModelsDetail`（ADR-131 P3）：`models[{path,cubes}] + total`，cubes = JSON `elements` 长度，封顶 200 防大包；详情页模型清单数据源 |
| `FindPreviewImage` / `ExtractPreviewTexture` | 模型同目录预览图 / zip 首张 PNG / `.json` 解压目录纹理 → `data:` URI |
| `AnalyzeBedrockModel` | `ysm.json` manifest 驱动多角色 geometry 合并（bones 合并、纹理声明序、默认纹理置首）；无 manifest 时回退第一个 `minecraft:geometry` |
| `AnalyzeBedrockModelEntry` | 按 `subPath` 从 zip 定位单角色 geometry，供多角色包内切换 |
| `SaveScreenshotFile` | web 模式用 `<a download>` 触发浏览器下载 |

> 边界：`.7z` 仍不支持（与导入层一致）；复杂 `ysm.json` 的 L0/L1 `subModels`、`metadata`、`fileInventory`、`textureCategories` 尚未完全移植。

## 对外 API / 入口

```ts
import { getApp } from './backend/app';
const app = getApp();  // 桌面: window.go.main.App, 网页版: browserAdapter
```

## 与其他子系统关系

- **wails-bridge** — 桌面端通过 `window.go.main.App` 调用 Go 绑定
- **backend-idb** — IndexedDB 封装知识卡（补充 `idb.ts` 细节）
- **model-stats** — 网页版统计复用 Web Worker 层

## 不变量

- 桌面端不走 `backend/` 目录（仅 `app.ts` 做平台分流）
- 所有 `web-*` 文件仅在 `MODE === 'web'` 时生效，桌面端 `getApp()` 直接返回 Wails 绑定
- `browser-adapter.ts` 实现 `App` 接口的全部方法，是网页版唯一的事实后端
- **安全契约**（CodeReview 第六轮）：zip entry 路径经 `sanitizeZipEntryPath` 清洗；`DetectZipType` 超 50MB base64 静默返回空；NBT list 长度按 `minPayloadBytes` 校验；体素 per-axis/total 有上限守卫