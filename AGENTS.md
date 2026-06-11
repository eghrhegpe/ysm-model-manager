# YSM 模型管理器 — AI 代理入职指南

## 第一条：先读文档

在开始任何修改前，**必须依次阅读**：

1. **`.github/copilot-instructions.md`** — 战斗手册（致命陷阱、工作流、约定）
2. **`docs/architecture.md`** — 项目架构
3. **`docs/release-notes/`** — 最新版本的发版说明（看已有的改动）
4. **`docs/bug-chronicle.md`** — 已知 Bug 和排查路径
5. **`docs/pending-cleanup.md`** — 待清除清单（调试代码是否还在）

## 第二条：确认当前状态

- 检查 `git log --oneline -5` 看最近提交
- `build/bin/` 下的 YSMParser.exe 仅作为 Go CLI fallback，`wails build -clean` 会清掉，但 WASM 内嵌解码不受影响

## 第三条：改前读文件

禁止基于记忆修改。每次改文件前先 `grep_search` / `read_file` 确认最新状态。啊

## 第四条：改完立即构建

```powershell
# Go 改了
go build ./go/... 2>&1 | Select-String error

# 前端改了
cd frontend ; npx vite build 2>&1 | Select-String error
```

不攒多个修改。

## 第五条：已知已完成的改动（v1.3.0+）

已在发版说明中记录，但快速提示：

- ✅ ZIP 模型手臂层级/偏移修复
- ✅ faceUV 丢弃修复
- ✅ 多纹理渲染（per-mesh 纹理索引）
- ✅ 纹理按模型顺序分配
- ✅ 配置文件保存不再因校验失败阻塞
- ✅ mcRoot/RepoRoot 设置入口合并到设置页
- ✅ Shadow DOM 样式隔离

## 第六条：回滚规则

如果 `multi_replace_string_in_file` 后构建失败，**不要回滚**——检查 import 语句是否完整，修复后继续。
