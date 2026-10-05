# ADR-070：网页版体素 3D：蓝图/投影预览 TS 平移 voxel 解析

- **状态**：✅ 已采纳
- **日期**：2026-08-16
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`go/litematic/voxel.go`、`go/litematic/nbt.go`、`go/litematic/parser.go`、`frontend/src/views/app-preview/litematic-3d.ts`、`frontend/src/backend/browser-adapter.ts`、`frontend/src/backend/nbt-parse.ts`、`frontend/src/backend/voxel-parse.ts`、`frontend/src/backend/web-fs.ts`、`docs/adr/ADR-066-universal-resource-preview.md`

---

## 1. 背景（Context）

### 1.1 web 端蓝图/投影 3D 全灭（审计缺口 #2）

`litematic-3d.ts` 的 `createLitematic3D` 渲染依赖 Go binding 提供体素数据：

| binding | Go 行为 | web 现状 |
|---------|---------|---------|
| `GetNbtVoxelData` / `GetSchematicVoxelData` / `GetLitematicVoxelData` | Go 解析 .nbt/.schematic/.litematic → voxel JSON | fail-fast（`browser-adapter` 未实现） |
| `ReadLitematicMeta` / `ReadNbtStructure` / `ReadSchematic` | 详情元数据 | fail-fast |

蓝图/投影在 web 端：详情面板先失败（meta 读取缺），3D tab 即使渲染也拿不到 voxel 数据——**详情 + 3D 预览全灭**。桌面正常（`go/litematic` 包成熟：`voxel.go` 三格式共用管线、`parser.go` 元数据、`nbt.go` NBT 解码，测试充分）。

### 1.2 与 YSM spec 的同构先例

YSM 的网页 gap 曾同病（Spec3D 生成在 Go 侧），解决范式是 **ADR-049 P2-2 纯 TS 移植**（`spec-builder.ts` 280 行镜像 Go `Build3DSpecFromGeometryJSON`，双边测试锁定）——不是 WASM，不是等 Go。体素 3D 同构：**前端 TS 平移 voxel 数据解析**，litematic-3d 渲染复用现有（不等 D2 统一渲染核心）。

## 2. 决策（Decision）

**网页版蓝图/投影预览 = 纯 TS 平移 voxel 解析，分三阶段，不互相等：**

1. **M1（门控，先行）**：web 端蓝图/投影的 3D 入口**门控隐藏**（详情可显示文件名/大小，3D tab 不渲染）——消除"点开报 WebUnsupportedError"的坏体验；同时 `browser-adapter` 补 `ReadLitematicMeta`/`ReadNbtStructure`/`ReadSchematic` 的 TS 实现（详情面板恢复，低风险）。
2. **M2（核心）**：**TS 平移 voxel 解析**——前端解析 `.nbt`（gzip + NBT varint + 块状态调色板）/ `.litematic` / `.schematic` → voxel 数据，与 `go/litematic/voxel.go`/`nbt.go` 同口径（参考 spec-builder.ts 范式：镜像 + 双边测试锁定 `frontend 解析 ↔ go/litematic 输出` 对拍）。
3. **M3（接入）**：`litematic-3d.ts` 在 web 模式走 TS voxel 数据（渲染复用现有 `createLitematic3D`，不重写）——`litematic-meta.ts` 移除 `resolveWebMode` 门控，三端同一渲染路径；D2 统一渲染核心落地后再迁移。

> 落地细节（binding 名、web-fs 接线、VOXEL_MAX_BLOCKS 对齐）见知识卡 `frontend-parsers`（实施进度）。

**边界**：不做 WASM 平移（体素解析是纯逻辑，TS 成本低于 YSM spec；WASM 引入 Go 运行时体积不值）；不与 D2 耦合（litematic-3d 渲染维持现状，D2 只收敛 renderer 骨架，数据层独立）。

## 3. 后果（Consequences）

**正面**：
- 蓝图/投影 web 预览闭环（与 YSM spec TS 移植同范式，对齐 ADR-049 P2-2）。
- 三阶段解耦：M1 门控立即可做（小改），M2 体素解析独立立项，M3 接入顺水推舟——**不再"等 D2 完工"**。

**负面**：
- M2 NBT 二进制解析（gzip/varint/调色板）前端实现有格式对齐风险——靠双边测试锁定（go/litematic 输出 ↔ TS 输出对拍）。
- M1 门控期间 web 蓝图/投影 3D 不可见（现状已是 fail-fast 报错，门控是改进非回退）。

**已知遗留**：
- `.schematic` v1/v2 双路径、structure NBT、litematic 区域多块——TS 平移需覆盖 `go/litematic/voxel.go` 全口径（测试驱动）。
- D2 统一渲染核心与 M3 的迁移时序：数据层（voxel-parse）先行，renderer 收敛后接入。

## 4. 数据溯源

来源：网页版 vs Go 能力差异审计（2026-08-16，审计缺口 #2 体素 3D 全灭）+ 用户决策（"等不起，给 ADR 定大方向"）→ 结果：ADR-070 立项，方向 = TS 平移 voxel 解析（对齐 ADR-049 P2-2 范式），三阶段（M1 门控 + M2 解析 + M3 接入），与 D2 解耦。

**落地补注（2026-08-16）**：M1/M2 随 ADR-071 审计增强系列 commits 落地（`nbt-parse.ts`/`voxel-parse.ts`/`web-fs.ts` binding 装配，含双边对拍测试 `nbt-parse.test.ts`/`voxel-parse.test.ts`）；M3 于同日移除 `litematic-meta.ts` web 门控接入（web 走 `browserAdapter` 的 `Get*VoxelData` TS 实现，三语言 `preview.webVoxelUnsupported` key 同步清理），状态更新为 ✅ 已采纳。验证：typecheck + 相关单测全绿 + `i18n-check.mjs` 三语言 887 keys 对齐。

<!-- 文件名: web-voxel-3d-ts-port.md → 实际文件 ADR-070-web-voxel-3d-ts-port.md -->
