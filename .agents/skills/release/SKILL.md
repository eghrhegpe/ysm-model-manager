---
name: release
description: 发版流程。当用户要求发版、创建 release、打 tag 时使用此技能。
---

# 发版流程

## 前置检查

1. 确认所有改动已提交：`git status --short`
2. 确认构建通过：
   ```bash
   go build ./go/... 2>&1
   (cd frontend && npx vite build 2>&1)
   ```
3. 确认测试通过：`go test ./go/... -count=1`

## 发版步骤

1. **写发版说明**：创建 `docs/release-notes/v{X.Y.Z}.md`
   - 参考 `docs/release-notes/README.md` 的格式
   - 包含：改动摘要、文件统计、参与 AI

2. **运行代码生成**：
   ```bash
   go generate ./go/...
   ```

3. **提交并打 tag**：
   ```bash
   git add -A
   git commit -m "v{X.Y.Z} — 标题"
   git tag v{X.Y.Z}
   ```

4. **构建并发布**：
   ```bash
   pwsh ./build-release.ps1 v{X.Y.Z}
   ```

5. **更新文档**：
   - `docs/release-notes/README.md` 添加新版本行
   - `docs/architecture/PROJECT_STATUS.md` 更新版本号

## 注意事项

- ⚠️ **先写文档再打 tag**：`build-release.ps1` 会读取 `docs/release-notes/v{X.Y.Z}.md` 作为 Release 正文
- ⚠️ **累积版本可合并**：如果中间版本未单独发布，发版说明应汇总所有改动
- ⚠️ **清理调试日志**：发布前检查 `docs/frontend/pending-cleanup.md`

## 参考文档

- `docs/release-notes/README.md` — 发版规则
- `docs/architecture/PROJECT_STATUS.md` — 当前状态
- `build-release.ps1` — 构建脚本
