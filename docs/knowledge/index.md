<!-- 本文件由 scripts/gen-knowledge-index.mjs 自动生成，禁止手改 -->

# 知识卡索引

> 总计: 43 张知识卡

## config（1 张）

*配置与注册表（resource_types、AppConfig）*

| 标识 | 名称 | tier |
|------|------|------|
| 🏗 resource_registry | 资源注册表 registry | architecture |

## core（3 张）

*核心基础设施（事件总线、页面状态、Wails 桥接）*

| 标识 | 名称 | tier |
|------|------|------|
| 🏗 event_bus | 事件总线 bus.ts | architecture |
| 🏗 page_store | 页面状态管理 page-store.ts | architecture |
| 🏗 wails_bridge | Wails 桥接 app.ts | architecture |

## feature（3 张）

*业务功能（导入队列、同步、社区）*

| 标识 | 名称 | tier |
|------|------|------|
| 🏗 import_queue | 导入队列 import-queue | architecture |
| 🏗 recycle_bin | 回收站界面 recycle-bin | architecture |
| 🏗 version_updater | 版本更新 version-updater | architecture |

## go（22 张）

*Go 后端包（安装、下载、回收站、YSM 解析等）*

| 标识 | 名称 | tier |
|------|------|------|
| 🏗 go_avatar | 头像 go/avatar | architecture |
| 🏗 go_dedup | 去重 go/dedup | architecture |
| 🏗 go_download | 下载器 go/download | architecture |
| 🍃 go_errors | 错误包装 go/errors | leaf |
| 🍃 go_fsutil | 文件遍历 go/fsutil | leaf |
| 🏗 go_geometry | Geometry 存档 go/geometry | architecture |
| 🏗 go_importer | 导入策略 go/importer | architecture |
| 🏗 go_installer | 模型安装 go/installer | architecture |
| 🏗 go_litematic | Litematic 解析 go/litematic | architecture |
| 🏗 go_logs | 导入日志 go/logs | architecture |
| 🏗 go_packs | 资源包 mcmeta go/packs | architecture |
| 🏗 go_paths | 路径安全 go/paths | architecture |
| 🏗 go_recycle | 回收站 go/recycle | architecture |
| 🏗 go_sync | 整合包同步 go/sync | architecture |
| 🏗 go_tags | 标签系统 go/tags | architecture |
| 🏗 go_threejs | 3D 骨骼 spec go/threejs | architecture |
| 🏗 go_types | 共享类型 go/types | architecture |
| 🏗 go_updater | 自动更新 go/updater | architecture |
| 🍃 go_version | 版本号 go/version | leaf |
| 🏗 go_watcher | 文件监听 go/watcher | architecture |
| 🏗 go_ysm_parser | YSM 解析 go/ysm | architecture |
| 🏗 wails_bindings | Wails Binding API 总览 internal/app | architecture |

## ui（10 张）

*前端 UI 组件（tree、sidebar、preview、content）*

| 标识 | 名称 | tier |
|------|------|------|
| 🏗 app_content | 主内容页 app-content | architecture |
| 🏗 app_modules | 组件入口 app-modules | architecture |
| 🍃 app_nav | 顶部导航 app-nav | leaf |
| 🏗 app_preview | 预览面板 app-preview | architecture |
| 🏗 app_resource_manager | 资源管理页 app-resource-manager | architecture |
| 🏗 app_sidebar | 侧边栏 app-sidebar | architecture |
| 🏗 app_sync_manager | 整合包同步页 app-sync-manager | architecture |
| 🍃 app_toast | Toast 通知 app-toast | leaf |
| 🏗 app_tree | 资源树 app-tree | architecture |
| 🏗 context_menu | 右键菜单系统 | architecture |

## utils（4 张）

*工具函数（display、fmt、dom、animation）*

| 标识 | 名称 | tier |
|------|------|------|
| 🍃 utils_display | 文件名显示 display | leaf |
| 🍃 utils_dom | DOM 工具 dom | leaf |
| 🍃 utils_fmt | 格式化工具 fmt | leaf |
| 🍃 utils_icon | 图标映射 icon | leaf |

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
