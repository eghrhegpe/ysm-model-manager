---
kind: go-litematic
name: Litematic 解析 go/litematic
tier: architecture
category: go
source_files:
  - go/litematic/parser.go
  - go/litematic/nbt.go
  - go/litematic/voxel.go
  - go/litematic/
use_when:
  - 投影
  - litematic
  - schematic
  - nbt
  - 蓝图
  - 体素
  - 方块
invariant_anchors:
  - go/litematic/nbt.go|extractBits
  - go/litematic/voxel.go|maxRegionAxis
---

# Litematic 解析 go/litematic

## 概览

`go/litematic/` 包解析 Minecraft 建筑蓝图文件：Litematica 投影（`.litematic`，NBT gzip）、MCEdit 旧版 `.schematic`、原版结构 `.nbt`，产出元数据、方块统计（中文名）与按颜色分组的体素渲染数据，供前端 3D 预览。

## 核心职责

- `parser.go` — 元数据解析（名称/作者/尺寸/预览图 ARGB→PNG base64）、按 palette+BlockStates 聚合方块统计（数量降序）、`.schematic` / `.nbt` 摘要
- `nbt.go` — go-mc/nbt 解码封装、类型安全取值助手、Litematica 小端 packed LongArray 位提取（含越界防护）
- `voxel.go` — 三格式共用体素管线：`openGzRoot`（打开+gzip+NBT 解码）→ 各格式的方块生成器闭包 → `groupVoxelStream`（按颜色分组+超限截断）→ `finalizeVoxelData`（表面过滤+组装）；`buildRegionInfo` 负责 region 标准化（负 size 翻正、palette→颜色、bpe 计算）
- 数据文件：`block_ids.go`/`block_ids_data.go`（1.12 数字 ID→注册名，`blocks_1_12.json` 经 `go generate` 生成）、`block_colors.go`（方块→颜色）、`zh_cn.json`（方块中文名）

## 对外 API / 入口

- `ParseMeta(path string) (*types.LitematicMeta, error)` — `.litematic` 元数据（含 region 数、方块统计、预览图）
- `ParseSchematic(path string) map[string]interface{}` — `.schematic` 摘要（尺寸/作者/方块统计，v1 数字 ID 经 `ResolveBlockName` 转注册名）
- `ParseNbtStructure(path string) map[string]interface{}` — 原版结构 `.nbt` 摘要
- `BuildVoxelData(path string, maxBlocks int) (*types.LitematicVoxelData, error)` — `.litematic` 体素数据（按颜色分组，只保留表面方块）；无 `Regions` 时返回只含 `Size` 的空结果而非报错
- `BuildNbtVoxelData(path string, maxBlocks int) (*types.LitematicVoxelData, error)` / `BuildSchematicVoxelData(path string, maxBlocks int) (*types.LitematicVoxelData, error)` — `.nbt` / `.schematic` 的体素数据，与上者共用同一条管线
- `ResolveBlockName(id int, data byte) string` — 旧版数字 ID→注册名
- `ResolveBlockZH(name string) string` — 注册名→中文名（自动去 `minecraft:` 前缀）
- `MapColor(blockName string) string`（block_colors.go）— 方块名→十六进制渲染色

## 与其他子系统关系

- 被 `internal/app/resource_bindings.go` 调用（GetLitematicMeta / 三种体素构建 / schematic 与 nbt 摘要等 binding）
- 依赖 `github.com/Tnze/go-mc/nbt`（NBT 解码）、`go/types`（LitematicMeta/LitematicVoxelData/VoxelGroup）
- 资源类型归属由 [resource_registry](./resource-registry.md) 的 `litematic` / `create-blueprint` 条目定义

## 不变量

- Litematica packed LongArray 是**小端位序**（`extractBits` 从每个 long 的 LSB 连续排列、可跨 64 位边界），与原版 1.16+ 大端 packed array 相反——搞反会导致 3D 预览全乱
- `extractBits` 必须做越界防护：`longIdx >= len(longs)` 直接返回 0，跨 64 位边界时若无后继 long 只取低位（high 位留零）（`nbt.go:109` / `nbt.go:121`）。声明的 `Size` 与实际 `BlockStates` 长度不匹配的损坏/截断文件会让索引跑出数组，缺这两道判断就是解析 panic；另有 `bitCount == 0` 早返回 0（`nbt.go:101`），对应 `bitsPerEntry` 在 palette ≤1 时返回 0 的单方块情形
- 越界防护是**两层**的：`extractBits` 保证不越 `longs` 数组，取出的 palette 索引还要再过 `paletteIdx < 0 || paletteIdx >= len(info.palette)` 的范围判断才用于取色（`voxel.go:139`，structure NBT 同理见 `voxel.go:308`）——损坏文件可能解出合法位宽但超出 palette 范围的索引；`buildRegionInfo` 另做 Size 与 BlockStates 容量交叉校验（总方块数 ≤ longs 可承载位数 `len*64/bpe`，超限丢弃该 region，防损坏文件超大 Size DoS，P3 修复）
- **origin+size 超 int16 范围的 region 丢弃**（P3 修复：坐标源是 int32、体素输出 `[3]int16` 会静默回绕 → 3D 渲染位置错乱；现与 `maxRegionAxis` 口径一致，超限丢弃并记录，`maxCoord = 32767`）
- 方块线性索引存储顺序为 X→Z→Y：`i = x + z*sizeX + y*sizeX*sizeZ`
- palette 索引 0 视为空气跳过（三格式一致：litematic 的 `paletteIdx==0`、structure NBT 的 `state==0`、schematic 的 `blockID==0`）
- **先截断后过滤**：`groupVoxelStream` 按 `maxBlocks` 截断并置 `Truncated=true`（`voxel.go:58`），`finalizeVoxelData` 才做 `filterSurfaceOnly` 表面过滤（`voxel.go:74`），因此返回的体素数通常远小于 `maxBlocks`（上限由 AppConfig.VoxelMaxBlocks 控制，默认 200000）。截断判定在取下一块之前，故方块数恰好等于 `maxBlocks` 时也会置 `Truncated=true`
- 截断 / 分组 / 表面过滤只在公共段实现一次，三个 Build* 入口不得各自手写，否则行为漂移
- `.litematic` / `.schematic` / `.nbt` 一律经 `openGzRoot` 走 gzip 解压，非 gzip 文件直接报错
- `.schematic` 双路径：有 `Palette` + `BlockData`（varint）走 v2，否则读 `Blocks` 字节数组走 v1——v1 有 Palette 时优先用 paletteMap 取色，无 Palette 才用 `ResolveBlockName(id, data)` 兜底，未知方块回退 `#7F7F7F`

## 相关

- [go_types](./go-types.md) — LitematicMeta / LitematicVoxelData 结构
- [resource_registry](./resource-registry.md) — litematic/create-blueprint 类型定义
- [wails_bridge](./wails-bridge.md) — 投影解析 binding
