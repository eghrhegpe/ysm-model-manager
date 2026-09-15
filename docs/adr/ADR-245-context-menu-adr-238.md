# ADR-245：context-menu 图标语义名统一（对齐 ADR-238）

- **状态**：已采纳（Accepted）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-15
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：[ADR-238] 图标语义名规范；[ADR-021] 声明式菜单；[ADR-239] 工具栏下拉收敛；`frontend/src/views/app-tree/toolbar-menus.ts`（先行落地范式）

---

## 1. 背景（Context）

右键菜单（`<context-menu>` / `features/context-menu/menu-defs.ts`）的菜单项 `icon` 字段当前填的是**彩色 emoji 字面量**（`📂/📄/🗑️/✂️/📋/♻️/🏷️/📦/📝/🗂`），由 `views/context-menu/index.ts` 直接 `esc()` 当文本塞进 `<span class="icon">`。

而工具栏下拉（ADR-239）早已落地 `icon` = 语义名（`folderOpen`/`file`/`refresh`/`book`…），经 `resolveIcon()` 查 `ICON_KIT`/`UI_ICONS` 解析成**白色描边 SVG**（随主题、`--fs-scale` 走，跨平台一致）。两套体系并存的后果：

- 同一个桌面应用里，右键菜单彩色 emoji、工具栏白色 SVG，视觉分裂（正是用户连续几轮感知到的"图标风格不统一"）。
- emoji 跨平台颜色不一致、不受主题/字号控制，违反 ADR-238 的净化目标。
- `resolveIcon()` 目前是 `toolbar-menus.ts` 的私有函数，无法被 context-menu 复用，重复实现风险。

## 2. 决策（Decision）

1. **把 `resolveIcon` 下沉为共享纯函数** `utils/icon/resolve.ts`，导出 `resolveIcon(name): string`：`ICON_KIT`（多源）优先，`UI_ICONS`（SVG）兜底，未命中返回 `""`。`toolbar-menus.ts` 改为 import 复用，删除本地副本。
2. **context-menu 的 `icon` 字段支持「语义名 → SVG」解析**，保持渐进兼容：
   - 渲染时 `icon` 命中共享图标源（语义名）→ 输出 SVG HTML（不 escape）；
   - 否则（emoji 或任意字符串）→ 维持原有 `esc()` 文本行为作兜底，**未迁移的调用方零破坏**。
3. **`menu-defs.ts` 四类右键菜单的 icon emoji 全部替换为 UI_ICONS 语义名**（声明式集中地，一处改全菜单生效）：
   - `📂`→`folderOpen`、`📄`→`file`/`note`、`🗑️`→`delete`、`✂️`→`cut`、`📋`→`clipboard`、`♻️`→`recycle`、`🏷️`→`tag`、`📦`→`package`、`📝`→`edit`、`🗂`→`folder`（新建子文件夹近似）。
4. **不动**：`menu-defs` 中 `label` 内的 emoji 展示项（instance/workshop 标题与数据展示，属正文语义，非图标位）；`resource_types.json` 派生的资源类型图标（💎/🎭…，回归红线）；`preview-3d/menu/*`（受 MenuNode schema 管辖，独立子系统）。

## 3. 后果（Consequences）

- **正面**：右键菜单图标与工具栏统一为 SVG 体系，随主题/字号，跨平台一致；消除彩色 emoji 残留；`resolveIcon` 单一事实源，未来菜单（nav/dialogs/settings）迁移可复用。
- **负面**：`menu-defs` 约 25 处字符串替换；`index.ts` 渲染需分支（语义名 vs emoji 兜底）。
- **已知遗留**：`features/context-menu/*` handlers、`app-tree/bus-handlers.ts`、`dialogs`、`maintenance`、`recycle-bin`、`app-nav`、`settings` 的 emoji 图标（约 25+ 处）仍走兜底路径，后续可分批迁移，本次不强制（范围见本次"重点"决策）；`index.test.ts` 的 `📂` 断言需随 menu-defs 迁移同步改。

## 4. 数据溯源

- 来源：`frontend/src/views/context-menu/index.ts`（line 152 icon 文本渲染）、`features/context-menu/menu-defs.ts`（25 处 emoji）、`views/app-tree/toolbar-menus.ts`（line 12 `resolveIcon` 私有）。
- 结果：① 新增 `utils/icon/resolve.ts`；② `index.ts` icon 分支持 SVG；③ `menu-defs.ts` icon 语义名化。

<!-- 文件名: context-menu-adr-238.md → 实际文件 ADR-245-context-menu-adr-238.md -->
