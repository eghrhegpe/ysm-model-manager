---
kind: test-discipline
name: 测试纪律：禁 mock 断言谓词 / 判别样本 / 变异探针
tier: architecture
category: core
status: active
source_files:
  - frontend/src/preview-3d/caps/env-ibl.test.ts
  - frontend/src/preview-3d/caps/env-hdr-cache.test.ts
  - frontend/src/preview-3d/caps/env-hdr-cache.ts
  - frontend/src/preview-3d/caps/environment-capability.test.ts
  - frontend/src/preview-3d/caps/sky-sun.ts
  - frontend/src/preview-3d/caps/sky-sun.test.ts
  - frontend/src/preview-3d/caps/sky-asset.ts
  - frontend/src/preview-3d/caps/sky-asset.test.ts
  - frontend/src/preview-3d/caps/ground-visible.ts
  - frontend/src/preview-3d/caps/ground-visible.test.ts
  - frontend/src/preview-3d/caps/fog-capability.ts
  - frontend/src/preview-3d/caps/light-visible.ts
  - frontend/src/preview-3d/caps/light-visible.test.ts
  - frontend/src/preview-3d/caps/light-math.ts
  - frontend/src/preview-3d/caps/light-math.test.ts
  - frontend/src/preview-3d/caps/shadow-capability.ts
  - docs/adr/decisions/ADR-311-d1-mock.md
tests:
  - frontend/src/preview-3d/caps/env-hdr-cache.test.ts
  - frontend/src/preview-3d/caps/sky-sun.test.ts
  - frontend/src/preview-3d/caps/sky-asset.test.ts
  - frontend/src/preview-3d/caps/ground-visible.test.ts
  - frontend/src/preview-3d/caps/light-visible.test.ts
  - frontend/src/preview-3d/caps/light-math.test.ts
  - frontend/src/preview-3d/caps/shadow-capability.test.ts
auto_fields:
  symbols_with_lines:
    - applyScaledUniformToPair
    - applyUniformToPair
    - attenuateAmbientForSky
    - computeHourToSun
    - computeSunPosition
    - createSky
    - EnvHdrCache
    - FogCapability
    - FogMode
    - groundGridVisibleFor
    - groundSurfaceVisibleFor
    - lightDirToPosition
    - lightHelperVisibleFor
    - lightTypeOf
    - normalizeFogRange
    - normalizeShadowMapSize
    - ShadowCapability
    - ShadowType
    - spotDistanceAttenuation
    - sunVectorFromSpherical
    - volumetricTipFromRatio
    - volumetricTipRatioFor
use_when:
  - 写或审 preview-3d 的 vi.mock 用例，判断是否自证
  - 给核心纯函数 / 关键守卫补测试，需正反双侧
  - 改关键守卫（所有权 / dispose 顺序 / 让权 / 通路裁决）后做变异实证
pitfalls:
  - mock 掉被断言行为的谓词 = 自证：断言的是替身不是真实现，测试无效
  - mock 不保真（null 输入 / 抛错输入 / 产物属性）：判别样本退化为假阳
  - three r186 的 needsUpdate 只有 setter（getter 恒 undefined），须以 version 递增断言
  - 纯函数下沉时须**参数化**（不读全局单例如 envState），否则不可叶层直测（ADR-235-d1 教训）
  - `??=` 只在 undefined 时赋值——对已有默认值的目标会**吞掉传入值**（`createSky` 教训：Sky 默认 `cloudCoverage=0.4`）
  - biome 禁 `!` 非空断言（`noNonNullAssertion`），类型收窄须用非 undefined 类型断言或显式守卫
  - 三布尔合取门最易「漏一支」静默分叉（手抄双源血案：ground `isSurfaceVisible`/`updateSurfaceVisible`），
    判别样本模板 = **三支各断一支**（漏能力总闸 / 漏总开关 / 漏子开关各一条，专杀「少一支」实现）
quick_groups:
  - 门禁与脚本
quick_intents:
  - vi.mock 怎么用不算自证？判别样本和变异探针是啥？
quick_risk_lines:
  - vi.mock 只许落在外部依赖 / 协作模块注入点，禁 mock 被测主体自身导出
invariant_anchors:
  - frontend/src/preview-3d/caps/env-ibl.test.ts|PMREM 生成失败回滚
  - frontend/src/preview-3d/caps/env-hdr-cache.test.ts|loadFromFile 三分支
  - frontend/src/preview-3d/caps/sky-sun.test.ts|负数 wrap 反例
  - frontend/src/preview-3d/caps/sky-asset.test.ts|undefined 守卫
  - frontend/src/preview-3d/caps/ground-visible.test.ts|断能力开关
  - frontend/src/preview-3d/caps/light-visible.test.ts|关能力总闸
  - frontend/src/preview-3d/caps/light-math.test.ts|除零守卫
  - frontend/src/preview-3d/caps/shadow-capability.test.ts|脏档值回退
  - docs/adr/decisions/ADR-311-d1-mock.md|决策
last_verified: 2026-10-09
---

# 测试纪律：禁 mock 断言谓词 / 判别样本 / 变异探针

## 概览

[ADR-311-d1] 收口的测试可信度三机制（锐评 2026-10-08，落地 2026-10-09）：

1. **禁自证**：测试不得 `vi.mock` 掉被断言行为的谓词 / 主体模块。`vi.mock` 只许落在外部依赖
   （`three` / `three/addons/**` / `@backend/**` / Loader / `@/wasm/**` / `@moeru/three-mmd*` /
   `@pixiv/three-vrm*` / `storage` / `document`/canvas/WebGL）与协作模块注入点（被测主体依赖的隔离替身）。
   判据：断言目标必须是**被测主体自身的真实导出**，而非被 mock 模块的导出。
2. **判别样本**：核心纯函数 / 关键守卫的测试必须正反双侧齐全（判真 + 判非真），单侧即欠债。
3. **变异探针**：关键守卫须经**变异实证**——手动改错实现，测试须转红；实证结论写进测试注释。

## 核心职责

- 拦截"mock 替身冒充真实现"的自证模式（`preview-3d` 116 处 `vi.mock` 全部已核：无自证，落在依赖边界）。
- 为新拆 / 新增模块补**叶层独立测试**（而非只经 cap 层白盒探针间接覆盖）——`EnvIbl` / `EnvHdrCache`
  即因拆分产生叶层直测缺口而补。
- 用变异探针暴露测试盲区与实现冗余（见"不变量"的实证案例）。

## 对外 API / 入口

- 测试写法范本：`frontend/src/preview-3d/caps/env-ibl.test.ts`（three mock + 像素运算 mock +
  `EnvHdrCache` 真用 + 三条分支双侧）、`frontend/src/preview-3d/caps/env-hdr-cache.test.ts`
  （`loadFromFile` 成功 / 失败 / 替换旧缓存三分支 + `thumbnail` 双态 + `dispose`）。
- 测试注入点白盒口径：TS `private` 运行时即普通属性，测试经 `hdrOf(cap)` / `iblOf(cap)` 直操作
  （`environment-capability.test.ts` 同款）。

## 与其他子系统关系

- 承接第 1 刀（ADR-091-d1 环境 cap 拆分）与第 2 刀（ADR-235-d1 sky cap 拆分）的**测试配套**：
  拆分出新模块必须有叶层判别样本，否则未来叶层重构时 cap 层断言静默空转或全红。
  纯计算下沉（`sky-sun.ts`）须**参数化**（不读 `envState`），否则叶层不可直测。
- `three` r185/r186 的 `Material`/`Texture.needsUpdate` 只有 setter（getter 恒 undefined），
  副作用认 `version` 递增（同 `sky-capability.test.ts` / `water-capability.test.ts` 口径）。

## 不变量

- **mock 不越被测主体**：`vi.mock` 的目标模块 ≠ 断言目标模块。
- **判别样本双侧**：正例 + 反例齐全，缺一侧记欠债。
- **变异实证锚点**：`env-ibl.test.ts`「dispose 还原 environment」经变异（移还原行 → 转红）实证；
  `environment-capability.test.ts`「dispose 顺序收敛 A/B 两序」有变异实证记录；
  `sky-sun.test.ts`「负数 wrap 反例」经变异（`((hour%24)+24)%24` → `hour%24`）→ 该用例转红、正 wrap
  用例仍绿——负/正两分支各自被精确守卫（第 2 刀 ADR-235-d1 子提交 A 实证）；
  `sky-asset.test.ts`「undefined 守卫」经变异（去掉 `if (su !== undefined)` 守卫）→ ghost uniform 与
  非对称 patch 两用例转红——守卫语义被精确守卫（第 2 刀子提交 B 实证）；
  `ground-visible.test.ts`「断能力开关」经变异（去掉 `enabled &&`）→ 该用例精确转红、其余 7 用例仍绿——
  三支合取门被逐支守卫（横向铺叶层直测实证，同时消 ground `isSurfaceVisible`/`updateSurfaceVisible`
  手抄双源——单一谓词 `groundSurfaceVisibleFor` 两处共用）；
  `light-visible.test.ts`「关能力总闸」经变异（去掉 `masterOn &&`）→ 该用例精确转红（防旧
  createHelper/syncHelper 缺能力总闸三分歧复活）；
  `light-math.test.ts`「base=0 除零守卫」经变异（去掉守卫）→ 该用例转红；
  `shadow-capability.test.ts`「脏档回退」经变异（白名单去 4096 档）→ 3 个 4096 用例转红（cap 既有断言
  与叶层新断言双重钉住「守卫只装一侧」母题）；
  `ground-surface-spec.test.ts`「surfaceTextureToken 纹理身份」经变异（去掉 `image?.width/height` 尺寸
  拼接）→ 名称+尺寸、缺位 0x0、尺寸不同 3 用例转红，而「名称不同」用例仍绿——尺寸参与身份的逻辑
  被精确守卫，且判别样本粒度未误伤 name 语义（横向铺叶层直测实证，消 ground-capability
  `currentTextureToken` 手抄双源）。
- **变异盲区诚实命名**：`env-ibl.test.ts`「PMREM 生成失败回滚」变异（移 catch 还原行）**仍绿**——
  因 `fromEquirectangular` 抛错发生在 `envTexture` 赋值前，`scene.environment` 本未改写，catch 那行
  还原是**防御性冗余**（与禁用分支 / dispose 同构）。测试注释须诚实标注，不夸大为防回潮断言。

## 相关

- [ADR-311-d1] 测试纪律：禁 mock 断言谓词 / 判别样本 / 变异探针
- [ADR-091-d1] 环境能力 cap 拆分
- [ADR-311] 菜单测试断言三分法
- `frontend/src/preview-3d/caps/environment-capability.test.ts`「命名诚实说明」先例（line 1850 附近）