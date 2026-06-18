# YSM 模型管理器 — 前端架构规范

## 核心原则

**每个组件目录 = 1 个标签 + 1 个目录 + 若干文件，每文件 ≤ 80 行（理想状态）。**

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

---

## 当前组件状态

| 组件 | 位置 | 状态 | 文件数 | 总行数 |
|------|------|------|--------|--------|
| `<app-tree>` | `app-tree/` | ✅ 已拆 | 13 文件 | ~1,953 |
| `<app-sidebar>` | `app-sidebar/` | ✅ 已拆 | 8 文件 | ~858 |
| `<app-preview>` | `app-preview/` | ✅ 已拆 | 18 文件 | ~2,691 |
| `<app-content>` | `app-content/` | ✅ 已拆 | 9 文件 | ~4,923 |
| `<app-sync-manager>` | `app-sync-manager/` | ✅ 已拆 | 2 文件 | ~575 |
| `<app-resource-manager>` | `app-resource-manager/` | ✅ 已拆 | 2 文件 | ~370 |
| `<app-toast>` | `app-toast.js` | ✅ 已精简 | 1 文件 | ~75 |
| `<app-nav>` | `app-nav.js` | ✅ 已精简 | 1 文件 | ~100 |
| `<context-menu>` | `context-menu.js` | ✅ 已精简 | 1 文件 | ~100 |

### 组件详细结构

#### `<app-tree>` (~1,953 行)
```
app-tree/
├── index.js              # 生命周期编排 (243 行)
├── data.js               # 数据逻辑 (30 行)
├── render.js             # 渲染逻辑 (262 行)
├── events.js             # 事件绑定 (267 行)
├── tpl.js                # HTML 模板 (36 行)
├── row-tpl.js            # 行模板 (79 行)
├── loader.js             # 加载逻辑 (52 行)
├── bus-handlers.js       # 总线事件处理器 (384 行)
├── toolbar-events.js     # 工具栏事件 (395 行)
├── authors.js            # 作者数据 (14 行)
├── instance-actions.js   # 实例操作 (143 行)
├── utils.js              # 工具函数 (14 行)
└── virtual-scroll.js     # 虚拟滚动 (34 行)
```

#### `<app-sidebar>` (~858 行)
```
app-sidebar/
├── index.js       # 生命周期编排 (277 行)
├── data.js        # 数据逻辑 (45 行)
├── render.js      # 渲染逻辑 (28 行)
├── events.js      # 事件绑定 (161 行)
├── loader.js      # 加载逻辑 (151 行)
├── actions.js     # 操作函数 (51 行)
├── sidebar-css.js # 样式 (57 行)
└── tpl.js         # HTML 模板 (88 行)
```

#### `<app-preview>` (~2,504 行)
```
app-preview/
├── index.js              # 生命周期编排 (521 行)
├── data.js               # 数据逻辑 (3 行)
├── events.js             # 事件绑定 (23 行)
├── render.js             # 渲染逻辑 (10 行)
├── tpl.js                # HTML 模板 (141 行)
├── preview-css.js        # 样式 (136 行)
├── preview-actions.js    # 预览操作 (128 行)
├── preview-bone-export.js # 骨骼导出 (43 行)
├── preview-detail.js     # 详情面板 (116 行)
├── preview-loader.js     # 加载逻辑 (89 行)
├── preview-logs.js       # 日志预览 (54 行)
├── preview-pack.js       # 包预览 (201 行)
├── preview-skeleton.js   # 骨架屏 + 3D 调用 (391 行)
├── preview-utils.js      # 工具函数 (73 行)
├── preview-wasm.js       # WASM 解码 (488 行)
├── preview-zoom.js       # 缩放预览 (66 行)
└── utils.js              # 工具函数 (67 行)
```
> 注：`preview-3d.js` 已删除（死代码，零引用），3D 功能由 `preview-skeleton.js` 调用 `utils/model3d-loader.js` 实现

#### `<app-content>` (~4,923 行)
```
app-content/
├── index.js                 # 生命周期编排 (817 行)
├── tpl.js                   # HTML 模板 (515 行)
├── content-css.js           # 样式 (862 行)
├── community-core.js        # 社区核心 (249 行)
├── community-settings.js    # 设置 (690 行)
├── community-diagnostics.js # 诊断 (461 行)
├── community-site-view.js   # 社区视图 (1,206 行)
├── workshop-data.js         # 工坊数据 (71 行)
└── workshop-icons.js        # 工坊图标 (53 行)
```

#### `<app-sync-manager>` (~575 行)
```
app-sync-manager/
├── index.js       # 生命周期编排 (374 行)
└── tpl.js         # HTML 模板 (201 行)
```

#### `<app-resource-manager>` (~370 行)
```
app-resource-manager/
├── index.js       # 生命周期编排 (240 行)
└── tpl.js         # HTML 模板 (130 行)
```

---

## 共享工具

```
js/utils/ (~3,428 行)
├── display.js            # 文件名渲染 (151 行)
├── fmt.js                # 文件大小格式化 (28 行)
├── dom.js                # HTML 转义/搜索高亮 (21 行)
├── icon.js               # 文件图标映射 (23 行)
├── summarize.js          # 模型摘要卡片 HTML (167 行)
├── preview-cache.js      # 预览缓存 FIFO (75 行)
├── debug.js              # 调试工具 + debugGetSpec (56 行)
├── errors.js             # 错误处理 (49 行)
├── mc-format.js          # MC 格式化 (91 行)
├── pack-format.js        # 包格式化 (134 行)
├── model2d.js            # 2D 模型处理 (519 行)
├── model3d.js            # 3D 实时渲染 + buildSceneMesh 导出 (~300 行)
├── model3d-loader.js     # 纹理加载 + spec 调用 + preloadModel (~90 行)
├── screenshot-renderer.js # 无头截图 + 批量截图 (~100 行)
├── model3d-spec.js       # 3D 模型规范 (240 行)
├── constants.js          # 常量 (25 行)
├── extensions.js         # 扩展 (43 行)
├── animation.js          # 动画 (326 行)
├── animation-player.js   # 动画播放 (165 行)
├── animate.js            # 动画工具 (46 行)
├── canvas-export.js      # 画布导出 (36 行)
├── stagger.js            # 交错动画 (11 行)
├── resource-types.js     # 资源类型 (17 行)
├── fmt.test.js           # fmt 测试 (36 行)
└── dom.test.js           # dom 测试 (28 行)
```

---

## 业务功能模块

```
js/features/ (~2,216 行)
├── import-queue.js      # 拖拽导入队列 (792 行)
├── recycle-bin.js       # 回收站管理 (199 行)
├── oldest-models.js     # 仓库元老 + 健康度 + 今日推荐 (308 行)
├── version-updater.js   # 自动更新 (152 行)
├── resource-packs.js    # 资源包管理 (29 行)
├── dnd-state.js         # 拖拽状态 (31 行)
└── community/           # 社区功能子模块 (~1,146 行)
    ├── data.js          # 社区数据 (177 行)
    ├── download-queue.js # 下载队列 (465 行)
    ├── events.js        # 社区事件 (245 行)
    ├── render.js        # 社区渲染 (227 行)
    └── data.test.js     # 社区数据测试 (32 行)
```

---

## 基础设施

```
js/core/ (~1,391 行)
├── context-menus.js   # 右键菜单映射 (510 行)
├── handler-dnd.js     # 拖拽导入 (252 行)
├── handler-sync.js    # 同步/安装 (289 行)
├── handler-upload.js  # 上传 (83 行)
├── handler-other.js   # 杂项 (168 行)
├── theme.js           # 主题切换 (55 行)
├── global-handlers.js # 全局事件入口 (16 行)
└── page-store.js      # 页面状态存储 (18 行)
```

---

## 页面级初始化

```
js/pages/
└── repository.js      # 仓库页初始化
```

---

## 服务注册

```
js/services/
└── registry.js        # 全局可替换服务注册
```

---

## 事件总线

```
js/bus.js              # ESM 导出 + window.bus 兼容
```

---

## 近期架构变动

| 日期 | 变动 | 影响 |
|------|------|------|
| 2026-06-16 | v1.7.8 头像增量刷新机制 | `download-queue.js` 新增 `queue:file-done` 解析作者 + `bus.emit("avatar:refresh")`；`app-content/index.js` 新增 `extractAvatars()` + `config-loaded` 监听 + `avatar:refresh` 监听 |
| 2026-06-16 | v1.7.7 单卡片头像定点更新 | `avatar:refresh` 监听改为按 `dataset.name` 定位卡片，避免整页重渲染 |
| 2026-06-16 | v1.7.6/7 动画系统 | `components.css` 新增对话框/按钮/页面动画；`.no-animations` 无障碍覆盖 |
| 2026-06-16 | v1.7.5 调试代码清理 | 清理 16 处遗留 console.log / fmt.Printf |
| 2026-06-16 | v1.7.5 暗色模式自动切换 | `matchMedia('change')` 监听 + toast 提示 |
| 2026-06-16 | v1.7.5 右键打开文件位置 | Go 端新增 `RevealInExplorer` binding |
| 2026-06-15 | v1.7.4 社区站点视图迁移至 Go 后端 | 移除前端硬编码数据，改为 Go binding 读取 JSON |
| 2026-06-11 | 👴 仓库元老从主菜单降级为仓库页 Tab | `app-nav.js` 移除 "oldest" 项；`app-content/index.js` 移除路由；新建 `features/oldest-models.js` |
| 2026-06-11 | 🎨 创作者频道/🧩 创意工坊移除 🔄 刷新按钮 | `tpl.js` + `index.js` 分别移除按钮和事件绑定 |
| 2026-06-11 | 🎲 今日推荐改为 3 卡片 + 移除定位/换一批 | `features/oldest-models.js` 重构 `renderPicks` |
| 2026-06-11 | 📅 热力图从周格子改为月柱子 | `features/oldest-models.js` 替换 `buildHeatmap` → `buildMonthHeatmap` |
| 2026-06-11 | 📊 健康度从独立卡片改为紧凑徽章 | `features/oldest-models.js` 内联到工具行 |
| 2026-06-11 | 🧪 Go 测试框架搭建 | `go/ysm/header_test.go`（14 用例）、`go/sync/sync_test.go`（6 用例） |
| 2026-06-11 | 🧪 CI 配置 | `.github/workflows/release.yml`：push/pr 触发 `go test`，tag 触发 Wails 构建 + GitHub Release |

---

## 新增组件检查清单

- [ ] 目录名与标签一致：`app-xxx/`
- [ ] 有 `index.js`（生命周期编排）
- [ ] 模板与数据分离（`data.js` 不碰 DOM）
- [ ] 通用工具引用 `js/utils/` 而非重写
- [ ] 所有新组件为 ESM（使用 `export`/`import`）
- [ ] 在 `app-modules.js` 中通过 `import` 引入，不在 `index.html` 加 `<script>` 标签
- [ ] 禁止在 `public/` 目录放置 JS 文件

---

## 构建与部署

参见 `.github/workflows/release.yml`。

流程：

1. `go vet ./go/...` — 静态检查
2. `go test ./go/... -count=1` — 单元测试
3. `wails build -clean` — 编译 exe
4. 打包 ZIP → GitHub Release（仅 tag 触发）

---

## CI/CD

CI 在 GitHub Actions 中运行（`.github/workflows/release.yml`）：

- **push/pr 到 main**：Go vet + Go test
- **tag v\***：上述 + Wails 构建 + 打包 + GitHub Release 上传

---

## 参考

- 事件总线：`frontend/js/bus.js`（ESM 导出 + `window.bus` 兼容）
- Vite 构建：`frontend/vite.config.js`
- 发版脚本：`build-release.ps1`
- 集成测试：`scripts/smoke-test.ps1`
- 事故复盘：`docs/postmortem-*.md`（已归档至 `docs/archive/`）
