# YSM 模型管理器 — 项目现状汇总

更新时间：2026-06-16  
当前版本：**v1.7.8**  
最近提交：`4abc76e v1.7.8 - 创作者频道头像提取优化 + 动画补齐`

---

## 📝 今日工作记录（2026-06-16）

### 代码改动
| 任务 | 文件 | 说明 |
|------|------|------|
| 头像增量刷新 - 场景 A | `download-queue.js:157-179` | `queue:file-done` 解析 `[作者]` → `CachedCreatorAvatar` → miss 则 `DebugExtractCreatorAvatar` → `bus.emit("avatar:refresh")` |
| 头像增量刷新 - 场景 B | `app-content/index.js:403-432` | 提取 `extractAvatars()` 函数 + `window.runtime.EventsOn("config-loaded")` 监听 |
| 头像定点更新 | `app-content/index.js:564-574` | `bus.on("avatar:refresh")` 按 `dataset.name` 定位卡片，只替换 `<img>.src` |
| 防重复注册 | `app-content/index.js:426,565,75` | `window.__avatarConfigLoadedRegistered` + `this._avatarRefreshRegistered` |

### 文档整理
| 任务 | 说明 |
|------|------|
| 创建 `docs/README.md` | 开发者文档索引，分类列出核心架构、问题排查、发版记录、参考数据等 |
| 归档旧文档 | 将 postmortem、Continue、dev-notes、plan、audit、refactor 等历史文档移至 `docs/archive/` |
| 创建 `docs/ANNUAL_ROADMAP.md` | 年度规划大纲（英文，德系简约风） |
| 修正 `docs/architecture.md` | 修复行数统计错误（原声称 31,127 行，实际 817 行），补充 v1.7.x 架构变动 |
| 恢复 `docs/pack-format-versions.md` | 从 archive 移回根目录（活跃维护文档） |
| 归档 `YSM-UI-Translation-Plan.md` | 修正错误描述后归档（项目为中文原生，非英文） |

### 术语梳理
- 识别核心名词混用：仓库/整合包/实例/资源类型/创作者/作者
- 识别过长/歧义文案：toast 消息、按钮标签、占位符
- 建议创建 `docs/TERMINOLOGY.md`（用户可能已创建）

### 其他
- 解答 OpenCode + Oh My OpenCode 概念
- 审查 pack_format 版本映射文档归档问题

---

### 其他 AI 协作产出

| 文档 | 产出者 | 内容 |
|------|--------|------|
| `docs/TERMINOLOGY.md` | Big Pickle / DeepSeek | 术语对照表：核心名词、UI 文案修剪、语感统一、AI 缩写版 |
| `docs/CLEANUP_RULES.md` | Big Pickle | 治理规则清单：9 条规则 × severity × 检测方式 + 检测命令速查 |
| `docs/DEPRECATED_NAMES.md` | Big Pickle | 废弃别名对照表 + PowerShell 批量替换脚本 |
| `docs/ui-improvement-plan.md` | Gemini | UI 修改计划：P0-P2 优先级 + 仓库元老页优化 + 执行记录 |
| `docs/animation-roadmap.md` | Gemini | 动画路线图：统一 keyframe、stagger 系统、设计令牌、已完成清单 |
| `docs/animations.md` | Gemini | 前端动画系统文档：11 种动画清单 + 无障碍支持 + 性能考量 + 文件索引 |
| `docs/pack-format-versions.md` | zuogeren (PR #7) | Minecraft `pack_format` 编号 ↔ 游戏版本映射表（88 条） |

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
| **GetRepoRoot 空类型修复** | `rtype == ""` 时返回 `cfg.FilesRoot`，解锁跨类型搜索 | `resource_bindings.go:69-87` ✅ v1.7.7 |
| **动画系统** | 对话框、按钮、页面切换、预览面板、设置面板、同步管理器列表、回收站等全量动画 | v1.7.6 / v1.7.7，共 18+ 文件 |
| **调试代码清理** | v1.7.4 遗留 16 处日志、fmt.Printf 已清 | v1.7.5 |
| **暗色模式自动切换** | `matchMedia('change')` 监听，跟随 OS 自动切换 | v1.7.5 |
| **右键打开文件位置** | Go 端新增 `RevealInExplorer` | v1.7.5 |

---

## 🔧 本轮新增（v1.7.8）

| 场景 | 触发 | 实现 |
|------|------|------|
| **A：下载完成刷新头像** | `queue:file-done` 解析 `[作者]` → 增量提取 → `bus.emit("avatar:refresh")` | `download-queue.js:157-179` |
| **B：配置加载后重新提取** | `window.runtime.EventsOn("config-loaded")` → `extractAvatars()` 重跑 | `app-content/index.js:403-432` |
| **C：单卡片头像定点更新** | `avatar:refresh` 按 `dataset.name` 定位卡片，只替换 `<img>.src` | `app-content/index.js:564-574` ✅ v1.7.7/8 |
| **防重复注册** | `window.__avatarConfigLoadedRegistered` + `this._avatarRefreshRegistered` | `index.js:426,565,75` |
| **创作者频道动画补齐** | 列表 stagger 入场、空状态淡入、骨架屏 shimmer、hover 过渡 | `.sm-*` / `.cr-*` class |

---

## ⚠️ 已知遗留问题

| 问题 | 位置 | 影响 | 优先级 |
|------|------|------|--------|
| 创作者详情 Overlay UX | 第三方评审建议 | 视觉锚点、交互细节待打磨 | 低（CSS 不给免费 AI 动） |
| 术语/文案未统一 | 全项目 | 仓库/整合包/实例/资源类型混用 | **中**（已梳理术语表，待落地 `docs/TERMINOLOGY.md`） |
| model2d 预览缓存 | `preview-cache.js` | 社区仓库重复解析浪费 CPU | **中**，但**暂缓**：多模态辅助下 Three.js canvas 序列化/失效复杂，当前瓶颈不在预览 |
| 列表/网格视图切换 | `app-tree` | 仅卡片视图，缺紧凑列表 | **低**（P3 新功能，动画 P0-P1 做完再考虑） |

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
resource_bindings.go      # saveConfig、GetRepoRoot
```

---

## 🎯 下一步可选方向

1. **落地 `docs/TERMINOLOGY.md` 术语表** — 规范团队/AI 协作用词，统一文案
2. **Overlay UX 微调** — 按第三方评审清单逐项改（需人工把关 CSS）
3. **model2d 预览缓存** — 扩展现有 `preview-cache.js`，复用骨骼图避免重复解析
4. **列表/网格视图切换** — 工具栏加 🗂/☰ 切换、紧凑行模板、`localStorage` 持久化
5. **前端测试覆盖扩展** — 当前 30 个测试（fmt/dom/data），后续覆盖 download-queue / render.js / 事件总线
6. **Go 测试覆盖扩展** — 已测 ysm/dedup/fsutil/recycle/sync/tags，`installer/importer/watcher` 待补
7. **发版** — `wails build -clean`、打 Git tag、写更新报告

---

## 构建状态

- 前端 `npx vite build` 通过，仅剩 YSM WASM 数据文件过大的已有警告
- Go 构建未报告异常
