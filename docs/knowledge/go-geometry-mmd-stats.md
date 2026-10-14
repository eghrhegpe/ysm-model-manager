---
kind: go-geometry-mmd-stats
name: MMD 几何统计解析
tier: leaf
category: go
status: active
source_files:
  - go/geometry/mmd/mmd_stats.go
auto_fields:
  symbols_with_lines:
    - CanParse
    - MmdStats
    - ParsePmdStats
    - ParsePmxStats
    - ParseStats
use_when:
  - MMD 数值搜索（骨骼/纹理）
  - PMX/PMD 解析性能问题
  - SearchModels 分流机制
  - 统计级 vs 全几何解析
  - 纹理尺寸探测口径
pitfalls:
  - 骨计数只认 PMX model 头区声明的 bone_count（PMX 1.1 规范单源）；节区回退已撤销——嵌套骨结构取首个 bone 收尾标签必失真，缺头声明 = 0 不猜
  - 字符串值收束符是下一标签的 '<' 而非 '>'（误用 '>' 会把 "128,256</texsiz" 当值，Atoi 必败）
  - 多 texture 迭代的绝对位换算曾 off-by-one（相对偏移 + 基准错位），修法是 nxt 相对 data[tex+texEnd:] 起算后整体加回
  - 仓库条目 Type 派生锚在**存储布局**（mmd/PMX → EntityPlayer），实例目录（3d-skin/EntityPlayer）不是 location 消歧锚——测试 fixture 放错目录会静默拿到空 Type
  - PMD 只出骨骼数（布局跳节至 bone_count 定长字段），纹理尺寸诚实零值（PMT 尾块探测 = 扩展项）
quick_groups:
  - 模型扫描与仓库管理
quick_intents:
  - MMD 模型搜索数值条件
  - PMX 统计解析
  - 骨骼数怎么来的
quick_risk_lines:
  - cube 条件对 MMD 条目恒筛除（CubeCount 诚实 0），属设计语义非 bug
  - 16MB 读上限：超限 PMX 报「非统计目标」错误，数值搜索中该条零值被排除
  - .vrm/.zip 在 MMD 族下无统计链路（CanParse 只认 .pmx/.pmd）
perf: io-bound
---

# MMD 几何统计解析

## 概览

ADR-346 刀 1 交付的 Go 侧 MMD 统计级解析包（`go/geometry/mmd`）：从 PMX（XML）/PMD（二进制）提取**统计级**数据——骨骼数 + 纹理尺寸——供 `SearchModels` 数值条件路径消费。统计级 ≠ 3D 全解析：MMD 无 cube 语义（`BedrockModel.CubeCount` 恒 0 诚实值），不解码贴图、不建几何体。

## 核心职责

- **PMX**：纯字符串扫描（非 XML 解析器）——`<model>` 头区 `bone_count` 属性单源读骨计数；texture 节区 `<texsize>` 直读（全组最大 = 过滤口径同 Bedrock 管线）；texsize 全缺省按 `<tex>` 相对引用探同目录 PNG IHDR 头（24 字节，缺失 = 诚实零值）。16MB 读上限。
- **PMD**：按 v1.0/v2.0 双魔数（1284595134/1284595136）公开布局跳变长节区（name/comment 字符串、顶点块、面块）至 `bone_count` 定长字段；含越界守卫 + 骨计数 100000 上界（布局漂移拒信不猜）。纹理尺寸不探测（诚实零值）。
- **能力自报**：`CanParse(ext)` = {.pmx, .pmd}；`ParseStats(path, ext)` 按扩展名分派。

## 对外 API / 入口

| 符号 | 用途 |
|---|---|
| `ParsePmxStats(path) (MmdStats, error)` | PMX 统计解析（16MB 上限；无 `<model>` 头报错） |
| `ParsePmdStats(path) (MmdStats, error)` | PMD 统计解析（双魔数 + 布局越界守卫） |
| `CanParse(ext) bool` | 扩展名能力判定（分流层不硬编码扩展名表） |
| `ParseStats(path, ext)` | 分派入口 |
| `MmdStats{BoneCount, TexWidth, TexHeight}` | 结果形状（无 CubeCount 字段——分流层按类型置 0） |

消费方：`internal/app/app_model.go|analyzeEntryForSearch`（registry `StatsParserFor(entry.Type)=="mmd"` + `CanParse(entry.Ext)` 双条件）→ `AnalyzeMmdStats`（geoCache 与 Bedrock 管线同键复用）→ `SearchModels` 数值路径。

## 与其他子系统关系

- **registry 单点出口** `registry.StatsParserFor(id)`（`resource_lookup.go`）：`statsParser` 声明的 Go 侧读口（`resource_types.json` 的 EntityPlayer/SceneModel = "mmd"；"" = 默认 Bedrock 管线）
- **geoCache**（`internal/app/app_geo_cache.go`）：MMD 统计结果与 Bedrock 结果共享 path→BedrockModel 缓存，互不污染（键 = 剥禁用后缀路径 + 文件指纹）
- **性能门禁数据（2026-10-14）**：实现迭代三版实测——全量 `xml.Unmarshal` 2MB ~65ms、token 流式 ~110ms（bone 节区逐 token 成本）均超 50ms 门槛；**字符串扫描 2.1MB/15000 骨 = 1.6–2.3ms**（≈ I/O 时间，20x 余量）。教训：统计级解析别上 XML 解析器，定位扫描即可

## 不变量

- 骨计数缺失头声明 = 0，不猜（节区回退已撤销——嵌套 `<bone><bone .../></bone>` 结构下「首个 `</bone>`」是子元素闭合，计数必失真）
- 字符串值收束 = 下一标签的 `<`（`</texsize>` 的 `>` 是终止符自身，误用 `IndexByte '>'` 会把闭合标签前缀连进值导致 Atoi 必败——2026-10-14 迭代实测踩坑）
- PMX 节区名定位口径：`<texture>`/`</texture>` 成对切节区（节区名无嵌套同名冲突，PMX 规范保证）；多 texture 迭代用相对偏移整体加回（`data[tex+texEnd:]` 起算）
- 纹理尺寸取**全组最大**（数值过滤语义 = 模型最大纹理，同 Bedrock 管线口径）

## 相关

- [ADR-346 MMD 几何统计管线](../adr/architecture/ADR-346-mmd-geometry-stats-pipeline.md)（立项决策 + 选案 A flag 复用 + 桌面/web 范围裁剪）
- [search](./search.md)（数值条件分流语义：MMD cube 零值天然被 cube 条件筛除）
- [go-types](./go-types.md)（`statsParser` 跨界字段范式）
- [go-geometry-maid-l0](./go-geometry-maid-l0.md)（同类：归档清单统计级解析先例）
