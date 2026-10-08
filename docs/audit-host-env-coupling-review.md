# 3D 预览·宿主环境耦合锐评（2026-10-08）

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
| **P1-0** KTX2 编码 worker 池生产侧永不终止 | ✅ 已坐实，**待拍板** | `mmd-ktx2-encoder.ts:145-185` 建池；桥提供 `dispose()`（`worker-bridge.ts:179-181`）但**生产零调用**；`resetEncoderState()`（:89，注释自陈「测试用」）只 `clearPending()` 不 terminate；唯一清缓存路径是 worker 崩溃（`onPoolTerminated` :168-171）。测试自认（`mmd-ktx2-encoder.test.ts:707-710`）「resetEncoderState 不拆池」并**手动 `w.onerror?.()` 触发崩溃**来清 |
| **P1-1** 终局拆除可达性 = 未验证的宿主假设，且回归锁自证 | ✅ 已坐实 | `shared-infra.ts:200 beforeunload → teardown()`（:173-194，唯一释放 renderer + `forceContextLoss` 的路径）；Go 侧 `app.go:331 ServiceShutdown()` **前端零引用**（`grep ServiceShutdown frontend/src` 无命中）。`shared-infra.test.ts:45-68` 锁的是「**手动 dispatchEvent(beforeunload) 会触发拆除**」——与「桌面壳关窗时宿主会派发 beforeunload」是两个命题，恒绿、零判别力 |
| P1-2 能力分支绕过 DI 直读 DOM | 📝 记录，非待修 | `caps/environment-capability.ts:79,351,388 document.createElement` + `:101 window.addEventListener('focus')`、`caps/ground-capability.ts:550`、`caps/env-pixels.ts:123` —— 领域层直取宿主对象，**零机器闸**（`check-layering` R0 只管 `core/**`→`utils/dom` import 方向，不解析 DOM 全局标识符）。现状无可见缺陷；拍板口径见 §四 G3 |
| P2-1 `stopIfIdle` 判据面窄于不变量面 | ⚠️ 已验伪为 P0，**降级 P3** | `render-host.ts:204-209` 判据只看 `_perFrames.length`、不看 `_activeInputSession`；`setActiveInputSession`（`mount-preview-core.ts:799`）与 `setPerFrame`（:691）是两条独立注册路径。**但当前生产路径不可达**：六格式适配器全部提供 `content.update`；`setPerFrame` 前只有 `registerContentForDisposal`（:684→:740-743，纯 `push`，无可抛错）；`teardown` 三档全调 `stopIfIdle`。属**结构脆弱 + 零测试覆盖**，非现症 |
| P2-2 rAF 生命周期零契约测试 | 📝 拟议 G1，**待落** | `stopIfIdle` / `animate` / `start` 全仓零测试引用（`grep stopIfIdle **/*.test.ts` 无命中；`render-loop.test.ts` 只测会话表）。`animate` 自续期在前（:249）早于 infra 早退（:255）——现由「cleanup 主动调停」兜住，非失控，但无锁 |
| P2-3 WebGL 资源跨层释放无闸 | 📝 记录，非待修 | 原语层有闸（`cleanup-helper.test.ts` 11 例 / `safe-dispose.test.ts` 8 例 / `screenshot-render.test.ts:423`）；但 `shared-infra.ts:185-190` 的真实 GL 释放被 `shared-infra.test.ts:5-6` **自认不可测**（"jsdom 不可达，桌面端手工验收兜底"）；`safe-dispose.ts:28` 贴图槽 opt-in 默认 false，新增 cap 忘传 `disposeMaterial` 无闸 |
| P2-4 window/document 监听器解绑无断言 | 📝 记录，非待修 | 5 个 pointer/resize 监听器绑在 `window`/`domElement`（`input-and-animation.ts:186-191`），解绑真身在 `mount-session.ts:324-335`；`input-and-animation.test.ts` 只测 `cancelPendingResize`，**无一条断言 window/document 无存活监听器**（escH 那条有闸）。漏一行 remove → 跨会话累积，旧会话继续吃事件改已拆 camera |
| P2-5 DOM 全局读取边界闸（G3）落地前置 | ⚠️ 口径未定 | 现状 6 处若直接登记入基线 = **把病合法化**，等于教人绕过。须先定「迁 DI vs 显式豁免 + 理由」再落地 |
| P2-6 close→reopen 会话复位无闸（G4） | 📝 拟议，待落 | 实例字段（`RendererHost._liveInputSessions` / `_perFrameSnapshot`）与模块级 Map（`schema-registry.registry` / `overlay-style-bridge._injectedOnce`）跨会话复位全靠人工；`check-singleton-hygiene` **只测顶层 `let`，不测 `const` 容器 Map/Set**（脚本自述「纳入即噪音」），而 infra 有 6 处 `const` 容器 |
| P3-1 ADR-231 §1 表门牌过期 | 📝 记录，**顺手可修** | ADR-231 L20/L21 仍把 `render-host.ts`/`worker-bridge.ts`/`input-and-animation.ts`/`scene-registry.ts` 列为 `adapters/`；实际已随 ADR-235（L117）搬入 `infra/`，ADR-231 未标注「文件已搬」。同源：`3d-patterns.md:173`、`ADR-227:7` |
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

## 二、本轮 P1-0：KTX2 Worker 池「无回收点」（唯一零误报的坐实缺陷）

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
- **影响量化**：「切 MMD 模型 N 次」**不**新增池（模块级缓存复用，首次建的 N 个常驻）；
  真实成本是「先看一次 MMD 再长期不用」→ `KTX2_WORKER_COUNT` 个 idle worker 常驻 + 其占用的解码内存，
  直到关窗（且关窗释放还依赖 P1-1 那条未验证的 `beforeunload`）。
- **与 S-1 的区别**（决定定级依据）：P1-1 是「触发可靠性**未知**、需实机取证」；本条是「**根本没有触发点**」——纯静态可判。
- **⚠️ 需拍板**：这是**有意的进程级常驻取舍**（编码池小、复用优先、线程创建贵），还是**漏网**？
  两种处置完全不同：
  - 若判定为有意 ⇒ 补文档 + 补一条「池为进程级常驻」的事实锁，**不做代码改动**；
  - 若判定为漏网 ⇒ 加 `disposeKtx2WorkerPool()` 门面，挂 `cleanupPreview`/`teardownSharedInfra` 对称位。
  ⚠️ 注意：直接挂到 `cleanupPreview` 可能与「切模型保留池复用」的现有意图冲突（每次开关预览都拆池=失去复用收益），**拍板时勿默认「对称补齐就是正解」**。

## 三、P1-1：终局拆除的可达性 + 回归锁自证（同族病：口头法）

- **事实**：`shared-infra.ts:200` 是**唯一**释放 renderer + `forceContextLoss?.()` + `domElement.remove()` 的入口（teardown :173-194）。
- **事实**：Go 侧有正规退出钩子 `app.go:331 ServiceShutdown()`（watcher.Stop / appCancel / 停代理 / 关 httpServers），
  但**前端零引用** —— 前后端两侧各有一个「退出信号」，彼此未接线。
- **⚠️ 回归锁是自证式的**（本仓自己立的警戒线，见 `docs/knowledge/water.md:114`「测试自己伪造字段再断言被释放」）：
  `shared-infra.test.ts:45-68` 断言的是「注册了 beforeunload 监听」+「**手动 `window.dispatchEvent(new Event("beforeunload"))` 会触发拆除**」。
  这与「**桌面壳关窗时宿主会派发 beforeunload**」是两个不同命题——测试自己造事件、自己派发、自己断言，**恒绿、零判别力**。
- **对照（正面，说明本可以做对）**：同款释放纪律在截图离屏链写在 `finally` 里且**有真锁**——
  `screenshot-render.ts:242-247`（`cone?.dispose()` → `renderer.dispose()` → `forceContextLoss?.()`）+ `screenshot-render.test.ts:423-426` 断言。
  **同一条释放纪律，一边有真锁，一边只是「挂着一个钩子并锁住钩子自己」。**
- **定级保留**：影响面为「关窗后残留 GL context」。进程退出时 OS 回收该进程显存，故**非跨进程泄漏**；
  真实风险窗口在「同进程内窗口重开 / 多窗 / Windows 低内存回收路径」。**需实机或 e2e 取证才能从「假设」升级为「缺陷」**——
  本报告不越界把它写成已确认缺陷。

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

## 五、拟议 meta 闸（③ 设计 + 主模型复核；**只出设计，未写测试**）

| # | 治什么病 | 落点 | 假绿风险（最关键） | 优先级 |
|---|---|---|---|---|
| **G1** rAF 生命周期 | `stopIfIdle`/`animate`/`start` 零测试；判据面窄于不变量面 | `infra/render-loop.raf-contract.test.ts` | ① 用 `vi.useFakeTimers()` 而非 rAF stub ⇒ 只验「调用次数」不验「帧真停」；② 断言 `cancelAnimationFrame` 被调 ≠ 断言回调不再执行（可先 cancel 再 microtask 补一次 rAF 骗过）；③ 只测单实例测不到两会话交错 | **P1**（零新脚本） |
| **G2** Worker 工厂 | 新增 Worker 工厂可绕 `createWorkerBridge`，dispose 漏 terminate 无闸 | `scripts/check-worker-lifecycle.ts` + 计数基线（仿 `check-singleton-hygiene`） | ① **假绿主路径**：加 `void terminate;` 注释骗过文本闸；② 别名绕过（`const W = Worker; new W(...)`）；③ **必须照抄空域 fail-loud（exit 2）**，否则「零命中」会被当「零债」而非「闸未启用」 | P1 |
| **G4** close→reopen 等价 | 实例字段 + 模块级 `const Map/Set` 跨会话复位无断言 | `adapters/session-restart-equivalence.test.ts`（复用现有夹具） | ① 自证式假绿（断言「reset 后为空」而 reset 根本没清）；② **只测 full 档漏 early/failed**——early 恰是历史上漏解绑那档；③ 两 mount 复用同一 `session` 对象绕过真实 new 路径 | P2（成本最低） |
| **G3** 宿主全局读取边界 | caps/state 直读 `document`/`window` 隐形（现状 6 处） | `scripts/check-dom-boundary.ts` R11 + 基线 | **⚠️ 前置阻塞**：6 处直接登记 = 把病合法化 = 教人绕过。须先定「迁 DI vs 显式豁免+理由」 | P2（口径未定，**勿先落**） |
| **G5** renderer/context 真值 | 真实 GL 释放被自认不可测 | `frontend/e2e-web/` swiftshader spec + `renderer.info.memory` 断言 | ① swiftshader ≠ WebView2 真 GL；② **e2e 属重档，CI 走轻档会跳过 ⇒「CI 全绿」是假绿**，需 `--fast` 排除策略显式登记；③ 单次释放 ≠ N 轮不泄漏，应做 3 轮循环 | P3（重档） |

> **落地上的一条硬要求**（③ 提出、主模型认同）：G2/G3 必须带**空域 fail-loud**。
> 本仓既有先例——若闸在「零命中」时静默通过，团队会把「闸未启用」误读为「零债务」，
> 这是比「没有闸」更危险的状态（它提供虚假安全感）。

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

## 七、待拍板清单（需人决策，非技术可独断）

| # | 事项 | 选项 | 影响 |
|---|---|---|---|
| 1 | **KTX2 worker 池常驻**（P1-0）是取舍还是漏网 | ① 判定有意 → 补文档+事实锁，不改码；② 判定漏网 → 加 `disposeKtx2WorkerPool()` 挂对称位 | ② 若挂 `cleanupPreview` 会**破坏现有「切模型保留池复用」意图**（每次开关预览拆池即失去复用收益）——**勿默认「对称补齐 = 正解」** |
| 2 | `beforeunload` 可达性（P1-1）是否立项实机/e2e 取证 | ① 立即取证定缺陷；② 接受「进程退出由 OS 回收」判为非缺陷，只补文档 | ② 前提是明确「同进程窗口重开」不是产品场景——**须确认产品是否有多窗/重开语义** |
| 3 | G3 宿主全局边界口径（P1-2 六处现状） | ① 迁 DI；② 显式豁免 + 写理由入基线 | 闸落地前**必须**先定，否则等于把病合法化 |
| 4 | `render-host.ts:348` 模块级单例是否拆（P0-d 复发载体） | ① 本轮拆（涉 ADR-227 后续战役）；② 挂账观察 | 不拆则 DPR 类第四次复发仍无结构防线 |
| 5 | G1/G2/G4 三闸是否本轮落地 | — | G1 零新脚本、G4 复用夹具，**成本最低、收益最直接** |