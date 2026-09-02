---
kind: animation-system
name: 动画系统 animation
tier: architecture
category: utils
source_files:
  - frontend/src/utils/animation/animation.ts
  - frontend/src/utils/animation/animate.ts
  - frontend/src/utils/animation/stagger.ts
  - frontend/src/utils/animation/molang.ts
  - frontend/src/utils/animation/animation-controller.ts
  - frontend/src/utils/animation/molang-lib/molang.js
  - frontend/src/utils/animation/molang-lib/easing.js
  - frontend/src/utils/animation/molang-lib/math.js
  - frontend/src/utils/animation/molang-lib/molang-prism-syntax.js
  - frontend/src/preview-3d/ysm-animation-player.ts
tests:
  - frontend/src/utils/animation/animate.test.ts
  - frontend/src/utils/animation/animation.test.ts
  - frontend/src/utils/animation/stagger.test.ts
  - frontend/src/utils/animation/animation-controller.test.ts
quick_groups:
  - 3D 预览与模型追加
quick_intents:
  - 骨骼动画、关键帧、动画播放
  - Molang 表达式求值
  - 数字滚动、stagger 入场、关闭动画
  - AnimationController、状态机
quick_risk_lines:
  - 基岩 animation.json 解析后必须走 evaluateClip 插值，禁止前端手写关键帧插值逻辑
pitfalls:
  - 手写关键帧插值 → 与基岩官方行为不一致、T-pose 漂移；必须经 evaluateClip
  - Molang 表达式缓存键不完整 → 相同逻辑不同骨骼重复求值；缓存 key 必须含 clip/bone 标识
use_when:
  - 动画
  - 骨骼动画
  - 关键帧
  - Molang
  - 数字滚动
  - stagger 入场
perf:
  - cpu-bound
invariant_anchors:
  - frontend/src/utils/animation/animation.ts|parseBedrockAnimationJSON
  - frontend/src/utils/animation/animation.ts|evaluateClip
  - frontend/src/utils/animation/animate.ts|animateNumber
  - frontend/src/utils/animation/stagger.ts|stagger
status: active
---

# 动画系统 animation

## 概览

前端动画体系分两层：**模型骨骼动画**（基岩版 animation.json 解析 + 关键帧插值求值）与 **UI 动效**（数字里程表滚动、stagger 入场延迟）。UI 层的 CSS 动画可被全局 `no-animations` 开关关闭。

## 核心职责

- 基岩版动画 JSON 解析（loop/animation_length/bones 三通道关键帧；Molang 表达式检测并跳过）
- 关键帧插值求值（线性/step）与骨骼层级变换传播（父级变换累积到子级）
- UI 数字滚动动画与列表 stagger 入场延迟计算
- **Molang 表达式编译**（ADR-100 L4）：内嵌 molangjs 源码，把 `.animation.json` 里的 Molang 字符串编译为 `(animTime) => number` 求值闭包；安全口径：DSL 解析器非 eval；性能口径：LRU 缓存 400 条，加载期编译 AST / 运行期纯求值
- **`foldMolangConstant` 常量折叠已有 bench 实证**（`frontend/src/utils/animation/bench-fold-molang.ts`，2026-09-01）：molangjs parse 本身仅 ~600ns，折叠正则 ~580ns，**收益 ≈ 0**——该优化目前"不亏不赚"，保留原因只剩「跳过闭包创建」，不值得为它扩展正则覆盖面；若未来重构解析链可整体移除，由 compileMolang 统一承接

## 对外 API / 入口

`animation.ts`（解析 + 插值）：
- 类型：`Vec3`、`Keyframe`（time/post/pre/lerp）、`BoneChannels`（rotation/position/scale）、`AnimationClip`（name/loop/length/bones/hasMolang）、`BoneTransform`、`BoneHierarchyNode`
- `parseBedrockAnimationJSON(jsonStr): { clips, errors }` — 解析 .animation.json；JSON 错误/缺 animations 字段进 errors；任一关键帧含 Molang 字符串则 clip.hasMolang = true
- `evaluateKeyframes(keyframes, t): Vec3 | null` — 二分查找 + 线性插值；step 模式直接取当前帧 post；catmullrom 模式取前后各一邻帧做 uniform Catmull-Rom（Hermite 等价，C1 连续）三次样条（`sampleCatmullRom`；官方 wine_fox 大量用 `lerp_mode: catmullrom`，此前被一律降级为 linear 是"动作僵硬/轨迹怪"根因，已支持）
- `evaluateClip(clip, time, boneHierarchy?, localOnly?): Map<string, BoneTransform>` — 整 clip 求值；循环动画时间取模；`localOnly` 只返回局部变换（Three.js 场景树自己传播时用），否则按拓扑排序把父级变换累积到子级

`animate.ts`：
- `animateNumber(el, to, duration=700): () => void` — 里程表式滚动进位（个位先转 → 十位 → 百位），替换元素文本中的首个数字串，返回取消函数（组件卸载时调用）

`stagger.ts`：
- `stagger(index, step=30, max=300): number` — 入场动画延迟毫秒数 `min(index*step, max)`，用于 `animation-delay:${stagger(i)}ms`

`molang.ts`（ADR-100 L4）：
- `compileMolang(expr: string): MolangFn | null` — 编译 Molang 表达式为求值闭包；表达式非法/为空返回 null（调用方走零占位降级）
- `MolangFn` 类型：`(animTime: number) => number`
- 嵌入策略：molangjs npm 包因 ESM/CJS 混用无法直接 import，本项目采用**源码内嵌**策略（`molang-lib/` 目录保留 MIT 许可原始版权头）
- 变量上下文：`query.anim_time` / `q.anim_time` / `query.life_time` / `q.life_time` / `query.delta_time` / `q.delta_time`
- 未知变量 → 0：mod 扩展的游戏态查询（`ysm.*`/按键/药效等）在预览器无宿主语境，优雅降级而非抛错

`animation-controller.ts`（动画控制器状态机，wine_fox 等模型支持）：
- `parseAnimationControllerJSON(jsonStr): { controllers, errors }` — 解析 `.animation_controllers.json`；缺 `animation_controllers` 字段进 errors；每个状态含 animations 列表 / on_exit 动作 / transitions（target→Molang 条件表达式）/ blend_transition（缺省 0.2s）；**空条件表达式 = 显式无条件转换（unconditional=true，总是触发）**；首个遇到的 state 作为初始状态
- `AnimationControllerRuntime` — 运行时状态机：`update(dt)` 每帧评估当前状态转换条件（首个满足的触发，condition 用 `animTime=timeInState` 求值），触发时先执行当前状态 on_exit 再切状态并回调 `onStateChange(animationName, blendTime)`；条件编译失败（condition=null 且非 unconditional）→ 跳过不触发（不 fail-open）
- `findControllerForAnimation(controllers, animationName): AnimationController | null` — 按动画名反查控制器
- 与 Timeline 配合（Bedrock 官方设计）：Timeline 经 molang `setMolangScope` 写 `v.*` 变量（每播放器持久作用域跨帧可见），Controller 条件读 `v.*` 决定状态切换；v.* 跨帧持久化依赖 molangjs 核心，弹簧物理等场景需改 molangjs 核心（已知限制）

## 与其他子系统关系

- `parseBedrockAnimationJSON` 消费方：`preview-3d/decoder/wasm-decode.ts`（+`loader.ts`，WASM 解码出的动画 JSON，ADR-137 归位）
- `BoneTransform` 类型被 `utils/model2d.ts` 引用（动画驱动 2D 姿态）
- `animateNumber` 消费方：`app-tree/render.ts`、`app-sidebar/events.ts`（统计数字滚动）
- `stagger` 消费方：`app-content/index.ts`、`app-sync-manager/tpl.ts`、`dialogs/batch-rename.ts`、`features/community/render.ts`、`app-content/site/render.ts`（卡片入场）
- 全局开关：`app-modules.ts` 按设置切换 `document.documentElement` 的 `no-animations` class；CSS 侧对卡片/弹窗/主题动效统一 `animation: none !important`
- **Molang 消费方**：
  - 解析阶段（`animation.ts`）：`parseAxisItem`（L127）/ `parseKeyValue`（L143）/ `extractKeyframe`（L167）调用 `molang.ts` 的 `compileMolang`（L71）
  - 求值阶段（`animation.ts`）：`resolveFramePost`（L515）/ `evaluateKeyframes`（L558）/ `evaluateClip`（L654）调用编译后的 `MolangFn`

## 上游留档：YSMParser 动画模型 ID 映射（v0.3.6）

`GetAnimationModelName(modelId, isNewVersion)`（`upstream/YesSteveModel-Parser/YSMParser/parsers/v3/YSMParserV3.cpp:136`，调用点 :2222/:2329/:2655）把动画文件内部的 modelId 翻译成模型名：

| ID | 新版本（v3+） | 旧版本 |
|----|--------------|--------|
| 1 | main | main |
| 2 | arm | arm |
| 3 | extra | extra |
| 4 | tac | tac |
| 5 | arrow | arrow |
| 6 | carryon | carryon |
| 7 | parcool | parcool |
| 8 | swem | swem |
| 9 | slashblade | slashblade |
| 10 | tlm | tlm |
| 11 | fp.arm | fp_arm |
| 12 | immersive_melodies | immersive_melodies |
| 13 | iss | irons_spell_books |

**利用判断（2026-08 结论）**：该映射已**体现在解码产物文件名**（`model/animations/main.animation.json`、`arm.animation.json`…），产物侧不存在需要 modelId 的断点，项目未引入 modelId 消费路径。此表仅作**未来「动画按组件归属播放」的命名参考**：按动画文件名前缀归属组件（复用多组件解析的 `orderedNames` 组件序与 `IsMainModelName` 分类），与模型 ID 表同构但不依赖它。

## 不变量

- Molang 表达式不解释执行：检测到即标记 hasMolang 并跳过该值（避免 eval 任意表达式）；注意实现细节——**直接字符串帧被跳过 ✓，但数组含 Molang 轴被零填充保留**（`animation.ts` Molang 跳过逻辑），`hasMolangInChannelData`（`animation.ts` Molang 检测函数）只识别字符串值（对象/数组/纯数字键均不会被判为 Molang，属宽松误判风险）；**Molang 只是标记不拦截求值**（零填充帧仍被当真实关键帧插值，P3 观察）
- evaluateKeyframes 对空数组/越界时间返回端点值或 null，不抛异常（`t=NaN` 时二分插值产生 NaN 向量，无守卫，P3 观察）
- `no-animations` 开关作用于 CSS animation；JS 驱动的动画（模型动画求值/数字滚动）不受该 class 影响，属模型数据呈现而非装饰动效
- **molangjs 全容错原语（2026-08-25 实测）**：molangjs 用容错解析器——对 `"("`、`"@@"`、`"1..2"`、`"query."` 等任意非法/残缺 token 都不抛错、直接返回 0。故 `compileMolang` 走「解析异常→返回 null」的路径在真实世界中几乎不可达，`parseAnimationControllerJSON` 上报「转换条件编译失败」与运行时「condition=null 跳过不触发」均为几乎不触发的防御分支（测试用构造对象直接命中），属低价值死防御，可作后续清理候选
- **molangjs 全容错**（见上）亦意味着 Molang 条件「真值」判定需注意：未识别表达式稳定返回 0 = 恒假，不会误触发转换
- 播放循环（RAF）由消费方组件自行管理并须在卸载时 cancelAnimationFrame；曾有的 AnimationPlayer 封装类因长期无消费方已在死代码清理中移除，如需播放器请基于 evaluateClip 重建
- **求值链路运行时消费方**（2026-08-21 更新）：`evaluateClip` 由 YSM 动画播放器消费（`preview-3d/ysm-animation-player.ts`，ADR-100 L1-L3，每帧 localOnly 求值驱动骨骼 Group）；`parseBedrockAnimationJSON` 消费方 `preview-3d/decoder/wasm-decode.ts`（+loader.ts，ADR-137 归位）与 `ysm-adapter.ts`（动画扫描）；`animateNumber` 实际返回取消函数 `() => void`（**JSDoc 已标注 `@returns 取消函数`**），消费方 app-tree/render.ts、app-sidebar/events.ts **忽略取消函数**（快速连续渲染叠加未清理 timer，P3 观察）；`isMolang` 已删除（旧文"死代码"断言过时——已彻底移除）
- **层级传播未应用父级旋转**（`animation.ts` 层级传播逻辑，P3 观察）：注释声称「子级位移经父级旋转后」累加，实现却是纯向量相加 `pp+cp`、旋转仅欧拉角分量相加——父级非零旋转时传播结果错误；求值链路休眠态无运行时影响，属唤醒前的设计降级点（唤醒需先补旋转矩阵/四元数传播，测试仅覆盖无旋转父级）
- **旋转通道口径（2026-08-24 定版）**：`parseBedrockAnimationJSON` 出口的 rotation 通道统一做**度→弧度 + X/Y 取负、Z 不取负**换算（`convertRotationKeyframes`，对齐上游 ModernYSM/TLM 共同口径 `RawBoneKeyFrame.init` + `RotationValue.convert`）；Molang 动态轴包求值后换算闭包（molang 三角函数按度求值）。此前缺失导致 bedrock 的度被当弧度直喂 Euler（45°→2578°），是预览角色乱飞根因。下游全弧度域：player 直接 `Euler(rz,ry,rx,'ZYX')`；位移通道保持像素原值 + X 取负叠加 pivot（player 层做）。测试夹具手工构造的 Keyframe 绕过解析层，须自备弧度值
- **消费方文件名漂移已修正**（2026-08-09；2026-08-31 ADR-137 再迁 decoder/wasm-decode.ts）：`parseBedrockAnimationJSON` 消费方为 `preview-3d/decoder/wasm-decode.ts`（+loader.ts，旧文 preview-wasm.ts 已过时）；stagger 消费方含 `app-content/site/render.ts`（旧文 site-view.ts 过时）；测试文件均为 `.ts`（旧文 .js 过时）

## ADR-015 UI 动效实施进度（v1.7.6 已全部落地）

| 优先级 | 项目 | 状态 |
|--------|------|------|
| P0 | 对话框入场/退场动画 | ✅ |
| P0 | 按钮 `:active` scale 反馈 | ✅ |
| P1 | 页面切换淡入 | ✅ |
| P1 | 模型树文件夹展开子行淡入 | ⚠️ 已禁用（`animation-fill-mode: both` 叠加虚拟滚动 `innerHTML` 替换导致滚动闪烁，见 `bug-chronicle.md`） |
| P1 | 预览面板内容过渡 | ✅ |
| P2 | 创作者频道卡片筛选淡出 | ✅ |
| P2 | 导入队列项目滑入 | ✅ |
| P2 | 设置页高级面板展开/折叠 | ✅ |
| P2 | 同步管理器标签切换过渡 | ✅ |
| P3 | 回收站项目动画 | ✅ |
| P3 | 资源管理器详情过渡 | ✅ |
| P3 | GitHub 仓库卡片交错入场 | ✅ |
| P3 | 诊断页面板切换交叉淡入 | ✅ |
| P3 | 批量重命名预览列表脉冲 | ✅ |
| P3 | 导航侧栏激活指示器滑动 | ✅ |
| 新增 | 一级 Tab 淡入+微下移（`fadeSlideDown`） | ✅ |
| 新增 | 二级菜单 淡入+微右移（`fadeSlideLeft`） | ✅ |
| 新增 | GitHub 仓库卡片 stagger + hover 上浮 + 图标旋转 | ✅ |
| 新增 | 预设搜索词 / 筛选标签 stagger 入场 | ✅ |
| 新增 | 设置页卡片 stagger 入场 | ✅ |
| 新增 | 关于页区块 stagger 入场 | ✅ |

## ADR-042 §2.3 动画纯计算移植进度（2026-08-24 核对）

基础动画链路已通——模型能按 `.animation.json` 动起来，不再是"静止在默认姿态"。

| 子项 | 状态 | 证据 |
|------|------|------|
| 关键帧插值 | ✅ 已落地 | `evaluateKeyframes` + `evaluateClip` 做插值 + 父子传播 |
| molang builtin math | ✅ 已落地 | `molang-lib/math.js`（Sin/Cos/Atan2/Lerp/MinAngle… 整套直译） |
| molang 求值器 | ✅ 已落地 | `molang.ts` `compileMolang` 返回 `(animTime) => number` 闭包，被 `animation.ts:115,140` 调用 |
| transition（跨 clip） | ✅ 已落地 | `selectClip` 从当前姿态采集 rest + alpha 归零，commit 163a6f09 |
| blend（多源混合） | ❌ 未接 | `grep blend` 整个 `frontend/src/utils/animation/` 零命中 |
| 状态机 | ✅ 已落地 | `animation-controller.ts` 解析 `.animation_controllers.json` + `AnimationControllerRuntime` 状态机（transitions/on_exit/unconditional/编译失败守护），`animation-controller.test.ts` 14 用例 |

molangjs 内嵌策略：npm 包因 `"type":"module"` + CJS dist 混用在 Node 测试环境连续报错，本项目采用**源码内嵌**——`frontend/src/utils/animation/molang-lib/` 保留 JannisX11 molangjs（MIT，Blockbench 官方依赖）原始版权头，本地路径 import。

## 相关

- [model3d](./model3d.md) / [model2d](./model2d.md) — 模型动画的呈现端
- [app_preview](./app-preview.md) — 动画解析消费方
- `frontend/src/utils/animation/animation.test.ts`、`frontend/src/utils/animation/stagger.test.ts` — 单元测试（验证入口）
