---
kind: frontend_naming
name: 前端命名章程（黑话治理）
tier: leaf
category: ui
source_files:
  - frontend/src/preview-3d/adapters/litematic-adapter.ts
auto_fields:
  symbols_with_lines:
    - buildLitematicScene
    - LITEMATIC_SLICE_SCHEMA_ID
    - LitematicBuildOpts
use_when:
  - 黑话
  - 命名
  - 缩写
  - 重命名
  - 可读性
  - 匈牙利前缀
  - 单字母变量
  - 动词名词化
pitfalls:
  - 「built」黑话已从 mount-preview-core 扩散到全部内容适配器与测试（litematic-adapter/fbx-parser/pack-model-adapter + mmd/vrm/fbx/litematic 测试），ADR-161 §2.3 只划了 mount-preview-core 内部，划界过窄——重命名治理必须按「文件族」整体扫，不能只治感染源
  - 私有缩写前缀（MdLi*/dgPc*/si）是命名空间缺失的补偿：符号可 grep 得到归属却读不出语义，搜索「尺寸信息」/「阶段解析」全落空
  - 单字母业务量（w/h/l、b、v、m、d）比缩写更隐蔽——类型是 number 不携带语义，w/h/l 三个单字母挤一行只能靠顺序猜
  - 生命周期动词家族一义多词（dispose/destroy/unload/unmount/detach/remove/close/clear/cleanup 等全仓 1683 次），同语义多动词 = 语义边界未定义
quick_groups:
  - 命名与可读性
  - 黑话治理
quick_intents:
  - 前端有没有黑话 / 命名烂在哪
  - 重命名某个变量/函数
  - 为什么搜索「尺寸信息」找不到 si
  - built 黑话还剩哪些没清理
quick_risk_lines:
  - 禁止新增不可读私有缩写前缀（≤3 字母非领域词）；禁止单字母命名业务量（循环下标 i/j 除外）
  - 生命周期动词一义一词：卸载=unmount、资源释放=dispose、会话收尾=finish/cleanup
  - 内容适配器 build 返回值统一命名 content（禁 built），新适配器照此写
  - 跨文件同函数禁双份定义（getCompound 在 nbt-parse.ts 与 voxel-parse.ts 各一份）
invariant_anchors:
  - frontend/src/preview-3d/adapters/litematic-adapter.ts|mdLiSetupCameraAndGrid
---

# 前端命名章程（黑话治理）

## 概览

2026-09 ADR-161「渲染会话词汇章程」实施时扩大扫描 `frontend/src` 404 个生产 TS 文件，发现命名黑话远超章程六类，按模式统计：

| 黑话模式 | 规模 | 代表位置 |
|----------|------|----------|
| built 动词名词化（已扩散适配器层） | 250+ 处 | `litematic-adapter.ts`/`fbx-parser.ts` + 全部适配器测试 |
| 匈牙利私有缩写前缀 `MdLi*`/`dgPc*` | ~89 处 | `litematic-adapter.ts`（41）/`views/app-content/diagnostics/perf-cli.ts`（48） |
| 单字母业务变量 | 729 处声明 | `backend/nbt-parse.ts`（w/h/l/b/n/v） |
| 生命周期动词家族一义多词 | 全仓 1683 次 | `mount-preview-core.ts`（89 次自证） |
| 动词名词化（parsed/loaded/saved/selected 当名词） | 268 处 / 55 文件 | `core/i18n/locale.ts`、`utils/dom/dialogs/modal.ts:487` |
| 同函数双份定义 | 2 例 | `getCompound`（nbt-parse + voxel-parse）、`getExt/getExts`（icon + extensions） |

## 核心职责

为前端命名建立「符号可读性」纪律，与 ADR-161 的四级尺度词（组件/模型/内容层/entry）互补：ADR-161 治「一物多名 / 一词多尺度」，本卡治「符号本身不可读」。

**章程条款**：
1. **禁私有缩写前缀**：3 字母以下、非领域词、不可读前缀（`MdLi`/`dgPc`/`si`/`Sb`）一律禁止。文件归属交给 import 路径，符号名交还语义（`parseSingleBenchStages()` 优于 `dgPcSbParseStages()`）。
2. **禁单字母业务量**：凡有业务语义的量不得单字母（`w/h/l`=宽高长属业务量，不是循环下标）。可辩护例外：循环 `i/j`、数学惯例 `r/g/b`、`x/y/z`。
3. **生命周期动词一义一词**：卸载=unmount（注册表+DOM）、资源释放=dispose（GPU/句柄）、会话收尾=finish/cleanup（幂等出口）。同一语义禁止 dispose/destroy/detach/remove/close 混用。
4. **build 返回值统一 `content`**：内容适配器 `buildXxxScene()` 返回值（含 update/dispose/menuItems/roots 的场景对象）统一命名 `content`，禁 `built`——动词过去分词当名词语义不可达，搜索「场景/内容」落空。
5. **跨文件禁双份定义**：同函数不得两份拷贝（`getCompound` nbt/voxel 各一份），应合并共用。

## 对外 API / 入口

- 本次扫描方法：按「动词名词化 / 占位名 / get 泛化 / 缩写前缀 / 单字母 / 动词家族」六类正则扫生产 TS（排除 test/vendor/test-utils），每类可复扫。

## 清理进度（2026-09 批次）

**✅ 已清理（commit 694083d8 / a46636c3）**：
- 内容适配器 build 返回值 `built`→`content`（测试层 mmd/vrm/fbx/litematic/mount 全清，`registeredItems(built)` 参数同步）；生产残留注释（camera-controls/pack-model-adapter/ysm-adapter）同步。
- `litematic-adapter.ts`：参数 `si`→`sizeInfo`（24 处）、内部网格中间态 `built`→`meshSet`、类型 `MdLiBuiltMeshes`→`LitematicMeshSet`。
- `fbx-parser.ts`：两遍构建节点缓存 `built`→`nodeObjects`（非内容层语义，独立定名）。
- `perf-cli.ts`：不可读前缀 `dgPc` 删除（文件归属冗余）、段缩写展开 `Sb/Gf/Pl`→`singleBench/guiFlow/perfLog`、类型 `DgPc*`→`SingleBench*/GuiFlow*/PerfLog*/GenGuard`（段前缀有消歧价值故展开保留，`guiFlowParseEntries`/`perfLogParseEntries` 防撞）。
- `mount-preview-core.test.ts`：测试桩 `makeBuilt`→`makeContent`、`built1/2`→`content1/2`、`builtA/B`→`contentA/B`、`unloadBuilt`→`unloadContent`。
- **收尾清扫（文档同步）**：测试层最后 2 处漏网（`vrm-adapter.test.ts` `built2`、`mount-preview-core.behavior.test.ts` `builtScene`）→`content2`/`contentScene`；现状文档残留旧词同步（`architecture.md`/`model3d.md`/`preview_core.md` 的注册表元数据 `built`→`content`、abort 登记 `session.built`/`allBuilt`→`session.content`/`allContent`；ADR-093 实装表与 dispatch、ADR-131 合并注入）。至此「测试层全清」为真：`frontend/src` 生产+测试层 `built` 作内容层名词零残留（i18n「built-in/not yet built」等英文非黑话，保留）。

**✅ 已清理（commit 1af5f8e8 之后续扫，2026-09）**：
- **setBuilt 链**（built→content 主战役 8f5a2b63 自身漏改的半边 setter）：`mount-preview-core.ts` `setBuilt`→`setContent`（与 getContent 对称）、`switch-preview.ts` `SwitchContext.setBuilt` 契约+3 调用点→`setContent`、测试桩/标题/`oldBuilt`→`oldContent` 同步。
- **`workerBuilt`→`workerResult`**（mmd-adapter.ts 11 处）：worker 路径 `buildPmxSceneSliced` 产物缓存，与 `pmxParsedData` 对仗；`PmxBuildResult` 类型名保留（builder 正当领域词）。
- **同函数双份定义收敛**（红线落地）：`isObj`/`asString`/`asNumber`/`asArray`/`getCompound` 曾 nbt-parse.ts 与 voxel-parse.ts 各抄一份逐行相同 → 提取 `frontend/src/utils/core/nbt-guards.ts` 共用，两文件改 import（voxel 独有 `asLongArray`/`asByteArray`/`paletteToColors` 非双份，就地保留）。搜索「getCompound」从两文件收敛为一。
- **三轴单字母展开**：`nbt-parse.ts schematicSummaryView` 与 `voxel-parse.ts schematicVoxelView`/`indexToCoord` 的 `w/h/l`（Width/Height/Length）→`width/height/length`（知识卡 pitfall 教科书案例）。
- **`postprocessing-capability.test.ts` `built` 布尔旗标**→`composerBuilt`（记录 buildComposer 是否被调，与同函数 `disposed` 对仗）。
- **防回潮脚本**：`scripts/check-naming-blacktalk.ts`（WARN 级，仿 check-boolean-naming 范式，默认不入 doctor 闸门）：built 名词家族零容忍 + w/h/l 三轴单字母挤一行检测，手动 `node scripts/check-naming-blacktalk.ts [--strict]` 可跑。

**✅ 已清理（commit 6ad4cdd5，2026-09）——知识库反向扫描发现**：
- **`gc*` 私有前缀展开**（ground/water capability，7 生产符号）：`ground-capability.ts` `gcBuildMain`→`buildGroundMain`、`gcBuildMaterialGroup`→`buildGroundMaterialGroup`、`gcSliderDef`→`groundSliderDef`、`gcColorDef`→`groundColorDef`、`gcButtonDef`→`groundButtonDef`；`water-capability.ts` `gcBuildWaterGroup`→`buildWaterGroup`（**water 误用 gc 前缀**——前缀与语义矛盾，一并根除）。
- **`dgAf*` 私有前缀展开**（toolbar-search.ts，14 生产符号 + 测试引用）：`dgAfIsUnset`→`advFilterIsUnset`、`dgAfToNum`→`advFilterToNum`、`dgAfHasNumRange`→`advFilterHasNumRange`、`dgAfReadCurAndOpenDialog`→`advFilterReadAndOpenDialog`、`dgAfBackfillInlinePanel`/`dgAfBackfillResult`→`advFilterBackfill*`、`dgAfEarlyEmpty`→`advFilterEarlyEmpty`、`dgAfFetchTagPaths`→`advFilterFetchTagPaths`、`dgAfSearchModelPaths`/`dgAfSearchResult`→`advFilterSearch*`、`dgAfWarnWebDegraded`→`advFilterWarnWebDegraded`、`dgAfIntersectPaths`→`advFilterIntersectPaths`、`dgAfToastAndRender`→`advFilterToastAndRender`。
- 两张知识卡同步（ground-cap-materialgroup-factories.md / search.md）+ 生成物（index/routes-quick）由 gen 自动刷新。
- **扫描方法沉淀**：知识卡教黑话符号 = 病灶固化（search.md 自称「8 段 dgAf* 流水线」、ground 卡教 gc* 工厂）——反向扫描「知识库正文里的可疑缩写 token」（2-3 字母小写前缀+驼峰）即可命中此类存量；`mdLi*` 等有领域语义的格式标识除外。

**🔲 待清理（存量，未排期）**：

> **鉴定注记（2026-09 扫描 + 定量复核）**：知识卡原列「生命周期动词家族一义多词（1683 次）」「动词名词化（268 处/55 文件）」经代码分层抽样鉴定后**撤回**：
> - 动词家族：生产代码 664 处（测试 1019 处）中 `dispose`/`detach`/`unload`/`cleanup`/`closeOverlay`/`unmount` 分属不同层级语义（Three.js 资源释放 / DOM 解绑 / 模型卸载 / 会话收尾 / UI 关闭 / 视图解挂载），各层独立、互不交叉——**非混用，是分层正确**。
> - 动词名词化：268 命中 95% 为 `const parsed = JSON.parse(...)` 惯用局部变量（可辩护），真持久实体名词化 < 10 处（`selectedSet` 等语义清晰），无检索阻断效应。
> - 单字母业务量（w/h/l）本轮已展开，待清理清单内对应条目已消失。
> 结论：**前端命名黑话存量已清零**，本卡 §章程条款 + §不变量仍适用（禁新黑话 + mdLi 格式标识除外），无需进一步批量治理。

**决策注记**：`mdLi*`/`MdLi*` 前缀**保留**——它是有领域语义的格式标识（Minecraft Litematic），且 preview_core 词表以 `make<Format>Adapter` 为格式入口锚。章程禁的是「不可读前缀」（`dgPcSb`/`gc*`/`dgAf*` 已清），不是「格式标识」。

## 与其他子系统关系

- **ADR-161**：本卡是其「实施中扩大发现」的沉淀；ADR-161 的 built→content 原只落地 mount-preview-core，适配器/测试层残留已由本卡清理进度追踪（见 §清理进度）。
- **preview_core.md**：渲染会话词汇章节 = ADR-161 词表 + 实施状态；built 残留的「双词并搜」提示见该卡。

## 不变量

- 内容适配器新代码不得再出现 `built` 作为场景对象变量名；不可读私有缩写前缀（`gc*`/`dgAf*`/`dgPc*` 类，≤3 字母非领域词）不得新增——文件归属交给 import 路径，符号名交还语义（`buildGroundMaterialGroup`/`advFilterIntersectPaths` 优于 `gcBuild*`/`dgAf*`）；`mdLi*`/`MdLi*` 格式标识（Minecraft Litematic 领域词）除外。
- 生命周期操作动词在文档/注释里与被治理词一致，不引入第 15 个动词。

## 相关

- ADR-161（渲染会话词汇章程）、`docs/knowledge/preview_core.md`（会话词汇词表）
