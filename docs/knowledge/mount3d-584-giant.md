---
kind: mount3d-584-giant
name: mount3D 巨函数拆分现状（2026-10-06 复核）
tier: leaf
adr:
  - ADR-091
category: rendering
source_files:
  - frontend/src/preview-3d/adapters/mount-preview-core.ts
auto_fields:
  symbols_with_lines:
    - _resetSingletons
    - AssembledShell
    - BaseScene
    - CameraControlScene
    - cleanupPreview
    - GroupedScene
    - hasActivePreview
    - InstalledPreviewInfra
    - invalidatePreview
    - mount3D
    - Mount3DOptions
    - PoseScene
    - PreviewAdapter
    - PreviewBuildCtx
    - PreviewHandle
    - PreviewScene
    - ScreenshotScene
    - SemanticScene
    - switchPreview
    - UpdateableScene
quick_groups:
  - 3D 预览与模型追加
quick_intents:
  - 拆 mount3D 巨函数
  - 评审 mount-preview-core.ts
quick_risk_lines:
  - mount3D 本体仍超 100 行红线（已从巨函数收缩为薄壳装配器，量级降至约 1.3 倍）；继续往里加新逻辑需评审
pitfalls:
  - mount3D 本体仍超 100 行红线 → 每加逻辑都会进一步膨胀；新逻辑应先拆为模块级函数（mount-session.ts / shared-infra.ts）再调用
  - safeDispose 未复用 → 重复写释放逻辑、资源泄漏；必须经 safeDispose 原语
use_when:
  - 拆 mount3D 巨函数
  - 评审 mount-preview-core.ts
perf:
  - gpu-bound
status: active
last_verified: 2026-10-06
---

# mount3D 巨函数拆分现状（2026-10-06 复核）

## 2026-10-06 复核（最新实测，取代此前全部快照行号）

`mount3D`（`mount-preview-core.ts|mount3D`）本体已从巨函数收缩为**薄壳装配器**：2026-10-06 大括号实测签名至函数尾约百行级，仍超 100 行红线但量级已从「数倍」降到「约 1.3 倍」——精确行数属会漂移的度量，此处只留定性判断。旧快照引用的「旧 §5 区块行号」「旧文件行数」早已随拆分漂移，**勿再沿旧行号查询**（按符号定位）。

**生命周期闭包已提为模块级函数并外置**（2026 锐评整改，比 9-05 复核更进一步）：
- `mount-session.ts` — `MpSessionState` + `MountCtx` + `finishSession`/`closeOverlay`/`runFullCleanup`/`unloadSessionModel` + `ownHandle`/`removeOwnHandle`（2026 锐评 P1：gen-scoped 句柄查找/摘除收敛于此，5 处手写 `handles.find(h => h.gen === myGen)` 退役——含 buildCtx.switchTo 闭包与 menuCtx 的 P0「多会话误触发他人切换」修复点）
- `shared-infra.ts` — `buildSharedInfra`/`syncShadowLights`（场景单例）
- `render-loop.ts` — rAF 全局循环 + perFrame 注册表
- `wasd-camera.ts`/`unified-pick.ts`/`unload-model.ts`/`input-and-animation.ts`/`switch-preview.ts` — 分别承载 WASD/拾取/卸载/输入/会话切换

「再拆 vs 维持」的结构性判定仍成立（闭包接线器无 stage 缝，强行外移需 15-20 参数 ctx 化，ROI 低），最重的生命周期函数已外置；**残余内嵌闭包仅剩 `escH`**（`mount-preview-core.ts|escH` 相关段——session 可变引用，与 `switchTo` 的旧 handler 替换语义耦合，见卡片 `preview-core` §不变量）与 animate/rAF 调度（`render-loop.ts` 持有的 perFrame 表）。旧文的「6 个内嵌闭包」「fullCleanup ~60 行内嵌」等表述已过时。

**代际守卫**（并发安全核心）：代际计数器自 ADR-227 起由 `session-ledger.ts|sessionLedger`（`SessionLedgerHost` 实例）持有 / `mount3D` 入口 `sessionLedger.beginSession()` 分配代数 / 三处 `ctx.myGen !== ctx.getGen()` 守卫弃旧（与卡片 `mount-preview-module-singleton-race` 一致）。

---

## 历史演化脉络（快照行号一律失效，仅存阶段划分）

- **2026-09-03 复核**：§5 二次拆分落地——5 个包级 `mp*` 子函数全部外移为独立文件并去 `mp` 前缀（`shared-infra.ts` / `wasd-camera.ts` / `unified-pick.ts` / `unload-model.ts` / `input-and-animation.ts` / `switch-preview.ts`）；`safeDispose` 外置 `preview-3d/infra/safe-dispose.ts`。结构性判定：**维持「不拆」**——mount-preview-core 的实体逻辑已全部外置，剩余是**闭包接线编排器**（6 个内嵌闭包 + session/switchCtx/camBridge 接口胶水），段落共享 15+ 闭包变量，无 stage 缝——强行外移 = 参数 ctx 化，行数不降、类型面暴增、高风险。
- **2026-08-27 快照**：`mount3D` 曾是超红线巨函数，文件总量超千行，已拆出 5 个包级 `mp*` 子函数与 `switch-preview.ts`/`input-and-animation.ts`；并发竞态经 `_gen` 代际守卫闭环（后随 ADR-227 迁入 `sessionLedger`）。

## 概览

`mount3D` 是 3D 预览统一挂载入口：单例外壳复用（renderer/canvas/overlay/scene/camera/controls）+ 声明式根菜单装配（mountPreviewRootMenu）+ shared/self 模式分支基础设施创建（`buildSharedInfra`，共享 infra 见 `shared-infra.ts`）+ 输入绑定（`bindInputHandlers`，`input-and-animation.ts`）+ rAF 渲染管线（全局唯一 loop，`render-loop.ts`，自适应像素比）+ 会话生命周期管理（代际守卫 + `myGen` 校验，代际/句柄表在 `session-ledger.ts`，生命周期函数在 `mount-session.ts`）+ 资源释放（`runFullCleanup(ctx)` 统一出口）。

## 对外 API / 入口

- `mount3D(adapter, path, opts)` — 唯一公开入口，返回 `Promise<void>`
- 已外拆模块：`mount-session.ts`（`MpSessionState` + `MountCtx` + finishSession/closeOverlay/runFullCleanup/unloadSessionModel）、`shared-infra.ts`（buildSharedInfra/syncShadowLights）、`render-loop.ts`（rAF + perFrame）、`wasd-camera.ts` / `unified-pick.ts` / `unload-model.ts` / `input-and-animation.ts` / `switch-preview.ts`
- `MpSessionState` 收敛体（现在 `mount-session.ts`，原 14 个裸 let → 统一经此对象读写）

## 与其他子系统关系

- 上游：`views/app-preview/*` 经 `mount3D` 进入 3D 预览
- 下游：`PreviewAdapter`（vrm/litematic/mmd/pack-model/ysm）经 `build(ctx, path)` 注入内容层
- 横向：`cleanup-3d.ts`（**已删除僵尸实现**，cleanup 已内联至 fullCleanup）/ `switch-preview.ts`（`switchToSession`）/ `input-and-animation.ts`（`bindInputHandlers`）/ `preview-3d/menu/engine/core.ts`（`mountPreviewRootMenu`）

## 不变量

- `mount3D` 签名不动（回归红线）
- 外壳/场景单例已随 ADR-227 收敛为 host 实例字段（`previewShell`/`sceneInfraHost`/`rendererHost`/`sessionLedger`，原模块级 `let`）；`cleanupPreview` 经 `previewShell.resetRefs()` + `resetSceneInfra()` + `sessionLedger.clear()` 清零
- 代际守卫驱动多会话（`sessionLedger.invalidate()` 弃旧，`ctx.myGen !== ctx.getGen()` 校验防并发重叠）
- `MpSessionState.finished` 标记保证 `finishSession` 幂等（closeOverlay 早期路径与 fullCleanup post-build 路径共用）
- `sessionLedger.handles` 数组按 `gen` 字段索引查找，避免多会话误删（数组身份由台账保证：只原地增删、不换表）

## 当前残留问题（2026-10-06 复核后实况）

1. **mount3D 本体约百行（定性为合法装配器厚度，2026-10-09 锐评改口径）**：薄壳装配器——最重生命周期已外置（mount-session.ts），非巨函数状态。历史口径「仍超 100 行红线」对不可变事实反复批评、不产生行为变化，已改判为**装配器职责下的合法厚度**，不再计入红线违规；判据见下方「建议动作」。
2. **内嵌闭包仅剩 `escH`**：`escH` 可变引用（与 `switchTo` 旧 handler 替换语义耦合）仍内嵌；`animate`/perFrame 调度由 `render-loop.ts` 持有
3. **`animate` 调度已外置**：rAF loop + 自适应像素比 + perFrame 迭代 + 视锥裁剪 + 后处理由 `render-host.ts` 的 `RendererHost` 承载（`render-loop.ts` 现为薄门面，ADR-227）
4. ~~**`fullCleanup` 内嵌**~~：已外置为 `mount-session.ts` 的 `runFullCleanup(ctx)`（MountCtx 上下文模式，10 步清理链语义保留）

## 建议动作

- **再拆 vs 维持**：维持（闭包接线器无 stage 缝，ctx 化 ROI 低）；继续往里加新逻辑需评审。**红线口径（2026-10-09 锐评改判）**：装配-接线-生命周期三职责的编排器天然有厚度——这是「此类编排器该有专属红线口径」而非「函数写这么长也健康」的证明，二选一应改红线口径而非每年复查时写一句「仍然超红线」。本卡从「违规」改判为「合法装配器厚度」。若未来继续膨胀**超出口径红线值**（口径见 `check-file-lines.ts` 装配器条目与 gate-config），再拆为装配/生命周期两阶段。
- **并发守卫**：✅ 已闭环（代际守卫 + 三处 `ctx.myGen !== ctx.getGen()` 守卫）
- **`animate` 外拆**：✅ 已落地——`render-host.ts` 的 `RendererHost`（`render-loop.ts` 现为薄门面，ADR-227）
- **`fullCleanup` 外拆**：✅ 已落地为 `mount-session.ts` 的 `runFullCleanup(ctx)`

## 相关

- 兄弟卡：`3d-oversize-file-codesplit-feasibility`（docs/archive，决策：当前不拆，P3 优先级）
- 归档卡：`mount-preview-module-singleton-race`（_gen 并发竞态已闭环，卡已转 archived）
- 统一核心：`preview-core`（ADR-066 D2 统一外壳已落地）
- ADR-066 P3（收缴 vrm/litematic 复制脚手架）
- ADR-076 v2（声明式根菜单，顶栏砍掉）
- ADR-093 T2/T5/T6（场景注册表/统一拾取/超量拦截）
