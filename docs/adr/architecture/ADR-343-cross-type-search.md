# ADR-343：跨类型搜索收口（Type 派生 + 分析器分流 + SearchFilters）

- **状态**：📝 提议中（Proposed）
- **日期**：2026-10-14
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **准入理由**：公共契约变更（Wails 绑定 + SearchResult 语义）且跨域影响面大、难逆转
- **相关**：ADR-183（8 参数封装暂缓决策，本 ADR 实施后取代之）、知识卡 `search.md` / `go-types-registry`（`geometrySearchable` 字段）

---

## 1. 背景（Context）

<!-- ⚠️ 本节是「决策当时」的状态快照，ADR 落地后此处的病灶可能已治愈；评估「现在是否还这样」以当前源码树 + 知识卡实施进度为准，勿把本节当现状。 -->

`SearchModels`（`internal/app/app_scan.go`）是全仓唯一高级搜索后端，但数值条件管线是 **Bedrock-only 语义**：

- 阶段二对**全部类型**条目跑 `AnalyzeBedrockModel`（几何分析只认识 .ysm / Bedrock 归档 / ysm.json）；
- `modelMatchesFilters` 首行 `if model.BoneCount == 0 { return false }` —— MMD（.pmx 无解析分支）/ 蓝图 / 资源包等条目解析恒空 → **带数值条件搜索时整类静默蒸发**，不报错、不提示；
- `SearchResult.Type` 带 `omitempty` 从不填充（`go/types/types.go`）——跨类型语义未接上（死字段制度化，见知识卡 `search.md`「查证根因」段）；
- 签名 8 个位置参数（ADR-183 决策：标记技术债、暂缓封装——`types.SearchFilters` 尚未立起，第 4 刀收编）。

2026-10-14 锐评 P1：用户视角「筛选后我的模型全没了」。已落地的**过渡态（A 案，本 ADR 的前置工程）**：`resource_types.json` 新增 `geometrySearchable` 声明（ysm / maid-model），前端 adv-filter 数值区按该声明做**展示端门控**（无管线类型禁用 6 数值输入 + 提示 + 提交归 null）——杀掉静默蒸发，但不提供 MMD 等类型的数值搜索能力，也不修 Type 死字段。

## 2. 决策（Decision）

跨类型搜索收口，四刀（顺序即依赖序）：

1. **全量 `ScanModelEntries` 派生 `Type`**（回归红线域：判定归 Go + registry 单一事实源）：
   - 裸扩展名：`registry.ExtBelongsTo`（单声明者直判，多声明者歧义）；
   - 容器扩展名（.zip/.7z）：`containerCache` 指纹（`packs.DetectResourceType`）——`ScanModelEntriesFiltered` 已有该口径，提到全量路径复用；
   - 歧义/未命中 → `Type = "other"`（诚实占位，不猜，同 `ClassifyResource` 的 `ClassOther` 口径）；
   - 成本面：全量扫描多一次「扩展名查表 + 容器指纹（带缓存）」，容器指纹未命中才开归档（已有 30s 失效 + 指纹复用，边际成本受控）。
2. **`SearchModels` 按 `Type` 分流分析器**：Bedrock 系（ysm / maid-model）走 `AnalyzeBedrockModel`（现状）；MMD 系数值语义按 `model-stats`（Web Worker 统计层，骨骼数有口径）接入，或先**只开放关键词 + 标签路**（数值区对 MMD 维持 A 案门控，直至 MMD 数值管线立项）；蓝图/资源包/光影包 = 关键词 + 标签（无数值语义）。
3. **`SearchResult.Type` 收口**：填充实际类型，前端可展示类型图标；跨类型搜索（全仓根）结果自解释。
4. **`types.SearchFilters` 封装 8 参数**（ADR-183 留的后路）：`SearchModels(filesRoot, filters SearchFilters)`——Wails 绑定契约变更（`npm run generate:bindings` 重生成 + 前端调用点 + CLI 3 处 + 测试位同步），本刀顺带把类型分流参数（目标 rtype 集合）一并带上。

**非目标（Non-goals）**：不做全文搜索（几何/纹理内容不可搜）；不改 `ListByTag`；MMD 数值管线（骨骼数统计口径接入 SearchModels）单独立项，本 ADR 只留分流接缝。

## 3. 后果（Consequences）

| 正面 | 负面 |
|------|------|
| 「模型蒸发」P1 根治（能力面而不仅是提示面） | Wails 绑定破坏性变更：generate:bindings + 前端调用点 + CLI + 60+ 测试位 |
| `SearchResult.Type` 死字段复活，跨类型搜索结果自解释 | 全量扫描多一层类型派生（成本受控但需 benchmark 门槛：`scan-bench` / `single-bench` 对照） |
| ADR-183 技术债一次性还清 | 实施跨多会话，需按刀拆 PR/提交（每刀独立可验） |
| 回归红线不变：判定仍归 Go + registry（本 ADR 是红线的扩展而非绕过） | 「Type 派生」依赖 containerCache 指纹正确性——指纹错判会把整类条目归错 Type（需 parity 测试兜底） |

**已知遗留**：`geometrySearchable` 的 maid-model 声明基于「maid 归档走 Bedrock 几何管线」的证据（go/geometry maid_l0 分片），数值管线实证需补一条 CLI 回归（maid zip → `SearchModels` minBones 有结果）。

## 4. 数据溯源

- 2026-10-14 锐评（本轮会话）：P1 数值筛选 Bedrock-only 静默排除 + 死字段制度化（`modelMatchesFilters` 首行 / `SearchResult.Type` omitempty 实证）
- A 案落地（过渡态）：`resource_types.json` `geometrySearchable`（ysm / maid-model）+ 前端 adv-filter 门控（`GEOMETRY_SEARCHABLE_TYPES` 派生集 + 展示端禁用/归零）
- ADR-183：8 参数封装暂缓决策（本 ADR 第 4 刀取代其「下轮路径」）
- 知识卡 `search.md`「查证根因」段：Type 死字段是架构路径决定的，须先做全量 Type 派生——本 ADR 第 1 刀即该前置

<!-- 文件名: cross-type-search.md → 实际文件 architecture/ADR-343-cross-type-search.md（ADR-320 architecture 全量模板） -->
