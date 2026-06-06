# P5 开发计划

## 概述

6 个特性按风险和依赖关系排序。每项标注所需技能、预估行数、风险等级。

---

## 1️⃣ 文件夹导入保持目录结构

| 项目     | 内容                                                                |
| -------- | ------------------------------------------------------------------- |
| **目标** | 拖入 `folder/sub/model.ysm` 时，在仓库中保持 `folder/sub/` 目录结构 |
| **难度** | ⭐⭐ 中等                                                           |
| **预估** | Go ~50 行 + 前端 ~30 行                                             |

### 需要修改

**Go 端 — `app.go`**

- 新增 Binding `ImportModelFileTo(name, subpath, base64 string) error`
- 或修改 `ImportModelFile` 增加 `subpath` 参数（注意前端已有调用方）
- 在 `repoRoot` 下创建 `subpath` 目录，然后写入文件

**前端 — `features/import-queue.js`**

- `readEntry()` 已存 `file._relPath`（如 `folder/sub/model.ysm`）
- `enqueueFile()` 需同时保存 `_relPath`
- 导入时调用 `ImportModelFileTo(newName, relDir, base64)`
- 重命名对话框也需要知道原始路径

### 风险

- 低：Go 端只是路径拼接 + MkdirAll
- 注意：rename.js 也需要支持子路径重命名

---

## 2️⃣ 导入→重命名一键流

| 项目     | 内容                                                     |
| -------- | -------------------------------------------------------- |
| **目标** | 导入完成后自动弹出 rename 对话框，用户不改名直接确认也可 |
| **难度** | ⭐ 简单                                                  |
| **预估** | 前端 ~40 行                                              |

### 需要修改

**前端 — `features/import-queue.js`**

- 导入成功后，自动调用 `showRenameDialog(fullPath, newName)`
- 用户确认后 → `RenameFile` + 刷新
- 用户取消 → 保持原名

### 风险

- 极低：纯前端流程串联

---

## 3️⃣ 统计数字动效

| 项目     | 内容                                          |
| -------- | --------------------------------------------- |
| **目标** | 侧边栏/统计面板的数字变化时，有平滑的计数动画 |
| **难度** | ⭐ 简单                                       |
| **预估** | 前端 ~30 行 + CSS ~10 行                      |

### 实现方案

不需要美术知识，纯技术实现：

```css
/* CSS */
.stat-number {
  transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
}
```

```js
// JS — 数字跳动动画
function animateNumber(el, to, duration = 300) {
  const from = parseInt(el.textContent) || 0;
  const start = performance.now();
  const tick = (now) => {
    const t = Math.min((now - start) / duration, 1);
    el.textContent = Math.round(from + (to - from) * easeOutBack(t));
    if (t < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
function easeOutBack(t) {
  return 1 + 1.70158 * Math.pow(t - 1, 3) + 1.70158 * Math.pow(t - 1, 2);
}
```

### 需要修改

- `components/app-tree/render.js` — 更新统计时调用 `animateNumber()`
- `components/app-sidebar/loader.js` — 整合包卡片数字
- 不需要任何图片/设计资源

---

## 4️⃣ 批量操作（多选 + 批量动作）

| 项目     | 内容                                             |
| -------- | ------------------------------------------------ |
| **目标** | 仓库树支持多选文件，然后批量重命名/删除/启用禁用 |
| **难度** | ⭐⭐⭐ 较高                                      |
| **预估** | 前端 ~200 行                                     |

### 技术方案

```js
// 1. 进入多选模式（点工具栏"多选"按钮或长按 Ctrl）
let multiSelect = [];
tree.addEventListener("click", (e) => {
  if (!multiSelectMode) return;
  const fileEl = e.target.closest(".fl");
  if (!fileEl) return;
  fileEl.classList.toggle("selected");
  // 更新选中列表
});
```

**组件：**

- 仓库树工具栏加「多选」开关按钮
- 选中后底部弹出操作栏（批量重命名/删除/启用/禁用）
- 批量重命名 → 复用现有 `showBatchRenameDialog`

### 风险

- 中：树组件的事件系统需要改造
- 批量删除需要确认对话框

---

## 5️⃣ 撤销操作

| 项目     | 内容                                         |
| -------- | -------------------------------------------- |
| **目标** | 导入/重命名/删除后显示「撤销」按钮，点击回退 |
| **难度** | ⭐⭐⭐ 较高                                  |
| **预估** | Go ~100 行 + 前端 ~80 行                     |

### 技术方案

**核心思想：** 每个操作记录逆操作

```
操作: 导入文件 A
撤销: 删除文件 A（移入回收站）

操作: 重命名 A → B
撤销: 重命名 B → A

操作: 删除文件 A（移入回收站）
撤销: 从回收站恢复文件 A
```

**前端：**

- 全局撤销栈 `undoStack = []`
- 每个操作后 `undoStack.push({ type, undo })`
- toast 加「撤销」按钮（已有 `undo` 回调支持）
- 点击撤销 → 弹出逆操作确认 → 执行

**Go 端：**

- 导入撤销 → 直接调 `MoveToRecycle`
- 重命名撤销 → 直接调 `RenameFile`
- 删除撤销 → 需要新增 `UndoDelete`（从回收站恢复）

### 风险

- 高：回收站删除后不可恢复（永久删除无法撤销）
- 需要约束：只支持「移入回收站」的撤销，不支持「永久删除」

---

## 6️⃣ 网格/图标视图

| 项目     | 内容                                     |
| -------- | ---------------------------------------- |
| **目标** | 仓库树切换为网格布局，每个文件显示为卡片 |
| **难度** | ⭐⭐ 中等                                |
| **预估** | 前端 ~150 行 + CSS ~50 行                |

### 技术方案

```css
.grid-view {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 8px;
}
```

**需要了解：** YSM 模型文件是否内嵌预览图？

- 如果有 → 用 Go 端解析并返回 base64 缩略图
- 如果没有 → 只显示文件名+图标（和列表视图信息量差不多，意义有限）

**建议：** 此功能依赖 YSM 文件格式调研，先确认是否有预览图再决定是否做。

---

## 开发顺序建议

```
第 1 步: ① 文件夹结构 + ② 一键重命名    (2-3 小时)
第 2 步: ③ 数字动效                     (30 分钟)
第 3 步: ④ 批量操作                     (3-4 小时)
第 4 步: ⑤ 撤销操作                     (2-3 小时)
第 5 步: ⑥ 网格视图 (需先调研 YSM 格式) (依赖调研结果)
```

### 前置依赖

| 特性         | 依赖                     |
| ------------ | ------------------------ |
| ① 文件夹结构 | 无                       |
| ② 一键重命名 | 无                       |
| ③ 数字动效   | 无                       |
| ④ 批量操作   | ① 可选（批量重命名已有） |
| ⑤ 撤销操作   | Go 端新增 UndoDelete     |
| ⑥ 网格视图   | YSM 文件格式调研         |
