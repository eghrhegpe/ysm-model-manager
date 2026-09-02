---
kind: go-geometry
name: Geometry 存档 go/geometry
tier: architecture
adr:
  - ADR-068
category: go
source_files:
  - go/geometry/parse.go
  - go/geometry/archive.go
  - go/geometry/ysm_parser.go
auto_fields:
  symbols_with_lines:
    - ExtractFirstPNGFrom7z:153
    - ExtractFirstPNGFromZip:143
    - IsArmModelName:59
    - IsMainModelName:1475
    - ParseBedrockGeometry:240
    - ParseComponentsFrom7z:1693
    - ParseComponentsFromZip:1482
    - ParseFrom7z:1391
    - ParseFrom7zEntry:1409
    - ParseFromZip:1385
    - ParseFromZipEntry:1404
  quick_groups:
    - 模型扫描与仓库管理
  quick_intents:
    - Geometry 存档、基岩版 bedrock
    - 模型解析、zip / 7z / 纹理 / 动画
    - parse.go / archive.go
  quick_risk_lines:
    - Geometry 存档解析必须走 go/geometry 的 parse/archive 封装，禁止在业务代码里直接 unzip
  pitfalls:
    - 直接 unzip → 7z 未支持、纹理提取缺路径安全；必须经 go/geometry
    - 未走 ysm_parser.go → .ysm 解析不一致；必须经 go/ysm 兜底
  use_when:
    - geometry
    - 基岩版
    - bedrock
    - 模型解析
    - zip
    - 7z
    - 纹理
    - 动画
  perf:
    - io-bound
    - memory-heavy
  invariant_anchors:
    - go/geometry/archive.go|fsutil.ReadLimitedEntry
    - go/geometry/ysm_parser.go|json.Decoder
quick_groups:
  - 模型扫描与仓库管理
quick_intents:
  - Geometry 存档、基岩版 bedrock
  - 模型解析、zip / 7z / 纹理 / 动画
  - parse.go / archive.go
quick_risk_lines:
  - Geometry 存档解析必须走 go/geometry 的 parse/archive 封装，禁止在业务代码里直接 unzip
pitfalls:
  - 直接 unzip → 7z 未支持、纹理提取缺路径安全；必须经 go/geometry
  - 未走 ysm_parser.go → .ysm 解析不一致；必须经 go/ysm 兜底

use_when:
  - geometry
  - 基岩版
  - bedrock
  - 模型解析
  - zip
  - 7z
  - 纹理
  - 动画
perf:
  - io-bound
  - memory-heavy
invariant_anchors:
  - go/geometry/archive.go|fsutil.ReadLimitedEntry
  - go/geometry/ysm_parser.go|json.Decoder
status: active
---

# Geometry 存档 go/geometry

## 概览

`go/geometry/` 包解析 Bedrock（基岩版）`minecraft:geometry` 模型：既支持单个 geometry JSON，也支持从 ZIP/7z 存档中按 `ysm.json` 清单合并多个模型文件、提取纹理与动画，产出 `types.BedrockModel` 供 2D 线条图与 3D 预览流水线使用。

## 核心职责

- `parse.go` — 标准 geometry JSON 解析（骨骼/立方体/UV/旋转/纹理槽）
- `ysm_parser.go` — ysm.json 清单解析共享函数（`parseYsmArchive`）：结构解码返回原文，口径后处理留调用点（见不变量）
- `archive.go` — ZIP/7z 存档解包：ysm.json 清单（model/texture 顺序）、多 geometry 文件合并、cube→texSlot 绑定、PNG 纹理与动画 JSON 收集、预览 PNG 提取（封面候选优先）；**容器打开统一走 `go/container`（ADR-068）**——`ExtractFirstPNGFromZip/7z` 入口经 `OpenZipBytes/Open7zBytes` + 格式无关 `extractFirstPNG`，`collectArchiveFiles` 消费 `container.Entry`，删除原 ParseFrom7z/ParseFromZip 对称外壳 ~294 行（公开签名不变）；**zip/7z 六入口（ParseFrom*/ParseFrom*Entry/ParseComponentsFrom*）已收敛**为 `openArchiveBytes` 单一打开点 + 共享实现（`parseModelFromArchive` / `parseFromArchiveEntry` / `parseComponentsFromArchive`），六导出函数变薄包装，改解析逻辑只改共享实现

## 对外 API / 入口

- `ParseBedrockGeometry(data []byte) *types.BedrockModel` — 解析单个 geometry JSON；输入上限 100MB；UV 兼容数组与 per-face 对象两种形态；失败返回 nil
- `ParseFromZip(data []byte, size int64) (*types.BedrockModel, [][]byte, []string)` — 从 ZIP 解析，返回（合并模型、纹理 PNG 列表、动画 JSON 字符串列表）；模型文件与纹理均按 ysm.json 声明顺序稳定排序
- `ParseFrom7z(data []byte, size int64) (*types.BedrockModel, [][]byte)` — 7z 版（`github.com/bodgit/sevenzip`），返回模型与纹理；不单独分流动画 JSON（动画文件当 geometry 解析失败后自然跳过）
- `ParseFromZipEntry(data []byte, size int64, subPath string)` / `ParseFrom7zEntry(...)` — 按 subPath（L0 SubModel.SourcePath 口径）解析单个 geometry 文件；三层降级命中（精确→命名空间相对→basename 模糊），命中失败返回 nil
- `ParseComponentsFromZip(data []byte, size int64)` / `ParseComponentsFrom7z(...)` — 多组件解析（YSMViewer 式）：每个模型文件独立组件（含 arm/载具，不合并不排除），main 优先排序 + perComponent 独立纹理；返回（组件数组、纹理名数组、error）
- `ExtractFirstPNGFromZip(data []byte, size int64) []byte` / `ExtractFirstPNGFrom7z(data []byte, size int64) []byte` — 提取预览 PNG 做快速缩略：**先精确匹配根目录封面候选（`pack.png`/`cover.png`/`preview.png`/`thumbnail.png`，顶层条目），无封面候选时回退枚举序第一张 PNG**。封面候选与位置无关（pack.png 排在 assets/ 纹理后也能优先命中），与 `fileops.FindPreviewImage` 的散图候选（preview.png/cover.png/thumbnail.png）同一命名约定贯通 zip 内外——资源包/女仆包/整合包统一受益

## 与其他子系统关系

- 被 `internal/app/app_model.go` 调用（3D 预览前置解析）、`internal/app/app_files.go`（缩略图）、`internal/app/wasm_decoder.go`（解码后解析）
- 被 [go_ysm_parser](./go-ysm-parser.md) 的 `extracted.go` 调用（解压产物解析）
- 下游产物交给 [go_threejs](./go-threejs.md) 生成渲染 spec；依赖 `go/types`（BedrockModel/Bone2D/Cube2D）

## 不变量

- 存档内单文件读取上限走 `types.MaxReadLimit`（50MB，全仓单点常量）：`geometry/archive.go` 各读取点**直接调 `fsutil.ReadLimitedEntry(rc, int64(maxExtractSize))`**（原包内转发 `readLimitedEntry` 已删除，收敛为直调），`ysm/*` 解析入口同值；`LimitReader(limit+1)` 探测截断，超限/读错拒绝并跳过，ADR-033 修复——不再静默截断装盘
- `ParseBedrockGeometry` 输入上限 100MB（`maxParseSize`），超限拒绝并记日志
- **cube 字段覆盖**：解析 origin/size/pivot/uv（数组或 per-face 对象）/rotation/texture/inflate/mirror。`inflate`（Blockbench 膨胀）与 `mirror`（镜像）2026-08-09 补齐（P2）——此前 .ysm 走 wasm 解码时 YSMParser 已把 inflate 烘焙进几何尺寸，Go 原生解析 zip/7z/json 却丢弃字段导致老模型（1.10+ 导出）尺寸偏小/纹理方向错；现在两条路径口径一致
- `ysm.json` 是清单不是模型文件，不参与 geometry 解析；文件名含 animation/controller 的 JSON 归入动画而非模型（仅 ZIP 路径分流）
- `ysm.json` 的 `files.player.model` 支持 4 种形态：字符串 / 字符串数组 / `{path|name}` 对象数组 / `map[string]string` 对象。**对象形态按声明顺序展开**（`json.Decoder` Token 流式保写入序——Go map 遍历随机，若按 key 排序会把 main 排到 arm 后导致 texSlot 绑定错位）
- **zip 路径排除第一人称手臂 arm.json**（`archive.go` `IsArmModelName`——2026-08-26 导出并跨包收敛，ysm/extracted.go 本地副本已删改引本实现；原小写 isArmModelName：arm.json / arm.geo.json，2026-08 提交 63644b40）：arm 是第一人称手持视角的独立手臂几何，pivot 与 main 的手臂不同，合并版（ParseFromZip）在全身第三人称预览中不需要此几何，剔除避免错位（解压目录路径同款在 [go_ysm_parser](./go-ysm-parser.md) 的 `extracted.go`）。**组件化路径（buildComponents / ParseComponentsFromZip/7z）保留 arm 作独立组件**——与 main 共用同一套 player.texture 皮肤（ModernYSM `MainModelData` 权威：main 和 arm 是 models 列表里的两个独立 GeoModel，共用 textureMap，通过 textureIndex 选皮肤）。arm 不填 ComponentTextures、texNames 置空、TexSlot=0（贴 texArr[0] 默认皮肤，与 main 一起切皮肤）——2026-08-25 提交 c76e084e 修复（原逻辑把 model map 声明序位置当 texSlot，main=0 贴 skin、arm=1 贴 skin_white，导致 main 和 arm 走不同皮肤）
- 模型文件与纹理排序一律用 `sort.SliceStable`：清单声明过的条目按声明顺序在前，未声明的保持存档内原始顺序排在其后；纹理排序的 orderMap key 与查询 key 同口径（小写 basename 去扩展名，P2 修复——原 key 带扩展名永不命中，排序形同死代码）
- texSlot 映射为「第 i 个模型 → 第 i 个纹理」，索引超出纹理数量时钳到最后一张（`ti >= texCount` → `texCount-1`）；`texOrder` 为空时退化为按模型数量取索引
- **组件化路径（buildComponents）texNames 不再依赖 modelOrder 索引对齐**：`collectArchiveFiles` 新增 `modelTexName` 返回值（模型路径→声明纹理名），`buildComponents` 按 `compName` 直接查表，不再走 `orderMap[全路径] → texOrder[j]` 索引链。vehicles/projectiles 段显式声明的纹理绑定优先级高于 player.model 索引——player.model 索引对齐仅在 key 未命中时补充，避免 wine_fox 口径的 texOrder 去重后索引漂移
- 纹理只收 `.png`/`.jpg`；不按尺寸过滤小纹理（64×64 合法贴图可 <4KB，与 .ysm 解压路径口径一致）；头像/预览图仅由 `avatar/` 路径与基名前缀排除
- 解析失败统一返回 nil/空，由调用方决定降级路径，不 panic
- **合并路径 vs 组件化路径是本质差异，禁止用 `excludeArm bool` 之类参数强统一**：`parseModelFromEntries`（ParseFromZip/ParseFromZipEntry 单模型合并）排除 arm 占位（避免两对手臂 + texIdx 错位）；`buildComponents`（ParseComponentsFromZip/7z 组件化）保留 arm 作独立组件（YSMViewer 口径）。两者输出结构不同（单个 `BedrockModel` vs 组件数组），函数签名也随之不同，强行合并只会引入分支复杂度
- **zip/7z 六入口已收敛，禁止退回双份路径**：新增功能/修 bug 只改共享实现（`parseModelFromArchive` / `parseFromArchiveEntry` / `parseComponentsFromArchive`）+ `openArchiveBytes`。若需新增 zip/7z 进入点，加薄包装调共享实现，勿复制 open + 解析循环
- **ysm.json 解析已收敛为 `ysm_parser.go` 的 `parseYsmArchive`（路线 B：纯提取、行为不变）**：共享层只做 JSON 结构解码（list/dict/single、数组/对象/字符串多形态）并返回**原文**（`ysmArchiveData`：ModelOrder / PlayerTexs{path,isUV} / ProjModels / ModelTexName map / Metadata RawMessage），lower/去扩展名/去目录等口径后处理留回 `collectArchiveFiles`（清单版，player.texture 去扩展名）与 `parseModelFromEntries`（模型版，player.texture 保留扩展名）。两调用点 player.texture 口径本就不同，且有历史不对称（`{uv}` 对象分支剥反斜杠、裸字符串分支不剥，由 `playerTex.isUV` 标记原样复刻）——禁止用参数强统一口径；仅 projectiles/vehicles/arrow 纹理口径两路径完全相同才收敛进 `texBasenameNoExt`（去目录+小写+去扩展名）。**ModelTexName**：vehicles/projectiles/arrow 段显式声明的 model→texName 映射优先写入 map；player.model 索引对齐循环仅在 key 未命中时补充（守卫 `if _, has := result.ModelTexName[key]; !has`），避免 player.model 按序索引覆盖 vehicles 权威声明——wine_fox 根因修复（原逻辑 player.model 按序索引会覆盖 vehicles 的显式纹理绑定）
- **TextureCategories 与 TextureNames 同序同长度契约**（2026-08-23 code review 收口）：重排比较必须**大小写不敏感**——texOrder 已小写、pngNames 保留 zip 原始大小写（`textures/Skin.png` → `"Skin"`），`bn == pn` 直比较会让大写纹理名匹配失败 → 分类静默丢失（同函数排序比较器均已 ToLower，口径一致）；**L0（maid_model.json）覆盖 texOrder 时必须同步重建 texCategories**（L0 清单纹理全为主模型皮肤，统一归 `"player"`）——不重建则仍对应 ysm 派生旧 texOrder，重排 `texCategories[j]` 按新 texOrder 位置 j 索引会错位/丢分类（前端 skeleton-fill-panel 按此区分可切换皮肤与组件专属纹理）
- **L0 路径大小写口径统一**（2026-08-24 code review 收口）：`entryByPath` 的 key 全小写（`strings.ToLower(e.Name())`），故 `resolveL0Model`/`resolveL0Texture` 返回的路径必须是小写 abs（`tryCandidates` 返回的 `abs`，**不得返回 `e.Name()` 原始大小写**——主循环 `entryByPath[texAbs]` 重查会 miss → 大写条目纹理静默丢弃）；`l0ModelOrder` 是 `modelAbs[len(maidNs):]`（小写），消费端 orderMap/texIdxMap 的构建键与查询键必须**统一 ToLower**（`geoFiles[i].name`/`gf.name` 是 zip 条目原始大小写，大小写敏感会 miss → 声明序排序失效 + cube TexSlot 不绑定全 0）。口诀：zip 条目名一律当混合大小写处理，查表键先 `ToLower(filepath.ToSlash(...))` 再比
- **`parseModelFromEntries` 已拆为声明序管道**（行为不变、逐段提交）：~407 行全仓最胖函数坍缩为装配器，依次调用 `collectMaidManifest`（L0 清单）→ `parseYsmArchive`（ysm.json）→ `deriveModelTexOrder`（model/tex 声明序派生）→ `resolveL0` → 命中走 `collectAnimEntriesOnly`（只收动画字符串）/ 未命中走 `collectMergedFiles`（合并版收集：排 arm）→ `filterArmModels` → `sortByModelOrder` → `mergeGeoFiles`（texIdxMap+bones 合并）→ `sortByTexOrder` → `buildSubModels`。各函数**纯搬移不改行为**；`collectArchiveFiles` 的 7 个位置返回值收敛为私有 `collectedArchive` 结构体。两条隐式时序约束：① `sortByTexOrder` 必须在 `buildSubModels` 之前；② `mergeGeoFiles`/`sortByModelOrder` 先于 `sortByTexOrder`。三条红线不得顺手统一：`buildSubModels` 的 L0 覆盖判定只看 `len(maidManifest)>0`、不看 `l0.hit`；`collectMergedFiles`（模型版，保留扩展名）与 `collectArchiveFiles`（清单版，去扩展名）口径分叉不可合并；`collectMergedFiles` 里 `IsArmModelName` 检查在 Open+Read 之后。行为锁靠 `archive_parse_behavior_lock_test.go` + `archive_merge_behavior_lock_test.go` 守住
- **测试文件名 GOARCH 后缀陷阱**：`archive_arm_test.go` 曾被 Go 工具链**静默排除**（`.IgnoredTestGoFiles`）——文件名 `_arm` 段是合法 GOARCH 平台后缀，amd64 上该文件从不参与编译。已改名 `archive_arm_models_test.go` 复活。**铁律：Go 文件名 `_test.go` 前的末段不得撞 GOOS/GOARCH 保留字（linux/windows/darwin/arm/amd64/386/arm64/wasm…）**；语义性后缀拼长（如 arm→arm_models）规避
- **确定性/口径统一修复**：① `resolveComponentTexName` 前缀兜底多命中改候选收集后 `sort.Strings` 取字典序最小——map 迭代随机曾致同输入不同运行绑不同纹理；② `detectMaidNs` 复用 `collectMaidManifest`（"最长清单即主包"）——多命名空间包组件视图与合并预览选 ns 不再分叉；③ 组件路径排序键归一化：`buildOrderAndPngIndex`/`sortGeoFilesMainFirst` 双侧加 ToLower
- **R29 安全修复**：① `classifyFileInventory` OOM 封顶：加 `maxClassifyEntries=10000` matched 条目数封顶，超限 `inv.Truncated=true` + log 标记 + break；② `selectBestMaidCandidate` 空切片 panic 修复：函数开头加 `if len(candidates) == 0 { return maidNsCandidate{} }`；③ 仅计 `appended`（matched）条目，dir 在计数前 `continue` 跳过

## 相关

- [go_threejs](./go-threejs.md) — BedrockModel → Three.js spec
- [go_ysm_parser](./go-ysm-parser.md) — YSM 格式与解压流程
- [go_types](./go-types.md) — BedrockModel 结构
