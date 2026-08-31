---
kind: extensibility-round2
name: 拓展点 / 扩展入口 探索报告（Round 2）
tier: architecture
category: config
use_when:
  - 新增资源类型
  - 新增文件格式
  - 新增网页桥接
  - 新增同步逻辑
  - 残留手改清单
affected: false
---

# 拓展点 / 扩展入口 探索报告（Round 2）

> 范围：基于 `resource_types.json` 单一事实来源 + ADR-064/066/067/068/069 新抽象（2026-08-16 ~ 08-17 落地）+ `docs/knowledge/extensibility-index.md`（8-15 产出，已部分过时）。
> 只调研不改代码。结论 = 新增东西时"改哪里 / 会不会自动生效 / 残留手改清单"。

---

## 1. 新增资源类型（如 "potion-3d" / "custom-model"）

### 入口 & 机制

| 维度 | 入口（文件:行） | 自动生效？ | 机制 |
|---|---|---|---|
| JSON 声明 | `resource_types.json` | ✅ | 在 `resourceTypes` 数组末尾追加条目 |
| Go 注册表 | `go/types/resource.go`（`ResourceType` struct） | ✅ | 所有字段（含 `hashable/dirLevelSync/zipEntries/installExts/scanDir/preview/detector`）均已定义 |
| Go 检测 | `go/packs/mcmeta.go`（`DetectResourceType`） | ✅（zipentry / extension / ""） | switch 覆盖 `ysm/mcmeta/shader/zipentry/extension/空`——zipentry 与 extension 全走注册表 |
| 内容指纹 | `go/packs/mcmeta.go`（`matchZipArchive`）+ `container.Open` | ✅ | `.zip/.7z` 均走 `container.Open` 统一打开（ADR-068）→ 按 `rt.ZipEntries` 匹配 |
| 导入器 | `go/importer/importer_file.go`（`DetectZipType`） | ✅ | 注册表驱动；zipEntries 命中即定类型 |
| 安装白名单 | `go/types/extensions.go`（`InstallExtsFor`） | ✅ | 空 = 全部放行（仅可执行文件黑名单除外）；`installer.InstallDir` 已走此 |
| 哈希 | `go/types/extensions.go`（`ShouldHashExt`） | ✅ | `hashable:true` 即参与；`types_extra_test.go` 钉住清单 |
| 目录型同步 | `go/types/extensions.go`（`IsDirLevelSync`） | ✅ | `dirLevelSync:true` → `SyncResourcesDirLevel` |
| 前端 RESOURCE_TYPES 键 | `frontend/src/utils/resource/types.ts`（`RESOURCE_TYPES`） | ❌ 手改 | 需加键值（如 `POTION: "potion-3d"`） |
| 前端短标签 | `types.ts`（`RESOURCE_TYPE_LABELS`） | ❌ 手改 | 参与 Go `ScanModelEntriesWithLabel` 匹配 |
| 前端派生能力 | `types.ts`（`RESOURCE_CAPS`） | ✅ | 从 JSON 派生 extensions/preview/icon |
| 预览派发 | `frontend/src/views/app-preview/index.ts`（`PREVIEW_HANDLERS`） | ❌ 手改 | ADR-072 已把 if 链换成注册表查表，但 handler 注册仍需手工一行 |
| 侧栏菜单 | `frontend/src/views/app-sidebar/tpl.ts` | 部分自动 | `ALL_RESOURCE_TYPES` 驱动子菜单生成，但顶部模型 tab 是手写的 |
| 图标 | `frontend/src/utils/icon/icon.ts`（`fileIcon`） | ❌ 手改 | `fileIcon` 手写表 |

### 步骤（新增 "potion-3d"，扩展 `.p3d/.zip`，内容指纹 `potion.json`）

1. `resource_types.json` 末尾追加：
   ```json
   { "id":"potion-3d","name":"药水模型","icon":"🧪","extensions":[".p3d",".zip"],
     "storageSubDir":"potions","configField":"PotionRoot","installDir":"potions/","scanDir":"potions",
     "instanceLevel":false,"preview":"3d","detector":"zipentry","hashable":true,"dirLevelSync":true,
     "zipEntries":[{"name":"potion.json","match":"exact"}],
     "actions":["view","import","delete"] }
   ```
2. `go/types` 无需改；`DetectResourceType` 已覆盖 `zipentry`；`MatchZipEntry` 会自动命中。
3. `go/types/types_extra_test.go` 补 `TestShouldHashExt_PinnedList` 断言（.p3d 应被哈希）。
4. 前端：`types.ts` 加 `POTION: "potion-3d"`；`types.ts` 加标签；`icon.ts` 加图标；`app-preview/index.ts` 加一行 `PREVIEW_HANDLERS`。
5. `app-sidebar/tpl.ts` 顶部模型 tab 手写补一行；其余菜单条由 `ALL_RESOURCE_TYPES` 自动补。
6. `go/internal/app` 若新增 AppConfig 字段（如 `PotionRoot`），需重新 `npm run generate:bindings`。

### 坑 / 残留

- **detector 仅支持 5 种**（`ysm/mcmeta/shader/zipentry/extension/空`）。新的二进制格式（非 ZIP 内容指纹型）必须自己写 `isXxxFile` 并加入 switch，无法仅靠 JSON 声明。
- **`.json` 特判锁死在 `IsYsmEntryJSON`**——新增类型若想允许 `manifest.json` 作为入口，需扩 `IsYsmEntryJSON` 或改 `IsTypeModelFile`。
- **`ShouldHashExt` 钉住清单**：新增 hashable 类型需补单测，否则清单漂移会静默。
- **前端三处必改**：`RESOURCE_TYPES`（键映射）/ `RESOURCE_TYPE_LABELS`（短标签）/ `icon.ts`。这三处与 JSON 无派生关系，是**最痛残留**。
- **`PREVIEW_HANDLERS` 每加一行**：无 handler → 预览区静默空白（fail-fast 未覆盖预览派发）。
- **i18n**：`rtype.potion` 等显示名需补 `zh-CN/en/ja` 三个语言包（前端 AGENTS 规则）。
- **作者/头像扫描**：`web-community.ts` 的作者采集逻辑按 `ALL_RESOURCE_TYPES` 走（`collectAllWebEntries`），新类型自动纳入；桌面端作者扫描若走硬编码类型清单则需改。
- **`MaxImportSize=500MB` 硬编码**，新类型若需大文件（如 3D 场景）需改常量或改走 AppConfig。

---

## 2. 新增文件格式（新容器 / 新解析）

### 入口 & 机制

| 维度 | 入口 | 自动？ | 备注 |
|---|---|---|---|
| 容器桥接 | `go/container/container.go`（`Entry/Reader` 接口） | 需加实现 | 现有 zip / 7z / 目录 三种适配器 |
| 打开分派 | `container.go`（`Open`） | 需加 switch | `ext == ".zip" || ".7z" || info.IsDir()`，其他扩展返回"不支持" |
| 内容指纹 | `container.go`（`matchZipArchive`） + `types.go`（`MatchZipEntry`） | 自动（对已有容器） | `matchZipEntry` 只认已注册的容器打开器 |
| 前端 WASM 预览 | `frontend/src/preview-3d/decoder/wasm-decode.ts` + `preview-3d/adapters/` | 需加适配器 | YSM/WASM 硬编码 `.ysm`；Litematic/VRM/MMD 有独立适配器 |
| 预览派发 | `app-preview/index.ts`（`PREVIEW_HANDLERS`） | 需加 handler | 统一核心（D2，mount-preview-core）尚未落地——目前仍是每格式独立 adapter |

### 步骤

1. **新容器格式**（如 `.tar` / `.ogg` 内含 asset）：
   - `go/container/container.go` 新增 `tarEntry`/`tarContainer` 结构体（实现 `Entry/Reader` 接口）。
   - `Open` switch 补 `.tar` 分支 → 调 `OpenTarPath`。
   - 自动获得 `MatchZipEntry` 内容指纹匹配能力。
2. **新解析**（如 `.vrm` 的完整解析，目前仅做 meta 卡）：
   - 前端：在 `preview-3d/adapters/` 新增 `vrm-adaptor.ts`（或扩 `vrm-3d.ts`），实现统一 `decode/preview` 接口。
   - `app-preview/index.ts` 挂 `PREVIEW_HANDLERS`。
3. **预览核心统一**（ADR-066 D2，"mount-preview-core"）：
   - 尚未落地；当前 `YsmAdapter/LitematicAdapter/VRMAdapter/MmdAdapter` 各自独立。建议把 `PreviewCtx` + `showXxx` 收敛到 `mountPreview(ctx, adapterFn, config)`。

### 坑

- **容器格式扩展需新增 Go 包依赖**（tar/ogg 等需 `github.com/...`），影响构建；`sevenzip` 依赖已存在可复用模式。
- **`isContainer` 判定硬编码**（`types.IsContainerExt`）——新增容器需改此，否则内容指纹不触发。
- **Web 端容器解析缺能力**：`web-fs.ts` 的 `importWebFiles` 管线硬编码 ZIP/JSZip，无 7z/tar 支持。
- **`preview: "3d"` 字段只是标志**，前端没有 `preview → adapter` 自动映射表，仍需手改 `PREVIEW_HANDLERS`。
- **WASM 解码策略两条固定分支**（`wasm/ysm-parser.ts` 的 `decodeYsmFileFromMemory` 与 `decodeYsmFile`）——新增格式需复制该模板，是 Top 10 已列的可插件化点。

---

## 3. 新增网页桥接方法（browser-adapter webImpls）

### 入口 & 机制

| 维度 | 入口（文件:行） | 机制 |
|---|---|---|
| 装配点 | `frontend/src/backend/browser-adapter.ts` webImpls 装配 | 四个 `web*Bindings` 对象 spread 到一个 `webImpls`；`satisfies` 兜住 `(...args: never[]) => Promise<unknown>` |
| Proxy 门控 | `browser-adapter.ts` Proxy get/has trap | `get` trap 命中 `webImpls` 自有键 → 返回实现；否则 `makeFailFast`；`has` trap 供 `'X' in adapter` 能力探测 |
| 类型对账 | `browser-adapter.ts` `AssertSubset` | `AssertSubset<WebImplGoKeys>` 编译期确保 webImpls 键 ⊆ AppBindings（除白名单 `SelectLocalRepo/GetFsaAuthState`） |
| 职责模块 | `web-common.ts`（原语）/ `web-fs.ts`（文件）/ `web-store.ts`（配置/日志）/ `web-community.ts`（社区） | 每个模块导出一个 `web*Bindings` 对象 |

### 加一个新 binding 的步骤

1. 在对应职责模块（如新逻辑属文件系统 → `web-fs.ts`）新增 `web*Bindings` 字段，值为 async 函数。
2. 无需改 `browser-adapter.ts`——spread 装配自动纳入。
3. 类型对账自动暴露编译错误（拼错键名 / 不在 AppBindings 导出）。
4. 若函数签名是 `(...args: never[]) => Promise<unknown>`，`satisfies` 校验通过；否则需放宽或改为 `(...args: any[])`。

### 评估：binding 注册表痛点是否仍在

- **装配层已注册表化**（ADR-049/066）：不再手写大对象字面量。
- **但仍是"对象字面量 merge"而非真正注册表**：
  - 缺 `registerBinding(name, fn, metadata)` API；
  - 缺 `webOnly/desktopOnly` 能力标记（现在靠白名单字面量 `SelectLocalRepo/GetFsaAuthState`，38 行）；
  - 拼错键名的编译期保护有限（`satisfies` 只查函数签名，不查具体参数类型）；
  - 无元数据（文档、废弃、能力依赖）。
- **结论**：痛点**基本解决**（从 40+ 行手写降到 4 个对象 merge），但**仍非理想注册表**。下一步建议抽 `createBindingRegistry` + 显式 `register(name, fn, {desktopOnly?: bool})`。

### 坑

- 新增 binding 若参数需 `ReadFileBytes` 类 IO 语义，需保证桌面端 Go 侧同名导出存在；否则桌面端正常、web 端 fail-fast。
- `WebUnsupportedError` 抛出后调用方需显式 catch，否则堆栈穿透。
- `PROTOTYPE_MEMBERS`（87-95 行）白名单若新增同名函数会冲突。

---

## 4. 新增同步 / 整合包逻辑

### 入口 & 机制

| 维度 | 入口（文件:行） | 机制 |
|---|---|---|
| 文件级同步 | `go/sync/sync.go`（`SyncResources`） | 扫描 `scanDir` 顶层文件，按文件名匹配 |
| 相对路径对比 | `sync.go`（`ResourceDiff` 调用） | ADR-064：scanner 口径 + 单点对比 |
| 文件夹级同步 | `go/sync/sync_dirlevel.go`（`SyncResourcesDirLevel`） | 按文件夹名对比，用于 YSM/MMD 的 `.json/.pmx/.pmd` 子目录 |
| 推送执行 | `go/sync/sync_push.go`（`PushResources`） | `IsDirLevelSync` → 文件夹推送（`installer.InstallDir`）；否则文件级 |
| 拉取执行 | `sync_push.go`（`PullResources`） | 同上，Extra 文件反向复制 |

### 扩展方式

- **新类型 = JSON 里加 `dirLevelSync` 布尔**：自动走 `SyncResourcesDirLevel`。
- **若需新增同步策略**（如"按哈希+尺寸+MTime"三因子）：改 `ResourceDiff`（`sync_diff.go`）的 diff key 语义。
- **深度上限**：`SyncResources` 只扫 `scanDir` 顶层，文件夹级全树递归。新策略需改深度守卫。

### 坑

- **`PushSingleResource` 硬编码 `.json/.pmx/.pmd`**（`sync_push.go`）——新增目录型类型（如 `.npx/.vrcs`）需改此行，否则单个文件夹推送会按文件级走。
- **路径穿越防护**（`sync_push.go`）：`filepath.Rel` 结果以 `..` 开头显式拒绝，新同步策略必须遵守。
- **`scanDir` 为空时行为**：`SubDirMap` 返回空串，`SyncResources` 会拿全局根目录当扫描目录——新类型务必显式填 `scanDir`。
- **`StorageSubDir` 回退为 rtype 自身**——不填会污染 FilesRoot 根。

---

## 5. 本轮新抽象自身的拓展点

### 5.1 `go/container` 的 `Entry/Reader` 接口

- **入口**：`go/container/container.go`（`Entry` 4 方法 + `Reader` 2 方法）。
- **扩展点**：新增容器格式 = 实现这 6 个方法 + 在 `Open` 注册扩展名。
- **已验证适配**：zip / 7z / 目录 三种适配器。
- **坑**：`Entry.Open()` 返回 `io.ReadCloser`，无 size-limit；调用方必须用 `fsutil.ReadLimitedEntry` + `types.MaxReadLimit` 施加上限。
- **边界**：加密容器（如 YSM WASM 解密后的虚拟 zip）不属于本包——需另开虚拟容器层。

### 5.2 `types` 过滤扩展

- **入口**：`go/types/extensions.go`（`NormalizeResourceName` / `IsResourceAllowed` / `IsTypeModelFile`）。
- **扩展点**：新类型的扩展集自动进 `AllExts()` / `SupportedExtsForType()`，过滤器自动生效。
- **坑**：`.json` 特判**只放行 ysm.json**——新类型如用 `.json` 清单（如 `manifest.json`）会被全量拒绝。需要把 `IsYsmEntryJSON` 泛化为 `IsEntryManifest(base, rtype)` 或引入 `registryEntries` 字段。

### 5.3 `web-community` 的 localStorage 覆盖层模式

- **入口**：`frontend/src/backend/web-community.ts`：`loadWebCreators/loadWebSites/loadWebGitHub` 三份结构相同：`bundled JSON → localStorage 覆盖 → setItem 保存`。
- **模式**：bundled 默认 + `WEB_*_KEY` localStorage 键作覆盖层，天然事务（`setItem` 原子）。
- **复用**：未来新数据集（如 tag 库 / 字体库 / 场景库）可复用此"bundled + localStorage overlay"三件套——建议抽 `createLocalOverlayStore(key, bundledDefault)` 工厂（extensibility-index 已列 1.10）。
- **坑**：`typeof localStorage !== "undefined"` 三处内联重复；隐私模式（ADR-044）下应走 `safeGet/safeSet` 但此处未走（直接裸调）——这是遗留坑。

### 5.4 dev 热重载（vite + Taskfile）

- **入口**：`frontend/vite.config.js`：`watch.ignored` 排除临时目录，避免 chokidar 误 watch。
- **机制**：`task dev` 启动 `wails3 dev -port 9245`（Go + 前端 + WebView2），前端改文件自动 HMR 注入（`app-preview/index.ts` 已有 `export { appPreviewStyle }` 配合 `hot.accept`）。
- **扩展新 dev 工具**：新工具如 `dev:web`（纯浏览器）需：
  1. `vite.web.config.ts` 复用 `wailsBindingsResolve` 插件；
  2. 确保 `watch.ignored` 不挡到工具临时目录；
  3. 新 binding 走 `npm run generate:bindings` 后前端 `.js` 后缀 import 由插件重定向。
- **坑**：
  - 只有 `npm run dev:web` 同时运行才自动 HMR；`task dev` 下的前端改动需 wails 触发。
  - `generate:bindings` **必须带 `-ts`**，否则产出 `.js` 清掉 git 跟踪的 `.ts`（治理红线）。
  - 新 dev 工具若引入 `child_process`，Windows 沙盒下 `stdio:'pipe'` 会 EPERM（见根 AGENTS 提示），用 `stdio:'inherit'` 或 `stdio:'ignore'`。

---

## 新拓展点 Top 10 建议（按价值降序，≤20 行）

1. **把 detector switch 完全注册表化**：`mcmeta.go` 的 5 分支是"加新类型要手改"的最大残留；JSON 加 `detectorImpl: "filename"` 字段，`registryType.Detector` 查表。
2. **泛化 `IsYsmEntryJSON` 为 `IsManifest(base, rtype)`**：当前 .json 特判锁死 ysm.json，新类型 `.json` 清单入口全被拒。
3. **加 `go/container` 的注册器**：`Open` switch 手加新扩展；抽 `RegisterExt(ext, opener)` 让新容器自注册。
4. **前端 `PREVIEW_HANDLERS` 加 `previewMode → handler` 自动映射**：当前 `preview: "3d"` 只是标志，仍需手写 handler。
5. **`web-community` 抽 `createLocalOverlayStore` 工厂**：三份裸调 `localStorage` 结构逐字重复，且未走 `safeGet`。
6. **binding 注册表升级**：`browser-adapter.ts` spread 装配已好，但缺元数据/能力标记；抽 `createBindingRegistry + register(name, fn, meta)`。
7. **前端三处必改残留**（`RESOURCE_TYPES` 键 / `RESOURCE_TYPE_LABELS` / `icon.ts`）建议从 JSON 派生：JSON 加 `shortLabel` / `uiKey` 字段，派生代码自动生成。
8. **`PushSingleResource` 硬编码 `.json/.pmx/.pmd`**（`sync_push.go`）改走 `IsDirLevelSync + InstallExtsFor`。
9. **WASM 解码策略注册表**（`wasm/ysm-parser.ts` 的 `decodeYsmFileFromMemory` 与 `decodeYsmFile`）：两条固定策略、失败自动降级（extensibility-index 7.2）。
10. **`.zip/.7z` 的 `isContainer` 判定**抽 `IsContainerExt` 函数（从注册表 extensions 派生），新增容器格式只改一处。

### ⭐ 加新类型"需要手改的残留清单"（最痛）

| # | 位置 | 动作 |
|---|---|---|
| 1 | `frontend/src/utils/resource/types.ts`（`RESOURCE_TYPES`） | 加键 |
| 2 | `types.ts`（`RESOURCE_TYPE_LABELS`） | 加标签 |
| 3 | `frontend/src/utils/icon/icon.ts`（`fileIcon`） | 加图标 |
| 4 | `app-preview/index.ts`（`PREVIEW_HANDLERS`） | 加一行 |
| 5 | `app-sidebar/tpl.ts` | 加顶部模型 tab 一行（子菜单自动） |
| 6 | `app-sidebar/index.ts` | 若新类型属模型类需补 |
| 7 | `app-content/tpl.ts` | 加 repo 副 tab |
| 8 | i18n 三语言包 `rtype.*` | 补 `zh-CN/en/ja` |
| 9 | `go/types/types_extra_test.go` | 补 `ShouldHashExt` 断言 |
| 10 | `go/sync/sync_push.go`（`PushSingleResource`） | 若目录型新扩展名（非 `.json/.pmx/.pmd`）需加 |
| 11 | `mcmeta.go`（`DetectResourceType` switch） | 若新 detector（非 zipentry/extension）需加分支 |
| 12 | `mcmeta.go`（`isContainer`） | 若新容器扩展（非 `.zip/.7z`）需加 |
| 13 | `internal/app` + `generate:bindings` | 若新增 AppConfig 字段（如 `PotionRoot`） |
| 14 | `container.go`（`Open`） | 若新容器格式（非 zip/7z/目录） |

> 其中 1-5 是"每次加类型必改"，11-14 是"新类型形态特殊时才改"。建议优先解决 1-3（从 JSON 派生）、7-10（注册表化或配置化），把"必改"清单压到只剩 4-5（预览 handler + 侧栏 tab）。
