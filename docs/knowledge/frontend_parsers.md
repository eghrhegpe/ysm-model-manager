---
kind: frontend_parsers
name: 解析簇 parsers/ 自 backend 迁出
tier: architecture
category: core
source_files:
  - frontend/src/parsers/ysm-header.ts
  - frontend/src/parsers/voxel-parse.ts
  - frontend/src/parsers/nbt-parse.ts
  - frontend/src/parsers/extract.ts
  - frontend/src/parsers/pack-meta.ts
  - frontend/src/parsers/voxel-colors.ts
tests:
  - frontend/src/parsers/extract.test.ts
  - frontend/src/parsers/nbt-parse.test.ts
  - frontend/src/parsers/pack-meta.test.ts
  - frontend/src/parsers/voxel-colors.parity.test.ts
  - frontend/src/parsers/voxel-colors.test.ts
  - frontend/src/parsers/voxel-parse.test.ts
  - frontend/src/parsers/ysm-header.test.ts
auto_fields:
  symbols_with_lines:
    - bitsPerEntry
    - decodeVoxelNbt
    - detectContainerType
    - emptyYsmHeader
    - emptyYsmSummary
    - extractBits
    - ExtractResult
    - extractYsmSummaryFromBytes
    - extractZip
    - findZipEntry
    - litematicMetaView
    - litematicVoxelView
    - mapColor
    - nbtStructureView
    - nbtVoxelView
    - packPngToThumbnail
    - parseNbtRoot
    - parseNbtRootExact
    - parsePackMetaJson
    - parseShaderpackLang
    - parseYsmHeaderFromBytes
    - parseZipCentralDir
    - readVarInt
    - resolveBlockName
    - schematicSummaryView
    - schematicVoxelView
    - unpackBlockStates
    - VoxelData
    - VoxelGroup
    - YsmHeaderShape
    - YsmSummaryShape
    - ZipEntryMeta
    - ZipType
use_when:
  - 解析 YSM / NBT / 体素 / zip / pack.mcmeta / 颜色映射
  - voxel-parse / ysm-header / nbt-parse 定位
quick_groups:
  - 解析与数据
quick_intents:
  - 找 YSM 头部解析 / NBT 解析 / 体素解析 / zip 解包 / 颜色映射
quick_risk_lines:
  - parsers/ 依赖 backend/web-common（跨簇单向,ADR-170 已知残留,待二段归位）
  - parsers/ 是纯解析层,勿塞业务;web-fs 装配层在 backend/
  - ysm-header.ts MAX_HEADER_LINES=200 与 Go header.go 对齐,改上限须双端同步
  - voxel-parse.ts 位解码口径(Litematica 小端 LSB 起始)与 Go nbt.go:299-327 逐行一致,改前必读注释
  - pack-meta.ts / voxel-colors.ts 下游消费方固定,改导出签名须 grep 全仓消费者
pitfalls:
  - ysm-header.ts extractYsmSummaryFromBytes 失败返回空 YsmSummary 而非 reject(对齐 Go app_model.go:41-65 吞错误语义),消费方不得 expect throw
  - voxel-parse.ts decodeVoxelNbt 使用 bigint 处理 LongArray(>2^53 精度损失),勿替换为 number
  - nbt-parse.ts parseNbtRootExact 与 parseNbtRoot 二选一:精确版(64 位 long)用于体素解码,标准版用于普通 NBT
  - pack-meta.ts 依赖 resource_types.json 派生的 extensions,改类型配置须同步更新 pack 探测逻辑
  - extract.ts findZipEntry 使用中央目录搜索,超大 zip(>500MB)可能慢,web-fs 侧有 maxMaterializeBytes 512MB 封顶防护
  - voxel-colors.ts resolveBlockName 映射表来自 voxel-colors-data.json(63K),新增方块名须更新 JSON 而非硬编码
  - ADR-170 二段归位(web-* 族下沉)后,voxel-parse/pack-meta 对 web-common 的跨簇依赖应消除,当前是已知技术债
invariant_anchors:
  - frontend/src/parsers/voxel-parse.ts|decodeVoxelNbt
---

# 解析簇 parsers/ 自 backend 迁出

## 概览

`frontend/src/parsers/`：纯解析层，自 `backend/` 迁出（ADR-170 第一段）。含 YSM 头/摘要、NBT、体素（voxel）、zip 解包、pack.mcmeta、方块颜色映射六类解析器。真叶子层——只依赖同簇互引 + utils + 一个跨簇例外 web-common。

## 核心职责

| 文件 | 职责 |
|---|---|
| ysm-header.ts | YSM 头部/摘要解析（ExtractYSMHeader 族,Go ysm/header.go 平移） |
| nbt-parse.ts | NBT 二进制解析（parseNbtRoot,Go nbt 平移） |
| voxel-parse.ts | 体素视图（nbt/litematic/schematic 三视图 + decodeVoxelNbt） |
| extract.ts | zip 解包（extractZip,纯 TS 平移） |
| pack-meta.ts | pack.mcmeta 元数据解析 |
| voxel-colors.ts + voxel-colors-data.json | 方块 → 颜色映射（mapColor/resolveBlockName） |

## 对外 API / 入口

各文件顶层导出即入口（无目录 index 聚合）。web-fs 装配层（backend/web-fs*.ts）与 preview-3d（litematic-adapter/mmd-zip-overlay）直接按文件 import。

## 与其他子系统关系

- **上层**：backend/web-fs*（web 模式文件系统）把解析器装进浏览链路；preview-3d/views 直接消费。
- **跨簇例外**：voxel-parse/pack-meta 依赖 `backend/web-common`（base64/资源类型小工具）——web-common 未随迁,形成 2 处单向跨簇依赖,ADR-170 记为二段（web-* 族归位）时消除。
- 测试随迁：各解析器 + voxel-colors.parity 契约测试在 parsers/ 下。`backend/zipentry.parity.test.ts` 独立留原处（只依赖 utils/resource/types）。

## 不变量

- parsers/ 不 import backend 业务桥（app/runtime/platform）——发现即回归（P0-2 治理红线）。
- 禁止把业务（对话框/装配/事件）塞进 parsers/。

## 相关

- ADR-170（backend 桥层收窄 + 解析簇下沉,二段式）
