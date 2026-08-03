---
title: 下载与安装
description: 获取 YSM 模型管理器、解压位置与首次启动的完整流程
outline: [2, 3]
---

# 下载与安装

## 它能做什么

从 GitHub Releases 获取 YSM 模型管理器桌面程序（Wails 打包，单目录绿色运行），完成解压与首次启动。首次启动会自动创建资源目录结构并弹出设置页，配好两个路径即可开始使用。

## 打开方式

1. 打开 [GitHub Releases 页面](https://github.com/eghrhegpe/ysm-model-manager/releases)
2. 找到最新版本（如 `v1.9.3`）
3. 下载 `YSM-Model-Manager_windows_amd64.zip`
4. 解压到任意目录（建议 `D:\YSM-Model-Manager\` 或其它非系统盘位置）
5. 双击 `YSM-Model-Manager.exe` 启动

## 操作步骤

### 1. 系统要求

- Windows 10/11（64 位）
- WebView2 运行时（Wails 依赖，Win10/11 通常已预装；缺失时从 [Microsoft 官网](https://developer.microsoft.com/en-us/microsoft-edge/webview2/) 下载）

### 2. 首次启动会发生什么

- 自动进入设置页，需要配置「文件存储路径」（模型仓库）与「游戏根目录」才能完整使用各项功能，详见 [首次配置](./first-setup.md)
- 程序会在文件存储路径下自动创建 `ysm`、`resourcepacks`、`shaderpacks`、`schematics`、`mmd`、`vrchat` 六个资源子目录
- 若检测到旧版放在 exe 旁的 `ysm_config.json`，会自动迁移到用户配置目录（见下）

### 3. 数据都存放在哪里

| 数据 | 位置 |
|------|------|
| 配置文件 | `%APPDATA%\YSM-Model-Manager\ysm_config.json` |
| 操作日志 | `%APPDATA%\YSM-Model-Manager\ysm-import-logs.json` |
| 模型与资源 | 你在设置中指定的文件存储路径（各类型分子目录） |

> 配置不在 exe 同目录。备份与迁移请以上述路径为准，见 [备份与迁移](./backup-migration.md)。

### 4. 升级程序

程序自带自动更新：启动时检查 GitHub Releases，发现新版本会在界面底部弹出可点击提示，点击即可下载并自动更新（无黑框、完成后自动重启）。也可手动下载 ZIP 解压覆盖。详见 [版本更新](./update.md)。

## 常见问题

**Q：下载的 exe 打不开 / 闪退？**
A：① 检查 WebView2 是否安装；② 部分杀毒软件会误报 Wails 应用，请将程序目录加入白名单；③ 确保程序目录路径不含中文/空格等特殊字符。

**Q：启动后页面空白？**
A：检查 WebView2 是否安装；尝试以管理员身份运行。

**Q：可以放在 U 盘 / 移动硬盘运行吗？**
A：程序本身绿色运行可以，但模型仓库与游戏根目录建议留在本机分区——硬链接模式要求仓库与游戏目录同分区，跨分区时推送模型会报错。

**Q：窗口位置与大小会记住吗？**
A：会。退出时自动保存窗口位置与大小（双屏环境按相对位置记录），下次启动恢复；默认尺寸 1200×800。

## 相关功能

- 装好后不知道配什么？见 [首次配置](./first-setup.md)
- 想了解项目为什么存在？见 [项目意义](./项目意义.md)
