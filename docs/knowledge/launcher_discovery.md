---
kind: launcher_discovery
name: HMCL/PCL 启动器目录识别
tier: leaf
category: feature
source_files:
  - internal/app/launcher_discovery.go
  - frontend/src/views/app-content/settings/path-cards.ts
use_when:
  - 需要识别 HMCL/PCL 版本目录并设置 YSM 默认下载目录
  - 排查 config/yes_steve_model/custom 的版本隔离路径
---

# HMCL/PCL 启动器目录识别

## 概览

`App.DetectLaunchers` 对用户选择的目录做有限深度探测，识别 HMCL、PCL 或普通 Minecraft 游戏根目录，并列出全局目录、`versions/<version>` 目录及对应的 YSM custom 路径。

## 核心职责

- 只读探测，不解析或修改 HMCL/PCL 私有配置。
- 识别 `PCL/Setup.ini`、HMCL 标记和常见 `.minecraft`/`instances` 布局。
- 为每个候选版本返回 `config/yes_steve_model/custom`、是否存在及其中的配置文件。

## 对外 API / 入口

- Go/Wails：`DetectLaunchers(root string) ([]types.LauncherInfo, error)`。
- 设置页的“启动器与 YSM 目录”卡片调用该方法；用户点击版本后通过 `SetResourceRoot("ysm", path)` 保存默认下载根。

## 与其他子系统关系

- YSM Hub 下载使用 `GetRepoRoot("ysm")`，因此会直接落到用户选定的 custom 目录。
- `EnsureStorageDirs` 在选择后创建不存在的目录；本模块不改变 PCL/HMCL 配置文件。

## 不变量

- 不递归扫描整块磁盘，只检查已知目录和一层子目录。
- 不把不存在的 custom 目录误报为已存在；路径仍会返回，方便首次下载创建。

## 相关

- `go/types/types.go`：`LauncherInfo`、`LauncherInstance`。
- HMCL 版本隔离文档：https://docs.hmcl.net/launcher/isolation.html
- PCL Wiki 版本目录说明：https://github.com/Meloong-Git/PCL/wiki/%E8%87%AA%E5%AE%9A%E4%B9%89%E4%BB%B6
