# ADR-076：3D 预览通用导航与弹窗脚手架收敛契约（v3 — 声明式根菜单 + 适配器项收编）

- **状态**：✅ 已采纳
- **被取代**：[ADR-079](./ADR-079-wasm-pthread-mt-decode.md) 取代
- **被补充**：[ADR-106](./ADR-106-preview-env-menu-drill-visual.md) 在本 ADR 的声明式根菜单外壳之上，扩展两级下钻、分组折叠、跨 cap 预设联动、4 种可视化控件类型（image/color/timeline/histogram）
- **日期**：2026-08-16
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`frontend/src/preview-3d/adapters/mount-preview-core.ts`、`frontend/src/utils/3d/adapters/preview-menu-defs.ts`、`frontend/src/utils/3d/adapters/preview-menu.ts`、`frontend/src/views/app-preview/ysm-controls.ts`、`frontend/src/views/app-preview/mmd-controls.ts`、`ADR-075`、`ADR-073`、`ADR-072`、`ADR-077`、`ADR-066`、`ADR-021`

> **v2 重定向（2026-08-16 用户二次拍板）**：原 v1 方案为「底部悬浮导航 + 分类弹窗外壳」。
> 用户明确：**「顶层都可以不要了，关闭相当于退出 3D，可以新增设置根菜单放那里，这样全局都走声明式菜单，e2e 不容易载跟头」**。
> 故推翻 v1 底部导航形态，改为 **overlay 内 ⚙️ 声明式根菜单**（对齐 ADR-021 `menu-defs.ts` 表驱动范式），
> 顶栏彻底消失。本 ADR 下文 D1–D4 均为 v2 口径。

---

## 1. 背景（Context）

### 1.1 环境菜单已收敛（ADR-075），但「菜单外壳」仍各写一套

ADR-075 已把**环境类控件**（地面/时间-of-day/云量/IBL）收进 `mount-preview-core.ts` 的统一「🌍 环境菜单」（slide-menu 版，commit `7d425a10`），四种模型零改动继承。

但**预览导航 + 分类弹窗的脚手架**仍由各适配器各写一套，与 ADR-066 §1.3 警告的「格式散装 / 各写一套」同构：

| 重复 | 证据（file:line） |
|------|------------------|
| `mkNavBtn`（按钮工厂） | `ysm-controls.ts:62` 与 `mmd-controls.ts:255` 两份逐字拷贝 |
| nav + popup + `togglePopup` + `closePopup` 同构脚手架 | `ysm-controls.ts` 与 `mmd-controls.ts`（`buildYsmBottomNav`/`buildMmdBottomNav` 各自 ~150 行） |
| 相机控件 `buildCameraControls` | core 顶栏一份 + `ysm-controls.ts` + `mmd-controls.ts` 各一份 |

### 1.2 根因：能力/环境已收敛，但「菜单外壳」未收敛

- **能力层**（sky/ground）已下沉 core（ADR-073 caps/ 套路）；
- **环境 UI** 已收进 core（ADR-075 slide-menu）；
- **菜单外壳**（顶栏导航 + 弹窗 toggle/close）仍是「各适配器各写一套」——这是最后一块未收敛的 UI 脚手架。

### 1.3 v2 触发：用户决策砍掉顶栏，走声明式根菜单

顶栏（关闭/切换/环境/相机）在预览全屏 overlay 下既挤占空间、又让 e2e 选择器飘忽。用户决策：
**顶栏整体移除，所有预览控件收进 overlay 内单一 ⚙️ 根菜单**，以 `PREVIEW_MENU_DEFS` 表驱动渲染，
测试遍历表断言结构，e2e 不再踩飘忽 overlay DOM（「不载跟头」）。

---

## 2. 决策（Decision，v2 口径）

### D1 · 顶栏砍掉，收敛为 overlay 内 ⚙️ 声明式根菜单

`mount-preview-core.ts` 不再渲染顶栏。预览控件（关闭/切换/环境/相机）全部来自**唯一事实来源**
`PREVIEW_MENU_DEFS`（`preview-menu-defs.ts`），由 `mountPreviewRootMenu`（`preview-menu.ts`）渲染
⚙️ 根按钮 + 弹出菜单。范式对齐 ADR-021 `core/menu-defs.ts`：结构表 + 测试遍历断言。

```ts
// preview-menu-defs.ts — 唯一事实来源（仅描述结构）
export const PREVIEW_MENU_DEFS: PreviewMenuItemDef[] = [
  { id: "close",       icon: "✕",  labelKey: "preview.close3d",      kind: "action", danger: true,  legacyTestId: "ysm-close-3d" },
  { id: "switch",      icon: "🔁", labelKey: "preview.switchModel",   kind: "panel",  needsSiblings: true, legacyTestId: "mmd-switch" },
  { id: "div-env",     icon: "",   labelKey: "",                      kind: "divider" },
  { id: "environment", icon: "🌍", labelKey: "preview.environment",   kind: "panel",  legacyTestId: "env-menu-btn" },
  { id: "camera",      icon: "🎥", labelKey: "preview.cameraView",    kind: "panel",  sharedOnly: true },
];
```

core 拥有外壳（根按钮 + 弹出 + document 点击解绑），适配器 **Phase 2 只声明 `previewMenuItems`、不碰脚手架**。

### D2 · 环境菜单并入根菜单（复用 ADR-075 已落地项）

ADR-075 已落地的「🌍 环境菜单」（地面/时间/云量/IBL）作为根菜单固定 `environment` 项，由 core 自动注入，
复用其 `fillEnvironment` 行。适配器不感知、零改动。环境是「场景级共用设置」，天然不属于任何单一适配器的专属菜单。

### D3 · 相机控件下沉根菜单「camera」项

`buildCameraControls`（旋转/速度/重置）作为根菜单 `camera` 项（`sharedOnly`，self 模式由适配器底部导航提供，避免双份），
复用 `camBridge`，消灭 core 顶栏 + ysm + mmd 三份重复。`camBridge` 在 `mount3D` 内定义并保留给根菜单 camera 项复用。

### D4 · 落地范围（v3）

- **Phase 1**：
  - 顶栏整块移除（closeBtn/switchSel/spacer/环境菜单块/相机顶栏调用 + `overlay.appendChild(topBar)`）；
  - 新增 `preview-menu-defs.ts`（PREVIEW_MENU_DEFS）+ `preview-menu.ts`（`mountPreviewRootMenu` + `fillEnvironment` + `fillSwitch`）；
  - `mount3D` 在 `overlay` 内挂载根菜单（⚙️ 按钮 `preview-menu-btn` + 弹出 `ysm-preview-menu`），`close` 复刻原 `closeBtn` 分支（`cleanupFn?fullCleanup:closeOverlay`），`fullCleanup` 内解绑 document 监听；
  - 切换后 `currentPath = newPath` 同步根菜单高亮（ADR-066 §5.6）；
  - 适配器底部导航容器 `topBar` 重建为**底部容器**（承接 `extraControls(topBar)`），Phase 2 收编；
  - 三语 locale 补齐 7 键（settings/back/switchModel/noOtherModel/timeOfDay/cloudCoverage/environmentLight）。
- **Phase 2**：
  - **契约修正**：落地为 `PreviewBuildCtx.menu`（`PreviewMenuHandle`：`setAdapterItems` 替换适配器项 / `openPanel` 打开面板 / `dispose` 解绑），而非预想的静态 `PreviewAdapter.previewMenuItems`——因为适配器菜单项（model/material/play/bones）依赖 build 后内容（mmd/mesh/model/handle），只能在 build 内经注册通道注入。`PreviewMenuItemDef` 扩展 `render?`（panel 填充）/ `run?`（action 执行）；
  - **ysM 收编**：`buildYsmBottomNav`/`mkNavBtn`/`popupSection`/`popupRow` 删除，`ysm-controls.ts` 瘦身为面板填充模块（`fillYsmModelPanel`/`fillYsmShotPanel`/`attachYsmBoneSelect`）；ysM 注册 model/截图/骨骼 三项；顺带修复两处现存缺陷（navBuilder 死参数——ysM 底部导航从未挂载；骨骼按钮找不存在的 `#ysm-3d-panel`——点击无效）；
  - **mmd 收编**：`buildMmdBottomNav`/`mkNavBtn`/slide-menu 弹窗删除，`mmd-controls.ts` 瘦身为面板填充模块（`fillMmdModelPanel`/`fillMmdPlayPanel` + 保留 `buildMaterialControls`）；mmd 注册 model/材质/播放 三项 + ADR-077 骨骼项（并行落地，仲裁收编为 bones 菜单项）；切换归 core switch 项、相机归 core camera 项，消灭双入口；
  - **测试**：新增 `preview-menu.test.ts`（表遍历 + 句柄行为，12 例）；重写 `ysm-3d.test.ts`/`mmd-adapter.test.ts`/`mmd-controls.test.ts` 为菜单项断言（30 例全绿）；
  - 验证：`tsc --noEmit` 全仓零错、`vite build` 通过（exit 0）、受控 vitest 30/30 通过。
- **Phase 3（待立项）**：vrm/litematic 的 `extraControls(topBar)` 单按钮（骨骼/分层/切换）收编为声明式菜单项——非「各写一套底部导航」重复（单按钮，无弹窗脚手架），故 Phase 2 未动，后续轮次统一。

---

## 3. 后果（Consequences）

**正面**：
- 预览 UI 从「顶栏 + 各适配器底部导航 + 弹窗」三套 bespoke DOM 收敛为**一个声明式根菜单**，core 拥有外壳、适配器只声明内容；
- e2e 选择器稳定可遍历（PREVIEW_MENU_DEFS + `data-testid="preview-<id>"` + 保留 legacyTestId `ysm-close-3d`/`env-menu-btn`/`mmd-switch`），告别飘忽 overlay DOM；
- 环境/相机作为 core 固定项自动并入，四种模型零改动；相机控件单点，消灭三份重复；
- 顶栏消失，预览全屏更干净。

**负面 / 风险**：
- 🟡 UI 外壳契约变更（根菜单取代顶栏 + 适配器底部导航），e2e 断言已随测试重写迁移到 `data-testid="preview-<id>"`；
- 🟡 `fill3DPanel` 内部选择器依赖旧弹窗 id——Phase 2 后其渲染容器为根菜单面板（`.ysm-preview-menu`），骨骼拾取滚动高亮选择器已同步放宽；
- 🟢 legacy e2e 选择器（`ysm-close-3d`/`env-menu-btn`/`mmd-switch`）+ 适配器项 legacyTestId（`ysm-model-entry`/`mmd-model-entry` 等）均保留，未断链；
- 🟢 vrm/litematic `extraControls(topBar)` 契约保留（Phase 3 收编），topBar 底部容器保留，无回归。

**已知遗留（Phase 2 边界）**：
- vrm/litematic 的 `extraControls` 单按钮（骨骼/分层/切换）仍走 topBar，Phase 3 收编为菜单项后删除容器；
- `.ysm-3d-navbtn` 等毛玻璃样式类（fab.ts）保留（CSS 残留，无 JS 依赖），供后续复用。

---

## 4. 数据溯源

- **来源**：用户对话（2026-08-16）：
  - v1 立项：「继续审核看看，感觉共享架构还得优化，看看怎么设计通用弹窗按钮，比如环境是共用设置的？」（方案 A：先出 ADR，编码待立项）；
  - v2 重定向：「通用弹窗按钮重复仍在，环境菜单已被 ADR-075 覆盖，出 ADR-076 聚焦通用弹窗脚手架收敛，开始折腾大统一吧」；
  - v2 拍板：「顶层都可以不要了，关闭相当于退出 3D，可以新增设置根菜单放那里，这样全局都走声明式菜单，e2e 不容易载跟头」；范围：「先 Phase1 保底」；
  - Phase 2 批准：「折腾吧」（2026-08-16，适配器专属控件收编 + 删 buildYsm/MmdBottomNav + 重写测试）。
- **审计证据（file:line）**（Phase 1 基线，Phase 2 已删除/迁移，留档）：
  - `frontend/src/views/app-preview/ysm-controls.ts:62/147/156/192` — `mkNavBtn`/`closePopup`/`togglePopup`/`buildCameraControls`（脚手架，Phase 2 已删）；
  - `frontend/src/views/app-preview/mmd-controls.ts:68/82/221/255` — 同构脚手架（`createSlideMenu` 版，Phase 2 已删）；
  - `frontend/src/preview-3d/adapters/mount-preview-core.ts` — core 顶栏的 `buildCameraControls`（已迁根菜单 camera 项）。
- **关联 ADR**：ADR-075（环境菜单已收敛，本 ADR 的环境项复用其落地）、ADR-073（能力层 caps 共享）、ADR-072（3D 归置）、ADR-077（骨骼面板统一，Phase 2 并行落地经仲裁收编为 bones 菜单项）、ADR-066（统一预览契约 + 单一渲染核心）、ADR-021（声明式菜单范式 `menu-defs.ts`，本 ADR 根菜单镜像其表驱动 + 测试遍历机制）。
- **决策**：v1 通用底部导航 + 弹窗脚手架收敛契约已定；v2 用户重定向为声明式根菜单（Phase 1 落地）；v3 Phase 2 将 ysm/mmd 适配器专属控件经 `PreviewBuildCtx.menu.setAdapterItems` 收编进根菜单，删除两份底部导航脚手架。vrm/litematic `extraControls` 单按钮保留至 Phase 3。
