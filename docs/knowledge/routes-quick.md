<!-- 本文件由 scripts/gen-routes-quick.ts 自动生成，请勿手改。重跑：node scripts/gen-routes-quick.ts -->

# AI 急速版路由表（高频场景）

> 本表由知识卡 frontmatter 的 `quick_*` 字段自动生成。
> 新增高频场景请在对应知识卡 frontmatter 补充 `quick_groups`/`quick_intents`/`quick_risk_lines`/`pitfalls`；组名必须取自受控词表（scripts/_lib/knowledge-cards.ts 的 QUICK_GROUPS），词表外组名落入「未归类」。

## 🎯 3D 预览与模型追加

| 用户意图 | 首选卡 | 红线警告 | 关联 ADR |
|----------|--------|----------|----------|
| 「草为什么是圆斑不像纤维」→ 各向异性坐标拉伸（grass.ts 的 ANISO_X） | [程序化地面贴图生成 surface-pixels](./ground-texture-gen.md) | 改生成器算法前确认 surfaceSpecKey 不含像素字段（否则触发无谓重建） | - |
| 「大理石没有脉络像团块」→ domain warping（marble.ts 的 sin(x + k·fbm)） | [程序化地面贴图生成 surface-pixels](./ground-texture-gen.md) | - | - |
| 「平铺后每隔约两米出现同一个明星特征」→ 无缝但有规律重复，用 anti-repeat.ts（macro/dual/stochastic 三选一或组合） | [程序化地面贴图生成 surface-pixels](./ground-texture-gen.md) | - | - |
| 2D 预览、骨骼图、Canvas 渲染 | [2D 预览渲染 model2d](./model2d.md) | 2D 骨骼渲染必须走 model2d.ts 的 Canvas 渲染，禁止手写骨骼画布 | - |
| 3D 菜单控件声明式渲染 | [场景能力注册表 scene-capability-registry](./scene-capability-registry.md) | - | ADR-132 |
| 3D 感知系统、自主动画、自动跳舞 | [3D 感知系统 perception](./perception.md) | 3D 感知必须走 perception 模块的控制器，禁止手写动画注入 | ADR-138 |
| 3D 骨骼 spec、three.js | [3D 骨骼 spec go/threejs](./go-threejs.md) | YSM 骨骼数据必须走 go/threejs 的 spec.go 转换为 three.js 格式，前端禁止手写骨骼转换 | - |
| 3D 截图 / 纹理预加载缓存 / 渲染性能调优 | [3D 预览渲染 model3d](./model3d.md) | - | ADR-129 |
| 3D 控制器、MMD 播放、VRM 材质 / YSM schema | [3D 预览控制器（声明式菜单节点）](./preview-controls.md) | 相机操作已归核心声明式根菜单，底部导航弹窗已删除；adapter 项必须经 setAdapterItems 注入核心根菜单，禁止内联 | ADR-127, ADR-132, ADR-253 |
| 3D 入口 / nav-fab / siblings 兜底 / entry 通道 | [3D 预览控制器（声明式菜单节点）](./preview-controls.md) | - | ADR-127, ADR-132, ADR-253 |
| 3D 渲染循环优化、Vector3 复用 | [3D 区审核与修复模式提炼](./3d-patterns.md) | 3D 资源释放必须走 dispose 链路，禁止依赖 GC | - |
| 3D 预览菜单、根菜单、dock 按钮 | [统一 3D 预览核心 preview-core](./preview-core.md) | 适配器项经 setAdapterItems 注入，禁止内联 | ADR-125 |
| 3D 预览面板跨 cap 设置项 | [3D 预览全域状态层（ADR-126 P4-A）](./preview-state.md) | 预览状态必须走 preview-state.ts 的 KNOWN_PATHS 注册，binding 只填已落地项，未落地键编译期报错 | - |
| 把 MMD 动作放到 VRM 模型上播放 | [VMD→VRM 动作重定向 vmd-retarget](./vmd-vrm-retarget.md) | 重建 track = 丢贝塞尔插值（卡点且不报错） | ADR-243, ADR-306, ADR-309 |
| 材质重建与原地更新的判别（needsRebuild） | [地面材质 spec 单一事实源 ground-surface-spec](./ground-surface-spec.md) | - | - |
| 参考网格显隐 / 关不掉自带网格（groundGridVisible） | [地面材质 spec 单一事实源 ground-surface-spec](./ground-surface-spec.md) | - | - |
| 拆 mount3D 巨函数 | [mount3D 巨函数拆分现状（2026-10-06 复核）](./mount3d-584-giant.md) | mount3D 本体仍超 100 行红线（已从巨函数收缩为薄壳装配器，量级降至约 1.3 倍）；继续往里加新逻辑需评审 | ADR-091 |
| 场景参数 / envState / 统一状态层 | [3D 预览统一状态层 envState（ADR-196）](./preview-env-state.md) | cap 参数必须存 envState，禁止各自 this.params 私有化（ADR-196） | ADR-196, ADR-293-d1 |
| 场景能力 / cap / registry | [场景能力注册表 scene-capability-registry](./scene-capability-registry.md) | 3D 能力必须走 scene-capability-registry 注册，禁止在 adapter 里直接创建场景对象 | ADR-132 |
| 程序化纹理生成 | [地面材质 spec 单一事实源 ground-surface-spec](./ground-surface-spec.md) | - | - |
| 纯函数 vs Node+WASM 解码分界 | [Go 头像提取：纯函数 vs Node+WASM 解码分界](./go-avatar-decode.md) | ADR-316 后 Node+WASM 解码桥已退役：.ysm 解码走 ysm.DecodeYSM 注入点（wazero），禁止新建 Node 子进程桥 | - |
| 地面材质/地面贴图/地板/surface（GroundMaterialSpec/specKey/textureToken） | [地面材质 spec 单一事实源 ground-surface-spec](./ground-surface-spec.md) | 地面材质必须走 ground-surface-spec 的 buildGroundSurfaceSpec，spec 是唯一数据源 | - |
| 顶点 / UV / 四元数 | [3D 骨骼 spec go/threejs](./go-threejs.md) | - | - |
| 动画分组、配置菜单、ysm.json | [YSM 动画分组与配置菜单提取](./format-ysm-anim-config.md) | YSM 动画分组与配置菜单必须经 extractAnimGroupsAndConfigs 从 ysm.json properties 提取 | - |
| 动画解析 / 求值 / 渲染注入 | [YSM (Bedrock) 动画管线](./ysm-anim-pipeline.md) | - | - |
| 多 3D 场景共存 | [联邦渲染能力 (Render Federation)](./render-federation.md) | - | ADR-125 |
| 多模型同框叠加（keepInScene=true） | [3D 预览渲染 model3d](./model3d.md) | 所有 3D 渲染内容必须经 mount3D 统一会话外壳，禁止独立维护 renderer/scene/camera | ADR-129 |
| 多模型选择、多组件 / 多 entry | [多模型选择菜单原语 multiModelSelectNode](./multi-model-select.md) | 容器内多模型必须经 multiModelSelectNode 声明式菜单选择，禁止 adapter 直接遍历 entry 数组渲染 | ADR-132 |
| 改体积光外观 / 加锥体参数 | [体积光锥 VolumetricCone（真锥体网格 + Fresnel）](./volumetric-cone.md) | 锥体几何/着色/状态机单点在 light-cone.ts（rebuild + VOLUMETRIC_CONE_FRAG），禁止外挂第二套光柱实现 | ADR-266, ADR-266-d1, ADR-177, ADR-246, ADR-290 |
| 骨骼错位 / 模型错位排查 | [YSM 烘焙与几何反推](./ysm-baked.md) | - | - |
| 骨骼动画、关键帧、动画播放 | [动画系统 animation](./animation-system.md) | 基岩 animation.json 解析后必须走 evaluateClip 插值，禁止前端手写关键帧插值逻辑 | - |
| 骨骼工具、骨骼树、骨骼列表 | [跨格式骨骼工具层 bone-tools](./bone-tools.md) | 骨骼树必须走 bone-tools 的 buildBoneTree，禁止在 adapter 里手写骨骼树构建 | ADR-109 |
| 骨骼拾取、骨骼显隐、BoneNode / BoneTree | [跨格式骨骼工具层 bone-tools](./bone-tools.md) | - | ADR-109 |
| 骨骼拾取与选中（pickBone / setBoneVisible） | [3D 预览渲染 model3d](./model3d.md) | dispose() 必须遍历子对象调用 geometry?.dispose() / material?.dispose() / texture?.dispose()，Object3D.remove() 不释放 WebGL 资源 | ADR-129 |
| 挂载/切换 3D 预览（mount3D / switchPreview） | [3D 预览渲染 model3d](./model3d.md) | 几何计算（顶点/UV/四元数）在 Go 端完成，前端不得私改几何口径 | ADR-129 |
| 烘焙数据反推原理理解 | [YSM 烘焙与几何反推](./ysm-baked.md) | - | - |
| 缓存清理、cache-clear | [纹理缓存 texture_cache](./texture-cache.md) | - | - |
| 缓存状态、cache-status / cache-verify | [纹理缓存 texture_cache](./texture-cache.md) | - | - |
| 加密模型、wasm 加载、Emscripten | [WASM 解析器 ysm-parser](./ysm-wasm.md) | - | - |
| 节拍检测、模型感知 | [3D 感知系统 perception](./perception.md) | - | ADR-138 |
| 截图/导出里没有光柱或亮度与预览不符 | [体积光锥 VolumetricCone（真锥体网格 + Fresnel）](./volumetric-cone.md) | 截图必须经 screenshot-cone.ts 的 applyVolumetricCone 复用同一锥体类，离屏 renderer 逐字段镜像预览 toneMapping 现值 | ADR-266, ADR-266-d1, ADR-177, ADR-246, ADR-290 |
| 截图按钮、相机控制、模型切换 | [3D 预览控制器（声明式菜单节点）](./preview-controls.md) | 3D 入口统一为左下角 nav-fab（ADR-253 D7）；详情卡内已无 3D 按钮，opener 必须转发 opts 否则 siblings/entry 被静默丢弃 | ADR-127, ADR-132, ADR-253 |
| 截图灯光、activeComponent、组件选择 | [预览面板设置与显示控制](./preview-settings.md) | - | ADR-132 |
| 两步走路径扩展 | [预览状态路径契约 preview-paths](./preview-paths.md) | - | ADR-297 |
| 模型切换、会话内替换 | [统一 3D 预览核心 preview-core](./preview-core.md) | switchTo 仅同类型；跨类型用 switchExternal | ADR-125 |
| 模型渲染 | [3D 骨骼 spec go/threejs](./go-threejs.md) | - | - |
| 排查光柱穿帮、过曝、开关不生效 | [体积光锥 VolumetricCone（真锥体网格 + Fresnel）](./volumetric-cone.md) | 重建触发面只有 CONE_GEO_CHANGES（type/enabled/angle/penumbra）；驱动源是 envState 键 lightVolumetricDriver，与 activeLight 彻底脱钩 | ADR-266, ADR-266-d1, ADR-177, ADR-246, ADR-290 |
| 排查设置项改了不生效 / 重开面板值不对 | [3D 预览设置面板统一状态层与自动 cap 聚合（ADR-125）](./preview-menu-settings-state.md) | - | - |
| 评审 ground-capability.ts 菜单构建 | [ground-cap 菜单节点工厂（ADR-195 刀2 cap 直产节点）](./ground-cap-materialgroup-factories.md) | 地面菜单必须经 ground-menu.ts 的 buildGroundNodes 直产 PreviewMenuNode[]，禁止手写控件结构 | - |
| 评审 mount-preview-core.ts | [mount3D 巨函数拆分现状（2026-10-06 复核）](./mount3d-584-giant.md) | - | ADR-091 |
| 前视图、骨骼热区、鼠标拾取、线框图 | [2D 预览渲染 model2d](./model2d.md) | - | - |
| 数字滚动、stagger 入场、关闭动画 | [动画系统 animation](./animation-system.md) | - | - |
| 水面/水池/water/波浪/wave | [水面能力 WaterCapability（Gerstner 波浪 + GPU 微细节法线）](./water.md) | 水面 shader 有 REVISION 断言与注入守卫（vertex 波浪函数 / objectNormal 覆盖 / 圆角段 / 微细节覆写点 / 倒影混合块）：升级 three 后必须重跑 water-capability.test.ts | ADR-255, ADR-257, ADR-271, ADR-272, ADR-283, ADR-297, ADR-319 |
| 水位与水膜（waterLevel / wetness） | [水面能力 WaterCapability（Gerstner 波浪 + GPU 微细节法线）](./water.md) | - | ADR-255, ADR-257, ADR-271, ADR-272, ADR-283, ADR-297, ADR-319 |
| 条件显隐控件不出现 | [3D 预览设置面板统一状态层与自动 cap 聚合（ADR-125）](./preview-menu-settings-state.md) | - | - |
| 通用红线 | [统一 3D 预览核心 preview-core](./preview-core.md) | 截图入口走 shotNodes 菜单闭包，禁止往 PreviewHandle 透传 screenshot（2026-09-04 死透传已删） | ADR-125 |
| 头像、作者、创作者 avatar | [头像 go/avatar](./go-avatar.md) | 头像提取必须走 go/avatar 的 ExtractAvatarURI，前端禁止手写头像路径拼接 | - |
| 头像缓存、缩略图 | [头像 go/avatar](./go-avatar.md) | - | - |
| 头像提取、ysm.DecodeYSM、ExtractAvatarURI | [Go 头像提取：纯函数 vs Node+WASM 解码分界](./go-avatar-decode.md) | 头像提取路径必须按扩展名分发（.ysm → WASM 解码 / .zip/.7z → 归档解压 / .json → 直读），禁止跨扩展名混用 | - |
| 投影、litematic、schematic、nbt、蓝图 | [Litematic 解析 go/litematic](./go-litematic.md) | Litematic 蓝图必须走 go/litematic 的 parser/schematic/structure 三层解析，禁止前端手写 Litematic 解析 | - |
| 腿链提取、链根取谁 | [CCD IK 求解器 ik-solver / 足部锚地 mmd-foot-ik](./ik-solver.md) | - | - |
| 为什么 VMD 表情帧在 VRM 上脸不动 | [VMD→VRM 动作重定向 vmd-retarget](./vmd-vrm-retarget.md) | 表情载体 weight 未初始化 = mixer 静默不写（不报错） | ADR-243, ADR-306, ADR-309 |
| 为什么 VMD 动作在 VRM 上腿部不动 | [VMD→VRM 动作重定向 vmd-retarget](./vmd-vrm-retarget.md) | 幽灵网格 morphTargetDictionary 留 undefined = 必抛 TypeError | ADR-243, ADR-306, ADR-309 |
| 为什么模型声明了光照偏好却不生效 | [gui_light 语义与「死解析立牌」（pack 模型光照元数据）](./pack-gui-light.md) | - | - |
| 纹理缓存、AbortController 事件管理 | [3D 区审核与修复模式提炼](./3d-patterns.md) | - | - |
| 纹理缓存、KTX2 缓存 | [纹理缓存 texture_cache](./texture-cache.md) | 缓存键 = 内容哈希（TextureHash），改哈希口径旧缓存全体失联；TTL 与容量裁剪（Prune）在写入路径触发，改淘汰策略须同步 prune 测试矩阵 | - |
| 详情卡 3D 入口、nav-fab、card-shell 统一壳 | [预览面板 app-preview](./app-preview.md) | - | ADR-137, ADR-138, ADR-253 |
| 想按模型声明打光怎么做 | [gui_light 语义与「死解析立牌」（pack 模型光照元数据）](./pack-gui-light.md) | - | - |
| 新增 3D 能力（雾/阴影/反射/环境/灯光/后处理） | [场景能力注册表 scene-capability-registry](./scene-capability-registry.md) | - | ADR-132 |
| 新增 3D 预览面板内容（统计 / 纹理 / 按钮组 / 信息卡） | [3D 预览面板内容声明式化通道（ADR-126 P4-B）](./preview-panel-declarative.md) | 3D 预览面板内容必须走声明式菜单节点（children / renderCustom），禁止在 adapter 里手写 DOM | - |
| 新增 3D 预览设置项、新增 cap 让开关出现在设置面板 | [3D 预览设置面板统一状态层与自动 cap 聚合（ADR-125）](./preview-menu-settings-state.md) | 3D 预览设置必须走 preview-state 的 KNOWN_PATHS 注册 + 自动 cap 聚合，禁止横切设置项各自有独立读写通道 | - |
| 新增 cap 参数 / env-state-schema 字段 | [3D 预览统一状态层 envState（ADR-196）](./preview-env-state.md) | - | ADR-196, ADR-293-d1 |
| 新增 KNOWN_PATHS 路径 | [3D 预览全域状态层（ADR-126 P4-A）](./preview-state.md) | - | - |
| 新增水体形态 | [水面能力 WaterCapability（Gerstner 波浪 + GPU 微细节法线）](./water.md) | - | ADR-255, ADR-257, ADR-271, ADR-272, ADR-283, ADR-297, ADR-319 |
| 新增一个 MMD 骨名/表情映射 | [VMD→VRM 动作重定向 vmd-retarget](./vmd-vrm-retarget.md) | - | ADR-243, ADR-306, ADR-309 |
| 渲染联邦、shared renderer、rAF 复用 | [联邦渲染能力 (Render Federation)](./render-federation.md) | 多 3D 场景必须走 render-federation 的 shared renderer / rAF，禁止各自创建 renderer | ADR-125 |
| 预览面板、模型预览、2D 骨骼 / 3D 预览 | [预览面板 app-preview](./app-preview.md) | 预览面板必须经 model:select 事件驱动，WASM 能力判定由 matchTypeByExt 注册表驱动，禁止内联正则 | ADR-137, ADR-138, ADR-253 |
| 预览面板状态改了不生效 / 重开面板值不对 | [3D 预览全域状态层（ADR-126 P4-A）](./preview-state.md) | - | - |
| 预览设置、显示控制、骨骼名称开关 | [预览面板设置与显示控制](./preview-settings.md) | 预览设置集中由 preview-state.ts 的 KNOWN_PATHS 注册管理，新增选项必须经注册而非直接读写状态 | ADR-132 |
| 眨眼/呼吸/视线追踪/口型同步 | [3D 感知系统 perception](./perception.md) | - | ADR-138 |
| 帧率 / 像素比 / 视锥剔除 / 3D 偏好 | [预览面板设置与显示控制](./preview-settings.md) | - | ADR-132 |
| 追加模型、同台加载、多模型同框 | [统一 3D 预览核心 preview-core](./preview-core.md) | 跨类型必须走 switchExternal，禁止直接调 adapter.build | ADR-125 |
| 资源生命周期 dispose、循环依赖破壁 | [3D 区审核与修复模式提炼](./3d-patterns.md) | - | - |
| 自定义图片上传到地面 | [地面材质 spec 单一事实源 ground-surface-spec](./ground-surface-spec.md) | - | - |
| 自由相机漫游（WASD + 空格/Shift 升降） | [3D 预览渲染 model3d](./model3d.md) | 100MB 阈值是网页版唯一防线，低端设备（4GB RAM）峰值内存可能触顶 OOM | ADR-129 |
| ADR-125 三块落地状态核对 | [3D 预览设置面板统一状态层与自动 cap 聚合（ADR-125）](./preview-menu-settings-state.md) | - | - |
| ADR-195 cap 直产节点 | [ground-cap 菜单节点工厂（ADR-195 刀2 cap 直产节点）](./ground-cap-materialgroup-factories.md) | - | - |
| AnimationController、状态机 | [动画系统 animation](./animation-system.md) | - | - |
| app-preview 组件、_previewGuard、detailGen | [预览面板 app-preview](./app-preview.md) | - | ADR-137, ADR-138, ADR-253 |
| buildBoneTree / makeBonePanelRenderer | [跨格式骨骼工具层 bone-tools](./bone-tools.md) | - | ADR-109 |
| cap 参数存哪 / 怎么改不生效 | [3D 预览统一状态层 envState（ADR-196）](./preview-env-state.md) | - | ADR-196, ADR-293-d1 |
| createAll / loadAll / setPreset / saveAll / dispose | [场景能力注册表 scene-capability-registry](./scene-capability-registry.md) | - | ADR-132 |
| extra_animation、summarize | [YSM 动画分组与配置菜单提取](./format-ysm-anim-config.md) | - | - |
| foot IK、极向量 / pole、CCD | [CCD IK 求解器 ik-solver / 足部锚地 mmd-foot-ik](./ik-solver.md) | 腿链链根取大腿的「直接父骨」；改成大腿自身 = 只有膝盖能动 | - |
| ground 材质菜单节点 | [ground-cap 菜单节点工厂（ADR-195 刀2 cap 直产节点）](./ground-cap-materialgroup-factories.md) | - | - |
| gui_light 是什么意思 | [gui_light 语义与「死解析立牌」（pack 模型光照元数据）](./pack-gui-light.md) | 别把 gui_light 接进 LightCapability（三理由：ADR-282 / source 优先级 / 跨类型不一致） | - |
| IK 求解、骨骼 IK、足部锚地 | [CCD IK 求解器 ik-solver / 足部锚地 mmd-foot-ik](./ik-solver.md) | IK 求解必须走 ik-solver 的 CCD 求解器 + mmd-foot-ik 的足部锚地，禁止手写 IK 逻辑 | - |
| isSafeAvatarPath | [头像 go/avatar](./go-avatar.md) | - | - |
| KNOWN_PATHS 状态路径 | [预览状态路径契约 preview-paths](./preview-paths.md) | - | ADR-297 |
| Litematic / 蓝图、资源包 / 光影包（showResourcePack / showShaderpack） | [预览面板 app-preview](./app-preview.md) | - | ADR-137, ADR-138, ADR-253 |
| MEMFS / node 解码 / callMain | [WASM 解析器 ysm-parser](./ysm-wasm.md) | - | - |
| model:select、WASM 解码、放大预览 | [预览面板 app-preview](./app-preview.md) | - | ADR-137, ADR-138, ADR-253 |
| Molang 表达式求值 | [动画系统 animation](./animation-system.md) | - | - |
| mountPreviewRootMenu 挂载 | [3D 预览声明式菜单 preview-menu](./preview-menu.md) | - | ADR-132, ADR-195, ADR-276, ADR-305 |
| multiModelSelectNode | [多模型选择菜单原语 multiModelSelectNode](./multi-model-select.md) | - | ADR-132 |
| multiModelSelectNode / preview menu node | [3D 预览控制器（声明式菜单节点）](./preview-controls.md) | - | ADR-127, ADR-132, ADR-253 |
| P4 子步（A→B→D→C）状态通道复用 | [3D 预览全域状态层（ADR-126 P4-A）](./preview-state.md) | - | - |
| P4-B 子步（1→2→3）状态通道复用 | [3D 预览面板内容声明式化通道（ADR-126 P4-B）](./preview-panel-declarative.md) | - | - |
| palette / voxel / bedrock 转换 | [Litematic 解析 go/litematic](./go-litematic.md) | - | - |
| PreviewMenuNode 声明式菜单 | [3D 预览声明式菜单 preview-menu](./preview-menu.md) | - | ADR-132, ADR-195, ADR-276, ADR-305 |
| PreviewSnapshot 快照类型 | [预览状态路径契约 preview-paths](./preview-paths.md) | - | ADR-297 |
| PreviewStatePath 类型契约 | [预览状态路径契约 preview-paths](./preview-paths.md) | - | ADR-297 |
| renderCustom vs children 声明式 | [3D 预览面板内容声明式化通道（ADR-126 P4-B）](./preview-panel-declarative.md) | - | - |
| renderMenu 单一渲染器 | [3D 预览声明式菜单 preview-menu](./preview-menu.md) | - | ADR-132, ADR-195, ADR-276, ADR-305 |
| schema 键冲突、ADR-132 | [preview-menu-session-key](./preview-menu-session-key.md) | - | ADR-132 |
| schema 注册、per-scene、多模型同框 | [preview-menu-session-key](./preview-menu-session-key.md) | schema 注册必须用 per-scene 键，禁止跨场景共用 schema key | ADR-132 |
| schema-registry 面板注册 | [3D 预览声明式菜单 preview-menu](./preview-menu.md) | - | ADR-132, ADR-195, ADR-276, ADR-305 |
| UV 对不上 / 贴图错位定位 | [YSM 烘焙与几何反推](./ysm-baked.md) | - | - |
| visibleWhen 谓词 | [3D 预览声明式菜单 preview-menu](./preview-menu.md) | - | ADR-132, ADR-195, ADR-276, ADR-305 |
| VRM 动画播放、VRMA | [统一 3D 预览核心 preview-core](./preview-core.md) | 必须 mixer.update(dt) → vrm.update(dt)，禁止手动 vrm.humanoid.update() | ADR-125 |
| WASI 解码、wazero、node 退役 | [WASI 解码器（wazero 内存直解，node 桥已退役）](./ysm-wasi.md) | 解析器改动（collectToMemory）在本仓 vendored 副本内，上游同步时需重放 | - |
| WASM 解析器、YSMParser、ysm 解码 | [WASM 解析器 ysm-parser](./ysm-wasm.md) | YSM 前端解码必须走 ysm-wasm 的 WASM 解析器，禁止手写 YSM 字节流解析 | - |
| WASM 解析器版本更新 | [YSM 烘焙与几何反推](./ysm-baked.md) | - | - |
| YSM 动画管线、基岩动画 | [YSM (Bedrock) 动画管线](./ysm-anim-pipeline.md) | YSM 动画必须走 ysm-anim-pipeline 的解析-求值-注入三段，禁止前端手写动画解析 | - |
| ysm-animation-player、molang | [YSM (Bedrock) 动画管线](./ysm-anim-pipeline.md) | - | - |
| zip 多模型、多候选、蓝图 zip、litematic zip | [多模型选择菜单原语 multiModelSelectNode](./multi-model-select.md) | - | ADR-132 |

## 🎯 UI 交互与弹窗

| 用户意图 | 首选卡 | 红线警告 | 关联 ADR |
|----------|--------|----------|----------|
| 按标签筛选、条件过滤 | [高级筛选 adv-filter](./dialog-adv-filter.md) | - | - |
| 菜单行为执行、ctx:show | [右键菜单系统](./context-menu.md) | 禁止 view 层手写菜单项 | - |
| 残留扫描 | [emoji/UI_ICONS 摸排方法论](./survey-emoji-icons.md) | - | - |
| 撤销、消息、toast-ms | [Toast 通知 app-toast](./app-toast.md) | - | - |
| 打标签、编辑标签、tag-editor | [标签编辑器 tag-editor](./dialog-tag-editor.md) | tag-editor 弹窗必须复用 modal.ts 的 Promise API，标签写回走 go/tags Store 的原子替换 | - |
| 弹确认框 / 输入框 / 下拉选择 / modal | [弹窗基座 modal（6 文件家族）](./dialog-modal.md) | 业务弹窗必须复用 modal 家族的 Promise API（prompt/select/confirm/picker），禁止手写弹窗 | - |
| 读取 YSM 头部（作者 / 介绍） | [重命名弹窗 rename](./dialog-rename.md) | - | - |
| 分类标记、全库标签建议 | [标签编辑器 tag-editor](./dialog-tag-editor.md) | - | - |
| 富列表选择（picker，支持自定义 footer 表单） | [弹窗基座 modal（6 文件家族）](./dialog-modal.md) | - | - |
| 高级筛选、骨骼数 / 立方体 / 纹理尺寸数值范围 | [高级筛选 adv-filter](./dialog-adv-filter.md) | adv-filter 弹窗必须复用 modal.ts 的 Promise API，禁止手写弹窗 DOM | - |
| 滑块控制器、幻灯片菜单外壳、头部开关 | [UI 组件簇（原 ui 收容所，已归位）](./ui-components.md) | - | - |
| 进度弹窗（closable=false 防误关） | [弹窗基座 modal（6 文件家族）](./dialog-modal.md) | - | - |
| 两级菜单、轻量导航栈、createSlideMenu | [ADR 去桶化 slide-menu 外壳组件](./ui-slide-menu.md) | - | - |
| 摸排 | [emoji/UI_ICONS 摸排方法论](./survey-emoji-icons.md) | - | - |
| 批量重命名、查找替换、正则替换 | [批量重命名 batch-rename](./dialog-batch-rename.md) | batch-rename 弹窗单例槽位经 registerDlg 保证（状态在 DgBrShell 实例），重复打开先 close() 结算上一个 Promise | - |
| 批量重命名实现 / 标签编辑器定位 / 高级筛选弹窗 | [业务对话框 features/dialogs(批量重命名/标签编辑/高级筛选)](./features-dialogs.md) | features/dialogs 是业务 UI,勿被调回 utils/dom(分类事故复发) | - |
| 通用红线 | [业务对话框 features/dialogs(批量重命名/标签编辑/高级筛选)](./features-dialogs.md) | dialogs 各文件内部引用深度以 features/dialogs 为基准,vi.mock 路径须同步 | - |
| 通用红线 | [业务对话框 features/dialogs(批量重命名/标签编辑/高级筛选)](./features-dialogs.md) | modal-core.ts VIEW_TESTIDS 增删 data-testid 须同步本数组(ADR-133 阶段 B 契约测试静态聚合) | - |
| 通用红线 | [业务对话框 features/dialogs(批量重命名/标签编辑/高级筛选)](./features-dialogs.md) | rename.ts 路径变更时需同步 vi.mock 字符串路径(ADR-170 实测教训:非 import 语句正则扫不到) | - |
| 通用红线 | [业务对话框 features/dialogs(批量重命名/标签编辑/高级筛选)](./features-dialogs.md) | 批量重命名 DOM 模板（含 stagger 动画）在 views/app-tree/tpl-batch-rename.ts（ADR-208 D2 外移），features 经 BatchRenameTpl 注入；改模板走 views 侧，改接线走 features/dialogs | - |
| 通用红线 | [业务对话框 features/dialogs(批量重命名/标签编辑/高级筛选)](./features-dialogs.md) | rename / adv-filter / tag-editor 内嵌 HTML 字面量已入 check-layering R8 防回退基线（ADR-190 D1a / ADR-208 D2「HTML 模板归 views」执法闸，2026-09-20）；触碰这三文件即顺手收敛（tpl 注入照 BatchRenameTpl 先例，或 DOM API 构建 + outerHTML 字符串契约），新增 HTML 字面量门禁直接红 | - |
| 通用红线 | [业务对话框 features/dialogs(批量重命名/标签编辑/高级筛选)](./features-dialogs.md) | adv-filter.ts 后端约束:Go SearchModels 仅支持 6 范围 +1 关键字,前端不呈现其他控件(代码注释已注明) | - |
| 统一作者 / 作品、5 个内置预设 | [批量重命名 batch-rename](./dialog-batch-rename.md) | - | - |
| 图标迁移 | [emoji/UI_ICONS 摸排方法论](./survey-emoji-icons.md) | - | - |
| 消息弹窗图标 | [toast-emoji-svg](./adr.md) | - | - |
| 右键菜单、添加菜单项 | [右键菜单系统](./context-menu.md) | 菜单结构声明在 menu-defs.ts（唯一事实来源），行为在 features/context-menu/context-menu-handlers.ts（HANDLERS 表） | - |
| 执行破坏性操作前的二次确认（danger 模式） | [弹窗基座 modal（6 文件家族）](./dialog-modal.md) | 破坏性操作（删除/清空/覆盖）必须用 modalConfirm，danger=true 标红按钮 | - |
| 重命名、改名、命名规范 | [重命名弹窗 rename](./dialog-rename.md) | rename 弹窗必须复用 modal.ts 的 Promise API，非法字符与长度校验在弹窗内完成 | - |
| createSlideMenu / withLoadingIndicator / DragSliderController | [UI 组件簇（原 ui 收容所，已归位）](./ui-components.md) | - | - |
| emoji | [emoji/UI_ICONS 摸排方法论](./survey-emoji-icons.md) | 别再几十次零散 grep emoji —— 一封 `node scripts/_lib/survey-emoji-icons.ts` 出全貌 | - |
| FAB、悬浮按钮、3D 预览 | [3D 预览悬浮 FAB 控制层](./dom-fab.md) | FAB 控制层必须走 preview-3d/menu/shell/fab.ts 的 ensureFabStyles 注入，禁止各组件各自注入 style 标签 | - |
| modalAdvFilter | [高级筛选 adv-filter](./dialog-adv-filter.md) | - | - |
| modalTagEditor | [标签编辑器 tag-editor](./dialog-tag-editor.md) | - | - |
| overlay、ADR-057、ensureFabStyles | [3D 预览悬浮 FAB 控制层](./dom-fab.md) | - | - |
| rename-format、showRenameDialog | [重命名弹窗 rename](./dialog-rename.md) | - | - |
| showBatchRenameDialog | [批量重命名 batch-rename](./dialog-batch-rename.md) | - | - |
| slide-menu、slide 菜单、去桶化 | [ADR 去桶化 slide-menu 外壳组件](./ui-slide-menu.md) | slide-menu 外壳必须复用 slide-menu 的轻量导航栈，禁止手写导航栈 | - |
| title 气泡、3D 按钮 | [悬浮提示 tooltip](./dom-tooltip.md) | - | - |
| Toast 通知、提示、反馈、报错提示 | [Toast 通知 app-toast](./app-toast.md) | Toast 必须复用 utils/dom/toast-ms.ts 的毫秒级反馈，禁止手写浮层 | - |
| toast emoji | [toast-emoji-svg](./adr.md) | toast 图标位只喂 resolveIcon 的语义 SVG，msg 载荷禁拼裸 emoji 前缀（esc 文本槽塞 SVG 会字面显示，ADR-267 盲区） | - |
| tooltip、悬浮提示、hover 提示 | [悬浮提示 tooltip](./dom-tooltip.md) | 悬浮提示必须走 dom/tooltip.ts 的毛玻璃 tooltip，禁止用原生 title | - |
| UI 组件、卡片组件、加载遮罩 | [UI 组件簇（原 ui 收容所，已归位）](./ui-components.md) | UI 组件必须复用既有 helper 函数，禁止手写重复 DOM 结构 | - |
| UI_ICONS | [emoji/UI_ICONS 摸排方法论](./survey-emoji-icons.md) | - | - |

## 🎯 跨组件通信与页面

| 用户意图 | 首选卡 | 红线警告 | 关联 ADR |
|----------|--------|----------|----------|
| 报错落日记、error toast 落盘、运行时日志环 | [UI 报错落日记 error-diary](./core-error-diary.md) | error/warn toast、未捕获异常、未处理拒绝、logWarn/logError 四路都经 error-diary 落日记（注入式 DiarySink，不直连 backend） | - |
| 侧边栏、整合包列表、版本卡片 | [侧边栏 app-sidebar](./app-sidebar.md) | 侧边栏的 push/pull 必须经 events.ts 的 runPush/runPull 转发到 sync-manager，禁止直接调 API | - |
| 创意工坊、站点 / 创作者频道 | [创意工坊站点视图 site](./app-content-site.md) | 浏览 / 编辑模式切换必须经 workshop-browse-mode 统一切换，禁止视图层各自判断 | - |
| 纯函数 | [核心工具函数 core-utils](./core-utils.md) | - | - |
| 错误提示、友好错误、friendlyError | [错误处理 errors](./utils-errors.md) | 所有异常路径必须经 friendlyError 转中文提示，禁止裸抛原始错误到 UI | - |
| 错误消息提取、Worker 错误、catch | [安全错误消息提取 utils](./safe-error-msg.md) | Web Worker 内错误提取必须用 safeErrorMessage，禁止 import i18n 依赖 | - |
| 导航栏、切页、nav:changed | [顶部导航 app-nav](./app-nav.md) | nav:changed 事件必须仅由 app-nav 派发，其他页面禁止自派 nav:changed（跨页跳转应派 nav:changed 借道） | - |
| 调试缺失 key / 清理 console.warn 裸 key | [国际化 i18n 模块](./i18n.md) | LocaleHost 未注入 → loadLocale 告警一次跳过（fail-open），装配层漏 setLocaleHost 不挂启动链 | ADR-124, ADR-207, ADR-210 |
| 调试日志、dbg、调试开关 | [常量与调试 constants/debug](./utils-misc.md) | 调试日志必须走 debug.ts 的 dbg 工具，禁止 console.log 散落在业务代码 | - |
| 订阅 / 退订事件 / once | [事件总线 bus.ts](./event-bus.md) | once 只能用它返回的退订函数取消（off 原 fn 匹配不到 wrapper） | - |
| 动画开关、字号、界面偏好 | [主题系统 theme](./theme.md) | - | ADR-146 |
| 更新检查、升级、新版本 | [版本更新 version-updater](./version-updater.md) | 版本更新必须经 version-updater 的 canCheck/markChecked 节流，禁止高频轮询 GitHub API | - |
| 工具函数、防抖、异步工具 | [核心工具函数 core-utils](./core-utils.md) | swallowError 只用于"吞掉已知安全错误"，禁止用于掩盖业务异常；fire-and-forget 场景必须经 swallowError 兜底 | - |
| 共享样式、btn-base、focus-visible | [共享样式 shared-styles](./shared-styles.md) | 按钮样式必须走 btnBaseCSS 统一体系，禁止手写按钮 CSS | - |
| 环形日志、debugGetSpec、全局常量 | [常量与调试 constants/debug](./utils-misc.md) | - | - |
| 加翻译 / 多语言 / i18n | [国际化 i18n 模块](./i18n.md) | t() 严格 LocaleKey / tOf string 双入口查表；缺失键多级回退 current → FALLBACK_LANG(en) → 裸 key，getBundle 空包内部 rescue 至 BASE_LANG(zh-CN)；initI18n 启动预载三包（current + FALLBACK + BASE）使回退链各层冷启动可达；语言切换广播 lang:changed 驱动全库重渲染 | ADR-124, ADR-207, ADR-210 |
| 节点选择、多选、右键菜单 | [资源树 app-tree](./app-tree.md) | TreeRow.key / data-fullpath / selectState.keys 三处键空间必须同源（统一经 entryKey），file 行取磁盘路径（ADR-222） | - |
| 静默检查、canCheck、markChecked | [版本更新 version-updater](./version-updater.md) | - | - |
| 卡片拖拽、站点卡片渲染 | [创意工坊站点视图 site](./app-content-site.md) | - | - |
| 列表 reorder | [数组工具 moveItem](./utils-array.md) | - | - |
| 浏览模式、编辑模式切换 | [创意工坊站点视图 site](./app-content-site.md) | - | - |
| 启动器检测 | [侧边栏 app-sidebar](./app-sidebar.md) | - | - |
| 迁移/重命名翻译 key（三段式规范 + 同步改调用点） | [国际化 i18n 模块](./i18n.md) | 键名迁移无兼容表，改名须同步改调用点 + 测试 + 三语言包 | ADR-124, ADR-207, ADR-210 |
| 全局事件、拖拽导入、拖拽提示 | [全局事件处理 global-handlers](./global-handlers.md) | 全局事件必须经 global-handlers 单点注册，禁止各页面各自 bindGlobalHandler | - |
| 日期格式化、友好日期、文件大小颜色 | [格式化工具 fmt](./utils-fmt.md) | - | - |
| 数组排序、拖拽排序、moveItem | [数组工具 moveItem](./utils-array.md) | 数组移动必须走 array.ts 的 moveItem，禁止手写 splice 排序 | - |
| 通用红线 | [国际化 i18n 模块](./i18n.md) | warnMissingKey 每 key 只告警一次（模块内私有 Set，不跨模块导出） | ADR-124, ADR-207, ADR-210 |
| 同步缺失、清空整合包、导出清单 | [全局事件处理 global-handlers](./global-handlers.md) | - | - |
| 图标、emoji、文件图标、fileIcon | [图标映射 icon](./utils-icon.md) | 文件图标必须走 icon.ts 的 fileIcon，禁止手写文件名→图标映射 | - |
| 推送 / 拉取、同步状态、勾选 | [侧边栏 app-sidebar](./app-sidebar.md) | - | - |
| 外部进程启动、跨平台 HideWindow | [进程隐藏窗口 go/executil](./go-executil.md) | - | - |
| 文件大小、字节格式化、KB MB | [格式化工具 fmt](./utils-fmt.md) | 文件大小 / 日期必须走 format.ts 的格式化函数，禁止手写格式化 | - |
| 文件名显示、美化文件名、renderDisplayName | [文件名显示 display](./utils-display.md) | 文件名展示必须走 display.ts 的 renderDisplayName，禁止手写文件名解析 | - |
| 新增翻译 key → 三语言同步 + i18n-check 完整性校验 | [国际化 i18n 模块](./i18n.md) | 参数值含 $&/$1 走函数型替换（防正则注入错译） | ADR-124, ADR-207, ADR-210 |
| 新组件注册、import 组件、startup reveal | [组件入口 app-modules](./app-modules.md) | - | - |
| 循环依赖、NewApp 组装 | [App↔子组件对象级环打破范式（回调注入）](./app-cycle-injection.md) | - | ADR-109 |
| 页面初始化流程、订阅桶 / 会话状态 | [主内容页 app-content](./app-content.md) | - | - |
| 页面记忆、版本号、折叠展开 | [顶部导航 app-nav](./app-nav.md) | - | - |
| 页面名合法性守卫 isValidPage | [页面状态管理 page-store.ts](./page-store.md) | page-store 只提供纯函数（isValidPage / resolveInitialPage），不持有状态、不镜像；页面挂载 / 卸载是 app-content 的职责 | - |
| 页面状态管理、page store | [页面状态管理 page-store.ts](./page-store.md) | - | - |
| 一键安装、整合包拖拽导入 | [侧边栏 app-sidebar](./app-sidebar.md) | - | - |
| 语言切换 / 检测系统语言 / 持久化 uiLang | [国际化 i18n 模块](./i18n.md) | 并发 setLang 靠 _langReqGen 代际计数防竞态 | ADR-124, ADR-207, ADR-210 |
| 整合包列表、同步状态、勾选 | [整合包同步管理器 sync-manager](./sync-manager.md) | 状态筛选的 a11y 键盘语义只走 events.ts 单一 keydown 委托 + tpl.ts 模板出属性，禁止逐 tab 补 handler / 手搓 aria | - |
| 整合包同步、推送 / 拉取 | [整合包同步管理器 sync-manager](./sync-manager.md) | 同步操作必须经 sync-manager 的 queue 排队，禁止 app-sidebar 直接调 PushSingleResource | - |
| 主内容区、页面切换、仓库页 / 创作者页 / 社区页 | [主内容页 app-content](./app-content.md) | 主内容区页面切换必须经 nav:changed / app-nav 路由分发，禁止页面之间直接 init 对方 | - |
| 主题、换肤、深色 / 浅色 / 跟随系统 | [主题系统 theme](./theme.md) | 主题值必须经 normalizeTheme 白名单过滤，白名单外回落 system，防脏值污染持久层 | ADR-146 |
| 主题初始化、服务注册、检查更新 | [组件入口 app-modules](./app-modules.md) | - | - |
| 资源树、tree、目录树 | [资源树 app-tree](./app-tree.md) | app-tree 的 bus 订阅必须经 _unsubs 收集，disconnectedCallback 必须清理全部订阅 | - |
| 子进程隐藏控制台窗口、HideWindow | [进程隐藏窗口 go/executil](./go-executil.md) | 子进程隐藏控制台窗口必须走 go/executil 的 HideWindow，禁止直调 os/exec 不带隐藏标志 | - |
| 组件入口、模块装配、启动流程 | [组件入口 app-modules](./app-modules.md) | 新增 JS 组件必须登记进 app-modules.ts 的 import 列表，致命陷阱 | - |
| 作者标签、作品标签、文件名着色、搜索高亮 | [文件名显示 display](./utils-display.md) | - | - |
| App↔子组件对象级环、回调注入 | [App↔子组件对象级环打破范式（回调注入）](./app-cycle-injection.md) | 子组件必须用回调注入替代 *App 反向指针，禁止在子组件 struct 里持 *App 字段 | ADR-109 |
| DOM 工具、esc 转义、搜索高亮、XSS | [DOM 工具 dom](./utils-dom.md) | HTML 内容注入必须走 esc() 转义，禁止直接 innerHTML 拼接用户输入 | - |
| emit 事件 / 跨组件通信 | [事件总线 bus.ts](./event-bus.md) | 所有跨组件异步通信必经 bus.ts，禁止组件间直耦 | - |
| error-diary / registerErrorDiary / DiarySink | [UI 报错落日记 error-diary](./core-error-diary.md) | - | - |
| input-and-animation | [Pointer Events 统一交互（触屏 + 桌面）](./pointer-events.md) | - | - |
| isFileExistsError | [错误处理 errors](./utils-errors.md) | - | - |
| localStorage、隐私模式、safeGet / safeSet | [localStorage 安全读写 safeGet/safeSet](./dom-storage.md) | localStorage 读写必须走 safeGet/safeSet，禁止裸调 localStorage，防隐私模式中断启动 | - |
| logWarn logError 透写日记 | [UI 报错落日记 error-diary](./core-error-diary.md) | - | - |
| MC 格式、§ 颜色、MC 颜色码 | [MC 格式判定 mc-format](./utils-mc-format.md) | MC 文本格式化必须走 mc-format.ts 的 renderFormattedText，禁止手写 § 颜色解析 | - |
| nav_page 恢复 | [顶部导航 app-nav](./app-nav.md) | - | - |
| nav:changed 事件分发、全局 handler 注册 | [主内容页 app-content](./app-content.md) | - | - |
| node 环境、happy-dom、测试切换 | [Vitest 环境切换规则](./vitest-env-switch.md) | - | - |
| normalizeTheme、variables.css | [主题系统 theme](./theme.md) | - | ADR-146 |
| pack_format、MC 版本、资源包版本 | [MC 格式判定 mc-format](./utils-mc-format.md) | - | - |
| pointerdown / pointermove / pointerup、触屏 + 桌面统一 | [Pointer Events 统一交互（触屏 + 桌面）](./pointer-events.md) | 所有交互必须用 pointerdown/pointermove/pointerup 统一处理，禁止混用 mousedown/touchstart | - |
| PushSingleResource / PullSingleResource | [整合包同步管理器 sync-manager](./sync-manager.md) | - | - |
| registerGlobalHandlers、instance-ops | [全局事件处理 global-handlers](./global-handlers.md) | - | - |
| renderFormattedText / describeVersionRange | [MC 格式判定 mc-format](./utils-mc-format.md) | - | - |
| resolveInitialPage / sanitizePage 启动初始页解析 | [页面状态管理 page-store.ts](./page-store.md) | - | - |
| safeErrorMessage、异常提取 | [安全错误消息提取 utils](./safe-error-msg.md) | - | - |
| setPointerCapture、touch-action、拖拽 | [Pointer Events 统一交互（触屏 + 桌面）](./pointer-events.md) | - | - |
| swallowError（fire-and-forget 错误兜底） | [核心工具函数 core-utils](./core-utils.md) | - | - |
| sync:download:missing 缺包回拉 | [整合包同步管理器 sync-manager](./sync-manager.md) | - | - |
| toast 文案、报错翻译、网络错误 | [错误处理 errors](./utils-errors.md) | - | - |
| toast-ms / focus-restore | [DOM 工具 dom](./utils-dom.md) | - | - |
| tree 样式、Shadow DOM 样式、CSS 变量 | [共享样式 shared-styles](./shared-styles.md) | - | - |
| tree:set-search、bus-handlers、selectState | [资源树 app-tree](./app-tree.md) | - | - |
| updater | [版本更新 version-updater](./version-updater.md) | - | - |
| Vitest 环境切换、测试环境 | [Vitest 环境切换规则](./vitest-env-switch.md) | 只有纯逻辑测试（不碰 DOM）才能切 @vitest-environment node，源码顶层副作用必须先治理 | - |
| workshop-data / workshop-browse-mode | [创意工坊站点视图 site](./app-content-site.md) | - | - |

## 🎯 模型扫描与仓库管理

| 用户意图 | 首选卡 | 红线警告 | 关联 ADR |
|----------|--------|----------|----------|
| 仓库审计、健康分 | [扫描核心 go/scanner](./go-scanner.md) | - | - |
| 冲突处理 conflict.go | [整合包同步 go/sync](./go-sync.md) | - | ADR-064 |
| 待推送 / 可拉取 / 已禁用 / 实例资源 | [整合包同步页 app-sync-manager](./app-sync-manager.md) | - | - |
| 多线程统计角标、网页版导入 | [工具栏搜索编排 toolbar-search](./toolbar-search.md) | - | - |
| 关键词搜索、数值范围搜索 | [CLI 搜索命令 search](./go-cli-search.md) | - | - |
| 降级提示、consumeWebSearchDegraded | [工具栏搜索编排 toolbar-search](./toolbar-search.md) | - | - |
| 每日推荐、月度活动、热力图、仓库健康 | [资历最深模型 oldest-models](./oldest-models.md) | - | - |
| 模型解析、zip / 7z / 纹理 / 动画 | [Geometry 存档 go/geometry](./go-geometry.md) | - | ADR-068 |
| 模型统计、骨骼数/立方体数/纹理尺寸 | [Web Worker 模型统计层 model-stats](./model-stats.md) | 模型统计必须走 Web Worker 批量统计层，主线程禁止同步跑统计，防 UI 卡顿 | ADR-218, ADR-219 |
| 去重、重复检测、dedup | [去重 go/dedup](./go-dedup.md) | 去重必须走 go/dedup，禁止在业务代码里手写文件指纹比较 | - |
| 日志查看、性能分析 | [诊断页 diagnostics](./app-content-diagnostics.md) | - | - |
| 容器解析、container_entries | [统一容器桥接层 go/container](./go-container.md) | 容器内多模型枚举必须走 go/container，前端禁止手写 zip 内文件枚举 | ADR-068, ADR-069 |
| 扫描模型、ScanModelEntries | [扫描核心 go/scanner](./go-scanner.md) | 容器指纹缓存失效需调 ClearScanCache | - |
| 数值范围搜索、标签过滤 | [工具栏搜索编排 toolbar-search](./toolbar-search.md) | - | - |
| 搜索、筛选、关键词 / 标签 / 数值三路交集 | [搜索筛选编排 search](./search.md) | 搜索筛选必须经 toolbar-search 编排 + adv-filter 弹窗 + SearchModels 后端，前端只做 UI 不做筛选逻辑 | - |
| 搜索编排、高级筛选、关键词搜索 | [工具栏搜索编排 toolbar-search](./toolbar-search.md) | toolbar-search 编排必须单点分发搜索链路（弹窗 → 后端 → 标签交集 → 降级 → 渲染），禁止各层各自调 SearchModels | - |
| 缩略图、类型检测 | [资源包 mcmeta go/packs](./go-packs.md) | - | - |
| 同步项、BuildSyncItems、资源同步 | [整合包实例 go/instance](./go-instance.md) | - | - |
| 同步状态、app-sync-manager | [整合包同步页 app-sync-manager](./app-sync-manager.md) | - | - |
| 文件监听、文件变化、刷新 | [文件监听 go/watcher](./go-watcher.md) | 文件变更监听必须走 go/watcher 的事件流，禁止轮询文件系统 | - |
| 诊断页、仓库体检、冲突 / 去重 | [诊断页 diagnostics](./app-content-diagnostics.md) | 去重 / 体检必须经 diagnostics 页发起，禁止在其他页直接调 doDedup | - |
| 整合包分类、路由、location 路由 | [分类路由与回归护栏](./classify-routing.md) | 资源整合包分类必须走 go/packs/classify.go 的 ClassifyResource，前端禁止手写分类逻辑 | ADR-093 |
| 整合包实例、版本实例、VersionInstance | [整合包实例 go/instance](./go-instance.md) | 整合包实例同步必须走 go/instance 的 ysmsync.SyncResources，禁止在 app 层手写同步逻辑 | - |
| 整合包同步、推送 / 拉取 | [整合包同步 go/sync](./go-sync.md) | 整合包同步必须走 go/sync 的 diff+hash 双阶段，禁止在 app 层手写同步逻辑 | ADR-064 |
| 整合包同步页、推送 / 拉取资源 | [整合包同步页 app-sync-manager](./app-sync-manager.md) | app-sync-manager 的同步状态渲染必须经 _gen 单点生成，禁止各列各自查询状态 | - |
| 资历最深、老模型、仓库评分 | [资历最深模型 oldest-models](./oldest-models.md) | 资历排行必须经 oldest-models.ts 统一计算，禁止各页面各自实现评分逻辑 | - |
| 资源包 / 光影包、mcmeta、pack_format | [资源包 mcmeta go/packs](./go-packs.md) | 资源包元数据必须走 go/packs 的 mcmeta 解析，前端禁止手写 mcmeta.json 解析 | - |
| 资源类型识别、rtype 判定 | [扫描核心 go/scanner](./go-scanner.md) | resource_types.json 是唯一事实来源 | - |
| advFilterIntersectPaths | [搜索筛选编排 search](./search.md) | - | - |
| AnalyzeYSMModel、HasModInDir | [YSM 解析 go/ysm](./go-ysm-parser.md) | - | - |
| CLI 搜索、命令行搜索、search 命令 | [CLI 搜索命令 search](./go-cli-search.md) | CLI 搜索必须复用 go/cli 的 SearchModels 后端，禁止 CLI 层手写搜索逻辑 | - |
| filepath.WalkDir 路径安全 | [去重 go/dedup](./go-dedup.md) | - | - |
| Geometry 存档、基岩版 bedrock | [Geometry 存档 go/geometry](./go-geometry.md) | Geometry 存档解析必须走 go/geometry 的 parse/archive 封装，禁止在业务代码里直接 unzip | ADR-068 |
| initDiagnostics、createDedupSession | [诊断页 diagnostics](./app-content-diagnostics.md) | - | - |
| IsRecycleDir 守卫 | [去重 go/dedup](./go-dedup.md) | - | - |
| last-wins / priority 裁决 | [分类路由与回归护栏](./classify-routing.md) | - | ADR-093 |
| oldest 资历排行 | [诊断页 diagnostics](./app-content-diagnostics.md) | - | - |
| parse.go / archive.go | [Geometry 存档 go/geometry](./go-geometry.md) | - | ADR-068 |
| runSearch | [CLI 搜索命令 search](./go-cli-search.md) | - | - |
| SearchModels 数值筛选 | [Web Worker 模型统计层 model-stats](./model-stats.md) | - | ADR-218, ADR-219 |
| SearchModels、adv-filter、网页版降级 | [搜索筛选编排 search](./search.md) | - | - |
| sync_diff / sync_hash / sync_push / sync_relink | [整合包同步 go/sync](./go-sync.md) | - | ADR-064 |
| watcher、Events / errs / done | [文件监听 go/watcher](./go-watcher.md) | - | - |
| Web Worker、批量统计 | [Web Worker 模型统计层 model-stats](./model-stats.md) | - | ADR-218, ADR-219 |
| YSM 解析、摘要 ExtractYsmSummary | [YSM 解析 go/ysm](./go-ysm-parser.md) | YSM 解析必须走 go/ysm 的 AnalyzeYSMModel，前端禁止手写 YSM 解析逻辑 | - |
| YSM 文件元数据 | [YSM 解析 go/ysm](./go-ysm-parser.md) | - | - |
| zip 多模型、多 entry | [统一容器桥接层 go/container](./go-container.md) | - | ADR-068, ADR-069 |
| zipentry 指纹、蓝图 / 投影 / vrm / pmx | [分类路由与回归护栏](./classify-routing.md) | - | ADR-093 |

## 🎯 文件操作与标签

| 用户意图 | 首选卡 | 红线警告 | 关联 ADR |
|----------|--------|----------|----------|
| 创意工坊、社区下载、下载队列 | [社区下载 community](./community-feature.md) | 社区下载必须走 community download-queue 排队，禁止各组件各自发下载请求 | - |
| 存储授权、requestStoragePermission | [跨平台目录选择器](./directory-picker.md) | - | - |
| 打标签 / 标签存储 / 按标签筛选 | [标签系统 go/tags](./go-tags.md) | 标签以文件绝对路径为 key 存 tags.json；写入走 tmp + os.Rename 原子替换，禁止直写 | - |
| 打开文件夹、导入文件夹、目录路径 | [跨平台目录选择器](./directory-picker.md) | - | - |
| 导入、导入策略、导入队列 | [导入策略 go/importer](./go-importer.md) | 导入必须走 go/importer，落地用 fsutil.WriteFileAtomic 原子替换，禁止直写目标文件 | - |
| 导入队列、拖拽导入、文件夹导入 | [全局导入执行 import-executor](./import-queue.md) | 导入必须走 import-executor 单点编排 + dnd-collector 收集，禁止各组件各自调 ImportModel | - |
| 导入日志、操作记录、日志 | [导入日志 go/logs](./go-logs.md) | 导入日志必须走 go/logs 的 WriteFileAtomic 追加，禁止直接 os.WriteFile | - |
| 覆盖导入、import-executor | [全局导入执行 import-executor](./import-queue.md) | - | - |
| 回收站 / 软删除 / 恢复 / 清空回收站 | [回收站 go/recycle](./go-recycle.md) | 删除必须走 .recycle 软删除（硬链接判定），禁止直接 os.Remove | - |
| 回收站、恢复文件、清空回收站 | [回收站界面 recycle-bin](./recycle-bin.md) | 删除必须走 .recycle 软删除（go/recycle 实现），前端禁止直接 os.Remove | - |
| 镜像源、批量下载、github 仓库 | [社区下载 community](./community-feature.md) | - | - |
| 路径安全、路径校验、path | [路径安全 go/paths](./go-paths.md) | 路径校验必须走 go/paths 的 IsInside，禁止手写路径安全检查 | - |
| 路径穿越 | [路径安全 go/paths](./go-paths.md) | - | - |
| 模型安装、模型导入、下载模型 | [模型安装 go/installer](./go-installer.md) | 模型落地必须走 go/installer，按 LinkMode 选择落地方式，落地前做路径安全校验 | - |
| 软删除、recycle、还原 | [回收站界面 recycle-bin](./recycle-bin.md) | - | - |
| 同一 exe 换个位置跑行为不同 | [仓内二进制写用户目录被静默拒绝（代理沙箱按镜像位置拦截）](./workspace-exe-write-denied.md) | - | - |
| 网页版虚拟根 /web | [跨平台目录选择器](./directory-picker.md) | - | - |
| 文件遍历 / walk、原子写、复制 | [文件基础设施 go/fsutil](./go-fsutil.md) | 文件系统操作必须走 go/fsutil 的 walk/write/copy 封装，禁止在业务代码里直接 os.Open/os.WriteFile | - |
| 下载、下载进度、进度条 | [下载器 go/download](./go-download.md) | 下载必须走 go/download，必须带校验和校验防截断 / 部分响应 | - |
| 校验和校验 | [下载器 go/download](./go-download.md) | - | - |
| 选择目录、SelectDirectory、Wails 对话框 | [跨平台目录选择器](./directory-picker.md) | 需要目录路径的场景必须经 directory-picker 统一入口（pickDirectory / resolveAndroidRepoDir），禁止各调用方自行实现授权引导或裸调桌面对话框 | - |
| 移动 / 复制 / 删除 / 重命名文件 / 文件夹导入 | [文件操作 go/fileops](./go-fileops.md) | 文件 CRUD 必须走 go/fileops，internal/app 薄壳仅转发 | - |
| 应用临时文件创建全部失败但功能正常 | [仓内二进制写用户目录被静默拒绝（代理沙箱按镜像位置拦截）](./workspace-exe-write-denied.md) | go/fsutil/write.go\|createTempFile = os.CreateTemp（:44，无花样，排除代码嫌疑的锚点） | - |
| 硬链接、跨设备、权限常量 | [文件基础设施 go/fsutil](./go-fsutil.md) | - | - |
| Android 公共仓库目录、GetDefaultRepoRoot | [跨平台目录选择器](./directory-picker.md) | - | - |
| BOM、base64 受限解码、读取上限 | [文件基础设施 go/fsutil](./go-fsutil.md) | - | - |
| DnD 文件收集 | [拖拽平台适配 dnd-shared](./dnd-shared.md) | - | - |
| dnd-shared / dnd-collector / pack-dnd | [全局导入执行 import-executor](./import-queue.md) | - | - |
| download-queue / download-tasks | [社区下载 community](./community-feature.md) | - | - |
| download、HTTPStatusError、TruncationError | [下载器 go/download](./go-download.md) | - | - |
| ERROR_NOT_SAME_DEVICE | [模型安装 go/installer](./go-installer.md) | - | - |
| fileToBase64 文件编码 | [拖拽平台适配 dnd-shared](./dnd-shared.md) | - | - |
| fsutil.WriteFileAtomic | [导入策略 go/importer](./go-importer.md) | - | - |
| import log、历史 | [导入日志 go/logs](./go-logs.md) | - | - |
| import-dnd 拖拽导入 | [拖拽平台适配 dnd-shared](./dnd-shared.md) | - | - |
| importer、DetectContainerType | [导入策略 go/importer](./go-importer.md) | - | - |
| initRecycleBin / GetRepoRoot / createLoadGuard | [回收站界面 recycle-bin](./recycle-bin.md) | - | - |
| IsInside / IsInsideResolved | [路径安全 go/paths](./go-paths.md) | - | - |
| LinkMode（copy / hardlink / symlink） | [模型安装 go/installer](./go-installer.md) | - | - |
| pack-dnd 整合包拖拽 | [拖拽平台适配 dnd-shared](./dnd-shared.md) | - | - |
| WebView2 拖拽坑 | [拖拽平台适配 dnd-shared](./dnd-shared.md) | - | - |

## 🎯 后端桥接与数据存储

| 用户意图 | 首选卡 | 红线警告 | 关联 ADR |
|----------|--------|----------|----------|
| 并发工具、Parallel 泛型并行 | [通用泛型并发工具 go/conc](./go-conc.md) | - | - |
| 参数规格存在哪（单一事实源） | [GUI→CLI 参数桥 ParamSpec 协议(ADR-173) 实施状态](./adr173-gui-cli-paramspec.md) | - | - |
| 调后端、app.ts 绑定、getApp | [Wails Binding API 总览 internal/app](./wails-bindings.md) | - | - |
| 调用 Go Binding / getApp 获取后端 | [Wails 桥接 app.ts](./wails-bridge.md) | 前端所有 Go 调用必须走 getApp()，禁止直接访问 window.go.main.App（治理红线 4.2） | ADR-049 |
| 检测平台类型 / 网页模式 | [Wails 桥接 app.ts](./wails-bridge.md) | Binding 函数名写错穿透到运行时 undefined（Mock bridge 形态与生成模块不同，类型造假风险） | ADR-049 |
| 跨平台路径处理、pathmgr | [Android 平台守卫（Go 侧）](./go-android-platform-guard.md) | - | - |
| 平台分支差异：WASM decoder / 进程重启 / Node.js sidecar 禁用、build-tag 双文件隔离 | [Android 平台守卫（Go 侧）](./go-android-platform-guard.md) | - | - |
| 桥 DLL、Wails 后端迁移 Rust | [Rust 桥 rustbridge](./rustbridge.md) | - | - |
| 日志环持久化、社区/工坊数据 | [浏览器后端 IndexedDB 封装](./backend-idb.md) | zip entry 路径必须经 sanitizeZipEntryPath 清洗（防 .. 穿越） | ADR-177 |
| 如何给命令登记 ParamSpec | [GUI→CLI 参数桥 ParamSpec 协议(ADR-173) 实施状态](./adr173-gui-cli-paramspec.md) | - | - |
| 输入序收集 | [通用泛型并发工具 go/conc](./go-conc.md) | - | - |
| 通用红线 | [浏览器后端 IndexedDB 封装](./backend-idb.md) | DetectZipType base64 超 50MB 静默返回空，避免 atob 内存压力 | ADR-177 |
| 通用红线 | [浏览器后端 IndexedDB 封装](./backend-idb.md) | 多标签页互锁：db.onversionchange 关闭旧连接并置空 dbPromise；onblocked 明确 reject | ADR-177 |
| 通用红线 | [浏览器后端 IndexedDB 封装](./backend-idb.md) | 前缀扫描性能门槛 R1 万级 key：用 IDBKeyRange.bound 区间定位而非全库 startsWith | ADR-177 |
| 网页版 / 浏览器模式 / web mode | [网页版后端 backend-web](./backend-web.md) | 网页版后端必须经 browserAdapter 代理，禁止 Wails 与浏览器后端混合调用 | - |
| 网页版路由 / browser adapter | [Wails 桥接 app.ts](./wails-bridge.md) | 改 Go 文件后必须 wails3 build + 重启，纯 dev 模式看不到新 Binding | ADR-049 |
| 网页模式切换、browser-adapter 桥接 | [浏览器后端 IndexedDB 封装](./backend-idb.md) | fail-fast：未实现 binding 必须抛 WebUnsupportedError，禁止 undefined 穿透 | ADR-177 |
| 桌面/网页版运行时区分 | [Wails runtime 抽象 backend-runtime](./backend-runtime.md) | - | - |
| Android 存储授权、目录选择器 | [Android 桥接层：存储授权 + 目录选择器](./android-bridge.md) | Android 存储授权必须走 android-bridge 的 SAF 授权流程，禁止直接请求 MANAGE_EXTERNAL_STORAGE | - |
| Android 平台守卫、RevealInExplorer/OpenFolder 降级、文件浏览失败处理 | [Android 平台守卫（Go 侧）](./go-android-platform-guard.md) | - | - |
| android:back 返回键、弹窗退出 | [Android 系统事件消费（back/网络/存储授权）](./android-events.md) | Android 系统事件必须经 android-events 的 registerAndroidEvents 单点注册，禁止各组件各自注册 | - |
| Android/Linux/macOS Rust 桥 | [Rust Scanner Bridge 全平台支持](./rust-android-bridge.md) | Android/Linux/macOS 的 Rust 桥必须走平台桥，禁止硬编码 Windows 路径 | - |
| API 总览、Binding 有哪些方法、App 方法签名 | [Wails Binding API 总览 internal/app](./wails-bindings.md) | 前端访问 Wails 后端必须经 getApp()，禁止直接调 window.go | - |
| bridge_windows/bridge_cgo | [Rust 桥 rustbridge](./rustbridge.md) | - | - |
| browser adapter、跨域隔离 COI | [网页版后端 backend-web](./backend-web.md) | - | - |
| closeActiveDialog、registerAndroidEvents | [Android 系统事件消费（back/网络/存储授权）](./android-events.md) | - | - |
| compile-android-rust/compile-rust-static | [Rust Scanner Bridge 全平台支持](./rust-android-bridge.md) | - | - |
| FSA 授权、本地仓库挂载 | [浏览器后端 IndexedDB 封装](./backend-idb.md) | 内存降级 OOM 保护：隐私模式无界写入会撑爆堆 | ADR-177 |
| GetAppVersion / ScanModelEntries / SearchModels | [Wails Binding API 总览 internal/app](./wails-bindings.md) | - | - |
| GUI 调 CLI 参数为何丢失 | [GUI→CLI 参数桥 ParamSpec 协议(ADR-173) 实施状态](./adr173-gui-cli-paramspec.md) | 新增命令参数必须经 RegisterCommandC 登记 ParamSpec——未登记走 legacy 降级（空串/0/false 丢弃，拿不到声明序与显式空值） | - |
| IndexedDB / IDB / 浏览器后端 | [网页版后端 backend-web](./backend-web.md) | - | - |
| IndexedDB 模型库（browser 模式） | [Wails 桥接 app.ts](./wails-bridge.md) | window.go 空对象 {} 会被缓存为 _App（P3 修复前），导致缺失方法静默穿透整个会话 | ADR-049 |
| IndexedDB、网页版存储、idbGet/idbSet/idbDel CRUD | [浏览器后端 IndexedDB 封装](./backend-idb.md) | 事务必须接线 complete/error/abort 三事件 | ADR-177 |
| MANAGE_EXTERNAL_STORAGE、SAF、权限 | [Android 桥接层：存储授权 + 目录选择器](./android-bridge.md) | - | - |
| NBT 解析 / 体素 / 网页版文件系统 | [网页版后端 backend-web](./backend-web.md) | - | - |
| Rust 扫描器、rust_backend | [Rust 桥 rustbridge](./rustbridge.md) | Rust 桥必须走 go/rustbridge 的平台桥（bridge_*.go），禁止在业务代码里直接 dlopen 加载 | - |
| rust_backend、CGO | [Rust Scanner Bridge 全平台支持](./rust-android-bridge.md) | - | - |
| SAF 废弃、MANAGE_EXTERNAL_STORAGE 权限模型、前端黑名单同步（ANDROID_UNAVAILABLE） | [Android 平台守卫（Go 侧）](./go-android-platform-guard.md) | - | - |
| ScreenLocked、NetworkChanged、permissionGranted | [Android 系统事件消费（back/网络/存储授权）](./android-events.md) | - | - |
| Wails Events 事件抽象 | [Wails runtime 抽象 backend-runtime](./backend-runtime.md) | - | - |
| Wails Window 窗口抽象 | [Wails runtime 抽象 backend-runtime](./backend-runtime.md) | - | - |
| watcher 监听跳过、fsnotify 平台限制 | [Android 平台守卫（Go 侧）](./go-android-platform-guard.md) | - | - |
| web no-op 桩 | [Wails runtime 抽象 backend-runtime](./backend-runtime.md) | - | - |
| worker 池、批量并发 | [通用泛型并发工具 go/conc](./go-conc.md) | - | - |
| zip 导入、模型扫描、Stats Worker 统计 | [浏览器后端 IndexedDB 封装](./backend-idb.md) | browserAdapter Proxy 的 then 陷阱：返回 undefined 避免被误判为 thenable | ADR-177 |

## 🎯 配置与注册表

| 用户意图 | 首选卡 | 红线警告 | 关联 ADR |
|----------|--------|----------|----------|
| 版本号、版本检查、go-version | [版本号 go/version](./go-version.md) | 版本号必须走 go/version 的 LoadVersion，禁止在多处手写版本号读取 | - |
| 存储子目录、storageSubDir、资源类型同步视图、schema.ts | [资源类型工具 resource-types](./utils-resource-types.md) | - | - |
| 共享类型、AppConfig、配置 | [共享类型 go/types](./go-types.md) | 共享类型必须走 go/types 单点定义，禁止在业务代码里复制类型定义 | ADR-144, ADR-192 |
| 检查更新、更新下载、update | [自动更新 go/updater](./go-updater.md) | 更新检查必须走 go/updater，前端禁止手写更新下载逻辑 | - |
| 界面偏好、字号、worker-prefs | [设置页 settings](./app-content-settings.md) | 卡片型设置项必须走 `stgCard()` 构造器，禁止手写 `stg-card` div 或裸样式仿卡（2026-10 含动态渲染路径 initAdvancedGrid 全清零；执法闸 = check-redlines W9，新增即红） | - |
| 扩展名、支持的文件类型、拖拽过滤 | [扩展名映射 extensions](./utils-extensions.md) | 扩展名判定必须走 extensions.ts 的 isSupportedExt，拖拽导入场景禁止等待异步注册表 | - |
| 启动器检测、HMCL / PCL / Minecraft 识别 | [启动器实例发现 go/launcher](./go-launcher.md) | - | - |
| 设置页、主题设置、键位、路径配置 | [设置页 settings](./app-content-settings.md) | 配置落盘一律走 `views/config-write.ts\|writeAppConfig(patch)`（跨视图唯一实参点，ADR-313）；设置域内部可走薄包装 `path-cards.ts\|saveCfg`（额外同步内存 cfg）。patch 语义 = 只覆盖显式传入字段、其余取保存前重读最新；偏好类读写一律 safeGet/safeSet，禁止裸 localStorage | - |
| 实例目录解析、运行目录推导 | [启动器实例发现 go/launcher](./go-launcher.md) | - | - |
| 通用红线 | [设置页 settings](./app-content-settings.md) | 「值→文案」多消费面共享映射表住 `ui-maps.ts`（MIRROR_UI / LINK_MODE_UI）；schema 加成员漏文案键编译期红，禁模板手写 option 裸列 | - |
| 新增资源类型 / 修改 resource_types.json / 文件类型 | [资源注册表 registry](./resource-registry.md) | resource_types.json 是唯一事实来源；前端只读不判、禁本地重算 | - |
| 注册表、扩展名、LinkType、BedrockModel | [共享类型 go/types](./go-types.md) | - | ADR-144, ADR-192 |
| 资源类型、RESOURCE_TYPES、类型标签 | [资源类型工具 resource-types](./utils-resource-types.md) | 资源类型必须派生自 resource_types.json（前端唯一入口 = schema.ts 的同步视图 allResourceTypes/resourceTypesById），禁止手写类型映射、禁止异步 RPC 旁路 | - |
| AppConfig、配置加载、配置文件 | [Go 配置单持有点 go/config](./go-config.md) | 配置必须走 go/config 的 LoadAppConfig 单点加载，禁止在多处各自读配置文件 | - |
| currentRepoType 当前资源类型 | [全局资源类型状态 repo-rtype](./repo-rtype.md) | - | - |
| DetectLauncherInstances | [启动器实例发现 go/launcher](./go-launcher.md) | - | - |
| go/config | [Go 配置单持有点 go/config](./go-config.md) | - | - |
| LoadRegistry/DedupConfig | [共享类型 go/types](./go-types.md) | - | ADR-144, ADR-192 |
| repo_rtype localStorage 权威源 | [全局资源类型状态 repo-rtype](./repo-rtype.md) | - | - |
| RESOURCE_EXTS/ALL_EXTS、导入过滤、扩展名归属 | [扩展名映射 extensions](./utils-extensions.md) | - | - |
| settings/init / keymap / store | [设置页 settings](./app-content-settings.md) | 异步操作防连点一律 `store.ts\|withBusy(task)`（返回是否获得锁，false 走拒绝分支如 UI 当场回退）；`isBusy/setBusy` 已退役，禁手写「检查+置忙+finally 复位」三段 | - |
| useCurrentResourceType 订阅类型切换 | [全局资源类型状态 repo-rtype](./repo-rtype.md) | - | - |
| version-check | [版本号 go/version](./go-version.md) | - | - |
| version-updater | [自动更新 go/updater](./go-updater.md) | - | - |

## 🎯 下载与社区

| 用户意图 | 首选卡 | 红线警告 | 关联 ADR |
|----------|--------|----------|----------|
| 2000 级索引窗口化 | [社区虚拟滚动 community-virtual-list](./community-virtual-list.md) | - | - |
| 定高虚拟列表 | [社区虚拟滚动 community-virtual-list](./community-virtual-list.md) | - | - |
| 零高度降级全量渲染 | [社区虚拟滚动 community-virtual-list](./community-virtual-list.md) | - | - |
| buildDownloadTasks 任务构建 | [下载任务执行层 download-tasks](./download-tasks.md) | - | - |
| cancelDownloads 取消 | [下载队列状态机 download-queue-store](./download-queue-store.md) | - | - |
| classifyDownloadSize 大小策略 | [下载任务执行层 download-tasks](./download-tasks.md) | - | - |
| DOWNLOAD_CONFIRM_BYTES 确认阈值 | [下载任务执行层 download-tasks](./download-tasks.md) | - | - |
| DOWNLOAD_REJECT_BYTES 拒绝阈值 | [下载任务执行层 download-tasks](./download-tasks.md) | - | - |
| DownloadState 队列状态 | [下载队列状态机 download-queue-store](./download-queue-store.md) | - | - |
| DownloadTask 下载任务 | [下载队列状态机 download-queue-store](./download-queue-store.md) | - | - |
| enqueueDownloads 入队 | [下载队列状态机 download-queue-store](./download-queue-store.md) | - | - |
| paddingTop/Bottom 占位 | [社区虚拟滚动 community-virtual-list](./community-virtual-list.md) | - | - |
| Wails 事件订阅 | [下载队列状态机 download-queue-store](./download-queue-store.md) | - | - |

## 🎯 截图导出与缓存

| 用户意图 | 首选卡 | 红线警告 | 关联 ADR |
|----------|--------|----------|----------|
| 截图 / 导出 PNG / 多角度四角度截图 | [截图与导出 export](./utils-export.md) | 离屏截图渲染器资源与 blob URL 必须释放，防内存泄漏 | - |
| 截图、导出 PNG、多角度截图 | [截图导出 export](./export.md) | 离屏截图渲染器资源与 blob URL 必须显式释放，禁止依赖 GC 回收 | ADR-127 |
| 离屏截图渲染器 | [截图导出 export](./export.md) | - | ADR-127 |
| 模型详情、摘要卡片、summaryCardHTML | [摘要生成 summarize](./utils-summarize.md) | 模型摘要必须走 summarize.ts 的 summaryCardHTML，禁止手写详情卡片 HTML | - |
| 透明背景 / 预览缓存 / blob URL | [截图导出 export](./export.md) | - | ADR-127 |
| 透明背景截图 / preserveDrawingBuffer | [截图与导出 export](./utils-export.md) | - | - |
| 预览缓存 cacheGet / cacheSet / cacheSetEvictHandler | [截图与导出 export](./utils-export.md) | - | - |
| 预览卡片、加密模型、作者信息、动画分组、免费付费 | [摘要生成 summarize](./utils-summarize.md) | - | - |
| renderMultiAngle / AngleShot | [截图与导出 export](./utils-export.md) | - | - |

## 🎯 前端分层与边界

| 用户意图 | 首选卡 | 红线警告 | 关联 ADR |
|----------|--------|----------|----------|
| 测试污染 reset 钩子怎么处理 | [模块级全局状态治理](./module-global-state.md) | 判断标准：reset 钩子依赖（有 → 收敛有测试收益）vs resetModules 重载（无 → 收敛仅为组织价值） | - |
| 磁盘级筛选与高级搜索归 Go（SearchModels），前端不扫磁盘 | [前端只读不判边界与豁免](./fe-go-boundary.md) | - | - |
| 判断「全仓干净」用 grep 实证，不引用历史注脚作证据 | [代际守卫唯一出口 createLoadGuard](./load-guard.md) | - | - |
| 前端有没有黑话 / 命名烂在哪 | [前端命名章程（黑话治理）](./frontend-naming.md) | 禁止新增不可读私有缩写前缀（≤3 字母非领域词）；禁止单字母命名业务量（循环下标 i/j 除外） | - |
| 全局 Map / 模块级 let 何时收敛成对象 | [模块级全局状态治理](./module-global-state.md) | 模块级状态收敛 = 状态收进闭包/类对象 + 导出函数签名不变；不改消费方 | - |
| 输入端（磁盘 → 列表）归 Go，展示端（列表 → 视图）豁免 | [前端只读不判边界与豁免](./fe-go-boundary.md) | 前端扫磁盘 / 重算归属语义 = 违反回归红线 | - |
| 树内即时过滤是对 Go 已交付内存全量的 UI 收窄，不是归属重算 | [前端只读不判边界与豁免](./fe-go-boundary.md) | - | - |
| 通用红线 | [解析簇 parsers/ 自 backend 迁出](./frontend-parsers.md) | base64 原语已下沉 utils/base/primitives/base64.ts（ADR-170 二段收口 2026-09,parsers 不再 import backend） | - |
| 通用红线 | [解析簇 parsers/ 自 backend 迁出](./frontend-parsers.md) | ysm-header.ts MAX_HEADER_LINES=200 与 Go header.go 对齐,改上限须双端同步 | - |
| 通用红线 | [解析簇 parsers/ 自 backend 迁出](./frontend-parsers.md) | voxel-bits.ts 位解码口径(Litematica 小端 LSB 起始)与 Go nbt.go extractBits 逐行一致,改前必读注释 | - |
| 通用红线 | [解析簇 parsers/ 自 backend 迁出](./frontend-parsers.md) | pack-meta.ts / voxel-colors.ts 下游消费方固定,改导出签名须 grep 全仓消费者 | - |
| 为什么搜索「尺寸信息」找不到 si | [前端命名章程（黑话治理）](./frontend-naming.md) | 内容适配器 build 返回值统一命名 content（禁 built），新适配器照此写 | - |
| 想迁移/收敛 load-guard.ts 前，先查 ADR-230 | [代际守卫唯一出口 createLoadGuard](./load-guard.md) | - | - |
| 新增代际逻辑时，唯一出口是 createLoadGuard() 四件套 | [代际守卫唯一出口 createLoadGuard](./load-guard.md) | 迁移或删除 load-guard.ts = 违反 ADR-230 | - |
| 找 YSM 头部解析 / NBT 解析 / 体素解析 / zip 解包 / 颜色映射 | [解析簇 parsers/ 自 backend 迁出](./frontend-parsers.md) | parsers/ 是纯解析层,勿塞业务;web-fs 装配层在 backend/ | - |
| 重命名某个变量/函数 | [前端命名章程（黑话治理）](./frontend-naming.md) | 生命周期动词一义一词：卸载=unmount、资源释放=dispose、会话收尾=finish/cleanup | - |
| built 黑话还剩哪些没清理 | [前端命名章程（黑话治理）](./frontend-naming.md) | 跨文件同函数禁双份定义（getCompound 在 nbt-parse.ts 与 voxel-parse.ts 各一份） | - |
| core 准入三条全满足才可入；绑定能力走依赖注入不走直引 | [前端分层 seam 与 import 路径](./fe-layering-seams.md) | core 直引 backend/* 或 features 直引 backend/app.ts = 门禁阻断 | - |
| features 拿 backend 能力唯一出口是 *-deps.ts seam + 注入形态 | [前端分层 seam 与 import 路径](./fe-layering-seams.md) | - | - |
| import 非精确同目录一律 @/顶层/具体文件，禁裸目录聚口 | [前端分层 seam 与 import 路径](./fe-layering-seams.md) | - | - |

## 🎯 重构与域切分

| 用户意图 | 首选卡 | 红线警告 | 关联 ADR |
|----------|--------|----------|----------|
| "把认知复杂度降到阈值下却分数不变" | [三档阈值扫描器（复杂度/参数/类型安全）](./check-threshold-scanners.md) | - | - |
| "给 exported 函数消参数陷阱但不扭曲 API" | [三档阈值扫描器（复杂度/参数/类型安全）](./check-threshold-scanners.md) | - | - |
| 该子域是否仅依赖注入回调与 DTO 即可运转？是 → 可切（纯域） | [install 域切分经验：切纯域不硬切复合域（耦合度门槛判断）](./install-domain-split.md) | import 域依赖 LoadAppConfig/GetRepoRoot/ScanModelEntries/ClearScanCache/ListVersionInstances 等 10+ 跨域方法 | - |
| 该子域是否直读 App 的共享基础设施字段？是 → 不切（复合域） | [install 域切分经验：切纯域不硬切复合域（耦合度门槛判断）](./install-domain-split.md) | importModelFolderAs 宿主在 app_files.go（files 域），被 files 域绑定与 install 组合链三方共用 | - |

## 🎯 门禁与脚本

| 用户意图 | 首选卡 | 红线警告 | 关联 ADR |
|----------|--------|----------|----------|
| "本地复现三档扫描器的门禁范围" | [三档阈值扫描器（复杂度/参数/类型安全）](./check-threshold-scanners.md) | - | - |
| "为什么某包报 0% 覆盖率" | [覆盖率门禁语句加权口径](./go-coverage-gate.md) | - | - |
| "知道 check-complexity 报错会不会阻断推送" | [三档阈值扫描器（复杂度/参数/类型安全）](./check-threshold-scanners.md) | "认知复杂度的度量单位是**具名函数**，不是语法上的函数字面量" | - |
| "Go 覆盖率门禁怎么算包覆盖率" | [覆盖率门禁语句加权口径](./go-coverage-gate.md) | 包覆盖率口径 = aggregateByPackage 语句加权（covered 语句/总语句）——「文件内函数百分比最小值」口径会让单个 0% 函数拖垮整包 | - |
| 查看 _lib 模块被多少脚本引用 | [_lib 共享层采用率闸门](./scripts-lib-adoption.md) | - | - |
| 查看重复对的详细位置（行号 + 片段） | [Go 端 jscpd 重复检测脚本](./scripts-jscpd-go.md) | - | - |
| 冻结当前 Go 重复债务到 baseline（治理后收紧） | [Go 端 jscpd 重复检测脚本](./scripts-jscpd-go.md) | - | - |
| 发版冒烟、CI 预演、lockfile 同步、跨平台标签 | [发版冒烟组——CI 同口径预演（ADR-318）](./experience.md) | contract-tagsensitive 清单为人工维护——新加 tag 敏感契约测试须手动入组（ADR-318 已知遗留） | - |
| 防吞并发会话未提交漂移 | [提交前钩子 pre-commit](./pre-commit-hook.md) | - | - |
| 改门禁并行结构 | [推送前门禁 pre-push-gate](./pre-push-gate.md) | FAIL 归属标签靠 blockPolicy 落库，record 漏存即全部误标「本次引入」 | - |
| 孤儿导出误报、扫描盲区、转发即消费 | [孤儿导出检测器（扫描盲区）](./orphan-export-scanner.md) | ⚠️ 孤儿读数为 0 才可信；出现孤儿先判「真死代码 vs 扫描漏检」再动手删 | - |
| 检查某 _lib 模块是否被绕开手搓 | [_lib 共享层采用率闸门](./scripts-lib-adoption.md) | [] | - |
| 检查哪些脚本未登记在 README | [README 登记处对账 check-readme-index.ts](./scripts-readme-index.md) | 新增/改名/删除 scripts/ 下的脚本必须同步更新 scripts/README.md | - |
| 门禁检查项有哪些 | [推送前门禁 pre-push-gate](./pre-push-gate.md) | 推送门禁失败先看 FAIL 块，禁止无脑 git push --no-verify 绕过 | - |
| 排查「闸红了为什么还能提交」 | [门禁委托链全景图（四入口横向拼图）](./gate-chain-map.md) | - | - |
| 盘点当前技术债并刷新 7 本账本 | [技术债账本刷新与盘点方法论](./debt_ledger_refresh.md) | 未提交改动在多 AI 并行期会被 worktree reset 冲掉——改账本 / 文档后必须立即 --files 提交锁定 | - |
| 判定「新增重复对」是真实新增还是文件搬迁/拆分 | [Go 端 jscpd 重复检测脚本](./scripts-jscpd-go.md) | - | - |
| 判定违规是「真残留」还是「误报」 | [_lib 共享层采用率闸门](./scripts-lib-adoption.md) | - | - |
| 判断某个检查项归属哪一层 | [门禁委托链全景图（四入口横向拼图）](./gate-chain-map.md) | - | - |
| 提交前文档自动同步 | [提交前钩子 pre-commit](./pre-commit-hook.md) | 禁止在 pre-commit 用 git add -u docs/ 兜底（会吞他人未提交半成品，违反 P2-2） | - |
| 通用红线 | [推送前门禁 pre-push-gate](./pre-push-gate.md) | 判定字段必须写进 _summary（用 buildScanVerdict），写顶层 ok 会被解析器短路 | - |
| 推送被门禁阻断怎么办 | [推送前门禁 pre-push-gate](./pre-push-gate.md) | 门禁并行 async IIFE 必须带调用括号，漏 () 会静默跳过整域检查 | - |
| 往测试加 vi.mock 需要注意什么 | [mock 路径守卫 check-mock-paths](./mock-path-guard.md) | 用 // mock-path-ignore: <理由> 或 docs/.mock-path-exempt.json 豁免，禁止直接 --no-verify 绕过 | - |
| 为什么 Go 侧要引入 golangci-lint | [golangci-lint（Go 静态分析真空面）](./golangci-lint.md) | Go 曾是静态分析真空面（go vet 独苗）：golangci-lint 白名单制补齐——.golangci.yml 为 default: none + 显式 enable，勿开 enable-all | - |
| 为新的共享模块加一条守护规则 | [_lib 共享层采用率闸门](./scripts-lib-adoption.md) | - | - |
| 新增门禁块按哪套范式写（gate-blocks 还是 commit-blocks） | [门禁委托链全景图（四入口横向拼图）](./gate-chain-map.md) | - | - |
| 修复登记漂移（补全缺失的登记） | [README 登记处对账 check-readme-index.ts](./scripts-readme-index.md) | - | - |
| 验证新增脚本是否已正确登记 | [README 登记处对账 check-readme-index.ts](./scripts-readme-index.md) | README 是唯一事实源，AGENTS.md 工具口令表只是指针 | - |
| 一眼看清 commit/push/CI 各环谁在哪拦 | [门禁委托链全景图（四入口横向拼图）](./gate-chain-map.md) | - | - |
| 运行 Go 重复门禁 / 检查是否有新增重复对 | [Go 端 jscpd 重复检测脚本](./scripts-jscpd-go.md) | - | - |
| check-orphan-exports 三类漏检修复 | [孤儿导出检测器（扫描盲区）](./orphan-export-scanner.md) | - | - |
| CI/CD 门禁中校验 README 完整性 | [README 登记处对账 check-readme-index.ts](./scripts-readme-index.md) | - | - |
| lint 报了多少存量债 | [golangci-lint（Go 静态分析真空面）](./golangci-lint.md) | 存量债不惩罚：pre-push-gate 跑 --new-from-rev 只拦本次引入（全量必红，errcheck 存量 623 条），未安装/无基线自动降级跳过 | - |
| mock 路径守卫怎么豁免 | [mock 路径守卫 check-mock-paths](./mock-path-guard.md) | - | - |
| push 被 golangci-lint 阻断怎么办 | [golangci-lint（Go 静态分析真空面）](./golangci-lint.md) | push 被阻断先看 FAIL 块定位 linter 与文件；语义误报用 //nolint 注明 linter 名与理由，禁止 git push --no-verify 绕过 | - |
| vi.mock 改了路径结果静默不起作用 | [mock 路径守卫 check-mock-paths](./mock-path-guard.md) | vi.mock("<内部spec>") 指向不存在的模块路径时 vitest 静默不命中——mock 路径写错就悄悄失效，测试照常通过 | - |

## 🎯 测试与验证

| 用户意图 | 首选卡 | 红线警告 | 关联 ADR |
|----------|--------|----------|----------|
| 按 testid 查询/匹配 DOM 元素 | [测试工具 test-utils（G-1 抗脆弱测试基础设施）](./test-utils.md) | 禁止用固定 sleep 等待正向结果——真 flaky | - |
| 布局断言收敛三分法 | [菜单测试断言三分法](./menu-test-assertion.md) | helper 必须在 node/jsdom 双环境可 import（menu-test-helpers 零上层依赖叶） | - |
| 菜单测试怎么写才长久 | [菜单测试断言三分法](./menu-test-assertion.md) | 门禁只减不增：新增布局断言即红，触碰即收敛 | - |
| 菜单测试债务门禁 check-menu-test-layout | [菜单测试断言三分法](./menu-test-assertion.md) | - | - |
| 测试报绿但没验到东西时，查静默吞异常与条件跳过 | [E2E 视觉反馈（截图取证）](./e2e-visual-feedback.md) | - | - |
| 等待 DOM 内容或 mock 调用出现 / 组件 init 链落定 | [测试工具 test-utils（G-1 抗脆弱测试基础设施）](./test-utils.md) | 禁止用 waitFor 条件耦合组件内部实现细节 | - |
| 挂载/卸载自定义元素 | [测试工具 test-utils（G-1 抗脆弱测试基础设施）](./test-utils.md) | - | - |
| 派发 click / input / keydown / drag & drop 等模拟事件 | [测试工具 test-utils（G-1 抗脆弱测试基础设施）](./test-utils.md) | 禁止把负向定时器窗口断言换成短 sleep | - |
| 确认 Go-TS 解析层是否漂移 → 跑 go test ./go/types ./go/litematic + vitest src/backend/*.parity.test.ts | [Go-TS 解析层 golden 对拍（ADR-154 双端互锁）](./go-ts-golden.md) | Go MatchZipEntry 与 TS matchZipEntryTS 的首命中序依赖 resource_types.json 顺序——重排类型定义即两端漂移 | - |
| 视觉异常说不清来源时，做单变量开关对照实验 | [E2E 视觉反馈（截图取证）](./e2e-visual-feedback.md) | 断言写成 if (count() > 0) 或 .catch(() => {}) 会让未生效的流程报绿 | - |
| 想知道界面长什么样，用截图取证而非断言计数 | [E2E 视觉反馈（截图取证）](./e2e-visual-feedback.md) | 元素在 Shadow DOM 内，页面内 querySelector 查不到而截图里明明有 | - |
| 修改识别层指纹后自检 → 重跑两端 parity 测试（fixture 期望值以 Go 输出为准） | [Go-TS 解析层 golden 对拍（ADR-154 双端互锁）](./go-ts-golden.md) | voxel-colors-data.json 无复跑生成器（gen/main.go 只生成 block_ids_data.go），靠 parity_voxel_test.go 兜底 | - |
| sleep 替换为 waitFor / 负向定时器窗口断言 | [测试工具 test-utils（G-1 抗脆弱测试基础设施）](./test-utils.md) | - | - |

## 🎯 能力门控与平台判定

| 用户意图 | 首选卡 | 红线警告 | 关联 ADR |
|----------|--------|----------|----------|
| can binding 可用性 | [能力门控 capabilities](./capabilities.md) | - | - |
| canWebAction viewer 模式右键菜单 | [能力门控 capabilities](./capabilities.md) | - | - |
| VIEWER_PURE_ACTIONS 纯前端动作 | [能力门控 capabilities](./capabilities.md) | - | - |
| VIEWER_WEB_ACTION_BINDINGS web 可达 action | [能力门控 capabilities](./capabilities.md) | - | - |

## 🚨 高频陷阱速查

| 陷阱 | 位置 | 正确做法 |
|------|------|----------|
| Vector3 频繁 new 造成 GC 抖动；必须复用或池化 | - | - |
| AbortController 未清理导致事件泄漏；必须在 dispose 时 abort + removeEventListener | - | - |
| app-toast msg 槽走 esc() 转义，塞 SVG 会以字面 svg 标签文本显示，不能直接承载图标（ADR-267 盲区根因） | - | - |
| .toast 已按 type 左边框着色，msg 载荷 emoji 前缀是信息冗余，应交给 type 驱动 | - | - |
| internal/app 不得 import go/cli（ADR-145 架构：两侧互不依赖，main 装配）——规格经 main.go cliSpecsToDTO 字段级转换注入，go/cli 侧字段改名/删除会在此编译失败（有意为之的漂移防线） | - | - |
| 新增命令参数若不登记 ParamSpec，桥接层走 legacy 降级（空串/0/false 丢弃）——与 ADR-173 前行为等价，但拿不到声明序输出与显式空值能力；无 flag 命令（cache-status/perf-log）无需登记 | - | - |
| scripts/_lib/cli-registry.ts 的 CMD_RE 只解析到 runFn 不强制收尾 ——RegisterCommandC 尾随变参 ParamSpec 拆行注册合法（2026-09-03 教训：曾要求完整 `)` 闭合致 5 命令从注册表解析消失、completions/文档 parity 双双拉红） | `)` | - |
| 直接请求 MANAGE_EXTERNAL_STORAGE | - | 新版 Android 拒绝、Google Play 下架；必须走 SAF |
| 目录选择未回传 URI | - | 后续访问失败；必须经 android-bridge 持久化 URI |
| 各组件各自注册 | - | 重复监听、返回键冲突；必须经 registerAndroidEvents |
| 返回键未消费 | - | 直接退出应用；必须在有弹窗时 consume back 事件 |
| 手写关键帧插值 | - | 与基岩官方行为不一致、T-pose 漂移；必须经 evaluateClip |
| Molang 表达式缓存键不完整 | - | 相同逻辑不同骨骼重复求值；缓存 key 必须含 clip/bone 标识 |
| 旋转角度喂 Euler 时 X/Z 互换（误写 Euler.set(rz,ry,rx,'ZYX')）→ Bedrock X 旋转绕到 Z 轴、反之亦然：手臂外展偏向一侧、狐狸分支（wb/RightArm2/LeftArm2）姿态整体反转（wine_fox 真实文件 32/39 clip 受影响、最大偏差 180°，2026-09 修复）；角度必须按自身轴名直喂 Euler(rx,ry,rz,'ZYX') | - | - |
| 在仓库页直接调 doDedup | - | 缺上下文、无法展示冲突视图；必须走 diagnostics 页 initDiagnostics |
| 性能 trace 未释放 | - | 长时占用内存；file-bench / perf-trace 完成后必须 stop 回收 |
| 各组件各自读写 localStorage | - | 值不同步、设置页显示与页面行为不一致；必须经 store 单点 |
| 键位未持久化 | - | 重启恢复默认；必须经 store 的 safeSet 落盘 |
| label-for 合规（WCAG 4.1.2）：tpl-settings.ts 14+ 处 `<span class="label">` 全部改为 `<label for="...">` 关联对应 select/input，屏幕阅读器可正确读出关联 | `标签→控件` | - |
| "卡片唯一造法 = `stgCard()`：新增/重构设置项（hdr 图标+标题 / body 值或控件 / `stg-card-desc` 说明 / `actions` 按钮四区）一律走 `frontend/src/views/app-content/settings/stg-card.ts` 的 `stgCard()` 构造器，禁止手写 `<div class=\"stg-card\">` 或裸 `style=\"background:var(--surf);border:...\"` 仿卡——后者三处间距/圆角/动画各自为政，迟早漂移（见样式范式契约）。**执法闸 = check-redlines W9**（扫 settings 生产文件的 stg-card/-hdr/-body 结构字面量，豁免 stg-card.ts 本体与测试）——「清零」宣称曾因无闸兜底在动态渲染路径（path-cards\|initAdvancedGrid）上失真，2026-10 收编后真清零，新增即机器回退" | `卡片型` | - |
| "三范式各有边界，禁止混搭：卡片=（含 `stg-grid` 平铺的同族小卡，如路径/字体/鸣谢）；选择器瓦片=`theme-card`（主题六选一，已在 `.theme-picker` 内）；紧凑单控件=`settings-group`+`setting-row`（滑块/下拉/开关，以及键位动作行）。键位是快捷键单值，不得为每个动作嵌套一张 `stg-card`" | `stgCard()` | - |
| 各视图层自己判断模式 | - | 状态分裂、拖拽行为不一致；必须经 workshop-browse-mode 单点 |
| site 拖拽排序未回写 workshop-data | - | 刷新丢失；必须经 events.ts 的 drag 事件统一落盘 |
| 页面 A 直接调用页面 B 的 init | - | 重复初始化 / 订阅泄漏；必须经 nav:changed 单点分发 |
| subscription-bucket 未退订 | - | 跨页残留监听、状态串扰；每次切换必须 clear 旧桶 |
| 子组件持 *App 字段 | - | 对象级循环依赖、GC 无法回收；必须经回调注入 |
| 回调未正确包装 | - | 空指针 panic；必须在新 App 时注入完整包装 |
| 新 JS 未登记进 app-modules.ts | - | 组件不加载、Shadow DOM 未升级；必须在 app-modules.ts 加入口 |
| 主题值未归一化 | - | 脏值污染 localStorage 持久层；必须经 normalizeTheme 白名单过滤 |
| 页面 A 直接派 nav:changed | - | 与 app-nav 状态分裂、高亮错位；必须经 app-nav 派发 |
| 折叠态未持久化 | - | 刷新恢复宽版；必须经 safeSet 落 localStorage nav_collapsed |
| 手写 .(ysm\|zip\|json) 判定 | - | .7z 漏判、注册表变更不同步；必须经 matchTypeByExt(RESOURCE_TYPES.YSM) |
| async 窗口期无 container.isConnected 守卫 | - | 组件卸载后异步回调写已卸载 DOM；每个 await 后必须检查 isConnected |
| 找 | `详情卡里的 3D 按钮` | ADR-253 D7 已全部删除；3D 入口唯一为左下角 nav-fab（app-nav 的 .nav-viewer-fab） |
| events.ts 里直接调 PushSingleResource | - | 绕过排队，并发冲突；必须经 runPush/runPull |
| 去重状态机未复位 | - | 拖拽导入重复触发；宿主必须实现 SidebarHost 并复位 lastEmittedPkg |
| 各列各自查询同步状态 | - | 状态不一致、并发冲突；必须经 _gen 单点生成 |
| 同步操作未进队列 | - | 并发 push/pull 冲突；必须经 sync-manager 排队 |
| 手写 toast 浮层 | - | 与全局反馈样式不一致、缺撤销按钮；必须复用 toast-ms |
| toast 未设置防重入 | - | 快速触发多个 toast 重叠；必须挂防重入锁 |
| bus 订阅未进 _unsubs | - | 组件卸载后监听泄漏；必须经 bindBusEvents 返回的 unsub 数组收集 |
| DOM 委托事件进 _unsubs | - | disconnect 时重复 off 报错；DOM 委托事件应靠 ShadowRoot detach 自动清理 |
| 文件行 key 与选中态路径必须同源（entryKey）：TreeRow.key 取树内拼接路径而 selectState.keys 取磁盘路径时，indexOf/has 恒失配且**不抛错**——Shift 范围选择、右键批量、键盘导航、全选、双击重命名定位 6 处一起静默失效（ADR-222） | - | - |
| 渲染层禁止值依赖 loader.ts：多个组件测试 vi.mock("./loader.ts") 只为替换 loadEntries，值导入会让渲染崩在 mock 下（entryKey 因此独立成 entry-key.ts） | - | - |
| 事务不接线 error/abort | - | Promise 永不 settle，读操作卡死 |
| 隐私模式下 IndexedDB 受限，必须自动降级到内存 Map（200 条/64MB FIFO） | - | - |
| db.onversionchange 触发后 dbPromise 为空，后续所有操作立即失败；必须在降级路径中处理 | - | - |
| Proxy.then 陷阱：若 thenable 检测误判，浏览器会按 Promise 处理返回结果，导致链式调用崩溃 | - | - |
| idbKeys 前缀扫描边界：prefix+U+FFFF 语义是，写错范围会漏键 | `以 prefix 开头的最大可能字符串` | - |
| FSA 授权恢复：restoreFsaRootHandle 只 queryPermission，禁止 requestPermission（启动期无手势会被拦截） | - | - |
| zip 导入双阶段分组：先粗分组再主文件目录收敛，若跳过会导致路径混乱/组名歧义 | - | - |
| 内存 Map 驱逐 FIFO 近似 LRU：命中当前 key 时移到队尾，但未访问的旧 key 仍在内存中 | - | - |
| 隐私模式下 IndexedDB 受限，必须自动降级到内存 Map（有限制：200 条/64MB FIFO） | - | - |
| idbKeys 前缀扫描边界：prefix+'\uffff' 语义是，不能写错范围否则漏键 | `以 prefix 开头的最大可能字符串` | - |
| 日志环写入 fire-and-forget：不 await，不阻塞主流程；若需要一致性需改架构 | - | - |
| 3D/预览 binding 缺失：网页版 ReadFileBytesBatch、GetPackInfo、FindPreviewImage 等可能未实现，依赖 'Foo' in browserAdapter 探测 | - | - |
| 业务模块禁止直 import "@wailsio/runtime"；统一经此桥 | - | - |
| Web 模式 Events.On 返回空函数（no-op）；Emit 返回 Promise，resolve 值恒为 false | - | - |
| Web 模式 Window 用 Proxy 动态捕获任意方法（返回 async no-op）；thenable 探测陷阱：返回 undefined 防 await 挂起 | - | - |
| 网页版 Events/Window 无原生后端，须 no-op 兜底，否则 OpenDevTools 等会抛 / 行为漂移 | - | - |
| 网页版直调 window.go | - | 无 wails runtime 时报错；必须经 browserAdapter |
| 跨域资源共享不处理 COI | - | SharedArrayBuffer 等 API 不可用；必须设置 cross-origin-isolation 头 |
| adapter 手写骨骼树 | - | 与 bone-tools 输出不一致、缺骨骼显隐控制；必须经 buildBoneTree |
| VRM 骨骼映射未走 vrm-bone.ts | - | 骨骼名不匹配、动画错乱；必须经 vrm-bone.ts 映射 |
| 消费方禁止重复实现 can(binding) 三态矩阵——统一走 can()，platform-web.ts 的 canBinding() 是唯一判定源 | - | - |
| VIEWER_WEB_ACTION_BINDINGS 仅声明；can() 三态判定逻辑不重复 | `哪些 action 在 web 上可达` | - |
| VIEWER_PURE_ACTIONS 纯前端恒可达（DOM/剪贴板/下载已下沉 utils/dom），不依赖 can() | - | - |
| "在函数内部把箭头回调拆成小箭头 | - | 认知复杂度**不降**（未命名箭头计入外层具名函数）" |
| "--files 用空格拼接传参 | - | 被当成单个路径，scopeFilter.requested=1、扫 0 文件静默假绿" |
| "把 debt 档 FAIL 当成推送被拦 | - | gate 只在 hard 档阻断，debt 只记录" |
| "为把 p6 压到 p5 硬塞语义无关形参进 options 对象 | - | 为过闸而扭曲 API" |
| 前端手写分类 | - | 与 Go classify 判定不一致、last-wins 裁决丢失；必须交 Go 分类 |
| 新增资源类型未更新 priority | - | 冲突时优先级错乱；必须经 classify.go 的 priority 表 |
| 各组件各自发下载请求 | - | 并发冲突、进度丢失；必须经 download-queue 排队 |
| 镜像源未走 gh-links | - | 下载慢、镜像不可用；必须经 gh-links 的 CDN 分流 |
| 前提：定高行；不等高布局（如创作者卡片网格）不适用 | - | - |
| 零高度（jsdom / 首帧 clientHeight=0）→ 自动降级全量渲染 | - | - |
| 全量渲染阈值：低于  不值得虚拟化 | `FULL_RENDER_THRESHOLD` | - |
| listEl 上方有 header/队列状态等区块时，listTopOffset 自动补偿 | - | - |
| destroy 必调：移除滚动监听 + 清空容器，防内存泄漏 | - | - |
| 内联菜单结构 | `view 层` | 必须声明进 menu-defs.ts |
| file/dir handler 各用 FileCtx/DirCtx（Omit 掉对立字段）；dir handler 读 ctx.path→编译报错（P2-1 表级窄化） | - | - |
| core 里直 import backend | - | 违反 ADR-189 D1 断环；落盘通道必须注入（backend/diary-sink.ts 适配 AddOpLog） |
| 注册不幂等 / 失败不回滚 | - | 重试叠加监听，同条 toast 落两遍日记 |
| 注册失败 catch 后 fall-through 重新占位 currentHandle | - | 僵尸句柄致模块永久静默失效（回滚须返回空 handle、不占位） |
| 日记写入失败外溢 | - | 必须 try/catch 兜底，不影响 toast 链路 |
| Go AppError 文案（/`目标路径：`全角冒号 token）变更须同步 fixture + stripAppErrorPaths 正则（双侧测试钉契约，ADR-207 D2） | `源路径：` | - |
| 已不是完整事实 —— 另有 outbox 第二通道 + `GetLogChannelHealth` 锁存位 + 诊断页红条（ADR-322）；只留 console 等于元失败留在 GUI 不可见区 | `sink 失败只 console.warn` | - |
| 元失败层（通道自身失效）**禁** /`logError`/`pushToDiary` 收编 —— 那会经 sink 回到 `AddOpLog` 失败处，构成跨 microtask 无限循环（不栈溢出，静默烧 CPU）；此类处一律裸 try/catch 静默 + 锁存健康位（ADR-322 D2） | `logWarn` | - |
| swallowError 吞掉业务异常 | - | 静默失败、无法排查；必须用于"预期内可忽略"的错误 |
| swallowError 异常仅记日志不抛出 | - | 调用方无感知；生产无 console 时须靠 log.ts setLogSink 接日志 |
| 误判——须读内容判是合理扩展还是失控（见「数文件数 ≠ 债」） | `文件数变多 = 债恶化` | - |
| check-deadcode-baseline 默认模式会自动收编写基线，只读务必带 --json | - | - |
| check-doc-drift 的 ARCH_DOCS 若指向已删文档 | - | archText 空 → unregistered 虚报全部模块 |
| 有未治新债时误用 --update-baseline 会把债冻结进账本 | - | - |
| 手写 adv-filter 弹窗 DOM | - | 与全局弹窗样式 / 焦点陷阱不一致；必须复用 modal.ts 的 registerDlg |
| adv-filter 输入不校验就提交 | - | min > max 传后端报错；必须在 validate() 拦截并在 |
| 重复打开 batch-rename 不 close | - | 上一个 Promise 悬挂、调用方 await 卡死；必须先 close 结算 |
| 正则替换不分离扩展名 | - | 把 .ext 一起替换掉；必须只对文件名主体替换 |
| 弹窗 Promise 只 resolve 不 reject：取消/关闭一律返回 null/false，调用方无需 catch | - | - |
| registerDlg 前必须先把 overlay append 到 document.body，顺序颠倒会导致 trapFocus 失效 | - | - |
| 新弹窗打开时旧弹窗会被自动结算（cancelClose），调用方不可依赖语义判断结果 | `用户主动关闭` | - |
| modalProgress 的 closable=false 时，Esc/遮罩点击/android back 均不关闭，必须由代码显式调用 handle.close() | - | - |
| modalPicker 的 footerHTML 由调用方负责转义；bodyHTML 同理，禁止直插未 esc 的字符串 | - | - |
| closeDlg 经 WeakSet(_closingOverlays) 防重复触发，同一弹窗再次调用会静默跳过 | - | - |
| 测试中必须 afterEach 调用 __resetModalStateForTest() 清槽位，否则跨用例残留状态污染 | - | - |
| 重命名不校验非法字符 | - | 后端 RenameFile 报错 / 文件名含控制字符；必须在校验阶段拦截 |
| 读取 YSM 头部后按钮 loading 态未 finally 恢复 | - | 用户卡死；必须在 finally 恢复按钮态 |
| 手写 tag-editor 弹窗 | - | 弹窗样式 / 焦点陷阱与全局不一致；必须复用 modal.ts |
| 标签写回用直写 tags.json | - | 并发写破坏文件；必须经 go/tags Store 的 tmp+os.Rename 原子替换 |
| Android 无目录选择器（Wails V3 dialogs_android.go 拒绝、SAF 亦废弃）→ 只能授权检查 + 自动定位公共仓库目录，勿指望对话框 | - | - |
| 网页版无系统目录对话框（browser adapter 的 SelectDirectory fail-fast 抛 WebUnsupportedError）→ 只定位虚拟根，勿调用桌面专属对话框 | - | - |
| WebView2 特殊性：dragover 读不到文件名；drop 用 webkitGetAsEntry；entry.file Promise 化；DataTransferItem 无 name | - | - |
| FileReader 无超时兜底 | - | 大文件读取卡死（已修复：10s 超时 abort） |
| base64 为空（0 字节文件）时跳过，不落库 | - | - |
| isImportableFile：.json 仅放行 ysm.json 入口清单（与 go/scanner/scanner.go 白名单对齐） | - | - |
| readEntries 分页：Web 标准 API 单次最多返回 100 条 FileSystemEntry，必须循环调用直到返回空数组才读完目录——单次调用会静默漏掉第 101+ 个文件（ 已收敛为 `readAllDirEntries` 循环读取，`1cd8e305`） | `features/import/collector.ts` | - |
| 各组件各自注入 style 标签 | - | 多次注入、样式冲突；必须经 ensureFabStyles 一次注入 |
| FAB 挂 document.body 但样式在 Shadow DOM | - | light DOM 按钮不继承；必须经 ensureFabStyles 注入 head 标签 |
| 裸调 localStorage | - | 隐私模式抛异常、启动链中断；必须经 safeGet/safeSet |
| safeSet 不带 fallback | - | 存储禁用时静默失败；必须在 safeSet 中设 fallback 或 try/catch |
| 用原生 title | - | 延迟 ~1s、样式不可控；必须经 tooltip.ts |
| tooltip 不监听跨 Shadow DOM | - | FAB 按钮无法接 tooltip；必须经 document.body 挂载 |
| ADR-039 §2.2 Events.On 豁免：模块顶层注册 4 组 Wails Events.On 无对应 Off（app 级单例，_registered 守卫防重复注册） | - | - |
| 非 app 级模块禁止复制此模式 | - | - |
| isActiveStatus 必须同时认 "downloading" 和 "enqueued"（Go 端入队后只发 enqueued，从不发 downloading）；UI 控制器 run/ended 分支同样走 isActiveStatus，勿再裸比较单字符串（2026-09 修复：idle→enqueued 直跳曾跳过 run 分支致按钮不 disable） | - | - |
| remaining 所有权归 Go file-start 载荷（pos/left 语义，——末文件 left=0），**前端 file-done 禁止本地递减**：递减会在「本文件 done | `internal/app/install/queue.go\|consume` | 下一文件 start」窗口造成假归零，completeTimer `remaining>0` 守卫被击穿 → 批次中途假完成提前收口（2026-09 实证证伪「死代码」推断的教训）；done/cancelled 事件前端强制 remaining=0 仅限收口清残值 |
| 队列收口 onAllDone 载荷的 errorList 必须是 getStateSnapshot 拷贝（与 onTimedCompletion 路径防御级对齐），活体引用会静默污染 STATE | - | - |
| web 下载入库上限 50MB（WEB_DOWNLOAD_IDB_LIMIT），超限回退浏览器直链 | - | - |
| fetch 15s 超时兜底（WEB_DOWNLOAD_FETCH_TIMEOUT_MS），防挂起服务器永久卡队列 | - | - |
| 4MB 确认 / 10MB 拒绝 双阈值策略（含边界值本身需确认） | - | - |
| NaN / ±Infinity 大小一律 reject（数值守卫范式，防误判 ok 直接下载） | - | - |
| m.size 哨兵 -1 处理：Content-Length=-1 | - | size 置 0（P4 修复：\|\| 0 会把 -1 当真值） |
| saveDir 留空：由 download-queue-store enqueueDownloads 从根反解 webType 写入 | - | - |
| 探测不穿透 Shadow DOM | - | - |
| 截图穿透 Shadow DOM | - | - |
| 假绿灯三重门 | - | - |
| 单变量对照实验 | - | - |
| readPixels 需自建 renderer | - | - |
| once off 错对象 | `bus.off(event, 原fn)` | 用 once 返回的 unsub 函数取消 |
| Windows 下 pnpm/npm 是 .cmd 垫片——execFileSync 直调 ENOENT，必须 shell:true（本卡 run() 已封装） | - | - |
| npm ci 真跑会清 node_modules——本地预演必须 --dry-run | - | - |
| Wails 应用本地 GOOS 交叉编译受 CGO 限制不可行——跨平台执法只能走静态 import 检查（ADR-318 D3） | - | - |
| lockfile-frontend 检查假红排查：先手动  看真实报错 | `cd frontend && pnpm install --frozen-lockfile` | - |
| 离屏 Canvas 不释放 | - | 内存泄漏、连续截图卡死；必须在完成回调里 release |
| blob URL 不 revokeObjectURL | - | 浏览器内存累积；导出 / 失败分支都必须 revoke |
| 展示端豁免仅限，触及磁盘 I/O 或归属语义重算即越界 | `内存全量 entries 的展示层收窄` | - |
| 绑定命令漏  会产出 `.js` 并清掉 git 跟踪的 `.ts`（回归红线） | `-ts` | - |
| 跨类型切换误用 （同源替换才走它） | `switchTo` | - |
| 三套门禁同号异策——R5 在 check-layering 是 seam 红线、在 check-path-hygiene 是同目录别名提示，勿混（见下方对照表） | - | - |
| core 测试文件同样受 check-layering R6 约束（引擎无关对 type 感知不成立） | - | - |
| HTML 字面量存量在 baseline 只减不增，触碰即顺手收敛，新增即红 | - | - |
| 目录层级变动后,vi.mock 字符串路径与 import 同步重算(ADR-170 实测:非 import 语句正则扫不到 mock 路径变更) | - | - |
| modal-core.ts VIEW_TESTIDS 是契约测试静态聚合的单一事实源,增删 data-testid 必须同步本数组,否则契约测试静默漏检 | - | - |
| tag-editor.ts 标签建议列表未做去重,上游标签集含重复时 UI 会渲染重复条目(已知限制,非 bug) | - | - |
| batch-rename.ts 批量改名失败时 TOAST_MS 显示错误但 bus 未 emit tree:reload,需手动触发刷新 | - | - |
| adv-filter.ts keyword 字段 trim 后为空串时 Go 侧视为无关键字过滤(非报错,静默降级) | - | - |
| 手写 JSON 路径 | - | 与 Go appendAnimGroupsAndConfigs 语义不一致；必须经 extractAnimGroupsAndConfigs |
| 加密模型 properties 不可读 | - | 动画分组丢失；必须经 WASM 解码后读取 |
| 黑话已从 mount-preview-core 扩散到全部内容适配器与测试（litematic-adapter/fbx-parser/pack-model-adapter + mmd/vrm/fbx/litematic 测试），ADR-161 §2.3 只划了 mount-preview-core 内部，划界过窄——重命名治理必须按「文件族」整体扫，不能只治感染源 | `built` | - |
| 私有缩写前缀（MdLi*/dgPc*/si）是命名空间缺失的补偿：符号可 grep 得到归属却读不出语义，搜索/「阶段解析」全落空 | `尺寸信息` | - |
| 单字母业务量（w/h/l、b、v、m、d）比缩写更隐蔽——类型是 number 不携带语义，w/h/l 三个单字母挤一行只能靠顺序猜 | - | - |
| 生命周期动词家族一义多词（dispose/destroy/unload/unmount/detach/remove/close/clear/cleanup 等全仓 1683 次），同语义多动词 = 语义边界未定义 | - | - |
| ysm-header.ts extractYsmSummaryFromBytes 失败返回空 YsmSummary 而非 reject(对齐 Go app 层吞错误契约),消费方不得 expect throw | - | - |
| voxel-io.ts decodeVoxelNbt / nbt-parse.ts parseNbtRootExact 使用 bigint 处理 LongArray(>2^53 精度损失),勿替换为 number | - | - |
| nbt-parse.ts parseNbtRootExact 与 parseNbtRoot 二选一:精确版(64 位 long)用于体素解码,标准版用于普通 NBT | - | - |
| pack-meta.ts 依赖 resource_types.json 派生的 extensions,改类型配置须同步更新 pack 探测逻辑 | - | - |
| pack-meta.ts findZipEntry 对 entries 全量线性扫描(大小写不敏感),超大 zip 可能慢,web-fs 侧有 maxMaterializeBytes 512MB 封顶防护 | - | - |
| extract.ts detectContainerType 走中央目录口径(parseZipCentralDir),勿回退 LFLH 游走(data descriptor/zip64 漏条目,Go 侧明令禁用) | - | - |
| voxel-colors.ts resolveBlockName 映射表来自 voxel-colors-data.json(63K),新增方块名须更新 JSON 而非硬编码 | - | - |
| ADR-170 二段部分收口(2026-09):base64 原语已归位 utils/base/primitives/base64.ts, parsers 对 backend/web-common 依赖已消除;web-* 族其余归位未动 | - | - |
| 本卡是横向拼图，单环纵深细节读 pre-commit-hook / pre-push-gate 两卡；勿用本卡替代细读 | - | - |
| 判定必须看它所在清单的 blockPolicy（hard/debt/failClosed），FAIL 非空 ≠ 被拦 | `某检查项是否真阻断` | - |
| 注释与知识卡的曾三处口径不一（钩子写尚未、同卡两行一写已接线一写尚未）；判断现状只认 .github/workflows/test.yml 实况 | `CI 是否同跑 gate` | - |
| 各页面各自注册全局事件 | - | 重复绑定、冲突处理；必须经 global-handlers 单点 |
| 拖拽导入未进 import-dnd | - | 与全局拖拽状态冲突；必须经 features/import-dnd.ts |
| 陷阱：Android 上 xdg-open/exec 链静默失败会掩盖问题 | `静默成功` | 必须返回含「请手动」提示的明确错误 |
| 陷阱：watcher 守卫缺失时，fw.Add 逐目录失败后 loop 空转 = running=true 假活；Android 必须直接跳过 | `假活` | - |
| 陷阱：把 RevealInExplorer/OpenFolder 等绑定全部 false | `一刀切` | 应仅在 ANDROID_UNAVAILABLE 黑名单内才禁 |
| 陷阱：误引入 SAF/URI 桥 | `content:// URI` | SAF 已弃用，禁止复活 |
| 陷阱：平台差异大的逻辑用 runtime.GOOS 分支 | `build-tag 混用` | 应用 build-tag 双文件保证编译期隔离 |
| 陷阱：Android 沙盒私有目录与公共仓库根混用 | `路径管理混乱` | androidPathManager 严格分离 |
| 陷阱：Go 新增桌面专属拒绝项未同步 platform-web.ts | `前端/后端黑名单不同步` | 三谓词测试 platform-parity.test.ts 会爆 |
| 陷阱：Android 上调用 os.Executable + exec.Command | `重启假设` | Activity 生命周期不兼容，显式拒绝 |
| 跨扩展名混用提取逻辑 | - | 解析失败、抛异常；必须按扩展名分发 |
| 测试环境三件套（nodeJSPath / glueCode / wasmBinary）为空 | - | 静默降级空列表；必须在测试里 mock 三件套 |
| DecodeYSMFiles 已退役（ADR-164 后彻底删除，非薄封装）——新代码必须用 DecodeYSMData，grep 旧名仅命中历史 ADR/注释 | - | - |
| 手写头像路径拼接 | - | 越权路径穿越、缓存污染；必须经 isSafeAvatarPath 校验 |
| zip/7z 容器打开统一走 openModelContainer（avatar_extract_container.go，2026-09-06 收口孪生函数）——批量缓存未命中会打日志（非静默吞错） | - | - |
| 头像缓存不失效 | - | 换头像后仍显示旧图；手动 `avatar purge` CLI 清空重建（P1-2 落地 2026-09-14），自动失效（ModTime 键）留待后续 |
| CLI 手写搜索 | - | 与 GUI 搜索结果不一致、参数不统一；必须复用 go/cli 的 SearchModels |
| runSearch 未传范围参数 | - | 数值筛选失效；必须完整传 6 个范围参数 |
| 多处读配置 | - | 值不同步、重启后部分组件用旧配置；必须经 LoadAppConfig |
| 配置项未加默认值 | - | 缺失时 panic；必须为所有配置项设默认值 |
| 手写 zip 内枚举 | - | 与 go/container 判定不一致、多 entry 漏检；必须经 go/container |
| 未处理 7z 格式 | - | 容器解析失败；必须经 go/container 的格式分流 |
| "包覆盖率必须按语句数加权（covered 语句/总语句）；曾用 | `文件内函数百分比最小值` | 一个 0% 函数把整包报成 0%" |
| "判据是 profile 原文的语句数； 输出只有百分比、没有语句数，做不了加权" | `go tool cover -func` | - |
| "阈值 pattern 匹配的是包路径（以包名结尾、无尾斜杠）， 这种尾斜杠写法永远匹配不到该包自身" | `internal/app/install/` | - |
| "本脚本用具名导出供契约测试 import，退出必须用 process.exitCode + 自然返回；用 process.exit(N) 会在 Windows 句柄清理阶段触发 libuv 断言（0xC0000409）" | - | - |
| "入口包（根 main / cmd/updater / 代码生成器）的 main() 测试内不可达，必然 0%，应进 SKIP_PACKAGES 而非当失败" | - | - |
| 手写去重比较 | - | 与 go/dedup 判定不一致、漏检；必须经 go/dedup |
| filepath.WalkDir 跟符号链接 | - | 目录遍历循环；必须跳过 ModeSymlink 条目 |
| 下载不校验 checksum | - | 静默损坏文件；必须经 ErrChecksumMismatch 拦截 |
| 部分响应未识别 | - | 后续续传逻辑失效；必须经 ErrPartialResponse 分类 |
| 直调 os/exec 不带隐藏标志 | - | Windows 子进程闪控制台窗口；必须经 HideWindow |
| Unix 平台 HideWindow 未 no-op | - | 编译失败；必须在 build tags 中区分平台 |
| ysm.json 单文件改名/删除/禁用 | - | 散架；必须整组操作父目录（MoveModel 按文件夹） |
| 禁用走 .ban 后缀（整目录重命名 + .ban），启用反向操作 | - | - |
| 删除操作必须走回收站（go/recycle）而非直接 os.Remove | - | - |
| 文件移动/复制必须走 fsutil.AtomicWriteFile / CopyFile 原子操作 | - | - |
| 路径穿越攻击防护：filepath.Clean + filepath.IsAbs + containsRoot 三重守卫 | - | - |
| ysm.json 整组操作时 ysm.json 文件本身不能改名（清单文件名固定） | - | - |
| 移动/复制大文件夹时需进度回调——同步操作可能长时间阻塞 | - | - |
| 业务代码直调 os.WriteFile | - | 并发写破坏文件、缺 BOM 处理；必须经 fsutil.AtomicWrite |
| filepath.Walk 跟符号链接 | - | 目录遍历循环 / 越权；必须用 fsutil.walk 的 IsRecycleDir 守卫 |
| 直接 unzip | - | 7z 未支持、纹理提取缺路径安全；必须经 go/geometry |
| 未走 ysm_parser.go | - | .ysm 解析不一致；必须经 go/ysm 兜底 |
| 直写目标文件 | - | 中断留下半文件；必须经 WriteFileAtomic 的 tmp+rename |
| 未走 DetectContainerType | - | 误判 zip 类型、解压错误；必须先 DetectContainerType 分流 |
| 手写落地逻辑 | - | LinkMode 不一致、ERROR_NOT_SAME_DEVICE 未处理；必须经 go/installer |
| 落地不原子替换 | - | 中断留下半文件；必须经 installer 的原子替换 |
| app 层手写同步 | - | 与 go/instance 判定不一致；必须经 SyncResources |
| BuildSyncItems 未去重 | - | 重复同步同一资源；必须在 BuildSyncItems 里做去重 |
| 前端手写 Litematic 解析 | - | 与 Go 解析结果不一致、palette 映射错误；必须交 Go 解析 |
| 未走 bedrock.go 做基岩版转换 | - | voxel 位置偏移；必须经 bedrock.go 转换 |
| 直接 os.WriteFile | - | 并发写破坏日志；必须经 WriteFileAtomic 原子追加 |
| 日志未轮转 | - | 单个文件无限膨胀；必须经日志轮转策略 |
| 已不是完整事实 —— 另有 `Health()` 锁存位 + `[meta]` runtime 环保底（ADR-322 D1/D3）；只 log.Printf 等于退回元失败盲区 | `落盘失败只记系统 log` | - |
| 裁剪逻辑在 op 环与 runtime 环各写一遍 | - | 两处实现漂移一次即产生「op 环保底而 runtime 环不保底」的半修静默态；一律走 `ring.go` `trimRing` |
| 前端手写 mcmeta.json 解析 | - | 与 Go 解析字段不一致、漏检 pack_format；必须交 Go 解析 |
| 未限制 LimitReader/maxLangSize | - | 大语言文件 OOM；必须用 LimitReader 截断 |
| 手写路径安全检查 | - | 越权路径穿越、符号链接绕过；必须经 IsInside |
| 符号链接未解析 | - | 路径穿越绕过 IsInside；必须用 IsInsideResolved 处理符号链接 |
| 符号链接/硬链接直接删除（deleted_link）而非移入回收站——手搓删除逻辑会破坏链接语义 | - | - |
| 回收站清理必须保留原路径结构（相对路径扁平化会导致恢复时路径冲突） | - | - |
| 软删除 vs 硬删除：.recycle 目录下的文件仍可被扫描到——需排除 .recycle 目录 | - | - |
| 恢复操作必须校验目标路径是否已存在——冲突时追加序号后缀 | - | - |
| 回收站空间上限（配置项）超限时自动清理最旧条目 | - | - |
| 跨设备移动（硬链接失效）时回收站中的条目变为独立副本 | - | - |
| 批量清空回收站时需注意文件锁定——被占用文件跳过不报错 | - | - |
| 容器指纹缓存失效需调 ClearScanCache——文件变更后不失效会导致缓存命中旧数据 | - | - |
| resource_types.json 是唯一事实来源——修改类型定义后必须重新扫描 | - | - |
| ScanEntries 排除 .recycle 目录——换用不排 .recycle 的 scanFn 会重新引入误判 | - | - |
| ScanEntriesWithHit 缓存 30s TTL——频繁扫描会反复重算 | - | - |
| 作者提取依赖模型文件中的 metadata.authors 字段——缺失则作者为空 | - | - |
| 单文件 >500MB 跳过哈希计算——同步对空哈希跳过匹配 | - | - |
| Go/Rust 双扫描器口径必须一致——parity_test.go 锁三条谓词 | - | - |
| app 层手写同步 | - | 与 go/sync 判定不一致、冲突未处理；必须经 go/sync |
| 同步不做 hash 校验 | - | 文件变更未检测；必须经 sync_hash 校验 |
| 标签以文件绝对路径为 key——移动文件后旧 key 的标签丢失 | - | - |
| tags.json 写入走 tmp + os.Rename 原子替换——直写会导致读取时读到半截数据 | - | - |
| Store 懒加载——首次 GetTags/SetTags 时才读盘，之前操作不触发 IO | - | - |
| SetTags 自动 trim/去重/排序——传入重复标签不会报错而是去重 | - | - |
| ListByTag 返回路径是排序的——不保证与原始写入顺序一致 | - | - |
| tags.json 损坏时 Store 会创建 .corrupt 备份并返回空 Store | - | - |
| AddTag 已存在则跳过——不会报错也不会计数 | - | - |
| 前端手写骨骼转换 | - | 与 go/threejs 输出不一致、四元数旋转错乱；必须经 spec.go |
| spec 字段漏转换 | - | 骨骼变形丢失；必须完整覆盖所有 spec 字段 |
| "golden 必须双端互锁：Go 测试 + TS 测试读同一份 fixture，只做 web 单侧对拍是死快照，防不住 Go 侧漂移（ADR-154 §2.2 硬性要求）" | - | - |
| "matchZipEntryTS 是注册表顺序首命中、忽略 priority；Go MatchZipEntry 同构，但容器级 detectZipType 走 priority desc 裁决——两者不可直接对拍（ADR-154 §2.4）" | - | - |
| "TS 测试读仓库根 fixture 不得用 import 语句（ADR-146 R4 冻结基线会 FAIL），须用 readFileSync + process.cwd() 向上定位" | - | - |
| 复制类型定义 | - | 类型不一致、重构时漏改；必须经 go/types 单点 |
| LoadRegistry 失败未兜底 | - | 启动崩溃；必须在 LoadRegistry 里做默认值兜底 |
| 手写更新下载 | - | 与 go/updater 的增量 / 全量策略不一致；必须经 go/updater |
| 更新未完成前继续操作 | - | 半更新状态、启动失败；必须等更新完成再操作 |
| 多处手写版本号读取 | - | 版本不一致、UI 显示与后端实际版本脱节；必须经 LoadVersion |
| 版本号变更未同步 | - | 版本检测失效；必须在发版时更新 go/version |
| 轮询文件系统 | - | 延迟高、CPU 浪费；必须经 go/watcher 事件流 |
| watcher 未读 errs/done 通道 | - | goroutine 泄漏；必须 drain 通道 |
| 前端手写 YSM 解析 | - | 与 Go 解析结果不一致；必须交 Go 解析 |
| 跳过 ExtractYsmSummary 走全文解析 | - | 详情展示性能差；摘要必须复用 |
| 全量跑会撞 736 条存量债 | `全量跑会撞 736 条存量债` | 门禁只能跑 `--new-from-rev`，全量必红（errcheck 623 占 85%），存量清零另案 |
| 未安装不是失败 | `未安装不是失败` | pre-push 检测不到二进制时降级 debt 跳过，不阻断；安装走 `go install github.com/golangci/golangci-lint/v2/cmd/golangci-lint@latest` |
| 无基线 rev 不是失败 | `无基线 rev 不是失败` | 孤儿分支/无远端时解析不出 merge-base，同款降级跳过，避免存量债堵门 |
| 别开 enable-all | `别开 enable-all` | 一次性抛数百条历史债直接堵死 push 通道；白名单只收 6 类零覆盖 linter |
| 别启用 govet/gofmt/dupl | `别启用 govet/gofmt/dupl` | govet 与既有 `go vet` 重复；gofmt/dupl 自研机制有自动 stage 与漂移账本，golangci-lint 接不住（ADR-205 §2.2） |
| 版本 < v1.64 解析 go1.26 directive 直接失败 | `版本 < v1.64 解析 go1.26 directive 直接失败` | 必须 v1.64+ / v2.x，实测 v2.13.2 built with go1.26.3 通过 |
| 手写菜单结构 | - | 与 buildGroundNodes 输出不一致、菜单构建重复；必须经工厂函数 |
| 新增地面模式未走工厂 | - | 菜单缺控件；必须在 ground-menu.ts 中注册 |
| 滑杆值域字面量写进菜单 | - | 与 schema 漂移（改一处不生效）；ADR-283 起值域只从 `getParamRange(key)` 取 |
| 下游手写材质参数 | - | 与 spec 不一致、needsRebuild 判别错误；必须经 buildGroundSurfaceSpec |
| specKey 不完整 | - | 相同材质不同渲染；specKey 必须含所有影响渲染的参数 |
| 控件参数未进入像素生成 = 死控件：叠加层初版 `generateOverlayPixels` 硬编码 `sizePx/8` 且不设 `map.repeat`，滑杆可拖、会触发重建、产出却完全相同。ADR-249 §2.4 矩阵约束：渲染消费的参数菜单必须可见，反之亦然——控件参数必须真实参与像素/材质 | `叠加格数` | - |
| 在生成器里 import three 或 DOM | - | 破坏 node 单测与 src/core 隔离边界 |
| 改像素算法却不更新 ground-surface-spec.test.ts（确定性/非均匀/跨材质差异用例） | - | - |
| 误以为 surface-pixels 管 spec/key —— 那些仍在 ground-surface-spec.ts | - | - |
| 在生成器内对坐标做 2D 旋转来施加 angleRad | - | 破坏 4D 环面周期，平铺露接缝。angleRad 必须走 tiledFbm 的「环面相位偏移」（任意角度无缝）；整体旋转归 GPU texture.rotation |
| 把当成「无重复」——**4D 只治接缝，不治重复**。平铺后「每两米出现同一明星特征」是「无缝但有规律重复」，须用 `anti-repeat.ts` 的 macro/dual/stochastic 治理 | `4D 环面无缝` | - |
| anti-repeat 的输入 tile **必须本身无缝**（周期=S）；非无缝输入它不补接缝，只治重复。本项目的程序化材质（tiledFbm）与已平铺无缝的 PNG 满足 | - | - |
| macro 的  必须退化为原平铺（factor=1 逐像素相等）——改 macro 时此回归用例（anti-repeat.test.ts）会锁死 | `macroStrength=0` | - |
| 参数值含 $&/$1 等特殊正则序列会错译 | - | t() 强制函数型替换 + 键正则转义双保险 |
| LocaleHost 未注入（装配层漏 setLocaleHost）→ loadLocale 告警一次并跳过（fail-open 不挂启动链），host 就绪后可重试自愈 | - | - |
| 并发 setLang 竞态：快请求后到覆盖旧写入 | - | _langReqGen 代际计数丢弃过期写入 |
| getBundle 空对象 truthy | - | 用 isNonEmpty 判空（for-in 早退探针，零分配热路径），否则 BASE_LANG rescue 永不触发 |
| 缺失 key 告警收编 locale.warnMissingKey（每 key 一次；不再导出可变 Set 跨模块共享，ADR-207 D3），发版前须主动扫裸 key | - | - |
| 键名迁移无 legacy-key-map 兼容表；改名须同步改调用点 + 测试 + 三语言包 | - | - |
| FALLBACK_LANG（en，缺失键兜底）/ BASE_LANG（zh-CN，基准包 + getBundle 空包 rescue）双常量在 locale.ts：t.ts 兜底链与 locales-consistency 成员守卫共用，勿另立第三语言常量 | - | - |
| initI18n await 期间 setLang 覆盖写 | - | 恢复后须对账 code === _currentLang 再补发事件，不替写者补发（新语言事件归 setLang 自己 emit） |
| 模板含 {n} 而调用漏传 params | - | 裸占位符上屏；interpolate 残留守卫按签名告警一次（每残留组合一次） |
| 手写 IK 逻辑 | - | 与 babylon-mmd 参考行为不一致、足部漂移；必须经 ik-solver |
| extractIKChainFromTree 未做防环 | - | 骨骼链循环死循环；必须校验 parentId 链防环 |
| 硬编码语义 id 作链根（如 hips）→ MMD 的不保证是大腿祖先，extractIKChainFromTree 直接返回 null ⇒ 整腿静默失效；必须取直接父骨 | `腰` | - |
| 各组件各自调 ImportModel | - | 并发冲突、队列状态混乱；必须经 import-executor |
| dnd-collector 未做去重 | - | 同文件重复导入；必须在 collector 阶段去重 |
| 硬切高内聚复合域会把 App god-object 换成，且连带拉扯共享 helper 的宿主域（伪切分） | `接口版 god-object` | - |
| 包级私有 helper 被多域/多测试直调时，迁移需连带改造测试，成本随调用面放大 | - | - |
| 单文件目录 ≠ 待收敛孤岛（ADR-230 钉死，迁移 = 违反 ADR + 无谓 churn） | - | - |
| ≠「全仓零手搓」——范围性目标非穷举保证，判断干净必须 grep 实证 | `D1/D2 已落地` | - |
| LoadGuard 只管代际不管并发；属并发控制，勿混入 | `单飞 + 尾随补跑` | - |
| 用  / `getMenuNodes()[1]!.children` 位置索引找节点——菜单增删一项全崩且报不出缺哪个；一律 findNodeById | `nodes[3]!` | - |
| 归属写成有序  快照——重排即崩；配集合判据 `.sort()).toEqual([...].sort())` | `map(c => c.id)).toEqual([...]` | - |
| 顺手引入 jest-extended 的 toIncludeSameMembers——仓内无该扩展（vitest ^4 无 setup），成员相等走仓内 sort 集合惯例 | - | - |
| 把 `toHaveLength(N)` 当行为断言留下——计数属档，非产品决策即删或改写成员集合断言；确属产品决策须行内 `// layout-assert: <理由>` | `顺序/计数` | - |
| 把 helper 写回 menu-test-fixtures.ts 复用——它顶层 import preview-state 有副作用， 测试引它即拖整条状态层依赖链（R6 反桶精神）；纯树断言 helper 在 menu-test-helpers.ts 独立叶 | `@vitest-environment node` | - |
| M2 裸包默认只 WARN 不阻断（node_modules 在本仓不完整，fail-closed 会炸环境噪声）；只有 --strict 才升 FAIL，pre-push 不加 --strict 只拦 M1 | - | - |
| bare spec 以 deps 主导、node_modules 只是兜底——新增裸包 mock 前先挂进 package.json deps | - | - |
| 主线程同步跑统计 | - | 大库卡死 UI；必须经 Web Worker 后台统计 |
| Worker 未独立加载 WASM | - | 与主线程 WASM 实例冲突；必须在 Worker 内独立 open 解码 |
| 对同步 ccall 挂死是半吊子（已知问题榜#4 原方案）——挂死点不可抢占，race 的 timer 在阻塞线程里根本不触发；挂死类故障唯一可靠侦测信号 = 逐模型 partial 流中断（ADR-219 静默看门狗） | `5s Promise.race 软超时` | - |
| 手写骨骼画布 | - | 与 model2d 输出不一致、缺鼠标拾取；必须复用 model2d.ts |
| Canvas 不销毁 | - | 内存泄漏；必须复用 renderer 并dispose |
| canvas 内硬编码调色板 | - | canvas 不吃 CSS 变量，亮色主题（warm/sakura/mint）骨骼线对比度 ≈1.06:1 直接消失；须经 themeRgba 实时读 --txt/--accent |
| 坐标口径必须对齐 YSMViewer：pivot X 取反；Go 端为唯一事实源，网页兜底 cube-mesh.ts 逐值同构。旧第二套 JS 兜底 model3d-spec.ts（cubePivot/cubeOrigin 与 Go 不一致）已于 2026-09 删除 | `Fatal trap#11` | - |
| mesh 级视锥剔除必须关闭（mesh.frustumCulled = false），否则骨骼旋转时扁平部件（如脸部）会误判不可见 | - | - |
| dispose 必须完整执行：cancelAnimationFrame、移除 keydown/keyup/pointer/resize/fullscreenchange 监听、dispose geometry/material/texture，缺一即泄漏 | - | - |
| 纹理绑定不得静默兜底：槽位越界/缺图应报错+ 灰色占位，严禁「找第一张可用」贴错图 | `纹理槽位缺失` | - |
| perComponent 纹理索引分类与绑定索引必须同一空间：组件分支恒用局部槽 0（arr === compTexArr ? 0），非组件回退全局 texIdx/resolvedTexIdx | - | - |
| 大文件解码 peak 内存可达 ~3-4× 文件大小（base64 | - | Uint8Array → WASM HEAP → MEMFS → readFile → JSON.parse 六层拷贝并存） |
| 模块级状态收敛前先查测试隔离策略——用 vi.resetModules 重载的模块（locale.ts）收敛无测试收益，只有代码组织价值 | - | - |
| 引用相等分派（ring === webImportLogs）是隐式建模信号——收敛成显式对象能消灭，但改动面大需评估 ROI | - | - |
| 收敛只改内部表示不动导出函数签名（modal 范式）——外部/测试零改动是判据 | `试点成功` | - |
| 模块级 let busy 锁必须有 reset 路径或注释豁免理由（dedup.ts 案例：tab 卸载后 busy 卡 true | - | 再进永久卡死） |
| mount3D 本体仍超 100 行红线 | - | 每加逻辑都会进一步膨胀；新逻辑应先拆为模块级函数（mount-session.ts / shared-infra.ts）再调用 |
| safeDispose 未复用 | - | 重复写释放逻辑、资源泄漏；必须经 safeDispose 原语 |
| adapter 直接遍历 entry 数组 | - | 容器内多模型顺序不稳定、缺用户选择点；必须走 multiModelSelectNode |
| litematic zip 多 nbt 未走 select | - | 默认取第一个，用户无法换选；必须复用 multiModelSelectNode |
| 各页面各自实现评分 | - | 结果不一致、排名错乱；必须经 oldest-models 单点 |
| bus.emit 未带 payload | - | 下游无法渲染推荐卡；必须经 bus.emit 携带完整 payload |
| ❌ 曾漏检三类消费形态，导致活代码被误报孤儿并倒逼出遮蔽性豁免规则（僵尸规则） | - | - |
| ⚠️ 豁免规则超期未清 = 检测器失明；契约测试硬编码条数，删规则须同步 tests/test_orphan_exports_smart.ts | - | - |
| gui_light 是 MC GUI 显示上下文的 front/side 二选一打光开关，不是灯位/强度参数——是范畴错误 | `映射灯位` | - |
| 本产品无 GUI display 渲染上下文，gui_light/display/ambientocclusion 是的死解析数据，不是漏接 | `有意不消费` | - |
| 禁止接入 LightCapability：ADR-282 解耦 + envState source 优先级复写用户设置 + 仅 pack 带此字段跨类型不一致 | - | - |
| 在 page-store 里挂页面挂载 / 卸载逻辑 | - | 与 app-content 重复、状态串扰；必须分开 |
| resolveInitialPage 无回退 | - | 隐私模式读不到 localStorage 时死页；必须经三优先级回退 repository |
| 手写动画注入 | - | 与感知系统控制器冲突、节奏不同步；必须经感知控制器 |
| 节拍检测未缓存 | - | 每帧重复采样音频；必须经 beat-detector 的缓存策略 |
| 混用 mousedown + touchstart | - | 触屏双触发、桌面手势冲突；必须经 pointer events 统一 |
| 拖拽不设 touch-action:none | - | 浏览器滚动吃掉手势；必须在拖拽元素上禁用 touch-action |
| 快照缺失时严禁 git add -u docs/ 兜底（违反 P2-2 并发隔离）→ 仅置 GEN_SKIPPED=1 跳过并告警 | - | - |
| 并发共享 checkout 下 snap_docs mtime 窗口期内并行会话手改 docs | - | 误判为 gen 产物 |
| gen 产物文件路径含空格时 git add 不加引号会断裂 | - | 必须用 git add -- "文件路径" |
| snap_docs 使用 $ 进程后缀生成快照文件路径，Windows Git Bash 下 /tmp 可能不存在 | - | - |
| 智能 stage 的下缀剥离是**最短匹配**（ | `foo.d.ts` | base `foo.d`，探测不存在的 `foo.d.test.ts`）——仓内有真实 `*.d.ts` 故边界是活的；该行为已由 `tests/test_commit_smart_stage.ts` 的「缺陷等价性锚点」锁死，修复须显式改测试（ADR-323 §4） |
| drift --affected 过滤逻辑中 docs/knowledge/index.md 应排除，但其他 gen 产物未过滤可能误报 | - | - |
| 用 `file:line:kind` 键做增量判定 = **高噪声**：行位移被当新增（116 提交窗实测 322/330 = 97.6% 幻影，真新增候选仅 8）→ 必须走真行级 `--added-lines`（ADR-256，`scripts/token-shift-audit.ts` 可复现）；「同行替换同类」会因键相同被判存量（机制性盲区，本窗口实测 0 次） | `只减不增` | - |
| 无 scope 的  扫磁盘全树 | `--baseline` | 判决域 ≠ 提交域（哪怕键设计没问题，也会把并行会话未提交的新债算到本提交头上） |
| 版本防御检查 $ 开头文件名的正则会匹配路径中含 $ 的合法文件 | - | - |
| 改 Promise.all 并行结构漏写 () | - | 域级检查静默不跑（8/17 起 13 项失效实证） |
| push 被拒直接 --no-verify | - | 绕过不留审计；应修 FAIL 项或 git pull 整合 |
| 判定字段写错位置 | - | 门禁静默假绿：`parseToolOutput` 的 `parsed._summary \|\| parsed` 使「`_summary` 存在但无 ok/errors」时短路，**永不回读顶层 `ok`**。三脚本曾把 ok 放顶层且 rc 恒 0（情报型）→ 门禁恒判通过；判定必须写进 `_summary`（`buildScanVerdict`） |
| 只证明清单内检查通过——37 个 check-*.ts 与清单项非一一对应（差额走 pre-commit / CI 旁路，或只挂前端域）。三档位扫描器（complexity / params / type-safety）2026-09-13 才接 FRONTEND_STATIC_TOOLS（debt + --files），`--all` / `--docs` 路径仍不跑；审核/锐评下结论必须附「跑了哪些 + N/37」覆盖率，不可外推为「仓库无风险」 | `门禁全绿` | - |
| `check-design-tokens` 曾长期只挂 pre-commit 硬阻断③，pre-push / CI 均无排查项——而 pre-commit 可被 `git commit --no-verify` 一条命令绕过（CI `--static` 模式的立项目的正是补这一层）。2026-09 补进 FRONTEND/ALL_STATIC_TOOLS（`--baseline` + debt + scopedFiles），与 `css-layer-check` 同等三重防护。2026-09-16 改口径（ADR-256）：FRONTEND 侧由 `--baseline` 换成 `--added-lines`（行级：只判本次推送引入的新增行，range 源 base..head，与 pre-commit 索引源共用 `_lib/diff-source.ts`）；ALL_STATIC_TOOLS 保留 `--baseline`，但那里已是**账本漂移报告**（全库 vs `baseline/design-tokens-baseline.json`），不再参与判定。**新增「只减不增」型闸一律双挂**（pre-commit 拦提交 + gate-config 拦推送/CI），勿只挂其一；但**判定口径别用行号入键**——实测 322/330 = 97.6% 的「新增」是位移幻影（可复算：`scripts/token-shift-audit.ts --window 120`；同上 ADR） | `只挂 pre-commit 的闸 = 单点防线` | - |
| record() 只把 blockPolicy 用于判定 blocked、不写进 results | - | gate-report.policyTag 读到 undefined，**所有 FAIL 的归属标签退化为「本次引入」**（debt 存量债冒充本次引入，AI 会去修不属于自己的问题）。2026-09-13 修复并加行为契约（test_gate_ctx.ts 第 5/9 组） |
| `check-a11y.ts` 2026-09-26 接线（ADR-308 D3）：ALL + FRONTEND_STATIC_TOOLS 双挂 hard——coverage 计数**下限**（aria-* 按属性名 / role / tabindex / prefers-reduced-motion，只增不减）+ scatter **上限**（document 级 keydown 散点文件→次数，只减不增，key-router.ts 唯一出口豁免）。与 layering 同范式但**方向相反**：layering 管违规清单（只减），本闸管覆盖计数（只增）——「下限守卫」型闸同样双挂；`--update` 收紧 / `--force` 放松留痕。hard 依据：确定性正则 + baseline 即存量本身，无存量债冒充；配套 tests/test_check_a11y.ts（纯核直测防空转假绿）。 | `a11y 覆盖基线闸` | - |
| 把「过滤后为空」当错误、把空 --files 静默当全库 | `增量裁剪边界` | 前者让改一版文档/Go 就阻断推送，后者让存量债淹没本次变更；正确口径：scope 目录不存在或无可扫文件 = 用法错误 exit 1，过滤后 0 文件 = 合法 PASS，且 _summary.scopeFilter 须留痕以区分「全库干净」与「不在扫描范围」 |
| 它走 git diff 故不含未跟踪新文件 | `--changed 的边界` | 权威清单走 --files（门禁侧一律传，见 check-redlines / check-doc-drift 先例）；--changed 仅作本地便利，新文件先 git add 或改传 --files |
| 清单声明 scopedFiles:true 但脚本未接 _lib/changed-scope.ts | `scopedFiles 声明与实现` | 双向失真：未识别 --files 报未知参数（exit 1 误阻断），或静默忽略继续全扫（存量债淹没本次变更、接线无声失效）；一致性由 test_gate_config.ts 断言，勿只改清单 |
| `YSM_SKIP_GATE=1` 与 `git push --no-verify` 并列作紧急绕过，但后者零痕迹（钩子不执行）。2026-09-13（锐评 P1）改为**留痕逃生**：钩子 SKIP 路径把待推 ref 写入 `.git/gate-audit.log`（SKIPPED 行），gate 每次 push 运行也追加 PUSH 行（oid+判定+N/M）——审计日志连续性使「无 gate 记录的推送」事后可回溯。`--no-verify` 客户端仍无法检测（git 语义边界），系统性兜底 = CI 同跑 gate 互证。**2026-09-14 已接线**：test.yml 新增「静态治理门禁」步骤跑 `node scripts/pre-push-gate.ts --static --json`（实测 32 项 / 全绿约 18s），补上此前 19 项 hard 静态工具在远端的 0 覆盖；用 `--static` 而非 `--all` 是因为后者会重跑 vite build / vitest / go build+test，而这三件 CI 已各自独立承担，接入即时长翻倍 | `逃生阀审计不对称` | - |
| 2026-09-13（锐评 P1 | `审计对账有工具了` | - |
| 2026-09-13（三锐评 | `审计对账消费位` | - |
| 2026-09-13（三锐评 | `多 ref 审计同构` | - |
| 2026-09-13（三锐评 | `判定口径 A/B/C 收口完成` | - |
| 2026-09-13（四锐评 | `--json 契约真实现` | - |
| 2026-09-13（四锐评 | `--all 刻意不跑三档扫描器` | - |
| 2026-09-13（四锐评 | `reconcile 的 SKIPPED oid 容差` | - |
| 2026-09-13（四锐评 | `_lib 注释死链回扫` | - |
| 2026-09-13（锐评 P2 | `sh/shAsync 执行语义已对齐` | - |
| 2026-09-13（锐评 P1 | `sh/shAsync 调用点安全不变式已落成契约` | - |
| 2026-09-13（锐评 P1 | `严格判定单一实现` | - |
| ：`git push origin a b` 时任一 ref 的 resolveChanges 返回 null（解析失败）→ **整体阻断**（exit 1），不做 per-ref 放行——这是刻意的 fail-closed 选择而非缺陷；改契约测试前勿假设可 per-ref 豁免。多 ref 的文件集按并集去重算变更域，ctx 持有首个 ref 的 oid（golangci-lint 基线用） | `多 ref 推送的 fail-closed 耦合` | - |
| 2026-09-13（锐评 | `PULL_HINT 带 remote-name` | - |
| 2026-09-13（重锐评 | `判定口径 A/B/C 收口` | - |
| 2026-09-13（重锐评 | `goTestCmd 数组化` | - |
| 2026-09-13（重锐评 | `autoFix 写盘语义` | - |
| "2026-09-13（锐评 P2）起门禁输出固定尾行 `覆盖口径: x/M 项 check-* 已接入门禁（未接入: …）—— 全绿 ≠ 仓库无风险`（数据源 `_lib/gate-coverage.ts`，动态枚举 scripts/check-*.ts 防分母写死过期）。**2026-09-19 更新：当前 33/37**——未接入仅 1 项 `check-comment-history.ts`（注释考古，观察期 WARN 非阻断），另 3 项为**刻意旁路**（`check-biome-lines` / `check-diff-coverage` / `check-go-coverage-threshold`，由 pre-commit / CI 独立承担）" | `覆盖尾行` | - |
| ~~已修复~~（2026-09-13 P0）：jscpd 报告原写**固定路径** `frontend/report/jscpd-report.json` 且读完即删、无 pid 无锁，并行会话同跑门禁互相删读（同提交第一次红第二次绿）。现改为每进程独立 `mkdtemp` 临时目录（`os.tmpdir()/jscpd-gate-*`）承载报告，扫描 pattern 用绝对路径指回 `frontend/src`，`finally` 整目录清理——报告生命周期完全私有化，与 jscpd-go.ts 的 tmpdir 先例对齐。教训留存：**工具产物落盘共享路径 = 隐性进程间耦合**，任何检查项新增落盘产物时必须私有化路径或加锁 | `check-deadcode-baseline 的瞬态 FAIL` | - |
| 新加相机按钮 | - | 直接注入 mmd-controls → 切类型时按钮消失；必须走 setAdapterItems 注入核心根菜单 |
| YSM schema 未走 registerYsmModelSchema 注册 | - | schema 变更不同步到菜单；必须经 schema-registry |
| registerReRoute opener 写成 (path) 或 (path, siblings) | - | 路由层算出的 candidates/entry 被静默丢弃；必须 (path, opts) => createXxx3D(path, opts) |
| 想在详情卡加 3D 按钮 | - | 与 ADR-253 D7 冲突（3D 已收敛到 nav-fab）；需要容器内指定模型请用 openModel3DFullscreen(path, { entry }) |
| 跨类型追加走错适配器 | `frontend/src/preview-3d/menu/engine/core.ts` | 必须经 switchExternal → openModel3DFullscreen(cooperate) |
| 异步回调写入已卸载 DOM | `skeleton.ts` | 每个 await 后检查 container.isConnected |
| 手动调用导致 T-pose 回归 | `vrm.humanoid.update()` | 只用 vrm.update(dt) |
| 直接改 envState 对象字段（不经 setEnvState）→ 不派发回调，cap 渲染不更新；必须走 setEnvState | - | - |
| cap 忘记 registerEnvCallback / dispose 不退订 | - | 状态变更不落地或泄漏回调 |
| 测试不 beforeEach resetEnvState | - | envState 单例跨用例串扰 |
| 改灯光首启默认只看新用户（saveAll 无条件落盘 | - | 老存档走祖父条款，旧值永不退场，出口是「重置全部灯光」） |
| 跨场景共用 schema key | - | 多模型同框时 schema 冲突、菜单项混乱；必须用 per-scene 键 |
| switch-preview 未清 schema 注册表 | - | 旧模型 schema 残留；必须经 switch-preview 清理 |
| 横切设置项各自有独立读写通道 | - | 状态单向流失效、菜单控件与状态不同步；必须走 preview-state |
| cap 未自动聚合 | - | 新增 cap 后菜单缺控件；必须在 cap 实现 getMenuControls 并注册 |
| 3D 菜单只允许 visibleWhen 谓词，禁止手写 3D 菜单；新增 UI 功能必须可被所有数组类菜单调用 | - | - |
| schemaId 必显式声明（panel id 不再隐式兜底作 schema key，防 id 撞注册键渲染错内容） | - | - |
| fillers 仅 roles 一项（G3 删 fill* 后唯一残留），health.test 白名单守卫——禁止新增 filler | - | - |
| renderCustom 是末段逃生舱，schemaId 未注册时走 renderCustom 会 console.warn | - | - |
| 预览菜单真实 DOM 渲染需要**足够完备的 ctx**，不是：dock 按钮 `visibleWhen` 谓词（如 `env.skyGroundCap`）读 `sceneCapabilityRegistry` 的 cap 实例可用性，stub 得太薄就退化成「dock 空壳」——overlay 内有 dock/popup 容器但按钮行零渲染。**2026-10-04 实测反驳「e2e 渲不出菜单」**：e2e 层用 `mountPreviewRootMenu` + 含 `getCamBridge`/`getSiblings` 的 ctx 渲出了完整三级面板（`menu-visual.spec.ts` + `e2e/_shots/menu-03-scene-*.png`）；e2e-web 层起真 3D 会话（`openEmpty3DFullscreen`）后更渲出 30 控件的后处理面板与 `dock-env` 分组——**两者都只有真上下文才可见**。结论是**分层选工具，不是二选一**：happy-dom 单测（`items.test.ts` / `sky-capability.test.ts`）验成员归属与拓扑契约（快、稳）；e2e 截图验视觉呈现与 cap 真实可用性（方法见 `e2e-visual-feedback.md`）。headless 无 GPU 时天空/水面观感属软渲染伪影，不作美术判据。 | `浏览器渲不出菜单` | - |
| adapter 手写 DOM | - | 与声明式菜单系统不一致、面板内容不出现；必须走声明式节点 |
| renderCustom 与 children 混用 | - | 渲染通道冲突；必须二选一 |
| 新增路径必须两步走，缺一步编译不过 | `扩 KNOWN_PATHS + 填 binding` | - |
| 未落地键在编译期即报错（不再恒 undefined 静默假死） | - | - |
| 直接写未落地路径（如 ui.mode / env.sky）编译报错——类型契约即运行时实现 | - | - |
| 直接改 preview-state 未注册字段 | - | 切页/换模后状态回滚、选项失效；应走 KNOWN_PATHS |
| 截图灯光与预览灯光混用 | - | 导出 PNG 与实时预览不一致；截图灯光必须走 shot-panel 独立通道 |
| 直接改 preview-state 里的未注册键 | - | 切页 / 换模后状态回滚；必须经 KNOWN_PATHS 注册 |
| 把状态放 sceneRegistry / SlideMenu / 节点字段而非 previewState | - | 状态无法在 cap 切换时保留；状态通道需集中 |
| 前端直调 os.Remove | - | 无法恢复、跳过 ADR-038 合并规则；必须经 go/recycle |
| initRecycleBin 不返回清理函数 | - | 监听泄漏；必须在 app-content 切换页时调用返回的清理函数 |
| 各自创建 renderer | - | 多 rAF 循环、GPU 资源浪费；必须经 render-federation 共享 |
| rAF 未统一节流 | - | 帧率不统一；必须经 federation 的 rAF 调度 |
| 权威源 = localStorage （由 app-nav 切换器写入），禁止各模块自行落盘 | `repo_rtype` | - |
| 运行期类型变更唯一入口 = 事件 ；直接读 localStorage 会错过运行期切换（原以反引号起句致 YAML 解析失败，2026-09-11 调整语序） | `repo:rtype-changed` | - |
| 钩子  的 onChange 仅在类型真正变化时触发（同值去重），组件销毁必须调 cleanup() | `useCurrentResourceType` | - |
| ⚠️ 历史：原前端  异步加载器 `loadResourceRegistry()`（Go RPC + `_registry` 缓存，空/失败不缓存）已由 ADR-269 D3（2026-09）退役——全部消费方迁 `utils/resource/schema.ts` 同步视图 `allResourceTypes`/`resourceTypesById` 后连模块一并删除，勿再引用 | `services/resource-registry.ts` | - |
| ⚠️ 历史：原  服务注册表的 `get` 用 `Map.has()` 判定 falsy 值——该文件已删，本 pitfall 仅存史 | `services/registry.ts` | - |
| MMD 子类型 instanceDir 必须精确为 `3d-skin/<子名>`（含子级），漏写一级右键打开到错误父目录；TestResolveInstDirTarget_MmdSubtype_3dSkinPrefix 回归测试锁定 | `打开文件夹` | - |
| 硬编码 Windows 路径 | - | Android/Linux 启动失败；必须经平台桥的编译脚本 |
| CGO 未静态链接 | - | Android 缺少依赖库；必须经 compile-rust-static 静态编译 |
| 直接 dlopen 加载 rust.dll | - | 平台差异处理不全、符号名不匹配；必须经 bridge_*.go 封装 |
| Rust 后端未正确回收 | - | 内存泄漏；必须经 rustbridge 的 drop/destroy 生命周期 |
| Worker 内 import i18n | - | 模块加载失败、Worker 崩溃；必须用 safeErrorMessage |
| safeErrorMessage 不做字符串化 | - | null/undefined 错误丢信息；必须经 safeStr 兜底 |
| adapter 直接创建场景对象 | - | 能力列表 / 菜单 / 状态同步不一致；必须经 sceneCapabilityRegistry 注册 |
| 能力未实现 getMenuControls | - | 菜单缺控件；必须在 SceneCapability 接口中实现 getMenuControls |
| 文件搬迁/拆分导致误报 | `文件搬迁/拆分导致误报` | 看 drift 提示而非直接 --update；exact = 纯搬，partial = 拆/并文件 |
| --update 会冻结当前状态 | `--update 会冻结当前状态` | 有遗留债务时误用会把债写进 baseline，需先治理再冻结 |
| exit 2 不是失败 | `exit 2 不是失败` | 仅表示 baseline 不存在，需首次跑一次并 --update 创建账本 |
| 与前端 deadcode baseline 零耦合 | `与前端 deadcode baseline 零耦合` | 绝不要往 deadcode-baseline.json 的 jscpd 段写回，两账本独立演进 |
| 迁移 Windows 路径时归一化 POSIX | `迁移 Windows 路径时归一化 POSIX` | normPair 处理 `\`，但原始 key 仍可能含反斜杠 |
| 文件级豁免吞残留 | `文件级豁免吞残留` | import 过 ≠ 用到底；豁免必须下沉到行级，否则「接入三成」的文件长期逃检 |
| 扫描面漏掉定义者 | `扫描面漏掉定义者` | collectScripts 排除 _ 前缀目录，_lib 自身成法外之地；闸门须自省 |
| 能力定义文件自指误报 | `能力定义文件自指误报` | 每条规则必须豁免自身模块文件（to-posix.ts 的实现本体就是一条 replace） |
| smell 形态不全漏检 | `smell 形态不全漏检` | 同一能力常有等价写法（split 反斜杠 join 斜杠 逃过 replace 形态），补 smell 而非只认一种 |
| 孤儿判定口径过窄 | `孤儿判定口径过窄` | 只数 scripts/ 侧 import 会把在役模块误报「建议归档」；_lib 互引、.githooks CLI 调用、tests 消费都是真实引用 |
| 零引用 ≠ 该归档 | `零引用 ≠ 该归档` | 必须先查 git 历史与 ADR：gate-ctx.ts 零引用是 ADR-206 阶段 1a 的「先建后接」预备件（战役未完成），不是废弃设计。归档前须排除「未落地战役半成品」 |
| 薄包装误报 | `薄包装误报` | `return walk(dir, {...})` 体内无 readdirSync，须靠自研特征而非函数名判定 |
| 名字过泛误报 | `名字过泛误报` | collectSymbols 这类通用名可能是聚合上层逻辑，列入 smell 会持续误报 |
| 新增脚本后忘记在 README.md 登记 | - | check-readme-index 阻断推送（exit 1） |
| README 只写脚本名前缀（如  而非 `doctor.ts`）→ 前缀匹配不够，必须精确匹配 basename | `doctor` | - |
| 脚本改名后未同步更新 README | - | 旧名不匹配，新名未登记，产生漂移 |
| 误把  共享层或测试文件当作需要登记的脚本（它们被排除在外） | `_lib/` | - |
| 删除脚本时简单删行而非移入区 | `已删除` | 与磁盘状态不一致导致误报 |
| 同一脚本在登记性表格（第一列）出现 ≥2 行 | - | duplicateRegistrations 报重复登记（check-go-coverage-threshold 曾错放生成器表） |
| 已删脚本名仍在区块之外被引用 | `已删除` | ghostReferences 报幽灵引用（event-audit 曾残留于检查类定义与一致性校验表） |
| 前端本地重算筛选逻辑 | - | 与后端 SearchModels 能力脱节、结果不一致；必须交后端执行 |
| adv-filter 条件未走三路交集（关键词 + 数值 + 标签）→ 结果不精确；必须经 advFilterIntersectPaths | - | - |
| 手写按钮 CSS | - | 与 btn-base 不一致、主题切换失效；必须经 btnBaseCSS |
| 颜色 / 间距 / 字号不消费 CSS 变量 | - | 主题切换后样式残留；必须用 var(--*) 变量 |
| 零散 grep 每枚 emoji/每个 UI_ICONS 模式各发一次 | - | token 浪费（实测上一会话 28 分钟 / 5.6M tok 都在翻 emoji）：改用一次性脚本 |
| "`check-design-tokens --kind emoji-icon` 只认，扫不到运行时 toast 载荷 / locale 值前缀 emoji；要全量需用 survey 脚本或 findToastEmojiPrefixViolations / findLocaleEmojiPrefixViolations" | `HTML 标签图标位 + 字面量 emoji` | - |
| emoji 字符集必须含 U+2190-21FF / U+2300-23FF（含 ⏳/← 等），否则单字形槽整类逃逸 —— survey 脚本已**复用 design-tokens.ts 导出的 GRAPHIC_EMOJI**，不自抄副本（单一事实源，门禁改字符集 survey 自动跟随） | - | - |
| app-sidebar 直接发 push/pull 请求 | - | 并发冲突 / 状态错乱；必须经 sync-manager 排队 |
| PullSingleResource 未完成前刷新侧边栏 | - | 半同步状态显示；必须等 store 状态收敛 |
| getAllByTestId 前缀查询不会返回的兄弟 testid（如 tree-dir 不会命中 tree-dir-toggle）；误用精确查询会抛错，应先查前缀再 JS 过滤 | `后缀非数字` | - |
| waitFor 超时/异常携带原始错误（P2 修复后）；旧实现静默吞错掩盖真实根因，迁移旧卡时注意不要写 | `捕获后重新 throw 通用消息` | - |
| " 参数不存在于 waitFor 签名，旧知识卡/口语中可能出现误导" | `interval?` | - |
| 异步等待必须按选型：正等结果→waitFor，init 落定→排空调度轮次，负向窗口→保留真实 sleep | `三分法` | - |
| 将 init 落定硬凑成 waitFor 条件会与组件内部实现耦合，条件易碎 | - | - |
| 将负向定时器窗口换成短 sleep 会导致防抖真坏了也漏报 | - | - |
| testid 值禁止含空格或大小写混排（UI-Design.md §19.1），本层未做入口校验（P3） | - | - |
| 缓存目录位置经 CacheDir 推导，清理一律走 cache-clear CLI，不手删目录 | - | - |
| 脏主题值直写 | - | 无效 CSS 变量、页面错乱；必须经 normalizeTheme 过滤 |
| 跟随系统主题未监听 prefers-color-scheme | - | 系统切换主题后页面未同步；必须挂 change 监听 |
| 各层各自调 SearchModels | - | 重复请求 / 结果不一致；必须经 toolbar-search 单点编排 |
| 网页版降级不走 consumeWebSearchDegraded | - | 用户在受限环境无反馈；必须经该函数给出降级提示 |
| 手写重复 DOM | - | 样式不一致、缺可访问性；必须复用组件簇 |
| 组件簇内定义自定义元素 | - | 与全仓 Web Components 规范冲突；本簇只做 helper 函数 |
| 把新文件塞回 | `frontend/src/ui/` | 目录已于 ADR-220 解散，不存在 |
| 手写导航栈 | - | 与 slide-menu 的 home/navigate/back 契约不一致；必须复用 |
| slide-menu 挂业务 registry/schema | - | 外壳层混入业务；必须保持外壳纯净 |
| 手写 splice 排序 | - | 与拖拽 drop 逻辑不一致、边界溢出；必须经 moveItem |
| moveItem 未 clamp | - | 拖拽到首/尾位置时报错；必须在 moveItem 内做 clamp |
| 手写文件名解析 | - | 与 parseModelName 判定不一致、作者 / 作品提取错位；必须经 renderDisplayName |
| 搜索高亮未走 esc | - | XSS；必须在高亮前经 esc 转义 |
| 直拼 innerHTML | - | XSS 注入；必须经 esc() 转义 |
| toast 时长内联魔法数字 | - | 与全应用不一致；必须用 toast-ms 的语义常量 |
| 裸抛原始错误 | - | 用户看不懂、违反治理红线；必须经 friendlyError 翻译 |
| 网络错误未分类 | - | 一律显示未知错误；必须经 friendlyError 的网络错误分支 |
| 离屏 renderer 未 dispose / blob URL 未通过 evict 回调释放 | - | WebGL 上下文 + 内存泄漏；整个「renderer 创建 → 场景构建 → 四角度循环」必须都在 try/finally 内 |
| cacheSet 覆盖同 key 旧值不触发 evict | - | WASM 解码产物的旧 blob URL 泄漏；淘汰与覆盖都必须走 evict 回调 |
| GetModel3DSpec / JSON.parse 失败直接 reject | - | 消费者无 catch → unhandled rejection；失败应统一返回 null（P2 修复） |
| try 起点在角度循环而非场景构建段 | - | 场景构建抛错时 renderer 永不 dispose（P2 修复） |
| 拖拽导入等待异步注册表 | - | 导入按钮短暂不可用；必须用 RESOURCE_EXTS 静态表 |
| 静态表未与 resource_types.json 对齐 | - | 三端不一致；必须由契约测试守护 |
| 手写格式化 | - | 单位不一致、时区错乱；必须经 format.ts |
| 日期未走友好日期 | - | 用户看不懂时间戳；必须经 friendlyDate |
| 手写文件名→图标映射 | - | 与 fileIcon 不一致、新类型缺图标；必须经 fileIcon |
| 手写 § 颜色解析 | - | 与 renderFormattedText 不一致、特殊字符未处理；必须经 renderFormattedText |
| pack_format 未走 describeVersionRange | - | 版本显示不友好；必须经 describeVersionRange |
| console.log 散落 | - | 无法按 tag 过滤、生产环境泄漏日志；必须经 dbg |
| 环形缓冲区未限制大小 | - | 内存累积；必须经环形缓冲的 max 限制 |
| 手写类型映射 | - | 与注册表不一致、分类错乱；必须派生自 resource_types.json（走 schema.ts 同步视图） |
| 新增资源类型未注册 | - | 前端无法识别；必须在 resource_types.json 中注册 |
| 手写详情卡片 | - | 与 summaryCardHTML 样式不一致、作者信息重复；必须经 summaryCardHTML |
| 加密模型未走安全提取路径 | - | 加密内容泄露；必须经 summaryCardHTML 渲染 |
| 高频轮询 GitHub API | - | 触发限流、浪费带宽；必须经 canCheck 节流 |
| check 未 markChecked | - | 重启后重复检查；必须在检查完成后 markChecked 记录时间戳 |
| DOM 测试切 node 环境 | - | window/document 报错；必须保持 happy-dom 或治理源码副作用 |
| 用 vi.mock 硬扛源码副作用 | - | 治标不治本；必须先做惰性化守卫/神桶拆分 |
| 重建 KeyframeTrack（而非原地改 track.name）会静默丢掉 MMD 逐轴贝塞尔插值——视觉卡点顿挫且不报错 | - | - |
| 幽灵网格 morphTargetDictionary 不可留 undefined（上游 buildMorphAnimation 解引用必抛）；填= ADR-306 表情改道，空对象 = v1 行为（morph 全丢弃） | `可映射子集` | - |
| 足 IK 的必须创建期快照；每帧现读会自反馈漂移 | `足静止世界位置` | - |
| 轨道绑 uuid 而非 name（归一化节点名是 Normalized_ + 模型作者自定义骨名，可能含空格/日文）；表情轨道例外——绑  前缀 + preset 名的 name（载体对象由 VRM 规范命名） | `VRMExpression_` | - |
| 表情载体对象（VRMExpression_*）的  必须预初始化（真实 VRMExpression 构造即 weight=0）——three PropertyBinding.bind 遇 undefined 属性即 not-found 静默停写 | `.weight` | - |
| 脚趾链 CCD（vrm-foot-ik）防乱挂校验：toes 的 parent 必须就是踝骨（leg endEffector），否则跳过不猜 | - | - |
| 符号陷阱：ConeGeometry 锥顶在局部 +Y，射束向下延伸 | - | 几何中心 = 锥顶 + 半高·方向（写成 -半高 会让锥顶飘到光源上方一个锥高；垂直灯下看不出，斜射才穿帮） |
| 平面剪影回归：任何的写法都会在侧视角双 edge-on 变薄消失、相机穿入时中轴亮缝 | `两片交叉 Plane + discard 抠锥` | - |
| ACES 旁路回归：自定义 ShaderMaterial 不会自动注入 tonemapping/色彩空间转换，片元必须显式 include 两个 three chunk（tonemapping_fragment + colorspace_fragment），否则加色硬裁并异常喂 bloom | - | - |
| 离屏输出设置分叉（ADR-266-d1）：截图侧不镜像预览 renderer 的 toneMapping / toneMappingExposure 时，光柱与模型亮度在两画面之间静默分叉（ACES 曲线差异比几何差异更刺眼；历史只抄了 outputColorSpace，两侧恰好同为 SRGB 才没露馅） | - | - |
| edgeFade 语义已改：0=均匀壳，1=边缘辉光主导（旧版是），中间段观感整体约暗 20%，用 opacity 补偿 | `压暗边缘` | - |
| 重建成本：只有 type/enabled/angle/penumbra 影响几何（`CONE_GEO_CHANGES`）；方位角/仰角走 syncPosition，color/intensity/distance/decay 走 updateUniforms——误加回会恢复拖滑块抖动 | `任意灯字段变更即 rebuild` | - |
| 直调 window.go 方法 | - | Wails 启动时序不确定、方法未就绪时调用失败；必须经 getApp() 代理 |
| 在 web 模式直调 wails binding | - | window.go 不存在；必须走 backend-web 的 browser-adapter |
| 解构直连 | `const { SomeBinding } = window.go.main.App` | 绕过 getApp 缓存/路由，违反红线 §3.2 |
| 忘记 wails3 build 就运行 | - | 新 Binding 在桌面端不可见、报 undefined |
| getApp 首次调用失败后直接返回错误，没有重试语义（P2 修复：import 失败会重置 _appPromise 并 rethrow，防永久毒化） | - | - |
| 认为 browserAdapter 有状态会被缓存 | - | 实际是无状态 Proxy，每次调用 getBrowserAdapter 直接返回，不走 _App 缓存 |
| 拼错 webImpls 键名 | - | 原先运行时静默无响应，Phase 3 修复后通过 satisfies Record 保留字面量键 + AssertSubset 在编译期暴露 |
| 水面有 waterNormalStrength，但材质 normalMap 恒为 null——微细节法线由 fragment 程序化生成，不存在贴图（ADR-271） | - | - |
| 水面 mesh 是 scale(uSize,uSize,1) 各向异性缩放：世界量与局部量互换必须成对换算，只修一边等于换一种错法（ADR-257 §6.4） | - | - |
| '**波幅写死已被数值探针量化、2026-10-04 修复（ADR-319 D1）**：旧式  使 wave0–4 全部顶到上限 0.5（ADR-255 设计的几何级数衰减被抹平）、振幅是**绝对世界米制、不随 waterSize / 池深 / 水位归一**，默认参数实测峰谷差 5.296 m ⇒ **33.17% 越壁、49.14% 穿地**。现 `amp = uWaveHeight·0.26·0.82^i`（0.26 归一 ⇒ Σamp ≡ uWaveHeight），取新默认（waveHeight=0.06、level=0.15、poolHeight=0.3）复测：峰谷差 **0.116 m**、越壁 **0.00%**、穿地 **0.00%**。复现命令 `node scripts/probe-water-wave.ts`（量具非门禁，退出码恒 0；① 段标定自证复刻忠实度）' | `amp = min(0.6·0.82^i / freq, 0.5)` | - |
| '**浪高入口曾完全缺席（2026-10-04 修复，ADR-319 D1）**：面板五个水波旋钮（waveSpeed / choppiness / normalStrength / clarity / size）里不含振幅——`amp` 不进 `steep` 链，`waterChoppiness=0` 时峰谷差零变化（探针实测），即且「尖度归零时几何仍大幅起伏、解析法线已判为平面」。现 `waterWaveHeight` 进 schema（默认 0.06，range 0–1），经 `water-params.ts\|effectiveWaveHeight` **分形态钳制**：下钳 `min(waterLevel)` 治穿地（film/pool 通用），上钳 `min(waterPoolHeight − waterLevel)` 治越壁（**仅 pool**），钳制量在 CPU 侧算好下发。**上钳不可无条件套用**——film 下 `waterPoolHeight` 滑块隐藏、锁死在默认 0.3，而 `waterLevel` range 到 5.0，无条件「两钳取小」会让水位过 0.3 m 时预算归零、浪高静默死平（落地后子代理复核发现，已改为 `effectiveWaveHeight(forPool)` 按形态传入）。**单向只治一半**（只钳池深时 `waterLevel=0.01` 仍穿地），故 `waterLevel` 默认同步从 0.01 抬到 0.15——别把预算卡死成平面' | `静水态不可达` | - |
| '**泡沫通道已删（ADR-319 D3b，2026-10-04）**：旧判据 `smoothstep(0.0, -0.25, J)` 要求 `J ≤ 0`（波面自交），与 `Σσ·k ≤ 0.8` 的防自交钳制互斥——探针实测 `choppiness=0.5` 时 `J_min = 0.656`、拖满 1.0 时 `0.379`，**`J ≤ 0` 占比恒 0.00%** ⇒ `vFoam` 恒 0，每顶点白算三项 Jacobian、每片元白跑一次 mix。现已**整条退役**（varying + Jacobian 三项累加 + mix 全删），shader 内无 foam 残留；别按去调 foam 系数，也别把旧通道接回来——原判据（`J ≤ 0`）仍是死通道；要做泡沫须按 ADR-319 D3(a) 重新设计判据与归一（新尺度下 `Σσ·k = 0.8·choppiness`，拖满时 `J_min = 0.379`）' | `水面该有白沫` | - |
| '**频谱锚点错配已修（ADR-319 D2，2026-10-04）**：旧式 `freq = 0.25·1.19^i` ⇒ λ 钉死 [10.53, 25.13] m，而采样可呈现窗口是 `λ ∈ [6·size/segments, size/2]`（`size=10` 六波全超域宽、`size=300` 六波全被 aa 淡出，滑杆展示域却是 10–300 m）。现 `freq = 2π·1.19^i·4/uSize` ⇒ `λ_i = uSize/(4·1.19^i)`，每波长顶点数 = 分段数/(4·1.19^i) **与 uSize 无关**，全域六波恒落窗口内（探针尺寸域扫描：size ∈ {10,20,40,80,160,300} 峰谷差/越壁/穿地/窗口内条数全部不变）。ADR-272 加的治的是**采样不足**，不治**锚点错配**——两者是两笔账，勿混为一谈；锚点归一后淡出成为纯保险（六波全在窗口内时恒为 1）' | `每波长顶点数淡出` | - |
| '**shader 注入检测已补齐六锚点（2026-10-04 修复 `7214b629c`）**：`water onBeforeCompile` 现检六处——vertex 的 wave 函数 / beginnormal 的 `objectNormal` 覆盖 / **begin_vertex 位移锚点 `transformed.z += gdisp.z`** / fragment common 独有串 **`uniform sampler2D uReflTex`**（不再查同时出现在 common 声明与 dithering 引用两处的 `uRoundness`）/ 微细节 `normal` 覆写点 / 倒影混合块。原两条洞（位移注入无锚点、`fragOk` 因重复串漏报）已当日收口——**别再按旧描述去"修"已修好的东西**。剩余同族项只有（beginnormal 取 nrm、begin_vertex 取 disp，各丢一半输出，非阻塞；两条 chunk 间无 chunk 改 `position` 的判断须在升级 three 时重验）' | `gerstner() 每顶点算两次` | - |
| '**顶点波场被算两次（2026-10-04 子代理审计，待议）**：`gerstner()` 每顶点调两遍——`beginnormal_vertex` 里算只取 `nrm`（丢弃 disp），`begin_vertex` 里算只取 `disp`（丢弃 `nrm`，形参名 `gWaveNormalUnused` 即自证）。6 波 × 64² 顶点 × 2 ≈ 49k 次三角函数对/帧，非瓶颈但是白算。两 chunk 在同一 `main()` 作用域、中间无 chunk 改 `position`（morphnormal/skinbase/skinnormal/defaultnormal/normal_vertex 均只读 objectNormal），可合成一次：beginnormal 内算 disp 存局部、begin_vertex 直接 `transformed += disp`。与上一条是同一处代码的两面，一并议' | `注入检测有洞` | - |
| 结构参数只能动 （`square` 等比铺满 / `wall` 双轴：x = size、y = 壁高 + 外偏沿法向轴）：**y 轴不得被 size 缩放**（`wallH` 由 h / t 现算，与 size 无关），否则壁高与壁厚会被尺寸连带放大 | `transformLinks` | - |
| '**（已修复 2026-09，ADR-272 §5.1）** pool 的 waterPoolHeight / waterPoolWallThickness 曾走全量重建（wall 的 y 尺寸与外壁偏移烘焙进几何）——拖动即每帧重建 10 个 mesh。现壁几何单位化：壁高走 、外偏 = `size/2 + t` 运行期现算。教训：**任何结构参数只要被烘焙进几何，就必然在滑块拖动时变成重建风暴**' | `scale.y` | - |
| waterSize 值域：合法域 [1, 300]（下界来自）、展示域 10–300；钳制在 `setEnvState`（ADR-283），shader 侧另有 max(uSize, 0.001) 兜底 | `0/负数会让水面退化成一个点` | - |
| 圆角裁剪用世界坐标 max(\|x\|,\|z\|) 对比 uHalfSize，隐含这一假设——已登记（2026-09-20），2026-10-04 已补测试钉子（`水面 root 恒在原点` describe：film/pool 切换 + 水位/尺寸/池深变更均不移动 root 的 xz）。若未来支持移动/放置水面（脱离原点），圆角裁剪会静默把整块水面裁成隐形，需先改为相对水面自身中心的局部坐标 | `水面恒在世界原点` | - |
| '**波浪 shader 实现已迁至 water-shader.ts（2026-10-05 行数红线收口）**：`water-capability.ts\\|buildWaveWaterMaterial` 现在只是**薄转发封装**（装配 `WaterShaderCtx` = waterTime / reflect / reflectionActive 惰性 getter 后调用 `water-shader.ts\\|buildWaveWaterMaterial`）。改波浪 / REVISION 窗口 / 六锚点 / GLSL 注入串请去 `water-shader.ts`，cap 侧那条私有方法只代表。拆分动机：ADR-315 拆三刀后文件逼近红线超限（check-file-lines 阻断），故把最大真缝（波浪注入段）抽出、红线额度相应下调' | `材质从哪来` | - |
| '**透明度预设失效（已修复 2026-09）**： 中 `waterOpacity` 变更路径只更新 `top.material.opacity`，漏同步 shader uniform `uBaseOpacity`。shader 用 `min(gl_FragColor.a, uBaseOpacity)` clamp 透明度，`uBaseOpacity` 固化在构建期，导致增大 opacity 不生效（减小偶然正常）。修复：补调 `syncBaseOpacityUniform`，与 `waterWetness` 路径同口径' | `applyChangedParams` | - |
| '**派发键是类型化键域（2026-09）**： 为 `Set<EnvStateKey>`，`changed.has("拼错")` 编译不过；新增参数必须先在 `env-state-schema.ts` 声明（含 `group: "water"`），否则派发链与持久化都抓不到它' | `EnvCallback.changed` | - |
| '**water 持久化由 schema 派生**：`saveState` 遍历 `getPresetKeys("water")`（不再手抄键表）；写侧统一 `water*` 规范键，历史键名 `size` / `pool*` 由 `loadState` 双轨吸收——新增参数只需进 schema，读侧按需补别名。**legacy 别名还原表是带退役时钟的兼容层**（锐评 P1-2）：新存档恒为纯规范键（legacy 分支只在时读 ground 旧记录），用户任一次 saveState 刷新后即永久走新记录——该表**只减不增、不得新增别名**，退役判定 = 用户面 legacy 存档刷新周期届满（发布一个维护周期后），届时整表连同 ground legacy 解包段一起删，勿长期挂着无时钟的兼容层' | `water 键无存档` | - |
| '**uniform 一律经 `setUniform(mat, name, value)` 写入**（原五处 `as unknown as { userData.shader }` 深挖已收口）：`onBeforeCompile` 未跑或 uniform 名拼错时静默跳过，故改动后须以的断言兜底，不能只断言 envState' | `uniform 实际取到值` | - |
| '**uniform 名唯一登记 = `water-capability.ts\|WATER_UNIFORM_NAMES`（锐评 3.1，2026-09-23）**：`setUniform` 的 name 形参收窄为 `WaterUniformName`（该表的类型投影），onBeforeCompile 注入的 uniform 集与登记表双向对账（测试）——新增 uniform 忘登记即红，拼错统一名编译期即红，不再是 string 黑洞' | `注入 ⊆ 登记 ∧ 登记 ⊆ 注入` | - |
| '**RT 重建死区（锐评 3.5，2026-09-23）**： 的 clipBias 比对带容差 `REFLECTOR_CLIP_BIAS_TOLERANCE = 0.05`——\|Δbias\| < 0.05 视为未变、跳过弃载体重建。背景：`water-reflection-clip-bias` 滑杆 step=0.1，无死区则单次拖动触发 ~100 次 Reflector+RT 重建（几何/材质/RT 三件全建）。死区不破「bias 实质变化 | `ensureReflector` | 重建」语义（F-2 的 1.5 偏离 = Δ1.5 仍重建）' |
| '**逐帧现读键的显式登记 = `water-capability.ts\|WATER_FRAME_READ_KEYS`（锐评 3.3，2026-09-23；2026-10 扩容）**：`waterWaveSpeed` + ADR-297 倒影五键在分派表是空条目（无材质应用）、消费点在渲染循环逐帧现读 envState——这条路曾无人登记（维护者只能人肉 grep）。现登记表 + 契约测试锁定（waveSpeed = [锐评 3.3] ② 用例；倒影五键 = ADR-297 用例组「水位/分辨率/强度逐帧现读」「[锐评 F-2] 弃载体重建」「[锐评 3.5] 死区」「SSR 抑制真值表」「无宿主/默认关」）。**反向闭包**：`WATER_NOOP_APPLIER_KEYS`（锐评 3.3 ③）机器派生分派表空条目全集，断言其 == 结构承接（waterEnabled/waterMode）∪ 逐帧现读表——未来加同类空键必须二选一登记，否则契约红' | `登记键 ∈ 分派表 && 行为实证现读生效` | - |
| '**值域改一处生效（ADR-283）**：滑杆  由 `getParamRange(key)` 从 schema 取，cap 内不再有值域字面量；写侧钳制在 `setEnvState` 唯一入口。改范围请改 `ENV_STATE_SCHEMA.xxx.range`（合法域）/ `uiRange`（展示域），**不要在 menu 或 setter 里写死**' | `min/max/step` | - |
| '**setter 不再 clamp（ADR-283）**： 等一律只 `setEnvState({...})`；若要加保护请补 schema `range`，写回 setter 即造出第二事实源' | `setWaterOpacity` | - |
| '**水面开关单门（2026-09-22，fog 先例同法）**：启停唯一真值源 = ，`SceneCapability.setEnabled/isEnabled` 是其别名出口。原私有 `this.enabled` 为僵尸门——registry ctx 无 `enabled` 字段 ⇒ 生产恒 true、无任何 UI 写口、却经 saveState 持久化幽灵键；且 `loadState` 首段曾把 ground 嵌套 legacy 的 `water.enabled` 直写进它：**中毒即永久锁死水面，菜单开关显示 ON 也救不回**。现私有字段退役（守卫 = 测试断言 `"enabled" in cap === false`），幽灵键不再落盘也不再消费，同一存档翻开关即可复现' | `envState.waterEnabled` | - |
| '**含开关键的批次派发不得早退吞键（2026-09-21 修复）**：回调曾 `changed.has("waterEnabled") | - | syncWaterVisibility → return`，同批其余 water 键的材质/transform 应用被整体跳过——envState 已新、渲染体仍旧（画面与状态脱节直到下一次无关派发）。现参数照常逐键派发、可见性统一在派发尾重算；守卫 = 测试「waterEnabled + 参数同批派发」用例。往回调里加任何「单键早退 return」前先想清楚同批其余键谁负责' |
| '**形态门控必须同源（2026-09 修复）**：`uRoundness` 构造期靠 `buildMaterial` 的 `forPool` 对 film 恒 0，但分派表 applier 侧曾漏门控——pool 专属参数 `waterPoolRoundness` 经存档恢复 / 预设套用 / 其他 cap 直写 envState 时会把圆角泄漏进 film 材质（水膜四角被凭空裁掉，恰是构造期明令禁止的行为）。现由 `WaterBodyStrategy.supportsRoundness` 显式声明（film=false / pool=true）并在 applier 查 strategy。**教训：同一门控只写在构造期，运行期迟早从另一条路径漏进 uniform**——新增形态旗标时构造期与运行期必须共用' | `构造期 = 运行期` | - |
| '**倒影三坑（ADR-297）**：① RT 渲染期间水根必须隐藏——不隐则 pool 顶面 transmission pass 在镜像通路里再渲一遍水体（嵌套整场渲染 + 双层水）；② 官方 textureMatrix 末位乘了 scope.matrixWorld（输入=镜面局部坐标），水 shader 喂世界坐标必须右乘 M⁻¹ 剥回，直乘会双重变换；③ 反射相机视锥内容不受 render-host 主相机剔除管辖（RT 渲发生在 cullModelGroups 之前），掠射角下官方跳帧、倒影边缘缺块属已拍板已知限制（见 ADR-297 §3），勿当 bug 修' | `背对早退` | - |
| '**倒影门控是逐帧现读，不是派发驱动**： 在分派表里是显式 no-op 声明（与 waterWaveSpeed 同口径）——门控/权重/RT 边长/镜面高度/裁剪偏置全在 `renderReflection / ensureReflector` 现读 envState 落地。别给它们补材质写（双写违 ADR-286），也别给 pp 键补订阅（SSR 抑制真值现算即可，多订一路 = 第二真值源）。**唯一的现读特例（锐评 F-2）**：clipBias 烘在官方 Reflector.onBeforeRender 闭包里不可就地改，`ensureReflector` 以 `reflectorClipBias` 字段比对现读值——不一致即 `disposeReflector()` 弃载体、下拍懒建重建（低频参数，接受重建成本；bias 变更是离散动作非拖拽风暴）' | `waterReflectionEnabled/Strength/Resolution/ClipBias/ReflectDisableWhenSSR` | - |
| '**SSR 活跃判定单源（锐评 F-1，2026-09-23）**：`state/env-state.ts\|isSsrRenderActive()` = `ppEnabled ∧ ppReflectionMode ≠ envmap-only`，是的唯一判别式——pp `applyReflectorSync`（压地面镜）与 water `reflectionActive`（跳水面镜像）两处消费。此前两处各手抄一份、pp 侧还随 R-1 血案（关 pp 仍白压镜子）演化过一次——手抄判别式即分账隐患。改 SSR 语义只动这一个纯函数，勿再抄第三份' | `SSRPass 此刻真在渲染` | - |
| '**倒影 RT 内容线性、无 tone map**（three 仅对 canvas 输出做 tone map）：dithering 段底色已过 colorspace，采样值必须过  再混——直接混 linear 进 sRGB 域会让倒影发黑' | `linearToOutputTexel` | - |
| '**波场采样密度 ≡ 几何分段数，两处必须同源（2026-09-22 治大水面摩尔纹）**：顶水面网格分段固定（唯一事实源 `water-state.ts\|WATER_WAVE_SEGMENTS`），顶点间距 s = waterSize/分段数——s 逼近波长一半（奈奎斯特）时高频波混叠成游走摩尔纹（300 m 水池高频频闪的病灶）。gerstner 逐波按淡出振幅（≥6 全留、2–6 线性消退；1‰ 下界只保 aa 非零——**不保 wa>0**，wa 的除零由退化门 `water-state.ts\|WAVE_DEGENERATE_WA` 承接）；位移/解析法线/泡沫 Jacobian 同源于 amp，一处衰减三处一致。**D2 锚定域宽后 λ/spacing = 分段数/(4·1.19^i) 与 uSize 无关，segments=64 时六波最小 6.70 ≥ 6 ⇒ 本淡出当前恒为 1（惰性保险，非活功能）**，分段数压到 ≤57 才会真正淡出高频——数值判据见 `water-capability.test.ts` 的「波场守卫的真实性」describe（含"通道不是死代码"的反证）。改分段只动常数一处（几何装配与 shader 间距推导都读它，守卫 = 「分段数唯一事实源」用例）；调大 = 高频保留更好但三角数平方上涨，调小 = 消隐提前介入。注意此衰减治的是「采样不足」，`min(…, 0.5)` 抹平振幅级数是另一笔已登记未改的账' | `每波长顶点数 λ/s` | - |
| '**静水态曾产出 NaN（2026-10-04 修复，锐评 P0-1）**：`amp = uWaveHeight·0.26·0.82^i·aa`，而 `uWaveHeight` 可为 0——浪高滑杆 min=0、水位归零、pool 下水位 ≥ 池深，都会让 `water-params.ts\|effectiveWaveHeight` 的预算归零。此时 `wa = freq·amp = 0` ⇒ 陡度式 `0.8/(wa·6)` 得 +∞ ⇒ `steep·amp = ∞×0 = NaN` ⇒ `transformed` 与 `objectNormal` 双双污染 ⇒ **水面整块消失**（用户拖浪高到 0 想要静水，得到）。修复 = shader 波场内退化门 `if (wa <= WAVE_DEGENERATE_WA) { continue; }`（阈值单一事实源 `water-state.ts`，shader 内插、探针 `buildWaves` 同门）——跳过后 nrm 保持 (0,0,1)、位移为 0 = 平面水 + 正确法线，静水态这才真正可达。⚠️ 原注释与知识卡宣称的「1‰ 下界保 wa 恒 > 0」**是假不变量**：该下界加在 `aa` 上，amp 本身已是 0 时救不了 wa（已随本轮订正）' | `水没了` | - |
| '**水平摆动曾随水面尺寸漂 30 倍（2026-10-04 修复，锐评 P1-1）**：D2 让 λ ∝ uSize，而 Gerstner 的水平位移 `steep·amp ∝ 1/freq ∝ uSize`、且与浪高解耦 ⇒ 同一浪高在 size=10 与 300 下水平摆动差约 30 倍（探针改前实测 0.036 m ↔ 1.091 m，而垂直总振幅恒 0.060 m）——大水面被。修复 = `steep` 乘基准反归一 `water-state.ts\|WAVE_STEEP_SIZE_REF/uSize`（基准 = schema `waterSize` 默认 80，同值守卫在其测试内）：默认档观感零变化，`size ≥ 80` 域水平摆动恒定（探针域宽扫描六档恒 0.650 m），`size < 80` 由自交上界 `WAVE_STEEP_SUM_LIMIT/(wa·N)` 接管——那是物理约束（波长太短本就不允许那么大水平摆动），不是公式漂移。⚠️ 别为「让两端完全相等」去突破自交上界。**权衡的另一半（第二轮回归审计发现，2026-10-04）**：反归一保住的是「位移轴」恒定，尖度轴 Σσk **随 size 递减**（实测 size=40 时 0.800 | `横向揉皱` | 80 时 0.400 → 300 时 0.107，探针 ④ 段「Σσk 域宽扫描」行）⇒ 大水面「波峰尖度」滑杆的塑形力衰减到 1/7.5。**在振幅绝对米制（D1）下，位移恒定与尖度恒定不可兼得**——要两者都恒定必须让振幅也随域宽归一（丢失「米」语义，属产品决策）。现状取「位移恒定」（用户对「横向揉皱」最敏感），尖度衰减可辩护：大水面长波本就平缓' |
| '**存量存档吃掉 D1 的默认抬升（2026-10-04 修复，锐评 P1-4）**：`saveState` 遍历 schema 键集恒写 `waterLevel`，而 ADR-319 D1 把默认从 0.01 抬到 0.15 ⇒ 老档把旧默认原样带回、预算被钳到 1 cm（观感原样保留），收益只覆盖新装 / 清过档的用户。修复 = 存档带版本戳 `water-migrations.ts\|WATER_SCHEMA_VERSION_KEY`（唯一消费者是 loadState 的迁移判据，**不是参数键**、不入 schema）+ 纯函数 `migrateLegacyWaterLevel`：只有「无版本戳 ∧ 水位**严格等于**旧默认 0.01」才迁到现默认，带戳新档一律不动（用户可自由设 0.01，save/load 往返恒等）。**新增存档键必须自证有读侧消费者**——本键的消费者就是 loadState 那三行' | `浪死平` | - |
| '**形态门控只许能力旗标，禁止 id 字符串现判（2026-10-04 修复，锐评 P2-2）**：`effectiveWaveHeight` 的上钳（波峰不越壁顶）曾在三处按形态 id 现判、构造期还用 `forPool` 兼职——而 `WaterBodyStrategy` 的设计承诺是，id 现判让新形态（ocean 等）**静默走无壁分支**（浪漫过容器、编译器一言不发）。现 `hasWallCeiling` 进策略接口（与 wetnessGated / supportsVolumeOptics / supportsRoundness 并列），`WaterBuildContext.buildMaterial` 的 `{ forPool, hasWallCeiling }` 两维刻意不合并（未来 ocean 可能「有体积光学但无壁」）；守卫 = 旗标断言 + **源码扫描闸**（水源码文本内不得出现按 id 现判 pool 的模式——注释里写该字面量也会被闸住，改用文字描述）' | `新增形态 = 注册一项、现有实现零改动` | - |
| '**死代码与自证式测试（2026-10-04 修复，锐评 P3-1/P3-2）**：① `disposeWater` 曾读 `material.transmissionRenderTarget` 手动释放——该属性在 three r186 的 `MeshPhysicalMaterial` 上**不存在**（真身在 renderer 侧 `renderState.state.transmissionRenderTarget[camera.id]`，由 renderer 按相机持有与清理），生产路径恒不触发；锁它的用例靠测试**自己伪造该字段**再断言被释放（自证式假绿），已随死代码一并删除。② 官方 `Reflector.dispose()` 只放 RT + 材质、**不放构造期传入的几何**——`disposeReflector` 补具名释放，注释从（当时不实）改为事实描述。③ `renderReflection` 的 `camera.updateMatrixWorld()` 备注曾称「否则镜像滞后一帧抖动」——RT 渲在 render-host 的 caps.update 段、早于本帧相机输入，该行只保证「矩阵不落后于属性」、消除不了跨帧输入滞后，注释已订正。教训：**「注释承诺 > 实现」是本仓最重视的漂移**；给「已释放 / 已处理」写断言前，先查上游源码到底释放了什么' | `RT + 材质 + 几何具名释放` | - |
| '**滑杆值 ≠ 生效值：必须给出口（2026-10-04 修复，锐评 P1-2）**：浪高滑杆值受水位 / 池深预算钳制（`water-params.ts\|effectiveWaveHeight`），默认档 0.15→1.0 整段拖动**毫无反应**（85% 死区）却无任何解释。修复 = slider 臂补 **hint 槽位**（动态 `getHint` 优先、静态 `hintKey` 回退；`getHint` 由 button 专属提升为通用通道，渲染于 label 右侧小字），浪高显示。⚠️ **刷新顺序是坑**：`onChange` 内 `updateDisplay(n)` **先于** `v.setValue(n)`，而 hint 读 cap 状态 ⇒ 只在 `updateDisplay` 刷会**滞后一步**（显示上一拍的值）；须在 `setValue` 之后补刷（numeric 输入路径同）。新增任何「值 ≠ 生效值」的参数时，先问：用户从哪里知道实际生效多少' | `实际生效 X m` | - |
| '**可见性单门 + 一形态一旋钮（2026-10-04 修复，锐评 P2-1）**：① 水面可见性曾与 film 的 `wetness > 0` 相与——把拖到 0，一级行 master 开关仍显示 ON 而场景无水（对开关撒谎，与 fog/reflector 已治的同族病）；现收归**单门** `envState.waterEnabled`。② film 的 alpha 曾 = `opacity × wetness`（两个旋钮一个自由度，用户不知该转哪根）；现 **film 下隐藏 `waterOpacity`**，浓度由 wetness 独占 ⇒ 一形态一旋钮。③ 旗标 `wetnessGated` | `水膜浓度` | `wetnessScalesOpacity`（它已不再管可见性，名字必须跟着语义走）。**判「两参数是否重叠」的方法** = 问「能不能构造两组不同取值而画面完全一致」（`(0.5,0.5)` vs `(0.25,1.0)` 即实锤）。另：旧用例「film wetness=0 → 不可见」在 `waterEnabled` 默认 false 下**恒真**（从未开水）——**改默认值会让老断言变成恒真**，改默认时须回扫本 cap 全部断言' |
| '**倒影 RT 的 MSAA 是隐形成本（2026-10-04 修复，锐评 P2-3）**：three 上游  默认 `multisample = 4`（构造参数缺省），叠加 half-float ⇒ 2048 档约 **134 MB**（本仓 schema 原先只按分辨率档计价，读者易以为 33 MB）。现 `water-reflect.ts\|ensureReflector` 显式传 `multisample: 0`：实付 ≈ 边长²×8B（512 档 ≈ 2 MB / 2048 档 ≈ 33 MB）。倒影经水 shader 斜率扰动采样 + fresnel 混合，边缘抗锯齿的边际收益不抵这笔显存/带宽。行为断言 = `getRenderTarget().samples === 0`（**别只断言源码里写了 multisample**）' | `Reflector` | - |
| "**拦截键是 exe 镜像路径在 AI 代理工作区内，与文件名/哈希无关**（2026-09-27 四组对照实验实锤）：仓内 bin 的 exe 必失败，复制到 %TEMP% 原名跑零失败；从未被标记的探针复制进 bin 立即失败" | - | - |
| 症状极具迷惑性：读全正常 + 目录 ACL/属主全正常 + 代码就是裸 os.CreateTemp（`go/fsutil/write.go\|createTempFile` = os.CreateTemp 无花样），会把排查引向死胡同 | `代码 bug / ACL / 目录锁 / 沙箱令牌` | - |
| "**火绒（HipsDaemon 在跑）是被冤枉的红鲱鱼**：其防护记录无任何 YSM 条目（仅无关 ssh.exe）；不等于「是它干的」，先看它的防护记录有无条目再定罪" | `有安全软件在跑` | - |
| ACL 里的 CodexSandboxUsers:(RX) 继承项（Codex CLI 沙箱产物）同样是无害红鲱鱼；AI 代理 shell 令牌经 whoami /groups 核实无沙箱组，前后台任务写探测均成功 | - | - |
| 变量剥离要彻底：第一次换名实验同时改变了两个变量，差点把「按名字拦截」的错误结论写进卡里——**一次只动一个变量** | `名字+位置` | - |
| 手写动画解析 | - | 与基岩版 animation.json 语义不一致；必须经 ysm-animation-player |
| Molang 求值未缓存 | - | 每帧重复求值、性能差；必须缓存 Molang 表达式 |
| 预览错 ≠ 文件坏：cube 的 origin/size/uv 是反推猜测，模组直读烘焙数据所以游戏内正常；骨骼姿态差异先怀疑反推误判 | - | - |
| 复杂嵌套旋转 / 极近重合顶点 / 非标准几何体：反推可能误判 pivot 或 rotation | - | 关联部件错位甚至方块崩溃，这是上游已知限制，不要在几何反推端打补丁硬修 |
| WASM 更新需双向同步：WASM 资产（两个 *-data.js）与模组侧同一 C++ 源码但导出面不同，更新需逐端同步重出 | - | - |
| UV 解析多种形态： 兼容数组 `[x,y]`、对象 `{uv,uv_size}`、JSON 字符串 faceUV、兜底 `[0,0]`，贴图错位优先排查此处而非几何本身 | `parseBedrockGeometryFromJSON` | - |
| texture slot 绑定规则：第 i 个模型 | - | 第 i 个纹理，错位需按此顺序排查 |
| emscripten -sSTANDALONE_WASM 默认 -sFILESYSTEM=0 且无 path_open 导入——saveToDirectory/fopen 必然 abort，产物必须内存直出 | - | - |
| standalone 默认 --no-growable-memory --initial-heap=16MB——大模型 OOM→bad_alloc→std::terminate（unreachable）；必须 -sALLOW_MEMORY_GROWTH=1 | - | - |
| emscripten -fexceptions 走 JS 垫片（env.invoke_* + __cxa_throw），wazero 原理上无法复刻（宿主不能撕 wasm 调用栈）；必须 -fwasm-exceptions（native EH）或 -fignore-exceptions | - | - |
| wazero v1.12 的 native EH 仅支持 exnref 且验证器对复杂 exnref 模块 panic（markLocalInit nil map）——生产化前需 wazero 升级或走 -fignore-exceptions | - | - |
| wazero 实例化会自动跑 _start（WASI command 约定），CLI11 空参 throw=trap；必须 WithStartFunctions() 清空 + 手动调 __wasm_call_ctors | - | - |
| 手写 YSM 字节流解析 | - | 与 YSMParser WASM 输出不一致；必须经 ysm-wasm |
| wasmBinary 未释放 | - | 内存泄漏；必须复用 wasm 实例并释放 |
| Worker 内静态 import WASM 数据模块 | - | 另一变体成 1.5MB 死重；必须动态 import |
| vite worker.format 未设 es | - | iife 强制 inlineDynamicImports，动态 import 构建直接失败 |

---
<!--  END_GENERATED_SECTION -->
