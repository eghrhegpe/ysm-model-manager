---
kind: go_geometry
name: Geometry 存档 go/geometry
tier: architecture
category: go
source_files:
  - go/geometry/parse.go
  - go/geometry/archive.go
use_when:
  - geometry
  - 基岩版
  - bedrock
  - 模型解析
  - zip
  - 7z
  - 纹理
  - 动画
---

# Geometry 存档 go/geometry

## 概览

`go/geometry/` 包解析 Bedrock（基岩版）`minecraft:geometry` 模型：既支持单个 geometry JSON，也支持从 ZIP/7z 存档中按 `ysm.json` 清单合并多个模型文件、提取纹理与动画，产出 `types.BedrockModel` 供 2D 线条图与 3D 预览流水线使用。

## 核心职责

- `parse.go` — 标准 geometry JSON 解析（骨骼/立方体/UV/旋转/纹理槽）
- `archive.go` — ZIP/7z 存档解包：ysm.json 清单（model/texture 顺序）、多 geometry 文件合并、PNG 纹理与动画 JSON 收集、首张 PNG 快速缩略

## 对外 API / 入口

- `ParseBedrockGeometry(data []byte) *types.BedrockModel` — 解析单个 geometry JSON；输入上限 100MB；UV 兼容数组与 per-face 对象两种形态；失败返回 nil
- `ParseFromZip(data []byte, size int64) (*types.BedrockModel, [][]byte, []string)` — 从 ZIP 解析，返回（合并模型、纹理 PNG 列表、动画 JSON 字符串列表）；按 ysm.json 声明的顺序排列模型与纹理
- `ParseFrom7z(data []byte, size int64) (*types.BedrockModel, [][]byte)` — 7z 版（`github.com/bodgit/sevenzip`），返回模型与纹理
- `ExtractFirstPNGFromZip(data []byte, size int64) []byte` / `ExtractFirstPNGFrom7z(data []byte, size int64) []byte` — 提取第一张 PNG 做快速预览

## 与其他子系统关系

- 被 `internal/app/app_model.go` 调用（3D 预览前置解析）、`internal/app/app_files.go`（缩略图）、`internal/app/wasm_decoder.go`（解码后解析）
- 被 [go_ysm_parser](./go_ysm_parser.md) 的 `extracted.go` 调用（解压产物解析）
- 下游产物交给 [go_threejs](./go_threejs.md) 生成渲染 spec；依赖 `go/types`（BedrockModel/Bone2D/Cube2D）

## 不变量

- 存档内单文件读取上限 50MB（`maxExtractSize`，`io.LimitReader`），防 ZIP 炸弹
- `ParseBedrockGeometry` 输入上限 100MB（`maxParseSize`），超限拒绝并记日志
- `ysm.json` 是清单不是模型文件，不参与 geometry 解析；文件名含 animation/controller 的 JSON 归入动画而非模型
- 解析失败统一返回 nil/空，由调用方决定降级路径，不 panic

## 相关

- [go_threejs](./go_threejs.md) — BedrockModel → Three.js spec
- [go_ysm_parser](./go_ysm_parser.md) — YSM 格式与解压流程
- [go_types](./go_types.md) — BedrockModel 结构
