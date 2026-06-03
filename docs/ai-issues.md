# AI 交互记录 — 问题与修复

本文档记录在与 AI（DeepSeek / Claude）对话中产生的项目问题、修复过程及决策备忘，供后续 AI 快速了解上下文。

---

## 2025-06

### CSS text-transform 继承导致模型名称全大写

**问题：** `components.css` 中 `.vb .sec { text-transform: uppercase; }` 应用于整个区块，CSS `text-transform` 是继承属性，导致所有 `.row .rn` 中的模型名称文本变为全大写。

**修复：** 将 `text-transform` 从 `.vb .sec` 移到 `.vb .sec .sec-title`，仅影响区块标题文本。

**涉及文件：** `frontend/css/components.css`、`html/assets/index.f4fc0296.css`、`html/assets/index.c9e23f9d.css`

---

### 搜索模型时模型列表被清空

**问题：** 整合包卡片内模型搜索时，`sec.textContent = ...` 会清除 `.sec` 的所有子节点（包括 `.row` 元素），导致搜索结果或删除搜索文本后，列表不可恢复地消失。

**修复：**
1. `createSection()` 将结构拆分为 `<span class="sec-title">`（标题文本）+ `<div class="sec-list">`（所有 `.row` 容器）
2. 筛选逻辑改为只更新 `titleEl.textContent`，不再触碰 `.sec-list`

**涉及文件：** `frontend/js/versions/renderer.js`

---

### 整合包卡片间距过大

**问题：** `#vg` 的 `gap: 6px` 使卡片间间距偏大。

**修复：** `gap: 6px` → `gap: 4px`

**涉及文件：** `frontend/css/components.css`、`html/assets/index.f4fc0296.css`、`html/assets/index.c9e23f9d.css`

---

### Wails 编译未使用变量

**问题：** `app.go` 中多个变量声明但未使用：
- `DeduplicateCustomDir`: `for hash, group` — `hash` 未使用
- `CountLinkedModels`: `if nlink := info.Sys(); nlink != nil` 空块
- `ClearCustomDir`: `skipCount` 声明未使用；`repoByHash` 声明未使用

**修复：** 改用 `_` 忽略、移除未使用声明

**涉及文件：** `app.go`

---

### index.c9e23f9d.css 等哈希文件名困扰

**问题：** `html/assets/index.f4fc0296.css`、`index.c9e23f9d.css` 等带哈希的文件名不直观，容易误编辑。

**方案：**
1. `docs/architecture.md` 中明确标注为 `* Wails 构建产物（不要编辑）`
2. `README.md` 底部说明 `html/` 目录来源
3. 创建此 AI 问题记录文件

---

### 移除独立 intro 文档

**问题：** `docs/intro.md` 拆分后 README 失去了完整的项目介绍，吸引力减弱。

**修复：** 将 `docs/intro.md` 内容合并回 `README.md`，intro 文件仅保留"已合并"提示。

---

## 💡 AI 建议 — 美化与体验提升（待实施）

> 以下建议来自多模态 AI 对项目的视觉评审，属于 P4 及以后的美化阶段，当前不急于实施，记录供后续 AI 参考。

### 🎨 视觉与品牌重塑

- **Logo 设计：** YSM 字母变形或像素风图标，提升辨识度
- **主题色定制：** 增加一种强调色（青/紫/绿），选中项、按钮、高亮统一使用强调色
- **字体更换：** `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto` + 思源黑体（中文）

### ⚡ 交互体验优化

- **网格/图标视图：** 视图切换按钮，网格模式下显示模型缩略图或默认 3D 图标
- **悬停快捷操作：** 列表项悬停时右侧滑出启用/禁用、打开文件夹、删除图标
- **撤销功能：** 最近 5 步操作历史，误操作可通过 Toast 中的"撤销"恢复

### 🚀 对标 MO2 的进阶功能

- **冲突状态：** 仓库文件被外部修改时高亮提示，询问覆盖或忽略
- **标签系统：** 给模型打标签（热门/旧版/仅生存），高级筛选下拉（仅显示禁用项、仅未安装整合包）

### 🌟 细节打磨

- **动态统计看板：** 扫描文件时数字跳动增加，带微动效
- **加载骨架屏：** 冷启动时的 Logo 淡入动画或目录扫描骨架屏
- **关于页面：** 致谢墙（Wails 等开源库 + GitHub 链接）

### 实施建议

> 当前阶段专注功能稳定，以上内容优先做两件事：
> 1. 换一套 CSS 变量主题（调色盘 + 字体）
> 2. 实现"网格视图"和"悬停快捷操作"

