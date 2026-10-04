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
  - ADR-319
source_files:
  - frontend/src/preview-3d/caps/water-body-strategies.ts
  - frontend/src/preview-3d/caps/water-capability.ts
  - frontend/src/preview-3d/caps/water-menu.ts
  - frontend/src/preview-3d/caps/water-migrations.ts
  - frontend/src/preview-3d/caps/water-params.ts
  - frontend/src/preview-3d/caps/water-reflect.ts
  - frontend/src/preview-3d/caps/water-state.ts
auto_fields:
  symbols_with_lines:
    - applyReflectionUniforms
    - buildWaterNodes
    - clampPoolRoundness
    - createWaterReflectState
    - disposeReflector
    - effectiveWaveHeight
    - ensureReflector
    - filmStrategy
    - getWaterBodyStrategy
    - INNER_WALL_OPACITY_FACTOR
    - LEGACY_DEFAULT_WATER_LEVEL
    - migrateLegacyWaterLevel
    - poolStrategy
    - reflectionActive
    - registerWaterBodyStrategy
    - renderReflection
    - WATER_FRAME_READ_KEYS
    - WATER_MODES
    - WATER_NOOP_APPLIER_KEYS
    - WATER_PARAM_APPLIER_KEYS
    - WATER_PARAM_APPLIERS
    - WATER_SCHEMA_VERSION
    - WATER_SCHEMA_VERSION_KEY
    - WATER_UNIFORM_NAMES
    - WATER_WAVE_SEGMENTS
    - WaterApplyCtx
    - WaterBody
    - WaterBodyStrategy
    - WaterBuildContext
    - WaterCapability
    - WaterMode
    - WaterParamKey
    - WaterPartRole
    - WaterReflectCtx
    - WaterReflectState
    - WaterTopMesh
    - WaterUniformName
    - WAVE_AA_FULL_VERTS
    - WAVE_AA_MIN_VERTS
    - WAVE_DEGENERATE_WA
    - WAVE_STEEP_SIZE_REF
    - WAVE_STEEP_SUM_LIMIT
use_when:
  - 改水面波浪 / 颜色 / 透明度 / 水位 / 尺寸 / 池体参数
  - 找不到水面的 normalMap
  - 拖水面尺寸滑块卡顿 / 水面几何重建
  - 改滑杆范围 / 参数值域（range / uiRange）
  - 新增水体形态（海洋 / 喷泉 / 大水面）
  - 改水面模型倒影 / 镜像 RT / fresnel 混合
  - 复核波高 / 泡沫 / 频谱是否成立（数值探针 probe-water-wave）
pitfalls:
  - 水面有 waterNormalStrength，但材质 normalMap 恒为 null——微细节法线由 fragment 程序化生成，不存在贴图（ADR-271）
  - 水面 mesh 是 scale(uSize,uSize,1) 各向异性缩放：世界量与局部量互换必须成对换算，只修一边等于换一种错法（ADR-257 §6.4）
  - '**波幅写死已被数值探针量化、2026-10-04 修复（ADR-319 D1）**：旧式 `amp = min(0.6·0.82^i / freq, 0.5)` 使 wave0–4 全部顶到上限 0.5（ADR-255 设计的几何级数衰减被抹平）、振幅是**绝对世界米制、不随 waterSize / 池深 / 水位归一**，默认参数实测峰谷差 5.296 m ⇒ **33.17% 越壁、49.14% 穿地**。现 `amp = uWaveHeight·0.26·0.82^i`（0.26 归一 ⇒ Σamp ≡ uWaveHeight），取新默认（waveHeight=0.06、level=0.15、poolHeight=0.3）复测：峰谷差 **0.116 m**、越壁 **0.00%**、穿地 **0.00%**。复现命令 `node scripts/probe-water-wave.ts`（量具非门禁，退出码恒 0；① 段标定自证复刻忠实度）'
  - '**浪高入口曾完全缺席（2026-10-04 修复，ADR-319 D1）**：面板五个水波旋钮（waveSpeed / choppiness / normalStrength / clarity / size）里不含振幅——`amp` 不进 `steep` 链，`waterChoppiness=0` 时峰谷差零变化（探针实测），即「静水态不可达」且「尖度归零时几何仍大幅起伏、解析法线已判为平面」。现 `waterWaveHeight` 进 schema（默认 0.06，range 0–1），经 `water-params.ts|effectiveWaveHeight` **分形态钳制**：下钳 `min(waterLevel)` 治穿地（film/pool 通用），上钳 `min(waterPoolHeight − waterLevel)` 治越壁（**仅 pool**），钳制量在 CPU 侧算好下发。**上钳不可无条件套用**——film 下 `waterPoolHeight` 滑块隐藏、锁死在默认 0.3，而 `waterLevel` range 到 5.0，无条件「两钳取小」会让水位过 0.3 m 时预算归零、浪高静默死平（落地后子代理复核发现，已改为 `effectiveWaveHeight(forPool)` 按形态传入）。**单向只治一半**（只钳池深时 `waterLevel=0.01` 仍穿地），故 `waterLevel` 默认同步从 0.01 抬到 0.15——别把预算卡死成平面'
  - '**泡沫通道已删（ADR-319 D3b，2026-10-04）**：旧判据 `smoothstep(0.0, -0.25, J)` 要求 `J ≤ 0`（波面自交），与 `Σσ·k ≤ 0.8` 的防自交钳制互斥——探针实测 `choppiness=0.5` 时 `J_min = 0.656`、拖满 1.0 时 `0.379`，**`J ≤ 0` 占比恒 0.00%** ⇒ `vFoam` 恒 0，每顶点白算三项 Jacobian、每片元白跑一次 mix。现已**整条退役**（varying + Jacobian 三项累加 + mix 全删），shader 内无 foam 残留；别按「水面该有白沫」去调 foam 系数，也别把旧通道接回来——原判据（`J ≤ 0`）仍是死通道；要做泡沫须按 ADR-319 D3(a) 重新设计判据与归一（新尺度下 `Σσ·k = 0.8·choppiness`，拖满时 `J_min = 0.379`）'
  - '**频谱锚点错配已修（ADR-319 D2，2026-10-04）**：旧式 `freq = 0.25·1.19^i` ⇒ λ 钉死 [10.53, 25.13] m，而采样可呈现窗口是 `λ ∈ [6·size/segments, size/2]`（`size=10` 六波全超域宽、`size=300` 六波全被 aa 淡出，滑杆展示域却是 10–300 m）。现 `freq = 2π·1.19^i·4/uSize` ⇒ `λ_i = uSize/(4·1.19^i)`，每波长顶点数 = 分段数/(4·1.19^i) **与 uSize 无关**，全域六波恒落窗口内（探针尺寸域扫描：size ∈ {10,20,40,80,160,300} 峰谷差/越壁/穿地/窗口内条数全部不变）。ADR-272 加的「每波长顶点数淡出」治的是**采样不足**，不治**锚点错配**——两者是两笔账，勿混为一谈；锚点归一后淡出成为纯保险（六波全在窗口内时恒为 1）'
  - '**shader 注入检测已补齐六锚点（2026-10-04 修复 `7214b629c`）**：`water onBeforeCompile` 现检六处——vertex 的 wave 函数 / beginnormal 的 `objectNormal` 覆盖 / **begin_vertex 位移锚点 `transformed.z += gdisp.z`** / fragment common 独有串 **`uniform sampler2D uReflTex`**（不再查同时出现在 common 声明与 dithering 引用两处的 `uRoundness`）/ 微细节 `normal` 覆写点 / 倒影混合块。原两条洞（位移注入无锚点、`fragOk` 因重复串漏报）已当日收口——**别再按旧描述去"修"已修好的东西**。剩余同族项只有「`gerstner()` 每顶点算两次」（beginnormal 取 nrm、begin_vertex 取 disp，各丢一半输出，非阻塞；两条 chunk 间无 chunk 改 `position` 的判断须在升级 three 时重验）'
  - '**顶点波场被算两次（2026-10-04 子代理审计，待议）**：`gerstner()` 每顶点调两遍——`beginnormal_vertex` 里算只取 `nrm`（丢弃 disp），`begin_vertex` 里算只取 `disp`（丢弃 `nrm`，形参名 `gWaveNormalUnused` 即自证）。6 波 × 64² 顶点 × 2 ≈ 49k 次三角函数对/帧，非瓶颈但是白算。两 chunk 在同一 `main()` 作用域、中间无 chunk 改 `position`（morphnormal/skinbase/skinnormal/defaultnormal/normal_vertex 均只读 objectNormal），可合成一次：beginnormal 内算 disp 存局部、begin_vertex 直接 `transformed += disp`。与上一条「注入检测有洞」是同一处代码的两面，一并议'
  - 结构参数只能动 `transformLinks`（`square` 等比铺满 / `wall` 双轴：x = size、y = 壁高 + 外偏沿法向轴）：**y 轴不得被 size 缩放**（`wallH` 由 h / t 现算，与 size 无关），否则壁高与壁厚会被尺寸连带放大
  - '**（已修复 2026-09，ADR-272 §5.1）** pool 的 waterPoolHeight / waterPoolWallThickness 曾走全量重建（wall 的 y 尺寸与外壁偏移烘焙进几何）——拖动即每帧重建 10 个 mesh。现壁几何单位化：壁高走 `scale.y`、外偏 = `size/2 + t` 运行期现算。教训：**任何结构参数只要被烘焙进几何，就必然在滑块拖动时变成重建风暴**'
  - waterSize 值域：合法域 [1, 300]（下界来自「0/负数会让水面退化成一个点」）、展示域 10–300；钳制在 `setEnvState`（ADR-283），shader 侧另有 max(uSize, 0.001) 兜底
  - 圆角裁剪用世界坐标 max(|x|,|z|) 对比 uHalfSize，隐含「水面恒在世界原点」这一假设——已登记（2026-09-20），2026-10-04 已补测试钉子（`水面 root 恒在原点` describe：film/pool 切换 + 水位/尺寸/池深变更均不移动 root 的 xz）。若未来支持移动/放置水面（脱离原点），圆角裁剪会静默把整块水面裁成隐形，需先改为相对水面自身中心的局部坐标
  - '⏰ 升级 three ≥ r190 前必读：buildWaveWaterMaterial 的 assertRevisionRange allowed 窗口为 [185,190)（water-capability.ts）——r190 起 water 材质构造会故意 throw（registry 工厂兜底使 cap 缺失，拒绝静默降级）。升级时须重新审计 wave shader 注入的 chunk 锚点（common / normal_fragment_maps 在 onBeforeCompile 期仍存在）后收窄/前移窗口，不可无脑放行'
  - '**透明度预设失效（已修复 2026-09）**：`applyChangedParams` 中 `waterOpacity` 变更路径只更新 `top.material.opacity`，漏同步 shader uniform `uBaseOpacity`。shader 用 `min(gl_FragColor.a, uBaseOpacity)` clamp 透明度，`uBaseOpacity` 固化在构建期，导致增大 opacity 不生效（减小偶然正常）。修复：补调 `syncBaseOpacityUniform`，与 `waterWetness` 路径同口径'
  - '**派发键是类型化键域（2026-09）**：`EnvCallback.changed` 为 `Set<EnvStateKey>`，`changed.has("拼错")` 编译不过；新增参数必须先在 `env-state-schema.ts` 声明（含 `group: "water"`），否则派发链与持久化都抓不到它'
  - '**water 持久化由 schema 派生**：`saveState` 遍历 `getPresetKeys("water")`（不再手抄键表）；写侧统一 `water*` 规范键，历史键名 `size` / `pool*` 由 `loadState` 双轨吸收——新增参数只需进 schema，读侧按需补别名。**legacy 别名还原表是带退役时钟的兼容层**（锐评 P1-2）：新存档恒为纯规范键（legacy 分支只在「water 键无存档」时读 ground 旧记录），用户任一次 saveState 刷新后即永久走新记录——该表**只减不增、不得新增别名**，退役判定 = 用户面 legacy 存档刷新周期届满（发布一个维护周期后），届时整表连同 ground legacy 解包段一起删，勿长期挂着无时钟的兼容层'
  - '**uniform 一律经 `setUniform(mat, name, value)` 写入**（原五处 `as unknown as { userData.shader }` 深挖已收口）：`onBeforeCompile` 未跑或 uniform 名拼错时静默跳过，故改动后须以「uniform 实际取到值」的断言兜底，不能只断言 envState'
  - '**uniform 名唯一登记 = `water-capability.ts|WATER_UNIFORM_NAMES`（锐评 3.1，2026-09-23）**：`setUniform` 的 name 形参收窄为 `WaterUniformName`（该表的类型投影），onBeforeCompile 注入的 uniform 集与登记表双向对账（测试「注入 ⊆ 登记 ∧ 登记 ⊆ 注入」）——新增 uniform 忘登记即红，拼错统一名编译期即红，不再是 string 黑洞'
  - '**RT 重建死区（锐评 3.5，2026-09-23）**：`ensureReflector` 的 clipBias 比对带容差 `REFLECTOR_CLIP_BIAS_TOLERANCE = 0.05`——|Δbias| < 0.05 视为未变、跳过弃载体重建。背景：`water-reflection-clip-bias` 滑杆 step=0.1，无死区则单次拖动触发 ~100 次 Reflector+RT 重建（几何/材质/RT 三件全建）。死区不破「bias 实质变化 → 重建」语义（F-2 的 1.5 偏离 = Δ1.5 仍重建）'
  - '**逐帧现读键的显式登记 = `water-capability.ts|WATER_FRAME_READ_KEYS`（锐评 3.3，2026-09-23；2026-10 扩容）**：`waterWaveSpeed` + ADR-297 倒影五键在分派表是空条目（无材质应用）、消费点在渲染循环逐帧现读 envState——这条路曾无人登记（维护者只能人肉 grep）。现登记表 + 契约测试锁定「登记键 ∈ 分派表 && 行为实证现读生效」（waveSpeed = [锐评 3.3] ② 用例；倒影五键 = ADR-297 用例组「水位/分辨率/强度逐帧现读」「[锐评 F-2] 弃载体重建」「[锐评 3.5] 死区」「SSR 抑制真值表」「无宿主/默认关」）。**反向闭包**：`WATER_NOOP_APPLIER_KEYS`（锐评 3.3 ③）机器派生分派表空条目全集，断言其 == 结构承接（waterEnabled/waterMode）∪ 逐帧现读表——未来加同类空键必须二选一登记，否则契约红'
  - '**值域改一处生效（ADR-283）**：滑杆 `min/max/step` 由 `getParamRange(key)` 从 schema 取，cap 内不再有值域字面量；写侧钳制在 `setEnvState` 唯一入口。改范围请改 `ENV_STATE_SCHEMA.xxx.range`（合法域）/ `uiRange`（展示域），**不要在 menu 或 setter 里写死**'
  - '**setter 不再 clamp（ADR-283）**：`setWaterOpacity` 等一律只 `setEnvState({...})`；若要加保护请补 schema `range`，写回 setter 即造出第二事实源'
  - '**水面开关单门（2026-09-22，fog 先例同法）**：启停唯一真值源 = `envState.waterEnabled`，`SceneCapability.setEnabled/isEnabled` 是其别名出口。原私有 `this.enabled` 为僵尸门——registry ctx 无 `enabled` 字段 ⇒ 生产恒 true、无任何 UI 写口、却经 saveState 持久化幽灵键；且 `loadState` 首段曾把 ground 嵌套 legacy 的 `water.enabled` 直写进它：**中毒即永久锁死水面，菜单开关显示 ON 也救不回**。现私有字段退役（守卫 = 测试断言 `"enabled" in cap === false`），幽灵键不再落盘也不再消费，同一存档翻开关即可复现'
  - '**含开关键的批次派发不得早退吞键（2026-09-21 修复）**：回调曾 `changed.has("waterEnabled") → syncWaterVisibility → return`，同批其余 water 键的材质/transform 应用被整体跳过——envState 已新、渲染体仍旧（画面与状态脱节直到下一次无关派发）。现参数照常逐键派发、可见性统一在派发尾重算；守卫 = 测试「waterEnabled + 参数同批派发」用例。往回调里加任何「单键早退 return」前先想清楚同批其余键谁负责'
  - '**形态门控必须「构造期 = 运行期」同源（2026-09 修复）**：`uRoundness` 构造期靠 `buildMaterial` 的 `forPool` 对 film 恒 0，但分派表 applier 侧曾漏门控——pool 专属参数 `waterPoolRoundness` 经存档恢复 / 预设套用 / 其他 cap 直写 envState 时会把圆角泄漏进 film 材质（水膜四角被凭空裁掉，恰是构造期明令禁止的行为）。现由 `WaterBodyStrategy.supportsRoundness` 显式声明（film=false / pool=true）并在 applier 查 strategy。**教训：同一门控只写在构造期，运行期迟早从另一条路径漏进 uniform**——新增形态旗标时构造期与运行期必须共用'
  - '**倒影三坑（ADR-297）**：① RT 渲染期间水根必须隐藏——不隐则 pool 顶面 transmission pass 在镜像通路里再渲一遍水体（嵌套整场渲染 + 双层水）；② 官方 textureMatrix 末位乘了 scope.matrixWorld（输入=镜面局部坐标），水 shader 喂世界坐标必须右乘 M⁻¹ 剥回，直乘会双重变换；③ 反射相机视锥内容不受 render-host 主相机剔除管辖（RT 渲发生在 cullModelGroups 之前），掠射角下官方「背对早退」跳帧、倒影边缘缺块属已拍板已知限制（见 ADR-297 §3），勿当 bug 修'
  - '**倒影门控是逐帧现读，不是派发驱动**：`waterReflectionEnabled/Strength/Resolution/ClipBias/ReflectDisableWhenSSR` 在分派表里是显式 no-op 声明（与 waterWaveSpeed 同口径）——门控/权重/RT 边长/镜面高度/裁剪偏置全在 `renderReflection / ensureReflector` 现读 envState 落地。别给它们补材质写（双写违 ADR-286），也别给 pp 键补订阅（SSR 抑制真值现算即可，多订一路 = 第二真值源）。**唯一的现读特例（锐评 F-2）**：clipBias 烘在官方 Reflector.onBeforeRender 闭包里不可就地改，`ensureReflector` 以 `reflectorClipBias` 字段比对现读值——不一致即 `disposeReflector()` 弃载体、下拍懒建重建（低频参数，接受重建成本；bias 变更是离散动作非拖拽风暴）'
  - '**SSR 活跃判定单源（锐评 F-1，2026-09-23）**：`state/env-state.ts|isSsrRenderActive()` = `ppEnabled ∧ ppReflectionMode ≠ envmap-only`，是「SSRPass 此刻真在渲染」的唯一判别式——pp `applyReflectorSync`（压地面镜）与 water `reflectionActive`（跳水面镜像）两处消费。此前两处各手抄一份、pp 侧还随 R-1 血案（关 pp 仍白压镜子）演化过一次——手抄判别式即分账隐患。改 SSR 语义只动这一个纯函数，勿再抄第三份'
  - '**倒影 RT 内容线性、无 tone map**（three 仅对 canvas 输出做 tone map）：dithering 段底色已过 colorspace，采样值必须过 `linearToOutputTexel` 再混——直接混 linear 进 sRGB 域会让倒影发黑'
  - '**波场采样密度 ≡ 几何分段数，两处必须同源（2026-09-22 治大水面摩尔纹）**：顶水面网格分段固定（唯一事实源 `water-state.ts|WATER_WAVE_SEGMENTS`），顶点间距 s = waterSize/分段数——s 逼近波长一半（奈奎斯特）时高频波混叠成游走摩尔纹（300 m 水池高频频闪的病灶）。gerstner 逐波按「每波长顶点数 λ/s」淡出振幅（≥6 全留、2–6 线性消退；1‰ 下界只保 aa 非零——**不保 wa>0**，wa 的除零由退化门 `water-state.ts|WAVE_DEGENERATE_WA` 承接）；位移/解析法线/泡沫 Jacobian 同源于 amp，一处衰减三处一致。**D2 锚定域宽后 λ/spacing = 分段数/(4·1.19^i) 与 uSize 无关，segments=64 时六波最小 6.70 ≥ 6 ⇒ 本淡出当前恒为 1（惰性保险，非活功能）**，分段数压到 ≤57 才会真正淡出高频——数值判据见 `water-capability.test.ts` 的「波场守卫的真实性」describe（含"通道不是死代码"的反证）。改分段只动常数一处（几何装配与 shader 间距推导都读它，守卫 = 「分段数唯一事实源」用例）；调大 = 高频保留更好但三角数平方上涨，调小 = 消隐提前介入。注意此衰减治的是「采样不足」，`min(…, 0.5)` 抹平振幅级数是另一笔已登记未改的账'
  - '**静水态曾产出 NaN（2026-10-04 修复，锐评 P0-1）**：`amp = uWaveHeight·0.26·0.82^i·aa`，而 `uWaveHeight` 可为 0——浪高滑杆 min=0、水位归零、pool 下水位 ≥ 池深，都会让 `water-params.ts|effectiveWaveHeight` 的预算归零。此时 `wa = freq·amp = 0` ⇒ 陡度式 `0.8/(wa·6)` 得 +∞ ⇒ `steep·amp = ∞×0 = NaN` ⇒ `transformed` 与 `objectNormal` 双双污染 ⇒ **水面整块消失**（用户拖浪高到 0 想要静水，得到「水没了」）。修复 = shader 波场内退化门 `if (wa <= WAVE_DEGENERATE_WA) { continue; }`（阈值单一事实源 `water-state.ts`，shader 内插、探针 `buildWaves` 同门）——跳过后 nrm 保持 (0,0,1)、位移为 0 = 平面水 + 正确法线，静水态这才真正可达。⚠️ 原注释与知识卡宣称的「1‰ 下界保 wa 恒 > 0」**是假不变量**：该下界加在 `aa` 上，amp 本身已是 0 时救不了 wa（已随本轮订正）'
  - '**水平摆动曾随水面尺寸漂 30 倍（2026-10-04 修复，锐评 P1-1）**：D2 让 λ ∝ uSize，而 Gerstner 的水平位移 `steep·amp ∝ 1/freq ∝ uSize`、且与浪高解耦 ⇒ 同一浪高在 size=10 与 300 下水平摆动差约 30 倍（探针改前实测 0.036 m ↔ 1.091 m，而垂直总振幅恒 0.060 m）——大水面被「横向揉皱」。修复 = `steep` 乘基准反归一 `water-state.ts|WAVE_STEEP_SIZE_REF/uSize`（基准 = schema `waterSize` 默认 80，同值守卫在其测试内）：默认档观感零变化，`size ≥ 80` 域水平摆动恒定（探针域宽扫描六档恒 0.650 m），`size < 80` 由自交上界 `WAVE_STEEP_SUM_LIMIT/(wa·N)` 接管——那是物理约束（波长太短本就不允许那么大水平摆动），不是公式漂移。⚠️ 别为「让两端完全相等」去突破自交上界'
  - '**存量存档吃掉 D1 的默认抬升（2026-10-04 修复，锐评 P1-4）**：`saveState` 遍历 schema 键集恒写 `waterLevel`，而 ADR-319 D1 把默认从 0.01 抬到 0.15 ⇒ 老档把旧默认原样带回、预算被钳到 1 cm（「浪死平」观感原样保留），收益只覆盖新装 / 清过档的用户。修复 = 存档带版本戳 `water-migrations.ts|WATER_SCHEMA_VERSION_KEY`（唯一消费者是 loadState 的迁移判据，**不是参数键**、不入 schema）+ 纯函数 `migrateLegacyWaterLevel`：只有「无版本戳 ∧ 水位**严格等于**旧默认 0.01」才迁到现默认，带戳新档一律不动（用户可自由设 0.01，save/load 往返恒等）。**新增存档键必须自证有读侧消费者**——本键的消费者就是 loadState 那三行'
  - '**形态门控只许能力旗标，禁止 id 字符串现判（2026-10-04 修复，锐评 P2-2）**：`effectiveWaveHeight` 的上钳（波峰不越壁顶）曾在三处按形态 id 现判、构造期还用 `forPool` 兼职——而 `WaterBodyStrategy` 的设计承诺是「新增形态 = 注册一项、现有实现零改动」，id 现判让新形态（ocean 等）**静默走无壁分支**（浪漫过容器、编译器一言不发）。现 `hasWallCeiling` 进策略接口（与 wetnessGated / supportsVolumeOptics / supportsRoundness 并列），`WaterBuildContext.buildMaterial` 的 `{ forPool, hasWallCeiling }` 两维刻意不合并（未来 ocean 可能「有体积光学但无壁」）；守卫 = 旗标断言 + **源码扫描闸**（水源码文本内不得出现按 id 现判 pool 的模式——注释里写该字面量也会被闸住，改用文字描述）'
  - '**死代码与自证式测试（2026-10-04 修复，锐评 P3-1/P3-2）**：① `disposeWater` 曾读 `material.transmissionRenderTarget` 手动释放——该属性在 three r186 的 `MeshPhysicalMaterial` 上**不存在**（真身在 renderer 侧 `renderState.state.transmissionRenderTarget[camera.id]`，由 renderer 按相机持有与清理），生产路径恒不触发；锁它的用例靠测试**自己伪造该字段**再断言被释放（自证式假绿），已随死代码一并删除。② 官方 `Reflector.dispose()` 只放 RT + 材质、**不放构造期传入的几何**——`disposeReflector` 补具名释放，注释从「RT + 材质 + 几何具名释放」（当时不实）改为事实描述。③ `renderReflection` 的 `camera.updateMatrixWorld()` 备注曾称「否则镜像滞后一帧抖动」——RT 渲在 render-host 的 caps.update 段、早于本帧相机输入，该行只保证「矩阵不落后于属性」、消除不了跨帧输入滞后，注释已订正。教训：**「注释承诺 > 实现」是本仓最重视的漂移**；给「已释放 / 已处理」写断言前，先查上游源码到底释放了什么'
  - '**滑杆值 ≠ 生效值：必须给出口（2026-10-04 修复，锐评 P1-2）**：浪高滑杆值受水位 / 池深预算钳制（`water-params.ts|effectiveWaveHeight`），默认档 0.15→1.0 整段拖动**毫无反应**（85% 死区）却无任何解释。修复 = slider 臂补 **hint 槽位**（动态 `getHint` 优先、静态 `hintKey` 回退；`getHint` 由 button 专属提升为通用通道，渲染于 label 右侧小字），浪高显示「实际生效 X m」。⚠️ **刷新顺序是坑**：`onChange` 内 `updateDisplay(n)` **先于** `v.setValue(n)`，而 hint 读 cap 状态 ⇒ 只在 `updateDisplay` 刷会**滞后一步**（显示上一拍的值）；须在 `setValue` 之后补刷（numeric 输入路径同）。新增任何「值 ≠ 生效值」的参数时，先问：用户从哪里知道实际生效多少'
  - '**可见性单门 + 一形态一旋钮（2026-10-04 修复，锐评 P2-1）**：① 水面可见性曾与 film 的 `wetness > 0` 相与——把「水膜浓度」拖到 0，一级行 master 开关仍显示 ON 而场景无水（对开关撒谎，与 fog/reflector 已治的同族病）；现收归**单门** `envState.waterEnabled`。② film 的 alpha 曾 = `opacity × wetness`（两个旋钮一个自由度，用户不知该转哪根）；现 **film 下隐藏 `waterOpacity`**，浓度由 wetness 独占 ⇒ 一形态一旋钮。③ 旗标 `wetnessGated` → `wetnessScalesOpacity`（它已不再管可见性，名字必须跟着语义走）。**判「两参数是否重叠」的方法** = 问「能不能构造两组不同取值而画面完全一致」（`(0.5,0.5)` vs `(0.25,1.0)` 即实锤）。另：旧用例「film wetness=0 → 不可见」在 `waterEnabled` 默认 false 下**恒真**（从未开水）——**改默认值会让老断言变成恒真**，改默认时须回扫本 cap 全部断言'
  - '**倒影 RT 的 MSAA 是隐形成本（2026-10-04 修复，锐评 P2-3）**：three 上游 `Reflector` 默认 `multisample = 4`（构造参数缺省），叠加 half-float ⇒ 2048 档约 **134 MB**（本仓 schema 原先只按分辨率档计价，读者易以为 33 MB）。现 `water-reflect.ts|ensureReflector` 显式传 `multisample: 0`：实付 ≈ 边长²×8B（512 档 ≈ 2 MB / 2048 档 ≈ 33 MB）。倒影经水 shader 斜率扰动采样 + fresnel 混合，边缘抗锯齿的边际收益不抵这笔显存/带宽。行为断言 = `getRenderTarget().samples === 0`（**别只断言源码里写了 multisample**）'
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
   顶点同时水平 + 垂直位移（波峰尖、波谷平）；解析法线（GPU Gems 1 ch.1）覆盖 `objectNormal`。
   方向/相位由 wave index hash 播种，陡度钳制 `Σσ·k ≤ 0.8` 防自交；**退化门**（锐评 2026-10-04 P0-1）：
   `wa = freq·amp` 低于 `water-state.ts|WAVE_DEGENERATE_WA` 的波整波跳过——静水态（浪高/水位归零）由此
   得到「平面水 + 正确法线」，而不是修复前的 `∞×0 = NaN`（顶点与法线双污染、水面整块消失）。
   水平位移另有**基准反归一**（锐评 2026-10-04 P1-1）：`steep` 乘 `WAVE_STEEP_SIZE_REF/uSize`，
   使水平摆动与水面尺寸解耦（默认档观感零变化）。
   **量纲约定（ADR-319 D1/D2）**：振幅 `amp = uWaveHeight·0.26·0.82^i`（Σamp ≡ 用户浪高，入 shader 前经
   `water-params.ts|effectiveWaveHeight` 双向往容器钳制）、频率 `freq = 2π·1.19^i·4/uSize`
   （λ 锚定域宽，每波长顶点数与 uSize 无关）——两者都随用户量与水面尺寸归一，不再钉死世界米制。
   **泡沫通道已整条删除**（ADR-319 D3b）：判据与防自交钳制互斥、`J ≤ 0` 占比恒 0.00%，
   `vFoam` varying / Jacobian 三项累加 / mix 全退役，shader 内无 foam 残留——别按「水面该有白沫」去找系数。
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
   `Record` 对 water 组全键编译期强制表态（`waterEnabled`/`waterMode`/`waterWaveSpeed` 及 ADR-297 倒影五键
   为显式 no-op 声明，共享 `NOOP_APPLIER` 同一函数身份），
   **新增 water 参数 = schema 声明 + 表内加一条目，漏接编译期即红**；条目间写互不相交字段，
   派发序无关结果（守卫测试：乱序全量 patch ≡ 单键逐发快照一致）。
   原 `findTopWater`/`syncBaseOpacityUniform` 私有 helper 已随瀑布退役（顶水面恒为 `water.top`）。
   **uniform 名唯一登记** = `WATER_UNIFORM_NAMES`（`setUniform` 形参即其类型投影，拼错编译红；
   注入集与登记表双向对账测试），**逐帧现读键**（无材质应用、消费点在渲染循环逐帧现读）= `WATER_FRAME_READ_KEYS`
（`waterWaveSpeed` + ADR-297 倒影五键；waveSpeed 由 `update` 无条件累加，倒影五键由
`renderReflection / ensureReflector` 现读、宿主缺席时子系统整体失效）。
**反向闭包机检**（锐评 3.3 ③）= `WATER_NOOP_APPLIER_KEYS`（NOOP_APPLIER 身份命中，机器派生）：
断言「分派表空条目全集 == 结构承接（waterEnabled/waterMode，回调承接）∪ 逐帧现读表」——
新增空键必须二选一登记，漏登记契约即红。
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
   **clipBias 变更 = 弃载体重建，但带死区**（`REFLECTOR_CLIP_BIAS_TOLERANCE = 0.05`）：|Δbias| < 0.05
   视为未变跳过重建——bias 烘在 Reflector 闭包不可就地改，但滑杆 step=0.1 无死区会触发重建风暴；
   Δ≥0.05 仍重建（观感实质变化）。

## 对外 API / 入口

- 能力开关：`setWaterEnabled` / `getWaterEnabled`（菜单 id `water-enabled`，cap 的 master node）——**单门**：SceneCapability 的 `setEnabled/isEnabled` 是其别名，真值源唯一 `envState.waterEnabled`（2026-09-22 私有门退役，fog 同法）
- 形态：`setWaterMode` / `getWaterMode`；水位：`setLevel` / `getLevel`（**跨形态通用，零重建**）
- 尺寸：`setWaterSize` / `getWaterSize`（菜单 id `water-size`，展示域 10–300 m / 合法域 ≥1；**跨形态通用，零重建**，ADR-272 + ADR-283）
- 外观：`setWaterColor`、`setWaterOpacity`、`setWetness`、`setNormalStrength`、`setClarity`、`setChoppiness`
- 池体：`setPoolHeight`、`setPoolWallThickness`（**两条均零重建**，ADR-272 §5.1：壁高走 `scale.y`、外偏与光学光程运行期现算）、`setPoolWallColor`、`setPoolRoundness`（钳制同源 schema `range`，ADR-283）
- 波纹：`setWaveSpeed`、`setWaveHeight`（ADR-319 D1：入 shader 前经 `water-params.ts|effectiveWaveHeight`
  **分形态容器钳制**——`uWaveHeight` 恒为 `min(waterWaveHeight, 下钳)`，下钳 = film 时 `waterLevel`、
  pool 时 `min(waterLevel, waterPoolHeight − waterLevel)`（上钳防越壁**仅 pool**，film 无壁无上钳；
  值域仍由 schema `range` 唯一给）；时间推进走 `update(dt)` 累加
  `waterTime`（仅推进 uniform，从不写变换）
- 倒影（ADR-297）：`setWaterReflectionEnabled` / `setWaterReflectionStrength` / `setWaterReflectionResolution` /
  `setWaterReflectionClipBias` / `setWaterReflectDisableWhenSSR`（getter 同名 get* 族）。构造 opts 含可选 `renderer`/`camera`（registry 传
  全量 ctx；缺省 = 倒影自动失效，单测可裸 scene 构造）。五键均 schema `group: "water"`——持久化写侧自动、
  读侧已登记还原表（D3 契约锁兜底）；reflect 组五控件在 `water-menu.ts`（主开 + 强度/分辨率/裁剪偏置/SSR 抑制四从控），从控按主开 visibleWhen
  出场（探针路径 `env.waterReflectionEnabled`，ADR-291 三步登记）。**clipBias**（锐评 F-2）原为 ensureReflector 裸字面量 3，现下沉 schema 键（默认 3，range 0–10），
  补 `water-reflection-clip-bias` 滑杆出口（避免复刻 R-1「持久化活、菜单缺席」）
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
- **波形命题用数值断言，不用字符串断言**（ADR-319 D4）：本轮三个真缺陷（浪高失控 / 泡沫恒 0 /
  频谱锚点错配）全是 `toContain("disp.z += amp * s;")` 这类字符断言放过去的——它们改个格式就红，
  却对「峰谷差是否超出容器预算」「`J` 是否可达」「六波是否落在可呈现窗口内」一言不发。
  改波场时先跑探针取数，再把结论落成数值用例。
- **守卫得是真守卫**（锐评 2026-10-04 P1-3）：波场里三条「每帧计算、条件恒不成立」的量——`aa` 淡出
  （segments=64 时六波 λ/spacing 最小 6.70 ≥ 6 ⇒ 恒 1）、`steep` 的 clamp（choppiness ∈ [0,1] 时输入
  恒在 [0, 上界] 内）、`aa` 的 1‰ 下界——都已配**数值断言**说明「当前惰性、何时生效」，不再靠
  `toContain` 字符断言假装它们在保护（守卫 = `water-capability.test.ts` 的「波场守卫的真实性」describe，
  含「通道不是死代码」的反证：segments=32 时 aa < 1、choppiness=2 时 Σσk 被钳回 `WAVE_STEEP_SUM_LIMIT`）。
  判据：**写守卫时必须回答「它在什么条件下真正触发」，并把该条件写成数值断言**；答不上来的守卫要么删，
  要么转成纵深防御并注明边界。波场三个阈值常量（退化门 / Σσk 上界 / aa 双阈值）住 `water-state.ts`
  并被 shader 模板内插——改常量即改 shader，菜单/测试/探针都只是读口。
- **波陡基准与水面尺寸解耦**（锐评 2026-10-04 P1-1）：`steep` 在自交 clamp **之前**乘
  `water-state.ts|WAVE_STEEP_SIZE_REF / uSize`——基准常量必须与 `ENV_STATE_SCHEMA.waterSize.default` 同值
  （断言 = 「基准常量与 schema waterSize 默认同源」），改一处忘另一处即红。自交上界
  `WAVE_STEEP_SUM_LIMIT/(wa·N)` 仍是物理天花板：小尺寸下由它接管，**不得为「视觉一致」突破它**
  （判据 = 探针 ④ 段域宽扫描：`size ≥ 80` 六档恒 0.650 m，`size ≤ 40` 递减）。
- **形态能力一律由 `WaterBodyStrategy` 旗标声明**（锐评 2026-10-04 P2-2）：`wetnessScalesOpacity` /
  `supportsVolumeOptics` / `supportsRoundness` / `hasWallCeiling` 四维各自独立、构造期与运行期共用同一旗标；
  **下游禁止按形态 id 现判**（源码扫描闸兜底，注释里的同形字面量也算违规）。新增形态只需注册一项并声明旗标——
  漏声明是编译红，不是静默降级。
- **用户可见值与生效值不一致时，必须给出口**（锐评 2026-10-04 P1-2）：钳制 / 派生 / 预算收窄造成的
  「滑杆拖了没反应」不许静默——slider 的 hint 槽位（动态 `getHint` 优先）是标准出口，且**刷新须在
  `setValue` 之后**（`updateDisplay` 早于写状态，只在其中刷会滞后一步）。菜单 `getHint` 是通用通道
  （button 与 slider 共用），新增同类参数照此挂。
- **一个形态一根旋钮**（锐评 2026-10-04 P2-1）：film 的「水膜多明显」= `waterWetness`（浓度）独占，
  `waterOpacity` 在 film 下隐藏（pool 反之）；可见性恒为**单门** `waterEnabled`，任何参数都不得再否决它
  （判据 = 「能否构造两组取值画面完全一致」，能则两参数重叠）。
- **存档版本戳是旧档迁移的唯一开关**（锐评 2026-10-04 P1-4）：`water-migrations.ts|WATER_SCHEMA_VERSION`
  随 `saveState` 落盘、只被 `loadState` 的迁移判据消费；迁移只认「**无戳** ∧ 水位恰为旧默认」。
  **默认值变更的两条腿 = schema `default` + 旧档迁移判据**——缺后者就等于只对新用户生效
  （ADR-319 D1 踩过：老用户存档里的 0.01 把新预算钳死）。加存档字段前先想清「谁读它」——
  幽灵键（曾被 fog/water 私有 `enabled` 咬过）不得无消费者落盘。
- **浪高入 shader 前必过分形态容器钳制**（ADR-319 D1）：`uWaveHeight` 恒为
  `min(waterWaveHeight, 下钳)`，下钳 = film 时 `waterLevel`、pool 时
  `min(waterLevel, waterPoolHeight − waterLevel)`——上钳防越壁**仅 pool 有**（film 无壁无上钳），
  **单向只治一半**。预算随 `waterLevel` / `waterPoolHeight` 现算（不是烘死在构建期），
  钳制是入参侧的一次性投影、不回写 schema 态。测试两路：shader 侧覆盖默认放行 / 超预算钳制 /
  预算随水位重算 / 与尺寸解耦；算术侧 `effectiveWaveHeight` describe 覆盖 **film 无上钳**（水位超
  默认池深时浪不死平——落地后子代理复核发现的缺陷，无条件套上钳曾把预算钳到 0）/ pool 有上钳 /
  pool 脏参数归零 / 下钳水位归零。
- **取证双通道：探针取数 + e2e 截图回看**（2026-10-04）：`scripts/probe-water-wave.ts` 出数值，
  `frontend/e2e-web/water-wave-evidence.spec.ts`（swiftshader WebGL，`waterWaveSpeed=0` 冻结波相使
  多场景同相可比）出截图——修复前取证在 `e2e-web/_shots/water-wave/`（s3 拍出「水膜浮在池壁顶沿之上」、
  s1 拍出「地面网格横穿水膜」、s2 拍出「尖度拖满仍无白沫」，与探针越壁 33.17% / 穿地 49.14% / J 不可达
  逐条对上），ADR-319 落地后的六场景回归取证在 `e2e-web/_shots/water-wave/post319/`（含 s2「浪高拉到
  上限仍被钳住」），两组并排可对照。**数值命题只信探针，视觉命题只信截图**；两者互证才写进 ADR
  （配图已进 ADR-319 §4 数据溯源）。⚠️ **截图前的第一道假绿灯是「水没开」**：2026-10 收口把
  `waterEnabled` 默认改成 false，六张全变成拍地面——spec 须在 env 列表行点 `label.toggle` 开水
  （`waterEnabled` 是 master 节点，渲染在列表行 `headerToggle` 上、参数页经 `envCapSubNodes` 过滤掉；
  且 `.toggle input` 被样式隐藏，点 checkbox 会 stable 检查失败），并**读回 checkbox 的 checked**。
- **不存在 CPU 法线贴图**：`getNormalMap` / `generateNormalMap` / `normalMapCache` 已整体退场，
  回归时不应复活。
- **不存在能力级私有开关**：`this.enabled` / `opts.enabled` / 存档顶层 `enabled` 键已退役（单门 =
  `envState.waterEnabled`，fog 同法），回归时不应复活——测试以 `"enabled" in cap === false` 为守卫。

## 相关

- ADR-283（参数值域描述符：schema `range`/`uiRange` 单一事实源 + 钳制收口 `setEnvState`）
- ADR-319（波场尺度归一与泡沫判据可达性：浪高出参数 + 双向往容器钳制 / λ 锚定域宽 / 泡沫二选一表态 / 数值断言替字符断言）
- 量具：`node scripts/probe-water-wave.ts`（复刻 `gerstner()` 的数值探针，`--json` 可机读；退出码恒 0，不作门禁）。
  **它是 shader 的平行手抄实现**，漂移闸 = `water-capability.test.ts` 的「探针与源码同源核查」两条用例：
  ① 共享常量字面（退化门 / Σσk 上界 / aa 双阈值 / segments / 波陡基准）；② **表达式指纹成对核查**
  （D2 锚点 / D1 振幅分配 / 反归一 / 位移↔法线成对换算），并配 `replaceAll` 篡改数字的反证自证非恒真。
  改 shader 公式或探针公式的任一侧，先跑这两条
- ADR-272（waterSize 放开 UI 入口 + pool 尺寸零重建 / `sizeLinks`；§5 扩展：池深/壁厚一并零重建 + 三处接线收口）
- ADR-271（微细节法线 GPU 化，移除 CPU DataTexture 链路）
- ADR-257（水面/容器解耦 + 水体形态策略表）、ADR-255（Gerstner + uniform 化）
- ADR-196（envState 单一事实源）、ADR-195（cap 直产菜单节点）、ADR-268（env 面板归属）
- 审计：`docs/audit-water-critique.md`（2026-10-04 水面系统锐评，12 条发现 + 处置记录；本轮已修 P0-1 退化门 / P1-3 守卫数值化 / P2-5 文档订正）
- 测试：`frontend/src/preview-3d/caps/water-capability.test.ts`
