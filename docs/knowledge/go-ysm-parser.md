---
kind: go-ysm-parser
name: YSM 解析 go/ysm
tier: architecture
category: go
source_files:
  - go/ysm/
quick_groups:
  - 模型扫描与仓库管理
quick_intents:
  - YSM 解析、摘要 ExtractYsmSummary
  - AnalyzeYSMModel、HasYSMMod
  - YSM 文件元数据
quick_risk_lines:
  - YSM 解析必须走 go/ysm 的 AnalyzeYSMModel，前端禁止手写 YSM 解析逻辑
pitfalls:
  - 前端手写 YSM 解析 → 与 Go 解析结果不一致、漏掉 HasYSMMod 判定；必须交 Go 解析
  - 跳过 ExtractYsmSummary 走全文解析 → 详情展示性能差；摘要必须复用

use_when:
  - YSM
  - 解析
  - 摘要
  - ysm 文件
  - 元数据
perf:
  - io-bound
invariant_anchors:
  - go/ysm/summary.go|ExtractYsmSummary
  - go/ysm/parse.go|AnalyzeYSMModel
  - go/ysm/ysm.go|HasYSMMod
status: active
---

# YSM 解析 go/ysm

## 概览

`go/ysm/` 包负责解析 YSM（Yuan's Sketch Model）格式文件，提取模型元数据并生成结构化摘要。

## 核心职责

- 读取 .ysm 文件格式
- 提取模型属性（尺寸、材质、骨骼信息）
- 生成前端可用的摘要结构
- **容器打开统一走 `go/container`（ADR-068）**：`summary.go`/`parse.go`/`texsize.go`/`ysm.go` 四处 `zip.OpenReader`/`sevenzip` → `container.OpenZipPath`/`Open7zPath`，遍历改 `Entry` 方法（summary 同一容器三次遍历收敛为 `Entries()` 单次列出）

## 对外 API / 入口

- `IsYSMJar` — 判断文件是否为 YSM jar 包（zip 内结构探测）
- `HasYSMMod` / `HasModInDir` — 检测目录内是否含 YSM mod
- 解析链路文件：`parse.go`（模型解析）/ `summary.go`（摘要）/ `header.go`（头部读取）/ `texsize.go`（纹理尺寸）

## 与其他子系统关系

- `go/types/`: 共享类型定义
- `frontend/src/wasm/`: Wasm 端 YSM 解析器（客户端补充解析）

## 不变量

- 解析错误必须返回结构化错误信息，前端做 toast 提示（绑定层 `ExtractYsmSummary` 失败时记日志 + 空摘要，前端 detail.ts 有 `hasRealSummary` 兜底）。**裸 ysm.json 解析失败同样返回错误**（P2 修复：原实现 `err == nil && root.Metadata != nil` 使 Unmarshal 失败时整个 if 跳过、静默降级为「文件名摘要」返回 nil error——违反不变量，前端 toast 链路无法触发）
- 解析入口设大小上限（zip 内 mods.toml 1MB / geoJSON 5MB / ysm.json 50MB，limit+1 探测截断拒绝，ADR-033；`ysm.json` 50MB 走 `types.MaxReadLimit` 全仓单点）；裸 ysm.json 同 50MB 上限
- **解压目录加载模型排除第一人称手臂 arm.json**（`extracted.go` `isArmModelName`：arm.json / arm.geo.json）：arm 是第一人称手持视角的独立手臂几何，pivot 与 main 的手臂不同，合并版（FindGeometryInExtractedYSM）在全身第三人称预览中不需要此几何，剔除避免错位（zip 路径同款在 [go_geometry](./go-geometry.md) 的 `archive.go`）。**组件化路径（FindComponentsInExtractedYSM）保留 arm 作独立组件**——与 main 共用同一套 player.texture 皮肤（ModernYSM `MainModelData` 权威：main 和 arm 是 models 列表里的两个独立 GeoModel，共用 textureMap，通过 textureIndex 选皮肤）。arm 不填 ComponentTextures、texNames 置空、TexSlot=0（贴 texArr[0] 默认皮肤，与 main 一起切皮肤）——2026-08-25 提交 c76e084e 修复（原逻辑把 model map 声明序位置当 texSlot，main=0 贴 skin、arm=1 贴 skin_white，导致 main 和 arm 走不同皮肤）
- **解压目录加载模型排除第一人称手臂 arm.json**（2026-08-26 起用 `geometry.IsArmModelName` 单一实现，原 extracted.go 本地副本已删；arm.json / arm.geo.json）：arm 是第一人称手持视角的独立手臂几何，pivot 与 main 的手臂不同，合并版（FindGeometryInExtractedYSM）在全身第三人称预览中不需要此几何，剔除避免错位（zip 路径同款在 [go_geometry](./go-geometry.md) 的 `archive.go`）。**组件化路径（FindComponentsInExtractedYSM）保留 arm 作独立组件**——与 main 共用同一套 player.texture 皮肤（ModernYSM `MainModelData` 权威：main 和 arm 是 models 列表里的两个独立 GeoModel，共用 textureMap，通过 textureIndex 选皮肤）。arm 不填 ComponentTextures、texNames 置空、TexSlot=0（贴 texArr[0] 默认皮肤，与 main 一起切皮肤）——2026-08-25 提交 c76e084e 修复（原逻辑把 model map 声明序位置当 texSlot，main=0 贴 skin、arm=1 贴 skin_white，导致 main 和 arm 走不同皮肤）
- **解压目录多组件 perComponent 纹理（2026-08-23 补齐、2026-08-25 扩范围，对齐 zip `buildComponents` 口径）**：`FindComponentsInExtractedYSM` 建小写去扩展名索引；**未声明组件**（补扫按字典序）命中同名纹理 → 挂 `ComponentTextures[basename]=[data URI]` + `TexSlot=0`（局部索引，对齐 zip 口径）+ `texNames` 置空串（前端 R1 校验跳过）；**已声明组件不填**（保留全局 texArr[texSlot] 多皮肤切换语义）。此前缺失导致 arrow/boat 等投射物在前端 texArr 越界被静默贴错皮肤（wine_fox「UV 炸」根因：7 组件只有 main 正常）。**2026-08-25 commit A/B 重构两件套**：① 抽公共 `parsePlayerModel` 统一 ysm.json player 段解析，两消费方（Geometry/Components）主打各留纹理规范化——Geometry 带扩展名做 orderMap 键、Components 去扩展名喂前端 R1，**口径天然不同不可强归一**；② pngNameMap 由单层只认 `.png` 换为公共递归 `collectTextureFiles`（WalkDir + `gui/` 排除 + `.png/.jpg/.tga`），Geometry 纹理收集同步复用——修子目录同名纹理 / `.tga` 同名纹理两缺陷，且 gui 排除（wine_fox 17_mini 根因）不再单独维护两遍。数据经 GetModel3DSpec 注入 spec 到前端，见 [go_threejs](./go-threejs.md) / [model3d](./model3d.md)
- **组件解析结构收敛（2026-08-26 审查落地）**：① 兜底 3 WalkDir 加 `maxFallbackGeoProbes=20` 候选预算（畸形大目录防逐个 readFile+Parse 的宽度 DoS，超限 SkipAll 停扫走兜底 4）；② `computeTexSlotForComponent` 去 `*int` 出参改 undeclSeq 值传递进出（「使用后自增」契约显式化）；③ `applyComponentPerComponentTex` 11 参收敛为 `componentBindCtx.bindPerComponentTex` 方法（dir/cleanDir/declaredTexByModel/pngNameMap 轮级恒定上下文 + comps/texNames 统一收口，对齐 instance.rtypeCtx 先例）；注意 ctx.texNames 保持 `make(0,len)` 预分配非 nil——JSON 出 `[]` 而非 `null`
- 注意：YSM 解析绑定（AnalyzeYSMModel/ExtractYsmSummary/ExtractYSMHeader）**不强制 go/paths 校验**——预览链路的临时文件（`SavePreviewTempFile` → os.TempDir）不在仓库根内，加 `IsInside(ysmRoot)` 守卫会破坏预览链路（与 `ReadFileBytes` 的守卫语义不同，撤修）
- **包分层约束（2026-08-25 兄弟会话拆函数时确认）**：依赖方向 **geometry ← ysm**（`go/ysm` import `go/geometry`，`go/geometry` 不得反向 import `go/ysm`，否则 import cycle）。因此 `collectDeclaredTexByModel` / `computeTexSlotForComponent` / `applyCubeTextures` 等 helper 都归 ysm 包（`extracted.go`），**geometry 侧不能跨包调用**，只能镜像实现——geometry 的 `buildComponents`（archive.go）本就有一套平行 perComponent 逻辑，镜像模式是既定现状。`applyCubeTextures` 这类纯 `types.BedrockModel` 函数可在 geometry 包内用本地函数/闭包镜像（优先复用本包已有等价逻辑，勿再造第三份）。**抽公共 helper 前先查包依赖方向**：若目标位置会形成 geometry→ysm 反向边，改为包内镜像而非共享。

## 相关

- `frontend/src/wasm/ysm-parser.ts` — Wasm 端解析器
