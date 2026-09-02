---
kind: preview_panel_declarative
name: 3D 预览面板内容声明式化通道（ADR-126 P4-B）
tier: leaf
category: ui
source_files:
  - frontend/src/preview-3d/menu/core.ts
  - frontend/src/preview-3d/menu/render.ts
  - frontend/src/preview-3d/menu/node-types.ts
  - frontend/src/preview-3d/adapters/mmd-adapter.ts
  - frontend/src/preview-3d/adapters/ysm-adapter.ts
  - frontend/src/preview-3d/adapters/morph-controls.ts
  - frontend/src/views/app-preview/mmd-controls.ts
  - frontend/src/views/app-preview/ysm-controls.ts
  - frontend/src/views/app-preview/shot-panel-shared.ts
auto_fields:
  symbols_with_lines:
    - buildMmdScene:1501
    - buildPreviewMenuRouters:181
    - buildYsmScene:500
    - CameraControlBridge:19
    - collectPreviewLeafNodes:128
    - collectPreviewNodeIds:141
    - fillMmdModelPanel:44
    - fillMmdShotPanel:213
    - fillYsmShotPanel:74
    - isPreviewFolderNode:123
    - makeShotAction:34
    - makeYsmAdapter:531
    - MaterialControlBridge:180
    - MmdBottomNavCtx:29
    - MmdDataPort:89
    - mmdMenuItems:1614
    - MmdMenuItemsOpts:1582
    - mmdModelInfoNodes:62
    - MmdPanelHooks:158
    - MmdPlayBridge:96
    - mmdShotNodes:197
    - MorphMeshLike:10
    - morphNodes:20
    - mountPreviewRootMenu:467
    - playNodes:114
    - PreviewActionMenuCtx:17
    - PreviewControlSpec:40
    - PreviewMenuCtx:38
    - PreviewMenuHandle:74
    - PreviewMenuNode:68
    - PreviewMenuNodeKind:23
    - PreviewMenuRouters:169
    - registerYsmModelSchema:105
    - renderAdapterPanelContent:482
    - renderCapControls:70
    - renderMenu:35
    - renderPreviewPanel:225
    - roleBaseName:34
    - shotButtonNodes:65
    - YsmAdapterOptions:44
    - YsmContentHandle:33
    - YsmControlsContext:46
    - ysmMenuItems:592
    - YsmMenuItemsOpts:550
    - YsmModel:24
    - ysmShotNodes:69
  tests:
    - frontend/src/preview-3d/menu/items.test.ts
    - frontend/src/preview-3d/adapters/morph-controls.test.ts
    - frontend/src/views/app-preview/mmd-controls.test.ts
    - frontend/src/views/app-preview/ysm-controls.test.ts
  quick_groups:
    - 3D 预览与模型追加
  quick_intents:
    - 新增 3D 预览面板内容（统计 / 纹理 / 按钮组 / 信息卡）
    - renderCustom vs children 声明式
    - P4-B 子步（1→2→3）状态通道复用
  quick_risk_lines:
    - 3D 预览面板内容必须走声明式菜单节点（children / renderCustom），禁止在 adapter 里手写 DOM
  pitfalls:
    - adapter 手写 DOM → 与声明式菜单系统不一致、面板内容不出现；必须走声明式节点
    - renderCustom 与 children 混用 → 渲染通道冲突；必须二选一
  use_when:
    - 新增 3D 预览面板内容（统计 / 纹理 / 按钮组 / 信息卡）
    - 评估"面板内容该走 renderCustom 还是 children 声明式"
    - 排查面板内容不出现 / 渲染通道冲突
    - P4-B 子步（1→2→3）状态通道复用参考
  perf:
    - gpu-bound
tests:
  - frontend/src/preview-3d/menu/items.test.ts
  - frontend/src/preview-3d/adapters/morph-controls.test.ts
  - frontend/src/views/app-preview/mmd-controls.test.ts
  - frontend/src/views/app-preview/ysm-controls.test.ts
quick_groups:
  - 3D 预览与模型追加
quick_intents:
  - 新增 3D 预览面板内容（统计 / 纹理 / 按钮组 / 信息卡）
  - renderCustom vs children 声明式
  - P4-B 子步（1→2→3）状态通道复用
quick_risk_lines:
  - 3D 预览面板内容必须走声明式菜单节点（children / renderCustom），禁止在 adapter 里手写 DOM
pitfalls:
  - adapter 手写 DOM → 与声明式菜单系统不一致、面板内容不出现；必须走声明式节点
  - renderCustom 与 children 混用 → 渲染通道冲突；必须二选一

use_when:
  - 新增 3D 预览面板内容（统计 / 纹理 / 按钮组 / 信息卡）
  - 评估"面板内容该走 renderCustom 还是 children 声明式"
  - 排查面板内容不出现 / 渲染通道冲突
  - P4-B 子步（1→2→3）状态通道复用参考
perf:
  - gpu-bound

status: active
---

# 3D 预览面板内容声明式化通道（ADR-126 P4-B）

## 概览

ADR-125 把**设置面板**的控件统一到 `MenuControlDef[]`（B 层单渲染器）。ADR-126 P4-B 把同一方向的**面板内容**（统计/纹理/按钮组/信息卡——非控件的内容展示）也声明式化：panel 节点带 `children: PreviewMenuNode[]`，渲染走 `renderMenu`（preview-menu/render.ts），消灭「面板内容手写 DOM 闭包」的第二渲染通道。

**P4-B 分三小步**（ADR-126 §2.1 拆解）：P4-B-1 验证通道（MMD 信息卡 + 截图按钮组）→ P4-B-2 YSM 截图声明式化（`fill3DPanel` 统计/纹理/模型选择器**保留逃生舱**——含多组件切换动态视图状态，非静态内容）→ P4-B-3 morph/play 交互面板。`fillRoles` **不在范围**（实测已声明式：sceneRegistry + menuItems 过滤 + SlideMenuView 驱动）。

## 核心机制

### renderPreviewPanel children 分支（preview-menu/core.ts）

`renderPreviewPanel` 的渲染通道五级衰退：

```
schemaBuilders（声明式 schema）→ children（声明式节点，P4-B 新增）→ renderCustom（命令式逃生舱）→ action（动作）→ fillers（过程式映射）
```

schemaBuilders 分支 2026-09 归一：内容统一走 `renderMenu(list, nodes, { ..., renderCustomDirect: true })`——`controls` kind（cap 控件组）与 `renderCustom`（custom 直接填充）都由 renderMenu 渲染，原 `renderPreviewSchemaContent` 已删。

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

### 受控 schema 注册（schema-registry.ts，[doc:adr-126-p5-a] 根治渲染逃生舱）

新增面板的唯一受控入口——`registerSchema(id, (snapshot) => PreviewMenuNode[])`：

- builder 吃状态层快照（与 P4-D visibleWhen 同构）——面板内容随状态响应
- `PreviewMenuNode.schemaId?: string`：面板节点声明注册 key（缺省回退 node.id），renderPreviewPanel 优先查 registry
- 重复注册**覆盖**旧 builder（多模型同框活跃模型换菜单语义，与 setAdapterItems 一致）
- 渲染通道三级衰退：`schemaBuilders → schema-registry(schemaId) → children → renderCustom → action → fillers`

### select 分支（renderMenu，[doc:adr-126-p5-c] 交互控件受控化）

`PreviewMenuNodeKind` 新增 `"select"`：下拉选择控件，`control: PreviewControlSpec`（bind 到 PreviewStatePath）——renderMenu select 分支读写状态层，组件选择等交互控件不再手写 DOM 闭包。

### YSM 模型面板 schema 化（[doc:adr-126-p5-c]）

`buildYsmModelSchema(ctx, snapshot, onComponentChange)`（skeleton-fill-panel.ts）：组件选择 select（bind `ui.activeComponent`）+ 统计 field + 纹理 row，纯数据零 DOM。组件切换走 `ui.activeComponent`（preview-state 会话态）+ `showModelGroup` 副作用（views 注册时注入）。**fill3DPanel 命令式 DOM 构建被声明式 schema 取代**（fillYsmModelPanel/fill3DPanel 保留兼容但新路径走 schema）。

## 对外 API / 入口

```ts
// 声明式节点工厂（views/app-preview 定义，**经 panels 注入通道给 adapter**——
// R1 禁 utils→views 运行时依赖，adapter 不得直接 import 工厂）
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
- **renderMenu**（preview-menu/render.ts）：children 内容的渲染器，支持 field/button/row/folder/divider/sectionTitle + 逃生舱。
- **mmd-adapter / mmd-controls**：P4-B-1 试点——model 面板 `children: o.panels?.modelInfoNodes?.(...)`，shot 面板条件注入 `children: o.panels?.shotNodes?.(...)`；`fillMmdModelPanel` / `fillMmdShotPanel` 保留（向后兼容 + 既有测试零回归）。
- **注入通道回归（R1 分层）**：节点工厂（`mmdModelInfoNodes` / `mmdShotNodes` / `ysmShotNodes`）定义在 views，adapter 经 `MmdPanelHooks` / `YsmMenuItemsOpts.panels` 的可选字段（`modelInfoNodes` / `shotNodes`）由视图层注入（mmd-3d / scene-3d / ysm-3d / maid-3d）——**adapter 不得直接 import views 层工厂**（check-layering R1 零容忍，曾因直接 import 阻断推送，见 `44b4e1b2`）。注入缺失 → children 空、面板不渲染（测试桩同步补注入）。
- **ADR-085**：S2「状态单向流」的大方向——面板内容从命令式 DOM 构建收敛为数据节点。

## 不变量

1. **panel 必有渲染通道**：renderCustom（命令式逃生舱）或 children（声明式节点）二选一——契约测试 `preview-menu/items.test.ts` 断言。
2. **能力缺失 → 不注入项**（条件注入），不注入空 children 面板（对齐 bonePanel 范式）。
3. **声明式节点零 DOM**：`mmdModelInfoNodes` / `mmdShotNodes` 是纯数据工厂，不碰 `document`（与 fillXxxPanel 命令式形成对照）。
4. **R1 分层（零容忍）**：utils 侧 adapter **不得 import views 层节点工厂**——必须经 `panels` 注入通道（`modelInfoNodes` / `shotNodes` 可选字段）由视图层注入；`check-menu-health` 门禁认识 children 渲染通道（render/renderCustom/children 三选一，`f697a270` 起）。
5. **新旧通道并存**：`fillMmdModelPanel` / `fillMmdShotPanel` 保留兼容，新面板路径走 children——每步独立可回滚。
7. **面板组装路径必须复用同一条通道衰退链**（P5 事故不变量）：adapter 面板内容渲染唯一实现 = `renderAdapterPanelContent`（preview-menu/render.ts，schemaId → children → renderCustom 三通道）；`renderPreviewPanel`（⚙ 根菜单）与 `modelDetailView`（roles 详情模型信息本体直渲）都调它。教训：P5 把 ysm/maid 模型面板迁到 schemaId、mmd/vrm 迁到 children 时，modelDetailView 旧直渲门 `primary?.renderCustom` 静默失明——统计/纹理/组件 select 在 roles 详情集体消失（用户 2026-08-29 实测报告），且无测试报警。三通道回归锁在 `preview-menu.roles.test.ts`（真实路径 dock-model → 角色行 → 详情）。
6. `fillRoles` **不在 P4-B 范围**（已声明式，实测 sceneRegistry + menuItems + SlideMenuView 驱动）。

## 相关

- ADR-126（本决策 P4-B + P5 根治）、ADR-125（设置面板单渲染器）、ADR-085（声明式收敛方向）、ADR-093（条件注入范式）
- 落地：P4-B-1（mmd model/shot 声明式化）+ P4-B-2（YSM 截图声明式化 + 截图共享层）+ **P4-D（`visibleWhen: (s: PreviewSnapshot) => boolean` 升级）** + **P5（受控 schema 注册 schema-registry.ts + select 分支 + `ui.activeComponent` 响应式 + buildYsmModelSchema 取代 fill3DPanel）** 已完成
- **P5 撤销 P4-B-3 的「fill3DPanel 保持逃生舱」定性**：用户推动的根治——fill3DPanel 的组件切换是「渲染通道不受控」（新增面板可绕过数组系统拼 DOM），不是「交互态不值得转」；现以 `ui.activeComponent` 状态层 + schema-registry 受控注册 + select 分支根治
- **P5-收尾：morph/play 交互面板也声明式化**（二轮审计）——`morphNodes`（mmd 表情 toggle）+ `playNodes`（播放/暂停 toggle + 动作 select + 空态，三 adapter 共用）；交互态「运行时状态」由 toggle/select 的 get/set 闭包 + 即时 apply 解决，不需 Capability 类
- **逃生舱只剩一类真·复杂**：骨骼面板（makeBonePanelRenderer，3D 射线拾取 + 相机/场景实时对象）。**litematic 分层切片已 schema 化退出逃生舱**：per-scene key `litematic-slice-{n}` 注册 builder 每次面板渲染重建节点（slider max 随轴新鲜）；切片模式 = shell 闭包场景级会话态（select get/set 闭包 + slider `visibleWhen` 谓词读同一闭包，dispose 随闭包消亡不动全局状态——P5 复盘：全局单值 + dispose 重置会跨场景误伤）；通用渲染器 renderMenu 补齐 slider 分支（label 可选 + `control.numeric` 旁挂 number 联动，caps 专属 slider 仍走 preview-menu/cap-controls 另一通道）
- **zip 多 pmx 选择（[doc:adr-132]）**：`resolveMmdZipConfig` 暴露全部 pmx/pmd 候选（`modelCandidates`，排序后第一个 = 默认）；mmd model 面板多候选时前置 select，选中 → `switchTo(候选虚拟路径)`（复用 switchToSession 外壳保留换内容层，零新机制）——面板写法与 morph/play/material 同款（children + 纯数据工厂 + panels 注入）。ADR-132 已把该 select 升格为**跨资源类型统一原语** `multiModelSelectNode`（preview-menu/multi-model.ts），MMD 迁移调用 + 资源包 pack 接入（modelEntries → 根菜单 select）；get 保持 basename 匹配（modelName = 虚拟路径 basename），set → switchTo 虚拟路径重建。原 [doc:adr-127] 标记为漂移（ADR-127 实为性能档位），已修正
- P4-C（dockGroup 双语义）定性「保持观察」：模式守卫早已独立字段，剩 dock 分组 + 内容域双语义，概念错位非功能 bug（详见 ADR-126 §2.5）
- 顺手修复：`fillMmdShotPanel` / `fillYsmShotPanel` 的 `saveScreenshot` 第三参误传 `screenshotFn`（被当 setShotState），实际截图走 fallback 而非活跃渲染器——`makeShotAction`（shot-panel-shared.ts）已修正（第四参传 screenshotFn）
