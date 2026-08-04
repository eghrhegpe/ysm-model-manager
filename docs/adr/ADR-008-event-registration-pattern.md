# ADR-008：事件注册位置与防重复规范

- **状态**：已采纳（Accepted）
- **日期**：2026-08-03
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`frontend/js/bus.js` / `frontend/js/core/global-handlers.js` / `frontend/js/app-modules.js` / AGENTS.md §三
- **补充**：[ADR-027](./ADR-027-web-component-contract-normalization.md) 规范事件**发射侧**（通道选择与 payload 类型约束）；本 ADR 规范**订阅侧**（注册位置、防重守卫、清理配对）。两者互补，均现行有效。

---

## 1. 背景（Context）

项目使用 `bus.js` 作为唯一事件中枢，所有跨组件通信通过 `bus.on()` / `bus.emit()`。
`bus.on()` 返回取消函数，但**不防重复注册**——同一个 handler 被多次调用就会产生
多个订阅，导致事件被处理多次。

历史中曾出现两次事件注册事故：
- **AGENTS.md 陷阱 #3**：按钮异步后卡死，根因是 `finally` 未 emit 完成事件
- **AGENTS.md 陷阱 #8**：三入口各自注册，导致事件重复/遗漏

典型问题模式：

```js
// app-resource-manager/index.js:25 — 顶层注册，不防重
bus.on("config:resource-types-changed", function () {
  STORE._config = null;
  document.querySelectorAll("app-resource-manager").forEach(function (el) {
    el._init && el._init();
  });
});
```

上述代码在模块加载时直接注册 handler，**不检查是否已注册**。如果该模块被
多次 `import` 或该组件被多次创建，同一 handler 会被重复注册。

对比正确做法：

```js
// community/download-queue.js — 防重守卫
if (!_registered) {
  _registered = true;
  Events.On("queue:status", ...);
  Events.On("queue:file-start", ...);
  Events.On("queue:file-done", ...);
}
```

---

## 2. 决策（Decision）

**决策**：全局事件注册遵循"一处注册、统一入口"原则，具体规范如下：

### 2.1 注册位置

| 事件类型 | 注册位置 | 理由 |
|----------|----------|------|
| 全局 handler（跨组件） | `app-content/index.js` 的 `_registerGlobalHandlers()` | 单点控制，避免遗漏/重复 |
| 组件内部事件 | Web Component 的 `connectedCallback` + `_unsubs` 数组 | 生命周期绑定，`disconnectedCallback` 自动清理 |
| 后端 Events.On | 业务模块顶层，带 `_registered` 守卫 | 一次性注册，页面切换不受影响 |

### 2.2 防重复守卫

所有全局注册必须显式检查已注册状态：

```js
// 正确：带守卫
if (!_registered) {
  _registered = true;
  bus.on("some:event", handler);
}

// 正确：_unsubs 数组（Web Component 模式）
connectedCallback() {
  this._unsubs.push(bus.on("menu:show", this.show.bind(this)));
}
disconnectedCallback() {
  this._unsubs.forEach(off => off());
  this._unsubs = [];
}
```

### 2.3 bus.js 不提供自动防重

`bus.js` 的设计原则是**轻量发布订阅，不做防重**：

```js
// bus.js:9 — 简单 push，不检查重复
on(event, fn) {
  (listeners[event] ||= []).push(fn);
  return () => this.off(event, fn);
}
```

**理由**：
- 同一 handler 函数对象重复调用 `bus.on()` 是开发错误，应在调用点防重而非在 bus 内部屏蔽
- 不同 handler 函数处理同一事件是合法场景（多个组件都关心 `nav:change`），bus 不应自动去重
- 自动去重（按函数引用或按 hash）会增加复杂度且可能误屏蔽合法注册

---

## 3. 后果（Consequences）

### 正面
- 明确了一处注册、一处取消的合同，调试时不需要追踪分散在各处的 `bus.on()`
- Web Component 的 `_unsubs` 模式确保组件销毁时自动清理，无内存泄漏
- 后端 Events.On 的 `_registered` 守卫确保页面切换时不会重复注册

### 负面
- `app-resource-manager/index.js` 的 `bus.on("config:resource-types-changed", ...)` 当前没有守卫，
  是该规范的已知违规点（未修复）
- 新开发者可能忘记加守卫，导致重复注册 → 需在 review 中人工检查
- 没有自动化检测工具能验证"所有全局注册都有守卫"

### 已知违规
| 位置 | 问题 | 影响 |
|------|------|------|
| `app-resource-manager/index.js:25` | `bus.on()` 无守卫 | 多次创建组件会累积 handler |

---

## 4. 与 AGENTS.md §三 的关系

| AGENTS.md 陷阱 | 本 ADR 覆盖 |
|----------------|-------------|
| #3 按钮异步后卡死 | §2.1 — 全局 handler 统一入口 |
| #8 三入口各自注册 | §2.1 — 全局事件只注册一次 |

本文档补充了 AGENTS.md 陷阱 #8 的具体实现方案（`_registered` 守卫 + `_unsubs` 模式）。

---

## 5. 数据溯源

| 来源 | 结果 |
|------|------|
| `frontend/js/bus.js` | 发布订阅实现，无自动防重 |
| `frontend/js/features/community/download-queue.js` | `_registered` 守卫模式 |
| `frontend/js/views/app-preview/events.js` | `_unsubs` 数组清理模式 |
| `frontend/js/views/app-resource-manager/index.js` | 已知违规：无守卫注册 |
| `AGENTS.md` §三 陷阱 #3 #8 | 历史事故记录 |
| `docs/knowledge/event_bus.md` | 事件总线架构文档 |
