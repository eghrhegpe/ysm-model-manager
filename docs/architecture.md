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
| `<app-preview>`  | `app-preview/`    | ✅ 已拆   | 6 文件 | ~780   |
| `<app-content>`  | `app-content/`    | ✅ 已拆   | 4 文件 | ~410   |
| `<app-toast>`    | `app-toast.js`    | ✅ 已精简 | 1 文件 | 75     |
| `<app-nav>`      | `app-nav.js`      | ✅ 已精简 | 1 文件 | ~100   |
| `<context-menu>` | `context-menu.js` | ✅ 已精简 | 1 文件 | ~100   |

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
