---
kind: go-geometry-archive-pipeline
name: Geometry 存档解析流水线（archive 分片）
tier: leaf
category: go
status: active
source_files:
  - go/geometry/archive_parse.go
  - go/geometry/archive_collect.go
  - go/geometry/archive_merge.go
  - go/geometry/archive_components.go
auto_fields:
  symbols_with_lines:
    - IsMainModelName
    - ParseComponentsFrom7z
    - ParseComponentsFromZip
    - ParseFrom7z
    - ParseFrom7zEntry
    - ParseFromZip
    - ParseFromZipEntry
use_when:
  - 存档解析流水线
  - ParseFromZip / ParseFrom7z
  - ParseFromZipEntry / ParseFrom7zEntry
  - 多组件解析 buildComponents
  - 纹理槽位绑定 texIdxMap
  - SubModels 清单
quick_groups:
  - 模型扫描与仓库管理
quick_intents:
  - ParseFromZip / ParseFrom7z / ParseFrom*Entry 存档流水线
  - buildComponents 多组件 / perComponent 独立纹理
  - collectMergedFiles 合并收集 / 物化封顶
  - mergeGeoFiles 骨骼合并 / texIdxMap 槽位绑定
quick_risk_lines:
  - zip/7z 六入口必须走 openArchiveBytes + parseModelFromArchive / parseFromArchiveEntry / parseComponentsFromArchive 共享实现，勿退回双份路径
pitfalls:
  - sortByTexOrder 与 buildSubModels 有隐式时序（纹理排序在前，L0 TexSlot 按排序后槽位换算），调换顺序会静默改行为
  - buildSubModels 的 L0 覆盖判定不对称（只看清单非空、不看 resolveL0.hit）是现状红线，勿「顺手统一」
  - 合并路径 IsArmModelName 判定在 Open+Read 之后（保持原序），勿「顺手优化」成先判再读
last_verified: 2026-10-09
---

# Geometry 存档解析流水线（archive 分片）

## 概览

`go/geometry` 存档解析流水线的四个分片实现文件，系 2026-10 文件行数治理自 archive.go 拆出：`archive_parse.go` 主入口与 zip/7z 双份路径收敛，`archive_collect.go` 合并收集与声明序排序，`archive_merge.go` 骨骼合并与纹理槽位绑定，`archive_components.go` 多组件解析（YSMViewer 式）。流水线段序固定：L0 清单判定 → 收集 → 声明序排序 → 合并 → 纹理排序 → SubModels。包级总览与条目文档以 [go-geometry](./go-geometry.md) 为单一事实源。

## 核心职责

- `archive_parse.go` — 主入口与共享骨架：
  - `ParseFromZip` / `ParseFrom7z`（单模型合并）与 `ParseFromZipEntry` / `ParseFrom7zEntry`（按 subPath 解析单角色）全部是薄包装，统一经 `openArchiveBytes` 单一打开点 + `parseModelFromArchive` / `parseFromArchiveEntry` 共享实现（zip/7z 双份路径收敛，改 bug 只改一处）
  - `parseModelFromEntries` 是流水线装配器：`collectMaidManifest`（L0 清单）→ `parseYsmArchive`（ysm.json 统一解析，metadata 段单独容错）→ `deriveModelTexOrder`（model/tex 声明序派生）→ `resolveL0`（命中只补收动画字符串，未命中全量 `collectMergedFiles`）→ `filterArmModels` → `sortByModelOrder` → `mergeGeoFiles` → `sortByTexOrder` → `buildSubModels`
  - `matchGeoEntryBySubPath` 三层降级命中（精确 → 命名空间相对 → basename 模糊），`IsMainModelName` 是 main 组件判定单点（导出供 wasm 多组件路径统一口径）
- `archive_collect.go` — 合并收集与排序：`collectMergedFiles`（`mergedCollector` 游标：geometry/动画/纹理三通道物化 + `totalBytes`/`animBytes` 双累计计数，任一通道的物化封顶由 `stop` 游标带出整条循环——原 `break` 语义），`mergedJSONAccepted` / `mergedTextureRejected` 准入与排除（`ysm.json` 不参与合并、女仆三清单排除、`avatar/` 与 `gui/` 路径排除），`sortByModelOrder` / `sortByTexOrder` 声明序稳定排序，`geoOrderCompare` 收口排序比较闭包
- `archive_merge.go` — 合并与槽位绑定：`deriveModelTexOrder`（texOrder 先 player 后投射物/载具，modelOrder 与 texOrder 同序保证槽位不错位），`mergeGeoFiles` → `buildTexIdxMap`（模型 basename → 纹理槽位，声明纹理名命中优先、modelOrder 序号兜底钳制）→ `mergeParsedGeos`（骨骼合并 + 逐 cube TexSlot/CubeTexW/H），`buildSubModels`（L0 清单优先 → 兜底从 geoFiles 派生），`texIdxKey` 构建端/查询端同口径键
- `archive_components.go` — 多组件解析：`ParseComponentsFromZip` / `ParseComponentsFrom7z` → `parseComponentsFromArchive`（`collectArchiveFiles` → `buildComponents` → `classifyFileInventory` 收敛 zip/7z 分形双份），`buildComponents`（perComponent 独立纹理：cube.TexSlot=0，`ComponentTextures[compName]` 前端按组件名查），`resolveComponentTexName` 四级 fallback（完整路径精确声明 → basename 兜底 → 同名纹理 → 前缀匹配字典序最小），`encodeTextureBase64` + `sniffTexMime`（MIME 按魔数嗅探，jpg 不再错标 png）

## 对外 API / 入口

- 六个导出入口的语义文档以 [go-geometry](./go-geometry.md)「对外 API」节为准；本卡聚焦流水线内部契约：
- `parseModelFromEntries` 一趟返回 `(geo, pngs, animJSONs, 过滤后 geoFiles)`——第四位由 `ParseFromZipEntry` / `ParseFrom7zEntry` 复用做 subPath 匹配，避免二次全量遍历
- `ParseFrom*Entry` 命中失败 → `geo=nil`，调用方自行兜底回全量合并解析；纹理 `pngs` 仍全量返回（切换角色只是换骨骼，不换纹理集合）
- `buildComponents` 返回的 `texNames` 是前端 texArr 的**期望序**数组：索引是 texArr 连续索引（不因组件解析跳过而收缩），长度 = 成功组件数，前端契约比对 Math.min 截断
- `sortByTexOrder` 返回 orderMap（texOrder 去扩展名 → 声明下标），`buildSubModels` 须在纹理排序后拿到它换算 L0 排序后槽位

## 与其他子系统关系

- 上游：`go/container` 的 `Entry` 抽象（zip/7z 条目枚举唯一接口，[go-container](./go-container.md)）、`go/types/registry` 的 `IsYsmEntryJSON`
- 下游：`go/threejs` 的 BuildMulti（多组件 spec，[go-threejs](./go-threejs.md)）、`internal/app` 的 3D 预览前置解析
- 包内边界：`archive.go` 提供 `maxExtractSize` / `maxMaterializeEntries` / `maxMaterializeBytes` / `geoEntry` / `collectArchiveFiles` / `classifyFileInventory`（[go-geometry](./go-geometry.md) 认领）；L0 子域在 `maid_l0.go`（`collectAnimEntriesOnly`）+ 本目录另两张分片卡（[go-geometry-maid-l0](./go-geometry-maid-l0.md)）
- 包依赖方向固定 geometry ← ysm（[go-ysm-parser](./go-ysm-parser.md) 的分层约束）：geometry 侧不得 import ysm，跨包逻辑走包内镜像实现

## 不变量

- 流水线段序是隐式时序约束：`sortByTexOrder` 必须在 `buildSubModels` 之前（L0 TexSlot 用 texNameByItem → orderMap 换算「排序后」槽位）；`mergeGeoFiles` / `sortByModelOrder` 先于 `sortByTexOrder`。调换顺序会静默改行为，行为锁由 `archive_parse_behavior_lock_test.go` / `archive_merge_behavior_lock_test.go` / `archive_collect_lock_test.go` 钉住
- L0「覆盖判定不对称」红线：`buildSubModels` 的 SubModels 分支只看 `len(maidManifest)>0`（不看 `resolveL0.hit`），与 geoFiles 等看 `hit` 的覆盖判定不一致——现状事实，勿「顺手统一」
- 合并路径 `appendMergedGeoFile` 的 `IsArmModelName` 判定置于 Open+Read 之后（保持原序，勿优化成先判再读）；nil/空 buf 不占物化槽位
- `mergedCollector` 的 stop 语义由游标显式带出：三条通道任一封顶即整体停止（后续条目含纹理不再收）；`break` 写进 switch case 只跳 switch 不跳条目循环，是经典陷阱
- 键归一化口径：orderMap / texIdxMap / pngNameMap 的键统一 `ToLower(ToSlash(...))`——Windows 混合大小写条目名不归一化会让声明序排序静默失效退化为字典序、texSlot 绑定全 0
- `texIdxKey`（TrimSuffix 顺序 `.json` 先 `.geo.json` 后）与 `compBaseName`（`.geo.json` 先 `.json` 后）口径不同：各自构建端与查询端同口径即命中，勿「顺手复用合并」
- 合并路径排除 arm.json 占位（避免占 texIdx 槽位致 main 纹理错位）；组件化路径保留 arm 作独立组件（与 main 共用全局纹理，arm 不填 ComponentTextures、texNames 置空）——两条路径输出结构本质不同，禁止用 `excludeArm bool` 类参数强统一
- `sortByTexOrder` 的 pngs/pngNames 双切片同步重排，比较器每次实时 ToLower（预计算小写 key 会随元素位移失同步——正确优先于微优化）

## 相关

- [go-geometry](./go-geometry.md) — 包级总览、六入口与 archive.go 文档（单一事实源）
- [go-geometry-maid-l0](./go-geometry-maid-l0.md) — L0 清单收集与条目解析分片
- [go-ysm-parser](./go-ysm-parser.md) — 包分层方向与镜像实现约定
- [go-threejs](./go-threejs.md) — 多组件 BedrockModel → 渲染 spec
- [app-content-diagnostics](./app-content-diagnostics.md) — maid-model 的 CLI 分析链路登记（按类型提升须过几何验证）
