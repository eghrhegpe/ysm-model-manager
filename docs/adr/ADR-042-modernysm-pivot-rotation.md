# ADR-042：渲染复现借鉴上游 ModernYSM：二进制直读 pivot/rotation 与动画纯计算移植

- **状态**：✅ 已采纳
- **实施状态**：查知识卡 [go-threejs](../knowledge/go-threejs.md) / [animation-system](../knowledge/animation-system.md)（ADR 只记决策方向，不记实施进度）
- **日期**：2026-08-09
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`upstream/ModernYSM-1.20.1-forge` / `go/threejs/spec.go` / `frontend/src/utils/3d/model3d.ts` / `frontend/src/utils/animation/` / `docs/knowledge/ysm_baked.md` / `docs/knowledge/animation-system.md` / `tests/port-verification/`

---

## 1. 背景（Context）

本项目复现游戏内渲染长期受阻，核心症结在 **3D 坐标反复修**（`docs/pitfalls.md` #11，model3d.ts 9 次 fix 全项目第一、pivot X 取反口径反复翻车）与 **动画静止**（molang 未求值、`evaluateClip` 无运行时消费方，`docs/knowledge/animation-system.md:83-88`）。两处根因都源于**缺乏游戏端权威参照**：

- **几何坐标**：ADR-041 已将 Go spec 对齐到 **YSMViewer**（C# `ThreeJsPayloadBuilder`），但 YSMViewer 是"预览器"口径，与**游戏内部**的骨骼矩阵算法并不完全等价。
- **动画/molang**：当前 `animation.ts` 只做关键帧 JSON 解析，molang 表达式**不解释执行**（仅 `isMolang`/`foldMolangConstant` 常量折叠，含变量一律判 null 用 0 填充），动画因此停在默认姿态。

本 ADR 引入**第三个权威参照**：上游 `upstream/ModernYSM-1.20.1-forge`（开源 Java 版 Minecraft 模组，直接消费 .ysm 渲染进游戏）。它的价值：

1. **二进制直读**：游戏端不反推 cube 语义——`YSMBinaryDeserializer.java:463-498` 从 .ysm 二进制**直读 bone 层的 pivot/rotation（原始保留值）**，cube 仅保留烘焙 quad（4 顶点 + 法线 + UV）。反推猜测的逻辑（YSMViewer/YSMParser 与预览共用）是预览错位的根源，`docs/knowledge/ysm_baked.md:29-42` 已确认「预览语义 = 反推结果，可能猜错」。
2. **权威矩阵算法**：`NativeModelRenderer.calculateBoneMatrix`（`NativeModelRenderer.java:177-249`）是游戏环境每帧骨骼变换的全部逻辑，有明确的 pivot 平移（X 取负）、旋转序（Z→Y→X）、scale=0 隐藏联动等细节，是 pitfalls #11 反复修的重灾区答案。
3. **动画/molang 纯计算**：`geckolib3/core/` 下关键帧插值、blend、transition、molang builtin math、First/SecondOrder 物理**零 MC 依赖**，可直接移植 TS，把「动画静止」链路复活。

> 与既有基准的关系：ADR-041 对齐 **YSMViewer（预览器）**，本 ADR 对齐 **体素游戏模组（游戏内）**。两者目标场景不同，可互为交叉校验；数值冲突时以「能同时通过前端视觉验证 + 模组/Viewer 截图对比」为最终口径。

## 2. 决策（Decision）

**以 `ModernYSM-1.20.1-forge` 为游戏内渲染权威参照，落地三条不变量：**

### 2.1 权威骨骼矩阵算法（calculateBoneMatrix 口径表）

游戏内每帧骨骼变换以 `NativeModelRenderer.calculateBoneMatrix`（`NativeModelRenderer.java:177-249`）为权威，抽象成 Go/前端共用口径表，逐条对照审计 `go/threejs` 与 `model3d.ts`：

| 要点 | 游戏内实现 | 对照对象 | 审计结论 |
|------|-----------|---------|------------------------|
| **pivot 平移** | `translate((pivotX - animTx), (pivotY + animTy), (pivotZ + animTz)) × 0.0625`，**X 取负** | `spec.go:528` 等 12 处 localPosition | ✅ Go `localPos={pp.x-bp.x, bp.y-pp.y, bp.z-pp.z}` 已 X 翻转，口径一致（YSMViewer C# ConvertBones 同款） |
| **旋转序** | `rotateZ → rotateY → rotateX`（Z→Y→X） | `eulerToQuaternion(-rx,-ry,+rz)`，ADR-041 | **采用 ZYX intrinsic 口径**：`eulerToQuaternion` 按 `M = Rz*Ry*Rx`（对齐 Blockbench `Format.euler_order='ZYX'` + Three.js `Euler(order='ZYX')`；单轴旋转四元数不变）。验证记录见 `tests/port-verification/` 与知识卡 go-threejs |
| **cube 变换链** | `parseCube` L659 `origin[0]*=-1` + L662 `from[0]=-(from[0]+size[0])`；`updateTransform` `mesh.position=cube.origin-parent.origin` | `buildCubeMeshData`/`applyInflate`/`resolveCubePivot`/`computeMeshLocalPos` | **补 3 层 Blockbench X 镜像/翻号**：(1) cube origin X 镜像 `ox=-(ox+sx)`；(2) cube pivot X 翻号 `cp[0]=-cp[0]`；(3) mesh localPos[0] 符号 `bonePivot.x+cp[0]`。逐顶点对拍验证见 `tests/port-verification/compare-cube-vertices.mjs` |
| **scale** | `scale==0 → 不可见`（三轴全零才隐藏），普通 scale 组合 | spec LocalRotation/Scale | **前端动画管线支持 scale 累积**：`BoneChannels.scale` → `evaluateClip` 父子累积 → `ysm-animation-player.ts` 应用；`scale=0 → node.visible=false` 对齐上游 calculateBoneMatrix:213-215 |
| **隐藏联动** | **父不可见 → 子必不可见**（`NativeModelRenderer.java:186-189`） | `bone-visibility.ts` setBoneVisible | **父隐子隐由递归实现**：`setBoneVisible` 用 `g.traverse` 递归设置子骨骼 visible（`THREE.Object3D.traverse` 天然满足） |
| **背面剔除** | cullable quad 做仿射投影 `det <= 0` 剔除（`det > 0 才画`） | 与 three.js 默认背面剔除口径核对 | ✅ 前端统一 `side: THREE.FrontSide`（model3d.ts:339/344）+ `alphaTest 0.1`，与 Java 正向剔除语义一致（y 轴向上约定下同向） |
| **发光骨骼** | `bone.glow` → 全亮 `LightTexture.pack(15,15)` | spec glow 通道 | **glow 通道落地**：Go `spec-bones.go isGlowBone` 检测 `ysmGlow` 前缀 + `BoneData.Glow`；前端 `SpecBone3D.glow` → `mesh-builder.ts` 用 `MeshStandardMaterial + emissive/emissiveIntensity/emissiveMap` 模拟全亮渲染（回归测试 `tests/verify-adr-042.mjs`） |
| **世界坐标回填** | `unk3==1` 骨骼写回 stateBuffer（`m30/m31/m32 × 16`）供 molang 读绝对位置 | 移植 `bone_position_abs` 类函数依赖 | **无需实现**：上游 unk3==1 写 stateBuffer 是 GPU 渲染内部用（calculateBoneMatrix:234-242）；Three.js CPU 渲染用 `THREE.Bone.getWorldPosition()` 替代 |

### 2.2 二进制直读 pivot/rotation —— 根治反推猜错（远期攻坚项）

**决策方向**：在 WASM 解码链（`frontend/src/wasm/ysm-parser.ts`）+ Go 兜底（`internal/app/wasm_decoder.go`）产出物中，**直接从二进制导出 bone 层原始 pivot/rotation**，与反推后的 Bedrock JSON 一起下发；渲染端骨骼坐标**优先使用原始 pivot/rotation**，反推结果仅作兜底与显示用途。

理由：游戏端（`YSMBinaryDeserializer.java:463-498` + `YSMClientMapper.java:452`）用的是原始保留值，从不反推，所以游戏内永远正确；反推猜错（复杂嵌套旋转 / 重合顶点崩溃，`ysm_baked.md:58`）是预览特有的已知限制，本项从根上消除。

> **已确认**：C++ 解析器（`YSMParserV3.cpp:862-876`）已从二进制直读 bone 层原始 pivot/rotation（原始单位为弧度），导出到 `minecraft:geometry` JSON 时做符号修正——pivot X 取负、rotation X/Y 取负并转度、Z 不取反；`go/geometry/parse.go` 读到的即为原始值。
>
> 尚未解决的是 **cube 层反推猜错**：C++ 解析器导出的 cube 是烘焙 quad（4 顶点 + 法线 + UV），不是 Blockbench 的 `origin/size` 格式，`restore_blockbench_cube` 从 quad 反推 `origin/size` 时复杂嵌套旋转会猜错。此问题属另一条链路，与本 §2.2 的 bone 层直读无关。

> ~~可行性约束：WASM 导出的是反推后的 `minecraft:geometry` JSON，是否保留 bone 原始 pivot/rotation 需评估 YSMParser C++ 侧是否已保留。若 C++ 侧未导出，需在解析层补充导出或在 Go 侧直接二次解析二进制字节流。~~ → **可行性已解除**：C++ 侧已保留并导出 bone 原始 pivot/rotation 到 geometry JSON。

> 过渡性口径（code_review P2）：Go 兜底侧（`go/geometry/parse.go` + `go/threejs/spec.go`）以 `PivotSet` 标志（`*[3]float64` nil=缺席）判定 cube pivot 缺席——显式 `pivot:[0,0,0]`（绕模型原点旋转的铰接件）不再被误判为缺失、旋转中心不漂移。与本 ADR「优先原始 pivot 值、不猜符号」方向一致（详见知识卡 `go-threejs` 不变量段、`docs/pitfalls.md` #17）。

### 2.3 动画/molang 纯计算移植 —— 复活「动画静止」链路

**决策方向**：从 `geckolib3/core/` 移植可脱离 MC 的纯计算模块，替换当前 `animation.ts` 仅解析不执行的状态：

1. **关键帧插值**：`LinearKeyFrame` / `CatmullRomKeyFrame`（四控制点）+ `EasingType` + `InterpolationLookup.getAtTime(tick)`；
2. **混合 blend**：`BoneBlendState`（rotation `nlerpEulerAngles`、scale `lerpAnglesInPlace`、按 `blendWeight` 累加多源）；
3. **过渡 transition**：`TransitionKeyFrame` → 队列换 `TransitionPoint` → `ConstantPoint` 收尾；`AnimationControllerRuntime.evaluateTransitions` 的 onExit/onEntry 状态机；
4. **molang builtin math**：`geckolib3/core/molang/builtin/math/`（Sin/Cos/Atan2/Lerp/LerpRotate/Clamp/HermitBlend/Random/DieRoll/MinAngle…）整套直译；
5. **物理**：`FirstOrder`（一阶惯性）+ `SecondOrder`（四阶欧拉弹簧-阻尼，带 `maxTimeStep` 自适应子步防爆）+ `PhysicsManager.update`；
6. **YSM 特有**：`BoneRotation.java:21-34` 的 **x/y 取负转度** 反号约定（模型坐标反复修的源头之一），`BonePosition`/`BoneScale`、`Perlin`。

> 注意：molang 求值器核心在独立包 `com.elfmcys.yesstevemodel.molang`（入口 `MolangParser.java:19-25`），不在 geckolib3 内，需一并移植。particle/sound/sync 是环境副作用，Web 侧做 facade。状态机选择器（`AnimationController + AnimationState + AnimationControllerRuntime` + predicate 优先级 HIGHEST→LOWEST）可在输入环境 API 就绪后接入。

> **收敛度**：基础动画链路已通（关键帧插值 → molang 求值 → 应用到 `THREE.Bone`），详见知识卡 `animation-system` 承接段；剩余增强项为 **blend（多源混合）+ 状态机（AnimationController predicate 优先级）**，属"让切换平滑"而非"让模型动起来"。
>
> **molangjs 内嵌策略**：npm 的 molangjs 包因 `"type":"module"` + CJS dist 混用在 Node 测试环境连续报错，本项目采用**源码内嵌**——`frontend/src/utils/animation/molang-lib/` 保留 JannisX11 molangjs（MIT，Blockbench 官方依赖）原始版权头，本地路径 import，彻底避开 ESM/CJS 混用坑。单例 parser + `cache_enabled=true`（400 条 LRU），未知 query/variable → 0 优雅降级，Infinity/NaN → 0 守卫。

### 实施顺序（按性价比）

1. **先做 2.1**：把 `calculateBoneMatrix` 整理成审计表，逐条对照 `go/threejs` 并补测试（隐藏联动、X 取负、旋转序、glow）；这是 pitfalls #11 的直接答案。
2. **再做 2.3**：移植关键帧 → 数学 → 物理 → blend → transition，把 P3「动画静止/molang 未求值」链路复活。
3. **远期攻坚 2.2**：评估二进制直读 pivot/rotation 取数；可行性成立则排为一个独立 ADR 细化解析实现。

## 3. 后果（Consequences）

### 正面
- **出根因**：以游戏内权威矩阵 + 原始 pivot/rotation 替代"反推 + 猜符号"，消除 `model3d.ts` 反复修坐标的根源。
- **一条参照，全链受益**：坐标（2.1）、动画/molang（2.3）、材质（glow）、隐藏逻辑共用一张权威口径表。
- **动画复活**：molang 解释 + 插值/blend/transition 落地后，从"静止在默认姿态"→"按动画文件驱动"，对游戏复现价值最高。

### 负面 / 风险
- ~~**2.1 是视觉变更**：旋转序/背面剔除若与现行 three.js 有差异，可能引起视觉回退；须以对比测试 + 截图回归保障，不应盲回盲改。~~ → **风险已消解**：旋转序按 ZYX intrinsic 落地，旧单轴断言仍 pass；视觉验收以「与 Blockbench 打开同一模型渲染一致」为基准（验证记录见知识卡 go-threejs）。
- **2.2 取数成本未定**：WASM C++ 侧是否保留原始 pivot/rotation 需验证；若需 Go 二次解析，工作量大。
- **2.3 scope 大**：完整移植含 molang 求值器 + 状态机，需分阶段，先 inner 计算后 facade。
- **双基准歧义**：ADR-041 的 YSMViewer（C#）与本 ADR 的模组（Java）冲突时无现成裁决准则；需人工视觉验证定夺，避免单一基准反复。

### 已知遗留
- 游戏内 layer 链（手持/鞘翅/鹦鹉/护甲，`CustomPlayerRenderer.java:35-39`）依赖 MC 渲染栈，Web 端不移植；仅当未来复现"手持 + 护甲"时参考渲染顺序。
- Native GPU 缓存路径（`GeoModel.java:252-300`）不借鉴，three.js 自带合并。

## 4. 数据溯源

| 来源 | 结果 |
|------|------|
| `upstream/ModernYSM-1.20.1-forge/common/.../geckolib3/geo/NativeModelRenderer.java:177-249` | calculateBoneMatrix 权威矩阵算法（pivot X 负数 / Z→Y→X / scale=0 隐藏联动 / glow / 世界回填） |
| `upstream/ModernYSM-1.20.1-forge/common/.../resource/YSMBinaryDeserializer.java:463-498` | 二进制直读 bone pivot/rotation 原始保留值，cube 仅烘焙 quad |
| `upstream/ModernYSM-1.20.1-forge/common/.../client/animation/` + `geckolib3/core/` | 关键帧/LinCatmullRom/Transition、BoneBlendState、molang builtin math、First/SecondOrder 纯计算 |
| `docs/knowledge/ysm_baked.md:29-42,58` | 「预览 = 反推，可能猜错」已确认；反推限制列为本 ADR 2.2 根治对象 |
| `docs/knowledge/animation-system.md:83-88` | molang 未求值、evaluateClip 无消费方，本 ADR 2.3 复活 |
| `docs/pitfalls.md:64-68`(#11) | 坐标反复修，本 ADR 2.1 提供权威答案 |
| `ADR-041` | 已对齐 YSMViewer（C# 预览器），本 ADR 补充模组（Java 游戏内）参照，交叉校验 |
