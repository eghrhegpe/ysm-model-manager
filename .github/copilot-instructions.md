# YSM 模型管理器 — 项目指令

## 🎯 战斗手册

| 角色        | 职责                 | 禁忌             |
| ----------- | -------------------- | ---------------- |
| **用户**    | 甩截图/报错/反常现象 | 不要自己猜原因   |
| **元宝 AI** | 给灵感               | 锐评代码问题     |
| **Copilot** | 按逻辑写代码         | 用调试数据测问题 |

## 工作流规则

1. **修改前读文件** — 禁止基于记忆修改，必须 `grep_search` / `read_file` 确认最新状态。
2. **`oldString` 必须原文** — 刚读取到的一字不差，失败则报告不重试。
3. **改完立即 build** — `npx vite build 2>&1 \| Select-String 'error'`，绝不攒多个修改。
4. **`wails build -clean` 会清空 `build/bin/`** — YSMParser.exe 不再强制恢复（因 WASM 已内嵌），但调试 CLI fallback 时可以从 `build/ysmparser-cache/` 恢复。
5. **YSMParser 已内嵌 WASM** — `frontend/js/wasm/ysm-wasm-data.js`（base64 编码），前端 WebView2 直接解码 .ysm，**无需 exe sidecar**。
6. **发版时不打包 YSMParser.exe** — WASM 已内嵌，exe sidecar 仅作为开发调试的 Go CLI fallback。
7. **文件日志** — 生产环境无控制台时用 `writeDebug()` 写桌面 `ysm-debug.log`，用完删除。
8. **`multi_replace` 不回滚** — build 失败后检查 import 语句是否完整。
9. **唯一性检查** — 改文件前先 `grep` 确认没有同名文件在 `public/` 下（Vite dev 优先加载 `public/`）。
10. **日志优先于猜测** — 遇到"逻辑对但没反应"，先加 `console.log` 看实际值，不要猜原因。
11. **回调式 API 必须 Promise 化** — `entry.file(callback)` → `new Promise(resolve => entry.file(resolve))`，然后用 `await`。
12. **构建发布（必须 `wails build`）**:
    ```powershell
    Get-Process -Name "YSM-Model-Manager*" -EA SilentlyContinue \| Stop-Process -Force
    wails build -clean -ldflags "-X ysm-model-manager/go/version.Version=v1.x.x"
    Copy-Item "build\bin\YSM-Model-Manager.exe" "build\release\"
    Copy-Item "workshop_sites.json", "creators.json" "build\release\"
    Compress-Archive -Path "build\release\*" -DestinationPath "build\release\YSM-Model-Manager_windows_amd64.zip" -Force
    ```
13. **发版归档**: `docs/release-notes/v{major}.{minor}.{patch}.md`（用户版）+ `docs/release-notes/v{major}.{minor}.{patch}-compare.md`（开发者版，含对比表和文件清单） + 更新 `README.md` 索引表。GitHub Release 使用用户版。用户版面向使用者，写功能/改进/修复；`-compare` 版面向开发者，写实现对比和文件变更。
14. **文件名渲染统一** — 所有 UI 文件名必须走 `renderDisplayName()`，禁止 `textContent`/`esc()` 绕过。
15. **禁止安装软件** — 缺依赖提示用户手动装。
16. **路径用正斜杠 `/`**。
17. **WebView2 DnD 特殊性**：
    - `dragover` 阶段无法读取文件名（`getAsFile()` 返回 null，`webkitGetAsEntry()` 返回 null），只能 `preventDefault()` + 显示遮罩
    - `drop` 阶段优先用 `dataTransfer.items` + `webkitGetAsEntry()`，兜底用 `dataTransfer.files`
    - `FileSystemEntry.file(callback)` 是回调，须用 `new Promise` 包装
    - `DataTransferItem` 没有 `.name` 属性（`File` 才有）
18. **调试日志用完即删** — 添加的调试日志（`console.log`/`fmt.Print` 等）在测试完成后，**必须请示用户确认无误后再删除**，不可自行决定删留。

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

### 3D 渲染标准（2026-06-09 强制执行）

### UV 映射

- **只用 YSMViewer 、 BlockBench的 `expandBoxUV` + 自定义 `BufferGeometry`**，禁止使用旧版 `applyBoxUV`/`applyFaceUV` + `BoxGeometry`
- UV 坐标**不翻转 V**（`tex.flipY = false` 时，`v0 = fv / texH` 直接使用，不加 `1 -`）
- Origin X **不取反**（匹配 YSMViewer `ThreeJsPayloadBuilder.cs` 的 `cube.Origin.X - cube.Size.X`）
- vertex 顺序: YSMViewer 的 East/West/Up/Down/South/North
- Mesh 位置 = `cube.pivot`（顶点已相对 pivot 偏移，Group 在原点）

### 材质

- `transparent: true`（纹理带透明通道时），不用 alphaTest
- `DoubleSide`
- `NearestFilter` 纹理过滤

### 骨骼层级

- 遵循 YSMViewer 的完整骨骼父子层级（`bone.parent`），不得扁平化
- 骨骼 Group 位于骨骼的 pivot 点，子骨骼 Group 位于相对父骨骼的本地偏移
- Cube Mesh 位置 = `cube.pivot - bone.pivot`（相对骨骼 Group 的本地坐标）
- 不显示骨骼名标签（用户不需要）
- 不支持动画播放（用户不需要，纯静态渲染）

### 存档

- YSMViewer 版本备份在 `docs/model3d-ysm-attempt.js`
- 当前稳定版保存在 `docs/model3d.js`
- 旧版 `applyBoxUV`/`applyFaceUV` + `BoxGeometry` 方案永久废弃，不允许再提及或恢复

## 约束

- **按职责切文件**：一个文件放一个可独立工作的功能（如 DnD、同步、上传各一文件），不按行数机械切割。300-700 行的单一职责文件比拆成 5 个 80 行但耦合紧密的小文件更好维护。
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
