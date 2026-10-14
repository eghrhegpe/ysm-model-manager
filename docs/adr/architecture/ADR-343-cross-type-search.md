# ADR-343：跨类型搜索收口（Type 派生 + 分析器分流 + SearchFilters）

- **状态**：🔄 部分采纳（刀 1 全量扫描 Type 派生 + 刀 2 分流与无条件排除修正已落地 2026-10-14，性能门禁与蒸发修复数据在案；刀 3–4 未动工——实施进度见知识卡 `search.md`）
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
- **排除面比「数值条件」更宽（2026-10-14 实证补充）**：首行排除与「是否设数值条件」无关——**纯关键词搜索（6 范围全 0）同样静默排除**无几何管线条目。4 条目实证库（真实样本）：不带任何过滤的 `search` 仅回 2 条（TLM 女仆 zip + 1 个 .ysm），资源包 zip 与音效包 zip 双双蒸发，唯一线索是 stderr 的 `[ysm-wasi] 解码失败`；
- `SearchResult.Type` 带 `omitempty` 从不填充（`go/types/types.go`）——跨类型语义未接上（死字段制度化，见知识卡 `search.md`「查证根因」段）；
- 签名 8 个位置参数（ADR-183 决策：标记技术债、暂缓封装——`types.SearchFilters` 尚未立起，第 4 刀收编）。

2026-10-14 锐评 P1：用户视角「筛选后我的模型全没了」。已落地的**过渡态（A 案，本 ADR 的前置工程）**：`resource_types.json` 新增 `geometrySearchable` 声明（ysm / maid-model），前端 adv-filter 数值区按该声明做**展示端门控**（无管线类型禁用 6 数值输入 + 提示 + 提交归 null）——杀掉静默蒸发，但不提供 MMD 等类型的数值搜索能力，也不修 Type 死字段。

## 2. 决策（Decision）

跨类型搜索收口，四刀（顺序即依赖序）：

1. **全量 `ScanModelEntries` 派生 `Type`**（回归红线域：判定归 Go + registry 单一事实源）：
   - 裸扩展名：`registry.ExtBelongsTo`（单声明者直判，多声明者歧义）；
   - 容器扩展名（.zip/.7z）：`containerCache` 指纹（`packs.DetectResourceType`）——`ScanModelEntriesFiltered` 已有该口径，提到全量路径复用；
   - 歧义/未命中 → `Type = "other"`（诚实占位，不猜，同 `ClassifyResource` 的 `ClassOther` 口径）；
   - 成本面：全量扫描多一次「扩展名查表 + 容器指纹（带缓存）」，容器指纹未命中才开归档（已有 30s 失效 + 指纹复用，边际成本受控）。**基线数据（2026-10-14，4 条目混合类型实证库：TLM 女仆 zip 13.5MB + 真实 .ysm 123KB + 资源包/音效包 2 zip；`scan-bench` / `benchmark --iterations 3`）**：B1 扫描中位 ~13ms；B2 全量搜索冷 ~580–620ms / 热 ~170ms（WASM 首解 + TLM 归档解析占大头，热态印证 geoCache/containerCache 生效 ~3.5x）；B3 关键词搜索 ~155ms。刀 1 的回归门槛于本 ADR 拍板时设定（建议 B1 ≤20ms、B2 冷 ≤800ms 即冷启不劣化 25%），B1/B2 对照作硬门禁（`scan-bench` / `single-bench` 复跑）。
2. **`SearchModels` 按 `Type` 分流分析器**：Bedrock 系（ysm / maid-model）走 `AnalyzeBedrockModel`（现状）；MMD 系数值语义按 `model-stats`（Web Worker 统计层，骨骼数有口径）接入，或先**只开放关键词 + 标签路**（数值区对 MMD 维持 A 案门控，直至 MMD 数值管线立项）；蓝图/资源包/光影包 = 关键词 + 标签（无数值语义）。**语义修正（§1 实证数据驱动）**：几何排除只在「数值条件已设置」时作用于无解析能力的条目——纯关键词/标签搜索不得让无几何类型条目消失（现状 `modelMatchesFilters` 首行无条件的 `BoneCount==0` 排除是病灶本体，本刀顺带修正，否则关键词搜索永远少半仓结果）。
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

**已知遗留**：
- `geometrySearchable` 的 maid-model 声明已由真实数据实证（2026-10-14）：`upstream` 区 TLM 女仆包（13.5MB zip）→ `ParseFromZip` L0 清单 143 条出几何，CLI 全链路 `search --min-bones 1` 实测 **12903 骨骼 / 13710 立方体**；永久守卫 `go/geometry/archive_maid_fixture_test.go`（fixture 在 gitignored 的 upstream 样本区，缺失即 skip，本地有样本时钉死「真实包出非空几何 + SubModels 派生」）。实证数据块见知识卡 `go-geometry-maid-l0`。
- MMD（.pmx/.pmd/.vrm/.fbx）数值管线无任何解析链路（`AnalyzeBedrockModel` 无对应分支），刀 2 对 MMD 维持「只开放关键词 + 标签路」（数值语义单独立项）；本地样本区无 MMD 包，负对照以资源包/音效包 zip 代替（实证库同批）。

## 4. 数据溯源

- 2026-10-14 锐评（本轮会话）：P1 数值筛选 Bedrock-only 静默排除 + 死字段制度化（`modelMatchesFilters` 首行 / `SearchResult.Type` omitempty 实证）
- A 案落地（过渡态）：`resource_types.json` `geometrySearchable`（ysm / maid-model）+ 前端 adv-filter 门控（`GEOMETRY_SEARCHABLE_TYPES` 派生集 + 展示端禁用/归零）
- ADR-183：8 参数封装暂缓决策（本 ADR 第 4 刀取代其「下轮路径」）
- 知识卡 `search.md`「查证根因」段：Type 死字段是架构路径决定的，须先做全量 Type 派生——本 ADR 第 1 刀即该前置
- 性能基线（刀 1 成本门禁）：2026-10-14 混合类型实证库（`upstream` 真实样本构造）`scan-bench` + `benchmark --iterations 3` 实测：扫描中位 13ms / 全量搜索冷 580–620ms 热 ~170ms / 关键词搜索 ~155ms（复现：取 1 个 TLM 女仆 zip + 1 个真实 .ysm + 2 个无几何 zip 作 files-root）
- 刀 2 实测（2026-10-14 同批，CLI 端到端 + 基准对照）：无过滤搜索 2/4 → **4/4 条**（蒸发修复）；数值搜索维持 2/4 且命中真实几何（maid 12903 骨骼）；基准位移 B2 冷 ~580ms → ~18ms（32x，分析成本归位显式路径）、B3 ~155ms → ~17ms。测试 `internal/app/app_scan_search_dispatch_test.go`（未知 zip 不蒸发 / container 占位数值排除 / maid 端到端命中）钉死语义

<!-- 文件名: cross-type-search.md → 实际文件 architecture/ADR-343-cross-type-search.md（ADR-320 architecture 全量模板） -->
