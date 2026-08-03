<!-- 本文件由 scripts/gen-knowledge-index.mjs 自动生成，禁止手改 -->

# 知识卡索引

> 总计: 65 张知识卡

## config（1 张）

*配置与注册表（resource_types、AppConfig）*

| 标识 | 名称 | tier |
|------|------|------|
| 🏗 resource_registry | 资源注册表 registry | architecture |

## core（5 张）

*核心基础设施（事件总线、页面状态、Wails 桥接）*

| 标识 | 名称 | tier |
|------|------|------|
| 🏗 event_bus | 事件总线 bus.ts | architecture |
| 🏗 global_handlers | 全局事件处理 global-handlers | architecture |
| 🏗 page_store | 页面状态管理 page-store.ts | architecture |
| 🍃 theme | 主题系统 theme | leaf |
| 🏗 wails_bridge | Wails 桥接 app.ts | architecture |

## feature（6 张）

*业务功能（导入队列、同步、社区）*

| 标识 | 名称 | tier |
|------|------|------|
| 🏗 community_feature | 社区下载 community | architecture |
| 🏗 import_queue | 导入队列 import-queue | architecture |
| 🍃 oldest_models | 资历最深模型 oldest-models | leaf |
| 🏗 recycle_bin | 回收站界面 recycle-bin | architecture |
| 🏗 resource_packs | 资源包功能 resource-packs | architecture |
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

## ui（16 张）

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
| 🍃 dialog_adv_filter | 高级筛选 adv-filter | leaf |
| 🏗 dialog_batch_rename | 批量重命名 batch-rename | architecture |
| 🏗 dialog_modal | 弹窗基座 modal | architecture |
| 🍃 dialog_rename | 重命名弹窗 rename | leaf |
| 🏗 dialog_tag_editor | 标签编辑器 tag-editor | architecture |
| 🍃 shared_styles | 共享样式 shared-styles | leaf |

## utils（15 张）

*工具函数（display、fmt、dom、animation）*

| 标识 | 名称 | tier |
|------|------|------|
| 🏗 animation_system | 动画系统 animation | architecture |
| 🏗 model2d | 2D 预览渲染 model2d | architecture |
| 🏗 model3d | 3D 预览渲染 model3d | architecture |
| 🍃 utils_display | 文件名显示 display | leaf |
| 🍃 utils_dom | DOM 工具 dom | leaf |
| 🍃 utils_errors | 错误处理 errors | leaf |
| 🏗 utils_export | 截图与导出 export | architecture |
| 🍃 utils_extensions | 扩展名映射 extensions | leaf |
| 🍃 utils_fmt | 格式化工具 fmt | leaf |
| 🍃 utils_icon | 图标映射 icon | leaf |
| 🍃 utils_mc_format | MC 格式判定 mc-format | leaf |
| 🍃 utils_misc | 常量与调试 constants/debug | leaf |
| 🍃 utils_resource_types | 资源类型工具 resource-types | leaf |
| 🍃 utils_summarize | 摘要生成 summarize | leaf |
| 🏗 ysm_wasm | WASM 解析器 ysm-parser | architecture |

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
