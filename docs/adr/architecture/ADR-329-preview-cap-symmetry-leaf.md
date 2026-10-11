# ADR-329：3D 预览巨型 cap 对称叶化（sky/light/postprocessing 拆分）

- **状态**：🔄 部分采纳（pp/light 两刀已落地；sky 一刀待续——实施进度查知识卡 `preview-env-state.md`）
- **日期**：2026-10-11
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **准入理由**：三个最复杂 SceneCapability（sky 920+/light 952/pp 951 行）未按 environment 先例对称叶化，880+ 行单类持续耗治理预算；拆分方向难逆转、跨 caps/menu/persist 影响面
- **相关**：`frontend/src/preview-3d/caps/sky-capability.ts | frontend/src/preview-3d/caps/light-capability.ts | frontend/src/preview-3d/caps/postprocessing-capability.ts | docs/knowledge/preview-env-state.md | docs/knowledge/model3d.md | docs/archive/frontend-design-critique.md`

---

## 1. 背景（Context）

<!-- ⚠️ 本节是「决策当时」的状态快照，ADR 落地后此处的病灶可能已治愈；评估「现在是否还这样」以当前源码树 + 知识卡实施进度为准，勿把本节当现状。 -->

10 个 SceneCapability 中 environment 已于 ADR-091-d1 完成叶化：`EnvHdrCache`（`caps/env-hdr-cache.ts`，custom HDR 生命周期容器）+ `EnvIbl`（`caps/env-ibl.ts`，PMREM 预滤波 / 三通路取图 / 背景槽管理），cap 本体退化为「状态字段 + 构造器接线 + 持久化 + setter 群 + getMenuNodes + apply/dispose 委托」的薄适配器壳（实测拆后 590 行，见 `preview-env-state.md` 卡）。测试注入点随迁 `hdrOf(cap)` / `iblOf(cap)`（TS private 运行时即普通属性）。

其余三巨头**未做对称叶化**（2026-10-11 行数实测）：

| Cap | 行数 | 大件构成 | 与 env 参照的差距 |
|---|---|---|---|
| `sky-capability.ts` | 920+ | 烘焙/IBL 管线（`ensurePMREM`/`bakeEnvironment`/`regenerateEnvironment`/`clearEnvironment`/`requestEnvironmentRefresh`/`maybeRegenerateEnvironment` ≈120 行，连同 sky 的 `requestEnvironmentRefresh` D10 路由器判据）+ tone 管理（`applyExposure`/`releaseTone`）+ 12 个 setter + 菜单/持久化 | 烘焙管线正是 env-ibl 拆走的那类职责；sky 侧仅有 `sky-asset`/`sky-sun`/`sun-beams` 素材叶，管线仍在 cap 内 |
| `light-capability.ts` | 952 | light 实例/helper 生命周期（`createLight`/`applyLightParams`/`mountLight`/`disposeLight`/`syncHelper`/`mountHelper`/`rebuildConeIfNeeded` ≈180 行）+ 20 个 setter + 菜单/持久化；参数读取已是纯函数（`readLightParams`/`readVolParams`/`getParamsFromEnvState`）但实例管理仍在类内 | 参数面已叶化（`light-params`/`light-persist`），实例/helper 生命周期面未叶化 |
| `postprocessing-capability.ts` | 951 | **composer 管线一整块**（`createComposerBase`/`attachSSAOPass`/`attachSSRAndBloomPasses`/`applySSRModeToPass`/`buildComposer`/`disposeComposer`/`applyToneMapping`/`restoreOutputSettings`/`syncBloomPass`/`syncSSAOPass`/`syncSSRPass`/`render`/`setSize`/`setPixelRatio` ≈230 行）+ **32 个 setter** + 菜单/持久化 | 管线高内聚、仅依赖 renderer/scene/camera 与 caps 查询器，与 setter/菜单/persist 几乎零耦合——拆分 ROI 最高、风险最低 |

共享病灶：**「菜单叶存在但 cap 内 setter 仍在」**——`sky-menu`/`light-menu`/`postprocessing-menu` 均已存在（10-09 锐评已注），但 setter 群 + `getMenuNodes` 仍堆在 cap 类内，拆分只做了产物没做主体。

## 2. 决策（Decision）

分三刀按「env-ibl/env-hdr-cache」已验证范式对称叶化，**按 ROI 排序、逐刀独立提交**：

### 刀①（首选）：pp composer 管线下沉 `caps/postprocessing-composer.ts`

- 新叶 `PostprocessingComposer` 类收编：`createComposerBase` / `attachSSAOPass` / `attachSSRAndBloomPasses` / `applySSRModeToPass` / `buildComposer` / `disposeComposer` / `applyToneMapping` / `restoreOutputSettings` / `syncBloomPass` / `syncSSAOPass` / `syncSSRPass` / `render` / `setSize` / `setPixelRatio`——**构造注入**（renderer/scene/camera + caps 查询器 `getTypedCap` 现场取，ADR-168 范式），持有 composer/pass 字段，与 cap 状态解耦。
- cap 保留：enabled 门、`applyEnabledSideEffects`、`applyReflectorSync`（跨 cap 联动）、32 个 setter 薄壳（`setEnvState({ppXxx:v},{source:'manual'})`）、`getMenuNodes`、`saveState`/`loadState`、`apply`/`dispose` 委托。
- 测试注入点：`composerOf(cap)` 取管线实例（对齐 `hdrOf`/`iblOf` 白盒范式）。
- 守卫：pp 测试既有 133+ 处 composer/SSR/Bloom 断言全量保留；变异验证「管线被 cap 直持 vs 叶持有」行为等价。

### 刀②：light 实例/helper 生命周期下沉

- `createLight` / `applyLightParams` / `mountLight` / `disposeLight` / `syncHelper` / `mountHelper` / `rebuildConeIfNeeded` / `getSpotDir` 下沉（继续复用 `light-params` 纯函数读取；新增叶与 `light-persist`/`light-controls` 同域）。
- **比刀①浅**：实例管理与 helper 联动（cone 几何 / 可见性）与 cap 的 `setTarget`/`setTargetHeight` 有状态耦合，下沉时须把 target 也作为叶字段或注入协作者，风险略高于 pp。

### 刀③：sky 烘焙/IBL 管线下沉

- `ensurePMREM` / `bakeEnvironment` / `regenerateEnvironment` / `clearEnvironment` / `requestEnvironmentRefresh` / `maybeRegenerateEnvironment` / `syncSunFromTime` 下沉，**D10 让权判据必须继续消费 `environment-ownership.ts|envShouldYieldSlot` 单一事实源**（ADR-292 P1-2 已收口的判据，不得在手抄回 cap）。
- **注意**：sky 的 `requestEnvironmentRefresh` 是目前 D10 路由器的唯一 sky 侧调用点，下沉时保持「router 判据 → 转交 env / 自持兜底」语义不变，守卫 = `environment-ownership.test.ts` 5 例 + sky 让位变异的现有锁。

**统一纪律**（三刀共用，承 ADR-091-d1 教训）：
- 生产调用方（menu 闭包 / registry / 测试）API 零变更——cap 公开方法名与签名全部保留，内部实现改委托叶；
- dispose 顺序收敛：叶的 dispose 由 cap.dispose 委托，**不赌 registry 反序**；
- 每刀独立提交 + 全量验证（preview-3d 3787 测试 + vite build + typecheck + biome），不做一次性「三巨头一刀流」。

## 3. 后果（Consequences）

**正面**：
- 三巨头降至与 env 同级（~500-600 行），「菜单叶存在但 setter 在 cap 内」的历史遗留消解；
- pp 管线高内聚拆分后，composer 链序硬约束（RenderPass → SSR → SSAO → Bloom → OutputPass）与 MSAA 语义集中单叶，日后排查后处理问题不再翻 950 行；
- 为后续「primitives 化 / 单测管线」的新增审计面留出叶边界。

**负面**：
- 约 900 行搬移 + 3 个最复杂 cap 的触碰面，逐刀遗漏会破坏行为（有 pp 133 处 + light/sky 各行为锁测试兜底）；
- 叶构造注入要求 cap 构造器显式传依赖（现状部分靠 `ctx.caps` 查询器隐式取），新增注入点属于小 API 面变化；
- 测试注入点从「cap 直读私有字段」改为「`composerOf(cap)` 白盒探针」，测试代码同步迁移。

**已知遗留**：
- environment cap 自身仍有约 40 个 setter 未再拆（ADR-091-d1 子提交 C 候选）——本次不伴随处理，与本 ADR 正交；
- `textureCache` 不接 MMD/VRM 的知情缺口不属本 ADR 范围。

## 4. 数据溯源

- 行数/方法构成：2026-10-11 直读三文件方法骨架（`sky-capability.ts` 920+ / `light-capability.ts` 952 / `postprocessing-capability.ts` 951），env 已拆参照 590 行；
- pp 测试锁定面：`postprocessing-capability.test.ts` 中 composer/SSR/Bloom/EffectComposer 断言 133 处；
- 拆分范式先例：ADR-091-d1（env-ibl / env-hdr-cache）+ `preview-env-state.md` 卡「子提交 A/B」；
- 判据单一事实源：`environment-ownership.ts|envShouldYieldSlot`（ADR-292 P1-2 收口）+ `environment-ownership.test.ts` 5 例。

<!-- 文件名: preview-cap-symmetry-leaf.md → 实际文件 architecture/ADR-329-preview-cap-symmetry-leaf.md（ADR-320 architecture 全量模板） -->