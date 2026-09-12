# ADR-049：网页版（Web 端）桥接：backend 适配器 + IndexedDB 模型库

- **状态**：✅ 已采纳
- **日期**：2026-08-10
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`ADR-029（WASM 内嵌）、ADR-046（全平台化）、MikuMikuAR ADR-176/177 参考、frontend/src/backend/app.ts`

---

## 1. 背景（Context）

用户提出做网页版（纯浏览器托管，如 GitHub Pages），并担忧「桌面端靠 Node.js + WASM 跑 YSMParser，安卓端与网页版是不是就寄了」。2026-08-10 子代理侦察（sa_20260810_111123）+ 代码核实澄清三个认知：

| 担忧 | 事实 |
|------|------|
| YSMParser 依赖 Node.js | **否**。ADR-029 已定 base64 内嵌 + `Module.wasmBinary` 注入（`ysm-parser.ts:2` 头注释：规避 WebView2 fetch 限制），运行时全 Emscripten 浏览器标准 API，Node.js 仅出现在构建链（重建脚本已归档至 `scripts/_attic/build-ysm-wasm.ts`，复活需 emsdk，见 architecture.md §4.1）。桌面端跑在 WebView2（Chromium） |
| 安卓端 WASM 会挂 | **否**。Android WebView 同为 Chromium，跑同一套 base64 注入；`ReadFileBytes` binding 在 Android 已可用（授权后 `os.*` 直读） |
| 网页版可行性 | **依赖面 = 80 个 Wails binding**（`getApp()`，26 个文件 import），而非 WASM/3D/bus——后者全纯浏览器 |

姊妹项目 MikuMikuAR 已趟通全路径并上线 GitHub Pages：
- **ADR-176**：backend 适配器双实现——`wails-bindings` 106/139 函数全代理化，经 `resolveBackend()` 路由（桌面走 Wails、浏览器走 IndexedDB/File API），**业务调用零改动**。
- **ADR-177**：web-loader 与主应用统一（终态删除独立 web-loader，主应用 web 入口为唯一 Pages 入口）——浏览器侧 `ListDirRecursive`/`LoadOutfitFile`/`LoadSceneFile` 用 IndexedDB `dir:*:` 前缀扫描 + `outfit:*:` IDB 读 + `web://bundle` 三路路由；能力门控（AR/广场窗口隐藏）；Playwright 双 webServer（5173 桌面 dev + 4174 web preview）回归。

本项目与 MikuMikuAR 的差异（有利）：无 AR/物理/Ragdoll 等浏览器不可用能力；bus 事件纯前端（零 Go 来源）；3D 走 WebView 内 WASM + Blob URL（ADR-029）；Android 查看器模式（ADR-046 P2）已确立「固定公共目录 + 授权」范式，网页版可复用其「文件从哪来」的降级思路。

## 2. 决策（Decision）

**采纳 B 方案（backend 适配器双实现，MikuMikuAR ADR-176/177 模式），分四阶段实施；不引入 HTTP 服务端。**

| 方案 | 描述 | 判定 |
|------|------|------|
| A 纯静态查看器 | File API + 拖拽，零后端 | ❌ 无模型库管理，与桌面功能割裂 |
| **B backend 适配器** | `getApp()` 路由到 browser adapter（IndexedDB 模型库 + File API 导入 + localStorage 配置） | ✅ 同一代码库，业务零改动，可上线 Pages |
| C Go HTTP 服务桥 | 复用 internal/app 暴露 REST API | ❌ 需部署后端，与「纯静态网页版」诉求相悖；写能力收益低于运维成本 |

**阶段划分**（对齐 ADR-177 Phase 0-4 经验）：

- **Phase 0 Spike（前置门槛）**：纯浏览器 WASM 解码跑通——拖入 `.ysm` → `decodeYsmFileFromMemory`（ADR-029 内存解析）→ 2D 线框 + 3D 预览；验证 bus 事件零 Go 依赖、Vite web 构建产物可独立托管。**未通过不进入 Phase 1**。✅ **已完成（2026-08-10）**：`frontend/web.html` + `src/web-spike/main.ts` + `vite.web.config.ts`（base 默认 `/` 本地验证、CI 设 `WEB_BASE` 部署）；Playwright 无头 Chromium 拖入真实 `.ysm`（露西亚 123KB）→ 解码 7 输出文件（main.json 骨骼 209 / 立方体 176 / 纹理 2），零 binding 依赖。
- **Phase 1 适配层**：`frontend/src/wails/app.ts` 的 `getApp()` 改为 `resolveBackend()` 双实现路由（桌面 Wails / 浏览器 browser adapter），业务调用零改动；`@wailsio/runtime` value import 全量迁移（MikuMikuAR 审核教训：不止 Events，还有 Browser 等）。✅ **已完成（2026-08-10）**：
  - `wails/platform.ts` Tier 分层判定（Tier 0 `__YSM_BACKEND__` 入口声明 / Tier 1 `__YSM_WEB__`+`MODE=web` / Tier 2 运行时探测留给 Phase 3 awaitWailsBridge）
  - `wails/browser-adapter.ts` Proxy 生成 AppBindings 同形状后端：最小启动集（ScanModelEntries/GetRepoRoot/GetDefaultRepoRoot/LoadAppConfig/GetAppInfo 空语义） + 未实现 binding fail-fast 抛 `WebUnsupportedError`（杜绝 undefined 穿透）；`then` 特判防 thenable 探测陷阱
  - `wails/types.ts` AppBindings 类型独立文件（打破 app↔adapter 循环引用）
  - `web.html` 声明 `__YSM_BACKEND__="browser"`（Tier 0 权威信号）
  - 验证：全量 1627 测试通过 + typecheck 零错 + web 构建产物正常
- **Phase 2 browser adapter**：IndexedDB `dir:*:` 前缀模拟目录结构（模型库）+ `outfit:*:` 文件读 + `web://` 路由（对齐 MikuMikuAR ADR-177）；`localStorage` 配置；File API/拖拽导入；下载用 `<a download>`。✅ **已完成（2026-08-10）**：
  - `wails/idb.ts`：openDB 惰性单例 + idbGet/idbSet/idbDel/idbKeys 前缀扫描（onabort 处理 QuotaExceeded）；IndexedDB 不可用（非浏览器/隐私模式）自动降级内存 Map（应用不崩）
  - browserAdapter 真实实现：ScanModelEntries（IDB dir: 前缀 → ModelEntry，Path 指向主文件）/ ReadFileBytes（`/web/<type>/<name>/<rel>` → base64，wasm.ts 解码链零改动复用）/ GetRepoRoot/GetDefaultRepoRoot（虚拟根 /web）/ LoadAppConfig/SaveAppConfig（localStorage）
  - `importWebFiles(files, type)`：File API → IDB（dir + file 双记录），返回 {imported, failed}（Phase 3 接拖拽 UI）
  - model3d-loader WASM 兜底守卫扩展 `getAndroidBridge() || resolveWebMode()`（网页版 spec 空走前端 WASM 解码；**P2-2 于 2026-08-12 闭环**，见下方「Phase 2 审核遗留」）
  - 验证：全量 1636 测试通过 + typecheck 零错

  **Phase 2 审核遗留（2026-08-10 三路子代理并发审核，commit 见 `fix: ADR-049 Phase 2 审核 P1 修复`）**：
  初审结论「Phase 2 完成」偏乐观，数据层/适配层/集成三路审核共发现 5 处 P1，已全部修复：

  | # | 问题 | 修复 |
  |---|------|------|
  | P1-1 | 真实列表入口是 `ScanModelEntriesWithLabel`（loader/import-queue/resource-manager 等 6 处调用），原仅实现 `ScanModelEntries` → 网页版模型库永不可见 | 补齐 `ScanModelEntriesWithLabel` 到 webImpls |
  | P1-2 | `scanWebModels` 的 `Name` 不含扩展名、硬编码 `Ext: ".ysm"`，偏离桌面 `scanner.go:136 Name=filepath.Base(p)` 含扩展名 → `loader.ts` 的 `name.endsWith(ext)` 过滤恒失败、列表空 | `Name` 取主文件 rel（含扩展名）、`Ext` 由主文件推导；主文件优先选 `.ysm/.json`，跳过孤儿 dir |
  | P1-3 | `SaveAppConfig` 存 `rpRoot` 但消费方读 `resourcepackRoot`，且整体覆盖对象字面量会抹除 `ysmRoot/shaderpackRoot` 等 | 字段改名 `resourcepackRoot`，`spread` 旧配置 + 空串保留旧值（对齐桌面 orDefault） |
  | P1-4 | `GetModel3DSpec` 未注册 → `model3d-loader` 在抵达 WASM 兜底守卫前抛 `WebUnsupportedError` 逃逸，3D 预览必崩 | 注册 `GetModel3DSpec → "{}"`（恒空，让守卫可达） |
  | P1-5 | `web-platform.ts` 为 Phase 1 遗留死代码（无任何引用），且 `resolveWebMode` 语义与 canonical 的 `platform.ts` 分叉（`declared='go' + MODE='web'` 误判 true） | 删除 `web-platform.ts`，funcmap 索引已同步重生成 |

  另修 P2：`idb.ts` 原 `openDB` reject 后 `dbPromise` 持 rejected promise 令后续调用永久失败；Firefox 隐私模式 `indexedDB` 存在但 `open()` 抛错不降级 → 现 `getIdb()` 捕获后置 `forcedMemory` 改走内存分支，单例失败可恢复。适配层 Proxy 补 `has` 陷阱 + fail-fast 稳定引用（供 Phase 3 能力门控 `'X' in adapter` 探测）。

  **✅ P2-2 已闭环（2026-08-12）**：`Build3DSpecFromGeometryJSON` 的「几何 JSON→spec」变换以**纯 TS 移植**到 `frontend/src/utils/3d/spec-builder.ts`（契约镜像 `internal/app/app_model.go`，双边测试锁定：`spec-builder.test.ts` ↔ `app_model_test.go`）。网页版渲染路径：
  - `model3d-loader.ts` 的 `fetchSpecViaWasmFallback` 在 `resolveWebMode()` 分支直接调 `buildSpecFromGeometryJSON(geometryRaw)`（不再依赖 Go binding），`decodeYsmViaWasm`（base64 → geometryRaw）→ TS spec 构建 → Three.js 渲染全链路闭环；
  - `browser-adapter.ts` 的 `Build3DSpecFromGeometryJSON` 保留 `"{}"` 桩仅作 Android 兜底通道的形状占位（网页版不会调用）；
  - 实现路径与原计划（移植到 ysm-parser WASM）不同——**TS 移植**成本更低、与 Go 契约可直接双边对拍，WASM 路线放弃。
- **Phase 3 能力门控 + UI 降级**：C 类桌面专属 binding（自更新/系统对话框/资源管理器/剪贴板等 9 个）隐藏对应按钮；B 类写操作降级语义逐项定义（导入→IndexedDB/浏览器下载；回收站/硬链接/重链→不可用隐藏）。✅ **门控主体已完成（2026-08-10）**：
  - `isViewerMode()`（android-bridge.ts）：Android 双端桥 || 网页版 browser adapter 统一判定（Tier 0 `__YSM_BACKEND__` 权威信号，误嵌 WebView 强制走 web）
  - 门控改造 6 处：设置页隐藏游戏目录/链接模式卡片（tpl）、自更新跳过（version-updater）、树「打开/导入文件夹」+ 资源管理器「打开文件夹」走 `resolveAndroidRepoDir`（网页版定位虚拟根 /web）
  - 网页版拖拽导入：`import-queue` drop 分支 → `importWebFiles` 写 IndexedDB + toast + tree:reload
  - 验证：全量 1654 测试通过 + typecheck 零错
- **Phase 3 主 UI 网页版集成** ✅（2026-08-10 二次提交）：web 构建入口接 `index.html` 全量界面
  - `vite.web.config.ts` 双入口（index.html 主 UI + web.html Spike）+ `mode: "web"`；主 UI 不写死全局标记，靠 Tier 1 `MODE=web` 判定路由到 browserAdapter
  - ⚠️ **踩坑**：`import.meta.env?.MODE`（可选链/中间变量）编译后变成 `(t=import.meta.env)==null?void 0:t.MODE`，vite 的 `define` 是文本替换匹配不到原文 → `mode:"web"` 不生效（WebView 下实测 404 `/wails/runtime`×7）。修：`platform.ts` 直接写 `import.meta.env.MODE === "web"`（无中间变量）
  - 全局 DnD 补网页版分支（`import-dnd.ts`）：拖到任意位置 → `importWebFiles` 写 IDB + toast + tree:reload（与 import-queue drop 分支同语义）
  - 全链路实测（Playwright 冒烟）：主 UI 加载无 404/无报错 → 拖拽导入 `dir:`/`file:` 双记录落 IDB → 树刷新显示模型
  - **P2-2 闭环（2026-08-12）**：3D 预览的 spec 构建走纯 TS 移植 `spec-builder.ts`（model3d-loader web 分支），`browser-adapter` 的 `"{}"` 桩降级为 Android 形状占位
  - **Web 端 e2e 固化** ✅：`playwright.web.config.ts`（vite dev --mode web 双 webServer）+ `e2e-web/web-smoke.spec.ts` 3 用例（主 UI 加载零 Wails runtime 请求 / 拖拽导入 IDB 双记录 + 树刷新 / 幂等覆盖写），跑法 `npm run test:e2e:web`
  - **GitHub Pages 部署配置** ✅（2026-08-10）：`pages-deploy.yml` build job 增 Web 版构建（`WEB_BASE=/ysm-model-manager/app/`，注意 git-bash 需 `MSYS2_ENV_CONV_EXCL="WEB_BASE"` 防路径转换）+ 合并 `dist-web → docs/.vitepress/dist/app`；文档站首页加 /app/ 入口；`npm run build:web` 脚本。**待推送生效**（线上 URL 验证后状态转已采纳）
  - **部署冲突修复**（2026-08-11）：`docs/app/index.md` 占位页与 web 产物同路径 `app/` 冲突——VitePress 渲染该页到 `dist/app/index.html` 后，`cp -r dist-web dist/app` 因目标已存在把 dist-web 复制成 `dist/app/dist-web/` 且不覆盖旧 index.html，线上 `/app/` 仍返回「开发中」占位页而非 App 入口。修复：删除 `docs/app/index.md`（/app/ 归纯 Web App 入口独占）+ CI 合并步骤改「先 `rm -rf dist/app` 再 `cp -r`」防路径残留。

**明确不做**：
- 不引入服务端（B 方案纯静态托管；如需完整写能力再评估 C）
- 不做桌面/网页数据互通（IndexedDB 与本地文件系统隔离，提供导入/导出 JSON 模型库清单）
- 网页版与 Android 同属「查看器模式」定位（读模型 + 3D + 轻管理），完整编辑/管理仍以桌面为准

## 3. 后果（Consequences）

**正面**：
- 三端同一代码库（桌面 / Android / 网页），WASM、3D、bus、i18n、Web Components 零改动
- 网页版 = 免费「模型库在线查看器」，可 GitHub Pages 静态托管
- 复用 MikuMikuAR 已验证路径（ADR-176/177），风险低于从零探索

**负面**：
- 约 40 个 B 类写操作 binding 需逐一定义降级语义（工作量集中在 Phase 2/3）
- IndexedDB 模型库与桌面文件系统不互通（需导出/导入机制）
- 大模型文件（.ysm 数十 MB）经 base64/Blob 在浏览器内存中处理，性能与内存受浏览器限制（ADR-029 内存解析在浏览器同样适用，需实测阈值）

**已知遗留**：
- 能力门控清单待 Phase 3 定稿（对齐 MikuMikuAR「capabilities() 是契约非完整 UI 门控」）
- Web 端 e2e 回归（Playwright 双 webServer：桌面 dev + web preview）参考 MikuMikuAR 的 `web-smoke.spec.ts` 模式
- iOS（P3）与本网页版共用 Phase 1 适配层，实施时复用

## 4. 数据溯源

| 来源 | 结论 |
|------|------|
| 子代理侦察（sa_20260810_111123，只读全量调查） | `getApp()` 依赖面 80 binding：A 类数据获取 ~28（可 fetch/File API/IndexedDB 替代）、B 类写操作 ~40（需降级）、C 类桌面专属 ~9（删除/降级）、D 类事件 12（6 个 Android 专属 + 4 个下载 + 2 个桌面，均前端可替代）；bus 事件系统、3D 渲染核心（Three.js + WASM）、Web Component UI、i18n 纯浏览器零改动 |
| `frontend/src/wasm/ysm-parser.ts:2` | WASM base64 注入方案专为规避 WebView2 fetch 限制设计，跨 WebView/浏览器天然兼容 |
| `docs/adr/ADR-029` | WASM 内嵌决策（✅ 已采纳）：内存解析优先 + Go CLI 兜底 |
| MikuMikuAR `docs/adr/adr-176*`/`adr-177` | backend 适配器双实现（106 函数代理化、resolveBackend 路由）、IndexedDB 三路路由、能力门控、GitHub Pages 上线实测 |

<!-- 文件名: web-edition-bridge.md → 实际文件 ADR-049-web-edition-bridge.md -->
