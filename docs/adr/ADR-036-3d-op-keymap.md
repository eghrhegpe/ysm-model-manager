# ADR-036：3D 预览操作键位与相机偏好可配置

- **状态**：✅ 已采纳
- **日期**：2026-08-04
- **决策人**：Jieling（人类首席架构师）、AI 代理（Riku）
- **相关**：`frontend/js/utils/model3d.ts`、`frontend/js/components/app-preview/preview-skeleton.ts`、`frontend/js/components/app-content/tpl.ts`、`frontend/js/components/app-content/community/settings.ts`

---

## 1. 背景（Context）

全屏 3D 预览（Three.js 自由相机）原本把移动键位（WASD + 方向键兜底、Space/Shift 升降）与相机速度、旋转模式**硬编码**在 `model3d.ts` 的渲染循环里，且相机速度滑块 / 旋转模式下拉在预览顶栏内每次打开都是默认值、未持久化。用户提出：希望在设置里允许更改 3D 操作键，尤其是非 QWERTY 布局（如 AZERTY）下 WASD 错位、以及个人操作习惯差异。

## 2. 决策（Decision）

将 3D 操作偏好统一收为**前端 localStorage 持久化**（与现有 UI 偏好 `ui-font-size` 等同源，无需改动 Go 后端 `AppConfig`）：

- **键位以 `KeyboardEvent.code`（物理键）存储**，跨键盘布局一致；方向键（ArrowUp/Down/Left/Right）保留为通用兜底，任何键位方案下都可用。
- 默认键位：`forward=KeyW / back=KeyS / left=KeyA / right=KeyD / up=Space / down=ShiftLeft`。
- **相机速度**（2–200，默认 20）与**旋转模式**（orbit 环绕 / free 自身）一并持久化，预览顶栏控件打开时从持久化值初始化、变更时回写。
- 设置页「界面与体验」新增 **🕹️ 3D 预览操作** 区块：速度滑块、旋转模式下拉、6 个键位捕获按钮（点击→按任意键重绑，含冲突检测与恢复默认）。

实现要点：
- `model3d.ts` 暴露 `DEFAULT_TD_KEYMAP` / `loadTdKeymap()` / `loadTdCamSpeed()` / `loadTdRotMode()`；`renderModel3D` 初始化时读取，`onKeyDown/onKeyUp` 改用 `e.code` 查表，`loop` 移动判定按 keymap（方向键兜底）。
- `preview-skeleton.ts` 顶栏滑块/下拉与 localStorage 双向同步。
- `settings.ts` 动态渲染键位网格，捕获阶段 `stopPropagation` 防误触，重复绑定提示冲突。

## 3. 后果（Consequences）

- **正面**：终端用户可在设置内自定义 3D 移动键与相机参数；AZERTY 等非 QWERTY 用户受益；速度/旋转偏好跨会话保持。
- **负面 / 成本**：设置页与 `model3d` 之间新增 `localStorage` 键耦合（`td-keymap` / `td-cam-speed` / `td-rot-mode`），需版本演进时留意迁移；`settings.ts` 引入了对 `model3d.ts` 的导入（间接拉入 three，但应用早已全局依赖 three，无新增成本）。
- **已知遗留**：`f` 键的调试模式切换（pivot/bone）仍硬编码，未纳入可配置项（属调试功能，非操作键）；未做键位方案的导入/导出。

## 4. 数据溯源

- 来源：`docs/knowledge/model3d.md`（3D 渲染层 spec 与 `renderModel3D` 句柄 API）、`frontend/js/utils/model3d.ts`（键位处理段第 317–389 行原 `e.key.toLowerCase()` 硬编码）、`frontend/js/components/app-preview/preview-skeleton.ts`（顶栏速度/旋转控件未持久化）、`frontend/js/components/app-content/community/settings.ts`（UI 偏好统一走 localStorage）。
- 结果：新增 ADR-036，落地设置内 3D 操作键位/相机偏好可配置；`tsc --noEmit` 与 `vite build` 通过。

<!-- 文件名: 3d-op-keymap.md → 实际文件 ADR-036-3d-op-keymap.md -->
