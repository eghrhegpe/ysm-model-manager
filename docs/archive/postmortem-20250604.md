# 2025-06-04 重构复盘报告（第二次）

**日期**：2025-06-04
**时长**：全天
**范围**：Go 后端 ~10 处修改，前端 ~30 个 JS/CSS 文件改动
**构建次数**：~30 次

---

## 一、对接核查：Go Binding ↔ 前端调用

### ✅ 已完全对接（前后端连通）

| Go Binding                              | 前端调用方                                | 功能                  |
| --------------------------------------- | ----------------------------------------- | --------------------- |
| `SaveAppConfig(repo,mc,linkMode,theme)` | 设置页、sidebar、bus-handlers 等 7 处     | 持久化配置            |
| `LoadAppConfig()`                       | app-content、sidebar、preview 等          | 读取配置              |
| `SelectDirectory()`                     | 设置页、sidebar                           | 系统目录选择器        |
| `GetMinecraftPath()`                    | 设置页                                    | 自动搜索 .minecraft   |
| `ScanModelEntries(dir)`                 | sidebar/loader、app-content/dedup/recycle | 扫描模型文件(含 hash) |
| `ListVersionInstances(mcRoot)`          | sidebar/loader、bus-handlers、app-content | 列出整合包            |
| `GetInstanceStatus(mcRoot, repoDir)`    | sidebar/loader、bus-handlers、app-content | 同步状态              |
| `ToggleModelEnable(path)`               | bus-handlers、app-modules(right-click)    | 启用/禁用             |
| `InstallModelTo(src, customDir)`        | bus-handlers、sidebar/actions             | 安装模型              |
| `SyncModelToggleStatus(dir, repo)`      | bus-handlers                              | 同步启用/禁用状态     |
| `SyncCustomToRepo(customDir, repo)`     | bus-handlers(app-content)                 | 上传额外模型到仓库    |
| `MoveToRecycle(src)`                    | app-content(clear, dedup)                 | 移入回收站            |
| `ListRecycleBin(repoRoot)`              | app-content(recycle page)                 | 列出回收站            |
| `RestoreFromRecycle(src, repo)`         | app-content(recycle page)                 | 恢复                  |
| `DeleteFromRecycle(src)`                | app-content(recycle page)                 | 永久删除              |
| `EmptyRecycleBin(repoRoot)`             | app-content(recycle page)                 | 清空回收站            |
| `ClearCustomDir(customDir)`             | app-content(instance:clear)               | 清空整合包            |
| `AddImportLog(...)`                     | bus-handlers                              | 记录操作日志          |
| `GetImportLogs()`                       | app-content(diagnostics)、app-preview     | 读取日志              |
| `ClearImportLogs()`                     | app-content(diagnostics)                  | 清空日志              |
| `ListFileNames(dir)`                    | app-content(export-list)                  | 导出文件清单          |
| `OpenFolder(dir)`                       | app-modules(right-click)                  | 打开文件夹            |
| `SetLinkMode(mode)`                     | app-content(settings)                     | 设置链接模式          |
| `GetLinkMode()`                         | app-content(settings)                     | 获取链接模式          |
| `ExtractYsmSummary(path)`               | app-preview(model mode)                   | 解析 YSM 摘要         |
| `AnalyzeYSMModel(path)`                 | app-modules(right-click)                  | 解析模型元数据        |
| `SaveWindowPosition(x,y,w,h)`           | app-modules(resize listener)              | 保存窗口位置          |
| `GetWindowPosition()`                   | app.go(startup)                           | 恢复窗口位置          |
| `MoveToRecycleEx(src)`                  | app-content(clear)                        | 增强回收(返回状态)    |

### ⚠️ 已注册但前端未使用

| Go Binding                        | 说明                                          |
| --------------------------------- | --------------------------------------------- |
| `DeduplicateCustomDir(customDir)` | Go 端已有，前端改用 hash 分组 + MoveToRecycle |
| `SetRepoRoot(dir)`                | 有校验逻辑，但前端通过 SaveAppConfig 间接使用 |
| `IsFileBanned(path)`              | 前端自行判断 `.ban` 后缀                      |
| `CheckFileExists(path)`           | 较少使用                                      |
| `CountLinkedModels(customDir)`    | 尚未在 UI 中使用                              |
| `IsSymlink`                       | 尚未在 UI 中使用                              |
| `GetWindowPosition()`             | 仅在 Go 端 startup 中使用                     |
| `HasYSMMod(modsDir)`              | 仅在 Go 端 GetInstanceStatus 中使用           |

---

## 二、本次改动清单

### 前端架构变化

| 改动             | 文件                  | 说明                 |
| ---------------- | --------------------- | -------------------- |
| 导航新增"回收站" | `app-nav.js`          | 独立页面，非对话框   |
| 设置页重构       | `tpl.js` + `index.js` | 从"预告"改为可用表单 |
| 诊断页新增"去重" | `tpl.js` + `index.js` | 按 SHA256 去重       |
| 回收站页面       | `tpl.js` + `index.js` | 列出/恢复/删除/清空  |

### 事件总线新事件

| 事件                     | 方向                   | 说明          |
| ------------------------ | ---------------------- | ------------- |
| `sync:download-missing`  | → app-content          | 导入缺失模型  |
| `sync:toggle-status`     | → app-content          | 同步启用/禁用 |
| `stats:upload`           | → app-content          | 上传额外模型  |
| `sync:download-complete` | app-content →          | 导入完成      |
| `sync:toggle-complete`   | app-content →          | 同步完成      |
| `sync:upload-complete`   | app-content →          | 上传完成      |
| `tree:reload`            | app-content → app-tree | 刷新仓库树    |
| `instance:export-list`   | → app-content          | 导出文件清单  |
| `instance:clear`         | → app-content          | 清空整合包    |
| `config:updated`         | settings →             | 配置变更      |

### CSS 变量迁移

将所有 Shadow DOM 组件从硬编码颜色迁移到 CSS 变量：

- `content-css.js` — 30+ 处
- `sidebar-css.js` — 25+ 处
- `preview-css.js` — 25+ 处
- `app-tree-styles.js` — 20+ 处
- `app-nav.js` — 10+ 处

### Go 端改动

| 改动                              | 文件                 |
| --------------------------------- | -------------------- |
| `SaveAppConfig` 新增 `theme` 参数 | `app.go`             |
| `AppConfig.Theme` 字段            | `go/types/config.go` |
| `shutdown()` 保存窗口位置         | `app.go`             |
| `startup()` 恢复窗口位置          | `app.go`             |
| 默认窗口 960×640 → 1280×800       | `main.go`            |
| 跳过 `.ban` 计算缺失/额外         | `go/sync/sync.go`    |
| 合并 Extra/Disabled 逻辑          | `go/sync/sync.go`    |

---

## 三、已知未解决问题

### P0 — 必须修复

| 问题                         | 影响                            | 根因                                       |
| ---------------------------- | ------------------------------- | ------------------------------------------ |
| 链接模式变更后已有链接不更新 | 切换硬链接→复制，已安装文件不变 | 无 Go 端重装逻辑                           |
| 硬链接跨分区安装报错但可降级 | 日志显示 error，实际回退到复制  | 已在 `installer.go` 实现但前端日志文案太长 |

### P1 — 体验优化

| 问题                                 | 说明                                                |
| ------------------------------------ | --------------------------------------------------- |
| `bindActions` 被多次调用(≥4次)       | `_render()` 和 `connectedCallback` 重复调用，需去重 |
| `main-panel.html` 旧模板仍有残留样式 | 未清理干净，可能影响新 UI                           |

### P2 — 待完善功能

| 功能                           | 原因                         |
| ------------------------------ | ---------------------------- |
| Drag & Drop 文件夹移动         | 仓库树拖拽功能尚未接入新架构 |
| 多仓库支持                     | 需 Go 端新增 MultiRepoRoots  |
| 空间警告（<1GB 红点）          | 无 Go 端 DiskFree API        |
| 自动清理回收站（N 天自动清空） | 无定时任务框架               |

---

## 四、错误日志

```
❌ 硬链接跨分区安装失败
  问题描述：仓库与游戏目录在不同分区，不支持硬链接
  操作：安装模型
  源路径：D:\硬链接...\[就叫纸板]【碧蓝档案】小春2023-04.zip
  目标路径：C:\PCL2\.minecraft\versions\...\custom\
  解决建议：请在设置中切换为复制模式
  状态：✅ Install 函数自动回退到 Copy，安装成功（日志仅记录失败，实际已降级）
```

```
❌ 清空整合包显示"已清空 0 个文件"
  状态：✅ 已修复 — 改用 ClearCustomDir 替代 MoveToRecycle
  原因：MoveToRecycle 要求文件在仓库目录内，而 custom 目录在 .minecraft 下
```

```
❌ 安装按钮点击无反应
  状态：✅ 已修复 — actions.js 中变量名 row 改为 btn
  原因：改 row.onclick 为 btn.onclick 时漏改 `row.closest()` → `btn.closest()`
```

```
❌ 明亮模式背景不变
  状态：✅ 已修复 — 替换 Shadow DOM 中所有硬编码颜色为 CSS 变量
  涉及：content-css, sidebar-css, preview-css, tree-styles, nav
```

```
❌ 禁用模型显示到"额外"和"已同步"中
  状态：✅ 已修复 — sync.go 合并 Extra/Disabled 逻辑，loader.js 过滤 .ban
```

```
❌ 按钮卡在"导入中..."不恢复
  状态：✅ 已修复 — 将 handler 从 app-tree 迁移到 app-content 常驻组件
```

```
❌ 日志内容一行不分行
  状态：✅ 已修复 — 加入 word-break + 关键词换行
```

### 1.1 现象

| 问题                 | 表现                                           |
| -------------------- | ---------------------------------------------- |
| 🏠 仪表盘页面删不掉  | 导航栏始终显示"仪表盘"，即使代码中已移除       |
| 热更新不工作         | 改 `app-nav.js` 后需手动复制到 `dist/`         |
| `bus is not defined` | 组件通过 ESM import bus.js 报错，找不到 export |
| `public/` 目录干扰   | Vite 返回旧文件而非源文件                      |

### 1.2 根因

| 根因                               | 详情                                                                                               |
| ---------------------------------- | -------------------------------------------------------------------------------------------------- |
| **架构分裂**                       | 新版组件用 ESM（Vite 构建），旧版组件用全局 `<script>`（直拷）                                     |
| **Wails dev 机制误解**             | `wails dev` 启动 Vite dev server 后，非 module 的 `<script>` 文件不经过 Vite 处理，热更新不生效    |
| **Vite 的 `public/` 优先级**       | `frontend/public/js/` 下的同名文件优先级高于 `frontend/js/`，导致 Vite 返回旧版无 export 的 bus.js |
| **内联 `<script>` 仍用全局 `bus`** | `index.html` 中内联脚本通过 `window.bus` 访问，但 componente 已改为 `import { bus }`               |

---

## 2. 处理过程

```
发现仪表盘删不掉
  → 检查 app-nav.js → 代码已移除但 dist/ 缓存了旧文件
  → 手动复制到 dist/ → 重启后依然存在
  → 才发现是 <script> 加载的非 ESM 文件不被 Vite 管理

决定全部统一为 ESM
  → bus.js 加 export
  → 所有组件加 import { bus }
  → index.html 移除多余 <script>，只剩 app-modules.js
  → 构建报错：bus.js 没有 export
  → 排查发现 Vite 路由到了 public/js/bus.js（旧版无 export）
  → 删除 public/js/ 旧文件
  → 构建通过 ✅
```

### 耗时分布

| 步骤             | 耗时  | 说明                                          |
| ---------------- | ----- | --------------------------------------------- |
| 定位仪表盘问题   | 45min | 排查了 app-nav.js, dist/ 缓存, Wails dev 机制 |
| 决定 ESM 统一    | 10min | 方案对比                                      |
| 修改代码         | 30min | 加 import/export                              |
| 排查 bus.js 错误 | 60min | `public/` 优先级是主要坑点                    |
| 最终构建通过     | 5min  | 删 public/ 后立即生效                         |

---

## 3. 经验教训

### 3.1 Wails dev 的工作原理

```
wails dev
├── 启动 frontend:dev:watcher → npm run dev → Vite dev server (port 5173)
├── 启动 Go 后端 (port 34115)
└── 浏览器从 localhost:5173 加载页面
    ├── <script type="module" src="..."> → Vite 处理 → 热更新 ✅
    ├── <script src="..."> → Vite 不处理 → 不热更新 ❌
    └── public/ 目录 → Vite 直接返回 → 不经过模块转换 ❌
```

**关键规则**：

- **只有 `type="module"` 的 `<script>`** 才会被 Vite 热更新
- **`public/` 目录中的文件** Vite 会直接返回，优先级高于同路径源文件
- **`dist/`** 是 `vite build` 的输出，Wails dev **不使用 `dist/`**

### 3.2 `public/` 目录陷阱

Vite 的 `public/` 目录设计用于静态资源（图片、字体等），但 JS 文件不应该放进去。
**`public/js/bus.js` 会导致 Vite 忽略 `js/bus.js` 的 ESM 版本**，返回无 export 的旧文件。

### 3.3 架构统一原则

| 方案                 | 结论                                           |
| -------------------- | ---------------------------------------------- |
| 全部 ESM + Vite      | ✅ **推荐** — 热更新、树摇、TypeScript 支持    |
| 全部 `<script>` 全局 | ❌ 不可行 — 无模块拆分，大型项目代码混乱       |
| 混合（当前架构）     | ❌ 问题根源 — 新旧代码互相干扰，构建流程不清晰 |

### 3.4 预防措施清单

#### 修改文件前必须确认

- [ ] 文件是 ESM 还是 `<script>` 加载？
- [ ] 是否有 `public/` 下的同名文件？
- [ ] 是否需要清除 Vite 缓存（`node_modules/.vite/`）？

#### 新文件创建规则

- [ ] 所有新组件必须为 ESM（`export`/`import`）
- [ ] 所有新组件在 `app-modules.js` 中通过 `import` 引入
- [ ] 禁止在 `public/` 目录放 JS 文件
- [ ] 禁止在 `index.html` 中添加新的 `<script>` 标签

#### 构建失败排查顺序

1. `curl http://localhost:5173/xxx.js` 看 Vite 返回了什么
2. 检查 `public/` 下是否有同名旧文件
3. 检查 `vite.config.js` 的 root 配置
4. 重启 `wails dev`（清除缓存）

---

## 4. 后续行动

| 事项                                             | 状态      |
| ------------------------------------------------ | --------- |
| 删除 `public/js/` 下所有 JS 文件                 | ✅ 已完成 |
| `index.html` 只保留一个 `<script type="module">` | ✅ 已完成 |
| 所有组件通过 `import { bus }` 导入               | ✅ 已完成 |
| `bus.js` 同时 `export` + `window.bus` 兼容       | ✅ 已完成 |
| 旧版 `legacy/` 目录清理                          | ⏳ 后续   |
| 移除 `app-legacy-bundle.js`                      | ⏳ 后续   |

---

## 5. 附录：确认命令

```powershell
# 确认 Vite 返回的文件内容
curl -s http://localhost:5173/js/bus.js

# 确认 public/ 下无 JS 文件
dir frontend/public/js/

# 清除 Vite 缓存
Remove-Item -Recurse -Force frontend/node_modules/.vite

# 重启 Wails dev
wails dev
```
