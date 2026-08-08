---
kind: utils-icon
name: 图标映射 icon
tier: leaf
category: utils
source_files:
  - frontend/src/utils/icon/icon.ts
use_when:
  - 图标
  - emoji
  - 文件图标
  - fileIcon
  - 判断 YSM 文件
---

# 图标映射 icon

## 概览

文件名 → 图标 emoji 的映射工具，用于列表/树行的文件类型图标展示。

## 核心职责

- 按文件扩展名返回固定 emoji 图标
- 判断文件名是否为 YSM 模型文件

## 对外 API / 入口

- `fileIcon(name: string): string` — 按扩展名（小写）返回 emoji：ysm→💎，zip/rar/7z/tar/gz→📦，pmx/pmd→🎭，vrca/vrcw→🥽，litematic→📐，nbt/schematic/schem→⚙️，png/jpg/jpeg/gif/webp/bmp→🖼️，txt/md/json/xml/yml/yaml/cfg/conf/ini→📄，其余→🧊
- `isYsmName(name: string): boolean` — 扩展名是否等于 `RESOURCE_TYPES.YSM`

## 与其他子系统关系

- 依赖 `utils/resource-types.ts` 的 `RESOURCE_TYPES.YSM` 常量（不硬编码字符串）
- 被 `app-tree/render.ts` 消费（行图标与 YSM 判断）

## 不变量

- 扩展名取 `name.split(".").pop()` 小写，不带前导点
- YSM 判断必须经 `RESOURCE_TYPES` 常量，禁止硬编码 —— 注册表优先原则（AGENTS.md §4.4）；litematic 分支同样走 `RESOURCE_TYPES.LITEMATIC` 常量（P3 修复：原硬编码 `"litematic"` 与 YSM 分支不对称）

## 相关

- [utils_resource_types](./utils-resource-types.md) — 资源类型常量
- `frontend/src/utils/icon/icon.test.js` — 单元测试（验证入口）
