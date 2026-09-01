---
kind: mount3d-584-giant
name: mount3D 巨函数现状（2026-08-27 已部分拆分）
tier: leaf
category: rendering
source_files:
  - frontend/src/preview-3d/adapters/mount-preview-core.ts
quick_groups:
  - 3D 预览与模型追加
quick_intents:
  - 拆 mount3D 巨函数
  - 评审 mount-preview-core.ts
quick_risk_lines:
  - mount3D 仍 ~600 行（已拆出 mp* 子函数，但本体仍超 100 行红线）；继续往里加新逻辑需评审
pitfalls:
  - mount3D 本体仍 ~600 行 → 每加逻辑都会进一步膨胀；新逻辑应先拆为 mp* 包级函数再调用
  - safeDispose 未复用 → 重复写释放逻辑、资源泄漏；必须经 safeDispose 原语
use_when:
  - 拆 mount3D 巨函数
  - 评审 mount-preview-core.ts
perf:
  - gpu-bound
status: active
last_verified: 2026-08-27
---

# mount3D 巨函数现状（2026-08-27 已部分拆分）

## 概览

`mount3D`（mount-preview-core.ts:263-866）**604 行**，仍超 100 行红线。文件总量 **1202 行**，已拆出 5 个包级 `mp*` 子函数（`mpUnloadRole` L926-964 / `mpBuildSharedInfra` L987-1090 / `mpSyncShadowLights` L1097-1107 / `mpApplyWasdCameraMotion` L1119-1153 / `mpMakeUnifiedPickHandler` L1157-1202，共 ~276 行）；另有 `switch-preview.ts`（`switchToSession`）与 `input-and-animation.ts`（`bindInputHandlers`）已外拆。`mount3D` 本体仍含 shell 装配 + infra 创建 + 输入绑定 + rAF 管线 + 生命周期 + switch 上下文 6 阶段。

**并发竞态已闭环**：`_gen` 代际守卫已落地（L164 声明，L271 `myGen = ++_gen`，L681/L706/L862 三处 `if (myGen !== _gen) return` 弃旧）。详见 [mount-preview-module-singleton-race](./mount-preview-module-singleton-race.md)（已归档）。

## 核心职责

3D 预览统一挂载入口：单例外壳复用（renderer/canvas/overlay/scene/camera/controls）+ 声明式根菜单装配（mountPreviewRootMenu）+ shared/self 模式分支基础设施创建（mpBuildSharedInfra）+ 输入绑定（bindInputHandlers）+ rAF 渲染管线（全局唯一 loop，自适应像素比）+ 会话生命周期管理（_gen 代际守卫 + myGen 校验）+ 资源释放（fullCleanup 统一内联）。

## 对外 API / 入口

- `mount3D(adapter, path, opts)` — 唯一公开入口，返回 `Promise<void>`
- 已拆出的包级函数：`mpBuildSharedInfra` / `mpSyncShadowLights` / `mpApplyWasdCameraMotion` / `mpMakeUnifiedPickHandler` / `mpUnloadRole`
- 已外拆到独立文件：`switchToSession`（`switch-preview.ts`）/ `bindInputHandlers`（`input-and-animation.ts`）
- `MpSessionState`（L877-909）收敛体：原 14 个裸 let → 统一经此对象读写

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

## 当前残留问题

1. **mount3D 本体仍 604 行**：5 阶段挤一函数，超 100 行红线 6 倍——但已有 mp* 子函数外拆，非 584 行未动状态
2. **内联闭包已从 12+ 降至约 6**：`escH` / `closeOverlay` / `finishSession` / `fullCleanup` / `unloadRole` / `animate`（animate 仍 55 行闭包内嵌），其余已外拆
3. **`animate` 闭包 ~55 行仍嵌在 mount3D 内**：含 rAF loop + 自适应像素比 + perFrame 迭代 + 视锥裁剪 + 后处理，是下一步外拆候选
4. **`fullCleanup` 函数 ~60 行内嵌**：已在 try 块内声明，与 `finishSession` 构成「①ESC ②tipTimeout ③菜单 ④viewContainer ⑤overlay ⑥内容层 ⑦句柄 ⑧场景能力 ⑨纹理缓存 ⑩perFrame」10 步清理链

## 建议动作

- **Step 1 查证**：`mount3D` 6 阶段自然边界（shell L268-385 / 菜单 L388-430 / loading L432-435 / infra+输入绑定 L481-520 / rAF L524-592 / switchCtx L610-657 / try/cleanup L679-832 / handle L843-855）
- **Step 3 分拆**：主函数 ≤70 行纯分派，子函数 ≤80 行；已用 `mp*` 前缀，继续按此规范
- **并发守卫**：✅ 已闭环（`_gen` 代际守卫 + 三处 `myGen !== _gen` 守卫）
- **`animate` 外拆**：下一步候选——拆为 `mpStartRafLoop`（在 mount3D 内调一次，返回 stopFn）
- **`fullCleanup` 外拆**：下一步候选——拆为 `mpFullCleanup(ctx)` 纯函数，接受所有外部引用

## 相关

- 兄弟卡：`3d-超大文件-code-split-可行性`（决策：当前不拆，P3 优先级；注：该卡引用的 mount-preview-core.ts 行数 1113 已过时，现 1202 行）
- 归档卡：`mount-preview-module-singleton-race`（_gen 并发竞态已闭环，卡已转 archived）
- 统一核心：`preview_core`（ADR-066 D2 统一外壳已落地）
- ADR-066 P3（收缴 vrm/litematic 复制脚手架）
- ADR-076 v2（声明式根菜单，顶栏砍掉）
- ADR-093 T2/T5/T6（场景注册表/统一拾取/超量拦截）
