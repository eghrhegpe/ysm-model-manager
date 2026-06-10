# 测试策略

> 日期: 2026-06-11 | 状态: 草稿

## 原则

- **不追求全覆盖** — 个人项目，量力而行
- **优先测核心数据流** — Go Binding 输入输出、前端事件总线交互
- **自动化 vs 手动** — 核心逻辑自动化，UI 布局手动

## 分层

### 1. Go 后端单元测试（`*_test.go`）

优先覆盖：

| 包              | 测试内容                                                          | 优先级 |
| --------------- | ----------------------------------------------------------------- | ------ |
| `go/ysm/`       | `AnalyzeYSMHeader`, `scanHeader`, `hasTextHeader`, `hasFree` 解析 | P0     |
| `go/sync/`      | `GetInstanceStatus` 同步状态计算（Missing/Synced/Extra）          | P0     |
| `go/paths/`     | `IsInside`, `ContainsMinecraftMarker` 路径安全                    | P1     |
| `go/recycle/`   | 回收站逻辑（符号链接/硬链接/普通文件的区别处理）                  | P1     |
| `go/installer/` | 三种安装模式（复制/硬链接/符号链接）                              | P2     |

运行：`go test ./go/... -v`

### 2. 前端集成测试（Playwright）

Wails 应用无法直接用 Playwright 测试（WebView2 不是标准浏览器），但**前端核心逻辑**可以独立测：

- 事件总线 `bus.js` 的消息收发
- `utils/display.js` 的 `renderDisplayName`、`fmtSize`
- `features/oldest-models.js` 的 `buildMonthHeatmap`、`fmtSize`

运行：`npx playwright test`（需安装 Playwright）

### 3. Wails Binding 冒烟测试（Go）

在 Go 端直接调用 Binding 函数，验证输入输出：

- `LoadAppConfig()` → 返回有效配置
- `ScanModelEntries(repoRoot)` → 返回文件列表
- `GetInstanceStatus(mcRoot, repoRoot)` → 返回状态结构

运行：`go test ./... -run TestBindings`

## 不做的

- ❌ UI 像素级截图对比（维护成本 > 收益）
- ❌ 跨浏览器兼容测试（WebView2 是唯一目标）
- ❌ 性能基准测试（除非遇到具体性能问题）

## 实施顺序

1. 先加 `go/ysm/` 的单元测试（header 解析经常改，最容易出 Bug）
2. 再加 `go/sync/` 的测试（同步状态是核心功能）
3. 前端工具函数测试（顺手的事）
4. Binding 冒烟测试（需要 Mock 文件系统）
