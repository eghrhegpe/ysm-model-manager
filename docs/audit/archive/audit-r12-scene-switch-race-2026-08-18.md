# 审计 R12 — 场景切换竞态与 dispose/build 重叠

**日期**：2026-08-18
**范围**：`switchPreview` / `switchToSession` / `mount3D` 生命周期
**结论**：核心竞态守卫（gen counter + isDisposed）完整；发现 `aborted` 捕获方式缺陷（理论上可绕过）及无并发切换抑制

---

## 架构全景

```
用户点击切换模型
      │
      ▼
preview-menu.ts:429  void ctx.switchTo(p)        ← fire-and-forget，无等待
      │
      ▼
mount-preview-core.ts:296-298  void _handle?.switchTo?.(p, options)
      │
      ▼
switchToSession(ctx, newPath)                    ← 异步，可被中断
      │
      ├── ① 检查 aborted/isDisposed/myGen        ← 三重守卫
      │
      ├── ② dispose 旧内容层 (ctx.getBuilt()?.dispose())
      │
      ├── ③ ctx.adapter.build(ctx, newPath)      ← 异步加载
      │
      ├── ④ 检查 aborted/isDisposed/myGen        ← 双重守卫
      │
      └── ⑤ 更新 state（built/allBuilt/sceneRegistry）
```

---

## 现有守卫机制分析

### 守卫 1：myGen / getGen（代际守卫）✅

```typescript
// mount-preview-core.ts L188
const myGen = ++_gen;  // 每次 mount3D 调用递增

// switch-preview.ts L85
if (ctx.aborted || ctx.isDisposed.v || ctx.myGen !== ctx.getGen()) return;
```

- 调用 `invalidatePreview()` 或 `cleanupPreview()` → `_gen++`
- `getGen` 是闭包 getter，实时读取最新 `_gen`
- 在-flight switchTo 期间若 `myGen !== getGen()`，立即 return 并 dispose new built

### 守卫 2：isDisposed（会话级终止标志）✅

```typescript
// mount-preview-core.ts L452
const isDisposed = { v: false };

// cleanup-3d.ts L61
ctx.isDisposed.v = true;  // runFullCleanup 设置

// switch-preview.ts L85
if (... ctx.isDisposed.v) return;
```

- `isDisposed` 是对象引用，`runFullCleanup` 修改 `.v` 后，switchToSession 立即可见
- ✅ 正确：引用传递，无闭包值捕获问题

### 守卫 3：aborted（弹窗关闭标志）⚠️

```typescript
// mount-preview-core.ts L310, L318-323
let aborted = false;
function closeOverlay(): void {
  aborted = true;  // ← 修改 closure 变量
  ...
}

// mount-preview-core.ts L560
switchCtx: {
  aborted,  // ← 按值捕获（boolean 是 primitive）
  ...
}

// switch-preview.ts L85
if (ctx.aborted || ...) return;  // ← 读到的是构造时的值，不会更新！
```

**问题**：`aborted` 是 primitive boolean，通过 `switchCtx` 对象按值传递。
- 构造时 `ctx.aborted = false`
- 若 switchTo 进行中，用户按 ESC → `closeOverlay()` 设置 `aborted = true`
- 但 `switchCtx.aborted` 仍为 `false`（闭包变量已更新，但 switchCtx 对象持有旧值）

**缓解因素**：`closeOverlay()` 同时 `_gen++` → `myGen !== getGen()` 守卫生效 → switchToSession 在下一检查点（L85 或 L150）检测并 return。

---

## 发现的问题

### P1: 无并发切换抑制

**现象**：`switchTo` 无"正在切换中"标志。用户快速连续点击两个模型：

```
t=0ms:  switchTo("model_A") 开始 → await adapter.build()
t=100ms: switchTo("model_B") 开始 → ctx.myGen===getGen(), aborted===false → 通过守卫
t=500ms: model_A build 完成 → dispose old → add A to scene
t=501ms: model_B build 完成 → dispose old (A!) → add B to scene
```

**结果**：A 被 build 后立刻 dispose，产生一次性浪费；sceneRegistry 可能有短暂的不一致状态。

**实际风险**：低。两次 build 不会真正冲突（各自 dispose 自己创建的内容），但会产生多余 GPU 分配/释放。

**建议修复**：在 SwitchContext 增加 `inFlight: boolean` 标志，或复用 `_gen` 语义。

### P2: `aborted` 按值捕获（理论上可绕过）

**现状**：
```typescript
switchCtx: {
  aborted,  // primitive value capture
  ...
}
```

若有人修改 `ctx.aborted = true` 直接（不通过 `closeOverlay()`），`mount-preview-core` 的 `aborted` 闭包变量不受影响。

**缓解因素**：
- `aborted` 仅由 `closeOverlay()` 修改
- `_gen` 递增是实际的终止信号
- 无公开 API 可直接设置 `ctx.aborted`

**风险等级**：P2（理论缺陷，实际路径被 gen counter 覆盖）。

### P3: `void switchTo` fire-and-forget 静默失败

```typescript
// mount-preview-core.ts L296-297
switchTo: (p: string, options?: ...) => {
  void _handle?.switchTo?.(p, options);  // ← 无 catch，错误被吞
},
```

- 用户点击切换时，若 build 失败，错误仅通过内部 `console.error` + toast 上报
- 但 menu click handler 本身无错误反馈（用户不知道切换是否成功）

**缓解因素**：`switchToSession` 内部已处理错误（toast + loadingEl 错误信息）。

---

## 资源重叠路径分析

### 路径 1：普通切换（keepInScene=false）

```
switchToSession:
  step 2: ctx.scene.remove(stale children)   ← 移除旧 scene 子节点
  step 3: ctx.getBuilt()?.dispose()          ← dispose 旧内容层 GPU 资源
  step 4: adapter.build(ctx, newPath)        ← 异步加载新模型
           ↓ 此时旧内容已 dispose，新内容正在加载
  step 4: if (aborted/isDisposed/gen) next.dispose(); return
  step 5: update state (built/allBuilt/registry)
```

✅ 顺序执行，无重叠。旧 dispose 完成后再 build。

### 路径 2：同台追加（keepInScene=true）

```
switchToSession:
  step 1: 移除 topBar 控件（无关 scene）
  step 2: 跳过 scene.children 清理（keep=true）
  step 3: 跳过 dispose（keep=true）
  step 4: adapter.build(ctx, newPath)         ← 新模型追加到同一 scene
  step 5: allBuilt.push(next)                 ← 累积所有模型
```

✅ 无重叠，仅追加。`allBuilt` 在 fullCleanup 时逐一 dispose。

### 路径 3：pack-model-adapter 双重 dispose 防护

```typescript
// switch-preview.ts:114
try { ctx.getBuilt()?.dispose(); } catch (e) { ... }

// pack-model-adapter.ts:172-178
// 防御性清理：核心 switchTo 已执行 built?.dispose()，但保留自身清理
if (state.group && state.group.parent) {
  ctx.scene!.remove(state.group);
}
```

- 核心先 dispose，adapter 再 remove（幂等：dispose 后 group 不在 scene）
- ✅ 无冲突

---

## 触发场景验证

### 场景 1：快速连续切换（无中间等待）

```
click A → switchTo("A") starts
click B → switchTo("B") starts (myGen==getGen, 通过)
B build 完成 → dispose(A) + add(B)
A build 完成 → dispose(B) + add(A)  ← 反转！最终显示 A
```

**结果**：取决于 build 速度，可能显示错误的模型。但不会崩溃或泄漏。

### 场景 2：ESC 中断 in-flight switchTo

```
switchTo("A") in progress...
ESC → closeOverlay() → aborted=true, _gen++, _handle=null
switchTo("A") 在 build 完成后检查 myGen!==getGen → dispose(A) → return
```

✅ 正确处理：新模型被 dispose，session 终止。

### 场景 3：build 期间 invalidatePreview

```
switchTo("A") in progress...
invalidatePreview() → _gen++
switchTo("A") build 完成 → myGen!==getGen → dispose(A) → return
```

✅ 正确处理：与 ESC 场景等价。

---

## 建议修复（P1）

```typescript
// switch-preview.ts: 增加 inFlight 标志
export interface SwitchContext {
  // ... existing fields ...
  inFlight: boolean;  // ← 新增
  setInFlight: (v: boolean) => void;
}

// switchToSession:
export async function switchToSession(ctx, newPath, options) {
  if (ctx.inFlight) return;  // ← 抑制并发
  ctx.setInFlight(true);
  try {
    // ... existing logic ...
  } finally {
    ctx.setInFlight(false);
  }
}

// mount-preview-core.ts switchCtx:
const inFlight = { v: false };
const switchCtx: SwitchContext = {
  // ...
  inFlight: inFlight.v,
  setInFlight: (v) => { inFlight.v = v; },
};
```

**注意**：需同步更新测试 mock。

---

## 审计统计

| 指标 | 值 |
|------|-----|
| 会话内切换入口数 | 1 (switchPreview) |
| 切换守卫数量 | 3 (aborted / isDisposed / gen) |
| 并发切换抑制 | 0 ❌ |
| 异常吞咽点 | 1 (void switchTo) |
| dispose 路径一致性 | 100%（所有 adapter 实现 dispose()） |
| Blob URL 泄漏风险 | 0（统一由 blobUrls 池管理） |

---

## 与 R9-R11 的关系

- **R9**： dispose/creation 比例 46.9%，主要泄漏点已修复
- **R10**：AnimationMixer uncacheRoot 对齐，mmd/vrm 生命周期一致
- **R11**：纹理字段全量释放，fallback 路径已补齐
- **R12**：场景切换竞态，现有守卫覆盖大部分场景，P1 修复补充并发抑制

---

## 状态复核（2026-08-23）

> 复核方法：对照本报告 P1（无并发切换抑制，表中"并发切换抑制 | 0 ❌"）与 P2（aborted 按值捕获），实证 `frontend/src/utils/3d/adapters/switch-preview.ts` 与 `mount-preview-core.ts` 当前代码现实。

| 项 | 报告评级 | 2026-08-23 代码现实 | 结论 |
|----|---------|-------------------|------|
| P1 并发切换抑制 | 🔴 0 ❌（缺失） | `switch-preview.ts:72-113` `inFlight` 守卫：切换中后续请求直接丢弃，全出口（L152/180/186/268）复位；先于 ADR-093 T6 超量拦截置位避免卡死 | ✅ 已修 |
| P2 aborted 按值捕获 | 🟢 理论缺陷 | `mount-preview-core.ts:389` `aborted = { v: false }` 改为引用对象，L835/L963 读 `aborted.v`，切换时 `aborted.v = true` 经引用传递生效，值捕获缺陷已闭合 | ✅ 已修 |

**复核结论**：本报告 P1（并发抑制）与 P2（aborted 值捕获）均已构成历史债务并已偿还。gen counter（myGen/_gen）+ isDisposed 原有守卫仍保留作纵深防御。报告原文（2026-08-18 时态快照）保留不变。
