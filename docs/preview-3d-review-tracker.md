# preview-3d 巡检追踪器

> **活文档**（跨轮记忆只认本文件）。每轮追加一条巡检记录，不覆盖历史。
>
> ⚠️ **维护者变更（2026-10-10）**：本文件原由「preview-3d 巡检」**自动化**维护（每轮新开对话）。
> 该自动化已停用（无排程、无看板任务、无入链），本文件因此曾被当作「死快照」误迁
> `docs/archive/`（提交 `7b6cec715`）。2026-10-10 由 AI 会话接手**人工驱动**：
> 轮转规则与格式不变，只是驱动者从定时任务换成了人/AI。迁回 docs 根（活文档位）。
> **若日后重开自动化，须直接续用本文件，勿另起一份**（否则跨轮记忆断裂）。
>
> 归档判据补充（值得记）：本文件 `## 巡检记录` 段是**追加式**且末条带「下一轮建议」时，
> 它是**活指针**而非快照——归档脚本不能只看「最后改动时间 + 无入链」就判死。

## 子模块轮转清单（tie-break 按此顺序取「最久未巡检」的第一个；vendor/ 属第三方永不改）

1. adapters
2. bone
3. caps
4. decoder
5. infra
6. materials
7. menu
8. mesh
9. model
10. screenshot
11. shader-patches
12. state
13. texture

> **已审覆盖台账（2026-10-10 补记，防重复劳动）**：轮转顺序**不等于**「未审优先」——
> `caps/` 位置靠前但已被 4 份专项审计覆盖（env ×4 / ground / water / postprocessing），
> 故取靶时须跳过。判定依据 = `docs/archive/audit-*.md` 是否有该域的专项报告。
> 现状（第 8 轮后）：adapters（1）/ bone（2）/ caps（专项覆盖）/ decoder（3、4）/ infra（5 及两批抽象扫描）/
> materials（6）/ **menu（判已覆盖：preview-menu 卡 + menu-test-assertion 执法闸 + 大量专项测试，2026-10-11 第 8 轮正式销账）**/
> mesh（7 + cube parity 守卫）/ model（8）已审；
> 未审 = screenshot / shader-patches / state / texture
> （其中 state 有大量 incidental 提及，但无专项审计报告）。

## 巡检记录（新轮追加到此段末尾）

<!--
模板（复制填写）：
## <ISO时间> 巡检：<子模块>
- 选定理由：
- 发现的改善点：
- 本轮改动：文件:行 摘要
- 验证结果：build / typecheck / biome（绿/红 + 关键报错）
- 提交：<commit hash 或 "未提交/阻塞">
- 遗留 / 下一轮建议：
-->

## 2026-09-19T09:45:29Z 巡检：adapters

- 选定理由：追踪器首轮，「巡检记录」为空、全部子模块未巡检 → 按轮转清单顺序取第一个 `adapters`。
- 发现的改善点：`adapters` 目录整体成熟（ extensive 测试 + 逐段注释 + 防御式编码），未发现真实 bug。通读 mount-session / session-ledger / data-port / mmd-shared / mmd-utils / mmd-detail-stats / mmd-zip-overlay / mmd-pmx-convert / vmd-retarget(-map) / beat-detector / fbx-scene-to-data 后，定位到一处「缺失边界覆盖」：`mmd-utils.ts` 的两个导出纯函数在**生产纹理降级读取路径**上跑，却零直接单测——
  - `concurrentMap`（fbx-adapter.ts:166 + mmd-build-load.ts:163 的批量读失败兜底）：无任何直测；仅在集成路径隐式经过。其「分片内并发、分片间串行」的有界性（ADR-101，防一次性 Promise.all 爆栈/压垮 Go 桥）与「每条恰好处理一次、结果按输入位次落位」（mmd-build-load 逐条回填 texBatch）是真实契约，却无人钉死。
  - `isLikelyTga`（mmd-build-load.ts:204 假 .tga 占位文件守卫）：`<18 字节` 分支已在 mmd-adapter.test.ts:1617 间接覆盖，但「合法图像类型集 {1,2,3,9,10,11} / 非法值 / 18 字节边界」从未钉死。
- 本轮改动（测试级，零生产风险）：`frontend/src/preview-3d/adapters/mmd/mmd-utils.test.ts` 追加两组 describe——
  - concurrentMap（3 例）：空输入→[]且不调 fn；7 条 chunkSize=3 跨多分片→每条一次不重不漏 + 结果位次落位；12 条 chunkSize=3→在途峰值 ≤3（有界）且 >1（确为并发、未退化串行）。
  - isLikelyTga（4 例）：合法类型集全 true；非法值（0/4/5/6/255）全 false；不足 18 字节（0/17）false；恰好 18 字节合法头 true。
- 验证结果：vitest --run mmd-utils.test.ts **绿**（11 passed = 7 新 + 4 旧）；`npx vite build` **绿**；`npm run typecheck`（check-bindings + tsc --noEmit）**绿**；`check-biome --files <该测试文件>` **绿**（biome 配置按约定忽略 `*.test.ts`，且本轮仅改测试文件）。
- 提交：`911cbccf0`（本地，未推送）。
- 遗留 / 下一轮建议：
  1. `mmd-pmx-convert.ts` 的 `pmxObjectToResponse` 是**唯一导出且无测试**的权威 PMX→response 转换层（worker 内跑），字段映射密集（bone 索引宽度、SDEF 近似、morph 分型、flag 位）。建议下一专项补一轮构造 PmxObject 夹具的单测——本轮判为工作量偏大（需喂完整 PmxObject），未纳入「一个小改善点」。
  2. `concurrentMap` 的 `chunkSize <= 0` 会死循环，但当前两处调用方均传硬编码 4 / 走默认值，**不可达** → 依「不为不可能场景加防御」原则未加守卫，仅记录备查。
  3. 下一轮按清单轮转取 `bone`（adapters 已巡检）。

## 2026-09-19T15:44:07Z 巡检：bone

- 选定理由：`adapters` 上轮已巡检，其余 12 项均未巡检 → 按清单顺序取最久未巡检的第一个 `bone`（上轮建议亦指向此）。
- 发现的改善点：`bone/` 目录 11 个源文件中，`leg-chain.ts` 是**唯一无同名测试**者。它是 `mmd-foot-ik.ts`（待机锚地）与 `vrm-foot-ik.ts`（VMD 足ＩＫ驱动）共用的腿链提取，承载 ADR-243 §2.8「链根取大腿的**直接父骨**」这条关键约定；此前仅经 `createVrmFootIKController` **间接**经过，其自身分支无人钉死。文件头自述分叉症状是「某格式的腿只动膝盖**且不报错**」——正是须编译/测试期锁死的静默失效。定位到未覆盖的真实契约：
  - 链根 = 直接父骨（**不硬编码 hips 语义名**，MMD 父骨名为「下半身」亦须成立）；
  - 父骨缺失 / 悬空（有节点无 object）→ 回退大腿自身的 3 节链（`chainRootId !== upperLegId` 兜底分支，line 60-64）；
  - foot 不在大腿祖先链 → 整腿缺席、不产出半截链（line 65 `!chain || chain.length < 2`）；
  - 语义缺骨一侧缺席不占位；输出恒 left→right；`endEffector === chain[len-1]` 同引用；入参 null/undefined 降级。
- 本轮改动（测试级，零生产风险）：新建 `frontend/src/preview-3d/bone/leg-chain.test.ts`（`@vitest-environment node`，8 例）——正常双腿 4 节链根取骨盆 / MMD「下半身」父骨证不硬编码 / 无父回退 3 节 / 悬空父（无 object）回退 3 节 / foot 非祖先整腿缺席 / 单侧缺骨不占位 / foot id 不在树中缺席 / null·undefined·空表降级 + endEffector 同引用断言。fixture 用 `buildBoneTree` 真实构造，据 `extractIKChainFromTree` 沿 byId.parentId 走链（不依赖 Object3D 层级）的特性简化建树。
- 验证结果：`vitest --run leg-chain.test.ts` **绿**（8 passed）；`npm run typecheck`（check-bindings + tsc --noEmit）**绿**（首跑 `SemanticBoneMap[string]` 索引签名报错，改用导出的 `SemanticBoneEntry` 修复）；`npx vite build` **绿**；biome 依配置忽略 `*.test.ts`（本轮仅测试文件）。
- 提交：`2477119ba`（本地，未推送）。
- 遗留 / 下一轮建议：
  1. `leg-chain.ts` 契约已锁，`bone/` 现仅剩无直接测试文件（无）——本目录测试覆盖收敛。
  2. `bone/` 其余文件（bone-list / bone-raycast / bone-visibility / fbx-bones / mmd-bones / ik-solver / semantic-bones / *-foot-ik）均有同名测试且注释完备，未发现真实 bug；下一轮按清单轮转取 `caps`。
  3. 备查：`extractLegChains` 的「父骨有 object 但非 foot 祖先」理论上因 tree.parentId 即定义祖先而不可达（首 extract 总能命中），故未强行为不可达分支造夹具；仅覆盖可达的悬空/无父回退路径。

## 2026-10-10T18:05:00+08:00 巡检：decoder

- 选定理由：上轮（bone）建议取 `caps`，但 `caps` 已被 4 份专项审计覆盖（env ×4 / ground / water / postprocessing）→ 按「最久未巡检」的**真实语义**跳到轮转序第 4 位 `decoder`（此前零专项审计）。本文件同期从 `docs/archive/` 迁回 docs 根（活文档位复原）。
- 发现方式：主代理读 `wasm-decode.ts` / `model-cache.ts` / `mmd-ktx2-encoder.ts` / `worker-bridge.ts` / `mmd-ktx2-texture-loader.ts` / `wasm-geometry.ts`，同时派子代理全量读 12 个源文件产出 8 条发现（🔴2/🟡4/🟢2，报告 `artifacts/audit-decoder/decoder-findings.md`）。
- **发现的真实缺陷（1 条 🔴，已修）**：
  - **F1 `cancelled` 永久闩锁 → 编码永久挂起**（`mmd-ktx2-encoder.ts`）：`cancelPendingEncodings()` 置 `cancelled=true` 后只有 `scheduleBackgroundEncoding()` 入口复位；而 `acquire()` 把 `cancelled` 当作**入队条件**——取消后经公开 API 直接发起的编码被塞进 `waitingQueue`，而 `activeCount` 已为 0 时**没有任何 `release()` 会来唤醒** → promise 永不结算，且 `inProgressHashes` 永久毒化（该纹标本会话内不再重编码）。作者已有「取消时在队者 reject」的一半修复，此为另一半漏网。
    - **实证**：新测试 `mmd-ktx2-cancel-latch.test.ts` 先红（3 例全 `TIMEOUT`）→ 修后绿；变异验证（去掉 latch 守卫）2 例转红。
    - 修法：`acquire()` 在 `cancelled` 为真时**立即 reject**（取消是一次性事件语义，不是持久状态），不再入队。
- **复核后降级/驳回的子代理发现**（避免误改）：
  - **F2（原判 🔴 头像 blob 逃出回收集）→ 降为 🟢 仅补注释**：子代理主论据是「`tryJsonDispatch` 在 `loadAvatarsForJson` 与 `cacheSet` 之间抛错」，但实测该窗口只有 `_decodedBy` 赋值 + `cacheSet` 两个**纯赋值**（`loadAvatarsForJson` 自身内建 try/catch 不外抛）⇒ 异常路径**不可达**；且 `model-cache.ts|collectBlobUrls` 显式扫 `authors[].avatarUrl`（子代理报告 L84 自己也承认缓存路径安全）。残余的「evict 回调未注册则不释放」属 `model-cache` 层既有 fail-open 取舍，非解码层缺陷。已在 `loadAvatarsForJson` 补归属契约注释，写明「此处**不该** revoke，revoke 即头像裂图」。
  - **F4（注释方向相反）→ 确认并修**：`mmd-ktx2-encoder.ts|disposeKtx2WorkerPool` 注释称挂 `cleanupPreview`，而唯一生产调用点 `mmd-build-result.ts|Stage6Dispose` 注释写「挂 MMD 会话 dispose **而非** cleanupPreview」——是被否掉的旧方案文案未同步。已改正并补理由（编码池是 MMD 专用资源，挂宿主级 cleanupPreview 会误伤并行 MMD 会话）。
  - **F3/F5（共享可变对象 / 同名纹理键覆盖）**：属「改一行即爆」的结构风险，当前无已实体化故障，留作下次触及对应函数时收敛（与子代理建议一致）。
- 本轮改动：
  - `frontend/src/preview-3d/decoder/mmd-ktx2-encoder.ts` — `acquire()` 取消语义修正（F1）+ `cancelPendingEncodings`/`disposeKtx2WorkerPool` 注释校正（F4）
  - `frontend/src/preview-3d/decoder/wasm-decode.ts` — `loadAvatarsForJson` 补归属契约注释（F2 反-假病护栏）
  - 新增测试：`mmd-ktx2-cancel-latch.test.ts`（3 例，F1 回归锁）、`wasm-decode-avatar-blob.test.ts`（2 例，头像 blob 归属）、`model-cache-order.test.ts`（2 例，`_order` 不膨胀 + FIFO 首次插入序）、`infra/worker-bridge-settle.test.ts`（4 例，在途结算完整性与幂等）
- 验证结果：`vitest run decoder/ infra/` **绿**（45 文件 / 505 例）；`typecheck`（check-bindings + tsc --noEmit）**绿**；`vite build` **绿**；`check-biome --files` **绿**。F1 变异验证 2 例转红（测试非空转）。
- 提交：见本轮 commit（与 tracker 迁回同批）。
- 遗留 / 下一轮建议：
  1. 下一轮按清单轮转取 **`infra`**（第 5 位；`decoder` 已巡，`caps` 已专项覆盖须跳过）。`infra/worker-bridge.ts` 本轮已被顺带读过（结算完整性/池终止四不变量均正确，并补了 `worker-bridge-settle.test.ts`），可作下轮起点。
  2. **未修的已知项**：F3（缓存快路径返回共享可变对象 + 浅拷贝）与 F5（`collectTexturesAndAvatars` 以去扩展名文件名为键，同名不同目录纹理静默互相覆盖 → 被覆盖 blob 立即泄漏）。两者都在 `wasm-decode.ts`，建议下轮或专门一轮处理 F5（对齐 `collectJsonSpecTextures` 的「覆盖者也登记」做法）。
  3. **值得单独立项的漂移风险**：`decoder/texture-order.ts` 与 Go `internal/app/texture_order.go` 是**手抄双实现**，口径对称但只有人工纪律注释（`texture-order.ts:2`「改口径务必同步两侧」）而无自动一致性守卫。若要动这块，值得补一条跨语言契约测试。**→ 已收口（2026-10-10）**：黄金语料 `tests/fixtures/parity/texture-order.golden.json`（11 例，主源=Go `orderTexItems`，regen `YSM_PARITY_REGEN=1 go test ./internal/app -run TestTextureOrderParity`）+ Go `internal/app/texture_order_parity_test.go` + TS `frontend/src/preview-3d/decoder/texture-order-parity.test.ts`（走生产提取链 `parseYsmMetaFromFiles`+生产 `matchTexKey`，不手搓入参）。立项时「严格对称」宣称被证伪——揪出**三处真实分叉**并全对齐：① 声明全不命中 Go 回退尺寸序 / 旧 TS 返空（WASM 主路径灰模）；② Go 单形态声明回传原始路径 rank 匹配不上静默吞声明（TS 归一生效）；③ Go 后声明胜出+去重 / 旧 TS 前位胜出+不去重。变异（TS 改回前位胜出）精确转红，闸有牙。
  4. **方法论备查**：F2 是「子代理报 🔴 但复核后不可达」的实例——**发现必须回源码验证可达性**，否则会白改甚至改出新病（本仓「不为不可能场景加防御」原则）。

## 2026-10-10T18:45:00+08:00 巡检：infra

- 选定理由：上轮（decoder）建议取 `infra`（第 5 位；`caps` 已专项覆盖须跳过）。
- 方式：主代理读 `render-host.ts` / `postproc-cost-probe.ts` / `scene-registry.ts` / `gpu-*.ts` / `worker-bridge.ts` / `preview-shell.ts` / `safe-dispose.ts` / `cleanup-helper.ts` / `content-bridges.ts` / `unload-model.ts` / `render-loop.ts` 等；子代理被派去全量读 35 文件但**未落盘报告**（疑大范围超时失效），本轮结论均为**主代理自证**。
- **发现的真实缺陷（1 条 🔴，已修）**：
  - **GPU 计时 query 未删孤儿**（`postproc-cost-probe.ts|createGpuTimer`）：`poll()` 只在 `QUERY_RESULT_AVAILABLE===true` 时 `deleteQuery`，而探针收尾 drain 有 `DRAIN_MAX_FRAMES` 上限。窗口内始终未就绪的 query（后台标签页 rAF 节流 / 驱动延迟）**既不产数字、也不被删除**——`inflight` 是闭包局部数组随本次探针被 GC，其指向的 WebGL query 对象留 GL 侧成孤儿；探针按设计反复跑（诊断用途）⇒ 逐次累积，每轮最多 8 个（`MAX_INFLIGHT_QUERIES`）。**同族第二路**：只 `begin` 未 `end` 的 active query（渲染段抛错打断）此前亦无删除路径。
    - **实证**：新建 `postproc-cost-probe.gpu-timer.test.ts`（6 例，假 WebGL2 上下文记录 create/delete 计数）锁不变量**创建数 == 删除数**；变异验证（`dispose` 体换空实现）→ **3 例转红**（未就绪兜底 / 未 end active / 上限回收）。
    - 修法：`GpuTimer` 增 `dispose()`（删全部 inflight + active，active 先 `endQuery` 再删）；探针测量段包 `try/finally`，出口无条件 `dispose()`。为可直测把 `createGpuTimer` 由私有改导出（原为零测试私有函数，泄漏无人可查）。
- **驳回的两条候选（防假病，留档）**：
  - `render-host.ts|animate` 首行无条件 `requestAnimationFrame` ⇒「早退不停环」：**非缺陷**。已由 `render-host.raf-contract.test.ts` 显式文档化并钉死（停环唯一手段 = `stopIfIdle`/`reset`），且生产清理路径（`mount-session.ts|unbindInputsAndStopLoop`）正是「`removePerFrame` → `stopIfIdle`」配对；`mount-preview-core.ts:286` 的 `resetLoopState()` 在 `_resetSingletons()`（测试用）内，非生产路径。
  - `preview-shell.ts:106` 的 `body as HTMLElement` 强制 cast（复用路径 body 可能 null）：**潜在隐患非活缺陷**。`resetRefs()` 三字段同置 null，故「overlay 在而 body 为 null」不可达；且 `mount-shell.ts:64` 已按「用 `ensureViewContainer` 返回的权威 body」消费，并有回归锁（`mount-preview-core.test.ts:576-599`）。
- **挂起的产品问题（非缺陷，待拍板）**：`scene-registry.ts|unregister` 的焦点晋升取 **Map 插入序末位**，而非「最近被激活者」。新增 `scene-registry-focus.test.ts`（5 例）把该语义**分离钉死**——既有测试（`scene-registry.test.ts:49-56`）只覆盖「唯一幸存者接任」，两种规则同解故未区分。用户可见影响：roles 面板 ✓ 高亮 / 菜单绑定 / 取景都跟 `activeId`。**待答**：点选过（但非最后插入）的模型是否该优先接任？
- 本轮改动：
  - `frontend/src/preview-3d/infra/postproc-cost-probe.ts` — `GpuTimer.dispose()` + try/finally 出口释放 + `createGpuTimer` 导出
  - `frontend/src/preview-3d/infra/unload-model.ts` — frustum 根注销收口（F1/F3）
  - `frontend/src/preview-3d/infra/debug-render.ts` — 导出 `releaseDebugLabelCache()`（F2）
  - `frontend/src/preview-3d/adapters/ysm-adapter.ts` — 会话终结调 `releaseDebugLabelCache()`（F2）
  - 新增测试：`postproc-cost-probe.gpu-timer.test.ts`（6 例，query 创建/删除配对）、`scene-registry-focus.test.ts`（5 例，焦点晋升语义）、`unload-model-frustum.test.ts`（4 例，modelRoots 三集合一致性）、`debug-render-cache.test.ts`（5 例，标签纹理缓存会话边界）
- **子代理产出（本轮主力）**：🔴2 / 🟡3 / 🟢2，报告 `artifacts/audit-infra/infra-findings.md`。主代理逐条复核后**修正了两处诊断口径**（见下），并独立发现并修掉 GPU query 孤儿。
- 验证结果：`vitest run preview-3d/` **绿**（213 文件 / 3651 例）；`typecheck` **绿**；`vite build` **绿**；`check-biome` **绿**；`check-layering` **绿**。三处修复均做变异验证（分别 3 / 2 / 3 例转红）。
- 提交：`6e028556d`（query 孤儿）、`a0372a2f0`（本轮记录+焦点测试）、`14ffff383`（F1/F3 + F2）。
- **复核修正的两处口径（重要，防后人沿用错描述）**：
  1. **F1 的成因不是「从不注销」而是「注销被抛错跳过（=F3）」**：5 个适配器的 `dispose()` **都**调了 `unregisterModelRoot`（ysm:579 / vrm:606 / litematic:486 / mmd-build-result:186 / fbx:335），只是 MMD·YSM·Litematic 把它排在可能抛错的语句之后。实证复现需让 `dispose` 抛错，而非「完全不调 dispose」。
  2. **F2 的清空覆盖面比子代理设想更窄**：`clearLabelTexCache` 不只「只在 rebuildDebug 内」，而是**只在同一 rig 二次重建时**（`if (state.debugGroup)` 为真）才触发；换全新 rig（`debugGroup` 初值 null）再 rebuild 时缓存照样累积（实测 2+3=5）。故「会话内也会累积」而不止跨会话。
- 遗留 / 下一轮建议：
  1. 下一轮按清单轮转取 **`materials`**（第 6 位；`infra` 已巡）。实测该目录为 `frontend/src/preview-3d/materials/`（**仅此一个**，5 个非测试源文件；先前一次 `Test-Path` 探测曾误报 `material` 单数并存，经复核为无——特此更正，勿再据误报改名）。
  2. **本轮未修的已知项（子代理报告内，已复核）**：`F4 🟡` 探针 `DEFAULT_MSAA_SAMPLES=4`（`postproc-cost-probe.ts`）与 cap 侧 `POSTPROC_MSAA_SAMPLES=4`（`postprocessing-capability.ts`）**双源**——污染报告核心数字 `rtBytes*`，改一侧即静默报错；修法应把常量下沉 `infra/` 叶层（`infra` 本就是 cap 下层，注释里的「不反向 import」理由成立但与双源是两件事）。`F3 残留`：MMD/YSM/Litematic 三个适配器内的 `unregisterModelRoot` 仍排在其 `dispose()` 内可能抛错的语句之后（本轮已由 `unloadModel` 兜底，故不再致命，但**其他调用点**（如 `teardown("full")` 直走适配器 dispose）仍走旧序——建议顺手提到各自 dispose 首行）。
  3. **无同名测试的真实契约文件（3 个）**：`load-trace.ts`（环形上限 + 浅拷贝快照语义无断言）、`preview-shell.ts`（`resetRefs`/`ensureViewContainer` 的 body 兜底补建与权威引用回传无独立契约锁，其注释自陈易误用）、`content-bridges.ts`（纯类型，**建议不补**）。另 3 个无测试文件（`camera-controls` / `postprocessing` / `ui-constants`）为纯类型/常量，无运行期契约。
  4. **子代理失效备查（本轮教训）**：35 文件全量委派**未产出报告**——大范围委派宜拆成 2~3 个小批次并给明确文件清单，避免单一子代理超时后全轮无产出（本轮靠主代理自读兜住，未损失结论）。
  5. **`scene-registry` 焦点晋升的产品问题仍挂起**：`unregister` 取 Map 插入序末位而非「最近被激活者」，语义已由 `scene-registry-focus.test.ts` 分离钉死；待答「点选过的模型是否该优先接任」。

## 2026-10-10T19:26:00+08:00 追加：抽象层扫描（不按目录，按**缺陷族**）

- 选定理由：上轮尾声浮现一个比单点缺陷更值的问题——**同一不变量由 N 个实现方各自维护，而无人负责一致性**。故本轮不取 `materials`，先按族扫：①模块级 const 容器的 owner/清理出口 ②「N 实现方共享同一不变量」的一致性。
- **族①：模块级 const 容器普查 → 零新缺陷**。逐个人工判定 39 处顶层 const 容器（排除纯常量查表），判据 = *无界增长 ∧ 无生产可达复位 ⇒ 违规*：`model-cache`（cap 50+FIFO）/ `pmxStatsCache`（CAP+clear）/ `specCache`（SPEC_CACHE_MAX+LRU）/ `warnedPaths`（MAX+驱逐）/ `_groupCache`（键域=schema group 有限集）/ `_decodeInFlight`（finally 自清）/ `folderCollapsedState`（会话内 clear）/ `customCleanups`（`!isConnected` 清扫）/ `_injectedOnce`（`setOverlayStyleTarget` 复位）/ `listeners`/`_callbacks`（订阅表，生命周期配对）——**均有上限或有可达清理出口**。
  - **为什么值得记**：本仓 `check-singleton-hygiene` 的射程**自己声明**「`const` 容器（Map/Set 缓存）不测——属有界缓存范式，分开立法另议」⇒ 整类债无闸。本轮普查即该「另议」的一次人工兑现：结论是**当前无违规**，故不需要扩张闸门射程（避免噪音），但把判据留档备查。
- **族②：N 实现方一致性 → 抓到 1 处真缺口（与上轮 F1 镜像）**：
  - `registerModelRoot` 是**各格式适配器各自的职责**——`registerBuiltScene`（infra）只把差量 roots 收进 `sceneRegistry`（供隐藏/取景/归属），**不代为注册** frustum 根。
  - 逐格式对账：ysm ✓ / vrm ✓ / fbx ✓ / mmd ✓ / litematic ✓ / **pack ✗**——`pack-model-adapter` 是**唯一** `scene.add(group)` 却不 `registerModelRoot` 的格式。
  - **后果**：用户开启视锥剔除（设置面板，**默认关**）后资源包模型**对剔除不可见**——同框内行为按格式分叉（其它格式被剔、pack 不被剔），且 `_culled` 抑制态归属链对它失效。与上轮 F1（注册了却不注销）恰成**镜像病：一个多、一个少**。
  - **修法**：`infra.scene.add(group)` 旁补 `registerModelRoot(group)`；`disposeContent` **首行**补 `unregisterModelRoot`（与 VRM/FBX 的隔离写法对齐，排在 `safeDispose` 之前防抛错漏注销）。
- **契约化（防再漏格式）**：新增 `frustum-registration-contract.test.ts`（14 例）——逐格式断言注册/注销成对（6 格式全绿）；断言 `registerBuiltScene` **不**代为注册（若将来 infra 代为注册，本契约语义须重写，红即提示）；末条守卫「登记表未过期」（新格式忘登记会因计数不符提示）。
- 验证：preview-3d 全量 215 文件绿；typecheck / vite build / biome / check-layering 全绿。
- 提交：`b4c0ff294`。
- 遗留 / 下一轮建议：
  1. 下一轮按清单轮转取 **`materials`**（第 6 位；`infra` 已巡两轮）。
  2. **族② 的残余**：本轮只对账了 `registerModelRoot` 这一条不变量。同类「N 实现方」候选尚有：各适配器的 **`releaseTextures` 归还**（ysm 有显式降级告警，其余格式是否有对应契约？）、**`dispose` 的隔离度**（FBX `safeCall` / VRM try-catch / 其余裸写——本轮已由 `unloadModel` 兜底 frustum 一支，但「整份 dispose 的异常隔离」仍是三种写法并存）。建议下轮或专门一轮把「适配器 dispose 范式」收口为**唯一写法**（如统一经 `safeCall` 或 `safeDispose` 组合），一次消灭该族。
  3. **族① 的判据已留档**：若日后有人想扩张 `check-singleton-hygiene` 射程覆盖 `const` 容器，本轮清单与判据可直接作为「零基线」起点（当前 39 处全部合规，扩张后应立即全绿而非需登记存量）。

## 2026-10-10T23:00:00+08:00 追加：抽象扫描第 3 批（dispose 隔离 + build 失败归还两族，收口上轮 §遗留 2）

- 选定理由：续族②「N 实现方共享同一不变量」，本轮对账上轮清单点名的两条残余——**dispose 异常隔离**与**纹理引用归还对称**。
- **族②b：dispose 异常隔离（抓到真缺陷，已修）**——5 实现方隔离度四分五裂，缺陷形态一致：**外部注入回调抛错 → 后续清理静默跳过**。
  - **ysm（最脆）**：`dispose()` 完全无 try，`rayCleanup()` / `bonePanelRef.current?.()` 裸排在注销前——任一抛错则**八项清理全跳过且异常外泄**（实证：新测试令 rayCleanup 抛错，修前直接把 Error 抛给调用方）。修法对齐 VRM 范式：只隔离易抛项，其余裸写（注销/纯操作包 try 只会掩盖真缺陷）。
  - **mmd**：一个大 try 包全链（bonePanelRef 抛错即跳过注销/mixer/感知层，catch 只 dbg）→ 拆为「面板清理单独 try」+ 主链裸写。
  - **vrm/fbx** ✅ 两正确范式（单点 try/catch、逐项 safeCall）；**litematic** ✅ 裸写但前缀均不可抛，补注释钉「若插入回调须提前注销」。
  - **契约化**：`adapter-dispose-contract.test.ts`（5 例）——判据是**逐处绑定**（每处回调向上找最近 try、遇 `} catch` 边界即判未受保护）。⚠️ 初版只判「存在某个 try」被变异验证当场抓获**假绿**（删掉两处隔离仍全绿），改锚定行级后同一变异精确报 L592。教训入档：**契约测试必须过变异验证，否则是装饰**。
- **族②c：build 中途失败的归还对称（抓到跨格式共有形态，中央收口）**：
  - 逐格式对账发现「**register 早、句柄晚**」是**所有 6 格式共有的形态**（scene.add + registerModelRoot 在中段，dispose 句柄在最后一行才产生），中段之后抛错 → 句柄 dispose 永不执行。
  - **ysm 私有面**（textureCache 引用归还）：`buildYsmScene` 阶段②③包 try/catch 补 `releaseTextures` + 注销（`4b89dd791`，TDD 2 例先红后绿）。
  - **全格式公共面**（frustum 根注销）：正解不在逐格式补 catch（N 实现方各补一遍 = 病根本身），而在**中央 stale 清扫**——`recoverMountFailure` 与 `recoverSwitchFailure`（keep 分支）的 remove + disposeObject3D 循环补 `unregisterModelRoot(c)`（no-op 幂等安全），一次覆盖全部格式含未来新增（`fb12e3321`，TDD 1 例先红后绿）。
  - **驳回的假病**：VRM `vrmDiag` await 在 register 之后——读实现自带 try/catch「诊断不阻断」，不可抛，不修。
- **族②a 残余 `releaseTextures` 对账结论**：仅 ysm/pack 用 textureCache 池（其余格式纹理不走池，无归还义务）；pack 的 `disposeContent` 与 build 失败路径**均已配对 release**（L268-270 / L326）——非缺口，设计如此。`menu/panels/env.ts` 的 per-mount WeakMap 订阅（`_envCapUnsubsByMenu`）有显式 `disposeEnvSubscriptions` 出口 + rebuild 前清旧，✅ 正确实现。
- 验证：preview-3d 全量 217 文件绿；typecheck / vite build / biome / check-layering 全绿；三处修复各带变异验证（2 / 3 / 1 例转红）。
- 提交：`f3a59e7d4`（dispose 隔离）、`4b89dd791`（ysm 后段归还）、`fb12e3321`（中央清扫注销）。
- 遗留 / 下一轮建议：
  1. 下一轮按清单轮转取 **`materials`**（第 6 位）。
  2. **同族可回访点**：`switch-preview.ts` clearSwitchContent 的 !keep stale 循环只 remove 不 dispose/注销——其语义是「旧内容层随后由 dispose() 收尾」链是对的，但若 dispose 抛错（有 try 兜），frustum 注销也随句柄一起丢；中央清扫已兜 mount 侧，switch 该分支未兜（低概率，回访 materials 后有余力再看）。
  3. **本仓「N 实现方」债的元结论**：三轮扫描（const 容器 0 违规 / registerModelRoot 1 缺口 / dispose 隔离 2 实现脆 + build 归还 1 共有形态）表明该族共因是**责任外包给实现方而中央无兜底**。已落三枚契约测试（frustum-registration / adapter-dispose / stale 清扫断言）把「实现方自觉」翻成「机器拦截」；新格式接入时这三枚闸会先于人工评审抓到漏项。

## 2026-10-11T02:20:00+08:00 巡检第 6 轮：materials

- 选定理由：按轮转清单第 6 位（上轮建议）。5 源文件 / ~416 行，5/5 全有同名测试。
- **结论：零缺陷轮**。逐文件深读 + 消费方对账：
  - `materials-shared.ts`：ADR-180 骨架收编（mmd/vrm 逐字重复的四函数归一），越界 no-op / clamp / transparent 联动重置（≥1 恢复 false）均正确且有测试。
  - `mmd-materials.ts` / `vrm-materials.ts`：薄壳只留领域差异（pmx 索引配对 vs needsUpdate 重编译注入），list 输入源不同不强行共享——注释论证成立。**非缺口**：`toggle*` 仅测试消费、UI 走 `setVisible`（material-controls.ts 鸭子类型 bridge），属 ADR-180 吸收的存量导出而非死代码。
  - `alpha-index.ts`（ADR-118 面级透明索引）：前缀和构建/查询的边界（+1 哨兵行列、clamp、退化矩形）逐行核过；小矩形（≤128px）走逐像素精确路、大矩形走 tile **保守过近似**——对渲染路由是安全方向（宁可多判 blend 不漏判）。**已实证**（一次性探针 3 例，跑绿即删）：tile 路结果恒为精确结果的**超集**（`tile & exact === exact`）——部分覆盖 tile 时域外特征会被计入（superset 方向），域内特征绝不漏判；对齐矩形时两者一致。探针未转正：现有 4 例（单像素精确/跨 tile 聚合/clamp/全不透明）已覆盖行为面，超集不变量作为已知语义记录于此即可。
  - `texture-alpha.ts` 消费对账：`AlphaIndex` 用 `pixels.width/height` 构建、`face-split.ts` 用 `info.width/height` 换算 UV→像素——**同一 `pixels` 对象**（texture-alpha.ts:25-27），坐标系同源无错配；canvas 路 256px 降采样时两者同步缩小，比例一致。
  - `mc-tints.ts`：族①回访——`cache` 模块级永不清，但键域 = vendored 版本 JSON（有界、内容不可变），符合族①判据；`inflight` 失败清空（注释论证：一次网络瞬断不应永久锁死）正确。
- 验证：materials/ + 两消费者（face-split / texture-alpha）7 文件 56 例绿。
- 遗留 / 下一轮建议：下一轮按清单轮转取 **`mesh`**（第 7 位；face-split.ts 本轮已顺带读过判定正确，可作起点）。materials 目录本体判**已收敛**，短期无需回访。

## 2026-10-11T02:20:00+08:00 追加：decoder 未修清单收口（F5）

- 选定理由：decoder 轮（2026-10-10）遗留的第 2 条——`F5（collectTexturesAndAvatars 同名不同目录纹理键覆盖 → 被覆盖 blob 立即泄漏）`。texture-order 双源（同条第 3 条）已由 `cb1ce8d6d` 收口，F5 是 decoder 域最后一个活缺陷项。
- **修复**：`wasm-decode.ts` 两处 collect 函数覆盖时立即 revoke 被覆盖者——
  - `collectTexturesAndAvatars`（WASM 路径）：`textures[key]` 与 `avatars[name]` 赋值前 `if (prev) URL.revokeObjectURL(prev)`（被覆盖者从覆盖瞬间起无消费者：texKeys 消费只取当前值、revokeTexAccumBlobs 只扫最终值——覆盖者原逃逸即泄漏，成功/失败路径都漏）
  - `collectJsonSpecTextures`（JSON spec 路径）：同族——`acc.textures[key]` 赋值前 revoke；其 pendingBlobUrls 失败路径二次 revoke 为 no-op 安全，成功路径 clear 只清 Set 不移交，被覆盖者已在此释放
  - 交付者（最后覆盖者）归属不变：WASM 路径走 revokeTexAccumBlobs/移交 geometry，JSON 路径走 pendingBlobUrls/移交 result.geometry。
- **测试（TDD 先红后绿）**：新 `wasm-decode-tex-collision.test.ts` 2 例（同名不同目录纹理 / 同名不同目录头像），修复前 `revoked=[]` 转红、修复后绿；wasm-decode.test.ts 26 例 + avatar-blob 2 例回归绿（成功路径 revoked==[]、失败路径 revoked==created 不受影响）；decoder 全族 146 例、vite build、typecheck、biome 全绿。
- **遗留 / 下一轮建议**：
  1. decoder 域未修项清空。下一轮按清单轮转取 `mesh`（第 7 位；materials 轮建议同向）。
  2. 族② 残余仍在队列：抽象扫描第 3 批已收口 dispose 隔离与 build 归还（f3a59e7d4/4b89dd791/fb12e3321），`switch-preview.ts` clearSwitchContent !keep 分支的 stale 循环未兜注销（同轮回访点，低概率）可作 mesh 轮顺带确认。
  3. infra 轮遗留未变：F4 双源常量（`DEFAULT_MSAA_SAMPLES` 探针与 cap 侧）、`load-trace.ts`/`preview-shell.ts` 无独立契约锁、scene-registry 焦点晋升产品问题仍挂起待拍板。

## 2026-10-11T10:00:00+08:00 追加：infra 轮遗留收口（F4 双源常量）

- 选定理由：infra 轮（2026-10-10）遗留第 2 条的 F4——探针 `DEFAULT_MSAA_SAMPLES`（`postproc-cost-probe.ts`）与 cap 侧 `POSTPROC_MSAA_SAMPLES`（`postprocessing-capability.ts`）双源硬编码 4，改一侧即静默报错（污染报告核心数字 `rtBytes*`）。
- **修复（下沉 infra 叶层单源）**：新叶 `infra/msaa-samples.ts` 导出 `POSTPROC_MSAA_SAMPLES = 4`，probe 与 cap 同指本值——双源在结构上不可表达。方向合规：cap 属上层可 import infra（既有先例 postprocessing.ts / render-budget.ts），check-layering R9 preview-3d 反向边 0 命中。
- **验证**：probe（含 run.test 报告口径 msaaSamples=4）+ cap（[P2] samples 断言）145 例绿；preview-3d 全族 218 文件 / 3696 例绿；vite build / typecheck / biome 全绿。
- **遗留 / 下一轮建议**：
  1. infra 轮遗留仅剩：`load-trace.ts`/`preview-shell.ts` 无独立契约锁（补测试项）、scene-registry 焦点晋升产品问题（待拍板，非缺陷）。下一轮按清单轮转取 `mesh`（第 7 位）。
  2. `switch-preview.ts` clearSwitchContent !keep 分支 stale 循环未兜注销（低概率回访点）可作 mesh 轮顺带确认。

## 2026-10-11T10:10:00+08:00 追加：infra 轮遗留收口（load-trace / preview-shell 契约锁）

- 选定理由：infra 轮遗留第 3 条「无同名测试的真实契约文件（3 个）……`load-trace.ts`（环形上限 + 浅拷贝快照语义无断言）、`preview-shell.ts`（`resetRefs`/`ensureViewContainer` 的 body 兜底补建与权威引用回传无独立契约锁，其注释自陈易误用）」。content-bridges.ts（纯类型）按原建议不补。
- **本轮改动（纯测试，零生产变更）**：
  - 新 `infra/load-trace.test.ts`（3 例）：环形上限 50（55 条后最旧 0..4 被挤掉、5..54 保留、顺序保持）；`getLoadTraces()` 返回数组级快照（外部 push/splice 不影响内部 store）；`clearLoadTraces` 清空后可重录。
  - 新 `infra/preview-shell.test.ts`（6 例）：`resetRefs` 三字段同置 null；`ensureOverlayShell` 首建（id/role/aria-modal/aria-label + body 进 shadow root + host 记录引用 + 样式目标切到 shadow root）；attachShadow 缺失 → 降级 light DOM（root = overlay 本体）；复用路径不重建（同一 overlay / root、shadow root 内仅一份 .mpc-body）；`ensureViewContainer` body 兜底补建（body=null → 补建 .mpc-body 进 root、host 记录、返回权威引用——调用方须用返回值而非入参）；复用路径 viewContainer 同一引用不重复创建。
- **变异验证**：`MAX_RECORDS` 50→3 环形上限用例精确转红（length 50 断言捕获），恢复后绿——测试非空转。
- **验证**：infra 全族 41 文件 / 430 例绿；vite build / typecheck / biome（测试文件按约定忽略）全绿。
- **遗留 / 下一轮建议**：
  1. infra 轮遗留全清（scene-registry 焦点晋升为产品问题待拍板，非缺陷）。下一轮按清单轮转取 `mesh`（第 7 位）。
  2. `switch-preview.ts` clearSwitchContent !keep 分支 stale 循环未兜注销（低概率回访点）可作 mesh 轮顺带确认。

## 2026-10-11T10:25:00+08:00 巡检第 7 轮：mesh

- 选定理由：按轮转清单第 7 位（materials / decoder / infra 三轮建议同向）。7 源文件 / 1123 行，全部有同名测试（含 mesh-cycle-guard 专测环检测）。
- **结论：实现零缺陷**——但收口 1 个 infra 轮回访项（switch stale 清扫漏注销，**确认是真缺陷非低概率摆设**）+ 抓到 1 个高危结构性风险（cube UV 双源无 parity 守卫，待拍板）。
- 逐文件深读：
  - `cube-mesh.ts`(463) / `quaternion.ts`：与 Go `threejs/spec.go`+`spec-cube.go` **逐函数核到逐值一致**——applyInflate(origin X 翻号 + size +2i)/clampThickness/resolveCubePivot(cp[0]=-pivot)/computeLocalVertices/fixZeroThickness/六面顶点序+法线+索引/up-down UV 槽位反转 [s3,s2,s1,s0]/box UV 六面展开表(down fh=-z)/mirror(east↔west 互换 + 逐面 u 交换)/parseFaceUV 空面回退/localPos 公式/四元数 Rz·Ry·Rx 展开三行——全等。两侧各自引黄金参照 GeoCube.java + 各有测试（JS cube-mesh.test.ts ↔ Go TestBuildCubeMeshData_*）。
  - `mesh.ts`：buildSceneMesh 两遍构建（先全建组后连边）+ 环检测 `ancestorChainContains` 降级挂组件根（孤儿更糟的论证成立），cycle-guard 测试钉不变量；disposeMaterial 与 scene-stats 共用 ALL_TEXTURE_KEYS 单源。✅
  - `mesh-builder.ts`：perComponent 索引空间分离（compTexArr 局部 0 基 vs 全局 md.texIdx，混用越界误报品红）；blend 双 pass（BackSide depth pre-pass colorWrite:false + FrontSide 混合）根除正背面排序闪烁，clone 后原 mat 显式 dispose。✅
  - `face-split.ts` / `mesh-baker.ts`：UV→像素换算与 AlphaIndex 同源（materials 轮已证）；bake 按 bone:texIdx:mode 分组，法线仅旋转不平移。✅
- **✅ 回访项收口（本轮修复）**：`switch-preview.ts|clearSwitchContent` 的 !keep stale 清扫**漏注销 frustum 根**——L198 `scene.remove(c)` 只出场景，注销寄望随后的 `content.dispose()`，而它被 try/catch 包住（L202-206 只 logError）：dispose 中途抛错（外部回调排在注销之前，ysm/mmd 已证该语句序）即跳过注销 ⇒ 幽灵根永久残留。mount 侧 `recoverMountFailure` 已中央兜底（fb12e3321），本分支补齐 switch 侧 `unregisterModelRoot(c)`。
  - **测试（TDD 先红后绿）**：`switch-preview.test.ts` 新 describe 1 例——旧 content.dispose 抛错，断言根出场景**且** `getModelRootCount()` 归零；修前精确报 `expected 1 to be 0`，修后 37 例绿；变异验证（摘掉注销行）转红。
- **⚠️ 结构性风险（本轮唯一新发现，待拍板是否收口）**：`cube-mesh.ts` ↔ Go `spec.go`/`spec-cube.go` 是**手抄双源**，与 `texture-order.ts`↔`texture_order.go` **同型**——那个「两侧各有测试、各自绿、展开表仍分叉 3 处」的病刚在 `cb1ce8d6d` 被证实并补了黄金语料 parity 守卫。cube UV 目前**只有各自侧手算期望值测试，无跨语言黄金语料对账**：若有人改 Go 表并同步改 Go 测试、另一人改 JS 表并同步改 JS 测试，两侧可**同时绿但已分叉**（texture-order 的失效模式）。cube UV 是 3D 渲染正确性的地基（每 cube 每面贴图方向），分叉后果 = 模型贴图错乱，比纹理序回退更严重。
  - **建议收口法**：复用 `cb1ce8d6d` 的 `tests/fixtures/parity/*.golden.json` 机制——Go 侧 `TestCubeMeshParity`（`YSM_PARITY_REGEN=1` dump 代表性 cube{origin,size,pivot,inflate,mirror,faceUV,rotation}×texDim 的 positions/normals/uvs/indices/localPos/localRot 为 golden），TS 侧 `cube-mesh-parity.test.ts` 读同一 golden 断言 `buildCubeMeshData` 逐值等。工作量中等，一次建成根除地基漂移。
- 验证：preview-3d 全量 **220 文件 / 3706 例绿**；typecheck / vite build / biome / check-layering 全绿。
- 遗留 / 下一轮建议：
  1. **cube UV parity 守卫**（见上 ⚠️）——是否建由用户拍板；属高价值可选项，非当前缺陷（两侧现值一致）。
  2. 下一轮按清单轮转取 **`model`**（第 9 位；第 8 位 `menu` 已有 preview-menu 知识卡 + 大量专项测试，可评估是否视为已覆盖）。

## 2026-10-11T10:45:00+08:00 追加：cube UV parity 守卫建成 → **当场抓到真实分叉，并推翻我上一轮的判断**

- 选定理由：用户拍板建 cube UV 双端对账守卫（mesh 轮 ⚠️ 项）。
- **⚠️ 更正上一轮的结论**：我在 mesh 轮写「两侧现值一致（我逐值核过）」——**错了**。
  黄金语料对账**首轮抓到 1 处、补例后再抓 2 处，共三处真实分叉**：
  1. **TS 缺 `localPos` 守卫**（`guard-nan-bone-pivot` Go 返 nil、TS 产出对象）：Go 有
     `checkFinite(localPos)`（spec.go），TS 只有三道守卫。后果：bonePivot 含 NaN/Inf 时
     TS 把 NaN 写进 `MeshData.localPosition` → 下游 `Object3D.position.set(NaN,…)` 使该
     mesh 及子树 matrixWorld 全 NaN → **渲染整体消失且不报错**（静默丢件）。已补对齐。
  2. **TS 缺 `lx..hz` 顶点相对 pivot 守卫**：极值 origin/pivot 使 `hx2=(tx-fx)*0.5` 溢出。
     此路此前被 `spec-builder.test.ts` 一条用例**以「JS 浮点边界行为」为由钉成期望**——
     该前提是错的（1e308+1e308=Inf 是 IEEE754 语义，Go/JS 完全一致，Go 同输入返回 nil），
     等于把分叉合理化。已补守卫并**更正该测试**（连带更正 localPos 那条同类用例）。
  3. **JS South 面结合序抄错**：Go `u + sz + sz + sx`（对齐 Blockbench 权威
     `size[2]*2 + size[0]`），JS 抄成 `u + z + x + z`——数学等价但**加法不满足结合律**，
     z 与 x 量级悬殊时（z=8、x=0.001）落在不同舍入粒度 → 差 1 ULP。
     ⚠️ **我一度想用相对容差抹平它，这是错的**：纯加减乘出现 ULP 差的唯一成因就是
     抄写的结合序不同 = 真实分叉，改容差等于把它永久藏起来。已改 JS 对齐权威，
     并**恢复逐位精确比对**（仅 `localRotation` 保留 1e-9 容差，因其含 cos/sin/sqrt）。
  → 教训入档：**人工逐值核对会漏守卫链条数与表达式结合序**；跨语言对账不能靠读，
  且对账的比对精度本身不可为「变绿」而放宽。
- **修复**：`cube-mesh.ts` 补两道守卫 + South 结合序对齐 Blockbench 权威；
  `spec-builder.test.ts` 两条「JS 浮点边界」用例更正为断言 Go 对齐语义。
- **机制建成（沿 cb1ce8d6d parity 先例）**：
  - Go 主源 `go/threejs/cube_mesh_parity_test.go`：`TestCubeMeshParity`，
    regen = `YSM_PARITY_REGEN=1 go test ./go/threejs -run TestCubeMeshParity`。
  - 黄金语料 `tests/fixtures/parity/cube-mesh.golden.json`：**21 例**，覆盖
    基本 box UV / 显式 pivot X 翻号 / **inflate+boxUV（钉「parseUV 用原始 size 而非膨胀后」口径）** /
    mirror 完整语义（east↔west 互换）/ per-face faceUV（含 up/down 负 uv_size，foxcar 回归）/
    faceUV 空对象与非法 JSON 两路回退 / 零厚度与负 size clamp / 三轴旋转 + 单轴 90°/180°
    （四元数分支切换点）/ cubeTexW 覆盖 / texW=0 零填充 / 无 UV 零填充 / mirror+faceUV /
    负 inflate 收缩 / **四道守卫各一例**（NaN origin、Inf size、inflate 溢出、NaN bonePivot）。
  - TS 消费侧 `frontend/src/preview-3d/mesh/cube-mesh-parity.test.ts`：喂同一 cube 断言逐值等。
  - **口径设计（关键取舍，写进语料 $semantics）**：`positions/normals/uvs/indices/localPosition/
    texIdx/id/boneId` **精确比对**（IEEE754 四则运算跨语言逐位一致，无需容差）；
    **仅 `localRotation` 走 1e-9 容差**——`eulerToQuaternion` 含 cos/sin/sqrt，JS Math 由实现
    定义（V8 亦 fdlibm 通常一致但不保证），可差 1 ULP；1e-9 远小于任何真实公式改动量级（≥1e-2），
    不影响抓漂移。特殊浮点用字符串哨兵 `"nan"/"inf"/"-inf"`（JSON 无此字面量），双端各自映射。
- 验证：TS parity 21 例绿（修前 1 红）；mesh/ 8 文件 97 例绿；Go `./go/threejs` 全包绿（含既有
  TestBuildCubeMeshData_* 未破）；`go build ./...` 绿；gofmt 干净；typecheck / vite build /
  biome / check-path-hygiene（parity 跨界读语料走既有白名单，fail=0）全绿。
- 遗留 / 下一轮建议：
  1. 下一轮按清单轮转取 **`model`**（第 9 位）。
  2. **同族推广候选**：本轮证明「守卫链条数」是人工核对的盲区。`mergeCubes`（JS/Go 双份）与
     `computeBoneLocalPos`（JS 有、Go 在 spec-bones.go）也属同型手抄双源，若日后回访可并入本语料
     或另建；当前无分叉证据，不主动开战。


## 2026-10-11T13:05:00+08:00 巡检第 8 轮：model

- 选定理由：按轮转清单第 9 位（第 7 轮遗留建议）。5 源文件 / 1628 行，全部有同名测试。
- **结论：抓到 3 处结构级双端契约分叉并全部收口**——本轮方法论是轮 7 教训的推广：
  parity 锁的是**值面**（逐数值），本轮巡检的是**结构面**（两侧走不走同一条条目选择链）。
  `spec-builder.ts parseBedrockGeometry` 是 Go `geometry/parse.go` 的手抄镜像，逐值核时
  两侧数值全等，但 Go 有、TS 缺的整段选择链让同一份输入跨通道产出分叉。
- **可达性总证**：`geometryRaw` 是原文件文本（`wasm-decode.ts|firstGeoRaw`，L187 首个成功
  解析的 geometry 原文）。Android/桌面走 Go binding `Build3DSpecFromGeometryJSON`（真
  `ParseBedrockGeometry`），网页兜底走 TS 镜像——同一文本，Go 能解析、TS 拒绝/崩溃 = 跨通道分叉。
- 三处分叉（均有 Go 测试/真实语料背书，非理论路径）：
  1. **A 旧版 `geometry.*` 格式回退缺失**：Go `parseOldFormat`（包注释点名车万女仆 mod，
     `TestParseBedrockGeometry_OldFormat` 钉死）；TS 直读 `minecraft:geometry[0]` 即拒。
     后果：旧格式模型桌面正常、网页兜底通道 `{}` 无预览。
  2. **B 多 geometry 跳空壳缺失**：Go `SkipEmptyBones`（注释：Blockbench 导出偶发首条仅
     description 占位）；TS 无条件取首条 → 首条空壳时 `for...of undefined` **TypeError 崩溃**，
     预览整挂（连 `{}` 都到不了）。单条目 bones/description 缺席同崩（Go NoBones/NoDescription
     测试钉 Go 宽容形态）。
  3. **C GUI 装饰骨骼过滤缺失**：Go `isGuiBone`（wine_fox 兼容性引入）；TS 零过滤 → 网页预览
     骨骼列表混入 GuiRoot/Backgrounds 浮动干扰几何，桌面 Go 路径不出现——跨通道不一致。
  ⚠️ **射程边界**：三元组边界值容错类分叉（origin/size 过短/过长/对象形态）属真实语料
  51,400 cube 零命中的死路径，`3d-patterns.md` §14 已裁决**不收敛**（ADR-129），本轮不动它
  （triple-tolerance 8 例照绿即为未破坏）。
- **Go 侧补锚**：`isGuiBone` 自引入（3364c606f wine_fox 轮）起**零测试覆盖**——补
  `TestIsGuiBone`（13 例表驱动：精确/前缀/大小写/cubeCount>0 一票否决/baguette 不误杀）+
  `TestParseBedrockGeometry_SkipsGuiBones`（过滤保序 + `BoneCount==len(Bones)` 不变量）+
  `_OldFormatSkipsGuiBones`（新旧共享 buildModel 同口径）。TS 移植以这三条为权威锚。
- **修复**：`spec-builder.ts` 按 Go 结构同构重构——`parseNewFormat`/`parseOldFormat`/
  `buildModel`/`isGuiBone` 四段与 Go 一一对位（共享构建主体，非在旧函数里打补丁）。
- **TDD 战果（红→绿 10→59）**：新 3 块（A/B/C）12 例修前 10 红；变异验证 M1-M4 全被钉死
  （M1 覆盖式挪位、M2 无条件取首条、M3 删 GUI 过滤调用、M4 绕过 cubeCount 短路）。
  **M1 格外值得一提**：我实装时第一版就写成了覆盖式挪位（`keys[0]=keys[mi]; keys[mi]="geometry.model"`
  丢原首键），是本轮**补的「互换非挪位」用例当场抓住我自己的实现缺陷**——红测先于实现的价值实证。
- **行为变更说明**：网页预览从此不再显示无 cube 的 GUI 骨骼（GuiRoot/curtain/background* 等）——
  这是向桌面 Go 路径对齐，非新增限制。
- 深读判净（未开战）：`model-group-builder.ts` 骨骼合并/断链修复逻辑与 Go 对位（mergeCubes/
  computeBoneLocalPos 双源风险见轮 7 遗留 2，无新证据）；`ysm-object.ts` 分类/绑定索引同空间
  契约完好；`ysm-animation-player.ts` `mdApDispose` 的 `playing=true` 是「重置到初态」语义
  （初态即 playing，测试钉死），非缺陷。
- 验证：spec-builder 59 例绿；model 目录 6 文件 133 例；消费链（adapters/screenshot/mesh/decoder
  geometry）21 文件 314 例；`go test ./go/geometry` 绿；`go build ./...` 绿；typecheck /
  vite build / biome（--write 后）全绿。知识卡 `model3d.md` 新增不变量「geometry 输入选择链与
  Go parse.go 同构」。
- 遗留 / 下一轮建议：
  1. 下一轮按清单轮转取 **`screenshot`**（第 10 位）；`menu`（第 8 位）已有 preview-menu 卡 +
     大量专项测试，判**已覆盖**（本轮正式销账，台账补记）。
  2. 轮 7 遗留 2（mergeCubes / computeBoneLocalPos 同族 parity 候选）维持不动，无新证据。

## 2026-10-11T13:40:00+08:00 巡检第 10 轮：screenshot

- 选定理由：第 8 轮遗留建议（第 10 位；`menu` 已判覆盖销账）。4 源文件 / ~493 行，全部有同名测试（含 ADR-266-d1 光柱/输出设置镜像、S1 照度守恒专项）。
- **抓到 1 处真缺陷（已修）**：`screenshot-render.ts` 相机近/远裁剪面硬编码 `0.1/1000`——与预览 `camera-setup` 的「按包围盒收紧到 `maxDim*50`」深度纪律分叉：
  - 大模型远端裁切：`dist≈1.7×maxDim`，maxDim>588 时背侧最远点（≈`dist+maxDim`）越过 far=1000 → 静默裁切。
  - 深度精度：`0.1/1000` 对角色尺度只有约 10000:1，而预览 `maxDim*50` 收到 ~100:1——`camera-setup` 注释点名残留 far 正是 z-fighting/遮挡错乱的根因，截图侧不应重蹈。
- **修法（夹逼，不搬预览常量）**：`near = max(maxDim×0.05, 1e-4)`、`far = dist + maxDim×2`。**不搬 `camera-setup` 的 `near=0.05`**——它只因预览 `dist` 带 `+2` 地板才安全，截图 `dist=1.7×maxDim` 无地板，小模型（maxDim<~0.03）会整模型落入近平面之后。夹逼依据：几何落在 `[dist−maxDim, dist+maxDim]`。
- **fov 45（vs 预览 50）判为有意差异不动**：多角度导出是**缩略图**（跨模型固定取景），非「当前视角导出」（后者走 `screenshotFn` 用活跃渲染器与相机）；lights/toneMapping/exposure/outputColorSpace 已镜像（ADR-266-d1 D2），fov 刻意不镜像。已入 `export.md` 不变量。
- **测试（TDD 先红后绿）**：`screenshot-render.test.ts` 新 describe「相机近/远裁剪面自适应」1 例——不变量断言「任意尺度（2 / 0.01 / 500）远≥`dist+maxDim` 且 0<near<dist」；修前 far=1000 精确报 `expected 1000 to be 25000`（初版断言 `maxDim*50`，后改夹逼口径并加 dim=0.01 钉住「小模型不近裁」）。变异方向双向覆盖：far 回 1000 → maxDim=500 转红；near 回 0.05 → maxDim=0.01 转红。
- 深读判净（未开战）：`screenshot.ts` 透明背景三态还原（background/canvas size/clearColor）与 `getSize().x` 坑已注释钉死；`screenshot-lights.ts` 总闸 `isEnabled()` 门 + `isIblActive` 判据与预览共用同一纯函数；`screenshot-cone.ts` 复用预览 `VolumetricCone` 单源。
- 验证：screenshot 5 文件 52 例绿；preview-3d 全量绿；typecheck / vite build / biome / check-layering 全绿。`export.md` 不变量同步。
- 遗留 / 下一轮建议：
  1. 轮转清单已巡：const/infra/registry/…/materials/mesh/model/screenshot。**修正**：本建议原写「取 bone」系误读台账——`bone` 早在 2026-09-19 已巡（见本文件 §巡检记录 2026-09-19T15:44:07Z），台账明列 bone（2）已审。**下一轮真正取靶 = 未审首项 `shader-patches`**（未审 = shader-patches / state / texture，按轮转清单顺序）；或评估清单近尾后改向「族② parity 候选」。
  2. **族② parity 候选维持不动**：mergeCubes / computeBoneLocalPos（轮 7 遗留 2），无新证据不开战。

## 2026-10-11T13:55:00+08:00 追加：screenshot 域 F1/F2/F3（两会话同域并行合流点）

> 与上条「第 10 轮」是**两个会话在同域的并行动作**：他会话交夹逼修复（`251cfc5f3`）时
> 把我工作区的在途改动（F2 桩修复 + 判别力锁 + F1 阴影双向锁）一并卷入该提交，但 F1
> 声明条（export.md）与代码镜像注释未随行——**`251cfc5f3` 落盘瞬间 HEAD 自相矛盾**
> （声明锁测试断言的声明文本在 HEAD 不存在，纯 checkout 必红）。本补录交代三发现并交
> 一致性修复（export.md 条 + 镜像注释，随本块同提交复原一致性）。

- **F1 第四条 WYSIWYG 缝（阴影不参与多角度截图）——声明 + 双向锁**：预览默认
  `shadowEnabled=true`（schema 实证）→ ShadowCapability 给活跃 renderer 置 shadowMap +
  灯/mesh castShadow；离屏 `renderMultiAngle` 自建 renderer **零阴影接线** → 导出图无接触
  阴影、模型「浮起」。与已声明三条缝（背景层 / pass 层 / 环境贴图光照层）正交的第四层
  （阴影层），**此前静默无声明**。关键区别：IBL 有「PMREM 跨 context 不可共享」硬件借口，
  阴影没有——离屏重建技术可行，属未做的产品决策。处置对齐 IBL 先例：**不擅自实现**（改变
  截图画面内容须拍板），只声明（export.md 新条 + `screenshot-render.ts` 离屏 Scene 构造处
  镜像注释）+ 双向锁（test「阴影边界」两例：行为侧 shadowMap 未被启用、声明侧 export.md
  条在场，删其一即红）。最小实现路径已写入声明条尾（离屏 shadowMap.enabled + 灯 castShadow
  + mesh cast/receive，参数经 ScreenshotLights 扩展透传现值），立项时翻转行为锁并同步两条声明。
- **F2 测试桩形状失真（判别力隐身病）**：`FakeWebGLRenderer.getSize` 写 `v.width/v.height`，
  SUT 读 `.x/.y`——真 THREE.Vector2 有 width/height **别名访问器**（three 0.186.1 实证
  `get width => True`），生产无恙；但桩 FakeVec 是无别名手写类，SUT 恒读到 0 → multi-angle
  域的「尺寸比对 → setSize/复位」契约（正是 5d9d0e30e P1 修过的坑）**在测试里零判别力**。
  修桩（写 .x/.y）+ 新判别力锁用例；**变异实证**：桩回写缺陷态 → 恰该用例独红。
  **教训**：桩的形状必须忠实**被测面读取的访问路径**，不是生产类型的公开面——别名访问器
  在桩上不存在，契约就隐身。
- **F3 知识卡腐化**：export.md 灯光提取条写 `lightDirToPosition(d, 5)`（radius=5 对齐
  createDirectional）——现实现 radius = `cap.getTargetHeight()`（动态 `max(maxDim*0.8,6)`），
  与同卡 ADR-266-d1 条自相矛盾。更正为现值口径并留腐化标记。
- 判净（未开战）：`screenshot.ts` 状态三还原 + 透明双前提注释扎实（10 例直测）；
  `screenshot-lights.ts` 总闸门 + isIblActive 判据共用纯函数（P0 判别样本两例在场）；
  `screenshot-cone.ts` 单源复用 + 双门收口。他会话夹逼修复复核无异议（fake 相机构造默认参
  与 FakeVec 无 mulScalar 两处测试适配经推演正确）。
- 验证：screenshot 域 5 文件 **55 例绿**（含卷入的 F1×2 + F2 锁×1）；typecheck / biome 绿。
- 遗留 / 下一轮建议：
  1. **F1 阴影进截图 = 产品待拍板**（最小实现路径已入 export.md 条尾，拍板后立项翻转双向锁）。
  2. **并行合流教训入档**：声明锁类改动（测试断言文档文本）必须**测试与声明同一提交**，
     否则同域并行时被对方吞走测试半边即制造瞬时矛盾 HEAD。本仓 `--files` 白名单防「卷入
     他人」，防「被卷入」只能靠缩短在途窗口（写完即交）。
  3. 轮转下一位取他会话建议 `bone` 重访或清单尾部未审位（shader-patches / state / texture）。


## 2026-10-11T14:00:00+08:00 巡检第 11 轮：shader-patches

- 选定理由：修正第 10 轮「下一轮取 bone」的误读（bone 已于 2026-09-19 巡，见本文件 2026-09-19T15:44:07Z 条目）；台账未审 = shader-patches / state / texture，按轮转清单取首项 shader-patches。
- **判净（未开战）**：域内 3 文件 / ~319 行 + 三处调用方（sky/water/reflector）全部经 patch-guard 双件套（`assertRevisionRange` + `reportPatchIssue`），锚点失配不再静默：
  - `sky-patch.ts`（194 行）：`injectSkySunScalePatch` 四层幂等（声明 / 解耦① vSunE 缩放 / 解耦② 太阳盘）+ `showSunDisc` 锚点失配兜底（`gradient` 函数前插）+ 分字段半残修复（uniform 在但乘法缺 → 二次调用补全）。测试在 `sky-capability.test.ts:717-884`——**用真 `new Sky()`**，锚点对 three r186 真源验证（非合成字符串）：幂等 / 半残 / 锚点彻底失配 / 兜底 / `needsUpdate` 共 12 例。
  - `water-shader.ts`：`onBeforeCompile` 六锚点 + chunk include 替换，allowed 宽松 `[185,189]`——`L54-59` 刻意不对称失败哲学（REVISION 失配=前提崩塌→throw；锚点失配=局部漂移→warn 保现场），**勿「统一」收紧**。`water-capability.test.ts:2234`「不告警 = 五锚点全命中」钉住。
  - `reflector-capability.ts`：`injectOpacityIntoShader` + `assertRevisionRange` 提到构造期（`L52`），`reflector-capability.test.ts` 25KB 覆盖。
- **三处 allowed 列表已被测试钉住**：sky=`["186"]` / water=`[185-189]` / reflector=`["185","186"]`，与已装 three `^0.186.1`（REVISION 186）一致；water/reflector 经构造触发 `assertRevisionRange`，sky 经真 Sky 注入触发——**升级漂移会让对应测试转红**，不再是手抄死值。
- **grep 全 src 补丁位点：无绕过 patch-guard 的裸字符串锚点替换**——所有 `fragmentShader/vertexShader.replace` 都落在这三处域内，无散落兄弟。
- 遗留 / 下一轮：
  1. **自定义 shader 依赖 three chunk 集无版本守卫（域外候选，勿在本轮开战）**：`caps/light-cone.ts:79-80`（`<tonemapping_fragment>`/`<colorspace_fragment>`）、`caps/sun-beams.ts:44,74`（`<common>`）——它们是**自写 ShaderMaterial** 的 chunk include，非「对 three 官方 shader 的补丁」，不入 patch-guard 域；且 chunk 名消失 = three 打 Shader Error（**响**），非静默降级，优先级低。若要统一可另立「three chunk include 版本守卫」议题。
  2. **water allowed 乐观声明 187-189 未审计**——但对应 `L54-59` 刻意决策（不对称失败哲学），不视为缺陷。
  3. 轮转清单已巡至 shader-patches，未审剩 **`state` / `texture`**。下一轮取 **`state`**（有大量 incidental 提及但无专项审计报告）。


## 2026-10-11T14:20:00+08:00 巡检第 12 轮：state

- 选定理由：未审剩 state / texture，按轮转清单取 state（台账「大量 incidental 提及但无专项审计报告」）。域内 10 源文件 / ~2504 行 + 6 测试文件；近期提交密集治理（a8751377d envResolution 死键 / af392f7c5 sky 死参数显式标记 / ba5cbdc5c 值域钳制 / de3ce7cf7 ARCHIVE_ALIAS 派生 / 0ca845e3e applyModelPreset 契约），故先结合 `git log -- state` 定位「已治理 vs 残留」。
- **判净（未开战）**：逐项核证近 8 条 state 相关提交声称的修复与当前源码树一致，无残留：
  - **无幽灵键**：`check-env-schema-consumers` 绿（150 键全有生产消费）；envResolution 已删（`env-state-schema.ts:467-475` 详述删因与跨代微损）；sky 4 死参数（turbidity/rayleigh/mieCoefficient/mieDirectionalG）在 `:91-127` **显式标记 + range 防御**（唯一作用 = three Sky shader 默认 uniform），skyExposure `:150-153` 更正为「活跃但无 UI 出口」非死参数。
  - **写方覆盖（现有检测器盲区，我手工扫过）**：`check-env-schema-consumers` 只查「消费/提及」，不查写方——「有读无写」的潜伏死键它抓不到。机械扫描 `setEnvState({})`/`setStateValue()` 得 44 键无直接字面写，逐个追源：4 个 sky 死参数（文档化）+ skyExposure（仅程序化/测试写，文档化）+ **39 个 light 键经 `caps/light-persist.ts` 的 `FLATTEN_MAP`（`light-params|readLightParams` 派生，`persist:199` `setEnvState(acc, {source:"auto-model"})` 变量传参）写入**——非字面量所以正则漏掉，实为活键。**无真死键**。
  - **单一写入口 + 钳制单源**：`env-state.ts:114` `clampFieldValue`（ADR-283，enum 回退 default / 数值钳 range / undefined 短路）；各 cap 不自备 clamp（历史提交 ba5cbdc5c 已把 10 个原无 range 键上收）。
  - **派生谓词单源**：`isSsrRenderActive`（`env-state.ts:152`）/ `effectiveToneMappingExposure`（`:166`）收编跨 cap 手抄公式；`toModelType`（`model-defaults.ts:66`，Object.hasOwn 防原型链误判）。
  - **键派生无手抄清单**：`ARCHIVE_ALIAS` 仅 3 别名且 typed（`schema:990-999`，ADR-326）；`EnvState`/`EnvStateKey`/`getPresetKeys`/`deriveDefaultEnvState` 均派生自 schema。
  - **无跨通道双源**：Go 侧零 `envState` 引用（env 状态纯前端，经 cap saveState 落盘）。
  - **`getPresetKeys` 模块级 `_groupCache` 从不失效**：grep 确认无测试修改 `ENV_STATE_SCHEMA`（只读），schema 是运行时不可变 const，缓存安全（非缺陷）。
- 遗留 / 下一轮：
  1. **`check-env-schema-consumers` 只查读不查写**：本次我手工扫的「无直接写方」类缺陷是它盲区（light 键经 FLATTEN_MAP 变量传参即证正则法不可靠）。若要机器化，建议把写方检测做进该脚本（读 FLATTEN_MAP 派生写 + `setStateValue` + loadState 键轨），但写模式多态（变量/展开/派生），误报风险高——**列为候选，勿本轮做**。
  2. **`applyModelDefaults` 调用方是手写有序清单**（`shared-infra.ts:58-76`，sky→fog→shadow→reflector→environment + postProc 另路 `:367`）——非 registry 派生；但 `:50-56` 注释详述「实现序非依赖序、写互不相交、顺序可调」，且 shared-infra.test.ts「各调一次」契约锁兜底。属刻意设计，非缺陷。
  3. 轮转清单已巡至 state，未审剩 **`texture`**。下一轮取 `texture`（texture-loader / texture_cache / mmd-ktx2-basis 等，域较散）。
- 验证：无代码改动（纯巡检判净）；`check-env-schema-consumers` / `check-cap-enabled-duality` 均绿；`doctor --docs` 早前 23/23 PASS。


### 子代理复核（补充）

- 并行的写方扫描子代理返回，与我的机械扫描结论一致（44 键无直接字面写全部有解释），但**另提两件我判净的项**，辨析如下：
- **4 枚 sky 散射键（skyTurbidity/Rayleigh/MieCoefficient/MieDirectionalG）**——子代理主张「与 envResolution 同型、未同样收编常量」。**我保留判净**：envResolution 删键判据是「**零生产调用方**」（`setResolution` 仅测试调用）= 零读；这 4 键有**生产读方**（`sky-capability.ts:407-410` 作 shader 默认 uniform、`:195-202` applyUniform、`:598-601` params 导出），是「schema 作默认值单源 + cap 读」的合法只读默认模式，非真死键。且 `af392f7c5` 是**显式标记**决策（`:91-97` 自陈「若未来加 UI 出口须补 saveState + 移除 [G-sky] EXEMPT」），带重新评估触发条件。**若日后要收编**：爆炸半径不小（删 4 schema 条目 + 3 处 sky-capability 读点 + 若干测试，含 `env-state-schema.test.ts:128-131` 的 hgPhase 硬边界钳制用例——那是 ADR-283 对「若未来有写」的防御，删键即失守），且是设计取舍非 bug 修复——**列候选，拍板再动**。
- **`ground-capability.ts:685-686/715` restoreFields 读侧手抄 ~30 字段**（写侧 `:698` 已 `getPresetKeys("ground")` 派生）——**这条子代理说得对**，是 ADR-326 系在 ground 未彻底的真不对称（漏登记即「自动持久化、静默不还原」的经典风险）。非静默（`ground-capability.test.ts:1293` G-8 round-trip 契约锁兜住），故非缺陷；列为**下一轮候选**：让 restoreFields 走 `getPresetKeys("ground")` 派生读侧，与写侧对称。
- `ground-capability.ts:561/570` 双钳制冗余（显式 `clampFieldValue` 后 `setEnvState` 内部再 clamp）——钳制幂等、无害，仅写法不统一，**非缺陷**。
- 下一轮建议更新：**优先做 ground restoreFields 派生**（真不对称、有契约锁兜底、改动局部）；sky 4 键收编属设计拍板，等产品侧决定「是否可能加 UI 出口」。


## 2026-10-11T14:38:00+08:00 巡检第 13 轮：texture（轮转清单末格）

- 选定理由：未审剩 texture（域散：adapters/mmd / caps / decoder / infra / texture 五簇 9 源文件 / 约1231 行）。最近一条提交 cb1ce8d6d「纹理序手抄双源三处真实分叉全对齐 + 跨语言黄金语料对账守卫」刚落地，故先结合 git log -- texture 核证该根治是否真收口。
- **判净（未开战）**：
  - **跨语言纹理序 parity 是实守卫、非纸守卫**：cb1ce8d6d 声称「Go texture_order_parity_test.go + TS texture-order-parity.test.ts + 11 例 golden 语料」三件套。核证：golden 语料 tests/fixtures/parity/texture-order.golden.json（11 例）存在；Go 侧 internal/app/texture_order_parity_test.go 存在（初查只搜 go/ 与 tests/ 漏掉 internal/app/，扩搜全仓 .go 才命中——正反两侧都验过）；TS 侧 decoder/texture-order-parity.test.ts 存在。两侧实跑：go test ./internal/app/ -run TextureOrder ok、TS 44 例（含 11 parity）全绿。
  - **引用计数配对完整**：loadTextures/releaseTextureUrls 全部消费方平衡——ysm-model-preloader.ts:180-185 前置定义 releaseTextures 闭包（released 防重入守卫）+ :191/:221 catch 释放 + :275 随结果返回；ysm-adapter.ts 三处释放（:249 加载失败 / :609 dispose 路径 / :711 build 失败，:700-704 注释详述为何要补句柄独占的两件事）。无泄漏缺口。
  - **cache 层不双源**：Go texture_cache = 纹理文件磁盘缓存（cache-status/cache-clear 消费），TS textureCache = GPU Texture 实例池（texture-cache.ts acquire/release + LRU 归零淘汰 + disposeAll）——不同层、不同职责，非跨通道双源。
  - **texture-loader.ts 单源干净**：只用 textureCache、无 Go 侧逻辑；15s 悬挂超时 + loadError→invalidate→null（:36-39/:62/:82-87）；releaseTextureUrls 语义定案（:96-104：归零不 dispose、不去重、幂等安全、禁 tex.dispose()——僵尸条目让 LRU 永久失效）。
  - 剩余标注项均为**文档化技术债**：mmd-ktx2-basis.ts:4/11/59 CSP unsafe-eval（new Function 执行 UMD 文本，上严格 CSP 前须换 import()/ESM 形态）；:117 P3-9 审核结论（输出缓冲按 w*h*4 保守上限，记录暂不改）；texture-cache.ts:8 MMD/VRM 走 blob URL + 内置 Loader 暂不接池（ROI 低，estimateSceneTextureBytes 已覆盖全格式口径）。
- 遗留 / 下一轮：
  1. **轮转清单已巡完**（adapters/bone/caps/decoder/infra/materials/menu/mesh/model/screenshot/shader-patches/state/texture 全 13 格）。下一轮建议不再按域转单圈，改**专项**：优先 ground restoreFields 读侧派生（第 12 轮子代理发现，ADR-326 在 ground 未彻底的真不对称；待并行会话 ground 工作落地后再动，避免撞车）。
  2. CSP 债（mmd-ktx2-basis.ts new Function）是唯一需上游/基建配合的项，非本巡检能独立清——保留标记，勿开战。
  3. 第 12 轮遗留候选（check-env-schema-consumers 补写方检测、applyModelDefaults 手写有序清单）维持不动。
- 验证：无代码改动（纯巡检判净）；Go go test ./internal/app/ -run TextureOrder ok + TS texture 4 测试文件 44 例全绿；doctor --docs 早前 23/23 PASS。

## 2026-10-11T14:45:00+08:00 追加：shader-patches 域 F1/F2/F3（本会话第 11 轮补刀——他会话判净后同域实测出契约零锁缺口，开战）

- 背景：他会话 14:00 记第 11 轮 shader-patches **判净（未开战）**——对「守卫本体行为正确」成立；本会话同域实测发现三处「治理声明无机器锁/化石」缺口，对「契约有防」不成立。同域并行处置照第 9/10 轮教训：改动全落测试 + 注释防腐，不碰他会话在途文件；台账以追加记，不改他条。
- **F1 守卫接线契约零锁**：三消费者「REVISION 断言 ∈ 构造链」全靠注释背书（[锐评 P1-1] 曾把 reflector 断言从 apply 期提回构造期治 mount 崩——修复无回归锁，挪回去全套测试照绿）。锁 = patch-guard.test.ts「守卫接线契约」两例：①REVISION=199 失配态下 sky/water/reflector 直接 new 必抛（三家接线形态互异：直调 / 经 inject / 经 buildWave 材质链）；②端到端 createAll 失配态恰缺 patch 系三 cap、ground 等存活（water.md「throw → cap 缺失」不变量首次机器执法）。变异实证：断言挪回 inject 期（复刻病灶）→ 两例同时红（构造不抛 + reflector 竟存活），还原复绿。
- **F2 water 六锚点从未吃过真实管线文本 + 化石死行**：water 146 例全喂手写 fakeShader()（chunk 名近似的合成文本）——真文本漂移桩测不到。补 patch-guard.test.ts「六锚点 × 真实 three meshphysical」：取 `THREE.ShaderLib.physical` 原文（WebGLProgram 编译期 onBeforeCompile 收到的即此模板，与生产同源）喂守卫，双判据（无 water miss 告警 + 六注入逐一落地，防告警文案改字后判据独苗）。取数自纠错一例：首版凭记忆写 `ShaderLib.meshphysical`，探针实证真实键 `physical`——红的是取数不是锚点，先修取数再谈契约。变异实证：改坏 normal_fragment_maps 锚 → 真实管线锁独红且分检精确 `detail=miss`。另删 water-shader.ts 化石行 `replace("void main() {", "void main() {\n")`（纯插换行 no-op，可追 650051afd 引入即空壳残留，六锚点不查、零测试锁存在=可静删自证），原位留防腐注释。
- **F3 镜面 X-8 失配路径零回归锁**：[锐评 X-8]「锚点失配不得写 uOpacity（防『参数已设、渲染无 effect』静默假象）」落地后失配分支从未被任何测试执行。补 reflector-capability.test.ts「锚点失配路径」两例：临时破坏官方 `Reflector.ReflectorShader.fragmentShader` alpha 锚走通失配——**破坏前先断言 replace 真实改变文本**（防「破坏未遂→路径没走→断言空转假绿」，第 9 轮 F2 桩形状病的「测试自证」变体）；验分检告警（decl=ok alpha=miss）/ uniform 缺席 / setOpacity 不炸且不复活幽灵 uniform。变异实证：回退无条件写 → 两例独红（幽灵 uniform 现形），还原复绿。
- 知识卡同步：`water.md` patch-guard 条「四处注入检测」更正为六处（P1-2/ADR-297 各扩一锚卡未跟）+ 两把新锁指针；`preview-env-state.md` reflector 块补「锚点失配契约（X-8）」条。
- 方法教训：**「判净」的审计对象必须含「治理声明有没有机器锁」**——行为对 ≠ 契约有防；本轮三处全是「修好了没上锁」或「声明无执法」形态。
- 验证：patch-guard 10 + reflector 43 + water 146 + sky 111 = 310 例绿；typecheck / biome / vite build 全绿。


### 更正（第 13 轮补，推翻第 12 轮对子代理 finding #2 的采纳）

- 第 12 轮我把「ground restoreFields 读侧手抄」列为**下一轮候选（真不对称，ADR-326 未彻底）**。第 13 轮轮转巡完后专项核证，**该定性过重，须收回**：
- **read 侧不是键清单，而是行为表**：`ground-capability.ts:715-800` restoreFields 的每个字段各带专属 restorer——`groundVisible/gridVisible` 走公开 setter（`:721/:725`）、`groundSourceKind/MaterialPreset/CanvasStyle/Overlay` 走 `oneOf(...)` 白名单（`:727/:733/:736/:779`）、`groundMat*` 分两族（`setMatOpacity/Scale/Rotation/Roughness/Metalness/OverlaySize` 走 setter 且**必须显式传 RESTORE_SOURCE** 否则被冻成 manual，`:761-769`；`Color/Color2/GridSize/MicroNoise/EnvMapIntensity` 直接 setEnvState）、`enabled` **刻意排除**（`:716-718` 恒真值绕圈除根）。**这是每键行为，不可从 `getPresetKeys("ground")` 派生**——子代理「读侧走派生与写侧对称」的建议方向会丢掉 restorer 语义（setter vs setEnvState、oneOf、skipMiddleware、刻意排除），属**改坏**而非修复。
- **真正的风险（新 ground 键漏登记 restorer → 自动持久化静默不还原）已被 G-8 契约锁机器闸兜住**：`ground-capability.test.ts:1293`「[G-8] schema ground 键集全部可 save/load round-trip（还原表不得漏登记）」——遍历 `getPresetKeys("ground")`（`:1325`），每个 schema ground 键**必须有偏离值**（缺失即 `:1327-1330` 点名红，把加键动作逼回 loadState 登记）；且断言每个偏离值 `≠` 当前值（`:1334-1337`，「锁形同虚设」自失能防死）；save→reset→load 后逐键断言回到偏离值（`:1351-1355`）；`enabled` 断言不进存档（`:1347`）+ 构造默认 true 唯一真相源（`:1356`，防回填闸）。**实跑绿**（ground 81 例含 G-8，非跳过/空转）。
- **更正结论**：ground restoreFields 手抄是**合法行为表设计**（两族 restorer + oneOf + 刻意排除），其漂移风险由 G-8 契约锁兜底——**升格为「非缺陷 + 已有机器闸」，移出候选**。与 sky 4 键同属「形式不对称但已有闸，且不可简单对称化」。
- 由此，第 12 轮遗留候选只剩：`check-env-schema-consumers` 补写方检测（写模式多态误报高，维持不动）、`applyModelDefaults` 手写有序清单（契约锁兜底，维持不动）。


## 2026-10-11T15:30:00+08:00 追加：近期修复批次「根治性」审计回补（10-10/11 两批 ~33 提交）

> 对 2026-10-10/11 的 preview-3d / tags·app / gates·CI 三族修复提交做「是否根治」审计（判据 = 结构根因 + 机器闸实测 + 族收敛；三族并行子代理调研 + 主代理抽查 + 变异抽测）。**总判定：整体根治**——11 项 preview-3d fix 与 9/11 项 tags·app fix 全部落在结构根因、机器闸实测绿（doctor 全量 68/69，唯一 FAIL 为 28 天窗口内存量债 check-design-tokens）。本条只登记审计新抓到的**未登记缺口**与**注释腐化**（顺手已修，同提交），不重复各轮已留痕内容。

- **G-geometry（未登记缺口·中低危）→ 已建（2026-10-11 当日收口）**：~~`spec-builder.ts|parseBedrockGeometry` ↔ Go `geometry/parse.go` 条目**选择链**（旧格式回退/跳空壳/GUI 过滤）无跨语言黄金语料~~ → 补建 `tests/fixtures/parity/geometry-select.golden.json`（13 例：new 格式单条/多条目 first-wins/跳空壳/全空拒绝/单条无骨宽容 + old 格式规范键互换/空壳 swap 钉死/纯字典序/非对象值 skip/两段回退 + GUI 过滤/一票否决 + 纹理钳制 0→spec 层 64 兜底）；主源 = Go `TestGeometrySelectParity`（regen 沿 `YSM_PARITY_REGEN=1` 先例，**骨架经 threejs.BuildMulti 落 spec 层提取**——模型层 texW=0 哨兵与 spec 层 0→64 兜底跨层对账必假分叉，首轮即实证此坑）；TS 消费侧 `model/geometry-select-parity.test.ts` 走生产入口 buildSpecFromGeometryJSON（14 例绿）。变异实证：TS 互换→覆盖挪位（历史 M1 形态）被 old-model-empty-swap-pins 独红、Go 摘互换块被 old-canonical-swap 独红（texW 4≠10）。机制归属见知识卡 `go-ts-golden.md`。
- **注释腐化两处（已顺手更正，本条同提交）**：① `cube-mesh-parity.test.ts` 头注仍写「全浮点 1e-12 相对容差 + 精确假设被证伪」——系建语料初期（aaa3ac8b6）中间态口径；c40c93040 对齐 South 结合序后已恢复逐位精确（仅 localRotation 1e-9），头注与测体/语料 $semantics/提交说明四向矛盾，已更正；② `texture-order.ts` 头注引用不存在的 `tests/test_texture_order_parity.ts`（真守卫 = Go TestTextureOrderParity + `decoder/texture-order-parity.test.ts` 双端共享 golden），已更正。
- **Go 侧未登记缺口（已登记知识卡；G1/G2/G3 当日已修）**：~~G1 回收站删除半侧未接 PruneKeys~~、~~G2 启动扁平→分组迁移 `migrateFlatStorageToGrouped` 不走 RelocateKeys~~ → **已修（2026-10-11，`internal/app`）**：① 迁移函数现返回成功 (旧,新) 路径对，启动经 `migrateAndRekey` 唯一入口逐对 RelocateKeys（subtree 删旧键，`app_migrate_rekey_test.go` 3 例含幂等空转）；② 回收站**永久**删除（`DeleteFromRecycle`/`EmptyRecycleBin`）经 `recycleOriginal`/`recycleOriginals` 由条目 rel 反推原始路径 PruneKeys（`app_recycle_tags_test.go` 4 例，M1/M2 变异实证）；移入回收站（Move/dedup 移入）刻意不 prune（临时态、Restore 自愈，prune 反丢标签）；dedup 侧核清：`RemoveRepoDuplicates` 删的是整合包侧副本（仓库原件保留，不孤儿标签键），无缺口。~~G3 六文件 ~24 处裸 t.Fatal（ADR-202 刀5 增量债）~~ → **已收口（2026-10-11）**：go/ 侧 5 文件 + 根 `internal/app` 8 文件全部改走 testutil 断言（新增测试行为走 `internal/testutil` 桥 + go 侧转发层），以 `47f9ccd83` 为 base 重跑 `check-go-diff-coverage` 转绿；详见 `go-testutil.md`。
- **治理层残留候选（下一批次，未动手）**：① bindings 漂移 commit 时点无同步机制（仅 CI 时点 fail-closed 兜底，已两次复发 a43533009/a97f32c9d——建议 pre-push 轻量档或 prepare-commit-msg 提示 regenerate）；② `tsc -p scripts` 不在 commit/pre-push 门禁（`scripts/_lib` 未类型化新代码可溜过，b869a753c 自认缺口至今在）；~~③ vitest 阻断步仍 `| Out-String -Width 200`~~ **→ 已修（2026-10-11 `03b15e5e3`，与 go test 步同坑同法）**；④ write-surface-gate 方法值链盲区（r.Restore/r.Delete/h.Import 类——已登记诚实边界，换汇聚点即失防，无提醒机制）。
- 验证：审计全程只读（调研子代理未改码）；变异抽测（write-surface-gate 空转/僵尸豁免两方向）转红后已还原、git status 干净；本条更正的两注释文件 typecheck / vite build 绿 + cube-mesh-parity 23 例实测绿。


## 2026-10-11T15:52:00+08:00 巡检第 14 轮（专项）：治理声明↔机器锁全仓对账 → 假声明制度化清剿（新闸 check-stale-test-refs）

- 选定理由：13 格轮转巡完，取 tracker 共识「改专项」；且第 11 轮方法教训（判净必须含「治理声明有没有机器锁」）只在本域人工执行过——本轮把它**升为全仓机械对账**。并行会话 15:30 批次审计独立抓到同族两处（texture-order.ts 头注引用不存在的测试、cube-mesh 注释口径腐化），证家族性非偶发。
- **对账法**：非测试源文件（frontend/src、go、internal、scripts）注释行点名的测试引用逐一验存在——Go `TestXxx` 符号对全仓 `func TestX(` 索引（2919 函数）、TS `x.test.ts` 文件名对全仓测试文件集（479 文件）。豁免面（防误伤合法虚构）：代码行不判（字符串字面量喂被测函数合法）、通配/片段（`*.parity.test.ts`）不判、示例名启发式（x/foo/fake-*/_r6——仓内真实测试无一采用）、数据值形态（引号紧邻 "TestModel"、XML 串）不判、行内 `claim-check:ignore: <理由>`（空理由不豁免）。
- **命中 7 处假声明（全清）**：`findinst.go:70` 点名 TestFindInstDir_ResourcepackZipKept——真身早已改造为 `_NoFallback` 且测试注释自陈此事，生产注释留在旧名；`flow.go:268` 点名 SessionRootNoWriteThrough 哨兵——该用例已随写穿机制类型层消失而**撤除**（非改名），注释改为写实；menu 域根迁移旧名 ×2（preview-menu-health/items.test.ts → engine/health|items.test.ts）、style `ui-` 前缀旧名 ×2（现名无 ui- 前缀）、fake-image 来历点名 model3d-loader.test.ts（已随 ADR-270-d5 消亡）→ 改为指认两名现役消费者。**改名后不跟的注释 = 谎称存在一条并不存在的机器防线**，是「注释承诺 > 实现」漂移的镜像形态。
- **长治 = 立闸而非手改**（与 check-env-schema-consumers / check-cap-enabled-duality 先例同法：一次性人工扫描抓到的病族必须留工具）：新增 `scripts/check-stale-test-refs.ts`（纯函数 scanText/scanAll/buildIndex + CLI + _summary 契约）；接 `gate-config.ts` ALL 清单 debt 档（0 命中纯防御）；三表登记齐（CONTRACT_TEST_DOMAINS + TARGETS + test_gate_policy_baseline 期望分层——**双表一致性守卫 test_contract_tables_consistency 强制**）；契约测试 `tests/test_check_stale_test_refs.ts` 9 例（合成索引直测各判据面 + 全仓自检 0 命中哨）。
- 契约测试抓到纯函数层真漏洞：`_test.go` 直喂 scanText 照样判（排除只做在 scanAll 层）——修在函数本体（**域守卫必须住进被保护的函数，不住调用方**）。
- 变异实证：注入假名 TestFindInstDir_PhantomMutantLock → 闸红（点名报行位）+ 契约自检红（0 命中哨破）；还原复绿、diff 干净。
- 知识卡：`gate-chain-map.md` 补挂条（体例沿 check-scene-slot-writers 行）。
- 副产物（对账过程发现，非本轮开战项）：`vitest-env-switch.ts` 清单含两条死路（parsers/voxel-parse.test.ts、features/dnd-collector.test.ts——脚本 SKIP 打印、无害但清单腐化）；docs/adr 与 archive 的陈旧测试名引用属历史快照豁免（元规则：ADR 背景 = 决策时状态，不改）。
- 验证：go build ./... 绿；go test registry/cli 两包绿；4 表联动契约测试全绿；biome 全绿；闸全仓 0 命中。

## 2026-10-11T19:10:00+08:00 追加：治理层残留候选收口（15:30 审计批第①/②项）

- 选定理由：15:30 批次审计登记的三项治理层残留候选（① bindings 漂移 commit 时点无同步 / ② `tsc -p scripts` 不在 commit/pre-push 门禁 / ③ write-surface-gate 方法值链盲区）本轮收前两项；③ 维持登记（诚实边界，换汇聚点即失防，无提醒机制——留档）。
- **② scripts typecheck 补挂 push/files 模式**（审计候选②，**确认为真缺口**）：`schedule.ts|runScriptsTypecheck` 此前只在 `--all`/`--docs`/`--static` 跑，push 与 --files（commit-with-check）路径对 `scripts/_lib` 未类型化新代码零拦截（仅 CI `--static` 兜底，等红了才修——与 bindings 漂移同病）。成本实测 1.06s，秒级承诺内。修法 = 增 `testsDomain` 开关：push/files 模式 `plan.contractTests`（变更域含 scripts/ 或 tests/）时补跑；纯前端/纯 Go 推送不背固定税（按域裁剪哲学）。TDD：契约测试 2 例（testsDomain 补跑 rc=0 PASS / rc=1 阻断）先红后绿；**变异验证**（摘掉开关）精确转红。files 模式实测：scripts 域变更 → tsc 项真实出现（PASS 23/23）；纯前端变更 → 无 tsc 项（54/54，不误伤）。
- **① bindings 漂移 commit 时点提示**（审计候选①，**两次复发 a43533009/a97f32c9d 均为此形态**）：Go 侧改绑定面（含只改 JSDoc 注释）→ bindings 生成物未同步提交 → CI「绑定保鲜」测试红了才补。`wails3 generate bindings` 实测 82.6s 且依赖 registry——精确对账超秒级承诺，正解 = prepare-commit-msg **非阻断提示**（审计建议原话）。新增 `hooks/bindings-sync-hint.ts`：staged 含 `internal/app/` 非测试 .go（binding-check.ts 同款扫描面）且未带 `frontend/bindings/` 生成物 → stderr 提醒 regenerate；恒 exit 0、逃生阀 `YSM_SKIP_BINDINGS_HINT=1`。契约测试 9 例钉判定口径/边界（go/ CLI 不误报、_test.go 不算、同 commit 带产物不提示、反斜杠归一）。接线：`.githooks/prepare-commit-msg` 增第四提示（卡内 ×3→×4）。
- **踩坑实录（node 原生 TS 解析器）**：hint 脚本头注释写 `internal/app/**/*.go` glob——注释内 `**/` 的末两字符恰是 `*/`，node 的 TS 扫描器把块注释提前闭合，后续代码全当表达式（ERR_INVALID_TYPESCRIPT_SYNTAX）。改注释为「internal/app 下非测试 .go」规避。教训：**脚本注释里的 glob 写法要避开 `**/` 序列**（同类已知坑：shared-styles.md 记的 CSS 注释 `*/` 提前闭合）。
- 验证：契约 140/140（含双表一致性守卫 DOMAINS 140/TARGETS 114）；scripts tsc 1.0s 绿；doctor --docs 全绿（knowledge-drift errors=0）；biome 行级无新增违规；README 索引闸过（check-readme-index）。
- 提交：`489e7e72b`（10 文件，245+/6-）。
- 遗留 / 下一轮建议：
  1. 治理层残留候选③（write-surface-gate 方法值链盲区）维持不动——已登记诚实边界。
  2. 第 12 轮遗留候选（check-env-schema-consumers 补写方检测、applyModelDefaults 手写有序清单）维持不动。
  3. **可回访点（本轮副产物）**：`hooks/bindings-sync-hint.ts` 的判定是「staged 形态」启发式（改绑定面但产物同 commit 则不提示）。若日后想升精确对账，成本 = wails3 generate（~80s+）只适合挂 CI 或夜间任务，不适合 commit 时点——维持现状。
