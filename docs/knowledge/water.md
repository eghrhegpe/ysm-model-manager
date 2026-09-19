---
kind: water
name: 水面能力 WaterCapability（Gerstner 波浪 + GPU 微细节法线）
tier: leaf
category: rendering
status: active
adr:
  - ADR-255
  - ADR-257
  - ADR-271
source_files:
  - frontend/src/preview-3d/caps/water-capability.ts
  - frontend/src/preview-3d/caps/water-body-strategies.ts
  - frontend/src/preview-3d/caps/water-menu.ts
  - frontend/src/preview-3d/caps/water-state.ts
auto_fields:
  symbols_with_lines:
    - buildWaterNodes
    - clampPoolRoundness
    - filmStrategy
    - getWaterBodyStrategy
    - INNER_WALL_OPACITY_FACTOR
    - POOL_ROUNDNESS_MAX
    - poolStrategy
    - registerWaterBodyStrategy
    - WATER_MODES
    - WaterBody
    - WaterBodyStrategy
    - WaterBuildContext
    - WaterCapability
    - WaterMode
    - WaterPartRole
    - WaterTopMesh
use_when:
  - 改水面波浪 / 颜色 / 透明度 / 水位 / 池体参数
  - 找不到水面的 normalMap
  - 新增水体形态（海洋 / 喷泉 / 大水面）
pitfalls:
  - 水面有 waterNormalStrength，但材质 normalMap 恒为 null——微细节法线由 fragment 程序化生成，不存在贴图（ADR-271）
  - 水面 mesh 是 scale(uSize,uSize,1) 各向异性缩放：世界量与局部量互换必须成对换算，只修一边等于换一种错法（ADR-257 §6.4）
  - 波浪振幅被 min(…, 0.5) 钳制，wave0–4 全部顶到上限，设计的几何级数衰减实际不存在（ADR-257 §6.4，登记未改）
  - waterSize 无 UI 入口，只可能来自存档；脏数据 0/负数在 loadState 钳到 ≥1，shader 侧另用 max(uSize, 0.001) 兜底
  - 圆角裁剪用世界坐标 max(|x|,|z|) 对比 uHalfSize，隐含「水面恒在世界原点」这一未登记假设
quick_groups:
  - 3D 预览与模型追加
quick_intents:
  - 水面/水池/water/波浪/wave
  - 水位与水膜（waterLevel / wetness）
  - 新增水体形态
quick_risk_lines:
  - 水面 shader 有 REVISION 断言与四处注入检测：升级 three 后必须重跑 water-capability.test.ts
invariant_anchors:
  - frontend/src/preview-3d/caps/water-capability.ts|buildWaveWaterMaterial
  - frontend/src/preview-3d/caps/water-capability.ts|applyChangedParams
  - frontend/src/preview-3d/caps/water-capability.ts|rebuildWaterContainer
  - frontend/src/preview-3d/caps/water-body-strategies.ts|getWaterBodyStrategy
---

# 水面能力 WaterCapability（Gerstner 波浪 + GPU 微细节法线）

## 概览

水面是 env 面板一等公民（与 sky / ground 平级，ADR-196 → ADR-268 归属基础卡末位），四轴分离：

| 文件 | 轴 | 特征 |
|---|---|---|
| `water-state.ts` | 类型 | `WaterMode = "film" \| "pool"`，零 THREE、零副作用 |
| `water-menu.ts` | 声明 | 13 控件 / 4 组 folder（form / look / pool / wave），纯节点树 |
| `water-capability.ts` | 渲染 | 波浪 shader 注入、微细节法线、容器装配、参数应用、持久化 |
| `water-body-strategies.ts` | 策略 | 形态注册表；**新增形态 = 注册一项，现有实现零改动** |

两形态语义：`film` = 贴地薄水膜（单位平面 × scale，受 wetness 门控，无体积光学）；
`pool` = 盒式凹形水池（顶面 + 池底 + 4 组内外壁共 9 mesh，transmission 体积光学）。

## 核心职责

1. **波浪**：`buildWaveWaterMaterial` 于 `onBeforeCompile` 注入 6 波 Gerstner 余摆线——
   顶点同时水平 + 垂直位移（波峰尖、波谷平）；解析法线（GPU Gems 1 ch.1）覆盖 `objectNormal`；
   Jacobian `J < 0` 处出碎波泡沫。方向/相位由 wave index hash 播种，陡度钳制 `Σσ·k ≤ 0.8` 防自交。
2. **微细节法线**：fragment 在 `#include <normal_fragment_maps>` **之后**按世界水平坐标
   （`vWorldPos_wave.xz`）程序化求三组方向沟槽偏导，构成世界空间切向扰动，经 `viewMatrix`
   送入视图空间叠加到 `normal`；强度由 `uDetailStrength` 驱动（原 `normalScale` 槽位的替代）。
   **CPU 侧不存在任何法线贴图**（ADR-271）。
3. **形态装配**：策略表 `build()` 产出 `WaterBody`（`root` / `top` / `parts` 按 `WaterPartRole`
   在 build 期预捕获），cap 只按语义 role 取件——运行时零遍历、零字符串匹配。
4. **参数应用**：`registerEnvCallback` 单入口三分派——结构字段重建容器、参数字段就地改
   material / uniform、开关只切可见性。setter 只写 `envState`，不各自就地改渲染。

## 对外 API / 入口

- 能力开关：`setWaterEnabled` / `getWaterEnabled`（菜单 id `ground-water-enabled`，cap 的 master node）
- 形态：`setWaterMode` / `getWaterMode`；水位：`setLevel` / `getLevel`（**跨形态通用，零重建**）
- 外观：`setWaterColor`、`setWaterOpacity`、`setWetness`、`setNormalStrength`、`setClarity`、`setChoppiness`
- 池体：`setPoolHeight`、`setPoolWallThickness`、`setPoolWallColor`、`setPoolRoundness`
- 波纹：`setWaveSpeed`；时间推进走 `update(dt)` 累加 `waterTime`（仅推进 uniform，从不写变换）
- 持久化：`saveState` / `loadState`（新旧键双轨；旧档无 `waterLevel` 时 pool 取 `waterPoolHeight` 兜底）

## 与其他子系统关系

- **envState（ADR-196）**：16 个 `water*` 键，group `water`；dispatcher 前置过滤后回调。
- **GroundCapability**：水面原是其「双子域」，拆分后平级。
- **environment**：水面的镜面感来自 `scene.environment`（PMREM 环境贴图），**不是**自身反射——
  水面不会倒映模型本体。
- **ReflectorCapability / SSR**：地面镜面默认关（`reflectorEnabled` 默认 false）；SSR 默认
  `envmap-only`；双反射默认不可达（`ppReflectorDisableWhenSSR` 默认 true）。
- **shader-patches / patch-guard**：REVISION 断言（宽松区间）+ 四处注入检测（vertex 波浪函数、
  `objectNormal` 覆盖、fragment 圆角段、微细节 `normal` 覆写点），失配即告警而非静默降级。

## 不变量

- **类型判定与筛选归 Go**；水面参数一律经 envState 单一事实源，前端不另立真相。
- **水面 mesh 的各向异性缩放**（`scale(uSize, uSize, 1)`）：世界量 ↔ 局部量互换必须成对
  （位移 `/sizeSafe`、解析法线 `×sizeSafe`），测试以「两处 `uSize` 因子成对出现」为结构断言。
- **`waterLevel` 变更零重建**：抬水面只改一个 `position.y` 标量，绝不触发容器重建。
- **材质构造期断言 REVISION**：water 锚点失配即 throw，由 registry 工厂兜底使本 cap 缺失，
  拒绝静默降级。
- **不存在 CPU 法线贴图**：`getNormalMap` / `generateNormalMap` / `normalMapCache` 已整体退场，
  回归时不应复活。

## 相关

- ADR-271（微细节法线 GPU 化，移除 CPU DataTexture 链路）
- ADR-257（水面/容器解耦 + 水体形态策略表）、ADR-255（Gerstner + uniform 化）
- ADR-196（envState 单一事实源）、ADR-195（cap 直产菜单节点）、ADR-268（env 面板归属）
- 测试：`frontend/src/preview-3d/caps/water-capability.test.ts`
