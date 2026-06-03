# AI 交互记录 — 问题与修复

本文档记录在与 AI（DeepSeek / Claude）对话中产生的项目问题、修复过程及决策备忘，供后续 AI 快速了解上下文。

---

## 2025-06

### CSS text-transform 继承导致模型名称全大写

**问题：** components.css 中 .vb .sec { text-transform: uppercase; } 应用于整个区块，CSS text-transform 是继承属性，导致所有 .row .rn 中的模型名称文本变为全大写。

**修复：** 将 text-transform 从 .vb .sec 移到 .vb .sec .sec-title，仅影响区块标题文本。

**涉及文件：** frontend/css/components.css、html/assets/index.f4fc0296.css、html/assets/index.c9e23f9d.css

---

### 搜索模型时模型列表被清空

**问题：** 整合包卡片内模型搜索时，sec.textContent = ... 会清除 .sec 的所有子节点（包括 .row 元素），导致搜索结果或删除搜索文本后，列表不可恢复地消失。

**修复：**
1. createSection() 将结构拆分为 span.sec-title（标题文本）+ div.sec-list（所有 .row 容器）
2. 筛选逻辑改为只更新 titleEl.textContent，不再触碰 .sec-list

**涉及文件：** frontend/js/versions/renderer.js

---

### 整合包卡片间距过大

**问题：** #vg 的 gap: 6px 使卡片间间距偏大。

**修复：** gap: 6px -> gap: 4px

**涉及文件：** frontend/css/components.css、html/assets/index.f4fc0296.css、html/assets/index.c9e23f9d.css

---

### Wails 编译未使用变量

**问题：** app.go 中多个变量声明但未使用。

**修复：** 改用 _ 忽略、移除未使用声明

**涉及文件：** app.go

---

### index.html 模块化拆分（方案 A）

**问题：** frontend/js/legacy/index.html 内容过于庞大，所有 UI 区域耦合在单个文件中，不利于后续独立维护。

**修复：** 将 HTML 按 UI 区域拆分为 4 个独立模板 + 1 个加载器。index.html 仅保留骨架和 JS 引用。

**新增文件（frontend/js/legacy/js/modules/）：**
- topbar.html — 顶栏（Logo + 状态 + 主题 + 设置）
- sidebar.html — 侧栏（版本列表 + 搜索 + 游戏路径）
- main-panel.html — 主区域（仓库树 + 搜索 + 工具按钮）
- preview.html — 预览面板（统计 + 刷新/上传/日志）
- loader.js — 模块加载器，DOMContentLoaded 时 fetch 模板注入插槽

**修改文件：**
- frontend/js/legacy/index.html — 移除具体 HTML 内容，改为 4 个 div 插槽（slot-topbar/slot-sidebar/slot-main/slot-preview）

**不变量：**
- 所有 CSS 文件无需改动
- 所有 JS 逻辑文件无需改动（模板中 id/class 与原版一致）

---

## 2025-07

### 移除独立 intro 文档

**问题：** docs/intro.md 拆分后 README 失去了完整的项目介绍，吸引力减弱。

**修复：** 将 docs/intro.md 内容合并回 README.md，intro 文件仅保留"已合并"提示。

---

## 未来计划

> 以下建议来自多模态 AI 对项目的视觉评审，属于 P4 及以后的美化阶段。

### 视觉与品牌重塑
- Logo 设计、主题色定制、字体更换

### 交互体验优化
- 网格/图标视图、悬停快捷操作、撤销功能

### 对标 MO2 的进阶功能
- 冲突状态、标签系统

### 细节打磨
- 动态统计看板、加载骨架屏、关于页面