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
  - 搜索成本
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
- 已知黑话存量：见上文表格；清理后本条改为「扫描命令 + 零残留验证」。

## 与其他子系统关系

- **ADR-161**：本卡是其「实施中扩大发现」的沉淀；ADR-161 的 built→content 只落地 mount-preview-core，适配器/测试层残留见本卡 §概览。
- **preview_core.md**：渲染会话词汇章节 = ADR-161 词表 + 实施状态；built 残留的「双词并搜」提示见该卡。

## 不变量

- 内容适配器新代码不得再出现 `built` 作为场景对象变量名；`mdLi*`/`dgPc*` 等私有前缀不得新增。
- 生命周期操作动词在文档/注释里与被治理词一致，不引入第 15 个动词。

## 相关

- ADR-161（渲染会话词汇章程）、`docs/knowledge/preview_core.md`（会话词汇词表）
