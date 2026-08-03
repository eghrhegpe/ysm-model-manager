---
kind: go_litematic
name: Litematic 解析 go/litematic
tier: architecture
category: go
source_files:
  - go/litematic/parser.go
  - go/litematic/nbt.go
  - go/litematic/voxel.go
use_when:
  - 投影
  - litematic
  - schematic
  - nbt
  - 蓝图
  - 体素
  - 方块
---

# Litematic 解析 go/litematic

## 概览

`go/litematic/` 包解析 Minecraft 建筑蓝图文件：Litematica 投影（`.litematic`，NBT gzip）、MCEdit 旧版 `.schematic`、原版结构 `.nbt`，产出元数据、方块统计（中文名）与按颜色分组的体素渲染数据，供前端 3D 预览。

## 核心职责

- `parser.go` — 元数据解析（名称/作者/尺寸/预览图 ARGB→PNG base64）、方块统计聚合、`.schematic` / `.nbt` 摘要
- `nbt.go` — go-mc/nbt 解码封装、类型安全取值助手、Litematica 小端 packed LongArray 位提取
- `voxel.go` — 体素数据构建：palette 解码、全局坐标还原、表面方块过滤、超限截断
- 数据文件：`block_ids.go`/`block_ids_data.go`（1.12 数字 ID→注册名，`blocks_1_12.json` 经 `go generate` 生成）、`block_colors.go`（方块→颜色）、`zh_cn.json`（方块中文名）

## 对外 API / 入口

- `ParseMeta(path string) (*types.LitematicMeta, error)` — `.litematic` 元数据（含 region 数、方块统计、预览图）
- `ParseSchematic(path string) map[string]interface{}` — `.schematic` 摘要（尺寸/作者/方块统计，v1 数字 ID 经 `ResolveBlockName` 转注册名）
- `ParseNbtStructure(path string) map[string]interface{}` — 原版结构 `.nbt` 摘要
- `BuildVoxelData(path string, maxBlocks int) (*types.LitematicVoxelData, error)` — `.litematic` 体素数据（按颜色分组，只保留表面方块）
- `BuildNbtVoxelData(path string, maxBlocks int)` / `BuildSchematicVoxelData(path string, maxBlocks int)` — `.nbt` / `.schematic` 的体素数据
- `ResolveBlockName(id int, data byte) string` — 旧版数字 ID→注册名
- `ResolveBlockZH(name string) string` — 注册名→中文名（自动去 `minecraft:` 前缀）
- `MapColor(blockName string) string`（block_colors.go）— 方块名→十六进制渲染色

## 与其他子系统关系

- 被 `internal/app/resource_bindings.go` 调用（GetLitematicMeta / 三种体素构建 / schematic 与 nbt 摘要等 binding）
- 依赖 `github.com/Tnze/go-mc/nbt`（NBT 解码）、`go/types`（LitematicMeta/LitematicVoxelData/VoxelGroup）
- 资源类型归属由 [resource_registry](./resource_registry.md) 的 `litematic` / `create-blueprint` 条目定义

## 不变量

- Litematica packed LongArray 是**小端位序**（`extractBits` 从每个 long 的 LSB 连续排列、可跨 64 位边界），与原版 1.16+ 大端 packed array 相反——搞反会导致 3D 预览全乱
- 方块线性索引存储顺序为 X→Z→Y：`i = x + z*sizeX + y*sizeX*sizeZ`
- palette 索引 0 视为空气跳过；体素数超过 `maxBlocks` 时截断并置 `Truncated=true`（上限由 AppConfig.VoxelMaxBlocks 控制，默认 200000）

## 相关

- [go_types](./go_types.md) — LitematicMeta / LitematicVoxelData 结构
- [resource_registry](./resource_registry.md) — litematic/create-blueprint 类型定义
- [wails_bridge](./wails_bridge.md) — 投影解析 binding
