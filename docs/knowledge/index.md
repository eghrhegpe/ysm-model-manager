<!-- 本文件由 scripts/gen-knowledge-index.mjs 自动生成，禁止手改 -->

# 知识卡索引

> 总计: 14 张知识卡

## config（1 张）

*配置与注册表（resource_types、AppConfig）*

| 标识 | 名称 | tier |
|------|------|------|
| 🏗 resource_registry | 资源注册表 registry | architecture |

## core（3 张）

*核心基础设施（事件总线、页面状态、Wails 桥接）*

| 标识 | 名称 | tier |
|------|------|------|
| 🏗 event_bus | 事件总线 bus.js | architecture |
| 🏗 page_store | 页面状态管理 page-store.js | architecture |
| 🏗 wails_bridge | Wails 桥接 app.js | architecture |

## go（9 张）

*Go 后端包（安装、下载、回收站、YSM 解析等）*

| 标识 | 名称 | tier |
|------|------|------|
| 🏗 go_dedup | 去重 go/dedup | architecture |
| 🏗 go_download | 下载器 go/download | architecture |
| 🏗 go_importer | 导入策略 go/importer | architecture |
| 🏗 go_installer | 模型安装 go/installer | architecture |
| 🏗 go_paths | 路径安全 go/paths | architecture |
| 🏗 go_recycle | 回收站 go/recycle | architecture |
| 🏗 go_updater | 自动更新 go/updater | architecture |
| 🏗 go_watcher | 文件监听 go/watcher | architecture |
| 🏗 go_ysm_parser | YSM 解析 go/ysm | architecture |

## ui（1 张）

*前端 UI 组件（tree、sidebar、preview、content）*

| 标识 | 名称 | tier |
|------|------|------|
| 🏗 app_tree | 资源树 app-tree | architecture |

---

## 分类说明

| 分类 | 用途 |
|------|------|
| core | 核心基础设施（事件总线、页面状态、Wails 桥接） |
| go | Go 后端包（安装、下载、回收站、YSM 解析等） |
| ui | 前端 UI 组件（tree、sidebar、preview、content） |
| feature | 业务功能（导入队列、同步、社区） |
| utils | 工具函数（display、fmt、dom、animation） |
| config | 配置与注册表（resource_types、AppConfig） |
