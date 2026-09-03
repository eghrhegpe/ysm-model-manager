---
kind: utils-icon
name: 图标映射 icon
tier: leaf
category: utils
source_files:
  - frontend/src/utils/icon/icon.ts
auto_fields:
  symbols_with_lines:
    - fileIcon
    - isYsmName
quick_groups:
  - 跨组件通信与页面
quick_intents:
  - 图标、emoji、文件图标、fileIcon
  - isYsmName
quick_risk_lines:
  - 文件图标必须走 icon.ts 的 fileIcon，禁止手写文件名→图标映射
pitfalls:
  - 手写文件名→图标映射 → 与 fileIcon 不一致、新类型缺图标；必须经 fileIcon
  - isYsmName 判定不准确 → 图标错位；必须经 isYsmName 的统一判定

use_when:
  - 图标
  - emoji
  - 文件图标
  - fileIcon
  - 判断 YSM 文件
invariant_anchors:
  - frontend/src/utils/icon/icon.ts|fileIcon
  - frontend/src/utils/icon/icon.ts|isYsmName
status: active
---

# 图标映射 icon

## 概览

文件名 → 图标 emoji 的映射工具，用于列表/树行的文件类型图标展示。

## 核心职责

- 按文件扩展名返回固定 emoji 图标
- 判断文件名是否为 YSM 模型文件

## 对外 API / 入口

- `fileIcon(name: string): string` — 按扩展名（小写）返回 emoji：ysm→💎，zip/rar/7z/tar/gz→📦，pmx/pmd→🎭，vrca/vrcw→🥽，litematic→📐，nbt/schematic/schem→⚙️，png/jpg/jpeg/gif/webp/bmp→🖼️，txt/md/json/xml/yml/yaml/cfg/conf/ini→📄，其余→🧊。**2026-08-24：取扩展名前先剥禁用后缀（`.disabled`/`.ban`）**——禁用态文件仍是原名命名的真类型文件，`xxx.zip.disabled` 直接取末段会得 `.disabled` 落 🧊 兜底；剥后缀后按原扩展名判定（对齐 Go scanner 禁用后缀恢复 + display.ts 口径）。`isYsmName` 同基 `getExt` 自动受益
- `isYsmName(name: string): boolean` — 扩展名是否等于 `RESOURCE_TYPES.YSM`

## 与其他子系统关系

- 依赖 `utils/resource/types.ts` 的 `RESOURCE_TYPES` 常量（不硬编码字符串；知识卡旧文 `resource-types.ts` 为不存在的路径，已修正）
- 被 `app-tree/render.ts` 消费（行图标与 YSM 判断）

## 不变量

- 扩展名取 `name.split(".").pop()` 小写，不带前导点
- YSM 判断必须经 `RESOURCE_TYPES` 常量，禁止硬编码 —— 注册表优先原则（AGENTS.md §4.4）；litematic 分支同样走 `RESOURCE_TYPES.LITEMATIC` 常量（P3 修复：原硬编码 `"litematic"` 与 YSM 分支不对称）

## 相关

- [utils_resource_types](./utils-resource-types.md) — 资源类型常量
- `frontend/src/utils/icon/icon.test.ts` — 单元测试（验证入口）
