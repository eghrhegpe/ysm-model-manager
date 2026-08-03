# ADR-007：右键菜单代码组织决策

- **状态**：已采纳（Accepted）
- **日期**：2026-08-03
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`frontend/js/core/context-menus.js` / `frontend/js/components/context-menu.js` / `frontend/js/app-modules.js`

---

## 1. 背景（Context）

项目的右键菜单系统由两个文件组成：

| 文件 | 职责 | 行数 |
|------|------|------|
| `core/context-menus.js` | 菜单项定义 + 业务逻辑（513 行） | 最大单体 |
| `components/context-menu.js` | `<context-menu>` Web Component（134 行） | 渲染 |

**问题**：`context-menus.js` 是一个 513 行的单体，包含了：
- `ctx:show` 事件监听 → 解析 type（instance/batch/file） → 构建 items 数组 → 派发 `menu:show`
- 每个 menu item 的 `onClick` 里内联了**完整的业务逻辑**（弹窗 → Go 调用 → 结果处理 → toast）

具体表现为：

```js
// context-menus.js:280-305 — 重命名菜单项内联完整逻辑
{
  label: "重命名",
  icon: "✂️",
  onClick: async () => {
    try {
      const { showRenameDialog } = await import("../dialogs/rename.js");
      const fileName = path.split(/[/\\]/).pop();
      const newName = await showRenameDialog(path, fileName);
      if (!newName) return;
      const { RenameFile } = await import("../../bindings/.../app.js");
      await RenameFile(path, newName);
      refreshUI();
    } catch (e) {
      toast("❌ " + friendlyError(e, "重命名失败"), 4000, "error");
    }
  },
},
```

每个菜单项的 `onClick` 都是一个完整的异步操作链，包含 import、Go 调用、错误处理和 toast。

---

## 2. 决策（Decision）

**决策**：右键菜单项的 `onClick` 保留内联业务逻辑，不抽成独立函数模块。

### 2.1 保持内联的理由

- **菜单项与操作一一对应**：每个菜单项只出现在一个上下文中，抽成模块会增加文件数而不减少重复
- **错误处理就近**：每个操作的成功/失败反馈（toast）与触发点紧邻，抽成模块后需要额外事件回传
- **动态 import 粒度**：每个操作按需 import 对应的 dialog/Go binding，避免 app-modules.js 预加载所有模块

### 2.2 已做的防重复措施

`app-sidebar/events.js` 中已有明确的防重复绑定逻辑：

```js
// app-sidebar/events.js:13-27
if (list === _lastList && _clickHandler) {
  restoreSelectedCard(root, instances);
  return () => {};
}
if (_lastList && _clickHandler) {
  _lastList.removeEventListener("click", _clickHandler);
  _lastList.removeEventListener("contextmenu", _contextHandler);
}
```

侧栏卡片的事件绑定会检查"监听的元素是否相同"来避免重复注册。

---

## 3. 后果（Consequences）

### 正面
- 菜单结构清晰，`ctx:show` → 解析 type → 构建 items 是一条单一数据流
- 新增菜单项只需在对应 type 分支加一个对象，无需创建新文件
- 错误处理与操作紧邻，调试时容易定位

### 负面
- `context-menus.js` 513 行是前端的第二大 JS 单体（仅次于 `site-view.js` 1268 行）
- 菜单项的 `onClick` 难以独立测试（需要 mock dialog + Go binding + toast）
- 如果未来菜单项复用（如同一操作出现在多个 type 的菜单中），代码必然重复

### 改进方向（不做 ADR，仅记录）
- 如果菜单项数量继续增长（超过 30 个），应考虑按 type 拆分：`menus/instance.js` / `menus/batch.js` / `menus/file.js`
- 抽公共操作为独立函数（如 `_handleRename` / `_handleMove`），保留 `onClick` 内联只是调用

---

## 4. 相关：两套菜单系统并存

项目中存在两套右键菜单机制：

| 机制 | 触发 | 消费 | 状态 |
|------|------|------|------|
| `ctx:show` → `menu:show` | `app-tree` / `app-sidebar` 的 `contextmenu` 事件 | `context-menus.js` 转换 → `<context-menu>` Web Component | ✅ 主路径 |
| `app-sidebar` 内部 `vc-context-menu` | `app-sidebar` 自己的卡片右键 | 独立渲染 | ✅ 兼容遗留 |

`app-sidebar/events.js` 在每次绑定时执行 `root.querySelectorAll(".vc-context-menu").forEach(el => el.remove())` 清除旧的右键容器，防止两种机制共存。

---

## 5. 数据溯源

| 来源 | 结果 |
|------|------|
| `frontend/js/core/context-menus.js` | 513 行，包含 3 个 type 分支的完整菜单定义 |
| `frontend/js/components/context-menu.js` | 134 行，Web Component 渲染器 |
| `frontend/js/components/app-sidebar/events.js` | 防重复绑定逻辑 |
| `docs/archive/reference/events.md` | 事件规范中 `ctx:show` / `menu:show` 定义 |
| `docs/architecture/bug-chronicle.md` §3 | 文件夹右键菜单按钮冗余记录 |
