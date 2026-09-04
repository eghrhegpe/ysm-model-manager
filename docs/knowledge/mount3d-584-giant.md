---
kind: mount3d-584-giant
name: mount3D 巨函数现状（2026-08-27 已部分拆分）
tier: leaf
adr:
  - ADR-091
category: rendering
source_files:
  - frontend/src/preview-3d/adapters/mount-preview-core.ts
auto_fields:
  symbols_with_lines:
    - _resetSingletons
    - BaseScene
    - CameraControlScene
    - cleanupPreview
    - GroupedScene
    - hasActivePreview
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
  - mount3D 本体 527 行（L351-877，预置顶复核节实测），仍超 100 行红线；继续往里加新逻辑需评审
pitfalls:
  - mount3D 本体 527 行（L351-877，2026-09-05 实测）→ 每加逻辑都会进一步膨胀；新逻辑应先拆为模块级函数（mount-session.ts / shared-infra.ts）再调用
  - safeDispose 未复用 → 重复写释放逻辑、资源泄漏；必须经 safeDispose 原语
use_when:
  - 拆 mount3D 巨函数
  - 评审 mount-preview-core.ts
perf:
  - gpu-bound
status: active
last_verified: 2026-09-03
---

# mount3D 巨函数现状（2026-08-27 已部分拆分）

## 2026-09-05 复核（最新实测，取代 9-03/8-27 快照行号）

`frontend/src/preview-3d/adapters/mount-preview-core.ts` 现 **888 行**。`mount3D` 本体 **L351-877 ≈ 527 行**，仍是文件主体（超 100 行红线 5 倍）。文件尾 L879-888 为 §5 会话状态注释块（原「L938-944」引用的旧 §5 区块早已随拆分移动，勿再用旧行号）。

**生命周期闭包已提为模块级函数并外置**（2026 锐评整改，比 9-03 复核更进一步）：
- `mount-session.ts`（276 行）— `MpSessionState` + `MountCtx` + `finishSession`/`closeOverlay`/`runFullCleanup`/`unloadSessionModel`
- `shared-infra.ts`— `buildSharedInfra`/`syncShadowLights`（场景单例）
- `render-loop.ts` — rAF 全局循环 + perFrame 注册表
- `wasd-camera.ts`/`unified-pick.ts`/`unload-model.ts`/`input-and-animation.ts`/`switch-preview.ts` — 分别承载 WASD/拾取/卸载/输入/会话切换

「再拆 vs 维持」的结构性判定仍成立（闭包接线器无 stage 缝，强行外移需 15-20 参数 ctx 化，ROI 低），最重的生命周期函数已外置；**残余内嵌闭包仅剩 `escH`**（L611/L831，session 可变引用，与 `switchTo` 的旧 handler 替换语义耦合，见卡片 `preview_core` §不变量）与 animate/rAF 调度（render-loop.ts 持有的 perFrame 表）。旧文的「6 个内嵌闭包」「fullCleanup ~60 行内嵌」等表述已过时。

**`_gen` 代际守卫**（并发安全核心）：L249 声明 / L363 `myGen = ++_gen` / L730·L755·L873 三处守卫（与卡片 `mount-preview-module-singleton-race` 一致）。

---

## 2026-09-03 复核（历史快照，行号已漂移，以上方 9-05 实测为准）

mount-preview-core.ts 现 983 行（8-27 快照 1202 行 → 经 §5 二次拆分收缩）。`mount3D` 本体 L285-936 ≈ **652 行**。

**§5 二次拆分已落地**：8-27 记录的 5 个包级 `mp*` 子函数已全部外移为独立文件并去 `mp` 前缀——
`shared-infra.ts`（buildSharedInfra/syncShadowLights）/ `wasd-camera.ts`（applyWasdCameraMotion）/
`unified-pick.ts`（makeUnifiedPickHandler）/ `unload-model.ts`（unloadModel）/ `input-and-animation.ts`
（bindInputHandlers）/ `switch-preview.ts`（switchToSession）。`safeDispose` 已外置 `preview-3d/safe-dispose.ts`。
文件头 L938-944 §5 注释为实证（本卡正文旧行号/旧 mp* 描述以复核节为准）。

**结构性判定：维持「不拆」**（评审再次点名）。与 mmd-adapter（ADR-167 已拆 9 文件）的本质差异：
- mmd-adapter 拆前 stage 已顶层化（MdMmBuildCtx 六域接口 + Pick 收窄）→ **有真缝**，沿缝搬移零逻辑改动；
- mount-preview-core 的实体逻辑已全部外置为模块级函数，剩余 ~650 行是**闭包接线编排器**
  （6 个内嵌闭包 finishSession/closeOverlay/fullCleanup/unloadSessionModel/escH/animate + session/
  switchCtx/camBridge 接口胶水），段落共享 15+ 闭包变量，**无 stage 缝**——强行外移 = 15-20 参数
  ctx 参数化，行数不降、类型面暴增、高风险。残余候选（仅真有缝才做）：fullCleanup（827-890）
  拆 `mpFullCleanup(ctx)`，P3 ROI 低。文件头快速跳转表已按当前布局校准（原 L100-L741 全漂移）。

> ⚠️ 注：9-03 快照的「剩余 ~650 行接线编排器 + 6 个内嵌闭包」已被 9-05 实测超越——最重生命周期闭包已外置（mount-session.ts），仅 escH 内嵌，见置顶复核节；下文 8-27 快照的行号/行数一律失效。

## 概览

> ⬇️ 本节为 2026-08-27 历史快照（行号/行数全部失效，仅存历史演化脉络）。当前实况见置顶「2026-09-05 复核」。

`mount3D`（mount-preview-core.ts:263-866）**604 行**，仍超 100 行红线。文件总量 **1202 行**，已拆出 5 个包级 `mp*` 子函数（`mpUnloadRole` L926-964 / `mpBuildSharedInfra` L987-1090 / `mpSyncShadowLights` L1097-1107 / `mpApplyWasdCameraMotion` L1119-1153 / `mpMakeUnifiedPickHandler` L1157-1202，共 ~276 行）；另有 `switch-preview.ts`（`switchToSession`）与 `input-and-animation.ts`（`bindInputHandlers`）已外拆。`mount3D` 本体仍含 shell 装配 + infra 创建 + 输入绑定 + rAF 管线 + 生命周期 + switch 上下文 6 阶段。

**并发竞态已闭环**：`_gen` 代际守卫已落地（L164 声明，L271 `myGen = ++_gen`，L681/L706/L862 三处 `if (myGen !== _gen) return` 弃旧）。详见 [mount-preview-module-singleton-race](./mount-preview-module-singleton-race.md)（已归档）。

## 核心职责

3D 预览统一挂载入口：单例外壳复用（renderer/canvas/overlay/scene/camera/controls）+ 声明式根菜单装配（mountPreviewRootMenu）+ shared/self 模式分支基础设施创建（`buildSharedInfra`，共享 infra 见 `shared-infra.ts`）+ 输入绑定（`bindInputHandlers`，`input-and-animation.ts`）+ rAF 渲染管线（全局唯一 loop，`render-loop.ts`，自适应像素比）+ 会话生命周期管理（_gen 代际守卫 + myGen 校验，生命周期函数在 `mount-session.ts`）+ 资源释放（`runFullCleanup(ctx)` 统一出口）。

## 对外 API / 入口

- `mount3D(adapter, path, opts)` — 唯一公开入口，返回 `Promise<void>`（L351 声明）
- 已外拆模块：`mount-session.ts`（`MpSessionState` + `MountCtx` + finishSession/closeOverlay/runFullCleanup/unloadSessionModel）、`shared-infra.ts`（buildSharedInfra/syncShadowLights）、`render-loop.ts`（rAF + perFrame）、`wasd-camera.ts` / `unified-pick.ts` / `unload-model.ts` / `input-and-animation.ts` / `switch-preview.ts`
- `MpSessionState` 收敛体（现在 `mount-session.ts`，原 14 个裸 let → 统一经此对象读写）

## 与其他子系统关系

- 上游：`views/app-preview/*` 经 `mount3D` 进入 3D 预览
- 下游：`PreviewAdapter`（vrm/litematic/mmd/pack-model/ysm）经 `build(ctx, path)` 注入内容层
- 横向：`cleanup-3d.ts`（**已删除僵尸实现**，cleanup 已内联至 fullCleanup）/ `switch-preview.ts`（`switchToSession`）/ `input-and-animation.ts`（`bindInputHandlers`）/ `preview-menu/core.ts`（`mountPreviewRootMenu`）

## 不变量

- `mount3D` 签名不动（回归红线）
- 模块级单例 `_singletonOverlay/_singletonBody/_singletonViewContainer/_singletonScene/_singletonCamera/_singletonRenderer/_singletonControls` 七个可变全局，`cleanupPreview` 手动清零
- `_gen` 代际守卫驱动多会话（`_gen++` 弃旧，`myGen` 校验防并发重叠）
- `MpSessionState.finished` 标记保证 `finishSession` 幂等（closeOverlay 早期路径与 fullCleanup post-build 路径共用）
- `_handles` 数组按 `gen` 字段索引查找，避免多会话误删

## 当前残留问题（2026-09-05 复核后实况）

1. **mount3D 本体 527 行**（L351-877）：闭包接线编排器，超 100 行红线 5 倍——但最重生命周期已外置（mount-session.ts），非 584 行未动状态
2. **内嵌闭包仅剩 `escH`**：`escH` 可变引用（L611/L831，与 `switchTo` 旧 handler 替换语义耦合）仍内嵌；`animate`/perFrame 调度由 `render-loop.ts` 持有
3. **`animate` 调度已外置**：rAF loop + 自适应像素比 + perFrame 迭代 + 视锥裁剪 + 后处理由 `render-loop.ts` 承载（不再是 mount3D 内嵌闭包）
4. ~~**`fullCleanup` ~60 行内嵌**~~：已外置为 `mount-session.ts` 的 `runFullCleanup(ctx)`（MountCtx 上下文模式，10 步清理链语义保留）

## 建议动作

- **Step 1 查证**（8-27 快照行号，已失效，仅存阶段划分脉络）：`mount3D` 6 阶段自然边界（shell L268-385 / 菜单 L388-430 / loading L432-435 / infra+输入绑定 L481-520 / rAF L524-592 / switchCtx L610-657 / try/cleanup L679-832 / handle L843-855）
- **Step 3 分拆**：主函数 ≤70 行纯分派，子函数 ≤80 行；已用 `mp*` 前缀，继续按此规范
- **并发守卫**：✅ 已闭环（`_gen` 代际守卫 + 三处 `myGen !== _gen` 守卫）
- **`animate` 外拆**：下一步候选——拆为 `mpStartRafLoop`（在 mount3D 内调一次，返回 stopFn）
- **`fullCleanup` 外拆**：下一步候选——拆为 `mpFullCleanup(ctx)` 纯函数，接受所有外部引用

## 相关

- 兄弟卡：`3d-超大文件-code-split-可行性`（决策：当前不拆，P3 优先级；注：该卡引用的 mount-preview-core.ts 行数 1113/1202 已过时，现 888 行）
- 归档卡：`mount-preview-module-singleton-race`（_gen 并发竞态已闭环，卡已转 archived）
- 统一核心：`preview_core`（ADR-066 D2 统一外壳已落地）
- ADR-066 P3（收缴 vrm/litematic 复制脚手架）
- ADR-076 v2（声明式根菜单，顶栏砍掉）
- ADR-093 T2/T5/T6（场景注册表/统一拾取/超量拦截）
