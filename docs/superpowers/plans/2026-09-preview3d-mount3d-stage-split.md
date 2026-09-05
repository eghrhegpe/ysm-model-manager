# mount3D 拆 4 stage 实施方案（纯搬家不逻辑）

> 状态：调研方案（未动业务代码）
> 范围：`frontend/src/preview-3d/adapters/mount-preview-core.ts`（仅此一文件的函数体拆分；不新增业务逻辑，不迁移任何模块）
> 关联范式：ADR-167（800 行老将拆单兵）、同目录 `mount-session.ts` / `render-loop.ts` / `switch-preview.ts` / `shared-infra.ts` / `input-and-animation.ts` / `unified-pick.ts` / `unload-model.ts` 的既成叶模块拆分先例

---

## 1. 目标与「纯搬家不逻辑」原则

### 1.1 目标

把 `mount-preview-core.ts` 里的 `mount3D`（L351–L877，527 行「上帝函数」）拆成 4 个模块级 stage 函数 + 1 个失败恢复叶函数，`mount3D` 退化为纯调度层（<50 行）。

### 1.2 红线（AGENTS.md 对齐）

- ✅ **纯搬家不逻辑**：527 行函数体按行号区间搬进 stage 函数，零语义改动。不合并、不重排、不「顺手优化」。唯一允许的新增物是：3 个段间类型、5 个 stage/叶函数签名、1 个调度层。任何「顺手修正」单独列为可选的后续步骤（见 §8 的 input 状态脱节点），不进本方案主体。
- ✅ **公共 API 签名不变**：`mount3D / switchPreview / hasActivePreview / invalidatePreview / cleanupPreview / _resetSingletons` 及全部导出类型（`PreviewAdapter / PreviewBuildCtx / PreviewScene / BaseScene / Mount3DOptions / PreviewHandle` 等）签名与导出方式零改动（见 §6 消费者清单）。
- ✅ **复用既有叶模块**：scene/camera/renderer/caps 已在 `shared-infra.ts`，rAF 已在 `render-loop.ts`，会话终结已在 `mount-session.ts`，切换已在 `switch-preview.ts`。4 个 stage **只做编排衔接，不重写任何叶模块活**。
- ✅ **类型安全 / 无 `!` 滥用**：段间产物用显式 interface（`AssembledShell / InstalledPreviewInfra / MountBuildResult`），stage 形参/返回强类型；搬家保留既有 `biome-ignore` 注释与 `?.` 特性探测，不新增 `noNonNullAssertion`。

### 1.3 关键架构决策（长治久安）

- **ctx（`MountCtx`）继续充当跨 stage 的可变句柄袋**（它已是 `mount-session.ts` 的既有契约，`finishSession/closeOverlay/runFullCleanup/runFailedMountCleanup` 都经它读写）。4 个 stage 接收 `ctx`，把装配产物**写回 ctx 字段**，同时把「新产物」用显式类型返回，供下游 stage 消费。
- **段间流转用显式返回值**，不用 ctx 隐式字段传递新产物——这样每个 stage 的输入输出可读、可单测、可 mock（对齐锐评「测试只能 mock 全量喂」的痛点：拆后可按 stage 喂最小依赖）。
- **try/catch 骨架留在调度层**（`mount3D` 内），catch 体抽成 `recoverMountFailure(ctx, loadingEl, e)` 叶函数。理由：原 try 包住「runBuild + commitSession」两段（L728–L850），`commitSession` 的 `_handles.push`（L850）必须在 try 内，否则失败路径的 `runFailedMountCleanup` 语义错位。try/catch 是否下沉到 stage 的利弊见 §7 风险。

---

## 2. mount3D 现状结构图（行号 → 职责 → 段间变量）

> 行号以当前 `mount-preview-core.ts` 为准。函数体 L351–L877。

| 行号区间 | 职责 | 依赖/产出的段间变量 | 拟归入 stage |
|---|---|---|---|
| L351–L355 | 函数签名 | `adapter/path/opts` | 调度层 |
| L356–L362 | 焦点记忆 + 样式注入（`rememberTrigger / installUiComponentsStyles / ensureMpcStyles`） | 模块级副作用 | 调度层 |
| L363–L368 | `myGen / selfMode / sessionId` | `_gen / _mountSessionSeq` 模块级 | ctx 骨架（assembleShell） |
| L370–L388 | `session: MpSessionState`（14 字段收敛体） | 几乎全段读写 | ctx 骨架（assembleShell） |
| L390–L393 | `keys / mouseDown / lastMouse`（input 状态，**不进 session**） | buildInfra 消费 | ctx 骨架（assembleShell） |
| L395–L397 | `infra: SharedInfra \| null` 声明 | buildInfra 赋值，runBuild/commit 读 | ctx 骨架（assembleShell） |
| L399–L408 | `handlers` 集合（no-op 初始） | buildInfra 填充，cleanup 解绑 | ctx 骨架（assembleShell） |
| L410–L411 | `focusTrap` | assembleShell 填充，finishSession 释放 | ctx 骨架（assembleShell） |
| L413–L414 | `switchCtx: SwitchContext` 声明（延迟赋值） | buildInfra 赋值 | ctx 骨架（assembleShell） |
| L415–L440 | `ctx: MountCtx`（句柄袋） | 生命周期函数共享 | ctx 骨架（assembleShell） |
| L442–L487 | 外壳 DOM：`overlay/body/root`（单例复用 + shadowRoot） | 读写 `_singletonOverlay/_singletonBody` | assembleShell |
| L488–L493 | 焦点陷阱安装 + `ctx.overlay` | 写 `focusTrap.cleanup` | assembleShell |
| L500–L526 | `camBridge: CameraControlBridge` | 读 `session.orbitMode/camSpeed/infra`，写 `mouseDown`；`ctx.camBridge` | assembleShell |
| L528–L539 | `viewContainer`（复用单例）+ `ctx.viewContainer` | 读写 `_singletonViewContainer`，读 `body` | assembleShell |
| L541–L600 | `menuCtx + menuHandle` + `sceneRegistry.setMenuSink` | 读 `camBridge/viewContainer/session/opts/adapter`；`ctx.menuHandle` | assembleShell |
| L602–L605 | `loadingEl` + `ctx.loadingEl` | 读 `viewContainer` | assembleShell |
| L607–L617 | `session.escH` 初始 + `keydown` 监听 | 读 `session.cleanupFn`；`closeOverlay` | buildInfra |
| L619–L623 | `infra = buildSharedInfra(...)` + `enableRotate` 同步 | 读 `adapter/viewContainer/menuHandle` | buildInfra |
| L625–L649 | 输入绑定 `bindInputHandlers` + 统一拾取器 | 读/写 `handlers/keys/mouseDown/lastMouse/euler/infra`；`session.onUnifiedPick` | buildInfra |
| L651–L656 | `startGlobalRenderLoop`（含首帧） | 读 `keys/session/viewContainer/infra` | buildInfra |
| L658–L666 | `tip` 提示条 + `session.tipTimeoutId` | 读 `root/body/session` | buildInfra |
| L674–L724 | `switchCtx` 赋值 | 读 `infra/session/loadingEl/viewContainer/overlay/menuHandle/camBridge` | buildInfra |
| L728–L730 | 代际守卫（`myGen !== _gen`） | 读 `_gen` | runBuild |
| L732–L733 | `session.sceneBaseline` 快照 | 读 `infra.scene` | runBuild |
| L734–L753 | `buildCtx` 构造（含 switchTo 延迟闭包） | 读 `viewContainer/loadingEl/root/menuHandle/camBridge/sessionId/infra` | runBuild |
| L754 | `await adapter.build(buildCtx, path)` | 写 `session.content` | runBuild |
| L755–L765 | **abort 分支**：补登记 allContent + `runFullCleanup` + return | 读 `session.aborted/myGen/content` | runBuild（返回 null） |
| L771–L792 | 相机同步 + light/shadow/env 同步 | 读/写 `infra.orbitTarget/euler/lightCap/shadowCap/environmentCap/sceneBaseline` | runBuild |
| L793 | `setPerFrame(content.update ?? null)` | 写 `session.perFrame` + rAF 注册表 | runBuild |
| L796–L821 | allContent push + `sceneRegistry.register` + `setAdapterItems` | 读 `session.content/infra`；写 `sceneRegistry` | runBuild |
| L830–L835 | escH 替换（先存旧引用再换） | 读/写 `session.escH` | commitSession |
| L836–L850 | `sessionHandle` 构造 + `_handles.push` | 读 `session.content`；`switchToSession(switchCtx)`；写 `_handles` | commitSession |
| L851–L876 | **catch 失败清理** | 读 `session.escH/sceneBaseline/allContent/aborted`；`runFailedMountCleanup` | recoverMountFailure |

### 2.1 5 条生命周期分支边界（拆分后归属）

| 分支 | 原始行号 | 拆分后归属 | 说明 |
|---|---|---|---|
| 正常 apply | L728–L850 | runBuild + commitSession | try 主路径 |
| abort（build 中途被打断） | L755–L765 | runBuild 内，改为 `return null` | 已 `runFullCleanup`，调度层直接 return |
| 失败 catch | L851–L876 | `recoverMountFailure(ctx, loadingEl, e)` | 调度层 catch 体单行调用 |
| cooperate 协作 | L796（allContent 累积）+ mount-session `runFullCleanup` | runBuild + 叶模块 | 逻辑原封不动 |
| switch 切换 | L836–L849（`switchTo` 闭包 → `switchToSession`） | commitSession + `switch-preview.ts` | 已叶化，stage 只接引用 |

---

## 3. 既有叶模块接口对齐（stage 只做编排衔接）

| 活 | 已在叶模块 | stage 里只剩 |
|---|---|---|
| scene/camera/renderer/controls + caps `createAll/loadAll/apply` + Shadow/postProc 联动 | `shared-infra.ts` `buildSharedInfra()` | `buildInfra` 调一次 + 接 `SharedInfra` 返回 |
| rAF 全局循环 + 首帧 + perFrame 注册表 | `render-loop.ts` `startGlobalRenderLoop/registerPerFrame/removePerFrame/stopIfIdle` | `buildInfra` 调一次 |
| 会话终结/关闭/清理 | `mount-session.ts` `closeOverlay/runFullCleanup/runFailedMountCleanup/finishSession` | 各 stage 直接调（经 `ctx`） |
| 会话内切换 | `switch-preview.ts` `switchToSession` + `SwitchContext` | `commitSession` 把 `switchCtx` 喂给闭包 |
| 输入绑定 | `input-and-animation.ts` `bindInputHandlers` | `buildInfra` 调 + 回填 `handlers` |
| 统一拾取 | `unified-pick.ts` `makeUnifiedPickHandler` | `buildInfra` 调 |
| 模型卸载 | `unload-model.ts` / `mount-session.ts` `unloadSessionModel` | `assembleShell` 的 `menuCtx.unloadModel` 接引用 |

**结论**：`buildInfra` 里 90% 的「基础设施装配」早在 `buildSharedInfra` 里完成，`buildInfra` 只是「调叶模块 + 回填 ctx/handlers/switchCtx」的薄编排。`runBuild` 同理——`apply/首帧` 不在 runBuild（任务描述里的「+ apply + 首帧」在真实代码里已被 `shared-infra.ts` 和 `render-loop.ts` 吃掉了），`runBuild` 只负责 `adapter.build` 调用 + build 后同步（相机/light/shadow/env/setPerFrame/注册表登记）。

---

## 4. 段间显式类型（新增 3 个 interface）

```ts
/** stage 1 assembleShell 产物：外壳 DOM 句柄 + 相机桥 + 菜单 + input 状态 */
interface AssembledShell {
  overlay: HTMLElement;
  body: HTMLElement;
  /** ADR-175 M1：shadow 化后为 host.shadowRoot（降级为 host 本体） */
  root: HTMLElement | ShadowRoot;
  viewContainer: HTMLElement;
  loadingEl: HTMLElement;
  menuHandle: PreviewMenuHandle;
  camBridge: CameraControlBridge;
  /** input 状态（bindInputHandlers / startGlobalRenderLoop 消费） */
  keys: Partial<Record<TdKeyAction, boolean>>;
  lastMouse: { x: number; y: number };
  /** 见 §8：mouseDown 现状是 let 布尔，camBridge 闭包捕获；此处暴露 buildInfra 构造 inputOpts 的快照 */
  mouseDown: boolean;
}

/** stage 2 buildInfra 产物：已安装 shared 基础设施 + 会话内切换上下文 */
interface InstalledPreviewInfra {
  /** shared 模式非 null；self 模式 null（适配器自驱） */
  infra: SharedInfra | null;
  switchCtx: SwitchContext;
}

/** stage 3 runBuild 产物：构建成功的内容层（stage 4 commit 消费） */
interface MountBuildResult {
  /** 已 build 成功、已登记进 session.allContent 的内容层 */
  content: PreviewScene;
}
```

> `SharedInfra` 复用 `shared-infra.ts` 导出；`SwitchContext` 复用 `switch-preview.ts` 导出；`TdKeyAction` 复用 `keymap.ts` 导出——**不新造轮子**。

---

## 5. 4 stage 签名草案 + 行号映射表

### 5.1 `assembleShell(ctx): AssembledShell` —— 外壳 + ctx 骨架

> 覆盖 L363–L605（ctx 骨架 + 外壳 DOM + camBridge + viewContainer + menu + loadingEl）。

```ts
function assembleShell(ctx: MountCtx): AssembledShell {
  // ===== ctx 骨架（L363–L440）=====
  // myGen/selfMode/sessionId/session/keys/mouseDown/lastMouse/infra 声明/
  // handlers/focusTrap/switchCtx 声明/ctx 对象 —— 全部就地装配，写回入参 ctx（此处
  // ctx 已由调度层预置头部不变量 adapter/opts/handles/_handles 引用等）
  // ...
  // ===== 外壳 DOM（L442–L605）=====
  // overlay/body/root → focusTrap → camBridge → viewContainer → menuCtx/menuHandle/
  // setMenuSink → loadingEl
  return { overlay, body, root, viewContainer, loadingEl, menuHandle, camBridge, keys, lastMouse, mouseDown };
}
```

**形参**：`ctx: MountCtx`（含 `adapter/opts/session/handles/clearSingletons` 等头部不变量——由调度层先置好）。
**返回**：`AssembledShell`。
**副作用**：`ctx.overlay/viewContainer/loadingEl/menuHandle/camBridge/focusTrap` 就位；`sceneRegistry.setMenuSink(...)`；`_singletonOverlay/_singletonBody/_singletonViewContainer` 首次创建/复用。

> ⚠️ 依赖顺序契约（不可打乱）：`camBridge`（L503）必须定义在 `menuCtx`（L544）之前（menuCtx 的 `getCamBridge` 闭包读它）；`menuHandle`（L597）必须定义在 `loadingEl`（L602）之前不影响，但 `setMenuSink`（L600）必须早于 `buildSharedInfra`（`buildInfra` 内，因为 `buildSharedInfra` 尾部 `menuHandle.refreshDock` 依赖 cap lookup 已注入）。

### 5.2 `buildInfra(ctx, shell): InstalledPreviewInfra` —— 基础设施装配

> 覆盖 L607–L666 + L674–L724。

```ts
function buildInfra(ctx: MountCtx, shell: AssembledShell): InstalledPreviewInfra {
  // escH 初始 + keydown（L607–L617）
  // if (!ctx.selfMode) { infra = buildSharedInfra(...) + enableRotate + 输入绑定 +
  //   统一拾取 + startGlobalRenderLoop }（L619–L656）
  // tip 提示条（L658–L666）
  // switchCtx 赋值（L674–L724）
  return { infra, switchCtx };
}
```

**形参**：`ctx`（读 `selfMode/session/adapter/handlers`）+ `shell`（读 `viewContainer/menuHandle/keys/lastMouse/mouseDown/root/body`）。
**返回**：`InstalledPreviewInfra`。
**副作用**：`session.escH` 注册；`infra` 赋值（`ctx.getInfra()` 从此非空）；`handlers` 回填；`session.onUnifiedPick`；rAF loop 启动（首帧）；`session.tipTimeoutId`；`switchCtx` 赋值（`ctx.getSwitchCtx()` 从此可读）。

> ⚠️ `infra` 是 `let`（L397），`buildInfra` 内赋值后需同步回 `ctx` 的 `getInfra()` 闭包。方案：`ctx.getInfra = () => infra` 的闭包捕获一个调度层声明的 `infra` 槽位变量，`buildInfra` 直接改写该槽位（经 `ctx.getInfra` 已是 getter，只读没问题——但 `buildInfra` 需要**写** infra）。落地时把 `infra` 声明为调度层 `let infra: SharedInfra | null`，`buildInfra` 返回 `installed.infra`，调度层 `infra = installed.infra` 后 `ctx.getInfra()` 读到的即新值（因为 `ctx.getInfra = () => infra` 闭包捕获的是同一外层 `let` 变量名）。

### 5.3 `runBuild(ctx, shell, installed): MountBuildResult | null` —— 构建管线

> 覆盖 L728–L821（try 内守卫 + build + 同步 + setPerFrame + 注册表登记）。**不含** try/catch 骨架（骨架留调度层）。

```ts
function runBuild(
  ctx: MountCtx,
  shell: AssembledShell,
  installed: InstalledPreviewInfra,
): MountBuildResult | null {
  // 代际守卫（L729–L730）→ 命中 return null（此处「return」语义与 abort 分支区分）
  // sceneBaseline（L732–L733）
  // buildCtx 构造 + 可选字段（L734–L753）
  // const content = await adapter.build(buildCtx, path)（L754）
  // abort 分支（L755–L765）：补登记 + runFullCleanup → return null
  // 相机/light/shadow/env 同步（L771–L792）
  // setPerFrame（L793）
  // allContent push + register + setAdapterItems（L796–L821）
  return { content };
}
```

**形参**：`ctx`（读 `session/adapter/path/opts/myGen`）+ `shell`（读 `viewContainer/loadingEl/root/menuHandle/camBridge`）+ `installed`（读 `infra/switchCtx`）。
**返回**：`MountBuildResult | null`——`null` 表示 abort（已 `runFullCleanup`，调度层 return），非 null 表示可 commit。
**副作用**：`session.content/sceneBaseline/allContent/perFrame`；`sceneRegistry.register`；`menuHandle.setAdapterItems`；`session.content.update` 注册进 rAF。

> ⚠️ 代际守卫（L729–L730）原 `return` 是「挂载作废、静默退出」——不是 abort（abort 是 L755）。拆成 stage 后两处都 `return null`，语义一致但调度层无法区分「静默作废」vs「abort 已清理」。二者对外都是「本会话不注册、不 commit」，调度层统一 `if (!build) return;` 即可，无需区分（见 §7 风险）。

### 5.4 `commitSession(ctx, installed, build): void` —— 收尾 + 事件绑定 + 句柄入列

> 覆盖 L830–L850。

```ts
function commitSession(
  ctx: MountCtx,
  installed: InstalledPreviewInfra,
  build: MountBuildResult,
): void {
  // escH 替换（先存旧引用再换）（L830–L835）
  // session.cleanupFn = () => runFullCleanup(ctx)（L836）
  // sessionHandle 构造（cleanup/resetCamera/setRotationMode/setSpeed/showModelGroup/
  //   onBoneSelect/switchTo）（L837–L849）—— resetCamera 等读 build.content
  // _handles.push({ handle: sessionHandle, gen: ctx.myGen })（L850）
}
```

**形参**：`ctx`（读 `session/handles/myGen`）+ `installed`（读 `switchCtx`）+ `build`（读 `content`）。
**返回**：`void`。
**副作用**：`session.escH` 替换；`session.cleanupFn`；`_handles` push（`hasActivePreview` 据此）。

### 5.5 `recoverMountFailure(ctx, loadingEl, e): void` —— 失败清理叶函数

> 覆盖 L851–L876（catch 体）。

```ts
function recoverMountFailure(ctx: MountCtx, loadingEl: HTMLElement, e: unknown): void {
  // document.removeEventListener("keydown", session.escH)（L859）
  // runFailedMountCleanup(ctx)（L860）
  // stale scene children 移除（L861–L865）
  // allContent safeDispose + 清空（L866–L867）
  // gen 守卫：aborted 或 myGen !== _gen 则 return（L873）
  // logError + showLoadFailure(loadingEl, e)（L874–L875）
}
```

**形参**：`ctx` + `loadingEl`（`shell.loadingEl` 的局部值）+ `e`。
**副作用**：场景半成品移除、content dispose、输入解绑、停 rAF、拆菜单、错误提示。

### 5.6 `mount3D` 调度层（<50 行目标）

```ts
export async function mount3D(
  adapter: PreviewAdapter,
  path: string,
  opts: Mount3DOptions = {},
): Promise<void> {
  rememberTrigger();
  installUiComponentsStyles();
  ensureMpcStyles();

  // 头部不变量（无法下放 stage 的最小集合）
  const myGen = ++_gen;
  const selfMode = adapter.mode === "self";
  const sessionId = `s${++_mountSessionSeq}`;
  let infra: SharedInfra | null = null;
  const ctx: MountCtx = { adapter, opts, myGen, selfMode, sessionId, /* session 由 assembleShell 填 */ getInfra: () => infra, getGen: () => _gen, handles: _handles, ... };

  const shell = assembleShell(ctx);
  const installed = buildInfra(ctx, shell);
  infra = installed.infra;
  try {
    const build = runBuild(ctx, shell, installed);
    if (!build) return; // abort / 代际作废
    commitSession(ctx, installed, build);
  } catch (e) {
    recoverMountFailure(ctx, shell.loadingEl, e);
  }
}
```

> **关于 `<50 行` 的诚实话**：若把「ctx 骨架」（L363–L440 的 session/handlers/focusTrap/keys 声明 + ctx 对象构造）**留在调度层**，调度层约 55–65 行，略超目标。要严格 <50，需把「会话初始态构造」整体收进 `assembleShell`（任务描述本就说 assembleShell 负责「基础上下文 ctx 骨架」）——即 `ctx` 对象的 `session/handlers/focusTrap` 字段也由 `assembleShell` 填。**推荐后者**：调度层只留「不可下放的最小头部」+ 4 个 stage 调用 + try/catch 骨架，稳定 <50 行。具体裁剪点见 §7 实施步骤 0。

---

## 6. 测试影响评估

### 6.1 直接消费者清单（拆分是否断链）

`mount-preview-core.ts` 的导出符号被 30+ 文件 import（见 grep 结果），但**全部只 import 类型 + 公共 API**：

- **类型**（`type-only import`，零运行时依赖）：`PreviewBuildCtx / PreviewScene / PreviewAdapter / Mount3DOptions / PreviewHandle / BaseScene / UpdateableScene / ScreenshotScene / CameraControlScene / GroupedScene / SemanticScene / PoseScene` → 各 `*-adapter.ts`、`menu/core.ts`、`scene-registry.ts`、`unload-model.ts`、`switch-preview.ts`、`mount-session.ts`、`shared-infra.ts` 等。
- **公共 API**：`mount3D / cleanupPreview / invalidatePreview / switchPreview / hasActivePreview / _resetSingletons` → `views/app-preview/*.ts`、`preview-library.ts`。
- **无任何文件 import `mount3D` 的内部 helper**（它们根本不存在——当前全是内联局部变量/闭包）。

**结论**：4 个 stage 函数 + 3 个类型 + `recoverMountFailure` 全部为**模块级私有（不 `export`）**，或最多 `export` 供独立单测；公共 API 签名不变 → **所有外部消费者零改动**。

### 6.2 测试断言面（`mount-preview-core.test.ts`，实测 903 行，非 2000+）

测试只通过公共 API `mount3D` 的**副作用**断言，不断言内部单函数结构。全部 44 个 `it` 的断言依据：

| 断言类别 | 依据的副作用 | 拆 stage 是否影响 |
|---|---|---|
| build 收到完整 ctx + 注册表 + 菜单注入（L216–249） | `adapter.build` 被调、`buildCtx.*` 字段、`sceneRegistry.count/getActiveId`、`menuHandle.setAdapterItems` | ❌ 不影响（顺序契约保持） |
| ESC → fullCleanup（L267–285） | `content.dispose`、`menuHandle.dispose`、`sceneRegistry.count=0`、`adapter.onClose`、`hasActivePreview` | ❌ 不影响 |
| build 失败（L287–300） | `console.error`、`hasActivePreview=false`、`sceneRegistry.count=0`、`onClose` 不调 | ❌ 不影响 |
| abort/invalidate（L302–348） | `content.dispose`、`onClose`、`hasActivePreview` | ❌ 不影响 |
| 连续 mount 代际（L350–366） | `hasActivePreview` | ❌ 不影响 |
| 菜单回调接线（L368–416） | `switchExternal/getModelsByType/toast/closeAllOverlays/camBridge.reset/switchTo` + `caps.applyMeshCasts/syncMeshIntensity` | ❌ 不影响 |
| 外壳单例复用（L420–444） | `viewContainerCount()` | ❌ 不影响 |
| rAF 管线（L523–575） | `cap.update`、`content.update`、`renderer.render`、`inputOpts.camera.position`、`camBridge.setOrbit/setSpeed/reset` | ❌ 不影响 |
| unloadModel（L577–635） | `unloadContent.dispose`、`sceneRegistry.get`、`menuHandle.setAdapterItems/refreshDock` | ❌ 不影响 |
| 统一拾取（L637–706） | `sceneRegistry.getActiveId`、`onPickA`、`onBoneSelect` | ❌ 不影响 |
| cooperate（L720–729） | `contentA/B.dispose` | ❌ 不影响 |
| finishSession 幂等（L734–774） | `onClose` 调用次数 | ❌ 不影响 |
| switchExternal/switchTo 路由（L778–818） | `adapter.build` 次数、`sceneRegistry.count`、`switchExternal` 透传 | ❌ 不影响 |
| switchTo 并发抑制 inFlight（L821–867） | `buildMock` 调用次数 | ❌ 不影响 |
| canvas 重挂载回归（L873–903） | `domEl.isConnected`、`parentNode.className` | ❌ 不影响 |

**总判定：拆分后 `mount-preview-core.test.ts` 零改动**，前提是守住以下「副作用顺序契约」（搬家不可打乱）：

1. `sceneRegistry.setMenuSink`（assembleShell 内）早于 `buildSharedInfra`（buildInfra 内，因 `refreshDock` 依赖 cap lookup）。
2. `escH` 初始注册（buildInfra 内）早于 `adapter.build`（runBuild 内）——「build 完成前 ESC → closeOverlay 早期路径」测试依赖此。
3. `sceneRegistry.register` 早于 `menuHandle.setAdapterItems`（runBuild 内 L807–L820）。
4. abort 分支先 `allContent.push(content)` 再 `runFullCleanup`（runBuild 内 L760–L763）——「abort 后 content.dispose 恰一次」依赖此。
5. catch 先 `removeEventListener("keydown", escH)` 再 `runFailedMountCleanup`（recoverMountFailure 内 L859–L860）。

### 6.3 需微调的断言

**零处**。唯一「可能」的微调来自 §8 的 input 状态脱节点（若采用选择 2 修脱节，需补 1 条「setOrbit(false) 重置拖拽态」测试；采用选择 1 则完全不动测试）。

---

## 7. 分步实施顺序（4 步，每步独立跑绿）

> 连续改同一文件**自下而上**（AGENTS.md），避免行号漂移：先拆行号大的段（catch / commitSession），再往上拆。

### 步骤 0（前置）：拍板 ctx 骨架归属 + 建显式类型

- 定：`ctx` 对象的 `session/handlers/focusTrap/keys` 字段由 `assembleShell` 填（`mount3D` 严格 <50 行），还是留调度层（~60 行）。**推荐前者**。
- 新增 3 个 interface（§4），`export` 与否按「是否要独立单测」定（本步**不动 mount3D 函数体**，只加类型定义 + 注释）。跑 `typecheck` 应绿（未用类型无副作用）。

### 步骤 1：拆 `recoverMountFailure`（catch 体，行号最大）

- 把 L851–L876 搬成 `function recoverMountFailure(ctx, loadingEl, e)`，catch 体改单行调用。
- 跑：`npx vitest --run mount-preview-core.test.ts`（全绿）+ `typecheck`。
- 验证点：build 失败、abort、finishSession 幂等用例全绿。

### 步骤 2：拆 `commitSession`（L830–L850，行号次大）

- 搬 L830–L850，`runBuild` 尚未拆，故 `commitSession` 形参先取「`session.content` + `ctx` + `switchCtx`」的最小集（`MountBuildResult` 此时尚未引入）。跑测试全绿。
- 验证点：`hasActivePreview` 为 true、`adapter.onClose` 幂等、switchTo 会话内切换。

### 步骤 3：拆 `runBuild`（L728–L821）

- 搬 L728–L821，引入 `MountBuildResult`；abort/代际守卫 `return null`。调度层 try 块改为：
  ```ts
  try {
    const build = runBuild(ctx, shell, installed);
    if (!build) return;
    commitSession(ctx, installed, build);
  } catch (e) { recoverMountFailure(ctx, shell.loadingEl, e); }
  ```
- 跑测试全绿 + `typecheck`。
- 验证点：主路径、abort、invalidate、cooperate、注册表登记、菜单注入用例全绿。

### 步骤 4：拆 `assembleShell` + `buildInfra`（L363–L724）

- 先拆 `buildInfra`（L607–L666 + L674–L724，行号大），再拆 `assembleShell`（L363–L605）。
- 引入 `AssembledShell` + `InstalledPreviewInfra`；调度层收敛为「头部不变量 + 4 个 stage 调用 + try/catch」。
- 跑全量 vitest + `typecheck` + `vite build` + `check-biome`。
- 验证点：外壳单例复用、self 模式降级、canvas 重挂载、rAF 管线用例全绿。

---

## 8. 风险点与回滚策略

### 8.1 风险清单

| # | 风险 | 触发场景 | 缓解 |
|---|---|---|---|
| R1 | **行号漂移** | 步骤间改同一文件，后续引用行号失效 | 自下而上拆（§7 顺序）；每步 `git commit` 一快照；引用用「职责描述」而非裸行号 |
| R2 | **闭包捕获过期** | `ctx.getInfra = () => infra` 闭包捕获 `let infra`，拆 stage 后 `buildInfra` 改的是局部 `installed.infra`，调度层若不同步 `infra = installed.infra`，`getInfra()` 恒 null | `infra` 声明留在调度层，`buildInfra` 返回后调度层 `infra = installed.infra`（§5.2） |
| R3 | **try/catch 全包 vs 分 stage 包** | 若把 try/catch 下沉进 `runBuild`，则 `commitSession` 的 `_handles.push`（L850）在 try 外，失败清理语义错位 | 保守方案：try/catch 骨架留调度层，catch 体抽 `recoverMountFailure`（§5.6） |
| R4 | **input 状态脱节**（现状既有） | `mouseDown` 是 `let` 布尔，`camBridge.setOrbit` 写它（L515）但 `inputOpts.mouseDown = { v: mouseDown }`（L629）是快照，二者脱节 | 选择 1（纯搬家）：`mouseDown` 保持 let + `AssembledShell.mouseDown` 暴露快照；选择 2（可选后续）：改 `{ v: boolean }` 引用对象修脱节（需补测试） |
| R5 | **ctx 骨架归属导致调度层超 50 行** | 若 session/handlers/focusTrap 声明留调度层 | 采用 §7 步骤 0 推荐：ctx 骨架整体收进 `assembleShell` |
| R6 | **`_resetSingletons` 覆盖不全** | stage 引入新模块级状态未纳入重置 | 本方案不新增任何模块级状态（`infra` 是函数局部，`session` 在 ctx 内），`_resetSingletons` 零改动；若后续加模块级状态须同步 |
| R7 | **副作用顺序契约打乱** | §6.2 的 5 条顺序任一条错位 | 搬家严格按行号区间，不重排；每步跑测试 + 盯 §6.2 顺序契约 |

### 8.2 回滚策略

- **单步回滚**：每步 `git commit` 前用 `git diff HEAD` 确认只含 `mount-preview-core.ts` 一处改动；失败即 `git checkout -- frontend/src/preview-3d/adapters/mount-preview-core.ts` 精确恢复（AGENTS.md 只读/恢复命令）。
- **整体回滚**：`git reset --soft HEAD~1` 撤销最近一次提交（改动留工作区，可继续改或再 `checkout`）。
- **验证卡点**：任何一步 `vitest` 非绿即停，不进入下一步（损害控制：1 轮修复未过则报告）。

---

## 9. 验证命令清单

> 全部在 `frontend/` 下执行（typecheck / vite build 同 cwd=frontend，勿在根目录跑 tsc）。

```bash
# 单文件（核心，拆分主验证）
cd frontend && npx vitest --run src/preview-3d/adapters/mount-preview-core.test.ts

# 相邻契约回归（switch / infra / 各 adapter 的 mount 契约）
cd frontend && npx vitest --run src/preview-3d/adapters/switch-preview.test.ts
cd frontend && npx vitest --run src/preview-3d/adapters/shared-infra.test.ts

# 类型 + 构建 + biome（ADR-014 门槛）
cd frontend && npm run typecheck
cd frontend && npx vite build
node scripts/check-biome.ts          # 仓库根（biome 增量闸门，勿在 frontend/ 外裸跑 npx biome）

# 全量回归（收尾）
cd frontend && npx vitest --run
```

---

## 10. 预估改动行数

| 项 | 行数（估） |
|---|---|
| mount3D 函数体现状 | 527（L351–L877） |
| 拆后 mount3D 调度层 | ~40–50（视 ctx 骨架归属） |
| 4 stage 函数体 | ~527 净搬移（略增函数签名 + 类型标注，约 +20） |
| recoverMountFailure | ~30（catch 体搬移） |
| 3 个段间 interface | ~40（新增） |
| **净增** | **~90–130 行**（纯搬移 + 样板，零逻辑新增） |

**核心收益**：`mount3D` 从 527 行上帝函数降为 <50 行调度器；4 个 stage 可独立阅读、可独立 mock 喂最小依赖单测（回应锐评「测试只能 mock 全量喂」）；段间契约显式化为 3 个类型，后续改任一 stage 不再牵一发动全身。
