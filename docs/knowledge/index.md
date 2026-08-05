<!-- 本文件由 scripts/gen-knowledge-index.mjs 自动生成，禁止手改 -->

# 知识卡索引

> 总计: 69 张知识卡

## config（1 张）

*配置与注册表（resource_types、AppConfig）*

| 标识 | 名称 | tier |
|------|------|------|
| 🏗 resource-registry | 资源注册表 registry | architecture |

## core（5 张）

*核心基础设施（事件总线、页面状态、Wails 桥接）*

| 标识 | 名称 | tier |
|------|------|------|
| 🏗 event-bus | 事件总线 bus.ts | architecture |
| 🏗 global-handlers | 全局事件处理 global-handlers | architecture |
| 🏗 page-store | 页面状态管理 page-store.ts | architecture |
| 🍃 theme | 主题系统 theme | leaf |
| 🏗 wails-bridge | Wails 桥接 app.ts | architecture |

## feature（6 张）

*业务功能（导入队列、同步、社区）*

| 标识 | 名称 | tier |
|------|------|------|
| 🏗 community-feature | 社区下载 community | architecture |
| 🏗 import-queue | 导入队列 import-queue | architecture |
| 🍃 oldest-models | 资历最深模型 oldest-models | leaf |
| 🏗 recycle-bin | 回收站界面 recycle-bin | architecture |
| 🏗 resource-packs | 资源包功能 resource-packs | architecture |
| 🏗 version-updater | 版本更新 version-updater | architecture |

## go（25 张）

*Go 后端包（安装、下载、回收站、YSM 解析等）*

| 标识 | 名称 | tier |
|------|------|------|
| 🏗 go-avatar | 头像 go/avatar | architecture |
| 🏗 go-dedup | 去重 go/dedup | architecture |
| 🏗 go-download | 下载器 go/download | architecture |
| 🍃 go-errors | 错误包装 go/errors | leaf |
| 🏗 go-fileops | 文件操作 go/fileops | architecture |
| 🍃 go-fsutil | 文件遍历 go/fsutil | leaf |
| 🏗 go-geometry | Geometry 存档 go/geometry | architecture |
| 🏗 go-importer | 导入策略 go/importer | architecture |
| 🏗 go-installer | 模型安装 go/installer | architecture |
| 🏗 go-instance | 整合包实例 go/instance | architecture |
| 🏗 go-litematic | Litematic 解析 go/litematic | architecture |
| 🏗 go-logs | 导入日志 go/logs | architecture |
| 🏗 go-packs | 资源包 mcmeta go/packs | architecture |
| 🏗 go-paths | 路径安全 go/paths | architecture |
| 🏗 go-recycle | 回收站 go/recycle | architecture |
| 🏗 go-scanner | 扫描核心 go/scanner | architecture |
| 🏗 go-sync | 整合包同步 go/sync | architecture |
| 🏗 go-tags | 标签系统 go/tags | architecture |
| 🏗 go-threejs | 3D 骨骼 spec go/threejs | architecture |
| 🏗 go-types | 共享类型 go/types | architecture |
| 🏗 go-updater | 自动更新 go/updater | architecture |
| 🍃 go-version | 版本号 go/version | leaf |
| 🏗 go-watcher | 文件监听 go/watcher | architecture |
| 🏗 go-ysm-parser | YSM 解析 go/ysm | architecture |
| 🏗 wails-bindings | Wails Binding API 总览 internal/app | architecture |

## ui（17 张）

*前端 UI 组件（tree、sidebar、preview、content）*

| 标识 | 名称 | tier |
|------|------|------|
| 🏗 app-content | 主内容页 app-content | architecture |
| 🏗 app-modules | 组件入口 app-modules | architecture |
| 🍃 app-nav | 顶部导航 app-nav | leaf |
| 🏗 app-preview | 预览面板 app-preview | architecture |
| 🏗 app-resource-manager | 资源管理页 app-resource-manager | architecture |
| 🏗 app-sidebar | 侧边栏 app-sidebar | architecture |
| 🏗 app-sync-manager | 整合包同步页 app-sync-manager | architecture |
| 🍃 app-toast | Toast 通知 app-toast | leaf |
| 🏗 app-tree | 资源树 app-tree | architecture |
| 🏗 context-menu | 右键菜单系统 | architecture |
| 🍃 dialog-adv-filter | 高级筛选 adv-filter | leaf |
| 🏗 dialog-batch-rename | 批量重命名 batch-rename | architecture |
| 🏗 dialog-modal | 弹窗基座 modal | architecture |
| 🍃 dialog-rename | 重命名弹窗 rename | leaf |
| 🏗 dialog-tag-editor | 标签编辑器 tag-editor | architecture |
| 🍃 shared-styles | 共享样式 shared-styles | leaf |
| 🏗 test-utils | 测试工具 test-utils（G-1 抗脆弱测试基础设施） | architecture |

## utils（15 张）

*工具函数（display、fmt、dom、animation）*

| 标识 | 名称 | tier |
|------|------|------|
| 🏗 animation-system | 动画系统 animation | architecture |
| 🏗 model2d | 2D 预览渲染 model2d | architecture |
| 🏗 model3d | 3D 预览渲染 model3d | architecture |
| 🍃 utils-display | 文件名显示 display | leaf |
| 🍃 utils-dom | DOM 工具 dom | leaf |
| 🍃 utils-errors | 错误处理 errors | leaf |
| 🏗 utils-export | 截图与导出 export | architecture |
| 🍃 utils-extensions | 扩展名映射 extensions | leaf |
| 🍃 utils-fmt | 格式化工具 fmt | leaf |
| 🍃 utils-icon | 图标映射 icon | leaf |
| 🍃 utils-mc-format | MC 格式判定 mc-format | leaf |
| 🍃 utils-misc | 常量与调试 constants/debug | leaf |
| 🍃 utils-resource-types | 资源类型工具 resource-types | leaf |
| 🍃 utils-summarize | 摘要生成 summarize | leaf |
| 🏗 ysm-wasm | WASM 解析器 ysm-parser | architecture |

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
