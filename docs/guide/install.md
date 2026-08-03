---
title: 下载与安装
description: 获取 YSM 模型管理器、解压位置与首次启动的完整流程
outline: [2, 3]
---

# 下载与安装

## 它能做什么

从 GitHub Releases 获取 YSM 模型管理器桌面程序（Wails 打包，单目录绿色运行），完成解压与首次启动。

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

### 2. 首次启动

首次启动会弹出设置页面，需要配置「游戏根目录」与「模型仓库路径」两个路径才能正常使用。详见 [首次配置](./first-setup.md)。

### 3. 升级程序

程序自带自动更新：启动时检查 GitHub Releases，发现新版本右下角弹出提示，点击即可下载并自动更新（无黑框、完成后自动重启）。也可手动下载 ZIP 解压覆盖。详见 [版本更新](./update.md)。

## 常见问题

**Q：下载的 exe 打不开 / 闪退？**
A：① 检查 WebView2 是否安装；② 部分杀毒软件会误报 Wails 应用，请将程序目录加入白名单；③ 确保程序目录路径不含中文/空格等特殊字符。

**Q：可以放在 U 盘 / 移动硬盘运行吗？**
A：程序本身绿色运行可以，但模型仓库与整合包路径建议留在本机分区（硬链接模式要求仓库与游戏根目录同分区）。

## 相关功能

- 装好后不知道配什么？见 [首次配置](./first-setup.md)
- 想了解项目为什么存在？见 [项目意义](../guide/项目意义.md)
