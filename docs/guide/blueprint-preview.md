---
title: 蓝图预览（Litematic）
description: .litematic / .nbt / .schematic 蓝图详情与 3D 体素预览
outline: [2, 3]
---

# 蓝图预览（Litematic）

## 它能做什么

预览 Minecraft 建筑蓝图文件（`.litematic` / `.nbt` 结构 / `.schematic`）：查看元数据详情，并用 3D 体素视图浏览整体结构。

## 打开方式

在「模型仓库」中点击蓝图类文件（.litematic / .nbt / .schematic）→ 预览面板显示详情；点击「3D」标签进入体素预览。

## 操作步骤

### 1. 蓝图详情

- **Litematica 格式**：名称、作者、创建/修改时间、格式版本（Litematica v + MC Data v）、描述
- **NBT 结构**：数据版本、格式版本、尺寸
- **Schematic**：名称、作者、尺寸

### 2. 3D 体素预览

- 进入体素视图，整体结构以方块（voxel）形式渲染
- **WASD / 方向键** 移动视角，空格升降
- `Esc` 退出预览

### 3. 数据来源

预览数据由 Go 端解析（`ReadLitematicMeta` / `ReadNbtStructure` / `ReadSchematic` / `GetLitematicVoxelData` 等），WASM/绑定层提供体素数据。

## 常见问题

**Q：无法解析 / 显示「无法解析」？**
A：文件可能损坏或格式不完整；Litematica 需含名称/作者或 totalBlocks，NBT/Schematic 需含 size/blockCount。

**Q：体素预览卡顿？**
A：大型蓝图方块数多时渲染较重，稍等片刻或缩小视角范围。

## 相关功能

- 其它预览：见 [3D 预览与模型详情](./3d-preview.md)
- 蓝图文件管理：见 [模型仓库](./repository.md)
