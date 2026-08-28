---
kind: preview_panel_declarative
name: 3D 预览面板内容声明式化通道（ADR-126 P4-B）
tier: leaf
category: ui
source_files:
  - frontend/src/utils/3d/adapters/preview-menu.ts
  - frontend/src/utils/3d/adapters/preview-menu-render.ts
  - frontend/src/utils/3d/adapters/preview-menu-node-types.ts
  - frontend/src/utils/3d/adapters/mmd-adapter.ts
  - frontend/src/utils/3d/adapters/ysm-adapter.ts
  - frontend/src/views/app-preview/mmd-controls.ts
  - frontend/src/views/app-preview/ysm-controls.ts
  - frontend/src/views/app-preview/shot-panel-shared.ts
tests:
  - frontend/src/utils/3d/adapters/preview-menu-items.test.ts
  - frontend/src/views/app-preview/mmd-controls.test.ts
  - frontend/src/views/app-preview/ysm-controls.test.ts
use_when:
  - 新增 3D 预览面板内容（统计 / 纹理 / 按钮组 / 信息卡）
  - 评估"面板内容该走 renderCustom 还是 children 声明式"
  - 排查面板内容不出现 / 渲染通道冲突
  - P4-B 子步（1→2→3）状态通道复用参考
---

# 3D 预览面板内容声明式化通道（ADR-126 P4-B）

## 概览

ADR-125 把**设置面板**的控件统一到 `MenuControlDef[]`（B 层单渲染器）。ADR-126 P4-B 把同一方向的**面板内容**（统计/纹理/按钮组/信息卡——非控件的内容展示）也声明式化：panel 节点带 `children: PreviewMenuNode[]`，渲染走 `renderMenu`（preview-menu-render.ts），消灭「面板内容手写 DOM 闭包」的第二渲染通道。

**P4-B 分三小步**（ADR-126 §2.1 拆解）：P4-B-1 验证通道（MMD 信息卡 + 截图按钮组）→ P4-B-2 YSM 截图声明式化（`fill3DPanel` 统计/纹理/模型选择器**保留逃生舱**——含多组件切换动态视图状态，非静态内容）→ P4-B-3 morph/play 交互面板。`fillRoles` **不在范围**（实测已声明式：sceneRegistry + menuItems 过滤 + SlideMenuView 驱动）。

## 核心机制

### renderPreviewPanel children 分支（preview-menu.ts）

`renderPreviewPanel` 的渲染通道五级衰退：

```
schemaBuilders（声明式 schema）→ children（声明式节点，P4-B 新增）→ renderCustom（命令式逃生舱）→ action（动作）→ fillers（过程式映射）
```

children 分支：`node.children?.length` 时递归 `renderMenu(list, node.children, { makeRow, makePanelView, menu, actionCtx })`。

### panel + children 是合法组合

`PreviewMenuNode.children` 注释已更新：「folder：子节点（可折叠）；panel：面板内容声明式子节点」。类型层不限制 kind——`isPreviewFolderNode` 只在 renderMenu 顶层分派用，renderPreviewPanel 的 children 分支独立处理。

### 条件注入范式（对齐 bonePanel）

能力缺失 → **不注入项**，而非注入空 children 面板：

- `mmdMenuItems` 的 shot 面板：`if (o.screenshot) items.push(shot节点)`——screenshot 为 null 时无 shot 项（测试断言 `expectNotContains(ids, ["shot"])`）
- 对齐 ADR-093 `bonePanel` 条件注入范式
- **例外（YSM）**：YSM 的 screenshot 是 **ctx 可选字段**（undefined = 走 saveScreenshot fallback，面板常驻），故 YSM shot **始终注入**（不做条件注入）

### 截图面板共享层（shot-panel-shared.ts，P4-B-2）

MMD 与 YSM 截图面板同构（6 角度按钮 + 截图副作用），共享 `SHOT_KEYS` / `SHOT_LABELS` / `makeShotAction` / `shotButtonNodes`，杜绝两处复制：

- `makeShotAction(modelForSave, screenshotFn)`：防连点 guard + toast 错误提示；**修正**原 `fillMmdShotPanel` 的 `saveScreenshot` 第三参误传 bug（截图走 fallback 而非活跃渲染器）
- `shotButtonNodes(modelForSave, screenshotFn)`：6 button 节点；`screenshotFn === null` 返回空数组（MMD），`undefined` 仍返回（YSM fallback）

## 对外 API / 入口

```ts
// 声明式节点工厂（新面板路径）
mmdModelInfoNodes(ctx): PreviewMenuNode[]   // MMD 信息卡 2 行 field（纯数据零 DOM）
mmdShotNodes(ctx, screenshotFn): PreviewMenuNode[] // MMD 截图 6 button（screenshot null → []，条件注入）
ysmShotNodes(ctx): PreviewMenuNode[]        // YSM 截图 6 button（screenshot undefined → 面板常驻，无条件注入）

// 截图共享层（views/app-preview/shot-panel-shared.ts）
SHOT_KEYS / SHOT_LABELS                     // 六角度键 + i18n 键（防两处漂移）
makeShotAction(modelForSave, screenshotFn)  // 截图副作用（防连点 + toast）
shotButtonNodes(modelForSave, screenshotFn) // 6 button 节点

// 渲染通道（panel 节点可选其一）
children: PreviewMenuNode[]                 // 声明式（P4-B 通道，推荐新面板）
renderCustom: (container, closePopup) => void // 命令式逃生舱（既有面板兼容；fill3DPanel 动态内容保留）
```

## 与其他子系统关系

- **ADR-125**：设置面板走 `MenuControlDef[]`（B 层），本卡的面板内容走 `PreviewMenuNode[]`（A 层 children）——两条声明式通道各自独立，不混用。
- **renderMenu**（preview-menu-render.ts）：children 内容的渲染器，支持 field/button/row/folder/divider/sectionTitle + 逃生舱。
- **mmd-adapter / mmd-controls**：P4-B-1 试点——model 面板改 `children: mmdModelInfoNodes`，shot 面板条件注入 `children: mmdShotNodes`；`fillMmdModelPanel` / `fillMmdShotPanel` 保留（向后兼容 + 既有测试零回归）。
- **ADR-085**：S2「状态单向流」的大方向——面板内容从命令式 DOM 构建收敛为数据节点。

## 不变量

1. **panel 必有渲染通道**：renderCustom（命令式逃生舱）或 children（声明式节点）二选一——契约测试 `preview-menu-items.test.ts` 断言。
2. **能力缺失 → 不注入项**（条件注入），不注入空 children 面板（对齐 bonePanel 范式）。
3. **声明式节点零 DOM**：`mmdModelInfoNodes` / `mmdShotNodes` 是纯数据工厂，不碰 `document`（与 fillXxxPanel 命令式形成对照）。
4. **新旧通道并存**：`fillMmdModelPanel` / `fillMmdShotPanel` 保留兼容，新面板路径走 children——每步独立可回滚。
5. `fillRoles` **不在 P4-B 范围**（已声明式，实测 sceneRegistry + menuItems + SlideMenuView 驱动）。

## 相关

- ADR-126（本决策 P4-B）、ADR-125（设置面板单渲染器）、ADR-085（声明式收敛方向）、ADR-093（条件注入范式）
- 落地：P4-B-1（mmd model/shot 声明式化）+ P4-B-2（YSM 截图声明式化 + 截图共享层）已完成；P4-B-3（morph/play）待续
- 保留逃生舱：`fill3DPanel` 统计/纹理/模型选择器（多组件切换动态视图状态，声明式化收益低风险高——P4-B-2 决策）
- 顺手修复：`fillMmdShotPanel` / `fillYsmShotPanel` 的 `saveScreenshot` 第三参误传 `screenshotFn`（被当 setShotState），实际截图走 fallback 而非活跃渲染器——`makeShotAction`（shot-panel-shared.ts）已修正（第四参传 screenshotFn）
