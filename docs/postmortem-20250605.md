# 2026-06-05 晚间复盘报告

**日期**：2026-06-05（晚间）
**时长**：短时段
**范围**：前端 JS 修改 ~5 处，docs 更新
**构建次数**：~5 次（含前端 + Go）

---

## 一、改动清单

### 🐛 Bug 修复

| #   | 问题              | 文件                        | 根因                                     |
| --- | ----------------- | --------------------------- | ---------------------------------------- |
| 10  | 窗口逐次缩小      | `app-modules.js` / `app.go` | 前端 `innerWidth`(内容区) ≠ 外层窗口尺寸 |
| 11  | shutdown panic    | `app.go`                    | `WindowGetSize()` nil dereference        |
| 12  | 正则 panic        | `proxy.go`                  | Go RE2 不支持 `(?!` 负向前瞻             |
| 13  | iframe 安全警告   | `app-content/tpl.js`        | `allow-same-origin` + `allow-scripts`    |
| 14  | CSV 中文乱码      | `app.go`                    | ANSI 编码 vs UTF-8                       |
| 15  | 下载 404          | `index.js` / genindex       | Windows `\` 未转 URL `/`                 |
| 16  | fetch 无超时      | `index.js`                  | 浏览器默认 30~90s                        |
| 17  | 整合包强制展开    | `sidebar/events.js`         | `idx === 0` 特殊判断                     |
| 18  | 文件名颜色丢失    | `utils/display.js`          | `esc()` 转义了高亮标签                   |
| 19  | handler 重复绑定  | 常驻组件迁移                | app-tree 卸载后事件无人处理              |
| 20  | 工作坊 fetch 卡死 | `index.js`                  | 无 index.json 时按钮不恢复               |

### ✨ 功能改进

| 功能                      | 说明                               |
| ------------------------- | ---------------------------------- |
| **📇 索引按钮→仓库页**    | 从创意工坊移到仓库页面，带说明文字 |
| **❌ 无索引状态**         | 404 后按钮变灰，自动跳转 GitHub    |
| **⏱ fetch 6s 超时**       | AbortController 实现               |
| **🔄 索引按钮(模型视图)** | GitHub 浏览列表顶部的索引生成入口  |

---

## 二、关键教训

### 架构级

1. **配置文件存储位置** — `os.Executable()` 目录，`wails dev` 和编译后目录不同，容易混淆
2. **前端窗口尺寸不准** — 永远在 Go 端（shutdown 时）读取保存窗口尺寸，前端 resize handler 不可靠
3. **Wails shutdown 有坑** — `WindowGetSize` 可能 panic，必须有 defensice `recover()`

### 前端级

4. **fetch 必须加超时** — 网络请求永远假设可能挂起
5. **按钮状态机要完整** — 三种状态：⏳（加载中）→ ✅（成功）或 ❌（失败不可用），每种都要处理
6. **Windows 路径 = 毒药** — 任何传给网络 API 的路径必须 `\` → `/`

### Go 级

7. **RE2 限制** — Go 正则不能有 `(?!` `(?<=`，必须用辅助函数
8. **CSV + 非 ASCII = 灾难** — 涉及中文/Emoji 的持久化永远用 JSON
9. **shutdown 防御** — Wails runtime 方法在关闭时可能返回 nil

---

## 三、待办

- [ ] 生成 Release 并测试自动更新流程
- [ ] 完善 `index.json` 自动生成 UI 提示
- [ ] 去重功能增强（让用户选择保留哪个副本，而非自动保留第一个）
