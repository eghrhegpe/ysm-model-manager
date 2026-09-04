# ADR-175：3D 预览 overlay 链 Shadow DOM 化（锐评 G6 处置框架）

- **状态**：✅ 已采纳（Accepted）
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-04
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`frontend/src/preview-3d/adapters/mount-preview-core.ts`（overlay 挂载）、`preview-3d/menu/core.ts:104`（createSlideMenu 唯一生产消费）、`ui/ui-slide-menu.ts`、`ui/ui-components-styles.ts`、`ui/ui-slide-menu-styles.ts`、`views/app-tree/index.ts:296`（getElementById 守卫）、勘察报告 `frontend-src-critique-g6p1-survey.md` §3、锐评处置卡 G6 行、ADR-066/126

---

## 1. 背景（Context）

锐评 G6：3D 预览 overlay（`#ysm-overlay-3d`，mount-preview-core.ts）挂 `document.body` **light DOM**，
且链内 slide 菜单（createSlideMenu）无 attachShadow——**全站 UI 均 Shadow DOM 组件的唯一不一致点**
（app-content / nav / preview / sidebar / tree / toast / context-menu 全部 attachShadow）。

### 1.1 首轮勘察结论（2026-09-03，报告 §3）

overlay 整链 28 个类 token 三类归属，**样式层迁移障碍远小于预期**：

| 归属 | 数量 | 迁移影响 |
|---|---|---|
| ① 可整体 adoptedStyleSheets 的样式模块（ui-components-styles / ui-slide-menu-styles） | 18 | 无——shadow 组件已用 adoptedStyleSheets 消费同批模块 |
| ② render.ts 链内注入块（ensureMenuStyles 等 `<style>` 注入） | 3 | 注入目标 document.head → shadow root |
| ③ 无独立规则的语义锚点类（cap-section / ysm-preview-menu / preview-view-container 等） | 5 | 无——视觉全来自内联样式，随节点进 shadow 自动生效 |

真实迁移障碍收敛为 **测试选择器 + 事件/焦点 + 样式注入目标** 三类（报告 §3.3）。

### 1.2 补充查证（2026-09-04，P1 批次 1-12 之后）

1. **overlay 链 cssText 已全部类化清零**（P1 处置，`139→8` 处剩全为死代码/豁免）。原
   「内联样式分散在 ~40 处」的迁移面收敛为**每文件一个幂等 ensure\* 注入函数**
   （ensureMenuStyles / ensureCapStyles / ensureRolesStyles / ensureEnvStyles / ensureSwitchStyles /
   ensureCoreStyles / ensureVbuStyles / ensureMpcStyles，均 `document.head.appendChild`）——G6 的
   样式注入目标迁移从「散点搬迁」变成「每文件改一处注入目标」，面进一步收敛。
2. **createSlideMenu 唯一生产消费方 = preview-3d/menu/core.ts:104**（buildPreviewMenuShell）。
   无外部全局共用 → slide 菜单 shadow 化影响面限于 3D overlay 链内部。
3. **app-tree/index.ts:296** `document.getElementById(PREVIEW_OVERLAY_ID)` 守卫：overlay 若改为
   **shadow host 且保留 id 挂 document**，getElementById 仍命中（host 自身在 document 树）→ 兼容，守卫零改动。
4. overlay 的 aria（role=dialog / aria-modal / aria-label）现挂在 overlay 元素上——shadow 化后
   移到 host 元素（host 在 document，语义对屏幕阅读器可见）。

## 2. 决策（Decision）

**D1 — overlay 挂载点 shadow 化**：mount-preview-core 的 `#ysm-overlay-3d` 改为 shadow host（保留
id + class + aria 属性，挂 document.body 不动），overlay 全部内容（mpc-body / viewContainer / 菜单 /
loading / tip / canvas 链）迁入 `host.shadowRoot`。`_singletonOverlay/_singletonBody` 单例语义不变。

**D2 — slide 菜单 shadow 化**：createSlideMenu（ui-slide-menu.ts）attachShadow；菜单链内各
`ensure*Styles` 注入目标从 `document.head` 改为**宿主 shadow root**（或并入 adoptedStyleSheets）。
样式注入目标参数化：ensure 函数接受 `(target: HTMLElement | ShadowRoot)` 或读宿主实例。

**D3 — aria/焦点归属**：role=dialog / aria-modal / aria-label 挂 **host**（document 层，语义可见）；
trapFocusAcrossShadow 目标改为 host.shadowRoot（该 util 注释自证已具备跨 shadow 能力，防御性设计转正）。

**D4 — 测试策略**：测试查询 util `scope()` 现优先 `container.shadowRoot`——overlay 链单元测试
（mount-preview-core.behavior / preview-menu / node-render 等）的 doc 级查询改传 host 或 host.shadowRoot；
e2e specs 的 overlay 真实选择器改 **shadow 穿透**形态（host id → shadowRoot 内 data-testid）。

**D5 — 迁移分步执行（M1→M3），每步全量套件认证**：
- **M1**：挂载点 shadow root 化（零视觉变更：mpc-overlay/mpc-body/mpc-* 类规则随 ensure 注入目标迁移；
  单例外壳 + app-tree 守卫 + aria 挂 host）。验证：overlay 单例复用测试 + 全量套件绿。
- **M2**：slide 菜单 shadow 化（createSlideMenu attachShadow + 链内 ensure\* 注入目标迁移）。
  验证：menu 全族 + 全量套件绿。
- **M3**：测试/e2e 选择器适配（scope() 查询改传 host；e2e overlay 用例 shadow 穿透）。
  验证：全量套件绿 + e2e overlay 穿透用例绿。

## 3. 收口定义（G6 闭环标准）

M1-M3 全落地 + 全量套件 329 文件/5214 测试全绿 + e2e overlay 穿透用例绿 +
「全站 UI 均 shadow 组件」成立（唯一不一致点消除）→ G6 闭环。

## 4. 风险与缓解

| 风险 | 缓解 |
|---|---|
| Shadow DOM 事件 retarget（shadow 内 click 冒泡到 document 时 target=host） | overlay 链事件绑定均在 shadow 内元素上（菜单 row/toggle/btn），retarget 只影响 shadow 边界外监听者——查证链内无 document 级依赖 overlay 内部 target 的处理器；M1 后全量套件 + 手动验证 |
| shadow root 内 `<style>` 注入与 adoptedStyleSheets 并存 | M2 统一走 adoptedStyleSheets（ui-components/ui-slide-menu 已是该形态），ensure\* 注入块并入或改挂 root |
| P1 ensure\* 函数约 8 个注入点逐一迁移 | 已收敛为每文件单点（1.2-1）；M1/M2 分步过，每步全量认证 |
| createSlideMenu 若将来被链外复用则 shadow 化溢出 | 现唯一消费 core.ts:104；D2 可加 options 开关兜底（默认 shadow） |

---

## 附录 A：overlay 链样式注入函数清单（M1/M2 迁移目标点）

| 文件 | ensure 函数 | 注入目标现状 | M1/M2 动作 |
|---|---|---|---|
| preview-3d/menu/render.ts | ensureMenuStyles | document.head | → host root |
| preview-3d/menu/cap-controls.ts | ensureCapStyles | document.head | → host root |
| preview-3d/menu/roles.ts | ensureRolesStyles | document.head | → host root |
| preview-3d/menu/env.ts | ensureEnvStyles | document.head | → host root |
| preview-3d/menu/switch.ts | ensureSwitchStyles | document.head | → host root |
| preview-3d/menu/core.ts | ensureCoreStyles | document.head | → host root |
| preview-3d/adapters/vrm-bone-ui.ts | ensureVbuStyles | document.head | → host root |
| preview-3d/adapters/mount-preview-core.ts | ensureMpcStyles（挂 installUiComponentsStyles 旁） | document.head | → host root |
| ui/ui-slide-menu-styles.ts | 安装函数 | head/菜单容器 | → host root/adopted |
