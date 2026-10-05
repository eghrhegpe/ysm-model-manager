# ADR-077：底部导航通用外壳收敛（D1+D3 落地）

- **状态**：❌ 已取代（被 ADR-076 v2 声明式根菜单方案全面替代；原 `buildBottomNav`/`BottomNavMenu`/`buildViewMenu` 函数未实现，因设计方案已演进）
- **被取代**：[ADR-076 v2] 取代 D1/D3 底部导航方案，改为声明式根菜单
- **日期**：2026-08-16
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`ADR-075`（环境菜单已收敛）、`ADR-076`（本 ADR 是 D1+D3 的专项落地）

## 1. 背景（Context）

### 1.1 代码层已收敛，UI 层仍散落

`buildCameraControls()` 已下沉至 `mount-preview-core.ts`（D3 部分落地），但：
- `ysm-controls.ts` L192 自行调用 `buildCameraControls(popup, ...)`
- `mmd-controls.ts` L166 自行调用 `buildCameraControls(menu.list, ...)`
- 两份调用参数构造逻辑重复（`getOrbit`/`setOrbit`/`getSpeed`/`setSpeed`/`reset`）

底部导航脚手架（`mkNavBtn`/`closePopup`/`togglePopup`/nav+popup 容器）仍各写一套：
- `ysm-controls.ts` L62-241：~180 行
- `mmd-controls.ts` L44-195：~150 行
- 重复率 >90%

### 1.2 用户反馈

"顶栏还有东西没放底栏根菜单区"——相机控件（旋转/速度/重置）仍在 topBar，应移入「视图」菜单项。

### 1.3 决策依据

ADR-076 已裁决方向：D1 通用外壳收敛 + D3 相机控件下沉。本 ADR 专项落地这两项。

## 2. 决策（Decision）

### D1 · 通用底部导航外壳 `buildBottomNav()`

`mount-preview-core.ts` 新增：

```typescript
export interface BottomNavMenu {
  id: string;              // "model" / "view" / "env" / "mat"
  icon: string;            // "🧍" / "🎥" / "🌍" / "🎨"
  label: string;           // i18n 键或字面量
  fill: (list: HTMLElement) => void;  // 只填弹窗内容
}

export function buildBottomNav(overlay: HTMLElement, menus: BottomNavMenu[]): void;
```

**外壳职责**（单一实现）：
- `mkNavBtn` 工厂
- nav 容器（`.ysm-3d-nav`）
- popup 容器（`.ysm-slide-popup`）+ `createSlideMenu` 外壳
- `togglePopup` / `closePopup` 逻辑
- nav 激活态同步（`.ysm-3d-navbtn--on`）

**适配器职责**（只声明菜单）：
```typescript
// ysm-adapter.ts
buildBottomNav(overlay, [
  { id: "model", icon: "🧍", label: "preview.modelInfo", fill: fillModelMenu },
  { id: "view", icon: "🎥", label: "preview.cameraView", fill: fillViewMenu },
  // env 由 core 自动注入（D2）
]);
```

### D2 · 环境菜单自动注入（复用 ADR-075）

`buildBottomNav` 自动在菜单列表末尾追加 `env` 项（若 `skyCap`/`groundCap` 可用）。
适配器无需感知环境菜单存在。

### D3 · 相机控件下沉「视图」菜单

核心提供 `buildViewMenu(list: HTMLElement, bridge: CameraControlBridge): void`，内部调用 `buildCameraControls(list, bridge)`。
适配器只需传入 `cameraControls` bridge，不碰 UI 构造。

### D4 · 迁移策略

1. 先在 `mount-preview-core.ts` 实现 `buildBottomNav` + `buildViewMenu`
2. 修改 `mmd-controls.ts` 删除脚手架，改为声明式菜单
3. 修改 `ysm-controls.ts` 删除脚手架，改为声明式菜单
4. 删除 `mkNavBtn`/`closePopup`/`togglePopup` 重复实现
5. 更新测试断言

## 3. 后果（Consequences）

**正面**：
- 删除 ~300 行重复代码（ysm + mmd 各删 ~150 行）
- 新增格式 = 声明菜单项，脚手架/环境/视图自动继承
- topBar 清爽（仅保留 ✕ 关闭 + 模型切换下拉）
- 统一行为：所有格式弹窗 toggle/close 逻辑一致

**负面 / 风险**：
- 🟡 迁移需同步改 ysm + mmd 两处控件 + 对应测试
- 🔴 `ysm-3d-panel` id 被 `fill3DPanel` 内部选择器依赖，外壳须保留该 id
- 🟡 `ysm-controls.ts` 的 `formatBoneInfo`/`popupSection` 是 YSM 专属内容辅助，保留在适配器侧
- 🟡 MMD 的 `mat` 菜单项（🎨 材质）是 MMD 专属，不进 core 通用菜单

**已知遗留**：
- 截图（`saveScreenshot`）在 ysm 视图菜单内，属 YSM 专属，不进 core 通用 `view` 菜单
- MMD 的「切换模型区」（`resolveMmdSiblings` 注入）保留在模型菜单内
- `buildCameraControls` 原 topBar 调用点保留（兼容 self 模式），shared 模式改用 `buildViewMenu`

## 4. 数据溯源

- **来源**：用户反馈「顶栏还有东西没放底栏根菜单区」+ 代码审计（重复脚手架）
- **审计证据**：
  - `ysm-controls.ts:62/147/156/192` — `mkNavBtn`/`closePopup`/`togglePopup`/`buildCameraControls`
  - `mmd-controls.ts:65/75/166/199` — 同构脚手架
  - `mount-preview-core.ts:104` — `buildCameraControls` 已存在（D3 部分落地）
- **关联 ADR**：ADR-075（环境菜单已收敛）、ADR-076（本 ADR 是其 D1+D3 落地）、ADR-066（统一预览契约）
