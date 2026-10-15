---
kind: utils-resource-types
name: 资源类型与扩展名派生层 resource-types
tier: architecture
category: utils
source_files:
  - frontend/src/utils/resource/
  - frontend/src/utils/types-re-export.ts
  - frontend/src/features/repo/repo-rtype.ts
tests:
  - frontend/src/features/repo/repo-rtype.test.ts
  - frontend/src/utils/resource/repo-rtype.test.ts
auto_fields:
  symbols_with_lines:
    - __resetShortLabelCacheForTest
    - ALL_EXTS
    - ALL_RESOURCE_TYPES
    - allResourceTypes
    - AMBIGUOUS_EXTS
    - asArray
    - asNumber
    - asString
    - containerExts
    - currentRepoType
    - DataGlyph
    - DedupGroup
    - extBelongsTo
    - extOf
    - FileConflict
    - GEOMETRY_SEARCHABLE_TYPES
    - getCompound
    - getExts
    - getPreviewableTypeTabs
    - GROUP_META
    - GROUP_OF
    - GROUP_TYPE_OPTIONS
    - groupLabelOf
    - groupStorageRootOf
    - GroupTypeOption
    - HealthReport
    - isContainerExt
    - isGeometrySearchableRtype
    - isImportableFile
    - isObj
    - isSupportedExt
    - isSupportedFile
    - isYsmWasmPreview
    - matchTypeByExt
    - matchZipEntryTS
    - NO_3D_TYPES
    - previewCandidateExtsOf
    - PreviewTab
    - resolveDefaultPreviewKey
    - resolvePreviewKey
    - resolvePreviewKeyByExt
    - resolvePreviewKeyToRtype
    - resolveTypeSafe
    - RESOURCE_EXTS
    - RESOURCE_TYPE_LABELS
    - RESOURCE_TYPES
    - ResourceType
    - resourceTypesById
    - ResourceTypeVariant
    - rtypeGroupLabelOf
    - rtypeLabelKeyOf
    - rtypeLabelOf
    - shortLabelOf
    - typeIconOf
    - useCurrentResourceType
    - VOXEL_RPC_BY_EXT
    - ZipEntryMatch
quick_groups:
  - 配置与注册表
quick_intents:
  - 资源类型、RESOURCE_TYPES、类型标签、注册表加载
  - 扩展名、支持的文件类型、拖拽过滤、RESOURCE_EXTS/ALL_EXTS
  - 存储子目录、storageSubDir、schema.ts 同步视图、resourceTypesById
  - 歧义扩展名、resolveTypeSafe、预览路由 previewKey
quick_risk_lines:
  - 资源类型必须派生自 resource_types.json（前端唯一入口 = schema.ts 同步视图），禁止手写类型映射、禁止异步 RPC 旁路
  - 扩展名判定必须走 extensions.ts 的 isSupportedExt，拖拽导入场景禁止等待异步注册表
  - 歧义扩展名（.zip/.7z）禁止用扩展名直判类型，必须经 resolveTypeSafe 回退 Go DetectResourceType
pitfalls:
  - 手写类型映射 → 与注册表不一致、分类错乱；必须派生自 resource_types.json（走 schema.ts 同步视图）
  - 新增资源类型未注册 → 前端无法识别；必须在 resource_types.json 中注册
  - 拖拽导入等待异步注册表 → 导入按钮短暂不可用；必须用 RESOURCE_EXTS 静态表
  - 静态表未与 resource_types.json 对齐 → 三端不一致；必须由契约测试守护

use_when:
  - 资源类型、RESOURCE_TYPES、类型标签、存储子目录
  - 扩展名、支持的文件类型、拖拽过滤、RESOURCE_EXTS、ALL_EXTS、扩展名归属
  - resourceTypesById、schema.ts、注册表加载
  - 歧义扩展名、resolveTypeSafe、预览路由
invariant_anchors:
  - frontend/src/utils/resource/schema.ts|resourceTypesById
  - frontend/src/utils/resource/schema.ts|allResourceTypes
  - frontend/src/utils/resource/extensions.ts|RESOURCE_EXTS
  - frontend/src/utils/resource/extensions.ts|isSupportedExt
status: active
---

# 资源类型与扩展名派生层 resource-types

> 2026-10-13 合并自原 `utils-extensions` 卡（ADR-338 推广，判据：互引 1↔1 + 同源派生层 + 消费重叠）——扩展名表与类型常量同由 `schema.ts` 派生，一条注册表链一张卡。原卡已归档 `docs/archive/utils-extensions.md`。
>
> `source_files` 为目录级 `frontend/src/utils/resource/`（沿用原卡形态）：覆盖 `schema.ts`/`types.ts`/`extensions.ts` 及目录下其余派生文件（importable.ts 等），无符号膨胀问题（目录符号 <100 阈值）——若未来该目录文件增多触发 WARN 再收窄到具体文件。

## 概览

前端资源类型与扩展名的**同步派生层**（全部从 `resource_types.json` 单一事实源派生，构建期 import 内联）。与 [resource_registry](./resource-registry.md) 卡互补：那张讲 JSON 单一事实源与 Go 端加载；本卡讲 `utils/resource/` 下的前端派生视图——`schema.ts`（唯一 ResourceType 接口 + 单一 JSON 解析点 → `allResourceTypes`/`resourceTypesById`）+ `types.ts`（ID 常量/标签/能力元数据）+ `extensions.ts`（类型↔扩展名静态映射）。

⚠️ ADR-269 D3（2026-09）退役了原 `services/resource-registry.ts` 异步 RPC 旁路，前端资源类型统一走 `schema.ts` 同步视图，无空表窗口。⚠️ 更曾存在的 `services/registry.ts` 服务注册表已于 2026-09 删除，与本卡无关。

## 核心职责

- **单一解析点**：`schema.ts` 内联解析 `resource_types.json` → `allResourceTypes`（插入序 = JSON 序）/ `resourceTypesById`（键控视图）
- **ID 常量与标签**：`RESOURCE_TYPES`（15 个 ID）/ `RESOURCE_TYPE_LABELS`（中文标签，派生自 JSON `name` 字段）/ `ALL_RESOURCE_TYPES`
- **⚠️ 中文标签（`RESOURCE_TYPE_LABELS` / `GROUP_META.name`）只能当 i18n 缺键回退，禁止直取上屏（锐评 2026-10-13 P1-3 收口）**：二者都派生自 `resource_types.json` 的中文字段，`app-nav` 资源类型切换器（大类下拉 + 类型下拉）原样 `o.label`/`meta.name` 直取——en/ja 界面下整个主控件中文，而 i18n 体系就在同一组件的 logo 处已在使用。上屏一律走 `types.ts|rtypeLabelOf` / `types.ts|rtypeGroupLabelOf`：键为三段式 `rtype.label.<id>` / `rtype.group.<group>`（**ADR-124 合规**：`rtype.<id>` 两段式只有 pack/shader 等词形不判「角色」才合法，新增 `customAnim` 等会被启发式误判，必须三段式），第二段经 `camelToKey` 归一（`EntityPlayer→entityPlayer`、`minecraft-mod→minecraftMod`）；**缺键回落注册表中文名而非裸 key**——`tOf` 缺键返回 key 原文，直接 `hit || 回落` 会把 `"rtype.label.foo"` 印进界面，必须 `hit === key ? 回落 : hit`。⚠️ 调用期求值（语言热切换须立即生效），禁写成顶层 const 表。三语 locale 必须同步补齐（`locales-consistency.test.ts` 守 1:1）。**新增「按类型/按分组」的展示文案一律走这两个出口**。回归锁：`app-nav/index.test.ts`「资源类型切换器 i18n」3 例——受控 tOf 验证译文命中 / 缺键回落 / 键名族封闭（**不写 `setLang` 断言**：`test-setup.ts` 全局 mock 了 `t.ts` 令 t/tOf 恒查 zhCN，切语言在组件层不可观测，须用 `vi.mock("@/core/i18n/t.ts")` 覆写 tOfMock），均经变异验证
  - ⚠️ **P0 补记（2026-10-15）：上面那句「`camelToKey` 归一（`EntityPlayer→entityPlayer`）」曾是**声明跑在实现前面**的现场——实现只合并连字符、**不降首字母**，而注册表有 7 个 PascalCase 类型 id（EntityPlayer/SceneModel/CustomAnim/CustomMorph/StageAnim/DefaultAnim/DefaultMorph），派生键 `rtype.label.EntityPlayer` 在三语 locale 里**全部落空**（键族按 camelCase 书写），于是 `rtypeLabelOf` 静默走中文回落：**10/15 个类型在 en/ja 界面显示中文**，e2e 每跑一次刷一条 `[i18n] 缺失 key: rtype.label.maidModel`。同族第二处失配是 `resourcepack`/`shaderpack`/`maid-model` 三个 id 对不上旧键名 `pack`/`shader`/`maid`（旧键成为永不被读的孤儿）。三处现均已治：`camelToKey` 补首字母小写（兑现自身契约）+ 三语补 `rtype.label.resourcepack/shaderpack/maidModel` + 删孤儿键。**共犯是判据强度**：app-nav 的「键名族封闭」例当时用 `some(/^rtype\.label\.[a-z]…/)`——只证「有一类命中」，恰好看不见「另一类全落空」；该判据已升为**逐键全判**（filter 不匹配项必须为空）。**根治闸 = `types.test.ts`「rtype.label 键族全覆盖」四例**：① 每个 id 的派生键在三语包**全部存在**（`every`，缺失列表整体 `toEqual([])`，一次报全）；② PascalCase/kebab 两类 id 的归一结果逐个点名（防归一再被改回只处理连字符）；③ **反向无孤儿**（包内 `rtype.label.*` 必须都有对应注册 id，防再攒 pack/shader/maid 那类死键）；④ 三包该键族集合逐字一致。键名一律走**生产 `rtypeLabelKeyOf`** 派生——闸若自己复刻归一规则就是第二份真相，规则一改即失明（与 P0 同源）。`rtypeLabelKeyOf` 因此从 `rtypeLabelOf` 内部提出为公开出口，**用途就是给防漂移闸遍历**，勿当冗余 API 删。变异验证：回退归一 → 3 例红。
  - ⚠️ **消费面纪律（同日）+ 豁免面（2026-10-15 子代理复核订正）**：判据是「**该值是否作为类型显示名上屏**」，不是「凡读 name 都违规」。已收口走出口的渲染点：`app-nav/index.ts`（双下拉）/ `features/dialogs/adv-filter.ts` / `diagnostics/conflicts.ts`（同步冲突类型下拉）/ `diagnostics/dedup.ts|deriveDedupTypeMeta` + `diagnostics/dedup-scan.ts|collectTargets`（去重的单类型与全类型两条分支——后两处函数注释此前自称「标签走 i18n」而实现直取中文，属「声明跑在实现前面」现场）。**不另写 `|| 中文` 兜底**——`rtypeLabelOf` 缺键自回落注册表名、再回落 id，恒非空，写兜底就是不可达死代码。**豁免一：Go 载荷通道已收口**——性能矩阵的 `rtype_label` 由 `go/cli/perf_targets.go|rtypeDisplayName` 取 registry `name`（ADR-262 D2「前端只读不判」，Go 不读前端 i18n）**仍保留在载荷里**，但前端上屏已改走 `diagnostics/perf-common.ts|perfTypeDisplayName`（locale 权威、Go label 只兜未登记 token），故同屏两名已消除；载荷字段本身保留供 CLI/AI 消费，不算死重量。**豁免二：非上屏用途**（目录/路由解析、Go 入参 token、日志标签、仅供测试断言的派生字段）不得为其补 i18n 键，加了就是死重量。**残留**：`GROUP_TYPE_OPTIONS[].label` 是零消费者死字段（app-nav 只用 rtype/subdir 并现取出口）——动作是择机删字段防照抄，不属收口。
  - ⚠️ **回归锁的区分性判据（复核教训）**：全局 zhCN mock 下 `rtypeLabelOf` 与直取中文**同值**，此类用例改前改后都绿 = 零区分度。要锁「真的走了出口」必须覆写 `@/core/i18n/t.ts` 并用**可辨识假译文**（`conflicts-rtype-label.test.ts` / `dedup-rtype-label.test.ts`，回退直取即 4/4、2/4 红，已变异验证）；`vi.mock` 是文件级 → 只能单开兄弟文件。假 `tOf` 须**复刻生产三层链**（当前包 → `FALLBACK_LANG=en` → 裸 key）：只写「缺键返回 key」会把「回落注册表中文」的触发条件高估一层（实际只在 zh 与 en **同时**缺时发生，只缺 zh 时界面拿到英文）。该链与汉字判据均已收口为共享叶 `test-utils/i18n-chain.ts`（两文件同用，防各写一套分叉）；`CJK_HAN_RE` **必须带 `u` 旗标**（无 u 按 UTF-16 code unit 匹配，emoji 代理半区被误判成汉字），且**范围收窄到标签节点本身**——同行还有「N 个文件」这类合法中文，对整行/整页判「无汉字」会把合法文案算成违规（首版即红在此，非产品缺陷）。
  - ✅ **拍板并已落地（2026-10-15 续批）：类型显示名的权威源 = locale（`rtypeLabelOf`），Go 载荷通道收口为回落值**。前端上屏点全部改走出口：`views/app-preview/preview-router.ts|routeTypeMeta`（预览面板标题，泄漏面最高——每次点文件即上屏）/ `utils/resource/types.ts|getPreviewableTypeTabs` 的 tab label + `preview-3d/menu/shell/switch.ts|switchTabLabelOf` 的 preview-key 兜底（3D 切换面板下拉）/ `features/pack-ops/instance-ops.ts` 清空确认弹窗体 / `utils/resource/short-label.ts|shortLabelOf` 的**回落段**（短名表主体是刻意的另一维度，不动；只把 `|| RESOURCE_TYPE_LABELS` 换成 `|| rtypeLabelOf`，8 个无短名类型 en/ja 不再落中文）。**已落地（本批收尾）**：性能矩阵结果表与逐模型行、以及 single-bench 结果标题的类型名，现统一走 `diagnostics/perf-common.ts|perfTypeDisplayName`——**locale 命中优先，Go 载荷 `rtype_label` 只兜未登记 token**（`container`/`other` 这类永远不在 registry 的诚实兜底：`rtypeLabelOf` 对它们原样吐回 id，若就此渲染就变回「container container」双印，Go 侧 `perf_manifest_registry_test.go` 立过闸）；未登记且无 Go label 时原样回显 id（宁露 token 不冒充译文）。同屏两名在此收口，`perf-matrix.test.ts` 新增三条区分性锁（Go label 异词被弃 / 兜底 token 采信 Go / 怪 token 回显 id），变异已验证。**三条改判过的断言随定名终审改回**：`preview-router.test.ts`「人物模型」→「角色模型」、`types.test.ts` vrm/mmd tab 同上、`short-label.test.ts`「FBX 模型」→「FBX 模型/动画」——这次不是中文回落，而是**终审结果**（见下条定名表）。⚠️ `short-label.test.ts` 的 t.ts mock 工厂**必须同时导出 `tOf`**——回落段现走出口而出口内部用 `tOf`，工厂只给 `t` 会让 `types.ts` 拿到 undefined、回落一调即 TypeError（本批实测踩到）。
  - ✅ **定名终审归零（2026-10-15，用户拍板「源头对齐」）**：原 6/15 漂移（zh 键值 ≠ 注册表 name）已逐词终审定名并由**闸**锁死——`EntityPlayer=角色模型`（遵 ADR-111 既有拍板）、`CustomAnim=自定义动作`、`StageAnim=场景动作`、`DefaultAnim=默认动作`、`mmd-shader=MMD 光影`（与 shaderpack=光影包 同族）、`fbx=FBX 模型/动画`（该类型确实覆盖模型+动画两义）。**双向权威**：上屏显示名 = locale（`rtypeLabelOf`）；Go 日志/CLI 文本 = 注册表 `name`；zh 键值与注册表 name **逐字相等**是全类型不变量，由 `utils/resource/types.test.ts`「zh 键值 == 注册表 name」用例守（改一侧不改另一侧即红，已变异验证：zh 回改「人物模型」→ 1 红）。en/ja 是译文，不参与该对齐。**代价已结清**：`camelToKey` 归一修复让这六个 zh 键首次生效，故这六个类型的中文界面显示名随 P0 变化——**P0 不是零行为变化的收口**；`siblings.ts` 内写死的日志字面量「舞台动画」同批改为注册表派生（`stage-siblings.test.ts` 钉新词），杜绝二次漂移。
- **扩展名静态映射**：类型 → 扩展名列表（`RESOURCE_EXTS`）/ 全量去重（`ALL_EXTS`）/ 反查（`extBelongsTo`）——拖拽导入等场景需同步判断，不能等异步注册表
## 对外 API / 入口

`schema.ts`（同步单一解析点，ADR-269 D3 起取代异步加载器）：
- `allResourceTypes: ResourceType[]` — 全类型条目数组（插入序 = JSON 序），`types.ts`/`extensions.ts`/`web-fs.ts`/`site-edit.ts` 等消费
- `resourceTypesById: Record<string, ResourceType>` — 按 id 键控视图（`Object.fromEntries` 保序），取代原 `loadResourceRegistry()` 的 keyed-map：设置/诊断/同步管理等键控消费方直读此处，与 `allResourceTypes` 同源、无空表窗口
- `ResourceType` 接口（前端消费字段子集，完整 schema 事实源仍是 Go `go/types/resource.go` + 根 `resource_types.json`）：`id/name/icon/group/groupLabel/groupIcon/extensions/storageSubDir/configField/instanceDir/preview/detector/geometrySearchable/variants/zipEntries`；Go 新增未被前端消费的字段不要求补声明
- ⚠️ 历史：原 `services/resource-registry.ts` 提供 `loadResourceRegistry()`（走 `getApp().LoadResourceTypes()` 异步 RPC + 模块级 `_registry` 缓存），ADR-269 D3（2026-09）删除全部消费方后连模块一并退役——勿再引用

`types.ts`（同步常量）：
- `RESOURCE_TYPES: Record<string, string>` — 15 个 ID 常量（与 `resource_types.json` 对齐）：YSM/MMD/SCENE/CUSTOM_ANIM/CUSTOM_MORPH/STAGE/MMD_SHADER/DEFAULT_ANIM/DEFAULT_MORPH/PACK/SHADER/BLUEPRINT/LITEMATIC/MAID/FBX → "ysm"/"EntityPlayer"/"SceneModel"/... 完整列表见 `types.ts` 源码
- `RESOURCE_TYPE_LABELS: Record<string, string>` — ID → 中文标签；**派生自 `resource_types.json` 的 `name` 字段**，单一事实源，新增类型只需改 JSON
- `ALL_RESOURCE_TYPES: string[]` — 全部 ID 列表
- 能力元数据派生（T2 起与 `extensions.ts` 同源共享 `schema.ts`）：
  - `extOf(path)` — 路径→小写扩展名（含点）
  - `matchTypeByExt(path, typeId)` — 按注册表 extensions 判定归属（不处理歧义，`loader.ts` WASM 能力判定用）
  - `isYsmWasmPreview(path)` — ysm 单文件（`.ysm`/`.json`）走前端 WASM 预览，`.zip`/`.7z` 容器由 Go `FindPreviewImage` 兜底
  - `VOXEL_RPC_BY_EXT` — `.nbt/.schematic/.litematic` → `GetNbtVoxelData/GetSchematicVoxelData/GetLitematicVoxelData` 单点映射
  - `AMBIGUOUS_EXTS` — 歧义扩展名集合（同扩展名归属 ≥2 类型，如 `.zip` 归属 7 类），从注册表派生、新增类型自动纳入
  - `resolveTypeSafe(path)` — **安全解析入口（ADR-067 S4）**：单归属扩展名直接命中；歧义扩展名返回 `null` 强制调用方回退 Go `DetectResourceType` 内容检测；新分发器（P1 VRM / P2 MMD 适配器）统一使用
  - `resolvePreviewKey(filePath, rtype)` / `resolvePreviewKeyToRtype(previewKey)` / `resolvePreviewKeyByExt(filePath)` / `resolveDefaultPreviewKey(rtype)` — 预览路由 key 派生链（ADR-111；`resolvePreviewKeyByExt` 是歧义扩展名预览路由兜底，只做「预览适配器路由」派生、不参与类型判定）
  - `isContainerExt(pathOrExt)` — 压缩容器扩展名判定（值集派生自 `schema.ts|containerExts` ← JSON 顶层 `containerExts`）
  - `GEOMETRY_SEARCHABLE_TYPES` / `isGeometrySearchableRtype(rtype)` — 几何分析管线（Go SearchModels 数值条件：AnalyzeBedrockModel + geoCache）可解析类型集，派生自 JSON `geometrySearchable` 声明（当前 ysm / maid-model）；adv-filter 数值区展示门控消费（见 dialog-adv-filter 卡）+ 未来跨类型搜索分流判据（ADR-343）；测试 `types.test.ts`「GEOMETRY_SEARCHABLE_TYPES 派生集」与 JSON 对账防漂移
  - 内部实现（非导出）：`RESOURCE_CAPS`（派生能力表）/`resolveTypeByExt`（反查）——外部统一走 `resolveTypeSafe`/`matchTypeByExt` 等安全入口

`extensions.ts`（类型 ↔ 扩展名静态映射）：
- `RESOURCE_EXTS: Record<string, string[]>` — 类型 → 扩展名列表静态映射（与 `resource_types.json` 对齐，由 `schema.ts allResourceTypes` 派生；完整列表见 `extensions.ts` 源码）
- `ALL_EXTS: string[]` — 全部扩展名去重列表（按 RESOURCE_EXTS 出现顺序）
- `getExts(rtype: string): string[]` — 取某类型的扩展名列表，未知类型返回 `[]`
- `isSupportedExt(ext: string): boolean` — 扩展名是否被支持（大小写不敏感）
- `extBelongsTo(ext: string): string[]` — 扩展名所属的资源类型列表（如 .zip 同属 ysm / resourcepack / shaderpack 三类）

## 与其他子系统关系

- `RESOURCE_TYPES` 是消费面最广的前端常量：`app-sidebar`、`app-tree`、`app-content`、`app-sync-manager`、`app-preview`、core handler 系、`features/*`
- 键控消费方（ADR-269 D3 起同步读 `schema.ts` `resourceTypesById`）：`features/maintenance/recycle-bin.ts`（图标走 `typeIconOf`）、`app-content/settings/init.ts`、`app-content/diagnostics/dedup.ts` + `perf-matrix-render.ts`、`app-sync-manager/store.ts`
- `RESOURCE_EXTS`/`ALL_EXTS` 消费方：`features/dnd-shared.ts`（拖拽过滤）、`features/import-dnd.ts`、`features/import-queue.ts`、`views/app-tree/toolbar-search.ts` + `toolbar-commands.ts`（getExts）
- 一致性对端：`resource_types.json`（单一事实源）↔ Go `LoadRegistry()` 运行时加载（无静态 ResourceExts 表）↔ 本文件
- Wails 调用统一走 `getApp()`（治理红线 §3.2）
- 图标派生消费方（`typeIconOf` → `fileIcon`）见 [utils_display](./utils-display.md)

## 不变量

- **不在前端手写新的 StorageSubDir / ResourceExts 条目**，新增类型从 `resource_types.json` 开始（注册表优先，AGENTS.md §4.4）——改扩展名一步到位：只改 JSON，Go 端运行时直读，前端 `types.ts`/`extensions.ts` 经 `schema.ts` 自动跟随
- `RESOURCE_TYPE_LABELS` 是 UI 类型中文文案来源，新增类型必须同步补标签
- `schema.ts` 的 `allResourceTypes`/`resourceTypesById` 是构建期内联派生的只读视图，消费方只读不改写（改写会污染同会话所有消费方）
- **歧义扩展名（`.zip`/`.7z`）禁止用扩展名直判类型**：必须经 `resolveTypeSafe`（返回 null）回退 Go `DetectResourceType` 内容指纹
- 扩展名比较一律小写；扩展名带前导点（".ysm"）
- **`extBelongsTo` 返回顺序为前端表插入序**（P4 观察：Go `ExtBelongsTo` 为注册表序，跨语言数组序不一致——当前前端无生产消费者，若未来 FE↔Go 精确对比需定义排序契约）
- 一致性由 vitest 守护：`types.test.ts`（RESOURCE_TYPES/LABELS 与 JSON 对账、`AMBIGUOUS_EXTS` 派生一致、`resolveTypeSafe` 单归属/歧义/大小写、`VOXEL_RPC_BY_EXT` 全覆盖）+ `extensions.test.ts`（双向对账 JSON→前端 + 前端→JSON）+ `consistency.test.ts`（`types.ts`↔`extensions.ts` id 集合/扩展名全等）+ Go `registry_test.go`

## 相关

- [resource_registry](./resource-registry.md) — `resource_types.json` 单一事实源 + Go 端加载
- [utils_display](./utils-display.md) — 文件图标 fileIcon / 文件名着色（同源派生消费）
- [wails_bridge](./wails-bridge.md) — getApp() 桥接
- 测试入口：`frontend/src/utils/resource/types.test.ts`、`extensions.test.ts`、`consistency.test.ts`