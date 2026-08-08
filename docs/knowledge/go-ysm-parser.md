---
kind: go-ysm-parser
name: YSM 解析 go/ysm
tier: architecture
category: go
source_files:
  - go/ysm/
use_when:
  - YSM
  - 解析
  - 摘要
  - ysm 文件
  - 元数据
---

# YSM 解析 go/ysm

## 概览

`go/ysm/` 包负责解析 YSM（Yuan's Sketch Model）格式文件，提取模型元数据并生成结构化摘要。

## 核心职责

- 读取 .ysm 文件格式
- 提取模型属性（尺寸、材质、骨骼信息）
- 生成前端可用的摘要结构

## 对外 API / 入口

- `IsYSMJar` — 判断文件是否为 YSM jar 包（zip 内结构探测）
- `HasYSMMod` / `HasModInDir` — 检测目录内是否含 YSM mod
- 解析链路文件：`parse.go`（模型解析）/ `summary.go`（摘要）/ `header.go`（头部读取）/ `texsize.go`（纹理尺寸）

## 与其他子系统关系

- `go/types/`: 共享类型定义
- `frontend/src/wasm/`: Wasm 端 YSM 解析器（客户端补充解析）

## 不变量

- 解析错误必须返回结构化错误信息，前端做 toast 提示（绑定层 `ExtractYsmSummary` 失败时记日志 + 空摘要，前端 detail.ts 有 `hasRealSummary` 兜底）。**裸 ysm.json 解析失败同样返回错误**（P2 修复：原实现 `err == nil && root.Metadata != nil` 使 Unmarshal 失败时整个 if 跳过、静默降级为「文件名摘要」返回 nil error——违反不变量，前端 toast 链路无法触发）
- 解析入口设大小上限（zip 内 mods.toml 1MB / geoJSON 5MB / ysm.json 50MB，limit+1 探测截断拒绝，ADR-033）；裸 ysm.json 同 50MB 上限
- 注意：YSM 解析绑定（AnalyzeYSMModel/ExtractYsmSummary/ExtractYSMHeader）**不强制 go/paths 校验**——预览链路的临时文件（`SavePreviewTempFile` → os.TempDir）不在仓库根内，加 `IsInside(ysmRoot)` 守卫会破坏预览链路（与 `ReadFileBytes` 的守卫语义不同，撤修）

## 相关

- `frontend/src/wasm/ysm-parser.ts` — Wasm 端解析器
