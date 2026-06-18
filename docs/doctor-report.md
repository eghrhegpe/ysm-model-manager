# YSM 项目诊断报告

诊断时间：2025-07-13

---

## 1️⃣ Go 编译
**✅ [OK]** 通过

---

## 2️⃣ 前端构建
**❌ [FAIL]** `npx` 命令不存在（系统未安装 Node.js/npm 或 PATH 未配置）
- 影响：前端无法构建，`wails build` 完整流程会中断
- 建议：安装 Node.js 并确认 `npx` 在 PATH 中

---

## 3️⃣ 关键文件完整性
**✅ [OK]** 全部 11 个关键文件存在

---

## 4️⃣ 治理红线（2 项问题）

| 规则 | 状态 | 涉及文件 | 说明 |
|------|------|----------|------|
| rule1: `window.__` 全局变量 | ⚠️ WARN | `app-content/index.js`, `preview-skeleton.js`, `model3d.js` | 应改用 PageStore |
| rule2: 直接 `window.go.main.App` 调用 | ⚠️ WARN | `app-content/index.js:46`, `app-tree/bus-handlers.js:332`, `core/context-menus.js:47` | 应改用 `getApp()` |

---

## 5️⃣ 配置一致性

| 项目 | 状态 | 说明 |
|------|------|------|
| reasonix.toml plugins | ✅ | 1 个 plugin 条目 |
| wails.json 解析 | ❌ [FAIL] | grep 匹配失败（可能是跨平台格式差异） |

---

## 6️⃣ Git 状态
**⚠️ 有未提交变更**（多个 .md 和 .json 文件已修改，8 个新目录未跟踪）
