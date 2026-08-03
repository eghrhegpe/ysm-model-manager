---
title: 版本更新
description: 自动更新检查、下载安装与手动覆盖升级
outline: [2, 3]
---

# 版本更新

## 它能做什么

启动时自动检查 GitHub Releases 新版本，发现更新后右下角提示，一键下载并自动更新；也支持手动下载覆盖升级。

## 打开方式

- **自动**：启动程序时自动检查，发现新版本右下角弹出提示，点击即可下载并自动更新（无黑框，完成后自动重启）
- **手动**：从 [GitHub Releases](https://github.com/eghrhegpe/ysm-model-manager/releases) 下载最新 ZIP，解压覆盖旧文件

## 操作步骤

### 1. 自动更新

1. 启动程序
2. 右下角出现更新提示 → 点击
3. 等待下载完成 → 程序自动重启到新版本

### 2. 手动更新

1. 下载最新 `YSM-Model-Manager_windows_amd64.zip`
2. 退出正在运行的程序（确保旧进程完全退出）
3. 解压覆盖旧目录

> 手动覆盖时若提示文件占用，先结束任务管理器中的 `YSM-Model-Manager.exe` 进程。

## 常见问题

**Q：更新后设置会丢吗？**
A：不会。配置在 `ysm_config.json`（与 exe 同目录），覆盖升级不影响该文件。

**Q：自动更新没反应？**
A：确认网络可访问 GitHub；代理环境可能需要手动更新。

## 相关功能

- 更新说明：见 [发布说明](../releases/README.md)
- 全新安装：见 [下载与安装](./install.md)
