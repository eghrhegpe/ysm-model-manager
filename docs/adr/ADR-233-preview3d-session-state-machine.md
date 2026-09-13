# ADR-233：preview-3d 会话生命周期状态机收敛（SessionStatus + teardown 单出口）

- **状态**：已采纳（Accepted）
- **实施状态**：已实施（与 preview-3d 可读性整改 #3 同提交：mount-session.ts 加 SessionStatus/guardSessionAlive/teardown，switch-preview.ts 3 处逐字咒语收敛，mount-preview-core.ts 接入 status 迁移）
- **日期**：2026-09-13
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：ADR-066（mount-preview-core 壳）、ADR-168（capability-preview-state）、ADR-125/126（状态层上浮）、ADR-093（同台追加）；代码：`preview-3d/adapters/mount-session.ts`、`preview-3d/adapters/switch-preview.ts`、`preview-3d/adapters/input-and-animation.ts`、`preview-3d/adapters/mount-preview-core.ts`

---

## 1. 背景（Context）

preview-3d 可读性整改「九宗罪 #3」：会话生命周期由**散装布尔信号**编码，且**守卫咒语重复**。实测当前代码（非报告旧稿）确认：

1. **生命周期信号散落于 3 个状态对象**，且 `isDisposed` 被**三重复制**：
   - `MpSessionState`（`mount-session.ts:33-69`）：`isDisposed: {v}`(:37)、`finished`(:40)、`aborted: {v}`(:42)
   - `SwitchContext`（`switch-preview.ts:35-89`）：`aborted`(:82)、`isDisposed`(:85)、`myGen`(:87)、`getGen`(:88)、`handles`(:77) —— 与 `MountCtx`/session **同义但独立副本**
   - `input-and-animation.ts:40`：`isDisposed: {v}` —— 第三份副本；`:206`/`:217` 以 `if (opts.isDisposed.v) return;` 作 rAF/resize 早退守卫
2. **守卫咒语逐字重复 3 次**（`switch-preview.ts:153` / `:263` / `:307`）：
   `if (ctx.aborted.v || ctx.isDisposed.v || ctx.myGen !== ctx.getGen())` —— 即报告所记「3 逐字 + 7 家族」。
3. **清理路径是 3 个函数复制粘贴共用段**，非单出口：
   - `closeOverlay`（早期 ESC，`mount-session.ts:162`）→ ②③④ + finishSession
   - `runFailedMountCleanup`（build 失败，`mount-session.ts:221`）→ ②③⑦
   - `runFullCleanup`（完整关闭，`mount-session.ts:240`）→ ①②③④⑤⑥⑦⑧⑨ + finishSession
   - 共用段 ②③④⑦ 在三处各自手写，新增清理级别必复制段落，漂移风险高。
4. **状态不可读**：无法「问会话状态」，必须组合查 `isDisposed.v` / `finished` / `aborted.v` / `inFlight`。

**既有基础（非从零）**：`mount-session.ts:1` 头注释 `2026 锐评整改：mount3D 五层闭包 → MountCtx 模块级函数` 已完成闭包→模块级函数收敛；`ownHandle`/`removeOwnHandle`（`:124`/`:132`）已单点化 `handles.find(h => h.gen === myGen)`；`finishSession`（`:146`）已是幂等单出口（由 `finished` 守卫）。本次是在此之上做**信号收口**，不是重写。

**为何低行为风险可做**：`isDisposed`/`aborted` 已是 `{v: boolean}` 可变引用（按引用传递），三方共享**同一对象**即可消除三重复制而零语义变更。

---

## 2. 决策（Decision）

引入「单一事实源 + 单出口」，分两步（A 必做、B 可选但推荐一并做）：

### A. 信号收口（必做，近零行为风险）

1. **`SessionStatus` 联合类型**（新增于 `mount-session.ts` 或 `session-status.ts`）：
   ```ts
   export type SessionStatus =
     | "idle"      // mount3D 入口，尚未 build
     | "mounting"  // build 进行中
     | "mounted"   // build 成功、活跃
     | "switching" // 会话内切换中（原 inFlight）
     | "aborting"  // ESC / invalidate 打断（原 aborted.v）
     | "disposing" // teardown 进行中
     | "finished"; // finishSession 已收尾（原 finished，幂等出口）
   ```
   作为**可读状态**，新增 `status: SessionStatus` 到 `MpSessionState`；既有 `isDisposed`/`finished`/`aborted` 在过渡期内保留为 `status` 的派生镜像（写入 `status` 时同步写旧标记），待全部读取点迁移后删除旧标记。

2. **`SessionLifecycle` 共享引用**：抽 `isDisposed`/`aborted`/`myGen`/`getGen` 为单一 `{v}` 引用袋，`SwitchContext` 与 `input-and-animation` 的 opts **直接复用 `session` 的同一引用**（不再各自 new `{v:false}`）。消除三重复制。

3. **`guardSessionAlive(lc)` 单 helper** 取代 3 处逐字咒语：
   ```ts
   export function guardSessionAlive(lc: SessionLifecycle): boolean {
     return !(lc.aborted.v || lc.isDisposed.v || lc.myGen !== lc.getGen());
   }
   ```
   `switch-preview.ts:153/263/307` 三处改为 `if (!guardSessionAlive(ctx)) { … }`。

### B. teardown 单出口（推荐，收口复制粘贴）

4. **`teardown(ctx, level)` 取代 3 个函数**：
   ```ts
   export type TeardownLevel = "early" | "failed" | "full";
   export function teardown(ctx: MountCtx, level: TeardownLevel): void {
     ctx.session.isDisposed.v = true;            // ① 终止标志（三路共用）
     if (level === "early") {                    // 原 closeOverlay
       ctx.session.aborted.v = true;
       document.removeEventListener("keydown", ctx.session.escH);
       clearTipTimer(ctx.session); ctx.menuHandle.dispose();
       if (ctx.overlay?.parentNode) ctx.overlay.parentNode.removeChild(ctx.overlay);
       finishSession(ctx); return;
     }
     clearTipTimer(ctx.session); ctx.menuHandle.dispose();  // ② ③ 共用
     unbindInputsAndStopLoop(ctx);                        // ⑦ 共用
     if (level === "failed") return;                      // 原 runFailedMountCleanup：保留 overlay
     /* level === "full"：④ ⑤ ⑥ ⑧ ⑨ + finishSession —— 原 runFullCleanup 主体 */
   }
   ```
   `closeOverlay`/`runFailedMountCleanup`/`runFullCleanup` 退化为 `teardown` 的薄包装或直删，调用点（`mount-preview-core.ts` 的 commitSession/recoverMountFailure/catch 段、ESC handler）改为传 `level` 调用 `teardown`。

---

## 3. 后果（Consequences）

正面：
- 守卫咒语 3 逐字 → 1 处 `guardSessionAlive`；`isDisposed` 三重复制 → 1 个共享引用。
- 清理路径 3 函数复制段 → 1 个 `teardown(ctx, level)`，新增清理级别只加 `level` 分支、不复制段。
- 会话状态可读（`status` 字段），调试/审计可直接问状态而非拼布尔。
- 过渡期内旧布尔保留为派生镜像，**行为等价**；按引用共享零语义变更。

负面 / 风险 / 已知遗留：
- **跨文件泄漏关键路径重构**：`teardown` 重组的是防 WebGL/内存泄漏与防双 dispose 的核心，错误会致真实泄漏。须以现有 mount/session 测试（commit `3a2fc3bd4` 前已 76 通过）+ 新增「状态迁移」单测兜底。
- `SwitchContext`/`input-and-animation` opts 改为共享 `session` 引用后，须确认二者生命周期不早于 session 释放（现状已同生命周期，安全）。
- 全量删除旧布尔标记需二次扫读所有读取点（grep `isDisposed`/`finished`/`aborted`/`inFlight`），留作二期。
- `render-host.ts` 不自持生命周期信号（委托 cleanup），不在本次改动范围。
