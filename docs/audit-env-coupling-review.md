# 3D 预览环境域耦合锐评（2026-10-08）

> **审计对象**：`frontend/src/preview-3d/state/`（envState 统一状态层）× `caps/`（10 cap 能力层）× 截图/菜单/持久化接线。
> **方法**：3 子代理串行（① 现状耦合面盘点 → ② git 提交考古三账 → ③ 文档对账 + 定级），主模型逐条抽查 8 处实证；
> 结论逐条给「文件 + 符号 / commit hash」取证，不照抄 ADR 自述。
> **基线**（收敛时实测）：`src/preview-3d/caps` + `src/preview-3d/screenshot` 域 41 文件 / 1260 用例全绿；
> `vite build` + `tsc --noEmit` + `check-biome`（点名文件）全绿。
> **与既有锐评的关系**：本域病历见知识卡 `preview-env-state.md`（ADR-196/250/292/293 全链）；
> 姊妹审计 `docs/audit-postprocessing-critique.md`（2026-10-04，后处理域）。
> **本报告只记存量问题与本轮新发现，不重复历史结论。**

## 处置状态（2026-10-08 收敛核对）

| 条目 | 状态 | 说明 / 现源码锚点 |
|---|---|---|
| P1-0 water 恢复来源纪律漏网 | ✅ 已修 | `water-persist.ts\|restoreWaterSchemaKeys` + `RESTORE_SOURCE`/`writeOpts`（ground 范式）；12 setter 接 `WriteOpts`；water.loadState 批量/委托/迁移三站点全传 RESTORE_SOURCE。回归锁 = `water-capability.test.ts`「恢复路径来源纪律（锐评 P1-0）」4 例 + `water-persist.test.ts` 4 例；**变异实证**：批量路径 source 回 manual → 4 例转红（含 P1-4 既有迁移例连带转红——迁移站点的来源纪律被既有测试偶然锁死，判别力超预期） |
| P3-1 restoreBySchema 共享工具暗特化 | ✅ 已修（与 P1-0 同刀） | 下沉 `water-persist.ts`（先例 = light-persist.ts 数据面下沉）；`scene-capability.ts` 回归「接口 + localStorage IO」本分；`persist-utils.ts` 头注同步 |
| P1-1 截图 IBL 贴图不镜像（未声明 WYSIWYG 缝） | ✅ 已声明 + 锁边界 | 声明 = 本文件「IBL 反射不参与截图」已知差异条 + `screenshot-render.ts` 离屏 Scene 构造处注释（互为镜像）；双向锁 = `screenshot-render.test.ts`「IBL 边界」两例（行为侧离屏 Scene 无 environment 写入 + 声明侧 export.md 条目在场）。「IBL 进截图」= 产品需求，立项须离屏 PMREM 重建 + 另立 ADR，届时翻转双向锁 |
| P2-1 tone 释放路径非对称 | 📝 记录，非待修 | `sky-capability.ts\|releaseTone` 盲还原 prev（静态引用计数只护 sky 自贡献）vs `postprocessing-capability.ts\|restoreOutputSettings` 逐字段归属判定——纪律单边。今日 pp 受 skyOwns 门控（`postprocessing-capability.ts\|587`）无第三写者、无现症；修法（releaseTone 复用 pp 逐字段判据）排期 |
| P2-2 新 cap 存档契约锁缺跨 cap 机器闸 | 📝 记录，非待修 | P1-5 键轨锁仅 env/water/ground；sky/reflector 双轨键形无锁；新 cap 可无锁出厂 =「自动持久化、静默不还原」零报错洞。拟 `caps/persist-roundtrip-contract.test.ts` meta 闸（枚举 registry cap id × round-trip case 存在性，基线只减不增）挂 commit-with-check/CI vitest 步（**勿挂 pre-push 轻量档**） |
| P2-3 会话字段 dispose 复位缺跨 cap 机器闸 | 📝 记录，非待修 | 不变量（卡「会话级字段必须在 dispose() 复位」）5 持有者全闭，靠人工 grep；`createAll` 三引用全等复用短路不 dispose ⇒ 新 cap 漏复位 = 模型默认永久失效且零报错。拟 `cap-dispose-reset-contract.test.ts` 同 P2-2 体例 |
| P2-6 归还判定 sky 停用期错归 | ⚠️ 活挂账 | 需 sky 停用 + 残留写入真实时序，`audit-postprocessing-critique.md` L28 原样保留 |
| ground 僵尸私有门 | 📝 惰性挂账 | `ground-capability.ts\|this.enabled`（默认 true、registry 不传）参与 6 处合取但零 UI 写口——无可见缺陷，「暂不动」；若 `groundVisible` 默认翻转须同步收口 |
| P3-2 StatePath 双模块同名符号陷阱 | 📝 记录 | 生产消费 `preview-state.ts` 版 `getStateValue/setStateValue`（settings/perf-presets），`env-state.ts` 版死导出仅测试消费——误 import 静默换通道；拟删 env-state 版或头注标 test-only |
| P3-3 architecture.md §7.3「8 个能力」表缺 water/renderMode | 📝 记录 | 真漂移（活过 `9802c9ae5` 去漂移审计）；补两行至 10 cap |
| #8 import 副作用中间件 / #13 SSR 双态 / #19 预设回退缓存 / #9/#10 双轨键形跨槽 legacy | ✅ 审过不立案 | 有文档设计态（进程级「手改即 custom」/ ADR-247 D2 / per-mount WeakMap / 零迁移立法接受态），见①盘点表 |

## 一、总判

**env 域是全仓治过最狠的域——当前风险不在「治得慢」，在「扫不全」。**

- 状态层已是硬单门：写唯一入口 `setEnvState`（来源仲裁 + 值域钳制 + 中间件）、派发唯一出口
  `dispatchEnvChange`（生产调用点仅 env-state.ts:124，无裸 emit）、cap 按 group 前置过滤订阅。
  三大历史病灶全治根：「IBL 装载权双主」→ `envShouldYieldSlot`/`envOwnsSceneEnvironment` 零依赖纯函数
  （`44b9bd4d7` 手抄 4 处归零）；「让位判据双源」→ `isIblActive` 单事实源（`daed7ed0d`）；
  「私有门 vs schema 键各说各话」→ F-1 六度收口（`88926c810`）。
- ②考古：7 病型 5 型治到根；复发间隔 **3 周 → 4 天 → 同日** 压缩，两次复发同根 =
  **单点治愈漏第二消费点**（X-3 修预览漏截图；F-1「找双键」扫描漏 env「单键缺失」形态）。
- 本轮新病仅 1 条（P1-0 water 漏网——治过七遍的病型最后一个网眼）+ 1 条未声明缝（P1-1）
  + 2 条机器闸缺口（P2-2/P2-3）。无 ❌ 级恶意耦合。

## 二、本轮新发现（P1-0 四段式）

- **病症**：water 是 09-22 来源纪律立法「恢复一律 auto-model」的**第八个漏网 cap**——
  ① 批量路径 `restoreBySchema`（原 scene-capability.ts:259/267）硬编码 `source:"manual"`；
  ② setter 委托站点（restoreFields spec → 12 个公开 setter，体内 `{source:"manual"}` 无 opts 形参）；
  ③ 迁移/兜底站点（`migrateLegacyWaterLevel` 落地 + ADR-257 中池位兜底的 `setLevel` 无参调用）。
  注释化石佐证：原 L239「与 loadState 其余恢复分支同口径」——该判词在立法后已过期（其余分支早已 auto-model）。
- **触发**：今日零症状（`MODEL_DEFAULTS`/`ATMOSPHERE_PRESETS` grep 实证零 water 键）；
  触发条件 = 任一预设表首次携 water 键（如「夜 = 深池低浪」氛围设计）⇒ 存档 stamped manual 永久冻结
  ⇒「切氛围水面不跟改」（`13c0a13df` L-1 同症状）。
- **现源码锚点**：`water-persist.ts|restoreWaterSchemaKeys`（RESTORE_SOURCE + skipMiddleware）、
  `water-capability.ts|setLevel`（WriteOpts 形参）、loadState 三站点传 RESTORE_SOURCE；
  锁 = `water-capability.test.ts`「恢复路径来源纪律（锐评 P1-0）」+ `water-persist.test.ts`。
- ⚠️ **元教训 —— 立法没有机器闸 = 口头法**：逐 cap 回归锁扫的是「cap 内的恢复字段」，
  不扫「调用点委托到的 helper 的 source 形参形态」——helper 无 source 形参 = 立法无法抵达该路径。
  对任一来源纪律立法，审计面 = 调用点 ∪ 委托 helper 的形参形态（病型泛化判据）。
  同族缺口（P2-2/P2-3）须 meta 闸补：一 cap 一契约锁、一 cap 一 dispose 复位，跨 cap 枚举执法。

## 三、方法论台账（并入卡 pitfalls）

1. **单点治愈必须带第二消费点**：修任何病型先 grep 该病型全部消费点（预览/截图/菜单/持久化四路），修一处 = 修一类。
2. **判据是闸、算式是闸，只收算式是半截治理**（卡 L178 不变量）——`attenuateAmbientForSky` 单源守住算式、判据手抄 4 处漏掉的病史。
3. **mock 被测判据 = 把病灶藏进测试**：只桩被查对象（registry.getById），勿仿写判据消费的谓词（sky 桩 `isSkySourced` 仿写案 + screenshot-lights P0 案，两度实证）。
4. **并行会话时序幻象**：报「文档漂移」P3 前先 `git status` + 看最近提交——本报告起草期两次读到的「卡文滞后」实为 18:12 提交 `e71cfc013` 落地前的旧态（②③各撤回主模型 2 条 P3，全部成立）。

## 四、历史提交谱系（②三账摘录）

ADR-292 批次 `19d42b235→10f0db9f9→b71aa0979→ce0ec8090→e84c04b36`；
`8551bf0d6`（跨槽解耦）+ `b04d72028`/`948a5958b`（顺序契约地基锁）；
`8609680f6`/`5377c34ec`（常量双源→单源）；`88926c810`（F-1 四度）+ `adf6311c4`（上帝文件拆轴）+ `76406dc80`（中间件 unregister/挂起事务化）；
`56300e506`（X-3）→ `daed7ed0d`（P0）→ `44b9bd4d7`（D10 纯函数）→ `b0c5f4268`（P1-4）→ `e71cfc013`（陷阱名改名）。
时间线：09-07 单日 13+ 提交成型 ADR-196、09-22 单日 5 提交 F-1 四 cap、10-04 单日 10+ 提交——治理带宽充足，瓶颈在判据盲区而非速度。
