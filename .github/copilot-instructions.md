# YSM 模型管理器 — 项目指令

## 🎯 战斗手册

| 角色        | 职责                     | 禁忌                 |
| ----------- | ------------------------ | -------------------- |
| **用户**    | 甩截图/报错/反常现象     | 不要自己猜原因       |
| **元宝 AI** | 给逻辑补丁，不给具体代码 | 不要在修复时要求重构 |
| **Copilot** | 严格按逻辑补丁写代码     | 不要在修 Bug 时重构  |

## 工作流规则

1. **修改前读文件** — 禁止基于记忆修改，必须 `grep_search` / `read_file` 确认最新状态。
2. **`oldString` 必须原文** — 刚读取到的一字不差，失败则报告不重试。
3. **改完立即 build** — `npx vite build 2>&1 \| Select-String 'error'`，绝不攒多个修改。
4. **`multi_replace` 不回滚** — build 失败后检查 import 语句是否完整。
5. **构建发布（必须 `wails build`）**:
   ```powershell
   Get-Process -Name "YSM-Model-Manager*" -EA SilentlyContinue \| Stop-Process -Force
   wails build -clean -ldflags "-X ysm-model-manager/go/version.Version=v1.x.x"
   Copy-Item "build\bin\YSM-Model-Manager.exe" "build\release\"
   Copy-Item "workshop_sites.json", "workshop_creators.json" "build\release\"
   Compress-Archive -Path "build\release\*" -DestinationPath "build\release\YSM-Model-Manager_windows_amd64.zip" -Force
   ```
6. **发版归档**: `docs/release-notes/v{major}.{minor}.{patch}.md` + 更新 `README.md` 索引表。
7. **文件名渲染统一** — 所有 UI 文件名必须走 `renderDisplayName()`，禁止 `textContent`/`esc()` 绕过。
8. **禁止安装软件** — 缺依赖提示用户手动装。
9. **路径用正斜杠 `/`**。

## 项目结构速查

### Go 端

```
go/installer/  — 模型安装       go/sync/     — 整合包同步
go/recycle/    — 回收站管理     go/ysm/      — YSM 解析+摘要
go/watcher/    — 文件监听       go/updater/  — 自动更新
go/paths/      — 路径安全       go/types/    — 共享类型
go/logs/       — 导入日志       go/version/  — 版本号
app.go         — Wails Binding 入口
```

### 前端

```
frontend/js/
  bus.js                 — 事件总线
  app-modules.js         — 组件入口 + 右键菜单映射
  components/            — Web Components (app-tree/sidebar/preview/content 等)
  features/              — 业务功能 (import-queue/recycle-bin/version-updater)
  dialogs/               — 弹窗 (modal/rename/batch-rename)
  pages/                 — 页面渲染 (repository)
  core/                  — 基础设施 (buttons/global-handlers/theme)
  utils/                 — 工具函数 (display/fmt/dom/icon/summarize)
  services/registry.js   — 服务注册
```

### 组件拆分规范

```
app-xxx/index.js     — 生命周期编排
app-xxx/tpl.js       — 布局 HTML 模板
app-xxx/row-tpl.js   — 节点级模板（可选）
app-xxx/data.js      — 数据逻辑（纯函数）
app-xxx/render.js    — 渲染逻辑（输入→HTML）
app-xxx/events.js    — 事件绑定
app-xxx/utils.js     — 组件工具（可选）
```

### 约束

- 每文件 ≤ 80 行
- 新组件放 `components/app-xxx/`，工具函数放 `utils/`
- ES module → `app-modules.js` 加 import；非 module → `index.html` 加 `<script>`
- 禁止在 `public/` 放 JS

## 致命陷阱（必须记住）

### 1. Go 改后必须重建

Wails Binding 是编译二进制，改 Go 文件后必须 `wails build` / `go build .` + 重启。

### 2. 全局事件必须放在常驻组件

`sync:download-missing` 等 handler 放 `app-tree` 会随页面切换消失。必须放 `app-content/index.js` 的 `_registerGlobalHandlers()`。

### 3. 按钮状态恢复 — 始终用 `finally`

异步操作失败后按钮卡死的根因是没走 finally。emit 完成事件只放 finally，不放 try 末尾。

### 4. `const` Temporal Dead Zone

`const fn = () => {}` 不提升，必须先定义再调用。`async` 函数中 TDZ 抛错会静默消失。

### 5. Go Binding 调用前确认函数名

跨语言调用时函数名易错，用 `grep_search` 在 `app.go` 确认后再写前端调用。

### 6. 下载进度防骗

- `Content-Length=-1` → 心跳兜底，最终 `if total <= 0 { total = downloaded }`
- 大文件秒跳 99% → 锁定在 99% 不跳 100%，2s 后转菊花
- `stuckGuardReset()` 必须清理 `_stuckTimer`、`_lastPct`、`completeTimer` 全部状态

### 7. 三入口统一

单击/多选/全选下载都走 `enqueueDownloadTasks()`，只注册一组 Wails EventsOn。

### 8. 回收站安全

符号链接→直接删，硬链接(nlink>1)→直接删，普通文件→移`.recycle`，跨分区→复制后删。`ensureInDir()` 防路径遍历。
