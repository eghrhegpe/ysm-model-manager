---
kind: extensibility-index-reconciliation
name: 可拓展点索引对账（vs HEAD @ d517113c…）
tier: architecture
category: config
use_when:
  - 拓展点对账
  - 落地状态
  - ADR 闭环
affected: false
---

<!-- 拓展点索引对账（2026-08-17）——逐条核对 extensibility-index.md 中「可拓展点」与当前 HEAD（含 ADR-064/065/067/068 + web M1/M2 + 硬编码清理）的落地状态。仅调研不改代码。 -->

# 可拓展点索引对账（vs HEAD @ d517113c…）

> 索引版本：2026-08-15（第 1 批，6 个 explore 子代理产出，323 行）
> 对账口径：以 grep 实测为准（行号以当前 HEAD 漂移后为准）。
> 状态标签：`[已闭环 <commit>]`（索引描述的问题已消失或已落地）/ `[存活]`（索引描述的问题仍存在，给出现行行号）/ `[部分]`（部分落地部分仍存活）/ `[N/A]`（该条目已裁决独立立项或 spike 定位，不计入统计）。

## 一、跨模块 Top 10（价值高，逐条核对）

| # | 索引条目 | 状态 | 当前证据（文件:行号） |
|---|---------|------|----------------------|
| 1 | `model3d.ts` RenderSession 完整对象化（陷阱 #11 已独立立项） | **N/A** | `frontend/src/features/preview-3d/model3d.ts` 仍存在；按索引原文「已裁决独立立项待启动」处理，不计入 Top 10 对账 |
| 2 | 两套检测器 `importer_file.go` + `mcmeta.go` 均应注册表驱动 | **部分** | 现状（2026-08-26 更新）：`go/packs/mcmeta.go` `DetectResourceType` 已薄壳委托 `types.ClassifyResource`；`go/importer/importer_file.go` `DetectZipType` 收集全条目名后委托 `types.DetectByEntries`（commit `bc95fbb4` 三套编排收敛）。**分类核心已统一于 `types` 包**，`resource_types.json` 字段驱动不变（ADR-067 闭环）。但 `go/repoaudit/repoaudit.go` `Classify` 仍自有实现（**有意保留**：审计口径遇未知容器标 `container`，与导入口径 content-fingerprint 语义不同），故「完全合并为单一入口」未达成。回归护栏见 [classify_routing](./classify-routing.md)（golden/isolation/order + schema 守卫 4/5，commit `634fb63f`）。|
| 3 | 文件夹级判定 6+ 处硬编码 | **已闭环 ADR-064/065** | `go/sync/sync_push.go` 均改调 `types.IsDirLevelSync(rtype)`；`go/sync/sync_relink.go` 用 `types.IsDirLevelSync(rtype) && types.IsTypeModelFile(base, rtype)`；`go/sync/sync_dirlevel.go` 用 `types.IsTypeModelFile`；`go/instance/instance.go` 用 `types.FindInstDir`（注册表驱动）。`isSyncAllowed/isModelFile/extMatch/syncNameKey` 全部收敛进 `types/`（`NormalizeResourceName`/`IsResourceAllowed`/`IsTypeModelFile`/`IsDirLevelSync`）。 |
| 4 | `fsutil/` `copyFile×6` / `copyDirRecursive×4` 重复 | **部分** | `go/fsutil/copy.go` 已定义统一 `CopyFile` + `CopyDirRecursive`（注释明确「收敛自 fileops/recycle/importer/sync 四份」）。`installer.copyFileLocked` 已收敛为 `fsutil.CopyFile` 委托 + `StepError` 步骤类型化错误（ADR-044 策略 A：机制归 fsutil、文案归 installer）。仍保留 6 处本地 wrapper：`sync.copyFile`、`recycle.copyFile`、`importer.copyFile`、`fileops.copyFile`、`updater.copyFile`、`cmd/updater.copyFile`——多数为薄包装/不同语义，未完全消除。 |
| 5 | `ShouldHashExt` + scanner CI 清单硬编码 | **已闭环** | `go/types/extensions.go` `ShouldHashExt` 现按 `ResourceType.Hashable` 字段判定（注释：「注册表驱动：任何声明 hashable 的资源类型扩展名均计入哈希」）。`Hashable` 字段在 `go/types/resource.go` 已定义。`go/types/types_extra_test.go` `TestShouldHashExt_PinnedList` 钉住 `.ysm/.zip/.7z/.json/.nbt/.schematic/.litematic`，并测大小写不敏感。scanner 不再维护独立清单。 |
| 6 | `browser-adapter.ts` 40+ binding 手写大对象字面量 | **已闭环 ADR-049/web M2 (93cb0e8b)** | `frontend/src/backend/browser-adapter.ts` 现 `webImpls = { ...webCommonBindings, ...webFsBindings, ...webStoreBindings, ...webCommunityBindings }`；各职责模块自注册片段（`web-common.ts`、`web-fs.ts`、`web-store.ts`、`web-community.ts`）。`browser-adapter.ts` 95 行，退化为「编排/入口」薄壳。 |
| 7 | `import-dnd.ts` 4 处重复 | **已闭环 web M1 (93cb0e8b)** | `frontend/src/features/import-executor.ts` 定义 `importWebFilesWithToast` 单点；`import-dnd.ts` 与 `import-queue-events.ts` 全部改为调用 `importWebFilesWithToast`。`stats:refresh` 已统一在 `import-executor.ts` 发出（原 folderInput 分支缺失已修复）。 |
| 8 | `app-modules.ts` 5 处 catch 模板逐字重复 | **已闭环** | `frontend/src/app-modules.ts` `loadView(name, importer)` 单点封装，5 处调用：`app-tree/sidebar/content/resource-manager/sync-manager`。 |
| 9 | `ResourceType` 无 hook 字段 | **部分** | `go/types/resource.go` `ResourceType` 现含 `Detector`/`ConfigField`/`ConfigFallback`/`IsDir`/`Hashable`/`DirLevelSync`/`ScanInstance`/`InstallExts`/`ZipEntries` 等 9 个可驱动行为的字段；`Detector` 字段实际充当「handlerRef」字符串。但**无显式 `plugin`/`handlerRef` 指针类型**（无代码级 hook 接口），仍靠字符串分发。索引原文「增加 plugin/handlerRef 字段」的部分诉求（可注册表驱动）已满足；显式接口化未完成。 |
| 10 | `/web` 路径正则 5 处 | **已闭环** | `frontend/src/backend/web-common.ts` 集中导出 `WEB_DIR_RE`/`WEB_NAME_RE`/`isWebPath`/`parseWebPath`/`parseWebDirPath`/`webDirType`；注释明确「Top 10 收敛：原 /web 正则散落 5 处」。`web-fs.ts`/`web-community.ts`/`browser-adapter.ts` 全部改调 `web-common.ts`。 |

**Top 10 小计**：已闭环 4 条（#3/#5/#6/#7/#8/#10 = **6 条**）；部分 3 条（#2/#4/#9）；N/A 1 条（#1）。

---

## 二、一、`frontend/src/backend/`

| 索引位置 | 状态 | 当前证据 |
|---------|------|---------|
| 1.1 `app.ts` 绑定路径硬编码 | **存活** | `frontend/src/backend/app.ts` 的 import 路径仍以 `../../bindings/...` 硬编码，未抽注入常量 |
| 1.2 `app.ts` 三分支 if 链 | **存活** | browser→`window.go.main.App`→动态 import 三分支 if 链未见合并；未查近期改动触及。 |
| 1.3 `types.ts` 与 1.1 同源硬编码 | **存活** | `frontend/src/backend/types.ts` 仍 `typeof import("../../bindings/...")`，与 1.1 同源。 |
| 1.4 `browser-adapter.ts` 40+ 字面量 | **已闭环 (93cb0e8b)** | 见 Top 6。 |
| 1.5 `WebImplGoKeys` 白名单字面量 | **已闭环 (93cb0e8b)** | `browser-adapter.ts` 现 `Exclude<keyof typeof webImpls, "SelectLocalRepo"|"GetFsaAuthState">`，白名单从结构推导。 |
| 1.6 `GetAppVersion/CurrentVersion` 硬编码 "web" | **部分** | `web-common.ts` 现返回 `__APP_VERSION__`（vite define 注入），回退值仍是 `"web"`（注释承认）。桌面端 `WEB_VERSION` 由发版脚本传，未传时仍分叉。 |
| 1.7 `GetRepoRoot` rtype 净化正则内联 | **存活** | `web-fs.ts` 仍 `rtype.replace(/\//g,"_")` 内联。 |
| 1.8 `web-fs.ts` 多处（IDB key 规约、mainFileRank、importWebFiles、INVALID_NAME_CHARS） | **部分** | `.7z` 过滤已加（`web-fs.ts` `sevenZCount` toast）；importWebFiles 已单点。但 IDB key `dir:/file:/ban:/tags:` 仍跨 `web-fs.ts`/`web-store.ts`/`idb.ts` 字符串耦合；`INVALID_NAME_CHARS` 仍硬编码。 |
| 1.9 `web-store.ts` 硬编码常量 + 日志环 | **存活** | `WEB_IMPORT_LOG_CAP=500`/`WEB_RUNTIME_LOG_CAP=300`/`CFG_KEY` 仍在（未 grep 到参数化）。无持久化 sink、无订阅通知（日志能力缺口仍在）。 |
| 1.10 `web-community.ts` 三份 localStorage 模式 | **部分** | 3 个社区写入方法（`writeWebCreators`/`writeWebSites`/`writeWebGitHub`）独立实现，结构相似但未抽 `createLocalJsonStore` 工厂。ADR-066 头像缓存补写已落地。 |
| 1.11 `idb.ts` 无版本化迁移 + 重复 transaction 样板 | **存活** | 未查改动触及。 |

---

## 三、二、`frontend/src/features/preview-3d/`（20 条，主要为硬编码常量）

| 索引位置 | 状态 | 当前证据 |
|---------|------|---------|
| 2.1-2.23 | **基本全部存活** | 近期 ADR-064/065/067/068 与 web M1/M2 均不触及 3D 管线。随机抽验：`bone-list.ts` 仍 `models[0]`；`bone-raycast.ts` 仍 `"__root__"` 哨兵；`camera-control.ts` 拖拽 `0.003` 仍写死；`quaternion.ts` `isIdentityQuat` 未被 2.15 三处复用。**Top 1（RenderSession 对象化）仍独立立项未启动**。 |

（注：2.x 条目价值多为「低」，本轮改动未触及其代码区；如需进一步确认可逐条 grep。）

---

## 四、三、`frontend/src/views/`

| 索引位置 | 状态 | 当前证据 |
|---------|------|---------|
| 3.1-3.3 | **基本存活** | 站点分组、preview 模块重复、virtual-scroll 常量等，本轮无相关改动。 |

---

## 五、四、`frontend/src/core+features+services+utils/`

| 索引位置 | 状态 | 当前证据 |
|---------|------|---------|
| 4.1 `import-queue-data.ts`/`events.ts` 表单字段 id 列表 4 处 | **部分** | 表单字段注册化未落地（未 grep 到），但 4.1 中「覆盖导入」30 行重复与 `commitImportSuccess` 未见抽离。 |
| 4.2 `errMsg.includes("FILE_EXISTS")` 字符串匹配 | **存活** | `features/import-executor.ts` + `import-queue-events.ts` 未见改为 `AppError.Code` 消费。 |
| 4.3 `oldest-models` + `recycle-bin` 各自实现 `useCurrentResourceType` 模式 | **存活** | 未见抽离的 `useCurrentResourceType()`；两文件仍各实现。 |
| 4.4 `version-updater.ts` `CHECK_INTERVAL=6h`/`CHECK_TIMEOUT=30s` | **存活** | 硬编码阈值仍在。 |
| 4.5 `services/registry.ts` 仅 2 服务 | **存活** | 仍为 2 服务名；未泛型化。 |
| 4.6 `animation.ts` 通道名字面量重复 4 次 | **部分** | `animation.ts` 已抽 `const BONE_CHANNELS` 单点；但多处是否改调用 `BONE_CHANNELS` 未逐一验证（索引所指 4 处可能仍未替换）。Molang 求值正则链未见可注入化。 |
| 4.7 `display.ts` parseModelName/renderDisplayName 括号风格 | **部分** | `display.ts` 注释「parseModelName / renderDisplayName 共用，新增/调整括号风格只改本表」——共享表已存在，但具体括号风格是否注册表化（vs 硬编码表）仍待核。 |
| 4.8 `modal.ts` 5+ modal 脚手架重复 | **存活** | 未见 `createDialog` 工厂。 |
| 4.9 `rename-format.ts`/`batch-rename-util.ts` 两套模板 | **存活** | 未见单一命名模板引擎。 |
| 4.10 `errors.ts` `CODE_KEYS` 手写映射 | **存活** | 未见从 Go AppError 生成。 |
| 4.11 `pack-format.ts` 86 条静态表 + `n > 88 ? "最新版本"` 魔数 | **存活** | 未见抽 JSON + 自动更新。 |
| 4.12 `icon.ts` 归档/图片/文本兜底 | **存活** | 未见与 `RESOURCE_EXTS` 合并。 |

---

## 六、五、`go/avatar+geometry+litematic+ysm/`

| 索引位置 | 状态 | 当前证据 |
|---------|------|---------|
| 5.1 `avatar/*` 多处硬编码 | **部分** | 头像提取走注册表化（`c30fb366`：`ScanLocalAuthors` 注册表化），但具体硬编码常量未逐条核。 |
| 5.2 `geometry/archive.go`/`parse.go` 解析管线 | **部分** | ADR-068 `geometry` 1024→730 行删除 7z 对称主体，zip/7z/目录统一容器桥接（`go/container`）；zip 指纹已走 container。但仍可插件化。 |
| 5.3 `litematic/` NBT 解析器固定管线 + `block_colors` 静态表 | **存活** | 未见改动触及。 |
| 5.4 `ysm/` 解码管线多处魔数 | **存活** | 未见改动触及。 |

---

## 七、六、`go/fileops+importer+...`

| 索引位置 | 状态 | 当前证据 |
|---------|------|---------|
| 6.1 | 见 Top 2（部分） | |
| 6.2 | 见 Top 3（已闭环） | |
| 6.3 | 见 Top 4（部分） | |
| 6.4 | 见 Top 5（已闭环） | |
| 6.5 | 见 Top 9（部分） | |
| 6.6 `MaxImportSize=500MB` 三方引用 | **存活** | `go/types/extensions.go` 仍硬编码常量（虽含 `MaxImportSizeMB` 派生，仍为编译期常量，未进 `AppConfig`）。 |
| 6.7 `AppConfig` 缺扫描 TTL/日志上限/下载超时 | **存活** | `go/types/config.go` 仅含 `Mirror/VoxelMaxBlocks/LinkMode`。 |
| 6.8 `dedup.go`/`recycle.go`/`instance.go` 成对重复 | **存活** | 未 grep 到本轮清理。 |
| 6.9 `updater.go` 硬编码 | **存活** | 未 grep 到本轮改动。 |
| 6.10 `logs.go`/`runtime.go` 硬编码阈值 | **存活** | 未 grep 到参数化。 |
| 6.11 `threejs/spec.go` texW/texH 默认 64 | **存活** | 未 grep 到本轮改动。 |
| 6.12 其余低-中价值项 | **存活** | 大部分未触达。 |

---

## 八、七、`frontend/src/wasm+根+test-utils/`

| 索引位置 | 状态 | 当前证据 |
|---------|------|---------|
| 7.1 `wasm/ysm-parser.ts` patch 点硬编码 | **存活** | 未见版本感知适配层。 |
| 7.2 `ysm-parser.ts` 两条固定解码策略 | **存活** | 未见 `decodeStrategies` 注册表。 |
| 7.3 崩溃分类正则重复 + 口径漂移 | **存活** | 未见 `classifyWasmError` 分类器。 |
| 7.4 `app-modules.ts` 5 处 catch 模板 | **已闭环** | 见 Top 8。 |
| 7.5 `THEME_VALID` 与 `classList.remove(...)` 双份 | **已闭环** | `app-modules.ts` 现 `THEME_CLASSES = THEME_VALID.filter(...).map(...)` 由白名单推导。 |
| 7.6 `initTheme` try/catch 两分支重复 | **部分** | `app-modules.ts` 仍保留两个 try/catch 分支（catch 兜底），但共用 `normalizeTheme`+`applyTheme`；「四步完全重复」未单路收拢。 |
| 7.7 `system` 深/浅映射硬编码 | **存活** | `app-modules.ts` 仍 `prefersDark ? "theme-cyber" : "theme-warm"` 硬编码映射。 |
| 7.8 跨文件主题默认值漂移（"dark" 不在白名单） | **部分** | `app-modules.ts` `normalizeTheme` 已存在并将非法值归一；但 `init.ts`/`path-cards.ts`/`theme.ts` 处 `|| "dark"` 仍可能注入，靠 `normalizeTheme` 兜底——已消隐患，但未源头修正。 |
| 7.9 `bus.ts` `VOID_EVENTS` vs `emit` 内手抄 | **存活** | 未见改调 `isVoidEvent(event)`。 |
| 7.10 `bus.ts` 无通配符监听/emit 钩子 | **存活** | 未见 `bus.on("*")`。 |
| 7.11 `BusEvents` 闭联合表 | **存活**（索引原文也标为特性非缺陷） | |
| 7.12 `test-utils/index.ts` `waitFor`/`waitForElementToBeRemoved` 重复 | **存活** | 未见抽 `pollLoop`。 |
| 7.13 `test-utils/render.ts` 轮询间隔 + 就绪条件 | **存活** | 未见 `RenderOptions.ready` 钩子。 |
| 7.14 `test-utils/events.ts` `fireDrop`/`fireDrag` 注入重复 | **存活** | 未见 `injectDataTransfer`。 |
| 7.15 `web-spike/main.ts` | **N/A**（spike 定位） | |

---

## 对账摘要（≤15 行）

- **Top 10**：6 条已闭环（#3 文件夹级判定/ #5 ShouldHashExt / #6 browser-adapter 字面量 / #7 import-dnd 重复 / #8 app-modules catch / #10 /web 正则）；3 条部分（#2 双入口检测器 / #4 copyFile 6 副本 / #9 ResourceType hook 字段）；1 条 N/A（#1 RenderSession）。
- **一、backend**：10 条中 3 已闭环（1.4/1.5/1.6 半）、3 部分、4 存活。
- **二、features/preview-3d**：20+ 条基本全部存活（本轮 ADR 未触及 3D 管线）；Top 1 独立立项未启动。
- **三、views**：3 条全部存活。
- **四、core+features+services+utils**：12 条中 2 部分（4.6 BONE_CHANNELS、4.7 display）、10 存活。
- **五、avatar+geometry+litematic+ysm**：2 部分（头像/geometry ADR-068 已落地容器桥接）、2 存活。
- **六、Go 其他**：6.1/6.3/6.5 部分、6.2/6.4 已闭环（同 Top 3/5）、其余 8+ 存活。
- **七、wasm+根+test-utils**：2 已闭环（7.4/7.5）、3 部分（7.6/7.8 半）、1 条 N/A、10 存活。
- **对账结论**：Top 10 中 60% 已由近两天 ADR 闭环；硬编码清理集中在 sync/registry/importer/browser-adapter 主线；3D 渲染管线、test-utils、wasm 胶水层、低价值 Go 常量（`MaxImportSize`/`CHECK_INTERVAL`/`logs` 阈值）是**本轮未触及的剩余拓展点**，可留待下一批对账。
