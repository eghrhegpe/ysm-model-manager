<!--
PR 模板 — YSM 模型管理器
填写前请确认：本地 pre-push 门禁已过（或 CI 绿）。
-->

## 📝 改动摘要

<!-- 一句话说明这个 PR 做了什么 -->

## 🔗 关联 Issue

<!-- 关闭哪个 Issue？如 closes #123。无则填「无」 -->

## 🎯 改动类型

<!-- 勾选所有适用项 -->

- [ ] 🐛 Bug 修复（fix）
- [ ] ✨ 新功能（feat）
- [ ] 🔧 重构（refactor，行为不变）
- [ ] ⚡ 性能优化（perf）
- [ ] 📚 文档（docs）
- [ ] 🧪 测试（test）
- [ ] 🔨 构建 / 工具 / 配置（chore）

## ✅ 自查清单

<!-- 提交前逐项确认 -->

- [ ] 本地验证通过（`go build ./go/...` / `npx vite build` / `npm run typecheck`）
- [ ] 新增 / 修改的测试已跑通
- [ ] 改动 Go binding 后已跑 `npm run generate:bindings -ts`
- [ ] 改动涉及 ADR 的话已更新对应 ADR 状态
- [ ] 改完代码已同步知识卡（`check-knowledge-drift` 无 ERROR）
- [ ] 提交信息遵循 Conventional Commits
- [ ] 未纳入并行会话产物（路径限定提交）

## 🧪 测试影响

<!-- 这个 PR 影响哪些测试？新增 / 修改 / 删除？ -->

## 📸 截图 / 录屏（如适用）

<!-- UI 改动请附前后对比 -->

## ⚠️ 破坏性变更

<!-- 如果有破坏性变更（API 签名改变、配置格式变更等），请说明影响范围和迁移路径。无则删掉本节 -->

## 📖 补充说明

<!-- 其他需要 reviewer 知道的信息 -->
