# ADR-093：多模型同框引擎核心（注册表/dispatch/相机累加/路由接缝/上限）

- **状态**：已采纳（Accepted）
- **日期**：2026-08-18
- **决策人**：Jieling（人类首席架构师）、AI 代理（Riku）
- **相关**：`frontend/src/utils/3d/adapters/mount-preview-core.ts`、`switch-preview.ts`、`camera-setup.ts`、`preview-library.ts`、`cleanup-3d.ts`、`bone-raycast.ts`；`Mount3DOptions.cooperate`、`switchPreview({keepInScene})`、`allContent`

---

## 1. 背景（Context）

需求：在同一 3D 场景内**同时显示多个模型**（典型场景：MMD + VRM 同框比对/合演）。

经源码核查（信任但验证），多模型同框的伏笔已部分落地：

| 伏笔 | 代码实锤 | 现状 |
|---|---|---|
| `Mount3DOptions.cooperate` | `mount-preview-core.ts:155`、`:168` | **死 plumbing**：`appendXxxPreview` 走 `switchPreview({keepInScene})`，从不触发 `mount3D` 的 `cooperate` 分支；`openModel3DFullscreen` 永远以默认 opts 调 `mount3D` → 走 cleanup 替换 |
| `switchPreview({keepInScene})` | `switch-preview.ts:79`、`switchToSession` | ✅ 实装：`keep=true` 时**不移除旧内容、不 dispose**，新内容 add 进同一 scene 并 push `allContent` |
| `allContent` 多模型管理 | `mount-preview-core.ts:429`、`cleanup-3d.ts:74` | ✅ 实装：裸 `PreviewScene[]`，仅用于 `fullCleanup` 逐条 dispose，**无元数据/无 UI 暴露/无取景感知** |
| 跨类型路由基础 | `preview-library.ts:21` `registerReRoute`、`:39` `openModel3DFullscreen` | ✅ 实装：查表派发 `createXxx3D` |

**真难点不在架构，而在场景管理**：renderer/controls 共用没问题，但相机取景、选中射线、骨骼拾取都需知道"当前点的是哪个模型的哪根骨头"。多模型同框时这些需加一层 dispatch。

**附带发现（不一致点）**：`appendMmdPreview`/`appendVrmPreview`（`mmd-3d.ts:58`、`vrm-3d.ts:51`）写死逐类型、**绕过 `openModel3DFullscreen` 跨类型路由主门**——多模型入口未走注册表。

---

## 2. 决策（Decision）

### 2.1 分体开工（本 ADR 范围）

| 层 | 决策 | 范围 |
|---|---|---|
| 场景注册表 `SceneRegistry` | 新增模块级单例，承载模型元数据 | ✅ 本 ADR（T2） |
| 相机多包围盒累加 | `fitCameraToRoots(roots,...)` 只框可见注册模型 root | ✅ 本 ADR（T3） |
| 统一路由接缝 | `openModel3DFullscreen(path,{cooperate})` 统一 append 入口 | ✅ 本 ADR（T4） |
| GPU/内存上限 | `MAX_MODELS` 阈值 + toast 拒绝超量追加 | ✅ 本 ADR（T6） |
| dispatch 拾取归属 | 注册表存 `menuItems`/`boneMaps` + `selectModel` 切活跃模型并换菜单 + 统一拾取器（仅多模型激活） | ✅ 本 ADR v1 基础（T5） |
| dock 模型列表 UI（隐藏/单独关） | 依赖隔壁资源库定稿后的选择 API 形态 | ⏸ 等隔壁，不在本 ADR |

### 2.2 关键设计

- **root 捕获用差量法**（适配器无关）：`mount3D`/`switchToSession` 在 `adapter.build` 前后对 `scene.children` 做差集，得到本次新增的顶层 Object3D 作为 `roots`。**不要求各适配器改 `PreviewScene` 返回 root**，YS/VSM/VRM/MMD/litematic 通用。
- **注册表单例生命周期**：随活跃会话。`fullCleanup`（`cleanup-3d.ts`）首行 `sceneRegistry.reset()`；新鲜 mount（`!cooperate`）先 `cleanupPreview()` → 触发 reset。`allContent` 保留用于逐条 dispose（注册表存 `content` 引用，二者并存，释放由 `allContent` 负责）。
- **相机累加**：`fitCameraToScene` 现状遍历**整个 scene**（含旧模型、sky/ground），故 keep 模式本就框住全场景——但隐藏模型仍被计入（traverse 不区分 `visible`）。改为 `fitCameraToRoots(registry.visibleRoots(),...)`：只框可见注册模型的 root，正确处理隐藏/排除基线。首 mount 仍走适配器内部 `fitCameraToScene(scene,...)`（单模型等价）；keep 追加后由 `switchToSession` 调 `fitCameraToRoots` 重算并集。
- **路由接缝**：`openModel3DFullscreen(path, { siblings?, cooperate? })`；当 `cooperate && hasActivePreview()` 改走 `switchPreview(path,{keepInScene:true})`，消除 append 绕路。`appendMmdPreview`/`appendVrmPreview` 重指向该统一入口。
- **dispatch v1**：注册表每模型存 `roots` / `visible` / `content` / `boneMaps?` / `menuItems?` / `active`。`selectModel(id)` 置活跃 + 调 `menuHandle.setAdapterItems(entry.menuItems)`（菜单会话级共享、后建覆盖前建，故需按活跃模型换菜单）。统一拾取器在 `mount3D` 注册一次，**仅 `registry.count()>=2` 时激活**：射线命中 → `pickModelByObject` 按 root 包容反查归属 → `setActive` 换菜单 → 若 `entry.boneMaps` 存在则 `assembleBoneSelectInfo` + `entry.content.onBoneSelect?.(info)`。单模型（`count<2`）时该拾取器 no-op，**完全沿用现有逐模型 `registerBoneRaycast`，零回归**。
- **GPU 上限**：`MAX_MODELS = 8`；keep 追加前若 `count >= MAX` → toast 警告并拒绝追加。

### 2.3 已知限制（v1 遗留，非阻塞）

- 逐模型 `registerBoneRaycast` 与统一拾取器在多模型时**并存**，统一器负责正确归属 + 换菜单；单模型器仍可能触发，靠 nameMap 不相交与菜单换项兜底，偶发面板闪烁属已知。
- vrm/mmd 适配器本 pass 不改其 bone 监听；其 dispatch 依赖 root 差量（已通用）+ 注册表存 `content`，`boneMaps`/`menuItems` 待各适配器补填后整型。
- dock 模型列表 UI（隐藏/单独关/计数显示）等隔壁资源库定稿。

---

## 3. 后果（Consequences）

**正面**
- 多模型同框在场景/取景/上限/统一入口层面真正可用：可经 `openModel3DFullscreen(path,{cooperate:true})` 把第二个模型追加进同一场景，相机自动框全场景可见模型，超量被拒。
- 注册表成为相机累加 / dispatch / GPU 上限 / 未来 dock UI 的**单一事实来源**，替代裸 `allContent`。
- 消除 append 绕过路由主门的不一致。

**负面 / 风险**
- dispatch v1 仍未完全统一逐模型监听器（见 2.3），菜单感知的彻底解耦属后续微任务。
- 隐藏模型取景正确依赖各模型 `roots` 差量捕获；若某适配器把内容 add 进已有基线对象而非新增顶层节点，差量法会漏捕（当前 YSM/VRM/MMD 均新增顶层 group，安全）。

**已知遗留**
- 后续微任务 T5-b：禁用多模型下逐模型重复拾取器 + 菜单真正按模型隔离；各适配器补 `boneMaps`/`menuItems`。
- 后续微任务：dock 模型列表 UI（消费 `sceneRegistry`）。

---

## 4. 数据溯源

- 来源：`preview-library.ts` / `mount-preview-core.ts` / `switch-preview.ts` / `camera-setup.ts` / `bone-raycast.ts` / `ysm-adapter.ts` / `cleanup-3d.ts` 逐行核查（2026-08-18）
- 结果：确认伏笔落点，制定本 ADR 分体开工方案；`Mount3DOptions.cooperate` 判定为死 plumbing，`appendXxxPreview` 为绕路入口，统一收口至 `openModel3DFullscreen({cooperate})`。

<!-- 文件名: multi-model-scene-core.md → 实际文件 ADR-093-multi-model-scene-core.md -->
