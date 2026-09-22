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
| S2-1 | sky-capability.ts:639 setTime | timeline 拖动 forceEnv 恒 true → 每帧 PMREM 全重建 | 拖动期降为阈值门控，松手 force 一次 |
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

