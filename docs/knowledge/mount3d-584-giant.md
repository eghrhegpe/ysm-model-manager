---
kind: mount3d-584-giant
name: mount3D-584-giant
tier: leaf
category: utils
source_files:
  - frontend/src/utils/3d/adapters/mount-preview-core.ts
use_when:
  - 拆 mount3D 巨函数
  - 评审 mount-preview-core.ts
---

# mount3D-584-giant

## 概览

`mount3D`（mount-preview-core.ts:240-823）584 行真·巨鲸，内部 12+ 内联闭包，是今日 3D 层审核（ts-package-review）的头号坏味道。今日 commits（1f1b60d4/fd4718db/85393786）抽了 `safeDispose`/`renderLoadingState`/`showLoadFailure` 原语、删了 `safeDisposeMat` 幽灵函数、合并了 `scene-lights`，但 `mount3D` 本体未拆。

## 核心职责

3D 预览统一挂载入口：单例外壳复用 + 声明式根菜单装配 + shared/self 模式分支基础设施创建 + 输入绑定 + rAF 渲染管线 + 会话生命周期管理 + 资源释放。

## 对外 API / 入口

- `mount3D(adapter, path, opts)` — 唯一公开入口，返回 `Promise<void>`
- 内部拆出的包级函数：`mpBuildSharedInfra`/`mpSyncShadowLights`/`mpApplyWasdCameraMotion`/`mpMakeUnifiedPickHandler`/`mpUnloadRole`

## 与其他子系统关系

- 上游：`views/app-preview/*` 经 `mount3D` 进入 3D 预览
- 下游：`PreviewAdapter`（vrm/litematic/mmd/pack-model/ysm）经 `build(ctx, path)` 注入内容层
- 横向：`cleanup-3d.ts`（runFullCleanup）/`switch-preview.ts`（switchToSession）/`input-and-animation.ts`（bindInputHandlers）/`camera-controls.ts`/`preview-menu.ts`（mountPreviewRootMenu）

## 不变量

- `mount3D` 签名不动（回归红线）
- 模块级单例 `_singletonOverlay/_singletonBody/_singletonViewContainer/_singletonScene/_singletonCamera/_singletonRenderer/_singletonControls` 七个可变全局，`cleanupPreview` 手动清零
- `_handles`/`_globalAnimId`/`_globalPerFrames` 三个可变全局驱动多会话

## 问题清单（ts-package-review 2026-08-27）

1. **mount3D 584 行超 100 行红线**：壳装配→基础设施→输入绑定→rAF 管线→生命周期，5 阶段挤一函数
2. **12+ 内联闭包密集**：L282-287 六个 onXxx、L400 escH、L406 closeOverlay、L479 animate、L651 unloadRole、L747 fullCleanup 等
3. **R1 变体**：10 个模块级 `let` 单例/全局，无并发守卫（多 mount3D 并发时单例创建有竞态窗口）

## 建议动作

走 `ts-giant-function-surgery` 五步流水线拆分：
- Step 1 查证：`mount3D` 5 阶段自然边界（壳装配 L291-388 / 基础设施 L423-532 / 输入绑定 L440-463 / rAF 管线 L465-532 / 生命周期 L572-789）
- Step 3 分拆：按阶段型拆，主函数 ≤70 行纯分派，子函数 ≤80 行
- 命名前缀：`mp*`（mount-preview，已用）
- 模块级单例并发守卫：`queueMicrotask` 串行化或显式 `_creating` 锁

## 相关

- 兄弟卡：`3d-超大文件-code-split-可行性`（决策：当前不拆，P3 优先级）
- ADR-066 P3（收缴 vrm/litematic 复制脚手架）
- ADR-076 v2（声明式根菜单，顶栏砍掉）
- ADR-093 T2/T5/T6（场景注册表/统一拾取/超量拦截）
