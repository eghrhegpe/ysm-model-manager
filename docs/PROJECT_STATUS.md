# YSM 模型管理器 — 项目状态文档

更新时间：2026-06-16

---

## ✅ 已完成的核心改动（v1.3.0+）

| 模块 | 改动 | 关键文件 |
|------|------|----------|
| **配置内存缓存** | 双检锁 + `saveConfig()` 统一写入点，零前端改动 | `app.go` `app_config.go` `resource_bindings.go` |
| **下载系统重构** | 模块级单例 `STATE` + 观察者模式，解决切页断连 | `download-queue.js` `app_download.go` |
| **SVG 图标系统** | 13 个 SVG 替换 emoji，`workshop-icons.js` 统一管理 | `workshop-icons.js` `content-css.js` |
| **GitHub 仓库页重构** | CSS Grid 布局、状态徽章、头部三行结构 | `community-site-view.js` `content-css.js` `components.css` |
| **Overlay CSS 作用域修复** | 从 Shadow DOM 移到 Light DOM 全局样式 | `content-css.js` `components.css` |
| **A 类修复** | `saveConfig` 加 `os.MkdirAll`、avatar `onerror` 兜底防注入 | `resource_bindings.go:185-195` `community-site-view.js:52,471` |
| **错误处理** | `errors.js` 正则修复 `/network\|proxy\|fetch/i` | `errors.js:28` |
| **代码审计修复** | 删 O(n²) 死代码、修正误导文案、空 catch 加日志 | `render.js` `events.js` `community-core.js` |

---

## 🔧 本轮新增（头像增量刷新机制）

| 场景 | 触发 | 实现 |
|------|------|------|
| **A：下载完成刷新头像** | `queue:file-done` 解析 `[作者]` → 增量提取 → `bus.emit("avatar:refresh")` | `download-queue.js:157-179` |
| **B：配置加载后重新提取** | `window.runtime.EventsOn("config-loaded")` → `extractAvatars()` 重跑 | `index.js:403-432` |
| **防重复注册** | `window.__avatarConfigLoadedRegistered` + `this._avatarRefreshRegistered` | `index.js:426,565,75` |

---

## ⚠️ 已知遗留问题

| 问题 | 位置 | 影响 | 备注 |
|------|------|------|------|
| `GetRepoRoot("")` 返回 `""` | `resource_bindings.go:210-220` | 仓库页"全部"标签跨类型搜索失效 | 需在 `default:` 分支后加 `return cfg.FilesRoot` |
| 创作者详情 Overlay UX | 第三方评审建议 | 视觉锚点、交互细节待打磨 | 低优，CSS 不给免费 AI 动 |
| 单卡片头像增量更新 | `showSiteView()` 会整页重渲 | 下载完成会有闪烁 | 后续可优化为按 `data-name` 定点替换 `<img>` |

---

## 📁 关键文件结构

```
frontend/
├── js/
│   ├── components/app-content/
│   │   ├── index.js              # 主组件、workshop 初始化、事件总线
│   │   ├── community-site-view.js # 站点/创作者/模型渲染、Overlay
│   │   ├── workshop-icons.js      # 13 个 SVG 图标
│   │   └── content-css.js         # Shadow DOM 样式
│   ├── features/community/
│   │   ├── download-queue.js      # 下载队列、持久化 STATE、avatar 增量提取
│   │   ├── render.js              # 网格布局渲染
│   │   ├── events.js              # 交互事件绑定
│   │   └── community-core.js      # 核心数据加载
│   ├── bus.js                     # 进程内事件总线
│   └── utils/errors.js            # 错误友好提示
├── css/components.css             # Light DOM 全局样式
└── wailsjs/go/main/App.js         # Go→TS 绑定（自动生成）
```

```go
// 核心 Go 文件
app.go                    # 启动、配置缓存、config-loaded emit
app_config.go             # LoadAppConfig/SaveAppConfig（缓存优先）
app_download.go           # QueueStatus、context.Context 取消
app_avatar.go             # BatchExtractCreatorAvatars、CachedCreatorAvatar、DebugExtractCreatorAvatar
resource_bindings.go      # saveConfig、GetRepoRoot("") bug 点
```

---

## 🎯 下一步可选方向

1. **修 `GetRepoRoot("")`** — 1 行改动，解锁仓库页"全部"标签跨类型搜索
2. **Overlay UX 微调** — 按第三方评审清单逐项改（需人工把关 CSS）
3. **单卡片头像更新** — `avatar:refresh` 监听器里按 `data-name` 定点替换，避免整页闪烁
4. **发版** — `wails build -clean`、打 Git tag、写更新报告