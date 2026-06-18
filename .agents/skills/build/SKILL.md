---
name: build
description: 构建与调试流程。Go 后端编译、前端 Vite 构建、完整 Wails 构建、测试。
---

# 构建与调试流程

## 快速构建

### Go 后端

```bash
go build ./go/... 2>&1
```

### 仅前端

```bash
(cd frontend && npx vite build 2>&1)
```

### 完整构建（生产）

```bash
wails build -ldflags "-X ysm-model-manager/go/version.Version=vX.X.X"
```

### 开发模式（前端热重载）

```bash
wails dev
```

## 测试

```bash
# Go 全部测试
go test ./go/... -count=1

# 指定包测试
go test ./go/paths/... -count=1 -v
```

## 发版构建

```bash
pwsh ./build-release.ps1 vX.X.X
```

> 前置条件：`docs/release-notes/vX.X.X.md` 必须已存在。

## 常见构建错误

| 错误 | 原因 | 解决 |
|------|------|------|
| `undefined: xxx` | Go 新增文件未编译 | `go build ./go/...` 确认语法 |
| `Module not found` | JS import 路径错误 | 检查路径大小写 |
| `wails: command not found` | Wails CLI 未安装 | `go install github.com/wailsapp/wails/v2/cmd/wails@latest` |
| 构建后功能无变化 | 前端缓存 | `Ctrl+Shift+R` 硬刷新 |
| Go 改后前端调用无反应 | 未重启 | `wails build` + 重启应用 |

## 关键文件

| 文件 | 职责 |
|------|------|
| `app.go` | Wails Binding 入口 |
| `main.go` | Go 入口 + 窗口参数 |
| `wails.json` | Wails 配置 |
| `frontend/index.html` | 前端入口 |
| `build-release.ps1` | 完整发版脚本 |
