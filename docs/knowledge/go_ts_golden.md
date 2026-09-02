---
kind: go_ts_golden
name: Go-TS 解析层 golden 对拍（ADR-154 双端互锁）
tier: architecture
category: go
source_files:
  - go/types/parity_zipentry_test.go
  - go/litematic/parity_voxel_test.go
  - tests/parity/go-ts-zipentry.json
  - frontend/src/backend/zipentry.parity.test.ts
  - frontend/src/backend/voxel-colors.parity.test.ts
auto_fields:
  symbols_with_lines:
    - TestParity_MatchZipEntry:41
    - TestParity_VoxelBlockVariant:75
    - TestParity_VoxelColorKeyCoverage:93
    - TestParity_VoxelColorMap:64
use_when:
  - 网页影子层（TS 平移 Go 的解析函数）与 Go 侧口径是否漂移
  - 新增/修改 resource_types.json 的 zipEntries 指纹后是否影响 Go-TS 一致性
  - voxel-colors-data.json 生成物是否过期（Go 表变更未同步前端）
  - 双端互锁契约 fixture 的更新口径
pitfalls:
  - "golden 必须双端互锁：Go 测试 + TS 测试读同一份 fixture，只做 web 单侧对拍是死快照，防不住 Go 侧漂移（ADR-154 §2.2 硬性要求）"
  - "matchZipEntryTS 是注册表顺序首命中、忽略 priority；Go MatchZipEntry 同构，但容器级 detectZipType 走 priority desc 裁决——两者不可直接对拍（ADR-154 §2.4）"
  - "TS 测试读仓库根 fixture 不得用 import 语句（ADR-146 R4 冻结基线会 FAIL），须用 readFileSync + process.cwd() 向上定位"
quick_groups:
  - 契约对拍
  - 双端互锁
quick_intents:
  - 确认 Go-TS 解析层是否漂移 → 跑 go test ./go/types ./go/litematic + vitest src/backend/*.parity.test.ts
  - 修改识别层指纹后自检 → 重跑两端 parity 测试（fixture 期望值以 Go 输出为准）
quick_risk_lines:
  - MatchZipEntry|matchZipEntryTS 首命中序依赖 resource_types.json 顺序
  - voxel-colors-data.json 无复跑生成器（gen/main.go 只生成 block_ids_data.go），靠 parity_voxel_test.go 兜底
invariant_anchors:
  - go/types/parity_zipentry_test.go|TestParity_MatchZipEntry
  - go/litematic/parity_voxel_test.go|TestParity_VoxelColorMap
  - go/litematic/parity_voxel_test.go|TestParity_VoxelBlockVariant
---

# Go-TS 解析层 golden 对拍（ADR-154 双端互锁）

## 概览

网页版（无 Go 壳）把整层 Go 解析逻辑平移成 TS 影子层（ADR-049 web 豁免 + ADR-070/066/082「TS 镜像 Go」），双实现漂移是永久负债。ADR-154 以共享 fixture（`tests/parity/*.json`）为**双端互锁契约**：Go 测试与 TS 测试读取同一份 fixture，任一端改口径另一端当场红。范式完全对齐既有 `tests/parity/go-rust-predicates.json`（Go↔Rust 先例，ADR-038 D2）。

## 核心职责

- **pilot 1（识别层指纹）**：Go `types.MatchZipEntry` ↔ TS `matchZipEntryTS`，fixture `tests/parity/go-ts-zipentry.json`（语料源：classify-golden entries + 全类型 zipEntries + 边界），双端 27 条全绿。
- **pilot 2（方块配色）**：Go `MapColor`/`ResolveBlockName` ↔ TS `mapColor`/`resolveBlockName`。Go 侧 `parity_voxel_test.go` 直接读 `voxel-colors-data.json` 逐键验证（生成物过期检测器），TS 侧 `voxel-colors.parity.test.ts` 消费同一 data.json。已捕获并修复真实漂移：`118:3` 曾为 "minecraft:cauldront"（typo），Go 源码正确为 "minecraft:cauldron"。
- **已知遗留**：容器级 `detectZipType` 对拍待 TS 补 (priority desc, id asc) 裁决后纳入（ADR-154 §2.4）；装配层（scanWebModels/searchWebModels）永久无法 golden（输入面不同）。

## 对外 API / 入口

- Go：`go/types/parity_zipentry_test.go::TestParity_MatchZipEntry`、`go/litematic/parity_voxel_test.go::TestParity_VoxelColorMap/VoxelBlockVariant/VoxelColorKeyCoverage`
- TS：`frontend/src/backend/zipentry.parity.test.ts`、`frontend/src/backend/voxel-colors.parity.test.ts`
- Fixture：`tests/parity/go-ts-zipentry.json`；共享数据源 `frontend/src/backend/voxel-colors-data.json`

## 与其他子系统关系

- 上游事实源：`resource_types.json`（zipEntries 指纹）、`go/litematic/blocks_1_12.json`（方块表）。
- 对拍对象：`frontend/src/utils/resource/types.ts:376 matchZipEntryTS`、`frontend/src/backend/voxel-colors.ts`、`go/types/extensions.go:257 MatchZipEntry`、`go/litematic/block_colors.go`/`block_ids.go`。
- 更新口径（ADR-154 §2.5）：Go 行为变更（有意）→ 两端重跑、同一批 fixture 期望值同步更新并带 diff 审查；生成物变更 → golden 测试即过期检测器。

## 实施进度

- ✅ ADR-154 已采纳；pilot 1（识别层指纹）+ pilot 2（方块配色全量 + 生成物过期检测）双端互锁已落地并全绿。
- ⏳ 后续（跑通机制后扩）：ysm-header 文本头/YSGP、nbt-parse 三视图、pack-meta、extract.detectZipType 容器级（前置：TS 补 priority 裁决）。
