# 3D 预览菜单系统全景图

> 预览底部根菜单架构文档（2026-09）
> 
> **快速定位**：新人阅读本文档后应能独立定位核心文件 `core.ts` / `render.ts` / `node-types.ts`

---

## 📁 目录结构

```
frontend/src/preview-3d/menu/
├── node-types.ts      ← 类型契约（零依赖叶子，ADR-195 刀 2 下沉）
├── defs.ts            ← 数据表（结构声明，唯一事实来源）
├── slide-menu.ts      ← 外壳构建器（导航栈 + 键盘导航）
├── core.ts            ← 装配层（mountPreviewRootMenu 主函数拆 9 子）
├── render.ts          ← 通用渲染器（递归投影 PreviewMenuNode[] → DOM）
├── cap-controls.ts    ← Cap 控件渲染器（toggle/slider/select/color）
├── menu-graph.ts      ← 导航图生成器（可验证性，ADR-128）
├── sanctioned.ts      ← 受控逃生舱白名单（renderCustom 审计门）
├── menu-test-fixtures.ts ← 测试共享夹具
└── *.test.ts          ← 29 个测试文件，436 个用例
```

---

## 🏗️ 分层架构

### L1: 类型契约层（node-types.ts）
- **职责**：定义 `PreviewMenuNode` / `PreviewControlDef` / `PreviewMenuGroupId` 等类型
- **依赖**：零运行时依赖，仅引用 `preview-paths.ts`（状态路径）
- **关键接口**：
  ```typescript
  interface PreviewMenuNode {
    id: string;
    kind: PreviewMenuNodeKind; // folder/panel/action/slider/toggle...
    labelKey?: string;
    control?: PreviewControlSpec;
    visibleWhen?: (s: Partial<PreviewSnapshot>) => boolean;
    dockGroup?: PreviewDockGroup; // model/motion/env/scene/settings/stats
    children?: PreviewMenuNode[];
    renderCustom?: (container: HTMLElement) => void | (() => void);
  }
  ```

### L2: 数据声明层（defs.ts）
- **职责**：声明式数据表，描述「有哪些菜单项」
- **关键常量**：
  - `PREVIEW_MENU_GROUPS`: 底栏分组定义（model/motion/env/scene/settings）
  - `CORE_MENU_ITEMS`: Core 固定菜单项（roles/environment/camera/lighting/shadow/postproc/settings）
- **特点**：纯数据，无逻辑

### L3: 外壳构建层（slide-menu.ts）
- **职责**：提供 SlideMenu 卡片外壳（标题栏 + 内容区 + 导航栈）
- **关键函数**：
  ```typescript
  function createSlideMenu(opts?): SlideMenuHandle
  // Handle 方法：home/navigate/back/refresh/onShow/onHide/dispose
  ```
- **能力**：轻量导航栈、键盘导航（↑↓/Enter/Escape/Home/End）、输入阻断栈

### L4: 装配层（core.ts）
- **职责**：组装各层，构建完整菜单系统
- **主函数**：`mountPreviewRootMenu(overlay, ctx): PreviewMenuHandle`
- **拆分为 9 个子函数**（阶段装配模式）：
  1. `buildPreviewMenuShell` - 装配 dock + popup + SlideMenu 外壳
  2. `makePreviewMenuRow` - 行工厂（icon + label + chevron）
  3. `buildPreviewMenuRouters` - 面板路由表（schemaBuilders + runners）
  4. `renderPreviewPanel` - 单面板渲染（四路分派）
  5. `previewMakePanelView` - SlideMenuView 工厂
  6. `previewMakeGroupView` - 组根视图工厂
  7. `renderPreviewDock` - 底部 dock 渲染（数据驱动路由）
  8. `bindPreviewTapToggle` - 点按 vs 拖拽识别
  9. `validateAdapterItemIds` - id 冲突守卫

### L5: 渲染层（render.ts）
- **职责**：将 `PreviewMenuNode[]` 递归投影为 DOM
- **关键函数**：`renderMenu(container, nodes, deps): void`
- **分派规则**：
  - `card` → `rmAppendCard`（卡牌分组容器）
  - `folder` / `children` → `rmAppendFolder`（可折叠 section）
  - `field/button/row/select/slider/toggle/color` → 对应 append 函数
  - `controls` → `renderCapControls`（Cap 控件委托）
  - `custom` → `runCustomMount`（逃生舱）
  - `panel/action` → `rmAppendLeaf`（行 + navigate/action）

---

## 🔄 数据流图

```
┌─────────────────────────────────────────────────────────────┐
│ Adapter注入 │ SchemaBuilder产出                                │
└─────────────┬───────────────────────────────────────────────┘
              ▼
┌─────────────────────────────────────────────────────────────┐
│ PreviewMenuNode[] (声明式数据树)                               │
│  - CORE_MENU_ITEMS (core.ts 固定项)                            │
│  - adapterItemsRef.v (适配器注入项)                            │
└─────────────┬───────────────────────────────────────────────┘
              ▼
┌─────────────────────────────────────────────────────────────┐
│ renderMenu(nodes, deps)                                      │
│  ├─ visibleWhen(snap) 过滤                                   │
│  ├─ switch(node.kind) 分派                                   │
│  └─ 递归 children                                            │
└─────────────┬───────────────────────────────────────────────┘
              ▼
┌─────────────────────────────────────────────────────────────┐
│ DOM (SlideMenu 卡片)                                          │
│  .menu-wrapper                                               │
│   .slide-viewport                                            │
│     .slide-header (backBtn + title)                          │
│     .slide-panel                                             │
│       .slide-list.render-card                                │
└─────────────────────────────────────────────────────────────┘
```

---

## 🎯 核心流程

### 1. Mount 流程

```typescript
// 1. 入口
const handle = mountPreviewRootMenu(overlay, ctx);

// 2. 阶段 1: 装配外壳
const { dock, popup, menu, showMenu, hideMenu } = buildPreviewMenuShell(overlay, ctx);

// 3. 阶段 3: 构建路由表
const routers = buildPreviewMenuRouters(ctx, hideMenu, menu, actionCtx, shell);
// └─ 注册 core 六面板进 schema-registry (lighting/shadow/postproc/settings/camera/environment)

// 4. 阶段 5: 渲染 dock
refreshDock();
// └─ 遍历 PREVIEW_MENU_GROUPS → 点击按钮 → showMenu(makePanelViewFn(panel))

// 5. 用户交互
handle.openPanel("roles"); // 打开 roles 面板
handle.setAdapterItems(items); // 更新适配器项
```

### 2. Render 流程

```typescript
// 1. 调用入口
renderMenu(list, nodes, deps);

// 2. 过滤可见节点
for (const node of nodes) {
  if (node.visibleWhen && !node.visibleWhen(snapshot)) continue;

  // 3. 分派渲染
  switch (node.kind) {
    case "card": rmAppendCard(container, node, deps); break;
    case "folder": rmAppendFolder(container, node, deps); break;
    case "slider":
      const view = nodeControlToView(node, snapshot, menu);
      renderCapSlider(container, view); break;
    case "controls":
      const ctrls = node.controls();
      renderCapControls(container, ctrls, snapshot); break;
    // ...
  }
}
```

### 3. Navigate 流程

```typescript
// 1. 组根视图 (dock 点击)
showMenu(makeGroupViewFn(group, groupItems));
// └─ 列出组内所有面板项

// 2. 下钻到面板
menu.navigate(makePanelViewFn(node));
// └─ 压栈并重新渲染 stack[stack.length - 1]

// 3. 返回上一级
menu.back();
// └─ pop stack，若栈空则触发 onClose()

// 4. 关闭菜单
menu.setOnClose(() => {
  hideMenu({ restoreFocus: false });
  ctx.close();
});
```

---

## 🔐 ADR 索引表

| ADR | 标题 | 影响模块 | 关键决策 |
|-----|------|---------|---------|
| **ADR-076** | 3D 预览菜单 v3 分层 | core/slide-menu | 底部 dock → SlideMenu 多层导航 |
| **ADR-126** | 菜单 Schema 终态 | core/render/node-types | 声明式节点 + visibleWhen 谓词化 |
| **ADR-128** | 菜单导航图生成器 | menu-graph | 机器遍历可达性，coverage 指标 |
| **ADR-159** | stats 统计附加行通道 | node-types | dockGroup="stats" 扩展 |
| **ADR-168** | preview-paths 下沉范本 | state/preview-paths | 状态路径单一事实源 |
| **ADR-169** | PreviewMenuCtx 下沉 | node-types/core | 断 core ⇄ env/roles/switch 纯 type 环 |
| **ADR-175** | overlay 参数放宽 | core | HTMLElement \| ShadowRoot |
| **ADR-193** | schema 化四刀 | core/render | roles 迁 schemaBuilders，fillers 退役 |
| **ADR-195** | 控件类型收敛 | node-types/caps | PreviewControlKind 统一，刀 2 破环 |
| **ADR-207** | i18n 回退标准 | render | tOf(labelKey) 三级回退，node.label 只装明文 |
| **ADR-238** | 图标 SVG 化 | slide-menu | closeIcon 恒为 UI_ICONS.close，删除字面量 glyph |
| **ADR-241** | 路由声明化 | defs/core | directToPanel/directViewKey/rootView 显式声明 |

---

## 🚪 逃生舱清单

### sanctionedProcedural（白名单）

| 面板 ID | 原因 | 文件 | 迁移计划 |
|--------|------|------|---------|
| `bones-panel` | 骨骼面板动态结构无法声明式化 | `adapters/bones-panel-node.ts` | 永久保留（已审计） |

### escapeHatch 特征

- `renderCustom?: (container: HTMLElement, closePopup?) => void | (() => void)`
- `kind: "custom"` 且带 `renderCustom` 字段
- 不在 sanctioned.ts 白名单 → 新增需 code review + 追加白名单

---

## 🧪 测试策略

### 单元测试覆盖

| 文件 | 用例数 | 重点 |
|------|--------|------|
| `items.test.ts` | 45 | CORE_MENU_ITEMS 结构与 dock 渲染 |
| `node-render.test.ts` | 68 | renderMenu 递归投影各种 kind |
| `menu-graph.test.ts` | 24 | collectMenuGraph 导航图生成 + reachableBy |
| `health.test.ts` | 18 | 生产级 renderPreviewPanel 跑一遍每个常驻 dock 面板 |
| `slide-menu.test.ts` | 52 | 导航栈 home/navigate/back/onShow/onHide |
| `cap-controls.test.ts` | 89 | toggle/slider/select/color 渲染器 |
| `roles.test.ts` | 120 | roles 面板三通道（schema/children/renderCustom） |

### 健康度门禁

```bash
# doctor 全量
node scripts/doctor.ts

# 菜单专项
node scripts/doctor.ts --check-menu-health
# └─ 运行 health.test.ts 中的生产级渲染测试
```

---

## 🛠️ 调试指南

### 启用调试日志

```javascript
// 浏览器地址栏添加 ?nodebug=1 可全局关闭 dbg()
// 默认开启时，以下 tag 会输出到 console：

"preview-menu"         // mount/dispose/adapter items update/open panel
"preview-menu-render"  // 每个节点的渲染过程
```

### 查看环形日志

```javascript
// 最近 200 条调试日志
window._DBG_RING.get("preview-menu")
window._DBG_RING.get("preview-menu-render")
```

### 典型调试场景

**问题：某个节点没渲染出来**
```javascript
// 1. 检查 visibleWhen 谓词
?nodebug=1  // 关闭 dbg 避免噪音
// 控制台查看：
console.log("visibleWhen failed:", node.id, node.visibleWhen(snapshot))

// 2. 查看 renderMenu 日志
window._DBG_RING.get("preview-menu-render")
// 查找 "rendering node" 是否包含目标节点 id
```

**问题：导航栈卡住**
```javascript
// 1. 检查当前栈深
menu.isAtRoot()
menu.isShowing(somePanelView)

// 2. 手动复位
menu.reset()
```

---

## 📈 性能指标

| 指标 | 目标值 | 实测值 |
|------|--------|--------|
| mount 耗时 | <50ms | ~30ms |
| renderMenu 节点数 | ≤100 | ~60 |
| 测试覆盖率 | ≥80% | 87% |
| ADR 引用密度 | ≤50 处/文件 | 43 处/文件 |

---

## 🚀 演进路线

### P0（已完成 2026-09）
- [x] 调试日志门控机制集成
- [x] visibleWhen 完全统一（旧三布尔删除）
- [x] EscapeHatch 审计门完善

### P1（本月规划）
- [ ] 错误边界可视化（UI 友好提示 + 详情展开）
- [ ] bones-panel 部分声明式化（静态项先迁）

### P2（季度规划）
- [ ] 抽配置对象重构闭包链（adapterItemsRef/shell/routers → PreviewMenuConfig）
- [ ] 性能埋点（render 耗时/节点数/可见比例）
- [ ] 插件化谓词（表达式语言支持）

---

## 📚 参考文档

- **AGENTS.md**（仓库根）：工作准则 + 提交规范
- **skills/governance-rules.md**：前端治理红线（R1-R10）
- **skills/pitfalls.md**：致命陷阱手册（20 条事故教训）
- **docs/adr/ADR-109-code-review-checklist.md**：代码审查 Checklist
- **docs/cli-commands.md**：CLI 命令参考

---

## 💡 快速上手

**Q: 如何新增一个菜单项？**
```typescript
// 1. defs.ts 或 adapter 注入
export const CORE_MENU_ITEMS: PreviewMenuNode[] = [
  {
    id: "my-new-item",
    icon: "star",
    labelKey: "preview.myNewItem",
    kind: "toggle",
    control: {
      bind: ["ui.mySetting"], // 状态层路径
      min: 0,
      max: 1,
      step: 1,
    },
    dockGroup: "settings", // 归属底栏分组
    visibleWhen: (s) => s["env.skyGroundCap"], // 条件守卫
  },
];
```

**Q: 如何新增一个面板？**
```typescript
// 1. core.ts buildPreviewMenuRouters 中添加 builder
const routers: PreviewMenuRouters = {
  schemaBuilders: {
    // ... existing
    myPanel: (menu) => [
      { id: "item1", kind: "field", value: "hello" },
      { id: "item2", kind: "button", control: { action: () => toast("clicked") } },
    ],
  },
};

// 2. defs.ts 添加 dockGroup 声明
export const CORE_MENU_ITEMS: PreviewMenuNode[] = [
  { id: "myPanel", kind: "panel", dockGroup: "scene" },
];
```

**Q: 如何调试渲染失败？**
```javascript
// 1. 打开浏览器控制台
?nodebug=1 // 关闭 dbg 减少噪音

// 2. 查看环形日志
window._DBG_RING.get("preview-menu-render")

// 3. 定位错误节点 id
// 4. 检查 visibleWhen 谓词
console.log(previewSnapshot())
```

---

**最后更新**: 2026-09-18  
**维护者**: @deepseek (鲸鱼架构师)  
**同步机制**: 随 ADR 更新同步维护，pre-commit `check-knowledge-drift` 自动检测漂移
