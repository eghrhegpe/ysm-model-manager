---
kind: backend-idb
name: 浏览器后端 IndexedDB 封装
tier: architecture
adr:
  - ADR-177
category: core
source_files:
  - frontend/src/backend/idb.ts
  - frontend/src/backend/types.ts
  - frontend/src/backend/app.ts
  - frontend/src/backend/browser-adapter.ts
  - frontend/src/backend/web-common.ts
  - frontend/src/backend/web-fs.ts
  - frontend/src/backend/web-store.ts
  - frontend/src/backend/web-stats.ts
  - frontend/src/backend/web-community.ts
  - frontend/src/backend/platform.ts
  - frontend/src/workers/stats-core.ts
  - frontend/src/workers/stats-protocol.ts
  - frontend/src/workers/stats.worker.ts
auto_fields:
  symbols_with_lines:
    - __resetDBForTest:145
    - __resetWebLogStateForTest:118
    - __setStatsRunnerForTest:53
    - AppBindings:6
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
    - ModelStatsResult:20
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
    - StatsFileInput:14
    - statsFromDecodedFiles:76
    - statsFromJsonBytes:120
    - StatsRelReader:112
    - StatsWorkerError:42
    - StatsWorkerProgress:27
    - StatsWorkerRequest:17
    - StatsWorkerResponse:48
    - StatsWorkerResult:35
    - Store:19
    - terminateStatsWorker:65
    - typeFromWebDir:96
    - u8ToBase64:78
    - WailsAndroidBridge:18
    - WEB_ROOT:14
    - webCommonBindings:95
    - webCommunityBindings:247
    - webDirType:46
    - webFsBindings:637
    - WebModelStats:5
    - WebModelStatsWithPath:14
    - webStoreBindings:191
    - WebUnsupportedError:8
  tests:
    - frontend/src/app-modules.test.ts
    - frontend/src/backend/app.test.ts
    - frontend/src/backend/browser-adapter.contract-b1.test.ts
    - frontend/src/backend/browser-adapter.contract-b2.test.ts
    - frontend/src/backend/browser-adapter.contract-b3.test.ts
    - frontend/src/backend/browser-adapter.test.ts
    - frontend/src/backend/idb.test.ts
    - frontend/src/backend/platform.test.ts
    - frontend/src/utils/resource/types.test.ts
    - frontend/src/views/app-content/app-content.component.test.ts
    - frontend/src/views/app-content/app-content.methods.test.ts
    - frontend/src/views/app-preview/app-preview.component.test.ts
    - frontend/src/views/app-preview/app-preview.methods.test.ts
    - frontend/src/views/app-sidebar/app-sidebar.component.test.ts
    - frontend/src/views/app-sidebar/app-sidebar.sync.test.ts
    - frontend/src/views/app-tree/app-tree.component.test.ts
    - frontend/src/views/app-tree/app-tree.state.test.ts
  use_when:
    - IndexedDB
    - 网页版
    - backend
    - 模型库
    - browser adapter
    - web mode
  perf:
    - io-bound
  invariant_anchors:
    - frontend/src/backend/idb.ts|openDB
    - frontend/src/backend/browser-adapter.ts|browserAdapter
  quick_groups:
    - 后端桥接与数据存储
  quick_intents:
    - IndexedDB、网页版存储、idbGet/idbSet/idbDel CRUD
    - 网页模式切换、browser-adapter 桥接
    - FSA 授权、本地仓库挂载
    - zip 导入、模型扫描、Stats Worker 统计
    - 日志环持久化、社区/工坊数据
  quick_risk_lines:
    - 事务必须接线 complete/error/abort 三事件
    - fail-fast：未实现 binding 必须抛 WebUnsupportedError，禁止 undefined 穿透
    - 内存降级 OOM 保护：隐私模式无界写入会撑爆堆
    - browserAdapter Proxy 的 then 陷阱：返回 undefined 避免被误判为 thenable
    - zip entry 路径必须经 sanitizeZipEntryPath 清洗（防 .. 穿越）
    - DetectZipType base64 超 50MB 静默返回空，避免 atob 内存压力
    - 多标签页互锁：db.onversionchange 关闭旧连接并置空 dbPromise；onblocked 明确 reject
    - 前缀扫描性能门槛 R1 万级 key：用 IDBKeyRange.bound 区间定位而非全库 startsWith
  pitfalls:
    - 事务不接线 error/abort → Promise 永不 settle，读操作卡死
    - 隐私模式下 IndexedDB 受限，必须自动降级到内存 Map（有限制：200 条/64MB FIFO）
    - db.onversionchange 触发后 dbPromise 为空，后续所有操作立即失败；必须在降级路径中处理
    - Proxy.then 陷阱：若 thenable 检测误判，浏览器会按 Promise 处理返回结果，导致链式调用崩溃
    - idbKeys 前缀扫描边界：prefix+'\uffff' 语义是「以 prefix 开头的最大可能字符串」，不能写错范围否则漏键
    - FSA 授权恢复：restoreFsaRootHandle 只 queryPermission，禁止 requestPermission（启动期无手势会被拦截）
    - zip 导入双阶段分组：先粗分组再主文件目录收敛，若跳过会导致路径混乱/组名歧义
    - 日志环写入 fire-and-forget：不 await，不阻塞主流程；若需要一致性需改架构
    - 内存 Map 驱逐 FIFO 近似 LRU：命中当前 key 时移到队尾，但未访问的旧 key 仍在内存中
    - 3D/预览 binding 缺失：网页版 ReadFileBytesBatch、GetPackInfo、FindPreviewImage 等可能未实现，依赖 'Foo' in browserAdapter 探测
tests:
  - frontend/src/app-modules.test.ts
  - frontend/src/backend/app.test.ts
  - frontend/src/backend/browser-adapter.contract-b1.test.ts
  - frontend/src/backend/browser-adapter.contract-b2.test.ts
  - frontend/src/backend/browser-adapter.contract-b3.test.ts
  - frontend/src/backend/browser-adapter.test.ts
  - frontend/src/backend/idb.test.ts
  - frontend/src/backend/platform.test.ts
  - frontend/src/utils/resource/types.test.ts
  - frontend/src/views/app-content/app-content.component.test.ts
  - frontend/src/views/app-content/app-content.methods.test.ts
  - frontend/src/views/app-preview/app-preview.component.test.ts
  - frontend/src/views/app-preview/app-preview.methods.test.ts
  - frontend/src/views/app-sidebar/app-sidebar.component.test.ts
  - frontend/src/views/app-sidebar/app-sidebar.sync.test.ts
  - frontend/src/views/app-tree/app-tree.component.test.ts
  - frontend/src/views/app-tree/app-tree.state.test.ts
use_when:
  - IndexedDB
  - 网页版
  - backend
  - 模型库
  - browser adapter
  - web mode
perf:
  - io-bound
invariant_anchors:
  - frontend/src/backend/idb.ts|openDB
  - frontend/src/backend/browser-adapter.ts|browserAdapter
quick_groups:
  - 后端桥接与数据存储
quick_intents:
  - IndexedDB、网页版存储
quick_risk_lines:
  - 事务必须接线 complete/error/abort 三事件
status: active
---

# 浏览器后端 IndexedDB 封装

## 概览

`backend/` 目录是 YSM 网页版的后端抽象层（ADR-049 Phase 1-2），在桌面/Android 走 Wails Go 绑定、网页版走 `browser-adapter.ts` + `idb.ts` 的同一接口。`idb.ts` 是 IndexedDB 轻量封装，内置内存降级（隐私模式/非浏览器环境自动切换，OOM 保护）。`app.ts` 提供统一的 `getApp()` 入口，屏蔽平台差异。

## 核心职责

### idb.ts — IndexedDB 封装
- **双存储策略**: IndexedDB（生产） + 内存 Map（降级），由 `forcedMemory` 标志切换
- **OOM 保护**: 内存降级模式有双上限——条目数 200 条 + 字节估算 64MB，超限按 FIFO 驱逐（近似 LRU：已存在 key 重写时移到队尾）
- **多标签页互锁防护**: `db.onversionchange` 关闭旧连接并置空 `dbPromise`；`onblocked` 明确 reject 而非永久挂起
- **统一 CRUD**: `idbGet` / `idbSet` / `idbDel` / `idbKeys(prefix)` — 全链路 Promise 化，`idbSet`/`idbDel` 监听 `tx.onabort` 防永不 settle
- **前缀扫描性能（R1 万级 key 门槛）**: `idbKeys` 真实浏览器用 `IDBKeyRange.bound(prefix, prefix+\uffff)` 区间定位 cursor——只访问前缀命中键（O(命中)）而非全库逐键 startsWith（O(全库)）；无 `IDBKeyRange` 全局（node 测试）降级全量 cursor，且始终保留下方 `startsWith` 兜底过滤防边界误含/误漏（空 prefix=全库不走区间）

### app.ts — Wails 绑定访问
- **统一入口**: `getApp()` 返回 `AppBindings`，缓存避免重复动态 import
- **平台路由**: `resolveWebMode()` 为真时返回 `browserAdapter`（Proxy），否则走 Wails 原生绑定
- **并发保护**: `_appPromise` 复用，多个并发调用不会重复 import
- **Mock bridge 兼容**: 检测 `window.go.main.App`（E2E/dev 注入点），空对象不缓存（防类型造假穿透）

### browser-adapter.ts — 网页版后端实现（编排壳，ADR-040 按职责拆分）
- **虚拟根 `/web`**: 路径语义与桌面一致（`/web/<type>/<name>/<rel>`），业务调用零改动
- **fail-fast Proxy**: 未实现的 binding 一律抛 `WebUnsupportedError`，杜绝 undefined 静默穿透
- **能力门控**: `'Foo' in browserAdapter` 探测（browser-adapter.ts:87/94），未实现 binding → `false` → UI 隐藏对应控件；`WebUnsupportedError` fail-fast 兜底
- **拆分子模块**（实现函数/状态迁移，browser-adapter 仅 import 组装 `webImpls`）:
  - `web-common.ts`: 共享原语（`WebUnsupportedError` / `WEB_ROOT` / `MAX_IMPORT_BYTES` / `arrayBufferToBase64`）
  - `web-fs.ts`: 文件系统——`importWebFiles`（File 拖拽 → 两阶段分组：首段粗分组 + 主文件目录收敛 → IDB 落库；多段目录组名（如 `分类1/狐狸`）+ 组内 rel 保留子目录（`tex/face.png`）；主文件优先级 `.ysm=.zip > ysm.json > 其他`；**R2 导入增强：入口 `expandZipFiles` 展平 .zip 成目录模型组（extractZip 解压），.ysm 保持整体走 WASM**；超 100MB 跳过）、`scanWebModels`（IDB `dir:` 前缀 → `ModelEntry[]`，自动推导主文件，主文件限组根层、嵌套 rel 不参与竞争；**数值范围条件**：`minBones`/`maxBones`/`minCubes`/`maxCubes`/`minTex`/`maxTex` 支持骨骼/方块/纹理数量筛选，统计走 Web Worker 批量分析 `batchStatsWebModels`，worker 不可用降级为纯关键词匹配，`hasError` 排除口径对齐 Go `app_scan.go SearchModels`）、`readWebFile`/`parseWebModelPath`（多段路径直达 `file:type/rest` / dir key 反向最长前缀匹配，R1 文件层级读取）、`listWebModelDirFiles`（R1 递归列目录下全部文件，对齐桌面 `ListAllFilePaths`，含组内子目录，网页版删除目录移回收站联动依赖）、`selectLocalRepo`（FSA 授权本地仓库）、**FSA 句柄持久化（R2，参照 MikuMikuAR ADR-180/183）**：`saveFsaRootHandle`（句柄结构化克隆落 config store `fsaRootHandle`）、`restoreFsaRootHandle`（仅 queryPermission 恢复，绝不 requestPermission——启动期无手势会被拦截）、`getFsaAuthState`（权限三态 unsupported/none/granted/revoked，供 UI 引导）、`reauthorizeFsaRoot`（须手势内 requestPermission）、`rescanFsaRoot`（启动自愈恢复句柄 + 重扫入库）、**`MoveModelFile`/`CopyModelFile`（ADR-071 #7，P0 翻案）**：组级 rekey（dir key + 全部 file key + ban/tags 标记），校验对齐 go/fileops：自嵌套拒绝 / 目标已存在 / 源缺失；右键菜单「移动到 / 复制到」三语解锁、批量多选解锁；删除/重命名/子目录映射；**2026 补链的 preview/bedrock binding**：`ReadFileBytesBatch`/`ReadFileBytesBatchWithMeta`（MMD 贴图批量读）、`GetPackInfo`（目录预览最小 PackInfo）、`ListPackModels`/`ReadPackEntry`（资源包 3D）、`FindPreviewImage`/`ExtractPreviewTexture`（缩略图 data URI）、`AnalyzeBedrockModel`/`AnalyzeBedrockModelEntry`（`ysm.json` manifest 多角色合并 + subPath 单角色）、`SaveScreenshotFile`（`<a download>` 下载）
  - `extract.ts`: **R2 导入增强 zip 解压**——`parseZipCentralDir`（预解析中央目录 + fflateKey 对齐 + gpf bit 11 UTF-8/Latin-1 判定）、`extractZip`（unzipSync 全量解压 + ZIP 炸弹防护：条目 10000 / 单文件 100MB / 总 512MB）、`detectZipType`（local file header 扫描识别 resourcepack/shaderpack/ysm，Go DetectZipType TS 平移）、`gbkDecodeEntry`（gpfUtf8 还原真名，前端无 GBK 码表降级透传）
  - **安全加固（CodeReview 第六轮）**：`sanitizeZipEntryPath` 清洗 zip entry 路径（剥离 `..` 防穿越）、`expandZipFiles` 先用清洗路径再调 `findCommonTopDir`；`DetectZipType` 加 50MB base64 守卫（超 50MB 静默返回空，避免 atob 内存压力）
  - `web-store.ts`: 配置（localStorage）、**日志环 IDB 持久化（ADR-071 #8，2026-08-15）**：`web:import-logs` / `web:runtime-logs` 两环分别存导入日志（500 条上限）与运行时日志（300 条），fire-and-forget 写（不阻塞主流程）+ `hydrateWebLog` 启动恢复 + `clear` 同步删 key；`error-diary` 网页版早退已移除，`web-store` 日志环现在有真实日志可回溯（替代 Go 侧日志）、标签/ban（config store `tags:<path>` / `ban:<path>`）
  - `web-community.ts`: 社区/工坊数据（bundled JSON 默认 + localStorage 覆盖层）、头像批量提取、作者扫描/仓库索引

### platform.ts — 平台环境判定
- **Tier 0**: `globalThis.__YSM_BACKEND__`（入口 HTML 显式声明，权威）
- **Tier 1**: `__YSM_WEB__ === true` 或 `import.meta.env.MODE === 'web'`
- **Tier 2**: 运行时探测 `window.go` / `window.wails`（Phase 3 引入）

## 对外 API / 入口

- `idb.ts`: `openDB()`, `idbGet<T>(store, key)`, `idbSet(store, key, value)`, `idbDel(store, key)`, `idbKeys(store, prefix)`, `_resetDBForTest()`
- `app.ts`: `getApp()` 返回 `Promise<AppBindings>`，`AppBindings` 类型定义
- `browser-adapter.ts`: `browserAdapter` (AppBindings), `importWebFiles(files, type)`, `selectLocalRepo()`, `arrayBufferToBase64(buf)`, `WebUnsupportedError`
- `platform.ts`: `resolveWebMode()`, `isWebEntryMode()`, `readDeclaredBackend()`
- `types.ts`: `AppBindings` 类型定义

## 与其他子系统关系

- `wasm/ysm-parser.ts`: 头像提取、模型解码复用前端 WASM 能力
- `utils/dom/storage.ts`: 配置持久化用 `safeGet`/`safeSet` 包装 `localStorage`
- `resource_types.json`: 资源类型注册表驱动扫描目录映射
- `bindings/`: Wails v3 生成的 Go 绑定（桌面/Android 路径）
- `frontend/src/`: 业务代码统一调 `getApp()` 取得绑定，不感知平台差异

## 不变量

- 网页版无 Go 进程，所有"后端"能力由前端自给（IDB + localStorage + WASM）
- 未实现 binding 必须 fail-fast（`WebUnsupportedError`），不允许 undefined 穿透（治理红线陷阱 #5）
- 内存降级 OOM 保护必须生效（隐私模式无界写入会撑爆堆）
- `browserAdapter` 的 Proxy `then` 陷阱：返回 `undefined` 避免被误判为 thenable
- 原型成员（toString/constructor 等）不走 fail-fast，走默认 Object.prototype 行为
- **安全契约**：zip entry 路径必须经 `sanitizeZipEntryPath` 清洗（防 `..` 穿越）；`DetectZipType` 对 >50MB base64 静默返回空；NBT 解析按 `minPayloadBytes` 校验 list 长度防 OOM；体素解析加 `MAX_SCHEMATIC_BLOCKS`（512M）守卫
