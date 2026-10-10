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
> 现状：adapters（第1轮）/ bone（第2轮）/ caps（专项覆盖）/ **decoder（第3轮）** 已审；
> 未审 = infra / materials / menu / mesh / model / screenshot / shader-patches / state / texture
> （其中 menu/state 有大量 incidental 提及，但无专项审计报告）。

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
  3. **值得单独立项的漂移风险**：`decoder/texture-order.ts` 与 Go `internal/app/texture_order.go` 是**手抄双实现**，口径对称但只有人工纪律注释（`texture-order.ts:2`「改口径务必同步两侧」）而无自动一致性守卫。若要动这块，值得补一条跨语言契约测试。
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
  - 新增测试：`postproc-cost-probe.gpu-timer.test.ts`（6 例，query 创建/删除配对）、`scene-registry-focus.test.ts`（5 例，焦点晋升语义）
- 验证结果：`vitest run infra/` **绿**（33 文件 / 381 例，32→33）；`typecheck` **绿**；`check-biome --files` **绿**。query 修复变异验证 3 例转红。
- 提交：`6e028556d`。
- 遗留 / 下一轮建议：
  1. 下一轮按清单轮转取 **`materials`**（第 6 位；`infra` 已巡）。实测该目录为 `frontend/src/preview-3d/materials/`（**仅此一个**，5 个非测试源文件；先前一次 `Test-Path` 探测曾误报 `material` 单数并存，经复核为无——特此更正，勿再据误报改名）。
  2. **本轮未覆盖**：`render-budget.ts`（127）/ `gpu-load-calibrate.ts`（173）/ `frustum-cull.ts`（192）/ `input-and-animation.ts`（218）只读了接口面，未逐行审其中数学与边界；`load-trace.ts` / `keymap.ts` / `texture-bytes.ts` / `schema-registry.ts` 未读。建议下轮若回访 infra，从 `gpu-load-calibrate` 的标定量与其消费点一致性入手。
  3. **子代理失效备查**：35 文件全量委派**未产出报告**——大范围委派宜拆成 2~3 个小批次并给明确文件清单，避免单一子代理超时后全轮无产出（本轮靠主代理自读兜住，未损失结论）。
