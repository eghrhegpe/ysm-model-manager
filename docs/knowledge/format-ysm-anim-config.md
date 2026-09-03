---
kind: format-ysm-anim-config
name: YSM 动画分组与配置菜单提取
tier: leaf
category: utils
source_files:
  - frontend/src/utils/format/ysm-anim-config.ts
auto_fields:
  symbols_with_lines:
    - extractAnimGroupsAndConfigs
    - YsmProperties
tests: []
quick_groups:
  - 3D 预览与模型追加
quick_intents:
  - 动画分组、配置菜单、ysm.json
  - extra_animation、summarize
quick_risk_lines:
  - YSM 动画分组与配置菜单必须经 extractAnimGroupsAndConfigs 从 ysm.json properties 提取
pitfalls:
  - 手写 JSON 路径 → 与 Go appendAnimGroupsAndConfigs 语义不一致；必须经 extractAnimGroupsAndConfigs
  - 加密模型 properties 不可读 → 动画分组丢失；必须经 WASM 解码后读取

use_when:
  - 动画分组
  - 配置菜单
  - ysm.json
  - extra_animation
  - summarize
invariant_anchors:
  - frontend/src/utils/format/ysm-anim-config.ts|extractAnimGroupsAndConfigs
status: active
---

# YSM 动画分组与配置菜单提取

## 概览

前端镜像 Go 端 `appendAnimGroupsAndConfigs` 逻辑的纯函数模块（`summary.go`）。加密 `.ysm` 经 WASM 解码后，`ysm.json` 的 `properties` 字段可读，但原 `wasm.ts` 仅取 `files`/`default_texture`/`authors`。本模块把「其他动画分组」和「配置菜单」两块信息从 `properties` 抽出，供详情卡（`summaryCardHTML`）渲染。

## 核心职责

- **分类组提取**: `extra_animation_classify` 中每个组，组名取自 `name`，为空时按 `#id` 回查 `extra_animation`；组内项目取非 `#` 开头的中文名（内部引用跳过）；整组皆内部引用时跳过整个组
- **松散动画兜底**: 未被任何分类组引用、且非 `#` 内部引用的顶层动画 → 归并到「其他动画」组（`id: "_loose"`）
- **配置菜单提取**: `extra_animation_buttons` 每个按钮即一个配置项，仅取 `name`/`id`

## 对外 API / 入口

- `extractAnimGroupsAndConfigs(p?: YsmProperties | null): { animGroups: SummaryAnimGroup[]; configMenus: SummaryConfigMenu[] }`
- `YsmProperties` 接口 — WASM 解码产物 ysm.json 的 properties 相关字段（仅模块需要的子集）

## 相关

- `frontend/src/utils/format/summarize.ts` — `SummaryAnimGroup` / `SummaryConfigMenu` 类型定义
- `go/internal/app/summary.go` — 对齐的 Go 端逻辑
