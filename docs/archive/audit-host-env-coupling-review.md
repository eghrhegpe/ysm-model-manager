# 3D 预览·宿主环境耦合锐评（2026-10-08）

> **⚠️ 活指针（时点快照，非现行状态，2026-10-09 归档）**：宿主环境耦合一次性锐评（10-08）；§三/§七结论已登记 `docs/knowledge/preview-core.md` / `model3d.md` 与代码注释，现状以源码为准。

> **审计对象**：`frontend/src/preview-3d/infra/`（渲染宿主 `render-host.ts`、Worker 桥 `worker-bridge.ts`、外壳/注册表/释放原语）
> ＋ `adapters/`（`shared-infra.ts` / `mount-session.ts` / `mount-preview-core.ts` / `switch-preview.ts`）
> ＋ `decoder/mmd-ktx2-encoder.ts` 的 Worker 池 —— 与**宿主运行环境**（canvas / WebGL context / DOM 测量 / rAF / Worker / WASM / 挂载卸载）的耦合面。
> **方法**：3 子代理分工（② 提交考古 → ③ 文档对账 + 测试盲区 → ① 现状盘点；① 号耗尽上下文，其职责由主模型亲自取证覆盖），
> 主模型逐条复核并**修正**了子代理的一处 P0 定级。
> **基线**：`HEAD = 9e742a6da`（当日 19:53，`git log 9e742a6da..HEAD` 为空，无并行会话干扰）。
> **与上一轮的关系**：`docs/audit-env-coupling-review.md`（同日 19:53）审的是 `state/env-state` × `caps/` 层；
> **两报告互不重叠**。本报告只记宿主环境层存量问题与本轮新发现。
> **姊妹审计**：`audit-postprocessing-critique.md`（后处理域）/ `audit-water-critique.md`（水面域）。

## 处置状态（2026-10-08 收敛核对）

| 条目 | 状态 | 说明 / 现源码锚点 |
|---|---|---|
| **P1-0** KTX2 编码 worker 池生产侧永不终止 | ✅ 已坐实，**待拍板** | `mmd-ktx2-encoder.ts:145-185` 建池；桥提供 `dispose()`（`worker-bridge.ts:179-181`）但**生产零调用**；`resetEncoderState()`（:89，注释自陈「测试用」）只 `clearPending()` 不 terminate；唯一清缓存路径是 worker 崩溃（`onPoolTerminated` :168-171）。测试自认（`mmd-ktx2-encoder.test.ts:707-710`）「resetEncoderState 不拆池」并**手动 `w.onerror?.()` 触发崩溃**来清。**[2026-10-09 复评]已实施（8f5ddbee3）**：`disposeKtx2WorkerPool`（mmd-ktx2-encoder.ts:122）接线 build-result 拆除链（mmd-build-result.ts:204），回归锁 = mmd-ktx2-encoder.test.ts:811 起「锐评 P1-0」6 例（含「reset 不拆池」判别）；拍板线 §七 #1 同步闭合 |
| **P1-1** 终局拆除钩子挂在 `beforeunload`，**Wails v3 下确认不触发** | ✅ **已坐实（2026-10-08 21:2x 上游源码取证）** | `shared-infra.ts:200 beforeunload → teardown()`（:173-194，唯一释放 renderer + `forceContextLoss` 的路径）。**实测结论见§三**——Wails v3.0.0-beta.26 全仓（含内部 webview2 层）**零处 `beforeunload` 引用**；`WM_CLOSE` 链路仅 `ShuttingDown()`（只置 Go 标志位）→ `DefWindowProc` 销毁 HWND，**不向前端派发任何 JS 事件** ⇒ 该钩子为**死代码**。Go 侧 `app.go:331 ServiceShutdown()` 前端零引用。**影响面重估见§三结论段** |
| P1-2 能力分支绕过 DI 直读 DOM | 📝 记录，非待修 | `caps/environment-capability.ts:79,351,388 document.createElement` + `:101 window.addEventListener('focus')`、`caps/ground-capability.ts:550`、`caps/env-pixels.ts:123` —— 领域层直取宿主对象，**零机器闸**（`check-layering` R0 只管 `core/**`→`utils/dom` import 方向，不解析 DOM 全局标识符）。现状无可见缺陷；拍板口径见 §四 G3。**[2026-10-09 复评]** 行坐标已腐（:351/:388 今非 DOM 站点、:550→:560），且原清单漏计两处——现势生产直读 7 处 + 注释 1 处（sky-capability.ts:614 document.hidden 提及）：environment-capability.ts（pickHdrFile input、getPresetThumbnail 缩略图 canvas——漏计 +1，window focus 监听 once:true+cleanup 双保险无泄漏）、ground-capability.ts（pickFile input）、env-ibl.ts / env-pixels.ts（临时离屏 canvas）、postprocessing-capability.ts（window.devicePixelRatio 探测读）；锚点宜改「文件+符号」形态勿锚行号（A-162 教训适用）；G3 豁免判定不受影响（漏计两处同属离屏缓冲/文件选取正当类） |
| P2-1 `stopIfIdle` 判据面窄于不变量面 | ⚠️ 已验伪为 P0，**降级 P3** | `render-host.ts:204-209` 判据只看 `_perFrames.length`、不看 `_activeInputSession`；`setActiveInputSession`（`mount-preview-core.ts:799`）与 `setPerFrame`（:691）是两条独立注册路径。**但当前生产路径不可达**：六格式适配器全部提供 `content.update`；`setPerFrame` 前只有 `registerContentForDisposal`（:684→:740-743，纯 `push`，无可抛错）；`teardown` 三档全调 `stopIfIdle`。属**结构脆弱 + 零测试覆盖**，非现症 |
| P2-2 rAF 生命周期零契约测试 | 📝 拟议 G1，**待落** | `stopIfIdle` / `animate` / `start` 全仓零测试引用（`grep stopIfIdle **/*.test.ts` 无命中；`render-loop.test.ts` 只测会话表）。`animate` 自续期在前（:249）早于 infra 早退（:255）——现由「cleanup 主动调停」兜住，非失控，但无锁 |
| P2-3 WebGL 资源跨层释放无闸 | 📝 记录，非待修 | 原语层有闸（`cleanup-helper.test.ts` 11 例 / `safe-dispose.test.ts` 8 例 / `screenshot-render.test.ts:423`）；但 `shared-infra.ts:185-190` 的真实 GL 释放被 `shared-infra.test.ts:5-6` **自认不可测**（"jsdom 不可达，桌面端手工验收兜底"）；`safe-dispose.ts:28` 贴图槽 opt-in 默认 false，新增 cap 忘传 `disposeMaterial` 无闸 |
| P2-4 window/document 监听器解绑无断言 | 📝 记录，非待修 | 5 个 pointer/resize 监听器绑在 `window`/`domElement`（`input-and-animation.ts:186-191`），解绑真身在 `mount-session.ts:324-335`；`input-and-animation.test.ts` 只测 `cancelPendingResize`，**无一条断言 window/document 无存活监听器**（escH 那条有闸）。漏一行 remove → 跨会话累积，旧会话继续吃事件改已拆 camera |
| P2-5 DOM 全局读取边界闸（G3）落地前置 | ⚠️ 口径未定 | 现状 6 处若直接登记入基线 = **把病合法化**，等于教人绕过。须先定「迁 DI vs 显式豁免 + 理由」再落地 |
| P2-6 close→reopen 会话复位无闸（G4） | 📝 拟议，待落 | 实例字段（`RendererHost._liveInputSessions` / `_perFrameSnapshot`）与模块级 Map（`schema-registry.registry` / `overlay-style-bridge._injectedOnce`）跨会话复位全靠人工；`check-singleton-hygiene` **只测顶层 `let`，不测 `const` 容器 Map/Set**（脚本自述「纳入即噪音」），而 infra 有 6 处 `const` 容器 |
| P3-1 ADR-231 §1 表门牌过期 | 📝 记录，**顺手可修** | ADR-231 L20/L21 仍把 `render-host.ts`/`worker-bridge.ts`/`input-and-animation.ts`/`scene-registry.ts` 列为 `adapters/`；实际已随 ADR-235（L117）搬入 `infra/`，ADR-231 未标注「文件已搬」。同源：`3d-patterns.md:173`（✅ **[2026-10-09 复评]已顺手修** adapters→infra，实存性 glob 亲验）、`ADR-227:7`（ADR 属历史决策快照，按「只标注不改写」纪律不动） |
| P3-2 文档滞后 2 条 | 📝 记录 | `mount3d-584-giant.md:71`「6 个内嵌闭包」（同卡 :63 已自订正）；`ADR-233:18` 行号（`input-and-animation.ts:40/206/217` → 现 :201/:212） |
| 「layering 反向边债务」 | ✅ **0 债务**（推翻 ADR-270-d1 的历史判断） | `docs/.layering-baseline.json` `entries: []`；实跑 `node scripts/check-layering.ts` → 「0 条唯一边 / 0 处命中（基线 0 条）✅」。ADR-270-d1 所述 render-host/postproc-cost-probe → adapters/shared-infra + caps/scene-capability-registry 等立法边，已由 `setSceneCapsProvider`/`setProbeInfraSource` 注入（`shared-infra.ts:237-244`）+ R9 闸彻底清零 |
| 环境能力嗅探分叉 | ✅ **无此病灶** | 全域无 `navigator.gpu`/`hardwareConcurrency`/`maxTextureSize`/`deviceMemory` 嗅探；WebGL 能力只经注入的 `capabilities` 契约（`isWebGL2`/`maxTextures`）消费——**能力分支走 DI 而非全局嗅探**，无分叉行为 |
| SSR/node 守卫 | ✅ 正面 | `render-host.ts:119-123 readDevicePixelRatio()` 有 `typeof window` 守卫 + node 回退 1，挂回归锁 `screenshot-lights.node-load.test.ts`；`input-and-animation.ts:109-121` `bindInputHandlers` 无 renderer 时返回 no-op handler，使 cleanup 侧无条件 `removeEventListener` 恒无害 |

## 一、总判

**宿主环境层的「设计质量」高于「验收质量」——病灶不在架构，在最后一个 5%：机器闸缺位，使已治好的不变量无法防回退。**

- **设计侧几乎无可指摘**：`ADR-227` 四 host 实例化、`beforeunload` 终局拆除、`safeDispose`/`disposeObject3D`（uuid 去重防共享实例双释放）、
  `removePerFrame` **主动把「引用失配」变成节流告警**、两个告警源刻意不共用节流槽位（防互相吞）、
  WebGL 能力走 DI 契约而非全局嗅探——这些多是**别的仓会踩而这个仓主动避开的坑**，且大多留有注释自陈踩坑史。
- **验收侧是本轮真病灶**：上表 11 条中，**P1 两条坐实且其中一条零误报**（KTX2 池）、**P2 六条全部归到同一个根因**——
  宿主层的生命周期立法（reset/teardown/单例边界/监听器成对/资源释放）**与 caps 层的 P2-2/P2-3 同族：立法没有机器闸 = 口头法**。
  `stopIfIdle`/`animate`/`start` 零测试、真实 GL 释放自认不可测、监听器解绑无断言——**没有一条会让 CI 转红**。
- **②考古的信号最值得警惕**：DPR/像素比在 infra 层**三次以不同形态复发**（容器守卫 → 复用后脱钩 → 单例装载期崩），
  最近一次距今 1 天，而载体 `render-host.ts:348 export const rendererHost = new RendererHost()`（模块级单例）**至今未拆**——
  10-07 只给它加了 window 守卫。`shared-infra.ts` 注释自陈「未来 PreviewSession 组合时只需持有 host 引用」，
  该收敛至今**未兑现**（ADR-227 的 P1 战役只做了字段化，未做实例化）。
- **P1-1 的实证改变了全局判断的一角**：终局拆除的 `beforeunload` 钩子经上游源码坐实为**桌面端死代码**（§三）——
  这不改变「验收质量弱于设计质量」的总判，但把一条 P1 降为 P2，
  并**印证了本轮的核心方法论**：这类耦合只有读上游源码才能定性，静态扫本仓永远只能得到「未验证的假设」。

## 二、本轮 P1-0：KTX2 Worker 池「无回收点」（唯一零误报的坐实缺陷）

### 2.0 机制澄清（主模型亲读源码，修正本节初版判词）

**三段式，worker 只服务中间那段**：

```
PNG 纹理 → ①查 Go 缓存目录（GetCachedTexture）→ 命中即用，零成本   ← 不碰 worker
          → ②编码：worker 池跑 WASM basis_encoder                  ← 唯一用 worker 的段
          → ③落盘 saveCachedTexture → Go 缓存目录（下次命中）        ← 不碰 worker
```

- worker 存在的**唯一理由**：避免 WASM 同步编码阻塞 UI（`mmd-ktx2-encoder.ts:188` 注释原话）。
- **规模是3**：`KTX2_WORKER_COUNT = MAX_CONCURRENT = 3`（`:131`/`:24`）——**不是 N，是 3**。
  真实占用大头不是线程，而是每个 worker 内的 WASM `BasisEncoder` 实例（线程栈 + WASM heap）。
- **编码是「每个纹理一生一次」的事件**：`encodeAndCacheTexture` 落盘后 `completedHashes.add(hash)`（`:259`），
  `scheduleBackgroundEncoding` 幂等跳过（`:300`）⇒ **同一纹理永不再编**。
  编码通常几百毫秒完成，worker 之后**约 99.9% 时间空转**。
- **缓存读取路径不经 worker**：`decoder/` 全目录 `new Worker` **仅 1 处**（`:151`，即编码池）；
  KTX2 加载走 `mmd-ktx2-loader` / `mmd-ktx2-cache-loader` 直接读缓存。
- **⚠️ 关键佐证（坐实「漏网」而非「取舍」）**：同文件已存在**为池量身定做且已接线**的取消入口——
  `cancelPendingEncodings()`（`:77`）在 `mmd-build-result.ts:196` 被调用（会话拆解时取消未开始的编码）。
  **同一处代码里，调度侧接了会话生命周期，池本身的生死没人管** ⇒ 遗漏，不是「有意常驻」
  （若为有意取舍，仓内应有注释或 ADR 论证过，实测零论证）。

- **症状**：MMD 纹理 KTX2 编码的 worker 池活到页面/进程结束，会话关闭、预览卸载、模型切换均不回收。
- **取证链**：
  1. `mmd-ktx2-encoder.ts:145-185 getKtx2WorkerPool()` 建 `KTX2_WORKER_COUNT` 个 module worker（:151），
     经 `createWorkerBridge`（:153，`onWorkerError: "terminatePool"`）接线，缓存于模块级 `ktx2Workers`（:136）/ `ktx2Bridge`（:142）。
  2. 桥**提供**了终止能力：`worker-bridge.ts:179-181 dispose()` → `terminatePool()`（:127-131 逐个 `w.terminate()`）。
  3. **生产侧零调用**：`grep 'resetEncoderState|terminatePool|\.dispose\(\)' frontend/src` 后确认——
     唯一触达是 `resetEncoderState()`（:89-97，**注释自陈「测试用」**）的 `ktx2Bridge?.clearPending()`，
     而 `clearPending` 只清在途请求、**不 terminate**（`worker-bridge.ts:40` 注释亦自陈「测试钩子用」）。
  4. 模块级缓存的**唯一清空路径是 worker 崩溃**：`onPoolTerminated`（:168-171）由 `handleWorkerError` 触发 ⇒「不崩就一直占着」。
  5. **测试自己承认了**：`mmd-ktx2-encoder.test.ts:707-710` 注释写明「`resetEncoderState` 不拆池」，
     并**靠手动 `for (const w of createdWorkers) w.onerror?.()` 触发崩溃**让每用例从「无池」开始。
- **影响量化（修正版）**：只有 **3 个** worker，非报告初版的「N 个」。
  「切 MMD 模型 N 次」**不**新增池（模块级缓存复用）⇒ 真实成本 = 「本会话看过至少 1 个 MMD 模型」后，
  3 个 worker + 3 份 WASM BasisEncoder 实例常驻到进程结束。
  ⚠️ 而它们的释放**依赖 P1-1 那条已坐实的死代码**（`beforeunload` 桌面端不触发）——
  **不过**：进程退出时 OS 回收全部 WebView2 子进程内存，故**无跨进程泄漏**，
  实际影响限于「进程存活期间的常驻内存」。这使 P1-0 的紧迫度**低于初版判断**，但**并非无害**（见下）。
- **与 P1-1 的区别**（决定定级依据）：P1-1 是「触发可靠性未知、需实机取证」；本条是「**根本没有触发点**」——纯静态可判。
- **✅ 处置建议（用户质疑后重判：漏网，建议方案 B）**：

  ```ts
  // mmd-ktx2-encoder.ts 新增，与 cancelPendingEncodings 同族对称
  export function disposeKtx2WorkerPool(): void {
    ktx2Bridge?.dispose();   // → terminatePool()：逐个 w.terminate()（worker-bridge.ts:127-131）
    ktx2Bridge = null;
    ktx2Workers = null;      // 与 onPoolTerminated（:168-171）同款清缓存，语义统一
  }
  ```

  挂点三选一（**推荐 B**，理由见下）：

  | 方案 | 收益 | 代价 |
  |---|---|---|
  | A. 只挂 `teardownSharedInfra()` | 消除应用终局残留 | ❌ **已失效**：该入口依赖 `beforeunload`，桌面端确认不触发（§三）⇒ **挂上去等于没挂** |
  | **B. 挂 `cleanupPreview()`** | 真能触发（会话级确定路径，源码 `mount-preview-core.ts:256`） | 每次开关预览拆池；**但 `getKtx2WorkerPool` 的 `if (ktx2Workers) return ktx2Workers`（:146）已天然支持惰性重建**，下次自动重建 |
  | C. 空闲超时自动拆 | 兼顾两者 | 引入定时器与新状态，最复杂 |

  **推荐 B 的成本核验**：重建代价 = 3 个 worker + WASM `BasisEncoder` 初始化（一次动态 import + init），
  发生在「用户再次打开 MMD 模型」时；而该场景**本来就要等编码落盘**（首次）或直接命中缓存（之后），
  **几百毫秒的建池成本基本被场景本身淹没**。相较之下 A 是净无效（死代码），C 的复杂度不划算。
  ⚠️ 落地时须注意：`cleanupPreview` 是「全部关闭」语义，挂这里意味着**单会话关闭也会拆池**——
  若后续要「关一个会话保留池」，应挂到 `mount-session.ts` 的 `teardown()` full档而非 `cleanupPreview`，
  **须与多会话（cooperate）语义一并拍板**。

## 三、P1-1：终局拆除钩子在 Wails v3 下**确认是死代码**（上游源码取证，2026-10-08 补）

> 本节由主模型直接读Go module cache 中的上游源码取证，非推测。版本对齐 `go.mod:13` = `v3.0.0-beta.26`。

### 3.1 取证链（四步，每步可复现）

1. **Wails v3 主仓零引用**：`grep 'beforeunload|BeforeUnload'` 递归扫
   `go/pkg/mod/github.com/wailsapp/wails/v3@v3.0.0-beta.26/**` → **0 命中**。
   即 Wails 框架自身从不在关窗时向前端派发 `beforeunload`，其 webview2 层（`internal/webview2/pkg/edge/`）亦无。
2. **关窗链路逐行确认**（`pkg/application/webview_window_windows.go:1715-1735`，`WM_CLOSE` 分支）：

   ```go
   // We were called by `Close()` or pressing the close button on the window
   w.parent.emit(events.Windows.WindowClosing)   // → Go 内部事件总线（仅 Go 侧）
   ...
   w.requestCancellation.close()
   w.chromium.ShuttingDown()// ← 仅 e.shuttingDown = true（edge/chromium.go:146-148）
   return w32.DefWindowProc(w.hwnd, w32.WM_CLOSE, 0, 0)  // 直接销毁 HWND
   ```

   `ShuttingDown()` 实现在 `internal/webview2/pkg/edge/chromium.go:146-148`，**全部内容就是 `e.shuttingDown = true`**——
   一个 Go 侧防重入标志位，**不 Eval JS、不 Navigate、不派发事件**。
   ⇒ 从 Go 到 JS **没有任何一条通路**能让页面收到「要关了」的信号。
3. **`WindowClosing` 是纯 Go 事件**：`application.go:881-899 handleWindowEvent` → `window.HandleWindowEvent(eventID)`，
   消费方全在 Go 侧（`webview_window.go:366` / `:1253`）。它**不经 Wails 事件桥下发到前端**。
4. **唯一可能的前端信号也不存在**：框架无 `beforeunload` 相关实现，前端自然收不到。

### 3.2 结论

**`shared-infra.ts:200` 的 `window.addEventListener("beforeunload", …)` 在 Wails v3 桌面端永不触发 ⇒ `teardown()` 的唯一调用者是测试。**
连带坐实两件事：

- **回归锁是自证式的**（本仓自己立的警戒线，见 `docs/knowledge/water.md:114`「测试自己伪造字段再断言被释放」）：
  `shared-infra.test.ts:45-68` 锁的是「注册了 beforeunload 监听」+「**手动 `window.dispatchEvent(new Event("beforeunload"))` 会触发拆除**」。
  与「宿主会派发 beforeunload」是两个不同命题——测试自己造事件、自己派发、自己断言，**恒绿、零判别力**。
  **判别式**：去掉宿主这一步（真实环境根本不派发），测试依然全绿 ⇒ 假绿坐实。
- **对照（正面，说明本可以做对）**：同款释放纪律在截图离屏链写在 `finally` 里且**有真锁**——
  `screenshot-render.ts:242-247`（`cone?.dispose()` → `renderer.dispose()` → `forceContextLoss?.()`）+ `screenshot-render.test.ts:423-426`。
  **同一条释放纪律，一边有真锁，一边挂在从不触发的事件上并锁住「钩子自己」。**

### 3.3 影响面重估：从「未知」降为「确定无实际危害」——但**不是无害**

必须区分两件事：

- **实际危害 ≈ 0**：窗口关闭 → `WM_CLOSE` → HWND 销毁 → **整个进程随之退出**（Wails 单窗口桌面应用，
  最后一个窗口关闭即应用生命周期终点）⇒ 进程退出由 OS 回收全部 WebView2 子进程内存、GL context、worker 线程。
  **「残留 GL context」在桌面单窗口形态下不存在跨进程泄漏。**
- **但代码本身仍需处置**，三条理由：
  1. **它伪装成有防护**：`teardown()` 是全仓唯一释放 renderer + `forceContextLoss` 的路径，
     其存在会让后来者误以为「进程退出有兜底拆除」，而实际上没人调它。
  2. **web 形态直接反证**：`cd frontend && npm run dev:web` / GitHub Pages（ADR-049）下**页面确实会卸载**，
     `beforeunload` **会真实触发**——即同一段代码在 web 下有效、桌面下失效，
     是**跨形态行为分叉**（正是本轮审计§一主张要防的那类宿主耦合）。
  3. **它是 G5 真值闸的落点**：若将来支持「关窗不退出进程」（托盘常驻 / 多窗），
     这条死代码会**静默失效且零信号**，届时才是真泄漏。
- **定级**：由「P1 待实机取证」调整为 **P2·确认死代码 + 跨形态分叉**。
  **处置建议**（低成本、消除分叉）：
  ① `teardownSharedInfra()` 的 Go 侧入口应由**真信号**驱动——查 Wails 是否提供 `OnShutdown`（Go 侧已证存在，
  `application.go:903 OnShutdown(f func())`），经事件桥下发到前端调用 teardown；或
  ② 明确文档化「桌面端进程退出即回收，`teardown` 仅服务 web 形态与测试」，并把该认知写进知识卡，
  避免下轮再当活代码审计。
  ⚠️ **不建议**为此改桌面端生命周期设计（进程退出回收是 OS 保证的既定行为，为它加钩子属过度工程）。

## 四、②考古：宿主层病历谱系与复发节律（本次审计的核心洞察）

### 4.1 铁证级样本：第一刀制造了第二刀的必要性（相隔 6 分 12 秒）

`SceneInfraHost.reset()` 同一函数、同一天、两次提交（主模型已 `git show` 验 diff）：

| 时刻 | commit | 决策 | 结果 |
|---|---|---|---|
| 09-18 **12:22:52** | `fbb357457` | camera/renderer/controls **全保留不置 null**（理由：旧实现置 null 却不 dispose ⇒ 每次开关泄漏 1 个 WebGL context）；同 commit 补 DPR/size 重新对齐 + rAF `start()` 早退修复 | **制造新暴露面** |
| 09-18 **12:29:04**（+6′12″） | `dcb3f7ddc` | camera/controls **退回置 null**、只留 renderer，**并补 `controls.dispose()`** | 补第一刀的漏 |

第二刀 commit 的注释**自陈因果**：「renderer 的 canvas 现在跨会话存活 → controls 必须 dispose 才能摘掉绑在
`renderer.domElement` 上的监听器（旧实现每次换新 canvas，监听器随旧 canvas 一并被丢弃，故此前漏掉 dispose 也不会累积）」。

> **判词**：这不是「新病灶被发现」，而是**第一刀的复用决策直接制造了第二刀的必要性**——
> 「修了一处、漏了另一处」的最纯样本，且**作者当场就补上了**（6 分钟内）。
> 治理机制有效的一面在此；危险的一面是：**这类修复靠人当场串联，一次没注意到就是永久泄漏，且 CI 全绿。**

### 4.2 同型复发 5 组，间隔已压到「同日」（间隔 6 分 ~ 20 天）

| 组 | 病型 | hash 对 | 间隔 |
|---|---|---|---|
| P0-a | renderer 单例跨 session 泄漏（→ controls 监听器） | `fbb357457` → `dcb3f7ddc` | 6 分 12 秒 |
| P0-b | build 路径半成品子树 GPU 泄漏（成功侧/失败侧两消费点各漏一次，`07d55acb1` 自认「对齐 switch 的 keep 失败分支」） | `c6d4ebb47`(13:51) → `07d55acb1`(14:55) | 64 分钟 |
| P0-c | Worker 桥接线契约丢失（重构丢 `onmessage`/`onerror` 委托 → 恒超时静默回退主线程） | `409b060e3` → `1575cc085` | 20 天 |
| P0-d | resize/DPR/容器脱钩**三次不同形态复发** | `5cb69b463`(09-06) → `fbb357457`(09-18) → `7dda6e22d`(10-07) | 19 天（最近距今 1 天） |
| P0-e | 多会话共享资源「拆过头 vs 拆不够」并存 | `de89a8150`(09-14) / `de2db9698`(09-18) / `01b6a05ce`(ADR-233, 09-13) | — |

> **节律判词**：与上一轮 env 域测得的「3 周 → 4 天 → 同日」**同构**，且宿主层的最短间隔（**6 分钟**）比 env 域更极端。
> **根因不是治理带宽不足**（治理动作极密、修复极快），而是**判据盲区**：立法没有机器闸时，
> 漏点只能靠人当场串联补，而「串联」本身不可复用、不可验收、不可被 CI 记住。
> **P0-d 尤其值得盯**：载体 `render-host.ts:348` 的模块级单例**至今未拆**，复发随时可能第四次。

### 4.3 上一轮报告（`audit-env-coupling-review.md`）复核结论：可信

- 7 个引用 hash **全部真实存在**；抽查 4 个（`44b9bd4d7` / `56300e506` / `daed7ed0d` / `e71cfc013`）描述与 `git show` diff 相符，**无编造、无冲突**。
- 状态与当前源码树一致（`git log 9e742a6da..HEAD` 为空）：P1-0 ✅ 已修（`water-persist.ts:21 RESTORE_SOURCE` 三站点在位）、
  P1-1 ✅ 已声明+双向锁、P2-1 仍单边（`sky-capability.ts:922 releaseTone` 盲还原）、P3-2 死导出仍在（`env-state.ts:131/138`）。
- **唯一遗留未兑现**：两个拟议 meta 闸 `caps/persist-roundtrip-contract.test.ts` 与 `cap-dispose-reset-contract.test.ts` **至今 ❌ 不存在**——
  这正是本轮 §五 论断的交叉验证：**同一条「立法无机器闸」的根因，跨两轮、跨两层（caps ↔ 宿主）重复出现。**

## 五、拟议 meta 闸（③ 设计 + 主模型复核；**G1/G2/G4 已于 2026-10-08 落地**）

| # | 治什么病 | 落点 | 假绿风险（最关键） | 优先级 | 状态 |
|---|---|---|---|---|---|
| **G1** rAF 生命周期 | `stopIfIdle`/`animate`/`start` 零测试；判据面窄于不变量面 | `infra/render-host.raf-contract.test.ts` | ① 用 `vi.useFakeTimers()` 而非 rAF stub ⇒ 只验「调用次数」不验「帧真停」；② 断言 `cancelAnimationFrame` 被调 ≠ 断言回调不再执行（可先 cancel 再 microtask 补一次 rAF 骗过）；③ 只测单实例测不到两会话交错 | **P1**（零新脚本） | ✅ **已落地**（8 例） |
| **G2** Worker 工厂 | 新增 Worker 工厂可绕 `createWorkerBridge`，dispose 漏 terminate 无闸 | `scripts/check-worker-lifecycle.ts` + 计数基线（仿 `check-singleton-hygiene`） | ① **假绿主路径**：加 `void terminate;` 注释骗过文本闸；② 别名绕过（`const W = Worker; new W(...)`）；③ **必须照抄空域 fail-loud（exit 2）**，否则「零命中」会被当「零债」而非「闸未启用」 | P1 | ✅ **已落地**（19 例契约测试） |
| **G4** close→reopen 等价 | 实例字段 + 模块级 `const Map/Set` 跨会话复位无断言 | `infra/render-host.session-restart.test.ts`（复用现有夹具） | ① 自证式假绿（断言「reset 后为空」而 reset 根本没清）；② **只测 full 档漏 early/failed**——early 恰是历史上漏解绑那档；③ 两 mount 复用同一 `session` 对象绕过真实 new 路径 | P2（成本最低） | ✅ **已落地**（5 例） |
| **G3** 宿主全局读取边界 | caps/state 直读 `document`/`window` 隐形（现状 6 处） | `scripts/check-dom-boundary.ts` R11 + 基线 | **⚠️ 前置阻塞**：6 处直接登记 = 把病合法化 = 教人绕过。须先定「迁 DI vs 显式豁免+理由」 | P2（口径未定，**勿先落**） | 📝 待拍板（§七 #3） |
| **G5** renderer/context 真值 | 真实 GL 释放被自认不可测 | `frontend/e2e-web/` swiftshader spec + `renderer.info.memory` 断言 | ① swiftshader ≠ WebView2 真 GL；② **e2e 属重档，CI 走轻档会跳过 ⇒「CI 全绿」是假绿**，需 `--fast` 排除策略显式登记；③ 单次释放 ≠ N 轮不泄漏，应做 3 轮循环 | P3（重档） | 📝 未启动 |

### G1/G2/G4 落地实证（2026-10-08，提交 `764e013e6`）

- **G1 钉死一条易误解的语义**：`animate` 是「**先无条件续期、后判断**」——早退（局部态缺失）
  **不停环**；停环唯一手段是 `stopIfIdle` / `reset`。这正是「判据面窄于不变量面」的具体形态；
  契约把它钉住（将来若有人把续期挪到早退之后，测试会红，提示重新评估停环语义）。
- **G4 实测发现一条新知识**：`reset()` **只清状态字段、不 cancel 在飞帧**——残余帧执行后会再次
  `requestAnimationFrame` 把 `_animId` 复活，导致下次 `start()` 被幂等判定
  （`if (_animId !== 0) return`）**误拦**，循环拉不起来（实测第二轮帧数 0）。
  与 G1 是**同一条语义**的两个观测面。
- **G2 三条防线均实证有效**：① 空域 fail-loud（`SCAN_AREA` 改坏 → exit 2）；
  ② 零站点 fail-loud（本仓 4 处 `new Worker(`，归零只可能解析器失效）；
  ③ 判别力（注入违规探针 → exit 1 且指名文件）。
- **G2 实测现状**：237 文件 / **4 处 `new Worker(`** / **0 处未受管**——2 处在 `worker-bridge.ts`
  工厂（自带 `dispose()`）、2 处裸建（KTX2 编码池本轮补了出口、`mmd-texture-decoder.ts` 本有
  `disposeTextureDecoder`）。**即闸上线时债已清零**，其价值在**防将来新增**（而非清存量）——
  这正是「闸」而非「修复」的定位，勿因「零命中」误判该闸无用。
- **G1/G4 的落点与原设计有偏差**：原拟 `infra/render-loop.raf-contract.test.ts`，
  实测 `render-loop.ts` 是**薄门面**（56 行，全部委托 `RendererHost`），真逻辑在
  `render-host.ts`；故契约落在 `render-host.*.test.ts`，避免测「门面转发」这种零判别力目标。

> **落地上的一条硬要求**（③ 提出、主模型认同）：G2/G3 必须带**空域 fail-loud**。
> 本仓既有先例——若闸在「零命中」时静默通过，团队会把「闸未启用」误读为「零债务」，
> 这是比「没有闸」更危险的状态（它提供虚假安全感）。**G2 已按此落地并实证。**

## 六、方法论台账（并入卡 pitfalls）

1. **立法没有机器闸 = 口头法**（本轮第 N 次实证，且**跨层同构**：caps 层 P2-2/P2-3 → 宿主层 G1/G2/G4）。
   对任一生命周期立法，审计面 = 「约束点 ∪ 触发点 ∪ 回收点」三处，而不只是约束点。
2. **⚠️ 子代理指控必须主模型复核**——本轮③号报「`stopIfIdle` 判据不全 ⇒ rAF 永续」为 P0，
   主模型逐条验证后**证伪其主指控**（三档 teardown 全覆盖停机，生产路径不可达），**降级为 P3 结构性脆弱**。
   若直接采信，会把一个不成立的 P0 写进锐评并误导后续排期。
   **这条与卡内既有「mock 被测判据 = 把病灶藏进测试」互为镜像：那边是「测试藏病灶」，这边是「指控本身含病灶」。**
3. **回归锁须区分「锁机制」与「锁环境假设」**：`shared-infra.test.ts:45-68` 锁住的是「钩子被调用」，
   而风险在「宿主会不会调这个钩子」。前者永远绿，后者才是要命的。**判别式：问「去掉宿主这一步，测试还绿吗」。**
4. **跨层重复出现的根因，比单层深挖更值钱**：env 域（今日 19:53）与宿主域（本轮）各自独立收敛出
   「立法无机器闸」这一同构结论 —— 该结论应升级为**跨层治理原则**，而非两域各自的脚注。
5. **🆕 宿主环境假设必须读上游源码，静态扫本仓只能得到「未验证」**（P1-1 的教训）：
   「Wails 关窗会不会派发 `beforeunload`」——静态扫本仓无论怎么扫都只能得到「查不到调用方」的**假设**；
   真相在 `go/pkg/mod/.../wails/v3@v3.0.0-beta.26/`：**全仓零引用**，`WM_CLOSE` → `ShuttingDown()`（仅置 Go 标志）
   → `DefWindowProc` 销毁 HWND，**Go→JS 零通路**。
   **判别式（可复用）**：凡结论依赖「宿主框架会不会做X」，一律去 `go/pkg/mod` 读那个框架，
   别在自家代码里找证据——**自家没有调用方 ≠ 宿主不会调**。
   ✅ 同族正面先例：上一轮 env 域对 three r186 的取证也是同法（`docs/knowledge/water.md:114`
   「给『已释放』写断言前，先查上游源码到底释放了什么」）。**「读上游取证」应升为宿主域审计的标准动作。**
6. **🆕 写契约测试时，先读实现的真实顺序——别按「直觉语义」写断言**（G1/G4 的教训）：
   我最初两条断言都写反了，且**都是被测试自己纠正的**：
   - G1 假设「早退即停环」→ 实测 `animate` 是**先续期后判断**，早退不停环；
   - G4 假设「reset 即复位」→ 实测 `reset()` **不 cancel 在飞帧**，残余帧会把 `_animId` 复活、
     让下次 `start()` 被幂等判定误拦（第二轮帧数 0）。
   **判别式**：断言红了先问「是我理解错，还是实现有缺陷」——读源码定位，**不要为了变绿而改断言**
   （那是把契约降格成「描述现状」）；反之若实现确有意为之，就把**真实语义**钉进测试并写明
   「将来若改变此序，此例会红」。
7. **🆕 闸上线时「零命中」必须区分两件事**（G2 的实证）：**债已清零**（真信号，闸转防御）
   vs **闸没扫到东西**（假绿，比没闸更危险）。G2 用三重证据区分：`workerSites: 4 > 0`
   （解析器活着）、空域 fail-loud（域改坏 exit 2）、判别力探针（注入违规 exit 1）。
   **只报「0 违规」而不报「扫了什么」的闸，都应存疑。**

## 七、待拍板清单（需人决策，非技术可独断）

| # | 事项 | 选项 | 影响 |
|---|---|---|---|
| 1 | **KTX2 worker 池常驻**（P1-0）——已重判为**漏网**（同文件 `cancelPendingEncodings` 已接线，池生死无人管，零取舍论证） | **推荐 B**：`disposeKtx2WorkerPool()` 挂 `cleanupPreview`（惰性重建已具备） | A 方案已失效（依赖死代码）；B 的代价「几百毫秒建池」被MMD 场景本身淹没。⚠️ 若要多会话保留池，须改挂 `teardown()` full档。✅ **[2026-10-09 复评]已实施（8f5ddbee3）**：方案 B 落地——disposeKtx2WorkerPool（mmd-ktx2-encoder.ts:122）接 mmd-build-result.ts:204 拆除链，回归锁 mmd-ktx2-encoder.test.ts:811 起 6 例；本条闭合 |
| 2 | **P1-1 死代码处置**（已确认桌面端不触发） | ① 文档化「桌面进程退出即回收，`teardown` 仅服务 web 形态与测试」+ 写知识卡；② 经 Wails `OnShutdown`（`application.go:903`，Go 侧已证存在）下发真信号驱动 teardown | ① 成本最低、消除误读；② 彻底但**为进程退出回收做钩子属过度工程**。**建议 ①**；无论选哪个，测试的自证式假绿须一并订正 |
| 3 | G3 宿主全局边界口径（P1-2 六处现状） | ① 迁 DI；② 显式豁免 + 写理由入基线 | 闸落地前**必须**先定，否则等于把病合法化 | ✅ **已评估·维持现状（2026-10-09）**：当前树的 DOM 直读里（[2026-10-09 复评]清点修正：生产直读 7 处 + 注释 1 处；原「3+2+1」口径把注释位计入 6 且漏计 environment-capability.ts 的 pickHdrFile input 与 getPresetThumbnail canvas 两处，行坐标亦有腐——性质分类与豁免结论不变），3 处（env-ibl / env-pixels / ground-capability 的 `createElement("canvas"/"input")`）是**临时离屏缓冲**（正当用法，非隐式全局态），2 处（environment-capability 的 focus/window、postprocessing-capability 的 `devicePixelRatio`）是 **capability 探测读宿主能力**（caps 层本职，happy-dom 下已可测），仅 1 处是注释提及。**落闸会把正当用法打成假债**；正确动作 = 不落 G3 闸，把「capability 探测读宿主全局 = 正当用法」写进知识卡（见 preview-core.md pitfalls）。若未来真出现「非探测的隐式全局依赖」，再窄口径落闸只管那一类 |
| 4 | `render-host.ts:348` 模块级单例是否拆（P0-d 复发载体） | ① 本轮拆（涉 ADR-227 后续战役）；② 挂账观察 | 不拆则 DPR 类第四次复发仍无结构防线 | ✅ **已评估·维持现状（2026-10-09）**：单例是 **WebGL context 数量硬约束的正确映射**（renderer 必须唯一），不是「图省事用全局态」；并发安全已由 `RendererHost` **实例内部字段**（activeInputSession / perFrame Map）保证，单例身份只是组合根便利。无「多 host」真实需求（WebGL 唯一约束），拆了反而要解释「为何只传同一实例」。降级为「已评估·维持现状」，改为知识卡记录理由 |
| 5 | G1/G2/G4 三闸是否本轮落地 | — | G1 零新脚本、G4 复用夹具，**成本最低、收益最直接** | ✅ **已落地**（`764e013e6`）：G1 8 例 / G4 5 例 / G2 闸 + 19 例契约 |
| 7 | **🆕 G5 是否启动**（重档：swiftshader e2e + `renderer.info.memory` 3 轮循环） | ① 启动；② 挂账 | ⚠️ 若启动须**显式登记「CI 轻档会跳过」**，否则「CI 全绿」是假绿（G5 假绿风险 ②） | ✅ **已评估·维持现状（2026-10-09）**：`frontend/e2e-web/` 已有真 WebGL spec（`postprocessing.spec.ts` 用 swiftshader `renderer.dispose()` + `readPixels`），但 pre-push 轻量档默认跳过重档 ⇒ 若把它们当「门禁绿」是假绿。正确动作 = **维持 e2e 为手动/重档、显式不在轻档覆盖内**（现状已如此），**不新增轻量单元探针**（`renderer.info` 在 happy-dom 下不可观测，是死路）。G5 的价值（真 GL 释放）由现有 e2e 在本地/CI 重档提供，无需常驻门禁化 |
| 6 | **🆕 是否把「宿主假设须读上游源码」写成卡级纪律** | ① 写进 `docs/knowledge/pitfalls` 或宿主域知识卡；② 仅留本报告 | ✅ **已落地**：本轮写入 `preview-core.md` pitfalls（「宿主框架会不会做X」类结论必须读上游源码） |
| 7 | **🆕 G5 是否启动**（重档：swiftshader e2e + `renderer.info.memory` 3 轮循环） | ① 启动；② 挂账 | ✅ **已评估·维持现状（2026-10-09）**：见上 #7 行结论 |
| 8 | **🆕 闸的「零命中」处置口径**（G2 上线即零债） | ① 闸保留为防新增；② 认为无债可撤 | 建议 ①——G2 的价值在**防将来新增**，闸≠修复；撤掉等于把刚立的法变回口头法 |