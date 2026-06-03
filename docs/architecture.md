# 代码结构

> 带 `*` 的是 Wails 构建工具/缓存自动生成的，**不要手动编辑**。
> 所有手写源码都在 `frontend/`、`go/`、`app.go` 和配置文件里。

```
ysm-model-manager/
├── app.go                     ← Go 后端主文件（Wails App struct + 所有 Binding）
├── main.go                    ← Go 入口
├── wails.json                 ← Wails 项目配置 + Binding 注册列表
├── go.mod / go.sum            ← Go 模块依赖
│
├── go/                        ← Go 工具包
│   ├── installer/             ← 安装/复制/链接逻辑
│   ├── logs/                  ← 导入日志
│   ├── recycle/               ← 回收站操作
│   ├── sync/                  ← 同步状态
│   ├── types/                 ← 共享数据类型
│   └── ysm/                   ← YSM 模组检测
│
├── frontend/                  ← ★ 前端手写源码目录
│   ├── index.html             ← 主页面 HTML
│   ├── style.css              ← 全局样式覆盖
│   ├── css/
│   │   ├── variables.css      ← CSS 变量（主题色/尺寸）
│   │   ├── layout.css         ← 三栏布局
│   │   ├── components.css     ← 组件样式（树/卡片/按钮/搜索）
│   │   └── scrollbar.css      ← 滚动条样式
│   ├── js/
│   │   ├── lib/
│   │   │   ├── parse.js       ← esc / fmt / parseModelName / isBannedEntry / safeCall
│   │   │   ├── state.js       ← 全局变量 + DOM 引用 + localStorage 工具
│   │   │   └── tree.js        ← buildTree 仓库树渲染（含复选框 启用/禁用）
│   │   ├── core/
│   │   │   ├── theme.js       ← 主题切换 + initTheme
│   │   │   ├── directories.js ← 目录选择 + saveConfig
│   │   │   ├── lifecycle.js   ← loadAll / autoDetect / updateInstallBtn
│   │   │   ├── buttons.js     ← 按钮事件绑定
│   │   │   └── sync.js        ← doSyncAll / doSyncMissing / doDeduplicate
│   │   ├── ui/
│   │   │   ├── cm-utils.js    ← createMenu / renderMenuItems
│   │   │   ├── cm-tree.js     ← 仓库树右键菜单（含 启用/禁用）
│   │   │   ├── cm-version.js  ← 整合包右键菜单（卸载/上传/去重）
│   │   │   ├── contextmenu.js ← 右键入口
│   │   │   ├── drop.js        ← 拖拽导入 + 树内移动
│   │   │   └── toggle.js      ← 侧栏/预览折叠
│   │   ├── dialogs/
│   │   │   ├── confirm.js     ← showConfirm / showToast
│   │   │   ├── logs.js        ← openLogDialog
│   │   │   ├── recycle.js     ← openRecycleDialog
│   │   │   ├── settings.js    ← openSettingsDialog
│   │   │   └── summary.js     ← showSummaryDialog
│   │   └── versions/
│   │       ├── data.js        ← filterInstances / sortInstances / calcVersionCounts
│   │       ├── stats.js       ← updateVersionStats
│   │       ├── renderer.js    ← renderVersionCard / createSection
│   │       ├── events.js      ← bindVersionEvents / toggleVersionCard
│   │       ├── ops.js         ← handleInstall / handleSyncBack
│   │       └── versions.js    ← renderVersions / refreshAll
│   └── wailsjs/               ← * Wails 自动生成的 JS Binding
│       └── go/main/
│           ├── App.d.ts
│           └── App.js
│
├── html/                      ← * Wails 构建产物（不要编辑）
│   ├── index.html             ← * 构建后的合并 HTML
│   └── assets/
│       ├── index.f4fc0296.css ← * 合并/压缩后的 CSS
│       └── index.c9e23f9d.css ← * 旧版压缩 CSS
│
├── build/                     ← * Wails 构建输出
│   └── bin/                   ← * 编译后的 EXE
│
├── docs/                      ← 文档
│   ├── intro.md               ← 项目简介 + 已完成功能
│   ├── architecture.md        ← 代码结构
│   ├── roadmap.md             ← 待实现 + 路线图
│   └── dev-notes.md           ← 开发笔记 + 已知问题
│
├── README.md                  ← 项目入口导航
└── ysm_config.json            ← * 运行时生成的配置文件
```
