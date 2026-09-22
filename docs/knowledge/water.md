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
  - ADR-272
  - ADR-283
  - ADR-297
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
    - poolStrategy
    - registerWaterBodyStrategy
    - WATER_MODES
    - WATER_PARAM_APPLIER_KEYS
    - WATER_WAVE_SEGMENTS
    - WaterBody
    - WaterBodyStrategy
    - WaterBuildContext
    - WaterCapability
    - WaterMode
    - WaterPartRole
    - WaterTopMesh
use_when:
  - 改水面波浪 / 颜色 / 透明度 / 水位 / 尺寸 / 池体参数
  - 找不到水面的 normalMap
  - 拖水面尺寸滑块卡顿 / 水面几何重建
  - 改滑杆范围 / 参数值域（range / uiRange）
  - 新增水体形态（海洋 / 喷泉 / 大水面）
  - 改水面模型倒影 / 镜像 RT / fresnel 混合
pitfalls:
  - 水面有 waterNormalStrength，但材质 normalMap 恒为 null——微细节法线由 fragment 程序化生成，不存在贴图（ADR-271）
  - 水面 mesh 是 scale(uSize,uSize,1) 各向异性缩放：世界量与局部量互换必须成对换算，只修一边等于换一种错法（ADR-257 §6.4）
  - 波浪振幅被 min(…, 0.5) 钳制，wave0–4 全部顶到上限，设计的几何级数衰减实际不存在（ADR-257 §6.4，登记未改）
  - 结构参数只能动 `transformLinks`（`square` 等比铺满 / `wall` 双轴：x = size、y = 壁高 + 外偏沿法向轴）：**y 轴不得被 size 缩放**（`wallH` 由 h / t 现算，与 size 无关），否则壁高与壁厚会被尺寸连带放大
  - '**（已修复 2026-09，ADR-272 §5.1）** pool 的 waterPoolHeight / waterPoolWallThickness 曾走全量重建（wall 的 y 尺寸与外壁偏移烘焙进几何）——拖动即每帧重建 10 个 mesh。现壁几何单位化：壁高走 `scale.y`、外偏 = `size/2 + t` 运行期现算。教训：**任何结构参数只要被烘焙进几何，就必然在滑块拖动时变成重建风暴**'
  - waterSize 值域：合法域 [1, 300]（下界来自「0/负数会让水面退化成一个点」）、展示域 10–300；钳制在 `setEnvState`（ADR-283），shader 侧另有 max(uSize, 0.001) 兜底
  - 圆角裁剪用世界坐标 max(|x|,|z|) 对比 uHalfSize，隐含「水面恒在世界原点」这一假设——已登记（2026-09-20）：若未来支持移动/放置水面（脱离原点），圆角裁剪会静默出错，需先改为相对水面自身中心的局部坐标
  - '⏰ 升级 three ≥ r190 前必读：buildWaveWaterMaterial 的 assertRevisionRange allowed 窗口为 [185,190)（water-capability.ts）——r190 起 water 材质构造会故意 throw（registry 工厂兜底使 cap 缺失，拒绝静默降级）。升级时须重新审计 wave shader 注入的 chunk 锚点（common / normal_fragment_maps 在 onBeforeCompile 期仍存在）后收窄/前移窗口，不可无脑放行'
  - '**透明度预设失效（已修复 2026-09）**：`applyChangedParams` 中 `waterOpacity` 变更路径只更新 `top.material.opacity`，漏同步 shader uniform `uBaseOpacity`。shader 用 `min(gl_FragColor.a, uBaseOpacity)` clamp 透明度，`uBaseOpacity` 固化在构建期，导致增大 opacity 不生效（减小偶然正常）。修复：补调 `syncBaseOpacityUniform`，与 `waterWetness` 路径同口径'
  - '**派发键是类型化键域（2026-09）**：`EnvCallback.changed` 为 `Set<EnvStateKey>`，`changed.has("拼错")` 编译不过；新增参数必须先在 `env-state-schema.ts` 声明（含 `group: "water"`），否则派发链与持久化都抓不到它'
  - '**water 持久化由 schema 派生**：`saveState` 遍历 `getPresetKeys("water")`（不再手抄键表）；写侧统一 `water*` 规范键，历史键名 `size` / `pool*` 由 `loadState` 双轨吸收——新增参数只需进 schema，读侧按需补别名'
  - '**uniform 一律经 `setUniform(mat, name, value)` 写入**（原五处 `as unknown as { userData.shader }` 深挖已收口）：`onBeforeCompile` 未跑或 uniform 名拼错时静默跳过，故改动后须以「uniform 实际取到值」的断言兜底，不能只断言 envState'
  - '**值域改一处生效（ADR-283）**：滑杆 `min/max/step` 由 `getParamRange(key)` 从 schema 取，cap 内不再有值域字面量；写侧钳制在 `setEnvState` 唯一入口。改范围请改 `ENV_STATE_SCHEMA.xxx.range`（合法域）/ `uiRange`（展示域），**不要在 menu 或 setter 里写死**'
  - '**setter 不再 clamp（ADR-283）**：`setWaterOpacity` 等一律只 `setEnvState({...})`；若要加保护请补 schema `range`，写回 setter 即造出第二事实源'
  - '**水面开关单门（2026-09-22，fog 先例同法）**：启停唯一真值源 = `envState.waterEnabled`，`SceneCapability.setEnabled/isEnabled` 是其别名出口。原私有 `this.enabled` 为僵尸门——registry ctx 无 `enabled` 字段 ⇒ 生产恒 true、无任何 UI 写口、却经 saveState 持久化幽灵键；且 `loadState` 首段曾把 ground 嵌套 legacy 的 `water.enabled` 直写进它：**中毒即永久锁死水面，菜单开关显示 ON 也救不回**。现私有字段退役（守卫 = 测试断言 `"enabled" in cap === false`），幽灵键不再落盘也不再消费，同一存档翻开关即可复现'
  - '**含开关键的批次派发不得早退吞键（2026-09-21 修复）**：回调曾 `changed.has("waterEnabled") → syncWaterVisibility → return`，同批其余 water 键的材质/transform 应用被整体跳过——envState 已新、渲染体仍旧（画面与状态脱节直到下一次无关派发）。现参数照常逐键派发、可见性统一在派发尾重算；守卫 = 测试「waterEnabled + 参数同批派发」用例。往回调里加任何「单键早退 return」前先想清楚同批其余键谁负责'
  - '**形态门控必须「构造期 = 运行期」同源（2026-09 修复）**：`uRoundness` 构造期靠 `buildMaterial` 的 `forPool` 对 film 恒 0，但分派表 applier 侧曾漏门控——pool 专属参数 `waterPoolRoundness` 经存档恢复 / 预设套用 / 其他 cap 直写 envState 时会把圆角泄漏进 film 材质（水膜四角被凭空裁掉，恰是构造期明令禁止的行为）。现由 `WaterBodyStrategy.supportsRoundness` 显式声明（film=false / pool=true）并在 applier 查 strategy。**教训：同一门控只写在构造期，运行期迟早从另一条路径漏进 uniform**——新增形态旗标时构造期与运行期必须共用'
  - '**倒影三坑（ADR-297）**：① RT 渲染期间水根必须隐藏——不隐则 pool 顶面 transmission pass 在镜像通路里再渲一遍水体（嵌套整场渲染 + 双层水）；② 官方 textureMatrix 末位乘了 scope.matrixWorld（输入=镜面局部坐标），水 shader 喂世界坐标必须右乘 M⁻¹ 剥回，直乘会双重变换；③ 反射相机视锥内容不受 render-host 主相机剔除管辖（RT 渲发生在 cullModelGroups 之前），掠射角下官方「背对早退」跳帧、倒影边缘缺块属已拍板已知限制（见 ADR-297 §3），勿当 bug 修'
  - '**倒影门控是逐帧现读，不是派发驱动**：`waterReflectionEnabled/Strength/Resolution/ReflectDisableWhenSSR` 在分派表里是显式 no-op 声明（与 waterWaveSpeed 同口径）——门控/权重/RT 边长/镜面高度全在 `renderReflection` 现读 envState 落地。别给它们补材质写（双写违 ADR-286），也别给 pp 键补订阅（SSR 抑制真值现算即可，多订一路 = 第二真值源）'
  - '**倒影 RT 内容线性、无 tone map**（three 仅对 canvas 输出做 tone map）：dithering 段底色已过 colorspace，采样值必须过 `linearToOutputTexel` 再混——直接混 linear 进 sRGB 域会让倒影发黑'
  - '**波场采样密度 ≡ 几何分段数，两处必须同源（2026-09-22 治大水面摩尔纹）**：顶水面网格分段固定（唯一事实源 `water-state.ts|WATER_WAVE_SEGMENTS`），顶点间距 s = waterSize/分段数——s 逼近波长一半（奈奎斯特）时高频波混叠成游走摩尔纹（300 m 水池高频频闪的病灶）。gerstner 逐波按「每波长顶点数 λ/s」淡出振幅（≥6 全留、2–6 线性消退、1‰ 下界防 wa 除零 NaN）；位移/解析法线/泡沫 Jacobian 同源于 amp，一处衰减三处一致。改分段只动常数一处（几何装配与 shader 间距推导都读它，守卫 = 「分段数唯一事实源」用例）；调大 = 高频保留更好但三角数平方上涨，调小 = 消隐提前介入。注意此衰减治的是「采样不足」，`min(…, 0.5)` 抹平振幅级数是另一笔已登记未改的账'
quick_groups:
  - 3D 预览与模型追加
quick_intents:
  - 水面/水池/water/波浪/wave
  - 水位与水膜（waterLevel / wetness）
  - 新增水体形态
quick_risk_lines:
  - 水面 shader 有 REVISION 断言与注入守卫（vertex 波浪函数 / objectNormal 覆盖 / 圆角段 / 微细节覆写点 / 倒影混合块）：升级 three 后必须重跑 water-capability.test.ts
invariant_anchors:
  - frontend/src/preview-3d/caps/water-capability.ts|buildWaveWaterMaterial
  - frontend/src/preview-3d/caps/water-capability.ts|applyChangedParams
  - frontend/src/preview-3d/caps/water-capability.ts|rebuildWaterContainer
  - frontend/src/preview-3d/caps/water-capability.ts|renderReflection
  - frontend/src/preview-3d/caps/water-capability.ts|reflectionActive
  - frontend/src/preview-3d/caps/water-body-strategies.ts|getWaterBodyStrategy
  - frontend/src/preview-3d/caps/water-state.ts|WATER_WAVE_SEGMENTS
---

# 水面能力 WaterCapability（Gerstner 波浪 + GPU 微细节法线）

## 概览

水面是 env 面板一等公民（与 sky / ground 平级，ADR-196 → ADR-268 归属基础卡末位），四轴分离：

| 文件 | 轴 | 特征 |
|---|---|---|
| `water-state.ts` | 类型 | `WaterMode = "film" \| "pool"`，零 THREE、零副作用 |
| `water-menu.ts` | 声明 | 纯节点树：`water-enabled` 平铺 toggle + form/look/pool/wave/reflect 组 folder（组内全原生控件） |
| `water-capability.ts` | 渲染 | 波浪 shader 注入、微细节法线、容器装配、参数应用、持久化 |
| `water-body-strategies.ts` | 策略 | 形态注册表；**新增形态 = 注册一项，现有实现零改动**（结构参数语义固化为 `transformLinks`） |

两形态语义：`film` = 贴地薄水膜（单位平面 × scale，受 wetness 门控，无体积光学）；
`pool` = 盒式凹形水池（顶面 + 池底 + 4 组内外壁共 10 mesh，transmission 体积光学）。

## 核心职责

1. **波浪**：`buildWaveWaterMaterial` 于 `onBeforeCompile` 注入 6 波 Gerstner 余摆线——
   顶点同时水平 + 垂直位移（波峰尖、波谷平）；解析法线（GPU Gems 1 ch.1）覆盖 `objectNormal`；
   Jacobian `J < 0` 处出碎波泡沫。方向/相位由 wave index hash 播种，陡度钳制 `Σσ·k ≤ 0.8` 防自交。
2. **微细节法线**：fragment 在 `#include <normal_fragment_maps>` **之后**按世界水平坐标
   （`vWorldPos_wave.xz`）程序化求三组方向沟槽偏导，构成世界空间切向扰动，经 `viewMatrix`
   送入视图空间叠加到 `normal`；强度由 `uDetailStrength` 驱动（原 `normalScale` 槽位的替代）。
   **CPU 侧不存在任何法线贴图**（ADR-271）。
3. **形态装配**：策略表 `build()` 产出 `WaterBody`（`root` / `top` / `parts` 按 `WaterPartRole`
   在 build 期预捕获 / `transformLinks` 结构参数联动计划），cap 只按语义 role 取件——运行时零遍历、零字符串匹配。
4. **结构参数应用**：**结构参数不进几何**——几何一律单位化，世界尺寸 / 壁高 / 壁厚由 `scale` / `position` 表达；
   形态在 build 期把「哪些件随哪个结构参数怎么变」固化成 `transformLinks`（`square` 等比铺满 / `wall` 双轴
   + 沿法向轴平移），故 **film 与 pool 的 size、以及 pool 的池深 / 壁厚变更均零重建**（ADR-272 §2.1 / §5.1）。
   ⚠️ **零重建的代价：派生量必须自己在运行期重算**——几何跟上了不代表派生属性也跟上。
   顶水面 `thickness`（= `max(0.01, waterPoolHeight × 0.5)`，ADR-257「容器内水的光程」）曾只在
   `buildMaterial` 算一次，而 pool `needsRebuild` 恒 false ⇒ **拖池深：壁长高了、水体光程不动**。
   已于 2026-09-20 在 `applyChangedParams` 的 `waterPoolHeight` 分支补重派生（仅
   `supportsVolumeOptics` 形态，film 水膜恒 0 不得被误赋）。教训：**任何「由参数派生、只在装配期算」
   的量，在零重建形态里都是定时炸弹**——新增派生量时先问「谁负责在运行期重算它」。
5. **参数应用（ADR-286 分派表，2026-09-20）**：`registerEnvCallback` 单入口三分派——mode 切换重建容器、
   结构参数就地改 transform（`applyProfile`）、参数字段就地改 material / uniform、开关只切可见性。
   setter 只写 `envState`，不各自就地改渲染。参数应用已由 if 瀑布收敛为模块级
   `WATER_PARAM_APPLIERS: Record<WaterParamKey, applier>` **逐键分派表**（`water-capability.ts`）：
   `Record` 对 water 组全键编译期强制表态（`waterEnabled`/`waterMode`/`waterWaveSpeed` 为显式 no-op 声明），
   **新增 water 参数 = schema 声明 + 表内加一条目，漏接编译期即红**；条目间写互不相交字段，
   派发序无关结果（守卫测试：乱序全量 patch ≡ 单键逐发快照一致）。
   原 `findTopWater`/`syncBaseOpacityUniform` 私有 helper 已随瀑布退役（顶水面恒为 `water.top`）。
6. **模型倒影（ADR-297）**：`ensureReflector` 懒建官方 `Reflector` 载体但**不挂进场景**——只借
   它「镜像相机 + 斜裁剪 + 整场渲进 RT」管线。`update(dt)` 每帧 `renderReflection`：镜面平面
   即水面（`position.y` 跟随 `waterLevel`），驱动 `onBeforeRender` 渲 RT 期间**临时隐藏整个水根**
   （防水体入自身镜像成双层水；防 pool 顶面 transmission pass 在镜像通路里嵌套第二场整场渲染）。
   三 uniform（`uReflTex / uReflMatrix / uReflStrength`）由 shader 消费：世界坐标经
   `uReflMatrix`（官方 textureMatrix = bias·P·V·M 右乘 M⁻¹ 剥回世界口径，bias 在内 → 除 w 即 uv）
   投影采样，Gerstner 解析斜率（`vWaveSlope_wave`，与光照法线同源）扰动 uv，fresnel 掠射增强。
   开关 = 翻 `uReflStrength`（0 → 混合块整体跳过），**不触发 program 重编译**；RT 内容为线性空间
   （three 仅对 canvas 输出做 tone map），采样值过与主程序同源的 `linearToOutputTexel` 再混。
   分辨率变更走 `getRenderTarget().setSize` 原位扩缩，不重建载体。

## 对外 API / 入口

- 能力开关：`setWaterEnabled` / `getWaterEnabled`（菜单 id `water-enabled`，cap 的 master node）——**单门**：SceneCapability 的 `setEnabled/isEnabled` 是其别名，真值源唯一 `envState.waterEnabled`（2026-09-22 私有门退役，fog 同法）
- 形态：`setWaterMode` / `getWaterMode`；水位：`setLevel` / `getLevel`（**跨形态通用，零重建**）
- 尺寸：`setWaterSize` / `getWaterSize`（菜单 id `water-size`，展示域 10–300 m / 合法域 ≥1；**跨形态通用，零重建**，ADR-272 + ADR-283）
- 外观：`setWaterColor`、`setWaterOpacity`、`setWetness`、`setNormalStrength`、`setClarity`、`setChoppiness`
- 池体：`setPoolHeight`、`setPoolWallThickness`（**两条均零重建**，ADR-272 §5.1：壁高走 `scale.y`、外偏与光学光程运行期现算）、`setPoolWallColor`、`setPoolRoundness`（钳制同源 schema `range`，ADR-283）
- 波纹：`setWaveSpeed`；时间推进走 `update(dt)` 累加 `waterTime`（仅推进 uniform，从不写变换）
- 倒影（ADR-297）：`setWaterReflectionEnabled` / `setWaterReflectionStrength` / `setWaterReflectionResolution` /
  `setWaterReflectDisableWhenSSR`（getter 同名 get* 族）。构造 opts 含可选 `renderer`/`camera`（registry 传
  全量 ctx；缺省 = 倒影自动失效，单测可裸 scene 构造）。四键均 schema `group: "water"`——持久化写侧自动、
  读侧已登记还原表（D3 契约锁兜底）；reflect 组四控件在 `water-menu.ts`，从控按主开 visibleWhen
  出场（探针路径 `env.waterReflectionEnabled`，ADR-291 三步登记）
- 持久化：`saveState` / `loadState`（新旧键双轨；旧档无 `waterLevel` 时 pool 取 `waterPoolHeight` 兜底）。
  `loadState` 恢复段挂起派发（`suspendEnvCallbacks`，fog/ground/light 同法），末尾 `rebuildWaterContainer`
  从 envState 一次性全量落地——不再逐键 dispatch×重建；顶层 `enabled` 幽灵键不再消费（单门收口）
  - **值钳制唯一执法点 = `setEnvState` 的 `clampFieldValue`（ADR-283）**：`loadState` 的 legacy `size` 键
    曾自钳 `Number.isFinite(v) ? Math.max(1, v) : 1`——与写入口重复、且只盖下界（与 schema `range [1,300]`
    口径不齐）。已于 2026-09-20 删除自钳、改为委派 `setWaterSize`（保存兼容性不变，legacy `size` 仍生效）。
    ⚠️ 存档过 JSON 边界后 NaN/Infinity 已变 `null`，故「非有限值」分支实际不可达——别为它写特例。

## 与其他子系统关系

- **envState（ADR-196）**：water 组键集（= `getPresetKeys("water")`，含 `waterEnabled`）全部 `group: "water"`，dispatcher 前置过滤后回调。
- **GroundCapability**：水面原是其「双子域」，拆分后平级。
- **environment**：水面的高光感来自 `scene.environment`（PMREM 环境贴图）；**模型倒影**是
  ADR-297 的独立通路（默认关），开了才会倒映模型本体。
- **ReflectorCapability / SSR**：地面镜面默认关（`reflectorEnabled` 默认 false）；SSR 默认
  `envmap-only`；双反射默认不可达（`ppReflectorDisableWhenSSR` 默认 true）。水面倒影同纪律：
  `waterReflectionEnabled` 默认关 + `waterReflectDisableWhenSSR` 默认 true（SSR 活跃时跳渲归零，
  逐帧现读 pp 键——pp 键属 postprocessing 组，water 回调收不到派发，不另订第二路订阅）。
  地面镜面与 RT 嵌套：水面 RT 渲染内含地面 Reflector 时，官方 scope.visible 自排除保证不无限递归。
- **shader-patches / patch-guard**：REVISION 断言（宽松区间）+ 四处注入检测（vertex 波浪函数、
  `objectNormal` 覆盖、fragment 圆角段、微细节 `normal` 覆写点），失配即告警而非静默降级。

## 不变量

- **类型判定与筛选归 Go**；水面参数一律经 envState 单一事实源，前端不另立真相。
- **水面 mesh 的各向异性缩放**（`scale(uSize, uSize, 1)`）：世界量 ↔ 局部量互换必须成对
  （位移 `/sizeSafe`、解析法线 `×sizeSafe`），测试以「两处 `uSize` 因子成对出现」为结构断言。
- **`waterLevel` 变更零重建**：抬水面只改一个 `position.y` 标量，绝不触发容器重建。
- **结构参数（`waterSize` / `waterPoolHeight` / `waterPoolWallThickness`）变更零重建**（ADR-272 §2.1 + §5.1）：只按 `transformLinks` 改 transform（pool 恒 10 件 mesh：
  顶 + 底 + 4 组内外壁，几何与材质句柄全程同一）。测试以「mesh 与 geometry 同一性保持」为硬断言，
  不以结果尺寸通过为满足；拖动滑块属高频事件，重建路径不允许出现在此。**注意 wall 只缩放 x 轴**——
  y 轴一旦被 scale，壁高与壁厚会随 size 放大（绝对量语义破坏）。
- **值域唯一事实源 = schema `range`**（ADR-283）：写入钳制只在 `setEnvState` 唯一入口发生（`clampFieldValue`），
  setter 不再自备 clamp；滑杆展示域取 `uiRange ?? range`（`waterSize` 合法 ≥1、展示 10–300）。
  新增/改动值域只动 schema 一处——菜单与 cap 都只是它的读口。
- **材质构造期断言 REVISION**：water 锚点失配即 throw，由 registry 工厂兜底使本 cap 缺失，
  拒绝静默降级。
- **不存在 CPU 法线贴图**：`getNormalMap` / `generateNormalMap` / `normalMapCache` 已整体退场，
  回归时不应复活。
- **不存在能力级私有开关**：`this.enabled` / `opts.enabled` / 存档顶层 `enabled` 键已退役（单门 =
  `envState.waterEnabled`，fog 同法），回归时不应复活——测试以 `"enabled" in cap === false` 为守卫。

## 相关

- ADR-283（参数值域描述符：schema `range`/`uiRange` 单一事实源 + 钳制收口 `setEnvState`）
- ADR-272（waterSize 放开 UI 入口 + pool 尺寸零重建 / `sizeLinks`；§5 扩展：池深/壁厚一并零重建 + 三处接线收口）
- ADR-271（微细节法线 GPU 化，移除 CPU DataTexture 链路）
- ADR-257（水面/容器解耦 + 水体形态策略表）、ADR-255（Gerstner + uniform 化）
- ADR-196（envState 单一事实源）、ADR-195（cap 直产菜单节点）、ADR-268（env 面板归属）
- 测试：`frontend/src/preview-3d/caps/water-capability.test.ts`
