# YSM 模型管理器 — 项目指令

## 工作流规则

1. **修改前确认最新状态** — 禁止基于记忆直接修改。必须通过 `grep_search` 或 `read_file` 确认目标代码的最新状态。
2. **`replace_string_in_file` 的 `oldString`** — 必须是刚刚读取到的原文，一字不差。
3. **替换失败的处理** — 如果 `replace_string_in_file` 失败，禁止强行重试，改为报告错误并等待用户处理。
4. **优先搜索** — 优先使用 `grep_search` 定位，其次 `replace_string_in_file`。
5. **`read_file` 限制** — 单次读取不超过 200 行，除非用户明确要求全量分析。
6. **构建命令** — 仅捕获错误: `npx vite build 2>&1 | Select-String 'error'`
7. **禁止安装软件** — 如果缺少依赖，提示用户手动安装。
8. **路径格式** — 所有路径使用正斜杠 `/`。

## 项目架构

### 技术栈

- **后端**: Go (Wails v2)
- **前端**: 原生 HTML/CSS/JS + Vite
- **构建**: `wails.json` 控制, `go build .` 编译 Go, `npx vite build` 构建前端

### Go 端结构

```
go/
  installer/    — 模型安装 (复制/硬链接/符号链接)
  recycle/      — 回收站管理
  sync/         — 整合包同步状态
  logs/         — 导入日志
  types/        — 共享类型定义
  ysm/          — YSM 模型解析
app.go          — Wails Binding 入口 (~680行)
main.go         — 应用入口
```

### 前端结构

```
frontend/js/
  bus.js                   — 事件总线 (ESM + window.bus 兼容)
  app-modules.js           — 所有 ES module 组件统一入口
  components/
    app-tree/              — 仓库树组件 (index/data/render/events/tpl)
    app-sidebar/           — 侧边栏整合包列表
    app-preview/           — 右侧预览面板
    app-content/           — 主内容区
    app-toast.js           — Toast 通知
    app-nav.js             — 导航栏
    context-menu.js        — 右键菜单
    app-header.js          — 头部 (未引用)
  utils/
    fmt.js                 — 文件大小/日期格式化
    dom.js                 — HTML 转义/搜索高亮
    icon.js                — 文件图标映射
  lib/
    parse.js               — 通用解析工具
    state.js               — 全局状态
    tree.js                — 树结构工具
  core/
    buttons.js             — 按钮逻辑
    directories.js         — 目录管理
    lifecycle.js           — 生命周期
    theme.js               — 主题切换
  services/
    registry.js            — 服务注册
  ui/
    cm-tree.js             — 树 UI
    cm-utils.js            — UI 工具
    cm-version.js          — 版本 UI
    contextmenu.js         — 上下文菜单
    drop.js                — 拖拽
    toggle.js              — 切换
  versions/
    ...                    — 整合包版本相关
```

### 前端组件拆分规范

每个组件目录遵循：

```
app-xxx/
  index.js       # 生命周期编排（constructor → shadow → connected → disconnected）
  tpl.js         # 布局级 HTML 模板（纯字符串）
  row-tpl.js     # 节点级 HTML 模板（可选）
  data.js        # 数据逻辑（纯函数，不碰 DOM）
  render.js      # 渲染逻辑（输入 → HTML 字符串）
  events.js      # 事件绑定（addEventListener / bus.on）
  utils.js       # 组件特有工具函数（可选）
```

### 关键约束

- 每文件 ≤ 80 行
- 新组件在 `frontend/js/components/app-xxx/` 创建目录
- 新工具函数在 `frontend/js/utils/` 创建
- ES module → 在 `app-modules.js` 添加 import
- 非 module → 在 `index.html` 加 `<script>`
- 禁止在 `public/` 目录放置 JS 文件

## 已知痛点 (痛苦教训)

### 1. Go 端修改后必须重建

**问题**: 修改 `go/sync/sync.go` 等 Go 文件后，`missing` 列表从 `e.Name`(纯文件名) 改为 `e.Path`(完整路径)，但前端仍收到旧数据。
**根因**: Wails Binding 是编译后的二进制，不 `go build .` + 重启就不会生效。
**解决**: 修改任何 Go 文件后必须执行 `go build .` 或 `wails dev` 重建。

### 2. 前端数据传递链 — 完整路径 vs 纯文件名

**问题**: `GetInstanceStatus` 返回的 `Missing` 是完整路径，但经过 `loader.js → render.js → tpl.js` 传递后被截断为纯文件名。
**根因**: 渲染时用 `displayName`(纯文件名) 覆盖了 `name`(完整路径)，`data-name` 只存了文件名。
**解决**: 需要完整路径的地方用 `data-path` 单独存储，`data-name` 只用于显示。

### 3. 按钮状态恢复

**问题**: 异步操作 (导入/同步/上传) 失败后按钮卡在"导入中..."状态。
**根因**: 捕获异常后没有 emit 完成事件。
**解决**: 始终在 `finally` 块 (而非 `try` 块末尾) emit 完成事件，确保无论成败都恢复按钮。

### 4. 文件夹开关逻辑反转 (bug-chronicle #1)

**问题**: 点击文件夹开关 (绿色/灰色/黄色) 没有任何效果。
**根因**: 根据 UI `class` 决定翻转方向然后筛选"不需要操作"的文件 — 循环论证。
**解决**: 直接根据数据 (`e.banned`) 判断，不依赖 UI class。

### 5. 仓库按钮全部启用/全部禁用写反 (bug-chronicle #2)

**问题**: 点击"全部启用"→ 所有模型禁用，反之亦然。
**根因**: 筛选条件 `e.banned === !enable` 逻辑反了。
**解决**: 用 `e.banned === enable`（要找的是需要翻转的文件）。

### 6. 树箭头旋转混乱 (bug-chronicle #4)

**问题**: 展开的文件夹箭头 `▼` 旋转 45° 变成 `↘`。
**根因**: Unicode 文字 `▼` + CSS `rotate(90deg)` 双重旋转。
**解决**: 去掉 CSS rotate，直接用 `▾`/`▸` 文字切换。

### 7. MC 格式码未清洗 (bug-chronicle #5)

**问题**: 模型详情显示 `§3` `§r` 等 Minecraft 格式码，`\n` 被 HTML 吞掉。
**解决**: 用 `cleanTips()` 清洗: `replace(/§[0-9a-fk-or]/gi, "")` + `\n` → `<br>`。

### 8. 回收站安全防护

- 符号链接 → 直接删除 (原始文件不受影响)
- 硬链接 (nlink > 1) → 直接删除 (数据还在仓库)
- 普通文件 → 移入 `.recycle`
- 跨分区 → 复制后删除
- 路径遍历防护: `ensureInDir()` 双重检查

### 9. 前端热重载 vs Go 重启

- 前端 HTML/CSS/JS 修改 → 刷新浏览器即可 (Wails dev 模式)
- Go 端修改 → 关闭窗口 → `wails dev` 或 `go build .` → 重启
- 新增 Wails Binding → 运行 `wails generate module` 或重启 `wails dev`
- 重大重构后清浏览器缓存: `Ctrl+Shift+R`

### 10. 配置持久化回退链

`ysm_config.json` (磁盘) → `localStorage` → 自动检测 → 默认值

### 11. 全局事件处理器必须放在常驻组件

**问题**: `sync:download-missing`、`sync:toggle-status`、`stats:upload` 等 handler 注册在 `app-tree/bus-handlers.js`，但 `app-tree` 只在"仓库"页面渲染。用户在"整合包"页面时事件无人处理，按钮卡死。
**解决**: 所有需要常驻监听的事件处理器放在 `app-content/index.js` 的 `_registerGlobalHandlers()` 中（`app-content` 始终挂载），而不是在 `app-tree` 中。
**同样问题**: 右键菜单的 `instance:clear`、`instance:export-list` 等事件也需要常驻监听。

### 12. 调用 Go Binding 前确认函数名存在

**问题**: `instance-actions.js` 中调用了不存在的 `DeleteFromDisk`，实际 Go 端函数名为 `MoveToRecycle`。
**解决**: 确认 Go Binding 函数名与 `app.go` 中的定义一致，用 `grep_search` 先验证。
