# YSM 网页版大蓝图（Web Edition Blueprint）

> **状态**：✅ 已核实 + 已回填隔壁借鉴（2026-08-14；修订点见 §7）
> **日期**：2026-08-14
> **决策人**：Jieling（人类首席架构师）、AI 代理
> **关联**：ADR-049（网页版桥接）、ADR-053（能力边界）、ADR-046（全平台化）、ADR-029（WASM 内嵌）

---

## 0. 定位与铁律

网页版 = 三端同一代码库的「模型库在线查看器 + 轻管理」，纯静态托管（GitHub Pages），无 Wails 壳、无 Go 编译。

| 铁律 | 出处 |
|------|------|
| 纯静态托管，不引入服务端；云同步等需服务端的诉求单独立项决策 | ADR-049 |
| 能力迁移一律走 backend adapter（`webImpls`），业务调用零改动，禁止前端业务分叉 | ADR-049 / ADR-040 |
| 未实现 binding 必须 fail-fast（`WebUnsupportedError`），禁止 undefined 穿透 | ADR-049 / 治理红线 #5 |
| 查看器模式统一由 `isViewerMode()` 门控（网页版 + Android 共用） | ADR-053 |
| 迁移能力优先「TS 移植 + 双边契约测试」模式（`spec-builder.ts` ↔ `app_model.go` 对拍） | ADR-049 P2-2 |

---

## 1. 现状底座（已闭环 + 已核实）

| 能力 | 状态 | 依据 |
|------|------|------|
| backend adapter 双实现（桌面 Wails / 浏览器 IDB+localStorage） | ✅ | ADR-049 Phase 1-2 |
| 3D 全闭环：WASM 解码 → TS spec 构建 → Three.js | ✅ | ADR-049 P2-2 |
| 能力门控 + 写操作降级语义 | ✅ | ADR-049 Phase 3 / ADR-053 |
| Web e2e（Playwright，单 webServer `vite --mode web`） | ✅ | `playwright.web.config.ts:22-28` |
| GitHub Pages 部署（WEB_BASE=/ysm-model-manager/app/） | ✅ | `pages-deploy.yml` 门禁 + 合并闭环 |
| 绑定复刻：**42 / 164**（核实修正：此前记 40，实际 42） | 🔄 | `webImpls` vs `bindings/.../app.ts` |
| 网页版可用度 | 查看链路全可用 | 门控点 14 处全部收敛在 `isViewerMode`，无散落 |

已复刻 42 个覆盖：核心模型库（扫描/读取/搜索/标签/删除/重命名/子目录/启用）、配置、日志环、头像、社区只读 + 本地覆盖、作者扫描、仓库索引（`GenerateRepoIndex`）、FSA 授权导入（`SelectLocalRepo`）。

---

## 2. 核心命题：Go 能力复刻差距（已核实）

> 网页版每一次「想要某功能」，本质都是把某个 Go 绑定搬到浏览器。差距 = 全量绑定清单 − 已复刻清单，逐项判定「可复刻 / 可降级 / 明确不做」。**大蓝图 = 这个差距矩阵的按序消化。**

### 2.1 差距总览（核实数据：164 → 42 → 122）

| 类 | 数量 | 说明 |
|----|------|------|
| A · 可复刻 / 降级桥接 | **64**（P0 16 / P1 21 / P2 27） | 数据获取 TS/WASM 移植 + 写操作浏览器降级 |
| C · 明确不做 | **58** | 自更新 5、广场窗口 10、OS 集成 6、实例/整合包 16、FS 深层/安装 12、下载队列 5、内部框架 4 |

### 2.2 重点缺口一：文件层级读取【P-A 定案】

桌面层级读取承载者 = `fsutil.WalkAllFiles`（递归完整路径列表）；`ListAllFilePaths` 是直通绑定（`internal/app/app_scan.go:277-283`），`ListFileNames` 仅返回拍平 basename（`app_scan.go:265-275`）。**「目录树」在桌面端也不存在独立结构——层级由路径字符串表达、前端树自行分组。**

网页版现状：IDB key 规约 `dir:<type>/<name>:` / `file:<type>/<name>/<rel>`（`idb.ts`），`scanWebModels` 两段扁平枚举（`web-fs.ts:88-133`），`importWebFiles` 用 `f.name` 拍平落库（`web-fs.ts:400`）丢相对路径，FSA `selectLocalRepo` 只做一次性导入（句柄不持久化，`web-fs.ts:76-85`）。

**核实结论**：IDB 层对多级路径零阻力（任意字符串 key + 前缀扫描 `idbKeys`），扁平化约束全在使用方四处约定。方案定案：

| 方案 | 判定 | 理由 |
|------|------|------|
| **P-A · IDB 路径化** | ✅ **R1 正解** | 存储层零障碍；改动集中在使用方（dir key 多段化 + 枚举递归），`scanWebModels` 的 size 汇总/主文件 rank/排序骨架可复用 |
| **P-C · 扁平路径字符串复刻** | 垫脚石 | `idbKeys` 全键扫描反推路径可先复刻 `ListAllFilePaths` 返回形状，但嵌套子目录仍无法表达 |
| **P-B · FSA 持久挂载** | ⏸ 移至 R2 | 零基础（句柄未存 IDB、无权限续期、导入丢 rel 路径、只收 .ysm）且仅 Chromium 系，与纯静态三端一致定位冲突 |

**P-A 改造点（四处约定）**：`dirKey` 多段化 → `scanWebModels` 按段递归枚举 → `importWebFiles` 保留相对路径落库 → `parseWebModelDir` 正则放开多段。

**P-A 已落地（2026-08-14）**：四处约定全部改造完成（web-fs.ts），R1 契约测试 73 项闭环（browser-adapter.test.ts「R1 文件层级读取」块）；`ListAllFilePaths` 桥接补上（`listWebModelDirFiles` 递归列目录下全部文件，含组内子目录 rel；bus-handlers 删除目录移回收站联动随之解冻）。

**P-A 有现成镜像可抄（MikuMikuAR，2026-08-14 隔壁核实）**：其 `ListDirRecursive`（`MikuMikuAR/frontend/src/core/backend/browser-adapter.ts:2181-2210`）已实现同一思路：
- key 规约 `dir:<stem>:<relPath>`，relPath 保留子目录（`tex/face.png`）——与 YSM `file:<type>/<name>/<rel>` 同构，`<rel>` 本就可含 `/`
- 层级扫描 = `idbKeys` 全键 `startsWith(prefix)` 过滤 + 返回 `{name, relativePath}`；**两轮匹配：精确前缀 miss → bare stem fallback**（取路径末段再扫，解决 FSA 类别前缀 `web://model/分类1/Miku` 兼容）
- 读字节三路兜底：`web://model/<stem>/<rel>` → `dir:` 命中 → `file:<baseName>` 兜底
- `encodeURIComponent` 编码 stem 防同名模型 dir key 互相覆盖
- 配套单测 `backend.virtual-dir.test.ts`（makeIdbMock + resetIdb）= YSM 契约测试模板

### 2.3 重点缺口二：依赖 Go 端解析【DetectResourceType 是总闸】

| Go 能力 | 网页版现状 | 判定 |
|---------|-----------|------|
| **DetectResourceType** | fail-fast 被 catch 后 rtype 恒空 → pack/litematic 等预览全部退化为 YSM 解析 | 🔑 **P0 总闸先行**：扩展名+文件头嗅探纯前端可实现；它不通，下游 GetPackInfo/ReadPackMeta/体素 6 件套全不可达 |
| ExtractYSMHeader / ExtractYsmSummary / ExtractYSMHeaderFromBase64 | 高频调用（重命名 tips、导入队列预填、预览详情） | P0：WASM 内存解析直接可复现 |
| 几何/纹理数值分析（SearchModels 数值条件、GetModelTexSizes） | 数值条件被忽略降级 | R1 树层级打通后可解锁 |
| 周边格式（litematic/schematic/nbt/pack/shaderpack） | 未复刻 | P2：依赖 DetectResourceType 先通 |
| 预览图（FindPreviewImage / ExtractPreviewTexture） | ✅ 已复刻：模型同目录 preview.png / zip 首张 PNG / `.json` 解压目录纹理 → data URI | 已落地（web-fs.ts） |

### 2.4 决策修订：Move/Copy 推翻 ADR-053 的 C 类判定【重要】

ADR-053 将 `MoveModelFile` / `CopyModelFile` 归 C 类（理由：「依赖桌面真实目录选择器，dstDir 无对应物」）。**核实发现该依据与代码事实不符**：

- `resolveDstDir`（`core/context-menu-handlers.ts:39-71`）用的是 **`modalPrompt` 文本输入文件夹名** + 校验 + `GetRepoRoot(type) + "/" + folder` 拼接，**不是系统目录选择器**
- 网页版可 1:1 复现：prompt 输入 + `/web/<type>/` 白名单解析；web-fs.ts 已有 `renameWebDir`/`renameWebFile` 的 IDB rekey 原语，移动=跨目录 rekey、复制=读原记录复制写新记录

**决策**：升为 **A 类 P0**，列入 R3 第一批。实现时保留 `isUnsafeFolderName` 校验与 `/web/<type>/` 白名单解析（防静默移错模型组，ADR-053 提示的语义风险仍有效）。

### 2.5 适配层增强（借鉴 MikuMikuAR 健壮性设计）

| 借鉴点 | MikuMikuAR 做法 | YSM 现状与建议 |
|--------|----------------|----------------|
| 能力缓存兜底 | `capabilities()` 显式矩阵 + `getCachedCapabilities()` 未预热返回 ALL_TRUE_CAPS，防菜单首帧渲染闪烁隐藏原生入口 | YSM 用 `'Foo' in browserAdapter` 散点探测 + `isViewerMode` 门控（14 处已收敛）；可补「门控缓存默认全开」防首帧闪烁 |
| 后端选型不死锁 | `resolveBackend()` 顶层 try/catch：go-adapter 动态 import 失败降级 browserAdapter，`_resolving` 不持 rejected promise；dev 500ms / prod 3000ms 探测窗 | YSM `_appPromise` 有并发保护，可补此崩溃兜底 |
| go-adapter 懒加载 | `makeLazyLoader` 动态 import，web 入口短路完全不拉进 bundle | YSM `getApp()` 已动态 import，可核对 web 构建是否零 Wails 残留 |

---

## 3. 三条主线（依次规划）

| 主线 | 阶段 | 主题 |
|------|------|------|
| 一 · 数据层 | R1 → R2 | 文件层级读取（P-A）→ 数据互通 |
| 二 · 能力层 | R3 | 查看器 → 轻管理（A 类 64 项三批消化） |
| 三 · 体验层 | R4 | PWA 离线 / 移动端 / 性能 |
| 生态（远期） | R5 | 模型广场 / 分享 / 云同步 / iOS P3 |

---

## 4. 阶段路线图

### R1 · 文件层级读取（数据层，P-A 定案）✅ 已闭环

- **目标**：网页版获得递归目录读取能力；`ListAllFilePaths` 可复刻，树/筛选/搜索数值条件解锁
- **任务**：四处约定改造（dir key 多段化、递归枚举、导入保留 rel 路径、parse 放开多段，**参照 MikuMikuAR `ListDirRecursive` 镜像，见 §2.2**）→ 存量两段 key 迁移 → `ListAllFilePaths`/`ListFileNames` 桥接 + 契约测试（模板 `backend.virtual-dir.test.ts`）
- **验收**：树视图子目录可展开；`SearchModels` 数值条件不再静默忽略；万级 key 前缀扫描性能达标
- **风险**：存量 IDB 数据迁移兼容（`data` 版本升级 or 惰性迁移）；重命名/删除的递归联动

> **落地记录（2026-08-14）**：四处约定改造完成 + `ListAllFilePaths` 桥接落地（`listWebModelDirFiles`），契约测试 73 项闭环。`ListFileNames` 属 C 类（整合包/实例 16 项，明确不做，见 §2.1）。存量 key 迁移与 SearchModels 数值条件解锁留待后续（R1 数据层主体已闭环）。
>
> **验收补充（R3，2026-08-14）**：**「树视图子目录可展开」已闭环验证**——链路为 web `scanWebModels` 多段组名（`Path=/web/<type>/<name>/<mainRel>`，name 含 `/`）→ loader `relPath` 多段化 → `buildTree` 按段建嵌套节点 → `flattenVisible` 递归展开（`_dirOpen` 逐层持久化）。已在 `render.test.ts` 新增 R3 块（web 多段组形态）锁定：折叠只出顶层 / 逐层展开按 depth 递归 / 组内多文件同组正确归位。
>
> **验收补充（R3，2026-08-15）**：**「万级 key 前缀扫描性能」已闭环**——`idbKeys` 改用 `IDBKeyRange.bound(prefix, prefix+\uffff)` 区间定位 cursor，前缀扫描从 O(全库) 降到 O(命中)，根治 `scanWebModels` 二重嵌套（外层 dir 枚举 + 每模型内层 file 前缀扫描）的 O(N×M) 二次方退化。签名不变、消费方（全在 web-fs）零改动；无 `IDBKeyRange`（node 测试）降级全量 + `startsWith` 兜底。已在 `idb.test.ts` 新增区间分支回归用例。R1 三验收项剩「SearchModels 数值条件」（依赖 DetectResourceType）未闭环。

### R2 · 导入增强（数据层）✅ 已重定位 + 主体落地

> **定位修订（2026-08-14）**：原「数据互通」命题不成立——网页版模型库内容用户本地都有原始文件（FSA 授权的是本地目录、社区下载 `<a download>` 直存本地），「导出 zip」是重复劳动，已砍。R2 重定位为「导入增强」：让用户拖 zip 进来能解压成模型组。

- **目标**：网页版导入能力对齐桌面（zip 解压、目录分组、中文文件名）
- **任务**：① **zip 解压导入**（extract.ts：`parseZipCentralDir` 预解析 + `extractZip` 解压 + ZIP 炸弹防护 + `gbkDecodeEntry` 中文名还原；`importWebFiles` 入口 `expandZipFiles` 展平 zip 成目录模型组）② **FSA 持久挂载**（句柄落库 + 启动自愈双扫描，已落地）
- **验收**：拖入模型 zip → 解压成目录模型组（含子目录 rel），中文名正确；FSA 授权目录重启自动恢复
- **风险**：ZIP 炸弹防护阈值；FSA 仅 Chromium 系，需降级提示

> **落地记录（2026-08-14）**：任务① zip 解压导入已接通——extract.ts 三件套（central dir 预解析 / 解压 / 类型检测）+ `expandZipFiles` 在 `importWebFiles` 入口展平 zip（.ysm 保持整体走 WASM）；契约测试 15（extract）+ 2（browser-adapter zip 展平）项。任务② FSA 持久化已落地（上轮）。

### R3 · 能力补齐（能力层，A 类 64 项三批）

**第一批 P0（16 项）——消除网页版可见红错 + 服务高频链路**
- 回收站 6 件套：`MoveToRecycle` / `ListRecycleBin` / `RestoreFromRecycle` / `DeleteFromRecycle` / `EmptyRecycleBin`（+ `MoveToRecycleEx`）——回收站 UI 网页版可见且当前渲染「❌ 加载失败」占位；IDB 用 `recycle:<type>:<name>` 虚拟路径语义表达
- 移动/复制 2 件套：`MoveModelFile` / `CopyModelFile`（§2.4 推翻 C 类）
- 解析 4 项：`DetectResourceType`（总闸先行）/ `ExtractYSMHeader` / `ExtractYSMHeaderFromBase64` / `ExtractYsmSummary`
- 头像 2 项：`CacheModelAvatars` / `CachedCreatorAvatar`（复用已桥接 `BatchExtractCreatorAvatars`）
- 存在性 1 项：`CheckFileExists`（导入重名检测）
- 工坊写入 2 项：`SaveWorkshopCreatorsBySite` / `SaveWorkshopPresetsBySite`（消除站点编辑保存红错 + 解锁 `tryAutoMergeCommunity` 自动合并持久化，可移除对应 web 门控）

**第二批 P1（21 项）**
- 导入落库 6：`ImportModelFile` 五变体 + `ImportModelFolder`（映射 `importWebFiles`）
- 资源包 4：`DeleteResourcePack` / `IsResourcePackEnabled` / `ToggleResourcePack` / `ReadPackMeta`
- 预览兜底 5：`GetPackInfo` / `FindPreviewImage` / `ExtractPreviewTexture` / `SaveScreenshotFile`（`<a download>`）/ `SavePreviewTempFile`（objectURL）——前 4 项已落地
- 目录 2：`CreateDir` / `ListAllFilePaths`（`ListAllFilePaths` 已落地；`CreateDir` 网页版仍隐藏）
- 社区 3：`MergeWorkshopCreatorsFromJSON`（拖 JSON 合并，真实调用）/ `ExportWorkshopSitesJSONFile` / `SetLinkMode`
- **AnalyzeBedrockModel / AnalyzeBedrockModelEntry（已落地，非“可选”）**：网页版 `.zip` / `.json` 3D 预览承重主路径，支持 `ysm.json` manifest 多角色合并；roadmap 曾误标为“WASM 失败兜底”

**第三批 P2（27 项）**
- 导出下载 8：`ExportBoneStructures`（门控→下载）/ `ExportModelStructureJSON` / `ExportWorkshopCreatorsJSONFile` / `ExportWorkshopSitesCSV` / `ImportWorkshopSitesCSV` / `BackupWorkshopCreators` / `ValidateWorkshopSites` / `ResetWorkshopConfigs`
- 体素解析 6：litematic/nbt/schematic 三对（依赖 DetectResourceType 先通）
- 其他：`ReplaceWorkshopCreatorsFromJSON` / `ResetResourceRoot` / 轻量去重（`FindDuplicateFiles`/`CountDuplicateFiles` 降级）/ `ReadShaderpackLang` / `AnalyzeYSMModel` / `GetModelTexSizes` / `GetLinkMode` / `ImportByType` / `ImportResourcePack` / `DebugExtractCreatorAvatar` / 已停用的 `DetectZipType`（无需桥接）

**明确不做（C 类 58 项，永久 fail-fast + 门控）**：自更新 5、广场窗口 10、OS 集成 6、实例/整合包 16（含 `ListFileNames`）、FS 深层/安装 12、下载队列 5、内部框架 4。

### R4 · 体验层

| 线 | 现状（核实） | 目标 |
|----|------|------|
| **PWA** | 零资产（无 manifest/SW/workbox） | manifest + Service Worker 离线 + 可安装；**SW 骨架直接抄 MikuMikuAR `public/sw.js`**（导航 network-first 离线回退 + `/assets/` cache-first 秒开 + 其他同源 network-first 防 stale + Range 放行 + activate 清旧缓存）；产物随 pages-deploy 合并自动上线 |
| **移动端** | 触屏事件就绪（Pointer Events + touch-action），但 CSS 断点（layout.css:368,379）作用于桌面壳 `#root` grid，**与 Web 版 flex 布局脱钩**；app-nav 固定 160px | 针对 Web 布局补断点 + 移动导航（抽屉/底部导航）；Design.md §13 增补移动端原则 |
| **性能** | base64 → ArrayBuffer → WASM HEAP 至少 2-3 份全量拷贝；100MB 上限唯一防线；渲染侧已具备 mesh 合并 / LRU 20 / 虚拟滚动 | ✅ 大文件阈值已实测成文（knowledge/model3d.md §大文件性能阈值 + guide/3d-preview.md FAQ）；解码后释放策略已盘点（现有释放点已覆盖，GC 依赖项标注待实测校准） |
| **部署** | 管线闭环（WEB_BASE 子路径 + 门禁 + 合并）；缺缓存策略与 404 | `_headers`/`_redirects` 缓存控制；**SW 作用域收缩 + 根墓碑 SW 清旧注册（MikuMikuAR web-pages.yml / ADR-225 经验，防存量旧 SW 吐旧壳）**；404/redirect stub 防死循环；（可选）文档站 `/app/` 直达入口 |

### R5 · 生态（远期）

- 模型广场 / 分享链接、云同步（服务端，单独 ADR）、iOS P3（复用 Phase 1 适配层——browserAdapter + platform 分层 + isViewerMode 门控 + 单线程 WASM 审计结论已构成完整共享地基）

---

## 5. 核实清单（2026-08-14 三组子代理已回填）

### 核实组 A · 数据层（文件层级读取）
- [x] A1 `go/fsutil/walk.go` 递归语义与导出面 ✅（WalkAllFiles 递归完整路径，不跟 symlink、无隐藏过滤）
- [x] A2 扫描口径 ⚠️（绑定在 `internal/app/app_scan.go` 薄壳而非 scanner.go；`ListFileNames` 是拍平 basename）
- [x] A3 `idb.ts` key 规约与 `scanWebModels` 扁平局限 ✅（IDB 对多级路径零阻力，约束在使用方）
- [x] A4 FSA `SelectLocalRepo` 现状 ✅（一次性导入、句柄不持久化、导入丢 rel 路径）
- [x] A5 MikuMikuAR 参考 ✅（**隔壁仓库已核实存在 `ListDirRecursive` 完整实现**——browser-adapter.ts:2181-2210，dir key + relativePath + bare stem fallback 模式，P-A 直接镜像，见 §2.2）

### 核实组 B · 能力层（Go 差集）
- [x] B1 122 未复刻逐项分类 ✅（A 类 64 / C 类 58，含 P0/P1/P2 三级）
- [x] B2 `MoveModelFile` / `CopyModelFile` ✅（**推翻 ADR-053 C 类判定**：dstDir = prompt 文本输入 + 路径拼接，可 1:1 复现）
- [x] B3 回收站前端调用面 ✅（`features/recycle-bin.ts` 完整 UI，网页版可见但当前红错，P0）
- [x] B4 社区写入数据形状 ✅（BySite = siteID 过滤子集写 localStorage，P0）
- [x] B5 导出类契约 ✅（多数无调用点；`MergeWorkshopCreatorsFromJSON` 有真实调用；`ExportWorkshopSitesJSONFile` 被门控）

### 核实组 C · 体验层与生态
- [x] C1 PWA 现状 ✅（零资产，从零建）
- [x] C2 移动端响应式现状 ⚠️（触屏就绪、断点脱钩 Web 容器）
- [x] C3 大 .ysm 内存路径 ✅（全量拷贝 2-3 份，阈值未实测）
- [x] C4 部署配置 ✅（管线闭环，缺缓存/PWA 产物；web e2e 实为单 webServer）
- [x] C5 iOS P3 与适配层共用 ✅（纯文档 P3，地基已在）

---

## 6. 关联决策记录

| 文档 | 结论 |
|------|------|
| ADR-049 网页版桥接 | backend adapter 双实现 + IDB 模型库，纯静态 |
| ADR-053 桥接能力边界 | A/C 分类原则；24 binding 已桥接；**Move/Copy 的 C 类判定已推翻（见 §2.4）** |
| ADR-050 广场浏览器窗口 | 已取代（反向代理不可行） |
| ADR-046 全平台化 | 查看器模式统一；iOS 待立项 |

---

## 7. 修订记录（v2 · 已核实版变更）

| 变更 | 内容 |
|------|------|
| 差距数据 | 40 → 42 已复刻；差集 122（A 64 / C 58），此前粗估「~30/~40/~50」已精确化 |
| 决策修订 | **Move/Copy 推翻 ADR-053 C 类判定，升 A 类 P0**（§2.4） |
| 方案定案 | 文件层级读取 P-A（IDB 路径化）为 R1 正解；P-B 移至 R2 |
| 排序原则 | DetectResourceType 作为解析类总闸先行，避免下游白做 |
| R3 细化 | A 类 64 项三批清单（P0 16 / P1 21 / P2 27）+ C 类 58 确认 |
| R4 细化 | PWA 零基础从零建；移动端断点脱钩定位；性能阈值欠账落地 |
| 核实回填 | §5 全部 15 项回填 ✅/⚠️ + 证据 |
| v3 · 隔壁借鉴 | §2.2 P-A 补 MikuMikuAR `ListDirRecursive` 镜像（dir key + relativePath + bare stem fallback）；R2 补 FSA 权限持久化全套（queryPermission 恢复）；R4 补 SW 骨架/墓碑/404 stub；新增 §2.5 适配层增强（capabilities 缓存兜底 + resolveBackend 降级不死锁 + go-adapter 懒加载）；A5 结论更新为「有镜像可抄」 |
