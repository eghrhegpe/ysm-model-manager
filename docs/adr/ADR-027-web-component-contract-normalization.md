# ADR-027：Web Component 对外契约规范化

- **状态**：✅ 已采纳（Accepted）
- **日期**：2026-08-04
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`docs/Design.md` §14–§20（契约唯一事实来源） / [ADR-008](./ADR-008-event-registration-pattern.md)（订阅侧规范，本 ADR 为其发射侧补充） / [ADR-005](./ADR-005-frontend-governance-rules.md) / [ADR-014](./ADR-014-typescript-migration.md) / `frontend/js/bus.ts` / `frontend/js/widgets/`

---

## 1. 背景（Context）

`docs/Design.md` 长期只覆盖**设计令牌层**（颜色 / 间距 / 圆角 / 动画 / 主题），470 行内容里没有一行描述组件的**公开契约**。后果是：组件的对外接口（属性、方法、事件）只存在于源码中，没有规范约束，也没有验收标准。

2026-08-04 对 9 个自定义元素做全量源码审计（`customElements.define` 全库扫描），暴露出三类问题：

### 1.1 通信通道不统一

`bus.ts` 已提供**类型化**事件总线（`BusEvents` 接口约束事件名与 payload），但 `app-resource-manager` 的反馈链路绕开了它：

```ts
// components/app-resource-manager/index.ts（修复前）
private _toast(type, title, msg) {
  this.dispatchEvent(new CustomEvent("toast", {
    bubbles: true, composed: true, detail: { type, title, message: msg },
  }));
}
```

```ts
// features/resource-packs.ts（修复前）— 桥接层
const manager = container.querySelector("app-resource-manager");
manager?.addEventListener("toast", (e) => {
  bus.emit("toast:show", { /* 手工转换 detail → payload */ });
});
return () => manager?.removeEventListener("toast", handler);
```

链路是 `组件 → DOM CustomEvent → features 层桥接 → bus → <app-toast>`，**三跳，且依赖挂载方主动接线**。一旦 `<app-resource-manager>` 被用在 `initResourcePacks()` 之外的任何位置，toast 静默丢失——组件不报错，用户看不到反馈。这是典型的**隐式契约**：组件的可用性依赖调用方是否知道要接一根线。

此外 DOM 事件绕过了 `BusEvents` 的类型约束，`detail` 形状（`{type,title,message}`）与 bus payload 形状（`{msg,type,duration}`）不一致，转换逻辑散落在桥接层。

### 1.2 属性形态不统一

`app-tree` 的 `root`（资源类型根）在 `connectedCallback` 中命令式一次性读取：

```ts
// components/app-tree/index.ts（修复前）
async connectedCallback() {
  this._rootAttr = this.getAttribute("root") || "";
  // ...无 observedAttributes / attributeChangedCallback
}
```

挂载后修改 `root` 属性不产生任何效果。DOM 上写着 `root="skin"`，组件内部却仍是旧值——属性成了**装饰性谎言**。这类"看起来是声明式、实际是命令式"的接口，是调试时最难定位的一类问题。

### 1.3 文档与源码漂移无登记机制

审计中还发现 `Design.md` §3 主题表列了 4 套主题（含代码库中不存在的 `.theme-default-dark`），而 `app-modules.ts:47` 实装为 6 套 + `system` 别名。文档漂移长期无人发现，也无处登记。

---

## 2. 决策（Decision）

**核心决策**：Web Component 的对外契约必须是**显式、类型化、声明式**的，并以 `docs/Design.md` 为唯一事实来源。

### 2.1 通信通道：跨组件一律走类型化总线

| 通信场景 | 通道 | 约束 |
|----------|------|------|
| **跨组件 / 跨模块** | `bus.emit(...)` | 事件名与 payload 必须在 `bus.ts` 的 `BusEvents` 接口中登记，享受编译期检查 |
| **组件内部父子协作** | DOM `CustomEvent` | 允许，但仅限组件自身 Shadow DOM 边界内，不得 `composed: true` 逃逸 |
| **禁止** | 组件派发 `bubbles+composed` 的 DOM 事件供外部模块监听 | 该模式产生隐式契约，且绕过类型约束 |

**判据**：如果一个 DOM 事件需要外部模块 `addEventListener` 才能工作，它就应该是 bus 事件。

> 与 [ADR-008](./ADR-008-event-registration-pattern.md) 的边界：ADR-008 规范**订阅侧**（在哪注册、如何防重、如何清理）；本 ADR 规范**发射侧**（用什么通道、payload 形状如何约束）。两者互补，均现行有效。

### 2.2 属性形态：需要运行时响应的必须声明式

| 属性语义 | 实现方式 |
|----------|----------|
| 运行时可变（组件需响应） | `static observedAttributes` + `attributeChangedCallback` |
| 挂载期只读（一次性配置） | `connectedCallback` 中 `getAttribute`，**且必须在 Design.md 中显式标注"挂载期只读"** |

**不允许第三态**：属性存在于 DOM、但既不响应变更、也未标注只读。

**首次挂载竞态闸门**：`attributeChangedCallback` 在**首次挂载时早于** `connectedCallback` 触发。若两者都触发加载逻辑，会造成重复加载与竞态。规定统一使用 `_ready` 标志：

```ts
private _ready = false;

async connectedCallback() {
  try { /* 初始化 + 加载 */ }
  finally { this._ready = true; }   // 闸门在 finally，异常路径也要放行
}

attributeChangedCallback(name, oldVal, newVal) {
  if (name !== "root" || oldVal === newVal) return;
  this._rootAttr = newVal || "";
  if (!this._ready || !this.isConnected) return;  // 首挂载交给 connectedCallback
  void (async () => { await this._load(); this._renderTree(); })();
}
```

### 2.3 Design.md 升级为双层规范 + 漂移登记

`docs/Design.md` 从「设计令牌」单层升级为**「令牌 + 契约」双层**，470 行 → 886 行：

| 层 | 章节 | 内容 |
|----|------|------|
| 令牌层 | §1–§13 | 设计哲学 / 布局 / 主题 / 字体 / 间距 / 圆角 / 动画 / 按钮 / Shadow DOM / 色彩 / 命名 / UI 原则 |
| 契约层 | §14–§20 | 组件架构 / **9 组件 API 规范** / 事件总线契约登记表 / 键盘无障碍 / 命名规范 / **验收 Checklist** |

配套建立 **§14.6 漂移登记表**（编号 D1、D2…）：文档与源码不一致时，不静默修改文档，而是登记漂移项、注明处置方式，闭环后改为「已闭环」并保留历史。理由是：漂移本身是有价值的信号（说明某处代码演进未同步文档），静默抹平会丢失这个信号。

**契约变更流程**：改组件的属性 / 方法 / 事件 → 同步更新 Design.md §15/§16 → 走 §19 验收 Checklist。

---

## 3. 后果（Consequences）

### 正面

- **反馈链路从三跳降为一跳**：`组件 → bus → <app-toast>`。`<app-resource-manager>` 现在在任意位置挂载都能正常反馈，不再依赖调用方接线。
- **编译期兜底**：走 `BusEvents` 后，事件名拼写错误、payload 形状不符在 `tsc --noEmit` 阶段即被拦截（ADR-014 门槛），不再是运行时静默失败。
- **删除桥接层代码**：`features/resource-packs.ts` 移除 18 行 handler + `addEventListener`/`removeEventListener` 配对 + 无用的 `bus` import。少一处需要手工配对的资源，就少一处泄漏可能。
- **`app-tree` 的 `root` 成为真实契约**：DOM 上的属性值与组件内部状态恒等。
- **9 个组件的公开 API 首次有了成文规范与验收标准**，新增组件有模板可循。

### 负面

- **Design.md 维护成本上升**：886 行文档，组件契约变更必须同步，否则产生新漂移。缓解措施是 §19 验收 Checklist 已将"契约同步"列为勾选项，但**无自动化检测**——依赖 review 时人工核对。
- **`_ready` 闸门是样板代码**：每个有响应式属性的组件都要重复一遍。当前 3 个组件规模下可接受；若未来响应式组件增多，应抽取基类或 mixin 收敛（登记为待办，不在本次范围）。
- **DOM 事件禁令有例外空间**：§2.1 允许组件内部使用 DOM 事件，边界靠"是否 `composed: true` 逃逸"判定，属于经验判据而非机械规则，新人可能误判。

### 已知遗留（未在本次处置）

| 项 | 位置 | 说明 |
|----|------|------|
| ADR-008 已知违规仍在 | `app-resource-manager/index.ts:46` | 模块顶层 `bus.on("config:resource-types-changed", ...)` 仍无 `_registered` 守卫。属 ADR-008 遗留（订阅侧），本次只处置发射侧，未扩大范围 |
| 键盘导航框架缺失 | Design.md §17 标注 🟡 | 列表 / 树的集中式键盘导航（roving tabindex + `aria-activedescendant`）尚未建立，是新建能力而非修复 |
| 契约同步无自动化 | — | 无脚本能验证「Design.md §15 的契约描述 = 源码实际契约」，考虑后续扩展 `check-knowledge-drift.mjs` 覆盖 |

---

## 4. 数据溯源

| 来源 | 结果 |
|------|------|
| `C:\Users\zhujieling11\MikuMikuAR\docs\design.md` | 结构范本：「令牌 + 组件契约」双层规范的参考实现 |
| 全库 `customElements.define` 扫描 | 9 个自定义元素：`app-content` / `app-sidebar` / `app-nav` / `app-tree` / `app-preview` / `app-resource-manager` / `app-sync-manager` / `app-toast` / `context-menu` |
| `frontend/js/bus.ts` | 类型化 `BusEvents` 接口确认；`on()` 返回取消函数、不防重（与 ADR-008 一致） |
| `frontend/js/app-modules.ts:47` | 实装 6 套主题（`cyber`/`warm`/`pro`/`sakura`/`ocean`/`mint`）+ `system` 别名 → 修正 Design.md §3（漂移 D1） |
| `frontend/js/widgets/app-content/tpl.ts` | 漂移 D2（`mode="model"` 残留）复核后**不成立**：全库 grep 零匹配，原登记基于过期快照，已核销 |
| `frontend/js/widgets/app-resource-manager/index.ts:432-438` | 漂移 D3 处置结果：`_toast()` 现直接 `bus.emit("toast:show", {msg,type,duration})` |
| `frontend/js/features/resource-packs.ts` | D3 配套：桥接 handler 与监听配对已删除，`initResourcePacks()` 返回空清理函数，**上层调用契约不变** |
| `frontend/js/widgets/app-tree/index.ts:63-68, 148, 152-165` | 漂移 D4 处置结果：`_ready` 闸门 + `observedAttributes:["root"]` + `attributeChangedCallback` |
| `docs/Design.md` | 470 行 → 886 行，§14–§20 为本 ADR 的规范正文 |

### 验证记录（2026-08-04）

| 检查 | 命令 | 结果 |
|------|------|------|
| 类型检查 | `npm run typecheck`（`tsc --noEmit`） | ✅ 0 error |
| 前端构建 | `npx vite build` | ✅ 通过 |
| 文档断链 | `node scripts/link-checker.mjs` | ✅ 467 链接 / 0 断链 |
| 契约测试 | `for f in tests/*.mjs; do node "$f"; done` | ✅ 8 项全过 |
