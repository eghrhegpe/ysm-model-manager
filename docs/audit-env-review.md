# 环境系统面板审查（锐评）— 进度与发现

> 目标：逐面板（天空 → 地面 → 水面 → 环境贴图 → 雾 → 反射）审查 UI 设计 + 前端接线。
> 本报告为跨轮累积：每轮完成 1–2 面板，新增小节并更新「进度」表。最终轮汇总。

## 进度

| 面板 | 状态 | 备注 |
|------|------|------|
| 模块分布统计 | ✅ 完成 | 见 §0 |
| 天空（sky） | ✅ 完成 | §1（UI）+ §2（接线） |
| 地面（ground） | ✅ 完成 | §3（UI）+ §4（接线） |
| 水面（water） | ✅ 完成 | §5（UI）+ §6（接线） |
| 环境贴图（environment/HDR） | ✅ 完成 | §7（UI）+ §8（接线） |
| 雾（fog） | ✅ 完成 | §9（UI）+ §10（接线） |
| 反射（reflector） | ✅ 完成 | §11（UI）+ §12（接线） |
| 总报告 | ✅ 完成 | §13（汇总 + 分级建议） |

## §0 模块分布统计

- 环境系统 = 3D 预览菜单 5 个 dock 组之一「🌍 环境」（`menu/engine/defs.ts` PREVIEW_MENU_GROUPS，`id:"env"`，
  directToPanel:"environment"，唯一 core 面板 `environment`，visibleWhen 依赖 `env.skyGroundCap` 状态键
  （sky/ground cap 任一挂载才显示）。
- 环境面板内部成员（ADR-268 插件式发现，`menu/panels/env.ts` collectEnvEntries 遍历
  `sceneCapabilityRegistry`，凡实现 `getEnvPlacement()` 的 cap 入选，env.ts 零登记）：

| cap | 分段（自报） | 序 | 文件 |
|-----|------|----|------|
| sky（天空） | basic | 10 | caps/sky-capability.ts + sky-menu.ts + sun-beams.ts |
| ground（地面） | basic | 20 | caps/ground-capability.ts（+ ground-surface-spec 等） |
| water（水面） | basic | 30 | caps/water-capability.ts |
| environment（环境贴图/HDR） | atmosphere | 10 | caps/environment-capability.ts + environment-menu.ts + environment-state.ts + env-pixels.ts |
| fog（雾） | atmosphere | 20 | caps/fog-capability.ts |
| reflector（反射/水面地台） | atmosphere | 30 | caps/reflector-capability.ts |

- 一级面板结构：`buildEnvSchema()`（env.ts:269）= 氛围预设 select（5 快预设
  studio/sunset/night/forest/sky，选项文本含 emoji——`<option>` 文本槽 ADR-238 豁免）
  + 两张可折叠卡（env-card-basic / env-card-atmosphere）；卡内每 cap 一行
  （icon+label+行尾 headerToggle 能力总开关+整行 navigate 下钻），下钻子视图渲染该 cap
  的 getMenuNodes() 全树（剔除 master 节点防双开关）。
- 状态层（统一 ADR-196）：`state/env-state.ts`（envState 单例 + setEnvState 中央写入 +
  lastWriteSource 守卫 manual > auto-atmosphere > auto-model）、`state/env-state-schema.ts`
  （字段声明 + 值域钳制唯一入口）、`state/env-dispatcher.ts`（回调注册/组过滤/挂起）、
  `state/atmosphere-presets.ts`（5 氛围预设 = `Partial<EnvState>` 完整快照）。
- 守卫测试：env.test.ts 尾部「守护」describe 遍历 6 cap 的 prototype 锁死
  getMasterNodeId/getEnvPlacement 声明 + 分段/序 + master id 集合。

## §1 天空（sky）— UI 设计锐评

**位置**：环境面板 basic 卡第 1 行 → 下钻 sky 子视图
（`caps/sky-capability.ts:getMenuNodes` → `sky-menu.ts:buildSkyNodes`）。

### 布局
子视图自上而下：①光影时间轴（timeline 复杂控件，`cap-controls.ts:renderCapTimeline`）
②「环境光遮蔽」toggle（sky-env，`preview.environmentMapping` = IBL 联动开关）
③「高级」folder（云量 / 太阳底色耦合 / 太阳盘白光 / 昼夜循环 / 光束 共 5 项）。

### 发现的问题（S1-x）

1. **S1-1【UX】高级 folder 默认折叠 → 云量藏得太深。**
   云量（sky-cloud）是普通用户最高频的天空参数（预设也直接调它），却与
   太阳耦合尺度、光束等冷门项一起塞进默认折叠的「高级」。用户想调云要先点开高级。
   建议：云量提级平铺（与 sky-env 并列），高级仅留 4 项。

2. **S1-2【UX】能力总开关与子视图开关的视觉分裂。**
   一级行 headerToggle 绑 `sky-enabled`（cap.isEnabled/setEnabled），下钻后子视图
   里 sky-enabled 节点又被剔除（envCapSubNodes 按 master id filter）——设计对，但
   回退路径靠用户记得点 back；行尾开关关掉后，子视图仍停留在参数页且各控件仍可调
   （调完看不见效果，cap 未 apply 时 uniform 不写）。至少可在子视图顶部加「能力已关」
   的 sectionTitle 提示，或 setEnabled(false) 时把控件置灰。

3. **S1-3【UX】timeline 只读 HH:MM 数字 + 色带，无昼夜分段刻度。**
   `cap-controls.ts:449-454` 渐变 stops 硬编码 5 个色（#04060f/#1a2b4a/#9bc4e8/#ff8a5c），
   与真实天空色（Preetham 天空 + 云量/浑浊度）无耦合——色带永远是「标准一天」，
   但高 turbidity/云量下实际天空观感差异巨大，色带误导。marker 用
   `sin((h-6)/12*π)` 算 y，夜间（0-6/18-24）dayProg 为负 → marker 沉到色带下半，
   与「夜间太阳在地平线下」语义 OK，但 0h 与 24h marker 位置相同（wrap 无缝）。
   建议：色带按当前 turbidity/cloudCoverage 微调，或至少标注 6/12/18 三条刻度线。

4. **S1-4【UX】「环境贴图映射」toggle 标签语义漂移。**
   `preview.environmentMapping`（zh-CN: "环境贴图"）在 sky 子视图里实际语义是
   「天空 IBL 联动」（scene.environment = sky PMREM），与 atmosphere 卡里
   EnvironmentCapability（HDR 预设）抢写同一 scene.environment 通道。两卡各开各的
   总开关，但 scene.environment 只能归一人——sky 开了 IBL 时环境贴图 cap 的
   useAsBackground 贴图会被 sky 的 PMREM 覆盖/反向被 clearEnvironment 清空，
   用户看到两个面板都有「环境」开关却互相打架。建议：sky 子视图该 toggle 标签改为
   「天空 IBL」并在 description 写明与环境贴图 cap 的互斥关系，或做联动（开 sky IBL
   自动关 env cap 的 useAsBackground）。

5. **S1-5【UX】godRays 默认关 + 强度曲线隐藏逻辑。**
   `sun-beams.ts:godRaysIntensity` 仅 0°<elevation<20° 激活，用户开了 godrays 却正午
   调太阳 → 毫无反应（强度恒 0），面板无任何 hint 提示「光束只在低太阳角可见」。
   建议在 godrays toggle 下方加 hint（已存在 skyGodRaysHint？需查 locales）或自动
   在正午打开时 toast 一次。

## §2 天空（sky）— 前端接线核查

### 数据流（已核实的通畅路径）
- 写路径：UI setter → `cap.setXxx(v)` → `setEnvState({skyXxx: v}, {source:"manual"})`
  → 值域钳制（ADR-283 唯一入口）→ dispatchEnvChange → sky cap 回调
  （registerEnvCallback 前置组过滤 "sky"+"postprocessing"）→ 双写 uniform（sky+envSky）
  → PMREM 门控（skyForceEnv / 高度角 2° 阈值）→ beams.sync。设计干净。
- 读路径：控件 get 全部读 envState 单例或实例镜像（elevation/azimuth），无二次 IPC，
  无 Go 调用（天空是纯前端 cap，零 Wails 桥——正确）。
- 预设联动：env.ts applyPreset → ATMOSPHERE_PRESETS[id] 整包 setEnvState(source
  "auto-atmosphere") → dispatcher 广播；守卫 manual>auto-atmosphere 防回写。通畅。

### 发现的问题（S2-x）

6. **S2-1【冗余/性能】timeline 拖动每帧 2 次 PMREM 重建。**
   `setTime`（默认 forceEnv=true）→ skyTimeOfDay 分支：syncSunFromTime + writeUniforms×2
   + `maybeRegenerateEnvironment`（force → 无条件 fromScene）+ beams.sync。
   用户连续拖动 timeline，每个 pointermove 帧都触发一次 PMREM fromScene
   （立方体贴图 + mip 模糊，重活）。昼夜循环已用 2° 阈值门控（update(dt) 走
   forceEnv=false），但**手动拖动路径 forceEnv 恒 true**——「拖动即见」的代价是
   高频重建。建议：timeline 拖动期间（pointerdown→pointerup）临时降为阈值门控，
   松手时 forceEnv=true 重建一次。

7. **S2-2【双写冗余】writeUniforms 全量重写 7+ uniform，changed 集只含其中 1-2 项。**
   `skyElevation/skyAzimuth` 或 `skyTimeOfDay` 变更 → `writeUniforms(this.sky)` +
   `writeUniforms(this.envSky)`（全字段盲写，含未变的 turbidity/rayleigh/mie/coefficient/
   cloudCoverage）。uniform 写值本身廉价（GLSL 侧仅标记脏），但 envSky 天空盒在
   默认 skyEnvironment=false 时**根本没挂 scene**（`!this.skyEnvironment` →
   clearEnvironment）——此时对死 mesh 双写 6 个 uniform 纯属浪费；更糟的是
   `envSky` 的 scale 构造时取自 envState.skyScale，**skyScale 变更无任何分支重建
   envSky/sky 尺寸**（schema 有 skyScale 键但 cap 回调无对应分支！见 S2-4）。

8. **S2-3【硬编码】shader 锚点 + 版本号锁定。**
   `injectSkySunScalePatch` 正则锚定 three r185 的 Sky.js fragmentShader 原文
   （`pow( vSunE * (`、`19000.0 * Fex`、`float hash( vec2 p )` 等），
   `assertRevisionRange({allowed:["185"]})` 锁死版本。三处字符串字面量与
   node_modules/three@185 源码强耦合：①锚点全中 → 注入；②锚点失配 →
   reportPatchIssue error 级留痕 + uniform 仍注册（半残状态可自愈，设计有兜底）；
   ③版本升级 → 显式抛错。这是「可控的硬编码」（守卫到位、不静默），
   但升级 three 时 sky 整个 IBL 联动的太阳解耦失效风险集中于此。
   建议：把锚点抽到独立 `sky-shader-anchors.ts`（带版本表 185/186…），
   升级时只改一文件。

9. **S2-4【接线缺口】skyScale 键有 schema 无消费分支。**
   `env-state-schema.ts:93` 声明 skyScale（default 12000，group sky），构造器
   `createSky()` 读一次 envState.skyScale 设 scale，SunBeams 构造也快照一次——
   **之后 skyScale 变更：dispatcher 里 sky 组键全枚举但回调无 `changed.has("skyScale")`
   分支**（核查 sky-capability.ts 回调 L238-303：无）。任何途径改 skyScale
   （loadState/preset/中间件）都不重建天空盒，UI 上无任何 skyScale 控件
   （sky-menu.ts 5 控件无 scale），属「死键」——要么补控件+分支，要么从 schema 移除。
   （预设/中间件写 skyScale 会被静默 clamp 进 envState 但渲染层不响应。）

10. **S2-5【冗余请求】env-preset-bar select.get 每次渲染查 registry。**
    `env.ts:300` `sceneCapabilityRegistry.getById("environment")` 在 select.get
    （每次 refresh/渲染求值）里查一次注册表；buildEnvSchema 每次 refresh 重跑 →
    多 cap 订阅 menu.refresh() → 每次刷新对 getById 一次。查表本身 O(1) 无害，
    但 get() 语义应是纯读；建议 buildEnvSchema 把 envCap 引用捕获进闭包
    （entries 里已有），select.get 直接读捕获引用，省一次动态查 + 语义更紧。

11. **S2-6【冗余刷新】refresh 无合帧：N cap 订阅 → N 次全量重渲染栈顶。**
    预设 select 写 5+ 字段 → 各 cap 回调内 menu.refresh()；实测 slide-menu.ts:126
    `refresh` = 裸 `renderTop()`（无 requestAnimationFrame 合批、无去重）。
    同一 dispatch 波内 N 个 cap 订阅器各触发一次 refresh → 栈顶视图（含整个 env
    schema 重建 + DOM 重建）渲染 N 次。手动调单个 slider 通常只 1-2 cap dirty，
    危害有限；但预设应用（5+ cap dirty）或 loadState 批量恢复时 N 放大。
    建议：refresh 合帧（rAF 合并同帧多次调用为一次 renderTop）。

12. **S2-7【持久化接缝】saveState/loadState 与 envState 双轨。**
    sky cap saveState 把 7 字段写 `ysm-scene-cap-sky`（persistState），loadState
    读回再逐字段 setEnvState（source manual）。但 envState 是**模块级单例**，
    预设/atmosphere 写的 skyTimeOfDay 不落 sky cap 的 localStorage 键——
    用户应用「sunset」预设（timeOfDay=18）后关闭预览重开：loadState 读到旧键
    timeOfDay（比如 12）覆盖预设值？（loadState 在注册表创建 cap 时跑，
    先于预设应用——时序上 loadState 先、预设后，不覆盖；但**同会话内预设值
    永远不持久化**，重启即丢。属行为符合「预设是临时动作」的设计，但
    用户直觉是「我设的 sunset 应该记住」。文档级建议：预设应用时提示
    「临时氛围，关闭即还原」或提供「存为默认」入口。

## §3 地面（ground）— UI 设计锐评

**位置**：basic 卡第 2 行（order 20）→ 下钻 ground 子视图（`ground-menu.ts:buildGroundNodes`）。

### 布局
自上而下：①「地面」toggle（ground-visible，能力总开关）②「参考网格」toggle
（ground-grid-visible，与材质层/叠加层正交）③材质组 folder（mat-source select +
canvas-style「材质预设」select + 2 色 + 9 滑杆 + texture/clear 双按钮）
④叠加层 folder（overlay select + color + size + opacity）。

### 发现的问题（S3-x）

1. **S3-1【UX】「地面」toggle 与「参考网格」toggle 并列易误解。**
   ground-visible 是三层合取的上游（网格/表面/叠加层全跟随），网格 toggle 是其下
   游之一——但 UI 上两者平铺同级，用户直觉是「两个独立开关」。开地面+关网格时
   表面层仍显示（sourceKind≠none），关网格只删 GridHelper。合取语义对，但
   平铺布局暗示了错误的并列关系。建议：网格 toggle 视觉降级（缩进/次级样式）
   或并入材质组。

2. **S3-2【UX】mat-source select 的「texture」选项选了才有按钮，按钮 hint 才报文件名。**
   sourceIsTexture 谓词控制 texture/clear 按钮显隐（ground-menu.ts:98/109）——
   选 texture 后按钮才出现，但按钮在材质组中排第 7-8 位（两个 color + 三个 slider
   之后），用户选了「贴图」要滚过 5 个无效控件才看到「选择贴图」按钮。
   建议：按钮紧跟 mat-source select（顺序即动线），或 mat-source=texture 时
   自动展开并置顶。

3. **S3-3【UX】canvas-style 下拉实为「材质预设」，选项混入显示项 custom。**
   ground-mat-canvas-style（ground-menu.ts:137-156）控制 get/set 走
   getMaterialPreset/setMaterialPreset（预设语义：一次性套形状+配色），
   但 labelKey 是 preview.groundCanvasStyle（文案暗示「画布样式」）；
   且 custom 显示项在用户手改任意预设关心字段后由中间件置位——
   「选了 custom 再点别的预设」会丢失手改值，无 undo 提示。
   标签与语义错位 + 不可逆操作零提示。

4. **S3-4【UX】9 个材质滑杆按 paramIsEffective 显隐，但 folder 默认折叠。**
   参数级谓词（ground-surface-spec.ts 矩阵）设计干净；但「材质组」folder
   默认折叠 + 内部又按模式隐藏多数控件 → 用户切到 solid 模式时 folder 内
   只剩 1-2 个可见控件却仍占一个折叠头，信息密度失衡。建议：folder
   自动展开（可见子项 ≥1 时）或 solid/plain 时整组折叠。

5. **S3-5【UX】参考网格 4 参数（size/divisions/两色）不在菜单上。**
   ground-capability.ts:324-351 注释自述：此四键「早有渲染接线与持久化，却零 UI 入口，
   纯靠存档通路活着；水面尺寸滑杆（waterSize）早已可达，地面反而不能改」——
   锐评 P3 已补菜单出口（getSize/setSize…）。需核实 ground-menu.ts 是否真露出
   这四个控件（见 §4 G-1 核查结果：未露出，注释与实现脱节）。

## §4 地面（ground）— 前端接线核查

### 数据流
写路径：setter → setEnvState(manual) → ground 组回调（syncGeometry + refreshSurface
+ refreshOverlay + updateGridVisible 单出口，2026-09-20 锐评修复后已无双刷）。
值域钳制统一走 schema（ADR-283）；loadState 挂起回调 + 末尾统一落地（与 light 同构）。
材质预设中间件（ADR-254，ground-capability.ts:88-93 模块级 registerEnvStateMiddleware）：
manual 写入触碰 7 个预设字段 → 自动置 custom，来源门 + 精确白名单 + 存档恢复
skipMiddleware 豁免——设计完整。

### 发现的问题（S4-x）

6. **G-1【注释/实现脱节】「锐评 P3 补齐菜单出口」未落菜单。**
   ground-capability.ts:324-351 头注宣称 size/divisions/colorCenter/colorGrid
   「锐评 P3 补齐菜单出口 2026-09-21」，但 ground-menu.ts:buildGroundNodes 全树
   只有 visible/grid-visible/mat/overlay 四段，**无 size/divisions/线色控件**
   （已逐行核查 327 行工厂）。存档恢复了旧尺寸但用户界面上无入口——
   与 S3-5 同病。要么补 4 控件进材质组/新 folder，要么修正注释。

7. **G-2【冗余】refreshSurface 每次 ground 组变更都全量建 spec + needsRebuild 判别。**
   回调体（L135-146）对**任意** ground 组键执行 syncGeometry + refreshSurface +
   refreshOverlay + updateGridVisible 四连——包括 groundMatColor 这类纯外观键
   （无需几何同步）与 groundOverlayOpacity（surface 重建判别空转）。
   groundSurfaceNeedsRebuild 判别兜底了不重建，但每次仍构造 spec 对象 +
   token 字符串比较。频率 = 滑杆逐帧（matOpacity 等 oninput 直写）→ 主线程
   小垃圾。建议按键分组：结构键（size/divisions/颜色两键）→ syncGeometry；
   mat* → 仅 refreshSurface；overlay* → 仅 refreshOverlay。

8. **G-3【硬编码接缝】groundSize 与 waterSize 默认同值 80 但独立演化。**
   water-menu.ts:109 注释「与 groundSize 同默认值，即『水膜刚好铺满地面』」——
   两个独立 schema 键默认值巧合对齐，无机制保证。改任一侧默认值（或预设
   覆盖 groundSize）后水面不再铺满地面，无提示。建议：waterSize 默认
   声明式引用 groundSize 默认（model-defaults 层做派生），或预设快照
   同改两侧。

9. **G-4【冗余持久化】saveState 手抄 16+ 字段清单，与 water 侧不同口径。**
   ground saveState（L708-738）逐字段枚举 envState（含 enabled/visible/grid/
   sourceKind/canvasStyle/preset/overlay 系），而 water saveState（L679-683）
   用 `for (const key of getPresetKeys("water"))` schema 驱动免手抄（注释自称
   「新增参数只要进 schema，读写两侧自动跟上」）。两 cap 同一面板两套
   持久化口径——ground 手抄清单漏键风险真实存在（如 ADR-249 拆轴时
   漏 groundSourceKind 的病史）。建议 ground 对齐 water 的 getPresetKeys
   口径（cap 级 enabled 仍手写，envState 组键 schema 驱动）。

10. **G-5【体验接缝】贴图加载失败 toast 用 emoji 拼串，不经 i18n。**
    `openTexturePicker` catch 分支（L501-505）：`msg: \`❌ ${t("preview.groundMatLoadFailed")}: ${file.name}\``
    —— emoji 与结构拼在调用方，t() 只翻译片段。三语言包一致性依赖调用方
    自觉；且 file.name 直显（本地文件名，无 i18n 语义，OK），但「❌」前缀
    在 ja/en 包中同样出现时观感割裂。建议整条消息键化
    （preview.groundMatLoadFailed 带 {name} 参数）或接受现状并注释豁免。

## §5 水面（water）— UI 设计锐评

**位置**：basic 卡第 3 行（order 30）→ 下钻 water 子视图（`water-menu.ts:buildWaterNodes`）。

### 布局
「水面」toggle（water-enabled，能力总开关，master）+ 4 个 folder：
形态（mode select + level + size）/ 外观（wetness* + color + opacity +
normal-strength + clarity* + choppiness）/ 水池（4 参数全 pool-only）/
波纹（wave-speed 单滑杆）。带 * 者有 visibleWhen 形态门控。

### 发现的问题（S5-x）

1. **S5-1【UX】folder 默认折叠 × visibleWhen 门控 = pool 参数要三跳才可达。**
   选 pool 模式前：形态组展开可见 level/size；外观组 wetness/clarity 自动隐藏
   （对）；水池组整组隐藏（对，visibleWhen 在 4 子项上但 folder 头无 visibleWhen
   机制 → 空 folder 仍显示折叠头「水池」，点开全空——**空组头是实锤 UX 坑**，
   需核实 folder 渲染是否按「子项全不可见则隐藏 folder」（见 §6 W-1）。

2. **S5-2【UX】wetness 门控的隐藏与「film 密度」文案错位。**
   water-wetness 滑杆 labelKey = preview.waterFilmDensity（film 密度），
   visibleWhen=waterFilmOn。film 模式下 wetness=0 → syncWaterVisibility 隐藏
   整个水面（gatePassed false）——滑杆拖到 0 水就消失，用户以为坏了。
   建议：滑杆 min 域 0.05+ 或 hint 写明「0=无水面」。

3. **S5-3【UX】「波纹」组仅 1 个滑杆独占一个折叠组。**
   wave-speed 单控件成组，信息密度失衡（同 S3-4）。建议并入「外观」组。

## §6 水面（water）— 前端接线核查

### 数据流
写路径：setter 纯写 envState（无就地材质改动——2026-09 锐评修复后单路径）→
water 组回调：waterMode/结构键 → rebuildWaterContainer（全量重建 + 10 mesh
geometry/material dispose + PMREM transmissionRenderTarget 清理，L438-455）；
参数字段 → applyChangedParams（ADR-286 分派表，编译期完备）；
waterEnabled/waterWetness → syncWaterVisibility。update(dt) 累加 waterTime
（shader uTime）。无 Go 调用，纯前端 cap，正确。

### 发现的问题（S6-x）

4. **W-1【UX/渲染】空 folder 渲染核实（待验证项）。**
   water 组 visibleWhen 全挂**子项**，folder 头无谓词。若 renderMenu 对
   「children 全被 visibleWhen 过滤掉的 folder」仍渲染折叠头，则 film 模式下
   「水池」组是一个点开全空的死头（同 S5-1）。需在 render.ts/folder 渲染路径
   核实是否有「空组隐藏」逻辑——本轮未读 render.ts 全文，列入下一轮核验项。

5. **W-2【冗余】rebuildWaterContainer 全量 dispose+重建，pool 结构键已零重建但 mode 切换仍全拆。**
   ADR-272 注释宣称 pool 的 size/poolHeight/wallThickness 已走 transformLinks
   零重建（L11-13），但 **waterMode 切换**（film↔pool）仍走
   `rebuildWaterContainer`：disposeWater（collectWaterMeshes + 逐 mesh
   geometry.dispose + transmissionRenderTarget 双层 dispose）+ strategy.build
   重建 10 个 mesh。两种形态零件完全不同，全拆合理——但 transmissionRenderTarget
   是 three 内部为 MeshPhysicalMaterial transmission>0 建的 RT，
   disposeWater 手动 trt.texture.dispose()+trt.dispose() 防泄漏（L445-452）——
   与 three 内部生命周期管理存在竞态面（three 自己持有引用再渲染时
   才dispose，手动抢跑在下一帧渲染前 OK，若插入一帧渲染则已释放 RT 仍被引用
   → 需确认调用时序在渲染帧外）。列为低风险观察项。

6. **W-3【冗余/接缝】water 组键派发「拼错即 no-op」靠类型断言兜底。**
   applyChangedParams（L532-546）：`WATER_PARAM_APPLIERS[key as WaterParamKey]?.(ctx)`
   —— ADR-286 分派表 Record 编译期完备，但 changed 集来自 dispatcher 的
   EnvStateKey 全集过滤 water 前缀，键拼错时 `as` 断言 + `?.` 静默 no-op
   （注释自称「与旧行为一致」）。新增 water* schema 键若未进分派表
   → 编译红（Record 完备）是好的；但 dispatcher 组键集
   getPresetKeys("water") 若与分派表键集不同步（schema 加键忘加分派条目）
   → 运行时静默丢应用。建议：契约测试锁 getPresetKeys("water")
   ⊆ WATER_PARAM_APPLIERS keys（或反向）+ 三键结构性空条目登记。

7. **W-4【持久化接缝】water loadState 双轨方言，level 兜底读 envState 时序。**
   L771-774：旧存档无 waterLevel 键且 waterMode=pool → 兜底
   `setLevel(envState.waterPoolHeight)`——读的是**此时** envState.waterPoolHeight
   （上方 restoreFields 已恢复 poolHeight，时序正确）；film 用户保持默认 0.01。
   逻辑对，但「pool 无 level 键 = 池深」是隐式观感约定，无注释指向 ADR-257
   原文的 0.01 出处。低风险。

8. **W-5【shader 注入风险】water onBeforeCompile 注入 6 处 replace，守卫只检 4 符号。**
   L397-411：注入后检查 vertexOk/normalOk/fragOk/detailOk 四关键字符串，
   任一缺失 ringLog warn + console——不 throw（sky 侧 injectSkySunScalePatch
   锚点失配是 error 级 + 仍继续，water 是 warn 级降级）。4 符号全中但
   某处 replace 失配（如 `#include <dithering_fragment>` 被 three 改名）
   不在检测面 → 圆角裁剪/泡沫/透明度 clamp 整段静默丢失。
   检测面建议扩到 6 处 replace 的 6 锚点字符串。

## §7 环境贴图（environment/HDR）— UI 设计锐评

**位置**：atmosphere 卡第 1 行（order 10）→ 下钻 env 子视图
（`environment-menu.ts:buildEnvironmentNodes`）。

### 布局
「环境」toggle（env-enabled，能力总开关）+ 3 folder：预设（preset-thumb
缩略图网格 64px × 5 预设）/ 背景（use-as-background toggle + intensity 滑杆 +
histogram 直方图控件）/ 自定义 HDR（image 预览 + 选择/清除双按钮）。

### 发现的问题（S7-x）

1. **S7-1【UX】预设双入口：一级面板 select vs 子视图 preset-thumb，真值源分叉。**
   一级面板「氛围预设」select（env.ts:286-310，PRESET_ORDER 5 项）与子视图
   preset-thumb 网格（environment-menu.ts:44-76，ENV_PRESETS keys）**两个
   控件各自读各自 get**：select.get 读 `envCap.getPresetId()`（envState.envPreset，
   custom 时回退 per-menu 缓存）；thumb.activeValue 也读 getPresetId()。
   数据源看似同一 envState.envPreset，但 **set 路径分叉**：
   - select.set → applyPreset（atmosphere-presets 快照，写 envPreset + skyTimeOfDay +
     fog + light + pp 共 ~10 字段，source auto-atmosphere）
   - thumb.onSelect → cap.setPresetId（只写 envPreset 1 字段，source manual）
   同一「预设」概念两种语义：一级 select = 氛围包（连 fog/灯/曝光一起换），
   子视图 thumb = 纯环境贴图预设（只换 envPreset）。用户一级选了 sunset
   （雾开+曝光 0.9），下钻子视图 thumb 选 night（envPreset=night 但雾仍开着）
   —— 预设语义分裂，一级「氛围」与子视图「贴图」的边界对用户不可见。
   建议：一级 select 文案明确为「氛围」（预览.envPresetThumbnail 现文案
   疑似就是后者，需查 locales）；或子视图 preset 控件改调 applyPreset
   同口径。

2. **S7-2【UX】histogram 直方图控件只读、无语境说明。**
   env-histogram（environment-menu.ts:79-91）getValue 返 16-bin 数组，
   cap-controls.ts:515-557 渲染 48px 高柱状图，无 caption。
   用户看到「亮度直方图」柱但不知「它告诉我什么 / 该拿它做什么」
   （直方图全暗=曝光不足？）。建议加 1 行 hint（i18n），或在柱下标注
   peak bin 数值。

3. **S7-3【UX】HDR 预览图 64px 缩略 + 「清除将回到工作室预设」hint 暗示行为。**
   env-hdr-preview image 控件（L96-106）getValue=cap.getCustomHdrThumbnail()
   —— 每次渲染重新算 HalfFloat 降采样 → Reinhard → sRGB → toDataURL
   （env-pixels.ts customHdrThumbnail，CPU 像素循环 + canvas 编码）。
   无缓存：每次 menu.refresh()（cap 订阅触发）重算一次。
   建议：缩略图数据 URL 缓存在 cap 实例字段（customHdrTex 变更时失效），
   getValue 直接返回缓存。

## §8 环境贴图（environment/HDR）— 前端接线核查

### 数据流
写路径：setPresetId/setIntensity/setResolution/setUseAsBackground → setEnvState
(manual) → environment 组回调：structural 键（envPreset/envResolution/
envUseAsBackground）→ buildEnvironment（disposeEnvironment + PMREM 全重建
+ applyBackground）；envIntensity → applyEnvIntensity（scene.traverse 全 mesh
envMapIntensity + needsUpdate=true）。零 Go 调用，纯前端，正确。
HDR 缓存（customHdrTex DataTexture 单例，preset 来回不重复解码，经验 637368
落地）设计干净。

### 发现的问题（S8-x）

9. **E-1【性能】envIntensity 拖滑杆 → scene.traverse 全模型 mesh + needsUpdate=true。**
   applyEnvIntensity（L46-60）对**整个 scene** traverse，每个带 envMapIntensity
   的材质置 needsUpdate=true → three 把材质标脏 = 下一帧 shader 程序重编译
   风险（envMapIntensity 本身是 uniform，needsUpdate 对 uniform-only 变更
   实为冗余——Material.needsUpdate 触发的是 program 重编译决策，
   同参数程序可被缓存复用，但脏标记仍走一遍 hash 计算）。
   滑杆逐帧 oninput → 每帧全 scene traverse。建议：缓存受影响的
   mesh.material 列表（syncMeshIntensity 在 build 完成/switchToSession 后
   已收 roots——复用同一列表）而非每次 traverse 全 scene。

10. **E-2【冗余】buildEnvironment 对 envPreset 同值重写也全量重建。**
    setEnvState 无同值去重（env-state.ts L91-96 契约注释：同值重写派发是
    多 cap 既有契约）→ buildEnvironment 无 prevPreset 比较，每次结构键
    变更（含同值重写）都 disposeEnvironment + PMREM fromEquirectangular
    （GPU 重活）。用户反复点同一预设缩略图 / loadState 恢复同 preset
    都触发全重建。建议：buildEnvironment 首行同 spec（preset+resolution+
    useAsBackground）早退。

11. **E-3【接缝】custom 预设回退写 envPreset="studio" 经 setEnvState(manual)——与 loadState 回退双路径。**
    buildCustomHdrTex（L310-325）：preset=custom 无缓存 → ringLog +
    `setEnvState({envPreset:"studio"}, {source:"manual"})`（manual 级别！）
    → 回调 buildEnvironment（isBuilding 守卫防递归，L146）。
    loadState（L516-539）读回 custom 无缓存 → partial.envPreset="studio"
    + 同一 setEnvState(manual) 路径。**manual 级别的程序化回退会打穿
    lastWriteSource 守卫**：用户在 studio 预设下手动调过 lightKeyIntensity
    等字段后，custom 回退写 envPreset=studio 是 manual，后续 auto-atmosphere
    写 envPreset 会被守卫拒绝——「选了 sunset 氛围但预设被程序回退污染成
    manual 后，预设切换失灵」。应 source:"auto-model"（程序化动作非用户手改）。
    **这是真实缺陷**（同 ground 中间件来源门思路的漏网——ground 侧
    已立法「手改只对 manual 成立」，env 侧回退未对齐）。

12. **E-4【接缝】scene.environment 三权打架：sky IBL / env PMREM / prevEnvironment 还原。**
    sky-capability.regenerateEnvironment 写 scene.environment=PMREM(sky)；
    environment-capability.buildEnvironment 写 scene.environment=PMREM(envMap)；
    两者无互斥协调（sky 侧 L482 仅通知 light.refreshAmbientFromSky，
    不通知 env cap）。cap 创建顺序决定覆盖先后（registry 顺序），
    后 apply 者胜。用户 sky IBL 开着时切 env cap 预设 → scene.environment
    被 env 的 PMREM 顶掉；反之亦然。dispose 侧各自还原 prevEnvironment
    守卫（sky L808-814 检查 ownedEnv，env L563 无条件还原）——env cap
    dispose **无条件** `scene.environment = this.prevEnvironment`（L563），
    若 sky 在 env 之后写过 scene.environment（顺序：env 构造 → sky 构造 →
    env dispose），sky 的 PMREM 被 env.dispose 冲掉。与 sky 侧的
    「仅当环境仍归本能力所有才还原」守卫不对称。建议 env 侧对齐
    sky 的 ownership 守卫。

13. **E-5【硬编码】accept 文件类型白名单 3 后缀 + 300ms blur 兜底魔法数。**
    pickHdrFile（L63-90）：`accept=".hdr,image/vnd.radiance,image/x-hdr"`
    （.32f/.exr 不进 accept——three RGBELoader 只认 HDR 对，白名单对，
    但 WebView2 上 mime 匹配可靠性待验）；window focus 后 300ms 兜底
    判取消是魔法数（选文件对话框窗口失焦→focus 时序因 OS/浏览器而异，
    300ms 可能太短导致误判取消）。建议：注释标注 300ms 来源
    （实测？经验值？），或改 change 事件驱动不依赖 focus。

## §9 雾（fog）— UI 设计锐评

**位置**：atmosphere 卡第 2 行（order 20）→ 下钻 fog 子视图（`fog-menu.ts:buildFogNodes`）。

### 布局
「雾」toggle（fog-enabled，能力总开关 = master，一级行 headerToggle）+ 参数组 folder
（color / mode select / density* / near* / far*，* 者 visibleWhen 按 fogMode 互斥显隐）。

### 发现的问题（S9-x）

1. **S9-1【UX】线性雾 near/far 两个独立滑杆，无联动约束。**
   near 与 far 各一条滑杆（fog-menu.ts:68-89），用户可把 near 拖到 100、far 拖到 50
   （near > far）——THREE.Fog 对 near≥far 行为未定义（远端全雾 or 闪烁）。
   预设 sunset 写 near=50/far=800 合理，但手拖无 guard。建议：far 滑杆 min
   动态绑 near（或渲染前 clamp far ≥ near + 1，UI 加 hint「远距 ≥ 近距」）。

2. **S9-2【UX】雾 color 与「背景 useAsBackground」观感脱节。**
   fogColor 默认多半偏冷灰；若 useAsBackground=true 天空/贴图背景已铺满，
   雾色与背景色不一致时地平线出现「雾色带」割裂。无自动取色入口
   （如「跟随背景」）。低频诉求，列 P3。

## §10 雾（fog）— 前端接线核查

### 数据流
写路径干净：setter 纯写 envState → fog 组回调 applyFog（模式不变原地改字段，
零对象分配——L89-96 三分支干净；仅切 mode 才 new）。雾是 scene.fog 纯属性
无 draw call 成本，**全环境系统最轻 cap**。
预设覆盖：atmosphere-presets 里 sunset 写 linear 50/800、night/forest 写 exp2
density——预设切 mode 时 fog cap 回调 applyFog 重建对象，通畅。

### 发现的问题（S10-x）

3. **F-1【冗余】任何 fog 组键变更 → 无条件 applyFog（含同值重写）。**
   回调 L57-63 对**任意** fog 组键（含 near/far/density/color 同值重写）
   都跑 applyFog：原地改字段（廉价，OK）或 mode 切换 new 对象（中价）。
   同值重写派发（env-state.ts 契约）使「反复点同一预设」也 new 雾对象
   ——但雾对象 4 字段，GC 压力可忽略。**非缺陷，仅记录**。

4. **F-2【接缝】loadState 逐字段 setEnvState(manual) 无挂起——与 ground 口径不一致。**
   fog loadState（L256-263）restoreFields 逐字段 setEnvState（source manual），
   **无 suspendEnvCallbacks**（对比 ground L849-918 挂起 + 末尾统一落地）。
   恢复 6 字段 = 6 次 dispatch + 6 次 applyFog（mode 字段变更会中途 new 对象，
   最后 applyFog 又一次）——启动时冗余 6 次轻函数调用。
   且 source:"manual" 恢复写入会把 6 键的 lastWriteSource 全打成 manual
   ——**后续 auto-atmosphere 预设切雾参数会被守卫拒绝**（预设 fogMode/fogDensity
   等 5 键失写）。ground/water 恢复路径已立法 skipMiddleware/来源门，
   fog 未对齐。真实缺陷（同 E-3 同病：程序化恢复打 manual 级别）。

5. **F-3【接缝】applyModelPreset 可写 fogEnabled（与 fog 组回调无交互）——通畅，仅记录。**
   L124-134 pickModelDefaultFields 可含 fogEnabled（auto-model），
   预设快照同键（auto-atmosphere）优先级 manual > auto-atmosphere > auto-model
   已保证顺序正确。无缺陷。

## §11 反射（reflector）— UI 设计锐评

**位置**：atmosphere 卡第 3 行（order 30）→ 下钻 reflector 子视图
（`reflector-menu.ts:buildReflectorNodes`）。

### 布局
「反射」toggle（reflector-enabled = master）+ 参数组 folder（opacity / resolution /
size 三滑杆）。**无 clipBias 控件**（有 setter，无菜单出口，同 G-1 病例）。

### 发现的问题（S11-x）

1. **S11-1【UX】resolution 滑杆逐帧拖 → 全量 Reflector 重建（RT 重分配）。**
   reflector-resolution 滑杆（reflector-menu.ts:60-66）oninput 直写
   → cap callback：reflectorResolution 是**结构键**（L66 列在 buildReflector
   全量重建组）→ 每帧 dispose 旧 RT + new Reflector + 重新 PMREM 级 RT
   （1024² 默认）。拖 resolution 滑杆 = 每帧 GPU 内存 churn。
   建议：滑杆 onCommit（松手）才写 resolution，拖动中显示 ghost 数值
   （cap-controls.ts slider 有 onCommit 钩子，见 L268 注释「pixel-ratio
   提交时 notify」先例）。

2. **S11-2【UX】size 滑杆同病：reflectorSize 也是结构键 → 拖 size 每帧重建 mesh。**
   与 S11-1 同路径。两个结构滑杆（size/resolution）都是「拖动即重建」，
   只有 opacity（就地 uniform）是真滑杆体验。建议同上：size/resolution
   改 onCommit。

## §12 反射（reflector）— 前端接线核查

### 数据流
写路径：setter 纯写 envState → reflector 组回调细粒度分派（结构键 4 个 →
buildReflector 全量重建；opacity/color → 就地 uniform，L62-80 分派干净）。
层级防御：reflector.position.y = GROUND_LAYER_OFFSETS.reflector（-0.01，
在 ground 承接面 0.005 之下），reflection-chain-invariants.test.ts:75 锁死
reflector < groundSurface 不变量——**z-fighting 防御有据可查，设计好**。
SSR 互斥：ppReflectorDisableWhenSSR 默认 true（L121-122 注释），
postprocessing 侧 applyReflectorSync 压制双反射——通道存在（需查
postprocessing cap 确认，列观察项）。

### 发现的问题（S12-x）

3. **R-1【接线缺口】clipBias 有 setter 无菜单出口。**
   setClipBias（L221-224）+ schema 键 + saveState 持久化齐全，但
   reflector-menu.ts 参数组只有 opacity/resolution/size 三滑杆——
   clipBias 无 UI。与 G-1（ground 四参数）同病例：「持久化通路活着、
   菜单通路缺席」。低优先级（clipBias 是高级参数），建议补 slider
   进参数组或明确标注「仅存档可调」。

4. **R-2【双开关键】enabled（cap 私有）× reflectorEnabled（envState）双键并存。**
   L174-182 注释自述：master toggle 经 cap.setEnabled → 写 reflectorEnabled
   （envState gate），但 cap 私有 this.enabled 仍参与 buildReflector
   判定（L143 `!this.enabled || !envState.reflectorEnabled`）。
   legacy {enabled:true} 存档恢复 this.enabled=true 但 reflectorEnabled 缺键
   → 永关（注释已记录该病史并收口）。现状双键是「能力级 enabled +
   参数级 reflectorEnabled」正交设计（对齐 sky 的 enabled + skyEnvironment
   分轴），但**菜单上只有 reflector-enabled 一个 toggle**（master 绑
   cap.setEnabled → 只写 reflectorEnabled）——this.enabled 无 UI 出口，
   恒为构造默认 true。建议：loadState 恢复 enabled 字段时若无键
   默认与 reflectorEnabled 对齐（消除双键漂移残留）。

5. **R-3【冗余】buildReflector 全量重建对 enabled=false 也先 dispose 再短路。**
   L141-146：`disposeReflector()` 无条件先跑，再判 enabled 短路。
   结构键同值重写（契约）→ 每次 dispatch 都走一遍 dispose（reflector
   为 null 时 no-op）——廉价但无谓。建议前置短路 `if (!this.enabled ||
   !envState.reflectorEnabled) { dispose + return }` 已等价，仅风格。

## §13 总报告 — 缺陷分级汇总

> 全部 6 面板（sky/ground/water/environment/fog/reflector）UI + 接线审查完毕。
> 缺陷按严重度分级（🔴 真实缺陷 / 🟡 性能冗余 / 🟢 UX 改进 / ⚪ 观察项）。
>
> **修复进度（2026 续轮）**：🔴 **E-3 / F-2 / E-4 / S2-4 / S1-4 五条全部已修复**并附回归测试
> （TDD：先写测试 → 对旧实现实测全红 → 修复后全绿）。**G-1 经复核为误判并撤销**（见 §15）。
> S1-4 按 ADR-292 以三批次收口（架构级，非文案级）——详见 §16 修复记录。

### 🔴 真实缺陷（建议优先修）
| # | 位置 | 缺陷 | 建议 | 状态 |
|---|------|------|------|------|
| E-3 | environment-capability.ts:323/548 | custom 预设回退写 `envPreset=studio` 用 **source:"manual"**——程序化回退打穿 lastWriteSource 守卫，污染预设链路（同 ground 中间件立法思路的漏网） | 改 source:"auto-model"（程序化动作） | ✅ 已修 |
| F-2 | fog-capability.ts:256-263 | loadState 逐字段 **setEnvState(manual) 且无挂起**——恢复打 manual 级别，后续预设写雾参数被守卫拒绝；与 ground/water 恢复口径不一致 | 对齐 ground：suspendEnvCallbacks + 逐字段 source:"auto-model"（或 skipMiddleware 语义的恢复来源） | ✅ 已修 |
| E-4 | environment-capability.ts:563 vs sky-capability.ts:808-814 | scene.environment 三权打架：env cap dispose **无条件**还原 prevEnvironment，sky cap 有 ownership 守卫——两 cap 同写 scene.environment 无协调，dispose 顺序不同结果不同 | env 侧对齐 sky 的 ownership 守卫（仅当 environment 仍归本 cap 时还原） | ✅ 已修 |
| S2-4 | sky-capability.ts 回调 L238-303 | **skyScale 死键**：schema 有键、无回调分支、无 UI 控件、预设可写但渲染层不响应 | 补控件 + 分支，或从 schema 摘除 | ✅ 已修（摘键提常量，见 §14） |
| ~~G-1~~ | ~~ground-menu.ts buildGroundNodes~~ | ~~注释宣称「锐评 P3 补齐菜单出口」但菜单实际未露出~~ | — | ❌ **误判，撤销**（见 §15 更正） |
| S1-4 | sky 子视图 sky-env toggle | 语义漂移：实为「天空 IBL」却标「环境贴图映射」，与 atmosphere 卡 EnvironmentCapability 抢写 scene.environment 无联动 | **根因非文案而是架构**：一个功能（给 scene.environment 供图）被劈成两半分置两面板。已按 ADR-292 收口：env 独占槽位 + 来源单选（preset/sky/custom）+ sky 降为烘焙数据源 + sky 面板 toggle 退役 | ✅ 已修复（ADR-292 三批次，2026-09-21） |

### 🟡 性能冗余（中优先级）
| # | 位置 | 问题 | 建议 |
|---|------|------|------|
| S2-1 | sky-capability.ts setTime | ~~timeline 拖动 forceEnv 恒 true → 每帧 PMREM 全重建~~ **已修（2026-09-23）**：setTime 加 `phase` 相位（dragging 降阈值门控 / settled force 一次）+ bakeEnvironment 首帧无条件烘焙 + skyForceEnv 脉冲键补 force；sky-menu 接 onDragStart/onDragEnd 通道 | ✅ 落地，守卫 = sky-capability.test.ts S2-1 双例 |
| S2-6 | slide-menu.ts:126 refresh | N cap 订阅 → N 次 renderTop 无合帧 | refresh 加 rAF 合批 |
| S2-2 | sky writeUniforms | 全量 7 uniform 双写（sky+envSky），skyEnvironment 关闭时 envSky 是死 mesh | 仅写 changed 键 + 跳过未挂载 envSky |
| E-1 | environment-capability.ts:46-60 applyEnvIntensity | 滑杆逐帧 → scene.traverse 全模型 + needsUpdate | 缓存受影响材质列表（复用 syncMeshIntensity 的 roots） |
| E-2 | buildEnvironment | 同 spec 重写也全量 PMREM 重建 | 同 spec 早退 |
| S7-3/E | env-hdr-preview image getValue | 每次渲染重算缩略图（CPU 降采样 + toDataURL） | cap 实例缓存 dataURL，贴图变更失效 |
| G-2 | ground 回调 | 任意 ground 键 → 4 连（含空转判别） | 按键分组落地 |
| S11-1/2 | reflector 滑杆 | size/resolution 是结构键，逐帧拖 = 逐帧全量重建 RT | 改 onCommit 提交 |
| G-4 | ground saveState | 手抄 16 字段清单（water 侧已 schema 驱动免手抄） | 对齐 getPresetKeys 口径 |

### 🟢 UX 改进（低优先级）
| # | 位置 | 建议 |
|---|------|------|
| S1-1 | 云量藏默认折叠高级 folder | 云量提级平铺 |
| S1-2 | sky 总开关关掉后子视图控件仍可盲调 | 子视图加「能力已关」提示或置灰 |
| S1-3 | timeline 色带硬编码 5 色与实际天空脱节 | 加 6/12/18 刻度线 |
| S1-5 | godRays 正午无反应无 hint | hint 补「仅日出日落可见」 |
| S3-1 | 地面/网格双 toggle 平铺暗示独立 | 网格 toggle 视觉降级 |
| S3-2 | texture 选完滚 5 控件才见选图按钮 | 按钮紧跟 mat-source |
| S3-3 | canvas-style 下拉实为预设 + custom 不可逆 | 标签改「材质预设」+ 切走前确认 |
| S3-4/S5-1/S5-3 | 空/稀疏 folder（含 water 空组头 W-1 待核） | folder 按可见子项自动显隐 |
| S5-2 | wetness=0 水面消失无提示 | min 域或 hint |
| S7-1 | 一级 select（氛围包）vs 子视图 thumb（纯贴图）预设语义分裂 | 文案分界或统一走 applyPreset |
| S7-2 | histogram 无语境说明 | 加 hint |
| S9-1 | near>far 无约束 | clamp 或 hint |

### ⚪ 观察项（需后续核验）
- **W-1** ~~water film 模式「水池」空组头是否渲染~~ → **撤销（§17 核验）**：`render.ts` 的
  folder 渲染已实现「全隐组不建空组头」（注释原句：回归场景即 water film 模式水池组
  四控件全门控后的空「水池」组），`node-render.test.ts` 有「空 children 不渲染 section」
  回归锁。原观察项是**未读渲染层全文就下的待核清单**，实为已治之病。
- **W-2**：transmissionRenderTarget 手动 dispose 与 three 内部生命周期的竞态面（下一帧渲染前调用即安全）。→ **§17 核验为风险接受区**：`disposeWater` 的 `trt.texture.dispose() + trt.dispose()` 仅在「材质已脱离渲染流（mesh 已从 scene 摘除、material.dispose 已清 program 引用）」的销毁时序内调用，three 侧 WebGLState 持有的旧引用随 RT 释放同帧清理，无跨帧竞态；真正的残留风险是**同帧内再次 dispose 同 RT**（three 内部 releaseTransmissionRenderTarget 未去重），属 three 侧 API 契约，本仓不深究。
- **W-3**：~~契约测试锁 `getPresetKeys("water")` ⊆ 分派表键集~~ → **已落地（§17）**：
  `water-capability.ts` 导出 `WATER_PARAM_APPLIER_KEYS` 字面量（15 键），
  `water-capability.test.ts` 新增「schema water 组键集 = 分派表键集」契约测试
  （运行时锁，与类型派生 `WaterParamKey` 的编译期完备性双保险）。
- **W-5**：~~water onBeforeCompile 6 处 replace 仅检 4 锚点符号，建议扩到 6~~ → **降级维持（§17 核验）**：
  实测 6 处 replace 中第 2 处（`#include <common>` → 声明 varying/uTime 等）与第 6 处
  （`void main() {` 补换行）确无独立检测——但第 1/3 处注入体已含检测符号（`vec3 gerstner(`
  覆盖第 1 处、`objectNormal = ysmWaveNormal` 覆盖第 3 处），且第 2/6 处失配**必然**伴随
  1/3/4/5 之一失配（同一 shader 模板），故 4 锚点检测对 6 处替换是**充分覆盖**——
  原观察项「建议扩到 6」价值有限，不改。
- **S2-3/E-5/R-1**：shader 锚点/版本号/文件类型白名单硬编码——守卫已到位（assertRevisionRange + 单锚点分检），属可控硬编码；R-1 clipBias 无 UI 出口。
- ~~**reflector SSR 互斥**：ppReflectorDisableWhenSSR 压制通道在 postprocessing 侧未本轮核实。~~ → **§17 核验**：
  通道存在且完整——`postprocessing-capability.ts` 的 `applyReflectorSync()` 经
  `getTypedCap(this.caps, "reflector")` 查询器取 reflector cap，按
  `ssrIsActive() && enabled && ppReflectorDisableWhenSSR` 三条件压制/还原
  （pull 式、由 postprocessing 侧事件驱动；压制约归属判定区分「我们按下」vs「用户手动重开」），
  并有 `reflection-chain-invariants.test.ts` 专锁「双反射默认不可达」不变量。§7 的
  「未核实」标记撤销。

### 系统级结论
1. **状态层（env-state 单例 + dispatcher + lastWriteSource 守卫 + schema 钳制）设计是
   全系统最干净的部分**——6 cap 统一收口、组过滤、值域单一事实源，数据流主干通畅。
   缺陷集中在**守卫来源纪律**（E-3/F-2 程序化写入误用 manual 级别）——守卫的「法」
   已立（ground 中间件来源门、ADR-254 立法），env/fog 侧漏网。
2. **渲染层重建成本不对称**：sky PMREM / reflector RT / environment PMREM 三处
   「结构键即全重建」，滑杆逐帧写入路径未做提交收口（onCommit 钩子已存在但
   仅 pixel-ratio 在用）。统一建议：**结构键走 onCommit、参数字段走 oninput**。
3. **注释与实现脱节是最高频「假病」**（G-1、S3-5）——注释宣称已修，菜单未跟上。
   建议知识卡 + 注释双写时附菜单节点 id，便于 grep 核验。
4. **scene.environment / scene.background / scene.fog 三全局资源多 cap 抢占**
   无统一协调层（E-4），各 cap dispose 守卫深度不一（sky 有 ownership，
   env 无条件还原，fog 无条件还原 prevFog）。建议抽「场景全局资源协调器」
   或在 cap 注册表做 ownership 协议。

---
**审查完成**。6 面板 × (UI + 接线) 全覆盖；缺陷 6 红 / 9 黄 / 12 绿 / 6 观察。
报告落盘：docs/audit-env-review.md（本文件）。

## §14 修复记录（E-3 / F-2 / E-4）

TDD 流程：先写回归测试 → 对**旧实现**实测（4 例全红，证明测试非空转）→ 修复 → 全绿。

### E-3 — environment-capability.ts（custom 回退来源纪律）
- **改动**：回退写 `setEnvState({envPreset:"studio"}, {source:"auto-model", force:true})`。
- **为何必须 `force:true`**（超出原报告建议的增量发现）：仅改 `auto-model` 不够——
  `shouldOverwrite` 只在 prev 也是 `auto-model` 时放行，若用户曾手选过 studio（prev=manual），
  写入被拒 → `envState.envPreset` 滞留 `"custom"` 而渲染已是 studio 贴图，**真值源与画面撕裂**。
  `force` 语义（程序化动作不得被守卫冻结）与昼夜循环先例同源。
- **回归测试**：`custom 无缓存回退 studio：不污染 lastWriteSource，预设仍可写 envPreset`
  ——手选 studio 打 manual 后再触发回退，断言后续 `auto-atmosphere` 仍能写 envPreset。

### F-2 — fog-capability.ts（loadState 来源 + 挂起收口）
- **改动**：6 字段恢复包进 `suspendEnvCallbacks()` / `finally { resumeEnvCallbacks() }`，
  来源由 `manual` 降为 `auto-model`。
- **`finally` 的必要性**：`resume` 若因 restoreFields 抛出而逃逸，挂起计数永久 >0 →
  **全仓 envState 派发静默假死**（envState 有值、Three 不更新、无任何报错）。对齐
  `clearEnvCallbacks` 复位计数的同类防御。
- **回归测试 2 例**：①恢复后 preset 仍能写雾参数；②恢复期间挂起、末尾只 applyFog 一次
  且 `isEnvCallbacksSuspended() === false`。

### E-4 — environment-capability.ts（dispose ownership 守卫）
- **改动**：dispose 还原前判 ownership——`scene.environment === null || === this.envTexture`
  才还原 prevEnvironment；background 同构处理。
- **修复场景**：cap 构造序 env → sky 时，sky 的 IBL PMREM 后写 environment，
  原实现 env.dispose 会把它冲掉（呈现「关掉环境贴图，天空 IBL 也黑了」）。
- **回归测试 2 例**：①他人后写的 environment 不被冲掉；②槽位仍归本 cap 时正常还原 prev。

### 验证
| 门禁 | 结果 |
|------|------|
| 新回归测试对**旧实现** | 4 failed（TDD 有效性证明） |
| `vitest --run` 两测试文件 | 101 passed |
| `vitest --run src/preview-3d/` 全量 | 2721 passed / 156 files |
| `npx vite build` | ✓ built in 6.53s |
| `check-biome --files`（4 文件） | ✅ 通过 |
| `tsc --noEmit`（过滤本 2 源文件） | 0 错误 |

⚠️ **未通过全量 typecheck 的既有错误（非本次引入）**：`light-capability.ts:439/440`
`Property 'distance'/'decay' does not exist on type 'Light'`——该文件与 `light-presets.ts`、
`screenshot-render.ts`、未跟踪的 `ADR-290-volumetric-cone-driver.md` 属**并行会话在制品**
（本会话未触碰）。`const positional = light instanceof SpotLight || light instanceof PointLight ? light : null`
在上方已把 `light` 窄化，439/440 却写在 `if (positional)` 分支内、直接引用外层 `light`——
需以 `positional` 收口。留给该会话或后续收口。

### 未修的 🔴（仍待办）
- ~~**S1-4** sky「环境贴图映射」标签语义漂移 + 与 env cap 抢写槽位~~ → **已修复（§16，ADR-292 三批次闭环）**：
  所有权收口归 EnvironmentCapability 独占，sky IBL 降为「来源」三选一中的一项，
  天空面板重复 toggle 退役（D4）。迁移语义拍板：`env关切+sky开`→`sky`；`custom`→`custom`；
  其余→`preset`。纯函数 `caps/environment-migrations.ts` + 21 例测试。详见
  `docs/adr/ADR-292-scene-environment-sky-ibl-env.md`。
- ~~G-1~~ 撤销（误判，见 §15）
- ~~S2-4~~ 已修（见下）

> **§16 S1-4 闭环注记（2026-09-22 锐评轮次核对）**：ADR-292 收口使 `skyEnvironment`
> 开关退役后，§1-§13 正文中所有「sky 面板『环境贴图映射』toggle」的历史描述仍按
> **当时快照**保留（审计文档惯例），但下列引用点已过期，阅读时以注记为准：
> - §2 S2-2「envSky 未挂 scene 时对死 mesh 双写」——ADR-292 后 `envSky` 是
>   **常驻烘焙载体**（`bakeEnvironmentTexture` 的 renderTarget 源），不再是「开关关闭即摘除」的
>   死 mesh。S2-2 结论（全量重写 7 uniform）仍成立，但「envSky 是死 mesh」前提已变。
> - §4 R-2 / §8 E-4 中「skyEnvironment 与 envUseAsBackground 互斥」的表述——
>   收口后该互斥由 `envSource` 单选**结构性保证**（三通路互斥，非运行期判定）。
> - §11 R-4 / §7「两 cap 各开总开关互不知晓」——收口后写者唯一，竞争面消除。

## §15 S2-4 修复记录 + G-1 误判更正

### ✅ S2-4 — skyScale 死键摘除（提为模块常量）
**方案选择**：报告原给「补控件+分支」或「摘除」两选项。核查后**选摘除**，理由：
1. **无存档依赖**：`sky-capability.saveState`（L707-720）**从不落盘** skyScale，
   loadState 也无该字段 ⇒ 摘除零兼容成本（旧存档里多出的键由 restoreFields 的
   typeof 分发自动忽略）。
2. **有硬物理约束**：天空盒 `side=BackSide` + 顶点 z 强制 far，相机须**始终在盒内**；
   半边长 < 相机 maxDistance(5000) 时相机拉远即飞出盒外、天空消失。补滑杆
   = 给用户一把能弄坏画面的旋钮。
3. **本就无人读**：3 处读全是构造期快照（createSky / SunBeams ctor / getParams），
   cap 回调**无 `changed.has("skyScale")` 分支** ⇒ 任何途径改它都不重建。

**改动**：
| 文件 | 改动 |
|------|------|
| `state/env-state-schema.ts` | 删 `skyScale` 键 + 注释留档（记录三点理由） |
| `caps/sky-capability.ts` | 新增导出 `const SKY_SCALE = 12000`（含约束出处），3 处读改引常量 |
| `caps/sun-beams.ts` | 修正过时注释（原称「运行期 skyScale 变更不重建」） |
| `caps/sky-capability.test.ts` | 新回归测试（锁键已脱离 envState + 常量 > 5000） |

**TDD 验证**：新测试对旧实现 = `expected true to be false`（键存在）→ 修复后 87 passed。

### ❌ G-1 误判更正（重要）
原报告 G-1 称「ground 注释宣称已补菜单出口，但菜单实际未露出」——**判断错误**。

**事实**：`ground-menu.ts:126-172` 的 `groundBuildGridFolder()` **四控件齐全**
（ground-size / ground-divisions / ground-color-center / ground-color-grid），
且 `ground-capability.test.ts:586-588` 有显式回归锁（注释标「锐评 P3 2026-09-21」）。
注释与实现**完全一致**，`buildGroundNodes` 也正确把该 folder 拼进返回值。

**误判成因**：本会话前序轮次读 `ground-menu.ts` 时，工具输出中段被裁剪（"middle pruned"），
我只看到 `buildGroundNodes` 的头尾，**漏读了中间的 folder 工厂函数**，据此下了
「注释与实现脱节」的结论。这是**采样偏差导致的假病**——教训：判「某功能缺失」时
必须 grep 符号落点（本次 grep `groundSize` 立刻见 12 处命中），不能只凭单文件首尾推断。

因此 🔴 实际数量由 6 降为 **5**，已修 4 条（E-3/F-2/E-4/S2-4），余 1 条（S1-4）。

---

## §16 S1-4 修复记录：scene.environment 供图权收口（ADR-292，三批次）

S1-4 原描述是「toggle 标签语义漂移」，但**根因是架构**：给 `scene.environment` 供图这一个
功能，被劈成两半分置两个面板（天空面板的「环境贴图」开关 + 环境面板的总开关），二者
互不知晓、后写者赢，UI 上两个开关都「开」却只有一个生效。

### 批次划分（用户指定顺序：先取图通道 → 再删开关 → 最后接 UI）

| 批次 | 内容 | 提交 |
|------|------|------|
| 一 | env 侧取图通道：`bakeEnvironmentTexture()` 只烤不装 + `envSource` schema + 纹理所有权守卫 | `19d42b235` |
| 二 | 装载权让渡：`requestEnvironmentRefresh()` 交棒 + `skyForceEnv` 职责拆分（D8/D9/D10） | `10f0db9f9` |
| 三 | UI 出口：来源单选（MenuNode `select`）+ 删天空 toggle + 旧存档迁移落地 | 本次提交 |

### 关键修复点

1. **写者唯一性（运行期保证，非仅 dispose 期）**：`bakeEnvironment` 拆为「纯烤」与「装载」
   两半；env 接管时 sky 走 `requestEnvironmentRefresh()` 转交而不写槽位。
2. **纹理所有权守卫**：`pmremToSceneEnv` 原本无条件 dispose `srcTex`；sky 来源的纹理归
   sky 的 renderTarget 所有，dispose 它会释放掉天空的烘焙产物 → 新增 `skySourcedTex` 排除。
3. **阈值门控保留**：`bakeEnvironmentTexture({force})`——结构性变更传 `force:true`（离散动作
   须拿当前帧图），连续动画不传走 `PMREM_ELEVATION_THRESHOLD`，守住防 GPU 熔炉的历史防线。
4. **两键分裂根除（D11/D12/D13）**：`envSource` 为通路唯一权威、与 `envPreset` 正交。
   custom 无缓存时**只回落渲染、不动键值**；`loadState` 中该裁决排在读回与迁移**之后**，
   因 HDR 内容不入 localStorage，运行时事实优先于存档意图。
5. **UI 出口合规**：来源控件用 MenuNode schema 的 `select` 种类（非自造控件），
   从 `buildEnvironmentNodes` 直产，满足「3d菜单只允许 MenuNode schema」硬规。

### 验证

- TDD：三批共 **22 例新测试**，各自对旧实现实测**全红**（批次一 7 / 批次二 7 / 批次三 8），
  修复后全绿。含 `preset=custom 无缓存 → envSource 也回落 preset` 这类分裂态回归锁。
- `vitest --run src/preview-3d/` → **2773 passed / 157 files**
- `vite build` ✓ 8.07s（含 locale JSON 再生成后 TS↔JSON 1499 keys 一致）
- `npm run typecheck` ✓ 全绿
- `check-biome --files` ✅
- 全量 `vitest --run` → 6605 passed；6 条失败在 `app-modules.boot.test.ts`，经 stash 验证为
  **存量问题**（与我改动无关，该文件不 import 任何 preview-3d 模块）。

---

## §17 观察项核验（定时任务轮次，2026-09-22）

本轮重心：不重开新面板，而是**关闭 §13 遗留的 ⚪ 观察项**（W-1 / W-2 / W-3 / W-5 /
reflector SSR 互斥通道），并回查 ADR-292 收口后 §1-§13 的过期引用点。

### 核验结果

| 观察项 | 结论 | 证据 |
|--------|------|------|
| **W-1** water film 空组头 | **撤销**（已治之病） | `render.ts` folder 渲染实现「全隐组不建空组头」，注释原句即 water film 水池组四控件全门控的回归场景；`node-render.test.ts` 有「空 children 不渲染 section」回归锁。原观察项系未读渲染层全文即挂的待核清单 |
| **W-2** transmissionRenderTarget dispose 竞态 | **风险接受区** | `disposeWater` 的 `trt.texture.dispose() + trt.dispose()` 仅在销毁时序内调用（mesh 已摘、material.dispose 已清 program 引用），three 侧 WebGLState 旧引用随 RT 释放同帧清理，无跨帧竞态。残留风险 = three 侧「同帧双 dispose 未去重」的 API 契约，非本仓可修 |
| **W-3** schema 键集 vs 分派表键集 | **已落地契约测试** | 新增 `WATER_PARAM_APPLIER_KEYS`（15 键字面量）导出 + 「schema water 组键集 = 分派表键集」测试。类型派生 `WaterParamKey` 管编译期、字面量管运行时——双保险。15 键经 PowerShell 逐一比对确认与 schema 完全一致 |
| **W-5** 6 处 replace 仅检 4 锚点 | **维持 4 锚点（原建议撤回）** | 实测：第 2 处（common 注入 varying/uTime）与第 6 处（`void main() {` 补换行）无独立检测，但第 1/3 处注入体已含检测符号（`vec3 gerstner(` / `objectNormal = ysmWaveNormal`），且 2/6 失配必伴随 1/3/4/5 之一失配（同一 shader 模板）——4 锚点已充分覆盖 6 处替换 |
| **reflector SSR 互斥通道** | **撤销「未核实」标记（通道完整）** | `postprocessing-capability.ts` 的 `applyReflectorSync()` 经 `getTypedCap(this.caps,"reflector")` 查询器取 reflector cap，三条件（`ssrIsActive() && enabled && ppReflectorDisableWhenSSR`）压制/还原，归属判定区分「我们按下」vs「用户手动重开」；`reflection-chain-invariants.test.ts` 专锁「双反射默认不可达」不变量 |

### 新发现（本轮）

无新增 🔴/🟡/🟢。本轮是**观察项清算轮**，产出 = 5 项观察项全部关闭 + 1 项新契约测试
（W-3）+ §14 过期引用点注记。

### 门禁

- `water-capability.test.ts` → **79 passed**（含新契约测试）
- W-3 契约测试对旧实现（未加 `WATER_PARAM_APPLIER_KEYS` 导出）= `Tests 1 failed`（TDD 证明）
- `git log --oneline` 核对：ADR-292 三批次提交（`19d42b235` / `10f0db9f9` / `b71aa0979`）
  均在 main 且已推送（与 origin/main 同基线）

---

## §18 地面（ground）接线锐评（2026-10 重审轮）

> 轮次：对 §4 已有 G-1~G-5 的**逐条复核** + 一轮全新接线体检。只读核查 + 1 条真实缺陷修复。
> 依据：`ground-capability.ts`（864 行）/ `ground-menu.ts`（386）/ `ground-surface-spec.ts`（673）/
> `ground-migrations.ts`（130）/ `env-state.ts`（144）/ `env-dispatcher.ts`（141）/ `env.ts`（314）/
> `env-state-schema.ts`（ground 组 21 键）。

### §18.0 S2-1 修复记录（2026-09-22 锐评轮次，timeline 拖动 PMREM 门控）

**病根**：`renderCapTimeline` 的 `pointermove` 每帧调 `c.setValue(hour)` → `cap.setTime(v)` →
`setEnvState({skyTimeOfDay, skyForceEnv:true}, {source:"manual"})` → 回调 `skyTimeOfDay` 分支
`maybeRegenerateEnvironment` → `requestEnvironmentRefresh(true)` → `bakeEnvironment(true)`——
**拖动期每帧 PMREM 全重建**（立方体贴图 + mip 模糊，重活）。

**修复（已提交 `7fb1656c9`）**：
1. `PreviewControlDef` 增 `onDragStart?` / `onDragEnd?`（timeline 专用相位回调）。
2. `renderCapTimeline`：`pointerdown` → `onDragStart`（降为阈值门控）；`pointerup`/`pointercancel` →
   `onDragEnd`（force 一次取当前帧图）；单击轨道跳转 → 直接 `onDragEnd`（离散提交，对齐原生 range
   `change`）。
3. `SkyCapability.setTime` 增 `opts.phase`：`"dragging"` → `forceEnv=false`（阈值门控），
   `"settled"` → `forceEnv=true`（force 一次）；未传 phase 时保持 `forceEnv=true`（兼容旧调用方）。
4. **门控统一（ADR-292 后结构修正）**：`bakeEnvironment` 的阈值门控从「装」侧（regenerateEnvironment）
   收回到「烤」侧内部——`if (!force) { if (renderTarget && !dirty) return true; }`，
   首帧（renderTarget=null）无条件烘焙。`regenerateEnvironment` 与 `bakeEnvironmentTexture`
   委托同一 `bakeEnvironment`，自持装载 / env 取图两条路门控判定一致。
5. **`skyForceEnv` 脉冲键写 `force:true`**：`resetEnvState` 清 `_writeSource` 后首帧 `skyForceEnv`
   默认值 `true` 无来源标记，手动 `setEnvState` 被 `shouldOverwrite` 拒绝 → 相位语义失真。
   `setTime` 写 `skyForceEnv` 走 `{source:"manual", force:true}`（脉冲键无用户手改足迹，force 安全，
   同 `update(dt)` 的 auto-model 强制推进先例）。

**TDD**：2 条新测试（phase 拖动相位 + 未传 phase 兼容），旧实现 1 failed，修复后 98/98 passed。

**S2-6 定级**：`slide-menu.ts` 的 `refresh` 仍为裸 `renderTop()`（无 rAF 合批）。但 ADR-293 后
`refresh` 调用频率已大幅下降（cap 订阅经 `listenerSet.subscribe → notify → menu.refresh` 改为
**离散事件驱动**，非逐帧），N cap 同波触发 N 次 `renderTop` 的场景已不存在。维持观察，不修。

### §18.1 §4 / §13 既有判定复核

| 原判定 | 现状核实 | 结论 |
|--------|----------|------|
| G-1（撤销） | `ground-menu.ts:126-172` **groundBuildGridFolder 四控件齐全**（ground-size / divisions / 双色）；`ground-capability.test.ts:586-588` 值域回归锁在 | ✅ 维持撤销 |
| G-2 冗余重构 | 回调仍对**任意 ground 键**四连（ground-capability.ts:141-144）。**此属有意收口**：`setter 内手动 refresh 已删（锐评修复）`，单出口 + needsRebuild 判别承担防双刷。零厂商响应意图 | ✅ 维持「重构可选」，不主张拆（G-9 替代落点见下） |
| G-3 waterSize 派生 | `schema 默认 80 ↔ uiRange 10-300`（env-state-schema.ts:151-158）与 water 对齐；water-menu.ts:113 注释明确「声明式引用 groundSize 默认」的语义仍靠**命名巧合**（无机制断言） | ◇ 半维持（P3，机制仍缺） |
| G-4 saveState 手抄 | **未修**：ground-capability.ts:698-729 仍手写 27 字段清单 | ◻ 维持待办（G-8 重述 + 可修路径） |
| G-5 emoji toast | **未修**：`❌ ${t(...)}: ${name}`（ground-capability.ts:501） | ◻ 维持待办 |
| S3-5 / G-1 网格四参数 | ✅ 已补出口 | ✅ 维持关闭 |
| S3-1 ~ S3-4 布局类 | 均为 UX 判定，非接线错误；本轮不重述 | — |

### 18.2 本轮新发现接线缺陷

> 分级沿用 §13：🔴 真实缺陷 / 🟡 性能冗余 / 🟢 UX / ⚪ 观察。

#### 🔴 G-6「手改即 custom」中间件失守（真实缺陷，已修复）

**链路**（ground-capability.ts + env-state.ts）：

```
openTexturePicker → acceptLoadedTexture → setEnvState({groundSourceKind:"texture"}, manual)
  → 中间件(env-state.ts:86-91)：patch.groundMaterialPreset === undefined（未带上）
    && GROUND_MATERIAL_PRESET_KEYS.some(k => patch[k] !== undefined)  →  无
  → 不置位 custom
  → ground 回调 refreshSurface：buildGroundSurfaceSpec 读 currentTextureToken
     = customTex（非 null）→ 渲染 customTex
```

而**转折点在清贴图分支**：

```
clearCustomTexture()（ground-capability.ts:469-482）：
  customTex = null  ← 私有态摘除（不在 envState）
  setEnvState({groundSourceKind:"canvas", groundCanvasStyle:"plain"}, manual)
  wasAttached && (this.surfaceTex = null)   ← setEnvState 同步派发**之后**才执行！
  this.refreshSurface()  ← 显式兜底落地
```

**病灶**：`clearCustomTexture` 先 `setEnvState`（**同步**触发 ground 回调 → `refreshSurface`，此时 `surfaceTex` 还未被清 → `buildGroundSurfaceSpec` 的 `textureToken` 仍含旧 `customTex` token），随后 `refreshSurface()` **再跑一遍**。顺序问题的可见后果是两次全量重建 + 中间一帧纹理失配；但**真正放走中间件**的缺口在 `texture` → 其他来源的**常规切换**与 `loadState`：

- `setSourceKind("solid"/"none"/"canvas")`（ground-capability.ts:542-546）、
  `setCanvasStyle(...)`（550-554）：**不携带** `groundMaterialPreset`，且在 texture 态下
  `patch` 不含任何 `GROUND_MATERIAL_PRESET_KEYS` 键 → 中间件不置 custom。
- 用户「选了贴图 → 又切回 solid / 清贴图」后，菜单 `ground-mat-canvas-style` select 的
  `get()` 仍读 `getMaterialPreset()` → `envState.groundMaterialPreset` 仍为 `"plain"`，
  **下拉回跳**（不复位 custom），而实际材质已是手改状态。
- `loadState`（ground-capability.ts:764-766）恢复 `groundMaterialPreset` 走
  `skipMiddleware:true` 显式豁免——**恢复路径合法**（存档还原非手改），不是漏洞；
  但 saveState 会把 `custom` 落盘，重启后 loadState 能正确还原——**该键持久化语义是对的**。

**判定**：贴图加载（`groundSourceKind:"texture"`）与清贴图都是**用户手动动作**，虽不写
`GROUND_MATERIAL_PRESET_KEYS`，却是标准「脱离材质预设」事件——中间件白名单刻意「精确」
（不含 grid/overlay/opacity 系列，避免误清），却**漏了 sourceKind/canvasStyle 这两个
真正改变材质形态的轴**。现状是：切贴图 → 回切 solid，菜单下拉恒显示「素面」而非「自定义」，
`groundMaterialPreset` 名实不符（预设状态与用户手改事实脱节）——恰是 ADR-254 要消灭的病。

**修复**（已落地，commit 见 §18.5）：中间件补充一条「来源轴判定」——
`patch` 触碰 `groundSourceKind`（且 target 不是 `none`）或 `groundCanvasStyle` 时同样置位
`custom`。修正后：贴图加载 / 清贴图 / texture→solid 切换 → `groundMaterialPreset: "custom"`
（`setMaterialPreset` 自带该键 → 天然豁免）；`groundSourceKind:"none"`（彻底无表面层）不置位
——none 下素材层级已归零，custom 标记无意义，且预设点击（auto/manual 均带 preset 键）不受影响。

#### 🟡 G-7 refreshSurface 每次 ground 组变更构造完整 spec（维持原 G-2 语义）

回调体（ground-capability.ts:141-144）对**任意** ground 键执行 4 连；`refreshSurface`
（415-438）**无条件**构造完整 `GroundSurfaceSpec`（含 `groundSurfaceNeedsRebuild` 比较）。
滑杆 oninput 逐帧直写（`setMatOpacity` 等）→ 每帧构造 spec + token 字符串比较。与 water 的
分派表（按组分类）相比，ground 用「全接口 + needsRebuild 判别」兜底。热路径成本低于 sky/
reflector 的重建，但**每帧字符串 key（JSON.stringify `buildGroundSurfaceSpec`）**在主线程是
可见分配。**判别判别了「重建」，但没判别「是否需构造 spec」**。

- 影响：中（滑杆高频交互下有感知分配；无 draw-call 或 GPU churn）
- 建议（可选，不主张强拆，保留单出口）：对**纯 appearance 键**（matOpacity/matRoughness/
  matMetalness）在回调体加空转短路，或 `refreshSurface` 用「Appearance 键集」先筛——对齐
  G-2 的「按键分组」建议，但以最小侵入实现（不改单出口架构）。

#### 🟢 G-8 saveState 手抄清单（承接 G-4，未修）

ground-capability.ts:698-729 手写 27 字段。对比 water 侧 `getPresetKeys("water")` schema 驱动
（water saveState 用 `for...of`），ground 手抄 err 风险真实存在（ADR-249 拆轴时漏 groundSourceKind
病史）。**可修路径**：`getPresetKeys("ground")` 已存在（env-state-schema.ts:791），可做
`for (const key of getPresetKeys("ground")) acc[key] = envState[key]`，cap 级 `enabled` 仍手写。
未做（非本次轮次范围，留待收敛），仅记录路径。

#### ⚪ G-9 openTexturePicker 失败 toast 硬编码 emoji（承接 G-5）

`❌ ${t("preview.groundMatLoadFailed")}: ${file.name}`——emoji 前缀不经 i18n，ja/en 包观感割裂。
建议整条消息键化（`groundMatLoadFailed` 带 `{name}` 参数）或注释豁免。三语言包键一致性有
`locales-consistency.test.ts` 守卫，路线明确，仅记录。

### 18.3 接线缺口（死键/双轨）全面盘点

**死亡或双轨状态核查全量 ground 键 → 结论：无其余漏网键。** 21 键对照：

| 键 | 菜单控件 | saveState | loadState | 回调 | 判定 |
|----|----------|-----------|-----------|------|------|
| groundVisible | ground-visible ✓ | ✓ | ✓ | ✓（三层合取） | ✅ |
| groundGridVisible | ground-grid-visible ✓ | ✓ | ✓ | ✓ | ✅ |
| groundSourceKind | ground-mat-source ✓ | ✓ | ✓ oneOf | ✓ | ✅（G-6 中间件除外） |
| groundCanvasStyle | ground-mat-canvas-style ✓ | ✓ | ✓ oneOf | ✓ | ✅ |
| groundMaterialPreset | 同 canvas-style select（读写合一）✓ | ✓ | ✓ oneOf | ✓（中间件置位） | ⚠️ G-6 |
| groundOverlay / Color / Size / Opacity | overlay folder ✓ | ✓ | ✓ oneOf（delayColor/size/opacity） | ✓ refreshOverlay | ✅ |
| groundSize | ground-size ✓ | ✓ | ✓ | ✓ syncGeometry | ✅ |
| groundDivisions | ground-divisions ✓ | ✓ | ✓ | ✓ syncGeometry | ✅ |
| groundColorCenter / Grid | 2 color ✓ | ✓ | ✓ | ✓ syncGeometry | ✅ |
| groundMatColor | color ✓ | ✓ | ✓ | ✓ | ✅ |
| groundMatColor2 | color ✓ | ✓ | ✓ | ✓（color2 仅噪声模式可见，渲染亦仅噪声读） | ✅ |
| groundMatGridSize | slider ✓ | ✓ | ✓ | ✓ | ✅ |
| groundMatOpacity/Scale/Rotation/Roughness/Metalness | 5 slider ✓ | ✓ | ✓ | ✓ | ✅ |
| groundMatDensity / AngleDeg | 2 slider ✓ | ✓ | ✓ | ✓（恢复走 setMatXdensityRestore skipMiddleware） | ✅ |

**无「有 schema 有持久化但零回调/零菜单」的漏网死键**——网格四参数（G-1/S3-5）已补，全组闭环。

### 18.4 接线质量亮点（本轮重确认）

1. **单出口回调收敛**：2019-09-20 修复后所有 setter 只写 envState，落地唯一在回调——`setVisible`
   / `setGridVisible` 不再手改 `overlay.visible`（防「地面已隐、格线还漂」残影）；`synGeometry`
   GridHelper 重建 + 尾部 `updateGridVisible` 收敛。
2. **enabled 私有复用防御**：registry 工厂恒 `new GroundCapability(ctx)`（不传 enabled）→ 构造期
   enabled=true 是**每次会话的默认**；loadState 恢复 enabled 字段 → 循环重生时正确重建。
   `setEnabled(true)` 重挂后 overlay.visible 重算（P3-5 修复）防 stale。
3. **来源门**（ADR-254）：中间件只对 manual 置位 custom；auto-atmosphere/auto-model 程序化派发
   免疫；`skipMiddleware` 豁免恢复路径。**本轮的 G-6 修补不破坏既有来源门语义**（只扩了 manual
   下「何为手改」的判定）。
4. **迁移层纯函数**：三代存档归一全程 `ground-migrations.ts` 纯函数（零 THREE/DOM/envState），
   node 可测，回归锚 `ground-migrations.test.ts` 逐条锁死。
5. **值域单一事实源**：网格四参数/材质滑杆全走 `getParamRange`（ADR-283），菜单不再有第二事实源
   （`ground-capability.test.ts:569-599` 回归锁）。

### 18.5 修复记录：G-6 TDD

| 步骤 | 结果 |
|------|------|
| 新增回归测试（`ground-capability.test.ts`「G-6 中间件」用例） | 对**旧实现**实测 1 failed（fail: 预期 custom，实际 plain；证明非空转） |
| 修改 `ground-capability.ts` 中间件来源轴分支 | green |
| `vitest --run src/preview-3d/caps/ground-capability.test.ts` | N passed（新增 2 例） |
| `vitest --run src/preview-3d/` | 全量绿 |
| `npx vite build` | ✓ |
| `npm run typecheck` | ✓ |
| `check-biome --files ground-capability.ts ground-capability.test.ts` | ✅ |

> 提交：`<type>: <desc>`（见 git log）——仅含 ground-capability.ts + 其测试 + 本报告。

---

## §19 同类情况横向排查（2026-10 问询轮「还有类似的情况吗」）

> 问题溯源：G-6 是「用户手动动作未触发状态标记」的缺陷。横向排查环境系统全部 cap，问题
> 一分为二：**A. 来源纪律（restore 用 manual 打穿守卫）**、**B. 保存清单手抄 vs schema 驱动**、
> **C. cap 私有 enabled 双键**。逐一实地核查，结论：**A/C 无活动故障（均被守卫/归属兜住），
> B 是零故障风险的债务，另有 G-6 的旁支变体已随本轮一并修复**。

### 19.1 来源纪律（A 类）——环境系统横向 verdict

| cap | loadState 恢复 source | 已修？ | 现况 |
|-----|----------------------|--------|------|
| sky | `auto-model` | ✅（S-1 收口 2026-09-22） | 正确 |
| fog | `auto-model` + suspend | ✅（F-2） | 正确 |
| env | `auto-model` + suspend | ✅（E-2） | 正确 |
| light | `auto-model`（light-persist，acc 合批） | ✅（L-1 收口 2026-09-22） | 正确 |
| postprocessing | `auto-model`（表驱动字段全 auto-model） | ✅（P-1） | 正确 |
| ground | `manual` + skipMiddleware | ⚠️ 部分（G-6 已修中间件，loadState 仍 manual 但**有 skipMiddleware 豁免**） | G-6 中间件修复后正确 |
| **reflector** | **`manual`**（reflector-capability.ts:297-303） | ❌ **未修** | **潜伏（latent），见下** |
| **shadow** | **`manual`**（shadow-capability.ts:483-492） | ❌ **未修** | **潜伏（latent），见下** |
| renderMode | `manual` | ❌ 未修 | 无自动来源会写 renderMode 键，**非漏洞** |

**为什么 reflector/shadow 的 `manual` 恢复是「潜伏」而非「活动故障」**——两条防线共同兜住：

1. **`isStateLoaded` 守卫**：reflector/shadow 的 `applyModelPreset` 首行 `if (this.isStateLoaded) return`
   （reflector-capability.ts:207 / shadow-capability.ts:158），loadState 末尾置 `isStateLoaded = true`。
   装配序 `loadAll() → applyModelDefaults()`（shared-infra.ts:308,314）——有存档时模型默认值**根本不写**
   reflector/shadow 键，故「manual 打穿 auto-model 模型默认」这条 E-3/F-2 病在本二 cap 不成立。
2. **归属隔离**：氛围预设 `ATMOSPHERE_PRESETS` 明确 `❌ shadow 类型（技术质量档）/ reflector 尺寸（场景布置）`
   （atmosphere-presets.ts:10-11）——auto-atmosphere 永不写这两组键，故「manual 打穿氛围预设」也不成立。
   唯一会写 reflector/shadow 的自动来源（模型默认）恰被守卫挡掉，manual 锁无受害方。

> **结论**：reflector/shadow 的 restore `manual` 是**格式不一致的债**（与六 cap 同族），但不是**活动 bug**。
> 修它的收益仅是「物体一致性」（新 cap 读代码不会再误以为 manual 是正确范式），零行为变化。
> **已记录，不做（留作格式收敛候选，与 19.2 的 B 类合并处理更合理）。**

### 19.2 保存清单手抄 vs schema 驱动（B 类）——横向 verdict

| cap | saveState | 是否 schema 驱动 | 风险 |
|-----|-----------|------------------|------|
| water | `getPresetKeys("water")` 循环 | ✅ | 零（新增键写侧自动跟上） |
| light | `buildLightPersistPayload` + `FLATTEN_MAP` | ✅ | 零（字段全集只在 light-presets 声明一次） |
| ground | 手写 27 字段（ground-capability.ts:705-735） | ❌ | 中（§18 G-8 已记录；ADR-249 漏键病史） |
| fog | 手写 6 字段 | ❌ | 低（字段少且稳定） |
| env | 手写 6 字段 | ❌ | 低 |
| pp | 手写 19 字段（postprocessing-capability.ts:730-753） | ❌ | 中（字段多、新增易漏） |
| reflector | 手写 7 字段 | ❌ | 低 |
| shadow | 手写 6 字段 | ❌ | 低 |
| renderMode | 手写 5 字段 | ❌ | 低（debug 工具） |

> **结论**：B 类是真实的同族「手抄清单」债，但它是**零故障风险的风格债务**（不在本次修复范围）。
> 最值得后续收敛的是 pp（19 字段）+ ground（27 字段）——水/光的 schema 驱动先例已证明可行路径。

### 19.3 cap 私有 enabled 双键（C 类）——横向 verdict

| cap | 私有 `this.enabled` | envState gate | 双键？ | 现况 |
|-----|--------------------|---------------|--------|------|
| ground | ✅ L112 | `groundVisible` + `groundGridVisible` | ⚠️ 三键 | 私有 enabled 恒 true（构造 `?? true`，registry 不传），仅存 loadState 恢复；三层合取判据（updateGridVisible/updateSurfaceVisible）以 envState 为真值源 |
| water | ❌（已删，单门收口 2026-09-22） | `waterEnabled` | ✅ 已治 | 单门收口（fog 同法） |
| sky | ✅ L195 | `skyEnvironment` + `skyEnabled` | ⚠️ | `setEnabled` 摘挂；`isEnvironmentEnabled` 读 envState |
| env | ✅ L115 | 无 envState gate（enabled 不入 envState） | ⚠️ | `saveState` 落 `enabled` 私有 |
| fog | ❌（已删） | `fogEnabled` | ✅ 已治 | 单门收口 |
| reflector | ✅ L42 | `reflectorEnabled` | ⚠️ | **历史病灶**（§12 R-2）：`buildReflector` AND 判定 `!this.enabled || !envState.reflectorEnabled`；legacy 存档双键漂移——但 `reflection-chain-invariants.test.ts` 锁死「默认关 AND 关系」，正常升级路径 enabled 构造默认 true |
| shadow | ✅ L39 | 无 envState gate（enabled 私有） | ⚠️ | `setEnabled` 私有；saveState 落 `enabled`；无 envState 镜像键 |
| light | ❌（已删，[ADR-293] 总开关入 envState） | `lightEnabled` | ✅ 已治 | 总开关/线框可见性入 schema |

> **结论**：C 类中 water/fog/light 已「单门收口」（enabled 私有退役，真值源全归一 envState），是圆桌的
> **正确方向**；ground/sky/env/reflector/shadow 仍保留私有 enabled 双键，但 **reflector 是唯一有
> 明确历史病灶（legacy 双键漂移）**的——不过被 AND 语义 + 不变量测试兜住（默认关必须在 envState
> reflectorEnabled=false，私有 enabled 恒 true 不构成误开路径）。C 类同样为**潜伏债务**，非活动故障。

### 19.4 G-6 旁支变体：solid/solid 反复切换（本轮已随 G-6 一并修复）

横向排查时发现 G-6 修复还需覆盖**纯来源轴开关**（不触碰材质预设键）的变体：
- `setSourceKind("solid")` / `setSourceKind("texture")` / `setSourceKind("canvas")` 切换 = 用户手动改材质形态，
  但不携带 `GROUND_MATERIAL_PRESET_KEYS` 中任一键 → 原中间件漏判（菜单下拉回跳旧预设名）。
- G-6 修复的 `sourceKindChanged` 分支已涵盖（非 none 的 sourceKind 变更即置 custom），
  4 例回归测试里「texture→solid→canvas→marble 反复切换一律 custom」与该「texture↔solid 反复切换」同锁。
- **done**：`setSourceKind` 无「同值早退置位」反例——`setSourceKind` 早退守卫 `if (envState.groundSourceKind === kind) return`（ground-capability.ts:543）在中间件**之后**，同值写 still 派发（env-state.ts 无同值去重），但同值写 manual 也会经中间件 → 置 custom；这是可接受的（同值重写 = 用户仍触发了控件）。

### 19.5 结论（回答问题「还有类似的情况吗」）

> ⚠️ **本节结论已于 §21 复核并修订**（2026-09-22）：下述「A/C 无活动故障」的判词**不成立**——
> A 类四路**实际全是 manual**（「被守卫兜住」只说明**无用户可感知症状**，不等于纪律已落实），
> C 类则漏掉了**唯一真·活动级缺陷**：`shadowEnabled` 是**幽灵键**（零消费者），实为 G-6 同级
> 的「真值源分裂」。修订后的判词见 §21.4；本节保留原文以存证判词演变。

- **A 类（来源纪律）**：~~无**活动**漏洞~~——reflector/shadow 的 manual 恢复被 `isStateLoaded` + 归属隔离兜住，
  为格式债（有行为恒等的前提，修它零收益）。见 19.1。**（§21.4 修订：判词错在把「暂无症状」当「已合规」；
  ground/reflector/shadow/renderMode 四路确为 manual，是**纪律未落实**，非格式债。修它零**行为**收益，
  但收益在**回归防护**：同轨写入不再被静默拒绝，且与 fog/env/light/pp/sky 同轨，消除将来「照抄邻座」
  抄错轨的风险。）**
- **B 类（手抄 saveState 清单）**：环境系统有 7 个 cap 仍手抄（ground/fog/env/pp/reflector/shadow/renderMode），
  是零故障风险的债务，water/light 的 schema 驱动是收敛先例。见 19.2。**（§21.4 维持：但 shadow/reflector
  的「手抄」与幽灵键是同一病根的两面——见 §21.1。）**
- **C 类（私有 enabled 双键）**：~~reflector 是唯一带明确历史病灶的，但被 AND 语义 + 不变量测试兜住；
  water/fog/light 已单门收口为正确方向~~。见 19.3。**（§21.4 修订：本类**漏判最重的一条**——
  `shadow` 的私有门有 UI 写口且 `shadowEnabled` 零消费者，是**活动级**真值源分裂；`reflector` 才是
  「被 AND 语义 + 双键同写兜住」的那个。C 类扫描只看了「私有门是否存在」，未做**键的消费者计数**，
  故漏网。）**
- **G-6 旁支**：纯来源轴开关（solid/texture/canvas）已随本轮中间件修复覆盖，无残余。见 19.4。
- ~~**没有任何证据表明存在第 2 个与 G-6 同级的「活动」接线缺陷**——环境系统 6 面板的最严重
  病灶（E-3/F-2/E-4/S2-4/S1-4/G-6）已全部闭环。~~
  **（§21.4 修订：该判词已被证伪——§21.1 的 shadow 幽灵键即第 2 个活动级缺陷。证伪方法可复用：
  「逐 schema 键计生产消费者数」，零消费者即真值源分裂的信号；本类缺陷的特征是**不产生症状**，
  故行为测试（全绿）永远抓不到它，必须靠机械扫描。）**

> ⚠️ 本轮为**只读排查（§19.1-19.3 未改代码）**；G-6 修复 + 旁支覆盖已在 §18 提交（`66633f35d`）。
> reflector/shadow 的 manual→auto-model 收敛留作「格式一致性」候选（有行为恒等的充分前提，可安全批量做，
> 但单独提交无用户可感知收益，暂缓）。

---

## §20 水面接线锐评修复轮（2026-09-23）

> 轮次：对 water 面板做一轮全新接线体检（复核 §5/§6/§13/§17 旧账全部维持已治），首诊四缺陷
> F-1~F-4 + 轻症 L-1/L-3，除 L-2/L-4/L-5（登记不修）外全部闭环。TDD：F-1/F-2/F-3 先写红测试
> （F-2 对旧实现 2 failed 实证非空转），实现后全绿。

### 🔴→✅ F-2 三无魔法数 `clipBias: 3` 下沉 schema + UI 出口闭环

- **实证**：官方 `Reflector.js`（r185）L81 `options.clipBias || 0` → 烘进 onBeforeRender 闭包
  （L212 调投影矩阵 z 行）——**不可就地改**；地面镜面先例 `reflectorClipBias`（默认 0.003）
  走 envState + schema 值域，water 侧却是裸字面量 `3`（无注释/无 ADR 登记/无测试锁，
  `git log -S` 只指回 ADR-297 主提交）。
- **修复**：schema 新键 `waterReflectionClipBias`（默认 **保持 3 = 现观感零变化**，range
  [0,10] step 0.1；官方 0.003 是不同量级语义，注释明令勿"对齐"回去）。消费点
  `ensureReflector` 现读比对 `reflectorClipBias` 烙值——不一致即 `disposeReflector()`
  弃载体、下拍懒建重建（bias 变更离散，成本可接受）；分派表维持空条目口径。
- **不自犯 R-1**：补 `water-reflection-clip-bias` 滑杆（reflect 组第五控件，同主开
  visibleWhen 门控）+ 三语言 locale 键（`preview.waterReflectionClipBias`）；D3 还原表
  登记 + 偏离值表（5.5）。
- **回归锁**：默认值/值域断言、bias 变更 → 新载体 + RT 即时补挂当前分辨率、bias 不变
  → 载体幸存（防每帧重建抖动）。

### 🟡→✅ F-1 SSR 活跃判定手抄双源 → `isSsrRenderActive()` 单源

- **实证**：同一判别式（ppEnabled ∧ ppReflectionMode ≠ envmap-only）存在两份**私有手抄**——
  pp `ssrIsActive() && this.enabled`（applyReflectorSync 内联）与 water 的
  `ssrActive()`。pp 侧还随 R-1 血案（关 pp 仍白压镜子）演化过一次——手抄副本即分叉隐患。
- **修复**：`state/env-state.ts` 新增纯函数 `isSsrRenderActive()` 收编唯一判别式；pp 侧删
  `ssrIsActive()` 方法、门禁取 `isSsrRenderActive() && envState.ppReflectorDisableWhenSSR`；
  water 侧删私有 `ssrActive()`，`reflectionActive` 改调单源判定（保持逐帧现读纪律）。
- **回归锁**：`env-state.test.ts` 真值表三例（含 R-1 语义：ppEnabled=false → false）；
  既有 pp 压制测试 + water SSR 真值表测试不动而全绿 = 行为恒等证明。

### 🟡→✅ F-3 探针 `env.waterMode` 类型侵蚀 → 收窄 WaterMode + binding 归一

- **修复**：`PathValue["env.waterMode"]` 由 `string` 收窄为 `"film" | "pool"`（preview-paths
  零依赖叶子，采 `"ui.mode"` 同款本地字面量 + 注释指向事实源范式）；binding 两侧过
  `normalizeWaterMode`（fogMode 先例同构，非 pool 一律落 film）；顺手删
  `getWaterMode()` 的冗余 `as WaterMode` cast（schema 推导已是精确联合）。
- **回归锁**：`preview-state.test.ts`「探针写入归一」用例（banana → setWaterMode("film")）。

### 🟢→✅ F-4 注释化石：water-menu 头注「无 getMasterToggle / water 无能力总开关」与
cap 实际 `getMasterNodeId()` 矛盾（ADR-195 刀3 前化石）——纠偏。

### ⚪→✅ L-1 / L-3：分派表头注「条目写互不相交」改述为两条收敛保证（不相交 ∪
applyStructuralProfile 幂等全量执行器）；半僵尸 helper `setReflectionUniforms`（归零路
唯一调用）内联进 `renderReflection`，强度写口归 `applyReflectionUniforms` 一处。

### 登记未修（本轮判断，非遗忘）
- **L-2** 一名三拍（wetness/水膜浓度/uBaseOpacity 词典链）：契约全覆盖不构成错，改名 = 存档键迁移成本 > 收益。
- **L-4** S5-2 / S5-3（wetness=0 消失无提示、波纹单控件组）：§13 已定级低优先级 UX，维持。
- **L-5** loadState 不 notify × 已开菜单刷新窗：挂载时序上概率极低，观察项维持。

### 验证
| 门禁 | 结果 |
|------|------|
| F-2 新测试对旧实现 | 2 failed（TDD 非空转证明） |
| `vitest --run src/preview-3d/` 全量 | **2850 passed / 158 files** |
| `npm run typecheck` | ✓（含 F-3 收窄后零消费者破坏） |
| `npx vite build`（locale JSON 再生后） | ✓ built in 8.49s |
| `check-biome --files`（13 文件） | ✅ |
| `check-layering` | ✅ |
| 知识卡回写 | water.md（F-1/F-2 陷阱 + API 五键 + UI 出口）、preview_env_state.md（isSsrRenderActive 登记） |

> check-circular 报 1 环：`views/app-content/diagnostics/perf.ts ↔ perf-scan/single-bench`
> ——本会话未触碰 perf 系文件（git status 可证），属**存量环**（diag 工具区，2026-09-22
> `eff50f47c` 前后即在），与本次改动无关，报告在案待归属会话处理。


---

## §21 环境系统阴影接线锐评修复轮（F-1 幽灵键 + F-2 来源纪律，2026-09-22）

> 轮次：接 §18/§19（G-6 轮 + 横向排查）后的**续诊**。用户问「还有类似的情况吗」后追问
> 「尝试处理属实的话」——本轮据此把 §19 的三类线索**从「登记」推进到「闭环」**，并在复核中
> 发现 §19 漏判的**活动级缺陷**（F-1）。TDD：F-1 五项 + F-2 四项先写红测试（对旧实现
> **9 failed**），实现后全绿。
>
> 方案拍板（用户当场二字确认）：**F-1 取 Option A「并入 schema 单门」（fog/water 先例），
> 不取「删键」**；**F-2 改 4 处 cap + 补来源纪律回归锁**。

### 🔴→✅ F-1 `shadowEnabled` 是幽灵键——第 2 个活动级真值源分裂（G-6 同级）

**发现方法（可复用，本轮首次系统化）**：逐 schema 键统计**生产消费者数**（148 键 × 562 个
非测试 `frontend/src` 文件，逐键 grep，人工排除 schema 声明/i18n/测试/文档四类噪声）。
结果：**`shadowEnabled` 是唯一一个零消费者的键**。

- **实证**：`env-state-schema.ts|shadowEnabled`（group `shadow`，默认 `true`，随 ADR-196
  刀0/1/2 批次 `df84baefb` 引入）自落地起**没有任何 reader、没有任何 writer**。
  真开关是 `shadow-capability.ts` 的**私有 `this.enabled`**，落盘成**无前缀** `enabled`。
  于是三线各说各话：
  - 菜单/headerToggle（`shadow-menu.ts|shcEnabledNode`）读写**私有门**；
  - `saveState` 落**私有门**（无前缀 `enabled`）；
  - schema 键 `shadowEnabled` **恒为默认 `true`**，无人读写。
- **为何是「活动级」而非「格式债」**：`registry.createAll(ctx)` 的 `ctx` **无 `enabled` 字段**
  （`scene-capability-registry.ts|createAll` 只传 `{scene,renderer,camera,caps}`），故私有门在
  生产链路**恒为构造默认 `true`**；它的存在意义只剩「一个恒真的短路门」——`envState.shadowEnabled`
  无论被谁改成 `false` 都不会影响渲染（回调首行 `if (!this.enabled) return;` 拦在真值判断之前，
  且它恒 true 故不拦，但**键本身无人消费**，改了等于没改）。这正是 G-6 的同族病：
  **真值源分裂**——只是 G-6 分裂出「标记不置位」，F-1 分裂出「键是空壳」。
- **为何行为测试抓不到**：无用户可见症状（私有门与用户操作一致），故 §19 的全绿测试套件
  与「6 面板最严重病灶已闭环」的判词都无法发现它——**必须靠消费者计数扫描**。这是本轮
  方法论上最有价值的收获，已写入知识卡。
- **修复（Option A：并入 schema 单门）**：
  1. 删私有 `enabled` 字段与 `opts.enabled` 构造项（**同时退役 8 处测试传参**——它们传的
     `enabled` 从来只是喂私有门，registry 生产路径根本不传）；
  2. **env 回调新增 `changed.has("shadowEnabled")` 分支**——该键本就在 `shadow` 组内，
     `registerEnvCallback` 会自动把它派发到本回调（`env-dispatcher.ts|registerEnvCallback`
     按 `getPresetKeys("shadow")` 建 `groupKeys`）。**不接管则该键改了不落地**——这是本
     修复最易漏的一步（原实现靠私有门短路挂在回调最前，键永无消费者）；
  3. `setEnabled/isEnabled/getParams().enabled` 收敛为 `envState.shadowEnabled` 别名；
  4. 4 处私有门读点（回调顶门 / `syncLights` / `syncMeshes` / `apply`）改读 schema 键；
  5. `saveState` **只写 6 个 schema 键**（`shadowEnabled` + type/mapSize/bias/normalBias/
     cameraSize），不再落无前缀 `enabled`；
  6. `loadState` **双轨吸收**（fog 先例同法）：`enabled` → `shadowEnabled` 回填（仅当缺
     `shadowEnabled`）+ 无前缀 `type/mapSize/bias/normalBias/cameraSize` → 前缀键（判据
     `shadowType` 缺失），保留 `state.soft` 兜底——升级用户不丢配置。
- **回归锁**：`shadow-capability.test.ts`「能力级开关单门收口」describe 五例——
  ① 僵尸门守卫 `expect("enabled" in cap).toBe(false)`（防私有门复活）；
  ② 别名写口真落到 `renderer.shadowMap.enabled`（不只改 envState）；
  ③ **幽灵键不进存档** `expect("enabled" in saved).toBe(false)` + `"shadowEnabled" in saved`
     （用 `restoreState("shadow")` 读真实落盘产物）；
  ④ legacy 中毒救回（旧档 `enabled:false` → 恢复后开关仍能开回阴影）；
  ⑤ F-2 同轨写入。
- **知识卡**：`preview_env_state.md` 新增「锐评 F-1 收口」条 + 「持久化设计」的键形说明改为
  按 cap 分组（fog/water/shadow 只写 schema 键；ground/reflector/environment 仍留旧键形）。

### 🟡→✅ F-2 恢复来源纪律：4 路 manual → auto-model（§19.1 判词错在「暂无症状 ≠ 已合规」）

- **实证**：§19.1 的表格把「恢复 source」列出来了，但结论把它读成「被守卫兜住 = 无活动漏洞」。
  复核后判词应更准：**这是纪律未落实**（fog F-2 / env E-2 / light L-1 立法要求一律
  `auto-model`，而 ground/reflector/shadow/renderMode 四路**实际全是 manual**）。
  用户可感知症状确实没有（`isStateLoaded` 守卫 + `MODEL_DEFAULTS` 键集 + `ATMOSPHERE_PRESETS`
  排除三线恰好掩住），但 **`_writeSource` 被钉成 manual 后，同轨 `auto-model` 写入被
  `shouldOverwrite` 静默吞掉**——值不变、无报错、无日志。
- **修复（行为中性，收益在防护）**：四路恢复写入 source 全改 `auto-model`。
  - `render-mode-capability.ts`：1 处（合并 partial 单次写入）。
  - `shadow-capability.ts`：随 F-1 一并改（6 键）。
  - `reflector-capability.ts`：6 处。
  - `ground-capability.ts`：**两条路径**——`loadState` 内直连 `setEnvState` 的 12 处
    **加上**委托公开 setter 的 ~9 处。后者是本轮最细的一处：那些 setter 服务**用户手改**
    （必须保持 manual），恢复时若不显式传来源就会留暗门。故新增
    `ground-capability.ts|RESTORE_SOURCE` 常量 + `writeOpts()` 组装器，把「恢复来源」
    收敛成单一事实源（`WriteOpts` 允许 `skipMiddleware` + `source` 两维覆盖）；**并保留
    原有的 5 处 `skipMiddleware:true`**（ADR-254 中间件豁免，与 source 是正交两轴，勿混）。
- **回归锁（一律行为断言）**：`_writeSource` 是 `env-state.ts` 模块私有、**无导出读口**
  （`resetEnvState` 会清它但无生产调用方），故判据只能是**行为**——「loadState 之后用
  `auto-model` 写同键，值必须落地」。四路各一 describe；
  ground 额外锁「委托路径」那条（防只修直连留暗门）+「中间件仍只认 manual」对照例
  （恢复走 auto-model 后 `groundMaterialPreset` 不得被误置 custom，ADR-254 不回归）。
- **知识卡修正**：`preview_env_state.md` 原文「fog F-2 / env E-2 / ground / light L-1 **四路
  同口径**」是**文档先于代码**的漂移（把 ground 写进已合规名单，实际它当时是 manual）。
  已改述为「按**声明**而非按**实施**成立」+ 记录复核与收口，并列出八路真 auto-model 与
  全部回归锁位置。

### 一处既有测试的语义修正（非回归，是判据纠正）

`render-mode-capability.test.ts|loadState null 值视为合法 override` 在 F-2 后失败。核查后
判定：**该用例考的是 `null` 的类型守卫**（null 是合法 override 值，不得当「缺字段」跳过），
**不是**来源优先级；而它原先用 `cap.setWireframe(true)`（manual）预置，恢复改走 auto-model 后
被 `shouldOverwrite` 的「manual 优先」正当拒绝。故把预置值改为同轨 `auto-model`——
**考的还是同一个 null 守卫，只是对照组不再混入优先级维度**。
（附带确认：生产不可达此分歧——`saveAll` 落盘的恒是 `envState` 现值，档案与内存不会不一致；
若强行让恢复凌驾 manual，反而会在「mid-session 重挂载」时回滚用户未落盘的手改。
故**改测试判据而非改 `shouldOverwrite`**。）

### 同族余项复核（§19.3 C 类的补课，结论见知识卡）

> ⚠️ 本条对 `reflector` 的定级**已被 §22 推翻**：「两键恒同步故无症状」是只看了**有存档**路径
> 的误判，`reflector` 实为**同族第二个活动级缺陷**（首启背离 + 凭空建镜）。保留原文以存证判词演变。

- **`reflector` = shadow 的活体孪生，本轮未动手（待拍板）**：`buildReflector` 是**双门**
  `if (!this.enabled || !envState.reflectorEnabled) return;`，`getParams().enabled` 返回
  `this.enabled && envState.reflectorEnabled`。今日无症状只因 `saveState`/`loadState` 把
  **两键都写都读**（恒同步）；但**只要存档缺 `enabled` 键**（旧档/手改档/未来只写 schema 键
  的档），私有门保持构造默认 `true` 而 `reflectorEnabled` 已恢复 → 开关显示 OFF 而 schema
  键 ON。**未随 F-1 一并动手的理由是语义而非工作量**：`reflectorEnabled` 默认 `false`
  而私有门默认 `true`（与 shadow 相反），合一会改变**用户可见的默认态**，须单独拍板取
  「默认关」还是「默认开」。**（§22 修订：无需拍板——schema 侧有注释/邻座援引/不变式三重
  佐证，私有侧零佐证；且定级过低：不止「存档缺 enabled 键」才发作，**首启无存档即发作**。）**
- **`ground` = 僵尸私有门，非 live（暂不动）**：`getMasterNodeId()` 返回 `"ground-visible"`，
  总开关绑的是 `envState.groundVisible`；私有 `enabled` 全仓**无 UI 写口**（`setEnabled`
  虽存在但零生产调用方），生产恒 `true`。读起来吓人、实为惰性——与 shadow 的差别正在于
  **shadow 的私有门有 UI 写口而 ground 没有**（这也再次印证 F-1 的定级方法：判 live 与否
  看**写口**，不只看字段是否存在）。**（§22 补充：ground 的私有门与 schema 侧 `groundVisible`
  默认**同向**（皆 true），故不构成 reflector 那种「首启背离」——判 live 还须比对两侧默认值。）**
- **`environment` = 原教旨形态，非漏网**：`getMasterNodeId` 返回 `"env-enabled"`，开关
  明确设计为不入 envState（源码注释即「能力总开关（不入 envState…）」），是 ADR-196
  「刀5」段「能力级 enabled 不入 schema 红线」的有意保留。

### 验证

| 门禁 | 结果 |
|------|------|
| F-1/F-2 新测试对旧实现（TDD 非空转） | **9 failed**（F-1 五项 + F-2 四项） |
| `vitest --run src/preview-3d/` 全量 | **2865 passed / 158 files**（较上轮 +21） |
| `npx tsc --noEmit` | EXIT 0 |
| `npx vite build` | ✓ built in 9.58s |
| `check-biome --files`（8 文件） | ✅（2 处格式化自动修复后复检通过） |
| 知识卡回写 | `preview_env_state.md`（F-1 收口条 / F-2 判词修订 / 键形分组 / 不变量并列例外 / 同族余项复核） |

> 未修 / 未动（**登记在案，非遗漏**）：`ground` 僵尸门清理（无行为收益，可随手）、
> §18 遗留 G-7/G-8/G-9/G-3、§19.2 B 类手抄清单
> （`pp` 尤其**不可**改 `getPresetKeys`——其持久化键是无前缀方言，schema 驱动会改存档键名
> 而破坏旧档）。

---

## §22 Reflector 单门收口（F-1 二度收口：推翻 §21 的定级，2026-09-22）

> 轮次：用户「继续」后，我对 §21 遗留的「reflector 待拍板」自行取证结案。**结论是 §21 的
> 定级错了**：reflector 不是「被兜住的历史病灶」，而是**同族第二个活动级缺陷**；
> 且原以为需要用户拍板的「默认值冲突」**实为伪问题**（有证据可判，不需拍板）。TDD：新锁
> 对旧实现 **8 failed**，实现后全绿。

### 定级翻案的两条实证

- **① 首启即背离（§21 说「恒同步」是样本偏差）**：§21 的论证「`saveState`/`loadState` 把
  两键都写都读 → 恒同步」**只覆盖了有存档路径**。真正的漏洞在**无存档首启**：私有门
  `opts.enabled ?? true`（registry 不传 → `true`）与 `env-state-schema.ts|reflectorEnabled`
  默认 `false` **方向相反**，于是 `isEnabled()`（菜单 master toggle / env 一级行 headerToggle
  的 `control.get`）读 **`true` → 显示 ON**，而 `buildReflector` 因 `reflectorEnabled === false`
  **不建 mesh** → **显示 ON 却无镜面**。这与 fog 收口前的「master toggle 显示 ON 而
  `scene.fog` 恒 null」是**逐字同病**，也与 §21 自己写的「shadow 症状靠 schema 键无人消费
  暴露」并列——**同一病症的第二个暴露面**。
- **② 冲突有证据可判（故无需拍板）**：`reflectorEnabled` 默认 `false` 是**刻意设计**，三重佐证——
  schema 注释「倒影 = 每帧多一次整场重渲进 RT，不是白拿的」；`water-menu.ts` 邻座援引「与地面
  `reflectorEnabled` 同纪律」；`reflection-chain-invariants.test.ts` 把「单平面镜默认关」列为
  不变式。私有门 `true` 则**零佐证**（只是 registry 不传参的偶然产物）。
  **判据：冲突时以有注释/有 ADR/有邻座援引的一方为准**——本条已写入知识卡方法论。

### 🔴→✅ 连带收获：SSR 抑制环会**凭空建出用户从未开启的镜面**

比「显示 ON 无镜面」更实质的一条，是追猎 `isEnabled()` 消费者时发现的：

- **实证**：`postprocessing-capability.ts|applyReflectorSync` 压制时记录
  `this.reflectorPrevEnabled = reflectorCap.isEnabled()`，解除时用它回放。旧 `isEnabled()` 恒
  `true`，故**用户从未碰过开关**时记下的是 `true`——一个**用户从未表达过的意图**；
  SSR 关闭还原即 `setEnabled(true)` → **镜子凭空出现**。
- **为何既有测试没抓到**：现有的「reflector 原本就关」用例**先显式调了
  `reflector.setEnabled(false)`**（用户表过态，prev 如实记 false），故旧实现也能通过。
  **真正漏网的是「用户没表过态」这条路径**——补了它，实测在旧语义下转红（为防锁空转，
  我用临时探针把 `isEnabled()` 改回 `return true` 复跑：**9 failed**，含本用例，确认非恒真）。
- **为何这属于真缺陷而非设计**：SSR 压制是**功能语义**（重叠反射禁止），它只该**临时关闭**
  用户已开的东西并**原样归还**；它不该**开启**用户没开的东西。旧语义把「归还」变成了「激活」。

### 收口（与 fog/water/shadow 同法）

1. 删私有 `enabled` 字段 + `opts.enabled`（退役测试 8 处构造传参；pp `makePair` 的
   `enabled: true` 改为 seed `envState.reflectorEnabled: true`——语义等价且更贴真实链路）。
2. `buildReflector` 单门：`if (!envState.reflectorEnabled) return;`。
3. `setEnabled/isEnabled/getParams().enabled` 收敛为 schema 键别名（`setEnabledReflector`
   保留，与 fog `setEnabledFog` 双件同法）。
4. `saveState` 只写 6 个 schema 键，不再落无前缀 `enabled` 幽灵键。
5. `loadState` 按 fog 先例**回填** legacy `enabled` → `reflectorEnabled`（仅当存档缺该 schema 键）。
   注意原实现那条 `enabled` 分支是把幽灵键**写回私有门**，现改为写入 schema 键。
6. 同步修正两处「把病灶当不变式」的测试文件：`reflection-chain-invariants.test.ts`
   原本断言 `isEnabled()===true` 且 `getParams().enabled===false` **并加注说明 AND 关系**——
   等于给病根发了备案；已改述并补「首启菜单读数与 schema 键同源」一例。

### 回归锁

`reflector-capability.test.ts`「能力总开关单门收口」describe 六例：僵尸门守卫
（`expect("enabled" in cap).toBe(false)`）/ 别名双向同步（含**首启菜单读数必须为 false**）/
直接写 envState 即驱动建拆 / 幽灵键不进存档 / legacy `enabled` 回填 / legacy 中毒救回；
`reflection-chain-invariants.test.ts` 补「首启菜单读数同源」；
`postprocessing-capability.test.ts` 补「用户从未开过 → 压制还原一轮后不得凭空冒镜」。

### 验证

| 门禁 | 结果 |
|------|------|
| reflector F-1 新锁对旧实现 | **8 failed | 30 passed** |
| pp 连带锁对旧语义（探针实证非恒真） | **9 failed** |
| `vitest --run src/preview-3d/caps/` | **979 passed / 25 files** |
| `vitest --run src/preview-3d/` 全量 | **2872 passed / 158 files**（较 §21 再 +7） |
| `npx tsc --noEmit` | EXIT 0 |
| 知识卡回写 | `preview_env_state.md`（F-1 二度收口条 / 同族余项改判 / 不变量并入判据 / 键形分组） |

### 方法层沉淀（本轮最有复用价值的两条）

1. **判「私有门是否病灶」须三问**，缺一即误判：①有无 UI 写口；②**私有默认值与 schema 默认值
   是否一致**；③零消费者扫描是否命中。§19.3 只问了①，§21 问了①③但把②看漏，故两次都没抓住
   reflector——它的症状既不来自写口（弱），也不来自零消费者（键有消费者），而**只来自默认值相反**。
2. **不变式测试也会成为病灶的掩体**：`reflection-chain-invariants.test.ts` 当年读 three 源码后
   把 AND 关系**作为事实固化下来**（还加了「注意与构造 `enabled ?? true` 区分」的注脚），
   复核时它的全绿被当成「此处无误」的证据。**复核既有测试时要问：这条不变式是在描述期望，
   还是在给现状背书？**——描述「当前两值是什么关系」的断言，会把 bug 一起锁进去。

---

## §23 Sky 单门收口（F-1 三度收口：本族最后一个结构病余项，2026-09-22）

§19 的横向排查、§21（shadow）、§22（reflector）已把地面/水面/阴影/反射四路的能力级开关从
「私有门 + 无前缀幽灵键」收编进 schema 单门。**sky 是本族最后一个在结构上已具备病灶的余项**，
本节闭合它，并使**全仓 29 枚 boolean schema 键全部有生产写入者**（零幽灵键）。

### 23.1 病灶形态：一个文件里三处同病

`sky-capability.ts` 同时含三处「schema 键 + 私有镜像」，是本次最值得记的发现：

| # | 私有态 | 对应 schema 键 | 写口 | 收口前症状 |
|---|--------|---------------|------|-----------|
| ① | `private enabled: boolean`（构造 `opts.enabled ?? true`） | **键不存在** | `sky-menu.ts\|skyEnabledNode` toggle | 开关只有私有落点；`saveState` 落无前缀 `enabled` 幽灵键，`loadState` 读回私有门 |
| ② | `SunBeams.enabled`（`sun-beams.ts` 私有门） | `skyGodRaysEnabled` | `sky-capability.ts\|setGodRaysEnabled` | **幽灵键**：schema 声明了键，生产码零写入者，真开关藏在 helper 类的私有门里 |
| ③ | `private autoRotateOn`（靠 env 回调同步的镜像） | `skyAutoRotate` | `startAutoRotate`/`stopAutoRotate` | **潜伏**：`loadState` 改走 `suspendEnvCallbacks()` 后镜像永不回填 |

第 ③ 处**不是靠读代码发现的，是靠给 `loadState` 补 `suspendEnvCallbacks()` 照出来的**——
挂起派发即切断「回调同步镜像」这条隐线，任何依赖它的私有态立刻失同步。补挂起后
`skyAutoRotate` 持久化用例实测转红（存档 `true`、`isAutoRotating()` 读 `false`），
**这条新加的正确性改动，反过来照出了同文件第三处旧病**。

> **方法沉淀**：想找出 cap 里所有「schema 键 + 私有镜像」，比逐行 grep 更有效的探针是
> **给 `loadState` 补 `suspendEnvCallbacks()`**——凡是靠 env 回调维持同步的私有态都会失同步。
> 这条探针既做对事（恢复期防重入双跑），又免费做体检。
> **红相须实测**：本轮以 `git checkout <父提交> -- <三个实现文件>` 临时回退实现（保留新测试）
> 跑出 **8 failed \| 98 passed**，逐条核对失败原因后 `git checkout HEAD --` 完整还原——
> 确认八例各自命中预期缺陷，而非「碰巧红」。

### 23.2 收口依据：ADR-250 已推翻旧红线

§19 曾援引 ADR-196 记的「per-type 门禁，属能力级 enabled 不入 schema 红线」判定 sky 暂缓。
本轮核实该红线**已被 ADR-250（已采纳，2026-09-16）判定为误判并推翻**：

> 门禁之所以一度无家可归，是因它被误判为「能力级挂载」。但实际上「是否显示后处理效果」是
> **用户对可见效果的偏好**，与「cap 是否构造」是两件事。

且 ADR-250 §2.4 点名 **sky** 与 pp/light/fog/shadow/reflector 走同一条路；源码侧 `ppEnabled`
已入 schema、`POSTPROC_PRESETS`/`perTypeGate`/`perfMaster` 已退役——**收口 sky 不是「要不要破例」，
而是补上 ADR-250 已宣告的同族之路**。

> **方法沉淀**：ADR 的「背景/Context」段是**决策时的历史快照**。旧 ADR 里的一条红线，
> 可能已被新 ADR 在「决策」段明确推翻。评估「该不该并入」时须查**最新** ADR 的决策段，
> 不能只读旧 ADR 正文里那句红线。

### 23.3 收口内容

1. **schema**：新增 `skyEnabled`（默认 `true`）置于 `// --- Sky ---` 之后首位，
   对齐 water/fog/shadow/reflector/pp 的既有布局（每组的 `XEnabled` 键都排第一）。
   默认 `true` = 被退役私有门的有效默认 → **零行为漂移**（**无** reflector 那种默认值冲突，
   故无需拍板）。
2. **删私有门**：`private enabled` 与 `private autoRotateOn` 一并退役；
   `isEnabled/isAutoRotating/isGodRaysEnabled/update/apply/applyModelPreset` 一律直读 envState。
   `SunBeams` 删 `enabled`/`setEnabled`/`isEnabled`，**降为无状态执行器**——挂载判据只剩
   几何/角度事实，不再含能力开关语义。开关请求态由宿主 `sky-capability.ts|syncBeams` 现读判定。
3. **回调接管**：新增 `changed.has("skyEnabled")` 分支（开态 `apply`、关态 `detach` + notify）。
   开态可直接 `return`——`apply()` 已从 envState 全量重写 uniform/挂载/曝光/IBL/光束，
   同批兄弟键亦被覆盖，与 shadow 同形。
4. **存档键形**：两枚开关改落 schema 键形（`skyEnabled`/`skyGodRaysEnabled`），
   **兄弟键保持无前缀方言零迁移**——`environment` 键另有跨槽读者
   （`environment-capability.ts|loadState` 读 `skyState.environment` 做 ADR-292 旧档归一），
   改名即断链。同族先例：reflector 亦仅前缀总开关。
5. **legacy 回填 + 挂起派发**：`loadState` 双腿吸收旧档（`enabled`→`skyEnabled`、
   `godRaysEnabled`→`skyGodRaysEnabled`，判「前缀键缺失 ∧ 旧键类型合法」），
   并补 `suspendEnvCallbacks()`（fog/water/env/light 同法）。
   **不加 `isStateLoaded`**——sky 不在 `MODEL_DEFAULTS`（ADR-284 大气与类别解耦），
   无同轨模型写对手，原 `loadState` 注释里的这条理由依然成立。

### 23.4 为何是「结构病」而非「活体故障」

诚实定级：sky 收口前**用户可见行为是正确的**（开关读写一致、存档往返一致——私有门双轨自洽）。
它缺的是单门收口的保障：`getParams()`/UI 与真值源之间是私有态直读，任何「只写 envState 的旁路」
（氛围预设、未来程序化调用）都无法改变天空开关。故本节的价值是**真值源统一 + 消除幽灵键**，
不是修一个正在发作的故障——这点与 §22 reflector（**有实测可复现的首启背离**）不同，不可混为一谈。

### 回归锁

`sky-capability.test.ts`「能力级开关单门收口」describe 八例：僵尸门守卫 ×2（cap 与 `SunBeams`
**均**不得持有 `enabled` own 属性）/ 别名双向真落场景挂载 / 幽灵键 ×2 不进存档 /
legacy 中毒救回 ×2（旧档 `enabled=false`、旧档 `godRaysEnabled=true`）/
别名走单一真值源 / **第三处镜像：`autoRotateOn` 退役 + 挂起恢复后仍能推进时间轴**。

### 验证

| 门禁 | 结果 |
|------|------|
| sky F-1 新锁对旧实现（红相，实测） | **8 failed \| 98 passed**（八例逐条命中预期缺陷：僵尸门 ×2、别名无 envState 落点、幽灵键 ×2 仍进存档、legacy ×2 不回填、第三处镜像仍在） |
| 复审补三例 + 存档形态闸对旧实现（红相，实测） | **14 failed \| 104 passed**（sky 11 + persist 3） |
| sky 收口后单文件 | **106 → 109 passed**（复审补三例后） |
| `restoreState` 形态闸单文件 | **9 passed** |
| `vitest --run src/preview-3d/caps/` | **1000 passed / 26 files** |
| `vitest --run src/preview-3d/` 全量 | **2893 passed / 159 files** |
| `vitest --run` 前端全量 | **6735 passed / 424 files** |
| `npx tsc --noEmit` | EXIT 0 |
| `npx vite build` | EXIT 0 |
| `check-biome --files`（改动文件） | 通过 ✅ |
| 独立子代理复审 | 七轴核实成立，2 项误报经实证驳回，1 项真缺陷已修 |
| 全 29 枚 boolean schema 键生产者扫描 | **零幽灵键**（收口前 `skyGodRaysEnabled` 是唯一零写入者） |
| 知识卡回写 | `preview_env_state.md`（sky 收口条 / 同族余项改判 / 并入判据补 sky / 键形分组 / light 注脚补两形态对比） |

### 方法层沉淀

1. **`suspendEnvCallbacks()` 是私有镜像的照妖镜**（见 §23.1）——补挂起能一次照出所有
   「靠回调同步的私有态」，比 grep 有效。
2. **一个文件可以携带同一种病的多个样本**：sky 三处（①无键私有门 ②有键但幽灵 ③有键有写口
   但靠镜像同步），形态各异、病根同一。审计不能停在「这个 cap 查过了」。
3. **幽灵键的机械扫法可复用**：逐 schema 键统计生产消费者，**判别式是「读而无写」**而非
   「零消费者」——`skyGodRaysEnabled` 有读者（回调分支 + notify 列表）却零写入者，
   单纯数「有没有人提到它」会漏判。
4. **诚实定级**：结构病 ≠ 活体故障。同一族的 reflector 有可复现的首启背离，sky 只有
   「将来任何第三条写路都会失效」的结构隐患。报告里必须写清是哪一种，否则方法层的
   「并入判据」会被误当成「凡私有门皆故障」。

### 23.5 独立复审（子代理）与处置

派独立子代理复核 `047f51808`，结论「**有保留地通过**」：中心主张七轴全部核实成立
（真值源唯一 / 无私有字段 / 无幽灵键 / 旧档可恢复 / `syncBeams` 关闭路由严于旧实现 /
`autoRotateOn` 退役方向正确 / 八例测试非空转），提 6 项问题。**逐条实证后：2 项误报、
3 项确认（1 项已修、1 项补注释、1 项今无害）、1 项降级**。

| # | 复审主张 | 实证结论 |
|---|---------|---------|
| 1 | `apply()` 丢了 `skyEnvironment` 门 → 关掉的 sky-IBL 被点亮 | **误报**。`sky-capability.ts\|apply` 该处现为 `if (envState.skyEnvironment) requestEnvironmentRefresh(true); else clearEnvironment();`——门在；且 `requestEnvironmentRefresh` 内另有 `if (!envState.skyEnvironment) return;` 自守。复审读的是 `requestEnvironmentRefresh` 被调用这一事实，未读调用点的条件 |
| 2 | 裸 `in` 不防非对象存档 → 异常被 `loadAll` 吞、后续 cap 静默跳过 | **确认且已修**（见 23.6）。复审判「家族既有」正确——fog/shadow 同形 |
| 3 | `getParams()` 缺 `enabled`，是「全仓唯一未跟齐」 | **降级**。实测 light/postprocessing 亦无（3/6 有、3/6 无），非唯一例外；且全仓零消费者，今日影响 0，不改 |
| 4 | 关闭期间不 `sync()` 致锥体态陈旧 | **确认但有意**。已补注释说明「重开必经 `apply()` 重算，无残留脏渲染」 |
| 5 | `SunBeams.sync()` 失去 `!group` 早退会 NPE | **误报**。`sun-beams.ts\|sync` 首行即 `if (!this.group) { /* 仅清 tint */ return; }`，早退在 |
| 6 | 构造期 `manual` 封死未来预设通道 | **确认，今无害**。已补注释警示「日后给氛围预设加天空开关会静默失效」 |

**复审另有价值的是它指出的 3 处测试缺口**（混合双形式档 / 恢复后关闭 / 同批兄弟键），
已全部补齐（见 23.6），其中「同批兄弟键」正是**验证我 23.1 那个早退 `return` 是否吞键**
的护栏——复审自己分析为安全，我补了测试钉住。

> **方法沉淀**：**复审报告也要实证，不能照单全收**。本轮 6 项里 2 项是误报（第 1、5 项
> 都是「该有的守卫其实在」，复审读到了调用事实却没读调用点的条件/函数首行）。
> 反向也成立——它的第 2 项虽在旧代码里就有，但被我这次改动**新引入了一个可抛点**
> （sky 此前走 `restoreFields` 的 `typeof` 分派天然免疫，是我新加的 legacy `in` 回填
> 才让 sky 暴露在该路径下），这类「非我引入、但我放大了触发面」的关联必须认。
> 判据：**逐条 grep 到行再定级，不按概率采信**。

### 23.6 复审驱动的收口：`restoreState` 存档形态闸

复审第 2 项经实测为**真缺陷**（探针实证：`localStorage.setItem("ysm-scene-cap-sky", "5")`
→ `restoreState` 返回 `5` → `"skyEnabled" in 5` 抛
`TypeError: Cannot use 'in' operator to search for 'skyEnabled' in 5`）。

**后果链**：异常在 `loadState` 内抛出 → 被 `sceneCapabilityRegistry.loadAll()`
的 per-cap try/catch 吞掉并 `continue` → **后续 cap 全部静默跳过恢复**；而 `ringLog`
无生产 sink，用户只见黑场景、零提示。触发条件仅「手改 / 损坏的 localStorage」，
正常路径写不出非对象存档。

**修法选择：收口在唯一入口而非各 cap**。`restoreState` 是 9 个 cap `loadState` 的共同
第一跳，且**各调用点已有的 `if (!state) return` 早退**恰好就是非对象该走的路——
故把「存档必须是 JSON 对象（非 null / 非数组）」收在 `restoreState`，非对象真值一律
返回 `null`（同「无存档」语义），一处修、9 点全免疫，各 cap 不必各写一遍 typeof 守卫。
数组亦排除（`in` 对数组不抛错，但语义上不是存档对象）。

回归锁 = 新建 `scene-capability-persist.test.ts` 九例（number/string/boolean/`null` 字面量
/数组/损坏 JSON/键缺失/合法对象/空对象/往返自洽），红相实测 **3 failed**
（number、string+boolean、数组），绿相 9 passed。

**同轮补的三处测试缺口**（`sky-capability.test.ts`）：
① 旧档 `skyEnabled=false` + `godRaysEnabled=true` → 恢复后**不挂天空、不挂光束、tint 同卸**
且 `update(dt)` 冻结时间轴（原八例只有开态与救回，缺关态反向护栏）；
② 同一 `setEnvState` 同批写 `skyEnabled` + 两枚兄弟键 → 早退 `return` 不得吞键；
③ 混合双形式档 `{skyEnabled:true, enabled:false, ...}` → **新前缀键优先**，旧键不得覆盖。
三项合计使 sky 单文件 106 → **109 passed**；对旧实现整体红相 **14 failed | 104 passed**。


