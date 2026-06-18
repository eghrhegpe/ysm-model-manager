# 2026-06-07 复盘报告

**日期**：2026-06-07
**时长**：全天
**范围**：全局拖拽导入（DnD）修复 + 旧版代码清理 + 代码文件拆分
**构建次数**：~15 次

---

## 一、修复历程（按时间顺序）

| 轮次 | 问题 | 修复 | 是否解决 | 浪费原因 |
|------|------|------|----------|----------|
| 1 | `Cannot set properties of null (setting 'textContent')` | 发现 `#st` 不存在，加 `if (!st) return` | ❌ 治标不治本 | 没找旧代码谁还在引用 `#st` |
| 2 | DnD 拖文件夹报"未检测到" | 添加 `getAllFileEntries()` 文件夹遍历 | ❌ 不工作 | 回调异步不同步 |
| 3 | 同上 | `collectFiles` 重写为 async，用 `Promise` 包装 | ⚠️ 部分 | 漏了递归传 `FileSystemEntry` 没 `.kind` |
| 4 | 同上 | 加 `isEntryArray` 参数区分 | ❌ 依然报错 | |
| 5 | 文件检测不准确 | 调试日志发现 `dataTransfer.files` 有数据 | — | **终于看日志了** |
| 6 | `dataTransfer.files` 有数据但还是报错 | 发现是旧 `app-legacy-bundle.js` 在 `public/js/` 下的副本还在加载 | ✅ | 两个同名文件，Vite 优先用 `public/` |
| 7 | `onDragLeave` 崩溃 `contains(null)` | 加 `e.relatedTarget` 空值检查 | ✅ | |
| 8 | 遮罩永远显示"未检测到模型文件" | `onDragOver` 中 `webkitGetAsEntry()` 在 dragover 阶段返回 null | ✅ | 浏览器安全限制，拖放前不能读文件信息 |
| 9 | 遮罩不消失 | `hideDropOverlay` 有 150ms 异步延迟，期间 `dragover` 可重新显示 | ✅ | |
| 10 | 旧 DnD 处理器持续报错 | 删除 `public/js/app-legacy-bundle.js` 副本 | ✅ | |
| 11 | `app-legacy-bundle.js` 是否该删 | 系统性扫描所有函数引用 | ✅ | 全部死代码，删除 |

**致命陷阱统计**：

| 陷阱类别 | 出现次数 |
|----------|----------|
| 异步回调不同步（entry.file() 是回调） | 2 次 |
| 文件系统安全限制（dragover 不能读文件名） | 1 次 |
| 同名文件冲突（Vite public/ 优先于 src/） | 1 次 |
| DOM 元素不存在（#st 已移除） | 1 次 |
| 传参类型混淆（FileSystemEntry vs DataTransferItem） | 1 次 |
| 定时器竞态（150ms delay 导致 re-show） | 1 次 |

---

## 二、根因归类

### 2.1 旧代码残留（最耗时）

- `public/js/app-legacy-bundle.js` 是 `frontend/js/app-legacy-bundle.js` 的旧副本
- Vite dev 模式下 `public/` 优先于源码目录
- 改源码没效果，改副本没意识到是副本
- **Lesson**: 每个版本要清理 `public/` 下的残留文件；`public/` 只放静态资源（图片、字体），不放 JS

### 2.2 浏览器 API 差异（最难发现）

- WebView2 的 DnD 行为与标准浏览器有差异
- `DataTransferItem` 没有 `.name` 属性（`File` 才有）
- `webkitGetAsEntry()` 在 `dragover` 阶段返回 null
- **Lesson**: 对 WebView2 特有的 API 行为要查阅文档或做防御性编程（try-catch + 兜底）

### 2.3 异步回调陷阱（最常见）

- `FileSystemEntry.file(callback)` 是回调，不是 Promise
- 递归调用时回调没完成就检查结果
- **Lesson**: 所有回调式 API 必须用 `new Promise` 包装后再用 `await`；代码审查时要特别标注回调函数

### 2.4 变更风险评估不足

- 修改 `app-legacy-bundle.js` 时没意识到它在 Vite dev 模式下被 `public/` 副本覆盖
- 移除旧 DnD handler 时没验证新 handler 是否已覆盖所有场景
- **Lesson**: 删除旧代码前必须先确认"新代码是否完整覆盖了旧代码的功能"

---

## 三、预防措施对照表

| 预防措施 | 对应本轮教训 | 实施检查项 |
|----------|-------------|-----------|
| 改前 grep 所有同名文件 | 同名文件冲突 | `grep -r "文件名"` 确认只有一个来源 |
| 改后立即 `vite build` | 构建验证不足 | 每个修改后跑一次 build |
| 异步 API 用 Promise 包装 | 回调不同步 | 代码审查标注所有 callback → await |
| 保留诊断日志 | 5轮后才看日志 | 关键路径加 `console.log` 可开关 |
| 删除前确认覆盖 | 旧功能残留 | 列出"旧功能→新功能"映射表 |

---

## 四、今后开发新 UI 的操作规范

### 4.1 改文件前

```
□ 搜索文件名确认唯一性（grep -r "文件名"）
□ 检查 public/ 下是否有副本
□ 读取文件最新内容（禁止基于记忆修改）
```

### 4.2 改文件后

```
□ vite build 确认无编译错误
□ 浏览器控制台检查有无新报错
□ 功能验证（拖一个文件测试）
```

### 4.3 删除旧代码前

```
□ 列出所有引用此代码的位置
□ 确认新代码完整覆盖旧功能
□ 建立"旧→新"映射表
```

### 4.4 遇到诡异 Bug 时

```
□ 先看浏览器控制台日志（不要猜）
□ grep 搜索报错信息，确认来源
□ 检查 public/ 下是否有同名的旧文件
□ 在可疑路径加 console.log 输出 dataTransfer 内容
```

---

## 五、本次重构成果

| 指标 | 值 |
|------|-----|
| 删除死代码 | `creator-manager.js` (412行) + `public/js/app-legacy-bundle.js` (~2200行) |
| 解耦 handler | 579 行 `global-handlers.js` → 4 个独立文件 (18~152 行) |
| 提取右键菜单 | 339 行 `app-modules.js` → 195 行 + `context-menus.js` (140行) |
| DnD 修复 | 完整支持单文件/多文件/文件夹拖入，正确检测 .ysm/.zip/.7z |
| 遮罩修复 | 拖放时正确显示"📥"提示，放下后立即消失 |
