# preview-3d 巡检追踪器

> 由「preview-3d 巡检」自动化维护。每轮追加一条巡检记录，不覆盖历史。
> 跨轮记忆只认本文件（自动化每轮新开对话，读不到上一轮对话）。

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
- 提交：见下方 hash（本地，未推送）。
- 遗留 / 下一轮建议：
  1. `mmd-pmx-convert.ts` 的 `pmxObjectToResponse` 是**唯一导出且无测试**的权威 PMX→response 转换层（worker 内跑），字段映射密集（bone 索引宽度、SDEF 近似、morph 分型、flag 位）。建议下一专项补一轮构造 PmxObject 夹具的单测——本轮判为工作量偏大（需喂完整 PmxObject），未纳入「一个小改善点」。
  2. `concurrentMap` 的 `chunkSize <= 0` 会死循环，但当前两处调用方均传硬编码 4 / 走默认值，**不可达** → 依「不为不可能场景加防御」原则未加守卫，仅记录备查。
  3. 下一轮按清单轮转取 `bone`（adapters 已巡检）。
