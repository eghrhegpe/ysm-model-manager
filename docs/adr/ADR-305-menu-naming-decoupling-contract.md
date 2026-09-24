# ADR-305：preview-3D 菜单命名脱钩裁定：三命名族稳定契约

- **状态**：✅ 已采纳
- **实施状态**：查知识卡（ADR 只记决策方向，不记实施进度）
- **日期**：2026-09-24
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`ADR-257（wetnessGated 口径）/ ADR-286（applyChangedParams 分派表）/ ADR-246 D2（体积光语义命名）/ docs/audit-env-review.md S5-2 / scripts/check-i18n-unused.ts`

---

## 1. 背景（Context）

<!-- ⚠️ 本节是「决策当时」的状态快照，ADR 落地后此处的病灶可能已治愈；评估「现在是否还这样」以当前源码树 + 知识卡实施进度为准，勿把本节当现状。 -->

水面审计锐评 P2-2（「waterFilmDensity 与 waterWetness 命名脱钩」）原判为「改名」，后撤回：
water-wetness 滑杆 `labelKey = preview.waterFilmDensity`（zh「水膜浓度」），而 envState 键为
`waterWetness`——控件经 `visibleWhen: waterFilmOn` 只在 film 形态出场，此处 wetness 的语义
就是水膜浓度（ADR-257 wetnessGated 口径）。用户可见文案是对的，脱钩的只是内部键名视角；
改名收益为零，代价是三语言包 + 菜单一处 churn。

防审查管线对同类项逐条重审，做了一次统一普查（10 个 cap 菜单 × labelKey ↔ envState 键
× 三语文案全量对齐）：**38 对脱钩，三语文案全部正确**，「文案误导」案例 = 0。同时发现
脱钩残留类：`check-i18n-unused` 实测死键 14 + 仅测试键 8（存量 22 已冻结基线），另
`diagnostics.healthTitle` 为基线外新增未用键——它（及孪生 `settings.title`）落在 ADR-300
S2 诊断组重构热区，属预留而非尸体。

病灶：命名稳定性无成文契约——「labelKey 名 ≠ schema 键名」被反复当作缺陷候选逐条裁决；
schema 键的稳定性边界（改名 = 存档孤儿化 + ADR 词系 + 分派表）缺位，每次重吵一遍。

## 2. 决策（Decision）

**D1 三命名族与稳定契约**：

| 命名族 | 角色 | 稳定性契约 |
|---|---|---|
| envState schema 键 | **存储标识符**：存档键 + ADR-257 wetnessGated 词系 + ADR-286 分派表键 + ADR-283 值域声明 | **默认不改名**。改名须同时带存档迁移（loadState 双轨读旧键）+ ADR 词系更新 + 分派表同步，且仅限「语义实错」的根治场景 |
| labelKey（LocaleKey） | **用户可见语义标识符**：命名跟控件语义走，不跟存储键走——掉前缀（pp* 组 20 例）、缩写（waterSpeed↔waterWaveSpeed）、语义改名（volumetricDensity↔lightVolumetricOpacity）均合法 | 自由演化；变更面 = 三语言包 + 生成 JSON + 菜单 join 点 + 测试，**文案措辞是唯一审查面** |
| 菜单工厂 join（`caps/*-menu.ts` 的 `wSliderNode(id, labelKey, getParamRange(key), …)` 参数位） | **唯一语义拼接点**，`LocaleKey × RangedKey` 类型锁定 | join 点数量守恒；新键拼错 = 编译期红（ADR-286 分派表 Record 完备） |

**D2 审查判据（P2-x 类裁决规则）**：命名脱钩项当且仅当「**用户可见文案错 / 误导**」
才构成缺陷（S5-2 水膜拖 0 消失属 UX 缺陷，另行账挂）；「labelKey 名 ≠ envState 键名」
**本身不是缺陷**——两者本就不同族不同主（存储 vs 展示）。判据是三语文案，不是键名同形。

**D3 改名成本公式（默认不动的算术依据）**：
- labelKey 改名：三语言包 + public JSON（生成物）+ 菜单 join 点 + 测试；文案零变化、存档零影响、用户可见零收益 → **否**。
- schema 键改名：旧存档键孤儿化（loadState 读不到 → 用户自定义水/雾等设置静默重置）+ ADR 词系 + 分派表 + N 处消费点；用户可见零收益 → **否**。

**D4 38 对同构件裁定（2026-09-24 普查快照，全判「文案正确 → 不动」）**：

- **water（8）**：waterFilmDensity↔waterWetness（P2-2 原案）/ waterStrength↔waterNormalStrength / waterSpeed↔waterWaveSpeed / waterHeight↔waterPoolHeight / waterWallThickness↔waterPoolWallThickness / waterWallColor↔waterPoolWallColor / waterRoundness↔waterPoolRoundness / waterReflectSsrSuppress↔waterReflectDisableWhenSSR
- **postprocessing（20）**：系统性掉 `pp` 前缀——toneMapping/exposure/bloomEnabled/bloomStrength/bloomThreshold/bloomRadius/bloomFollowVolumetric/ssao/ssaoRadius/ssaoMinDist/ssaoMaxDist/reflectionMode/reflectorDisableWhenSSR/ssrOpacity/ssrMaxDistance/ssrThickness/ssrBlur/ssrDistanceAttenuation/ssrFresnel/ssrBouncing（labelKey 裸名 ↔ `pp*` schema 键）
- **体积光（5）**：volumetric↔lightVolumetricEnabled / volumetricDriver↔lightVolumetricDriver / volumetricDensity↔lightVolumetricOpacity（zh「浓度」）/ volumetricFalloff↔lightVolumetricFogPower（zh「衰减」）/ volumetricTipRatio↔派生比值（无 schema 键，ADR-283 §2.5 例外）——**正向用例**：ADR-246 D2 刻意收编的「语义命名」，label 名即收编后语义
- **sky（3）**：cloudCoverage↔skyCloudCoverage / skyTimeline↔skyTimeOfDay / skyGodRays↔skyGodRaysEnabled
- **ground（2）**：groundMatAngle↔groundMatAngleDeg / groundMatRotation↔groundMatRotationDeg（键名暴露实现细节，文案比键名准）

余下 shadow / fog / reflector / environment / render-mode 五菜单 labelKey 与键名全同形，零脱钩。
边界注：light 单灯参数族（preview.lightIntensity ↔ lightKey/Fill/RimIntensity 经 FLATTEN_MAP 槽位
动态复用）是**共享 labelKey × 槽位多路复用**的合法模式（folder 标题承载编辑对象），不属脱钩。
新产生的脱钩不需登记——按 D2 判据自动裁定（文案对即非缺陷）。

**D5 预留键判据（死键类伴随裁定）**：未用 i18n 键存在「预留待用」证据（进行中重构热区
引用预告，如 ADR-300 S2 诊断组）时按 checker 口径**预留收编**：语言包原位加注释 + 登记
`check-i18n-unused` 基线，不删；其余 20 键（14 死 − 2 预留 + 8 仅测试）为**解锁后批量删除队列**
（locale 三文件被并行会话锁定；队列进度记知识卡 `i18n.md`，不入本 ADR）。

## 3. 后果（Consequences）

- **正面**：P2-2 类命名脱钩项经 D2 判据一次性批量裁定，审查管线零重审成本；schema 键
  显式升格「存储标识符」——改名的代价边界（存档迁移）成文，不再逐案重吵；预留键与尸体
  键经 D5 分流，`--baseline` 闸不误报。
- **负面 / 代价**：38 对脱钩保持脱钩（美学债有意保留——对齐成本 > 零收益）；「labelKey 名 ≠
  键名」永远读起来像缺陷，靠 D2 判据 + 本 ADR 索引位消解，不靠改名消解。
- **已知遗留**：S5-2（film 下 wetness 拖 0 → 水面消失，建议 min 域 0.05 或 hint「0=无水面」）
  属 UX 缺陷而非命名，账挂 `docs/audit-env-review.md` 另行处理；死键 20 键批量删除 +
  预留键 2 注释待 locale 解锁（`i18n.md` 队列）。

## 4. 数据溯源

- `node scripts/check-i18n-unused.ts --json --list`（2026-09-24 跑）：语言包 1507 键，
  dead=14 / test-only=8 / constructedSites=1（置信度已标注）；基线
  `scripts/baseline/i18n-unused-baseline.json`（2026-09-19 建）存量 22 条 vs 当前 22 条
  （`diagnostics.healthTitle` 新增入列、`preview.groundGroupWater` 已复活出列）。
- 38 对映射：`caps/*-menu.ts` + `caps/light-controls.ts` labelKey 全量 grep ↔
  `state/env-state-schema.ts` 键名对照；三语文案以 `frontend/public/locales/{zh-CN,en,ja}.json`
  点查（i18n-check 三语 parity 全绿为底），零「文案错」案例。
- P2-2 撤回记录：水面审计锐评原判（改名）→ 用户裁定撤回（2026-09，「用户可见文案是对的，
  脱钩的只是内部键名视角；改名收益为零」）。

<!-- 文件名: menu-naming-decoupling-contract.md → 实际文件 ADR-305-menu-naming-decoupling-contract.md -->
