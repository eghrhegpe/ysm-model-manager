---
kind: go_ysm_parser
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

## 与其他子系统关系

- `go/types/`: 共享类型定义
- `frontend/js/wasm/`: Wasm 端 YSM 解析器（客户端补充解析）

## 不变量

- 解析错误必须返回结构化错误信息，前端做 toast 提示
- YSM 文件路径必须经过 `go/paths/` 安全校验

## 相关

- `frontend/js/wasm/ysm-parser.js` — Wasm 端解析器
