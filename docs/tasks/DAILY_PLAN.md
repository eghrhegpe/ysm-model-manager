# 📋 每日计划 — 2026-06-17

> 总控：Sisyphus（本对话）
> 版本 HEAD：`15dd106` — 主题系统增强（v1.8.11）
> 仓库状态：🟢 Clean

---

## 今日任务

### 1. Overlay UX 微调 — 预览面板宽度 + 日期着色

| 字段 | 值 |
|------|-----|
| **来源** | TASK_PLAN.md #3 |
| **优先级** | 🟡 中 |
| **模型** | Qwen3.7 Plus |
| **文件** | `css/variables.css` `css/layout.css` `utils/display.js` |
| **验收** | 预览面板可拖拽调整宽；文件树标签日期按系统色 | 彩着色 |

**子项：**
- [ ] P2-8：预览面板宽度可调 — `variables.css:119` `layout.css:4-7`
- [ ] P2-9：文件树标签日期着色 — `utils/display.js`

---

### 2. 更新 PROJECT_STATUS.md → 同步到 v1.8.11

| 字段 | 值 |
|------|-----|
| **来源** | 当前文档滞后（标记 v1.8.8，实际 v1.8.11） |
| **优先级** | 🟢 低（但阻碍后续决策） |
| **模型** | DeepSeek V4 Flash |
| **文件** | `docs/PROJECT_STATUS.md` |
| **验收** | 版本号更新为 v1.8.11，补全 3D 重构/主题增强/术语表落地，同步 TASK_PLAN.md 完成状态 |

---

### 3. ResourceExts / SubDirAll 硬编码迁移 → 注册表

| 字段 | 值 |
|------|-----|
| **来源** | PROJECT_STATUS.md + bug-chronicle |
| **优先级** | 🟡 中 |
| **模型** | DeepSeek V4 Pro |
| **文件** | `go/types/extensions.go` `go/types/resource_types.json` |
| **验收** | extensions.go 中非 register 的硬编码 map 全部抽取到 JSON，go build 通过，现有测试不回归 |

---

## 执行说明

- **改前读文件** — 每步先 read/grep 确认最新状态
- **改完立即构建** — `go build ./go/...` 或 `npx vite build`
- **不攒修改** — 完成一个验收一个
- **任务 1 适合优先干** — 纯前端，不影响其他模块
- **任务 2 随时可以** — 纯文档，可并行

---

## 今日模型分配速查

| 任务 | 模型 | 理由 |
|------|------|------|
| #1 Overlay UX | Qwen3.7 Plus | 前端逻辑，缓存便宜 |
| #2 文档更新 | DeepSeek V4 Flash | 纯文本，Flash 极便宜 |
| #3 硬编码迁移 | DeepSeek V4 Pro | Go 类型重构，需强推理 |
