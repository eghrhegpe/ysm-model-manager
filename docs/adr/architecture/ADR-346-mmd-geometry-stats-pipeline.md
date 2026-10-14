# ADR-346：MMD 几何统计管线（数值搜索能力扩展）

- **状态**：✅ 已采纳（2026-10-14 当日拍板执行：选案 A flag 复用 / 合成 fixtures TDD / 性能门禁 ≤50ms 量级 / 桌面 Go 管线范围；数据溯源见 §4）
- **日期**：2026-10-14
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **准入理由**：公共契约变更：resource_types.json capability 声明消费面扩展 + SearchModels 数值分流扩 MMD 族，跨 Go/前端/注册表三域
- **相关**：[ADR-343](ADR-343-cross-type-search.md)（分流接缝与遗留挂账处）、[ADR-183](../ADR-183-searchmodels-8.md)（SearchFilters 封装，本 ADR 零契约变更的前提）、知识卡 [model-stats](../../knowledge/model-stats.md)、[search](../../knowledge/search.md)、[go-types](../../knowledge/go-types.md)

---

## 1. 背景（Context）

<!-- ⚠️ 本节是「决策当时」的状态快照，ADR 落地后此处的病灶可能已治愈；评估「现在是否还这样」以当前源码树 + 知识卡实施进度为准，勿把本节当现状。 -->

ADR-343 四刀落地后，`SearchModels` 数值条件路径按 `entry.Type` 分流：仅 `geometrySearchable` 声明类型（ysm / maid-model，Bedrock JSON 全几何管线）进分析器，非几何系显式排除（刀 2 语义，「蒸发无告警」病灶已修——排除是**诚实门控**而非静默蒸发）。

MMD 族（EntityPlayer / SceneModel 的 .pmx/.pmd）当前**无任何数值语义通道**，全链路核实（2026-10-14）：

- **Go 侧零解析链路**：`AnalyzeBedrockModel` 无 MMD 分支；`analyze-mmd` CLI 命令是**扩展名资产盘点**（数量/大小聚合，`go/cli/cli_analyze_mmd.go`），不含几何统计
- **PMX 解析器只在前端 3D adapter**（Three.js 生态 `@moeru/three-mmd`）——CLI/benchmark 对此有显式声明：`bench_concurrent.go` 的「无 .ysm 命中退化为喂 PMX 进分析链路」、`gui-flow` 的「PMX/PMD 加载链路在 Three.js 前端，CLI 不模拟」
- **web 端数值统计走 model-stats Worker（YSM-only WASM）**——MMD 在 web 数值搜索中同样缺席
- 数据后果：MMD 仓库用户的数值搜索（骨骼数/纹理尺寸）= 空结果集（诚实门控下的显式排除），能力缺口在 ADR-343 刀 2 挂账「MMD 数值语义单独立项」

本地样本区无 MMD 包（ADR-343 遗留项同记），立项即须一并解决验收样本问题。

## 2. 决策（Decision）

1. **Go 侧轻量 MMD 统计解析**（非 3D 全解析）：新增 `go/geometry/mmd` 包，产出**统计级**数据——骨骼数 + 纹理尺寸：
   - `.pmx`（XML）：流式/局部解析 `<bone>` 元素计数；纹理尺寸取 PMX 头声明（旧版字段），缺失时按纹理引用文件（.tex → PNG IHDR 头 24 字节）探测——不做贴图全量解码
   - `.pmd`（二进制）：读文件头版本标记 + 骨骼数定长字段（格式公开稳定，魔数 `1284595134`/`1284595136` 双版本）
   - 立方体数 = 0（诚实零值：MMD 无 cube 语义——cube 数值条件天然筛掉 MMD 条目，UI 提示层说明即可，不造假数据）
2. **分流接点**：`AnalyzeBedrockModel`（或其上层 `SearchModels` 分析阶段）按 `entry.Type` 增 MMD 族分支调用新解析器，geoCache 指纹机制复用（键 = 剥 .ban 后缀路径，与 YSM 管线同口径）；`SearchModels` 签名**零变更**（刀 4 的 SearchFilters 结构体已就位）
3. **capability 声明扩展（选案 A：flag 复用）**：`resource_types.json` 为 EntityPlayer / SceneModel 标 `"geometrySearchable": true`，语义扩展为「数值统计管线可产出」（全几何 = 强形态，统计级 = 弱形态，cube 诚实零值）；前端 `GEOMETRY_SEARCHABLE_TYPES` 派生集自动传导（零前端判定逻辑新增，红线合规）。选案 B（新增 `statsSearchable` 双 flag）被拒：双 flag 分流复杂度 > 收益——MMD 弱形态仅 cube=0 一处差异，文档化即可
4. **范围裁剪（本轮）**：桌面 Go 管线（ysm-model-manager 主搜索路径）；.vrm/.fbx/.gltf 与 web 端 Worker MMD 统计**不进本 ADR**——web 数值搜索对 MMD 维持关键词快路径降级（web-fs 的 `consumeWebSearchDegraded` 语义已有提示位），桌面/web 语义差在 ADR 后果中显式声明，web 侧 MMD 统计待产品需要时另立

## 3. 后果（Consequences）

**正面**：MMD 仓库数值搜索从「空集」到「骨骼数 + 纹理尺寸可用」（cube 条件诚实零值）；解析成本有界（PMX 统计级局部解析 << 全 3D 解析）；flag 复用 = 前端门控自动解锁 MMD 数值输入（dialog-adv-filter 的禁用逻辑零改动）；geoCache 复用 = 重复搜索零重解析

**负面 / 代价**：PMX 大模型（数百 MB 含贴图包）统计解析须局部化设计（bone 节区定位，不全文档 DOM 加载）；`.pmd` 双版本魔数分支；桌面/web 数值语义差扩大（桌面 MMD 可数值、web 降级关键词——提示层文案需区分）

**已知遗留（随决策范围声明）**：
- 本地无 MMD 样本——验收前提 = 用户提供 1 个 .pmx + 1 个 .pmd 真实样本（或按 PMX 1.1 / PMD 2.0 公开格式规范构造最小 fixtures 先行 TDD，真实样本回归复核）
- 性能门禁数值（单文件统计解析耗时上限）审批时拍定（方法学沿用 ADR-343 基线法：`benchmark` 前后对照）
- web 端 MMD 统计（Worker 侧 `@moeru/three-mmd` 统计分支）待立项

## 4. 数据溯源

- ADR-343 遗留挂账（「MMD 数值语义单独立项」）→ 本 ADR 立项；ADR-343 §2 刀 2 与「非目标」两条指针已改指本 ADR
- 链路核实（2026-10-14 grep/读码）：`go/cli/cli_analyze_mmd.go`（资产盘点无解析）/ `go/cli/bench_concurrent.go` 与 `go/cli/flow_phases.go`（「解析器只在前端 3D adapter」声明）/ `docs/knowledge/model-stats.md`（Worker = YSM-only）
- 冒烟实证（同日，`tmp/verify-repo` 加 MMD 布局 `3d-skin/EntityPlayer/*.pmx`）：无过滤搜索 5/5 条（pmx 零值直通）、`--min-bones 1` 仍 2/2（MMD 显式排除于数值路径）——证实 A 案门控在搜索侧闭环，能力缺口定位准确
