# YSM 模型管理器 — 前端架构（新架构）

## 核心原则

**每个组件目录 = 1 个标签 + 1 个目录 + 若干文件，每文件 ≤ 80 行。**

```
app-tree/
├── index.js       # 生命周期编排（constructor → shadow → connected→disconnected）
├── tpl.js         # 布局级 HTML 模板（纯字符串，不做事件绑定）
├── row-tpl.js     # 节点级 HTML 模板（文件行/文件夹行等）
├── data.js        # 数据逻辑（纯函数，不碰 DOM，不写 this.shadowRoot）
├── render.js      # 渲染逻辑（输入数据 → 输出 HTML 字符串）
├── events.js      # 事件绑定（onclick / oninput / oncontextmenu）
└── utils.js       # 该组件特有的工具函数
```

## 三层解耦

```
index.js（编排）
  ├── data.js（纯数据，无 DOM）
  ├── render.js（HTML 生成，无事件）
  └── events.js（事件绑定，无模板）
       ↑ 引用
  tpl.js / row-tpl.js（纯 HTML 模板）
```

### 层间契约

| 文件        | 可以做的                    | 不可以做的            |
| ----------- | --------------------------- | --------------------- |
| `index.js`  | 调 render / bindEvents      | 不写业务逻辑          |
| `data.js`   | 数组操作、判断              | 不碰 DOM              |
| `render.js` | innerHTML / textContent     | 不写 addEventListener |
| `events.js` | addEventListener / bus.emit | 不拼 HTML             |
| `tpl.js`    | HTML 模板字符串             | 不做事件绑定          |

## 共享工具

```
js/utils/
├── display.js   # renderDisplayName（文件名渲染）
├── fmt.js       # 文件大小格式化
├── dom.js       # HTML 转义/搜索高亮
├── icon.js      # 文件图标映射
├── summarize.js # 模型摘要卡片 HTML
└── preview-cache.js # 预览缓存 FIFO（上限 50）
```

## 业务功能模块（独立于组件的功能）

```
js/features/
├── import-queue.js    # 拖拽导入队列
├── recycle-bin.js     # 回收站管理
├── oldest-models.js   # 仓库元老 + 健康度 + 今日推荐
├── version-updater.js # 自动更新
```

## 页面级初始化

```
js/pages/
├── repository.js      # 仓库页初始化（最初 loadOldestModel 曾在此）
```

## 服务注册

```
js/services/
└── registry.js        # 全局可替换服务注册
```

## 基础设施

```
js/core/
├── buttons.js         # 按钮绑定（旧入口，逐步废弃）
├── global-handlers.js # 全局事件入口
├── handler-dnd.js     # 拖拽导入
├── handler-sync.js    # 同步/安装
├── handler-upload.js  # 上传
├── handler-other.js   # 杂项
├── context-menus.js   # 右键菜单映射
└── theme.js           # 主题切换
```

## 当前组件状态

| 组件             | 位置              | 状态      | 文件数 | 总行数 |
| ---------------- | ----------------- | --------- | ------ | ------ |
| `<app-tree>`     | `app-tree/`       | ✅ 已拆   | 7 文件 | ~320   |
| `<app-sidebar>`  | `app-sidebar/`    | ✅ 已拆   | 6 文件 | ~230   |
| `<app-preview>`  | `app-preview/`    | ✅ 已拆   | 20 文件 | ~1,200 |
| `<app-content>`  | `app-content/`    | ✅ 已拆   | 8 文件 | ~1,000 |
| `<app-sync-manager>` | `app-sync-manager/` | ✅ 已拆 | 2 文件 | ~380 |
| `<app-resource-manager>` | `app-resource-manager/` | ✅ 已拆 | 2 文件 | ~150 |
| `<app-toast>`    | `app-toast.js`    | ✅ 已精简 | 1 文件 | 75     |
| `<app-nav>`      | `app-nav.js`      | ✅ 已精简 | 1 文件 | ~100   |
| `<context-menu>` | `context-menu.js` | ✅ 已精简 | 1 文件 | ~100   |

### 组件详细结构

#### `<app-tree>`
```
app-tree/
├── index.js       # 生命周期编排 (~7,915 行)
├── data.js        # 数据逻辑 (~967 行)
├── render.js      # 渲染逻辑 (~8,272 行)
├── events.js      # 事件绑定 (~8,330 行)
├── tpl.js         # HTML 模板 (~3,200 行)
├── loader.js      # 加载逻辑 (~1,775 行)
├── bus-handlers.js # 总线事件处理器 (~11,661 行)
├── toolbar-events.js # 工具栏事件 (~12,982 行)
├── authors.js     # 作者数据 (~345 行)
├── instance-actions.js # 实例操作 (~4,635 行)
├── utils.js       # 工具函数 (~515 行)
└── virtual-scroll.js # 虚拟滚动 (~1,225 行)
```

#### `<app-sidebar>`
```
app-sidebar/
├── index.js       # 生命周期编排 (~9,528 行)
├── data.js        # 数据逻辑 (~1,039 行)
├── render.js      # 渲染逻辑 (~764 行)
├── events.js      # 事件绑定 (~5,675 行)
├── loader.js      # 加载逻辑 (~4,926 行)
├── sidebar-css.js # 样式 (~764 行)
└── tpl.js         # HTML 模板 (~5,619 行)
```

#### `<app-preview>`
```
app-preview/
├── index.js           # 生命周期编排 (~20,853 行)
├── data.js            # 数据逻辑 (~182 行)
├── events.js          # 事件绑定 (~755 行)
├── preview-css.js     # 样式 (~10,806 行)
├── preview-3d.js      # 3D 渲染 (~8,718 行)
├── preview-actions.js # 预览操作 (~4,505 行)
├── preview-bone-export.js # 骨骼导出 (~1,743 行)
├── preview-detail.js  # 详情面板 (~6,340 行)
├── preview-loader.js  # 加载逻辑 (~3,165 行)
├── preview-logs.js    # 日志预览 (~2,002 行)
├── preview-pack.js    # 包预览 (~7,790 行)
├── preview-skeleton.js # 骨架屏 (~16,713 行)
├── preview-utils.js   # 工具函数 (~2,710 行)
├── preview-wasm.js    # WASM 解码 (~17,586 行)
├── preview-zoom.js    # 缩放预览 (~2,152 行)
├── render.js          # 渲染逻辑 (~438 行)
└── utils.js           # 工具函数 (~2,316 行)
```

#### `<app-content>`
```
app-content/
├── index.js              # 生命周期编排 (~31,127 行)
├── tpl.js                # HTML 模板 (~30,177 行)
├── content-css.js        # 样式 (~55,237 行)
├── community-core.js      # 社区核心 (~8,120 行)
├── community-settings.js # 设置 (~24,558 行)
├── community-diagnostics.js # 诊断 (~17,238 行)
├── community-site-view.js # 社区视图 (~45,125 行)
├── workshop-data.js      # 工坊数据 (~8,017 行)
├── workshop-icons.js     # 工坊图标 (~5,884 行)
```

#### `<app-sync-manager>`
```
app-sync-manager/
├── index.js       # 生命周期编排 (~374 行)
└── tpl.js         # HTML 模板 (~201 行)
```

#### `<app-resource-manager>`
```
app-resource-manager/
├── index.js       # 生命周期编排 (~13,253 行)
└── tpl.js         # HTML 模板 (~5,731 行)
```

### 共享工具

```
js/utils/
├── display.js      # 文件名渲染 (~4,722 行)
├── fmt.js          # 文件大小格式化 (~980 行)
├── dom.js          # HTML 转义/搜索高亮 (~681 行)
├── icon.js         # 文件图标映射 (~769 行)
├── summarize.js    # 模型摘要卡片 HTML (~10,207 行)
├── preview-cache.js # 预览缓存 FIFO (~2,054 行)
├── debug.js        # 调试工具 (~2,028 行)
├── errors.js       # 错误处理 (~2,378 行)
├── mc-format.js    # 模型格式化 (~2,649 行)
├── pack-format.js  # 包格式化 (~3,872 行)
├── model2d.js      # 2D 模型处理 (~17,608 行)
├── model3d.js      # 3D 模型处理 (~15,870 行)
├── model3d-spec.js # 3D 模型规范 (~6,499 行)
├── constants.js    # 常量 (~851 行)
├── extensions.js   # 扩展 (~1,339 行)
├── animation.js    # 动画 (~11,404 行)
├── animation-player.js # 动画播放 (~4,458 行)
├── animate.js      # 动画工具 (~1,654 行)
├── canvas-export.js # 画布导出 (~1,335 行)
└── model-preview.js # 模型预览 (~17,608 行)
```

### 业务功能模块

```
js/features/
├── import-queue.js    # 拖拽导入队列
├── recycle-bin.js     # 回收站管理
├── oldest-models.js   # 仓库元老 + 健康度 + 今日推荐
├── version-updater.js # 自动更新
```

### 页面级初始化

```
js/pages/
├── repository.js      # 仓库页初始化
```

### 服务注册

```
js/services/
└── registry.js        # 全局可替换服务注册
```

### 基础设施

```
js/core/
├── buttons.js         # 按钮绑定（旧入口，逐步废弃）
├── global-handlers.js # 全局事件入口
├── handler-dnd.js     # 拖拽导入
├── handler-sync.js    # 同步/安装
├── handler-upload.js  # 上传
├── handler-other.js   # 杂项
├── context-menus.js   # 右键菜单映射
└── theme.js           # 主题切换
```

## 近期架构变动

| 日期 | 变动                                      | 影响                                                                                             |
| ---- | ----------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 0611 | 👴 仓库元老从主菜单降级为仓库页 Tab       | `app-nav.js` 移除 "oldest" 项；`app-content/index.js` 移除路由；新建 `features/oldest-models.js` |
| 0611 | 🎨 创作者频道/🧩 创意工坊移除 🔄 刷新按钮 | `tpl.js` + `index.js` 分别移除按钮和事件绑定                                                     |
| 0611 | 🎲 今日推荐改为 3 卡片 + 移除定位/换一批  | `features/oldest-models.js` 重构 `renderPicks`                                                   |
| 0611 | 📅 热力图从周格子改为月柱子               | `features/oldest-models.js` 替换 `buildHeatmap` → `buildMonthHeatmap`                            |
| 0611 | 📊 健康度从独立卡片改为紧凑徽章           | `features/oldest-models.js` 内联到工具行                                                         |
| 0611 | 🧪 Go 测试框架搭建                        | `go/ysm/header_test.go`（14 用例）、`go/sync/sync_test.go`（6 用例）                             |
| 0611 | 🧪 CI 配置                                | `.github/workflows/release.yml`：push/pr 触发 `go test`，tag 触发 Wails 构建 + GitHub Release    |

## 新增组件检查清单

- [ ] 目录名与标签一致：`app-xxx/`
- [ ] 有 `index.js`（生命周期编排）
- [ ] 模板与数据分离（`data.js` 不碰 DOM）
- [ ] 通用工具引用 `js/utils/` 而非重写
- [ ] 所有新组件为 ESM（使用 `export`/`import`）
- [ ] 在 `app-modules.js` 中通过 `import` 引入，不在 `index.html` 加 `<script>` 标签
- [ ] 禁止在 `public/` 目录放置 JS 文件

## 构建与部署

参见 `.github/workflows/release.yml`。

流程：

1. `go vet ./go/...` — 静态检查
2. `go test ./go/... -count=1` — 单元测试
3. `wails build -clean` — 编译 exe
4. 打包 ZIP → GitHub Release（仅 tag 触发）

## CI/CD

CI 在 GitHub Actions 中运行（`.github/workflows/release.yml`）：

- **push/pr 到 main**：Go vet + Go test
- **tag v\***：上述 + Wails 构建 + 打包 + GitHub Release 上传

## 参考

- 旧版代码：`frontend/js/legacy/`（已清理）
- 事件总线：`frontend/js/bus.js`（ESM 导出 + `window.bus` 兼容）
- Vite 构建：`frontend/vite.config.js`
- 发版脚本：`build-release.ps1`
- 集成测试：`scripts/smoke-test.ps1`
- 事故复盘：`docs/postmortem-*.md`
