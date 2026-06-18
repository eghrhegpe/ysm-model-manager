# YSM 模型管理器 — 项目现状汇总

更新时间：2026-06-17  
当前版本：**v1.8.11**  
最近提交：`15dd106 feat: 主题系统增强 — 薄荷物语主题 + 自动切换 + UI 重构`

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
| `docs/3D/3D-RENDERING-PLAN.md` | 多 AI 协作设计 | 3D 骨骼渲染攻关：4 阶段分工流程 + 提示词模板 + 5 个已知陷阱 |
| `docs/3D/3d-rendering-report.md` | DeepSeek V4 Pro / Flash、Qwen3.7 Plus、GLM-5.1 | **3D 渲染引擎开发报告**：14 项修复 + Go/WASM 能力对比 + 排查方法论 |
| `docs/3D/2026-06-17-summary.md` | DeepSeek V4 Flash | 修复总结：坐标/顶点/合并/纹理/解析 5 类 14 项 |
| `docs/SESSION_HANDOFF.md` | Big Pickle | 会话交接日志：模板 + 多条记录 |

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
| **GetRepoRoot error 传播** | `(string)→(string,error)`，配置损坏不再静默 | `resource_bindings.go:69-87` ✅ v1.8.5 |
| **动画系统** | 对话框、按钮、页面切换、预览面板、设置面板、同步管理器列表、回收站等全量动画 | v1.7.6 / v1.7.7，共 18+ 文件 |
| **调试代码清理** | v1.7.4 遗留 16 处日志、fmt.Printf 已清 | v1.7.5 |
| **暗色模式自动切换** | `matchMedia('change')` 监听，跟随 OS 自动切换 | v1.7.5 |
| **右键打开文件位置** | Go 端新增 `RevealInExplorer` | v1.7.5 |
| **注册表 v2** | `StorageSubDir`/`specificRoot` 硬编码 switch → 查 `resource_types.json` | v1.8.5 |
| **扫描缓存事件失效** | watcher `syncAll()` 先清缓存再同步，消除 30s TTL 间隙 | v1.8.5 |
| **Wails 治理收口** | 8 文件 25+ 处裸 import/`window.go.*` → `getApp()` | v1.8.5 |
| **Go 测试覆盖** | 6→11 包，+33 tests | v1.8.5 |
| **3D 渲染引擎重构** | 坐标系修正（X 不取反 + fx=ox）、旋转符号三轴取反、多纹理 texIdx、非贴图 PNG 过滤 | v1.8.6 |
| **Go 路径纹理映射** | archive.go 四种 model 格式、extracted.go projectiles 兼容、TexSlot 透传 | v1.8.7 |
| **3D 渲染文档 + 测试数据** | `docs/3D/` 开发报告 + 多模型测试数据 | v1.8.8 |
| **3D 渲染引擎重构** | 注册表驱动纹理映射、继承层级修复、JS 兜底路径统一 | v1.8.9 |
| **构建流程修复** | 累积修复、测试框架补全（+33 tests→11 包覆盖） | v1.8.10 |
| **术语表落地** | Toast/按钮/tooltip 文案统一 + UI 专有名词替换 | v1.8.10 |
| **主题系统增强** | 新增薄荷物语主题（mint）、自动切换（system/time）、UI 重构 | v1.8.11 |
| **加载路径大统一** | Go/JS 路径规范对齐，消除 3D 预览空白 | v1.8.11 |

---

## 🔧 本轮新增（v1.8.5）

### 注册表驱动
| 改动 | 文件 | 效果 |
|------|------|------|
| `StorageSubDir` 硬编码 switch → 查 `resource_types.json` | `go/types/extensions.go` | 新类型只需改 JSON |
| `specificRoot` 硬编码 switch → 查注册表 `configField` | `resource_bindings.go` | 同上，含 VRC fallback |
| 前端 3 处硬编码 map/array → `loadResourceRegistry()` | settings/recycle/diagnostics | 与 Go 端共享同一数据源 |
| 新增 `utils/resource-registry.js` | 前端共享工具 | 缓存 Go 端注册表 |

### 测试覆盖（+33 tests，6包→11包）
| 包 | 新增 | 累计 |
|----|------|------|
| `go/importer` | 8 | 8 |
| `go/watcher` | 9 | 9 |
| `go/installer` | 10 | 10 |
| `go/types` | 6 | 6 |
| `go/packs` | 9 | 9 |

### 治理收口
| 文件 | 消除 | 方式 |
|------|------|------|
| 6 文件 23 处裸 import / `window.go.main.App` | 治理残留 | 统一 `getApp()` |
| `GetRepoRoot` 签名 `(string)→(string,error)` | 配置损坏静默 | Wails 自动 reject |
| watcher → `ClearScanCache()` | 30s TTL 间隙 | 文件变更即时清缓存 |

### 文案统一（术语表落地）
| 范围 | 旧 → 新 | 数量 |
|------|---------|------|
| 全项目 toast | `请先设置…` → `请先配置…` | 24 处 |
| sidebar/tree tooltip | `点击选择…` → `配置…` | 3 处 |
| 批量重命名预设 | `去除年份 (2025-08)` → `去除年份` | 1 处 |

### 蓝图同步计数修复
| 问题 | 根因 | 修复 |
|------|------|------|
| 蓝图卡片显示 `tag 0` | `app_scan.go` 只对 `.ysm/.zip/.7z/.json` 算 hash，蓝图 `.nbt/.schematic/.litematic` 无 Hash → 哈希对比跳过所有条目 | 加入蓝图扩展名到 `computeFileHash` |

---

## ⚠️ 已知遗留问题

| 问题 | 位置 | 影响 | 优先级 |
|------|------|------|--------|
| ~~**3D 骨骼渲染坐标不准**~~ | ~~`go/threejs/spec.go` `model2d.js`~~ | ~~多文件模型层级错误、手臂偏移、旋转丢失~~ | ✅ **已解决** v1.8.6-v1.8.8（详见 `docs/3D/3d-rendering-report.md`） |
| ~~创作者详情 Overlay UX~~ | ~~第三方评审建议~~ | ~~视觉锚点、交互细节待打磨~~ | ✅ **已解决**（P2-8/P2-9 代码已存在） |
| model2d 预览缓存 | `preview-cache.js` | 社区仓库重复解析浪费 CPU | **中**，但**暂缓**：多模态辅助下 Three.js canvas 序列化/失效复杂，当前瓶颈不在预览 |
| 列表/网格视图切换 | `app-tree` | 仅卡片视图，缺紧凑列表 | **低**（P3 新功能，动画 P0-P1 做完再考虑） |
| updater 无自动测试 | `go/updater/` `cmd/updater/` | `CheckUpdate`/下载/替换/重启全链路无回归保护 | **中**（手动端到端可测，自动测试需模拟 GitHub API + 文件锁） |
| `ResourceExts` / `SubDirAll` 仍硬编码 | `go/types/extensions.go` | 新类型需改 3 处（已有一致性测试兜底） | **低**（有测试保护） |
| JS 兜底路径是死代码 | `model3d-spec.js` | Go 不可用时 3D 视图空白 | **低**（Go 路径稳定） |

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

1. ~~**Overlay UX 微调**~~ — ~~按第三方评审清单逐项改~~（✅ 已完成，P2-8/P2-9 已实现）
2. **model2d 预览缓存** — 扩展现有 `preview-cache.js`，复用骨骼图避免重复解析
3. **列表/网格视图切换** — 工具栏加 🗂/☰ 切换、紧凑行模板、`localStorage` 持久化
4. **前端测试覆盖扩展** — 当前 30 个测试（fmt/dom/data），后续覆盖 download-queue / render.js / 事件总线
5. **updater 测试** — `go/updater/` 补单元测试（mock GitHub API + 文件替换逻辑）
6. **ResourceExts / SubDirAll 注册表驱动** — 与已修的 StorageSubDir/specificRoot 同理，消除剩余硬编码 map

---

## 🎮 3D 渲染引擎开发总结（v1.8.6-v1.8.8）

**参与 AI**：DeepSeek V4 Pro、DeepSeek V4 Flash、Qwen3.7 Plus、GLM-5.1

### 解决的问题（14 项）

| 类别 | 修复数 | 关键修复 |
|------|--------|----------|
| 坐标/顶点 | 3 | `fx=ox` 公式修正、旋转符号三轴取反、深度排序 |
| 多文件合并 | 3 | arm.json cube 残留、嵌入几何体优先级、模型文件合并 |
| 纹理映射 | 5 | 非贴图 PNG 过滤、纹理顺序、多分辨率 UV、TexSlot 透传 |
| 解析健壮性 | 3 | projectiles 数组兼容、7z 路径重写、model 四种格式 |

### 关键文件

| 文件 | 改动 |
|------|------|
| `go/threejs/spec.go` | 顶点公式、旋转符号、mesh 合并策略、UV 负尺寸 |
| `go/geometry/archive.go` | ysm.json 纹理排序、7z 路径重写、TexSlot 分配 |
| `go/ysm/extracted.go` | json.RawMessage 解析、模型文件优先、纹理排序 |
| `frontend/js/utils/model3d.js` | 移除 transparent、mesh 合并优化 |

### 已知限制

1. JS 兜底路径是死代码（格式不兼容）
2. 7z 路径纹理排序较弱
3. Go CLI fallback 不设 TexSlot
4. 2D 骨骼图旋转后位置偏移（低优先级）

### 详细文档

- 开发报告：`docs/3D/3d-rendering-report.md`
- 修复总结：`docs/3D/2026-06-17-summary.md`
- 测试数据：`docs/3D/` 目录下多个模型文件

---

## 构建状态

- 前端 `npx vite build` 通过，仅剩 YSM WASM 数据文件过大的已有警告
- Go 构建未报告异常
