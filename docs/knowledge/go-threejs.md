---
kind: go-threejs
name: 3D 骨骼 spec go/threejs
tier: architecture
category: go
source_files:
  - go/threejs/spec.go
  - go/threejs/
use_when:
  - 3D 预览
  - 骨骼
  - three.js
  - spec
  - 顶点
  - UV
  - 四元数
  - 模型渲染
invariant_anchors:
  - go/threejs/spec.go|collectBonePivots
---

# 3D 骨骼 spec go/threejs

## 概览

`go/threejs/` 包根据 YSMViewer 的 `ThreeJsPayloadBuilder.cs` 移植，把已解析的 `types.BedrockModel` 转换为 Three.js 可直接消费的 JSON spec：顶点、法线、UV、骨骼层级与旋转四元数全部在 Go 端预计算，前端 `model3d.ts` 只负责渲染，不做几何计算。

## 核心职责

- `spec.go` — 骨骼层级构建（pivot 差值求局部坐标）、cube 网格生成（box UV 展开 / per-face UV）、同名骨骼去重合并、欧拉角转四元数

## 对外 API / 入口

- `Build(model types.BedrockModel) (string, error)` — 单组件构建入口，输入解析好的 BedrockModel，输出 JSON 字符串；无骨骼时返回 `"{}"`；内部委托 `buildModelGroup(model, compID, texIdxBase)`（骨架层构建由 `buildModelGroup` 抽取共用，`boneByName` 反查表建在 `boneIdx` 旁——两表语义不同：boneIdx 用 boneDone 去重、boneByName 保留 model.Bones 原始顺序供补充缺失骨骼/断裂父子链）
- `BuildMulti(models []types.BedrockModel, texIdxBase []int) (string, error)` — **多组件构建入口**（2026-08 多组件解析配套）：输入多个 BedrockModel（main/arm/arrow 等组件）+ 各组件纹理槽基址，复用 `buildModelGroup` 逐组件构建后合并为单一 spec（前端以 modelGroup 组件树 + compKey 骨骼作用域隔离渲染，`showModelGroup(-1)` 全部显示）
- 输出结构类型：`Model3DSpec`（models 列表）、`ModelGroup`（纹理尺寸/骨骼/网格组）、`BoneData`（localPosition + localRotation 四元数 [x,y,z,w] + parentId）、`MeshData`（positions/normals/uvs/indices/texIdx 纹理槽）
- **GetModel3DSpec 注入（internal/app）**：多组件分支在 spec JSON 上追加 `texArrOrder`（组件序期望纹理名，perComponent 组件为空串——前端 R1 校验跳过空值）与 `componentTextures`（`injectComponentTextures`，键 = `comps[i].SourceName` 如 "main"/"arm"/"arrow"，对齐 `BuildMulti` 输出的 `ModelGroup.Name`；SourceName 为空时 fallback `comp_<i>`，跳过空骨骼组件；值 = ADR-114 perComponent 同名纹理 data URI）。zip/7z/解压目录三路同源，前端 `preloadModel` 据此建 `componentTexMap`

## 与其他子系统关系

- 被 `internal/app/app_model.go` 调用（`threejs.Build` 生成 spec → Wails binding 下发前端）
- 上游输入来自 [go_geometry](./go-geometry.md) / [go_ysm_parser](./go-ysm-parser.md) 解析出的 `types.BedrockModel`
- 前端消费方：`frontend/src/preview-3d/model3d.ts`（Three.js 渲染）

## 不变量

- 骨骼局部坐标 = `bone.pivot - parent.pivot`；**欧拉角 → 四元数用 ZYX intrinsic 序（`M = Rz×Ry×Rx`）**，调用方传入已取反角度（`eulerToQuaternion(-rx, -ry, +rz)`——**Z 轴不取反**，源码 spec.go eulerToQuaternion / quaternion.ts eulerToQuaternion），对齐 Blockbench `Format.euler_order='ZYX'`（io/format.ts EulerOrder）+ Three.js `Euler(order='ZYX')`。ADR-041 旧口径 `M = Rx×Ry×Rz` 已被 ADR-042 §2.1 裁决取代（2026-08-22）。单轴旋转两口径四元数相同，三轴非零 cube 顶点修正
- 纹理尺寸为 0 时兜底 64×64
- **cube inflate/mirror 消费**（2026-08-09 补齐，对齐 Java GeoCube/GeoQuad 口径）：`inflate` 时几何 origin 各轴 -i、size 各轴 +2i（Go 端像素坐标直接算，无需 /16）；`mirror` 时 UV 水平翻转（u 交换，几何不翻转）。box UV 展开（`parseUV`/`expandBoxUV`）**必须基于未膨胀的原始尺寸 `c.Size`**——对齐 C# 黄金参考 `csharp-builder.mjs`（先 `expandBoxUV(原始 sz)` 再 inflate 几何），若用膨胀后尺寸 UV 范围漂移 → 贴图拉伸/塌缩成色块（P2）
- **负 inflate 下限防护**：inflate 超过半尺寸会把 cube 缩成负宽 → `hx2<0` 面翻转（法线反、正面剔除后不可见）；各轴 clamp 到 `thicknessEpsilon`（C# 黄金参考同缺陷，此为改进不背离）
- **cube 变换链对齐 Blockbench 活规范（2026-08-22，ADR-042 §2.1 裁决）**：Bedrock JSON cube → 渲染顶点须经 3 层 X 镜像/翻号，缺任一层都会导致裙子/小部件朝向错误（主题正确、小部件错）：
  1. **cube origin X 镜像**（`parseCube` L662 `from[0] = -(from[0]+size[0])`）— `applyInflate`/`buildCubeMeshData` 里 `ox = -(ox + sx)`，Bedrock JSON `cube.origin` 是"左下角"，Blockbench 内部 X 镜像到"右下角"
  2. **cube pivot X 翻号**（`parseCube` L659 `origin[0] *= -1`）— `resolveCubePivot`/`buildCubeMeshData` 里 `cp[0] = -cp[0]`，cube 旋转中心 X 翻号，与顶点 X 镜像配套
  3. **mesh localPos[0] 符号**（Blockbench `mesh.position = cube.origin - parent.origin`）— `computeMeshLocalPos` 里 `localPos[0] = bonePivot.x + cp[0]`（不是 `- cp[0]`），因 `cp[0]` 已翻号（= `-Pivot[0]`），`+cp[0]` = `bonePivot.x - Pivot[0]` = Blockbench 口径
  - 验证：`npm run verify:port`（`scripts/port-align.mjs`：Blockbench 权威 oracle × 多样性 corpus 全顶点对拍，无需 fixture），cube 几何 + localPosition + localRotation 全绿
- **cube pivot 缺席 fallback（PivotSet 语义，2026-08-09 code_review P2）**：cube 未显式声明 pivot（Blockbench 缺省）时，spec 用 cube 中心作为旋转中心（对齐 YSMViewer，修复 fox 解压目录模型 main 手臂消失 P1）；**判定必须用 `types.Cube2D.PivotSet`（解析层 `*[3]float64` nil=缺席）而非 `cp==[0,0,0]`**——显式 `pivot:[0,0,0]` 是绕模型原点旋转的合法铰接件，误判会漂移旋转中心。手工构造 Cube2D 的测试 fixture 须同步设 `PivotSet: true`（致命陷阱 #17）
- 同名骨骼合并：优先保留有 parent/有旋转的完整层级（main.json 覆盖 arm.json 的扁平版），cube 用 `mergeCubes` 重叠替换、非重叠保留
- **全组件默认可见（2026-08-23）**：`ModelGroup.DefaultVisible` 恒 `true`（前端 `model-group-builder.ts` 同步）——旧「仅 main 默认可见」已废除：主体不叫 main 的拆分模型（部分车万女仆等）会被整组隐藏，打开一片空，且 UI「全部组件」初始选中态与渲染矛盾。视锥剔除 bbox 只计可见子树（frustum-cull 修复②），全亮无「载具撑大 box→闪烁」顾虑；组件单选互斥切换（`showModelGroup(i)` / -1 全显）不受影响
- 坐标变换是高危区：前端 model3d.ts 历史 fix 次数全项目第一（致命陷阱 #11），改本包坐标/UV 前先 grep `bug-chronicle`，改完用自由相机近距验证
- **R31 修复链（2026-08-31）**：
  - P2-1 `repairBrokenParentChain` pivots 存在性检查：`pivots[name]` 不判存在性，缺失时拿到零值 `vec3{}`，LocalPosition 塌到原点。修复：取值判 `ok`，缺失时 `continue` 保留原 LocalPosition + log 告警（code_review P2-4 修正：只 log 不跳过，仍用零向量算 LocalPosition）。
  - P2-2 `attachArms` pivots 存在性检查：同 P2-1 模式，RightArm/LeftArm/Arm 缺 pivot 时 `break` 跳过 attach + log 告警。
  - P2-3 `fillMissingBones` pivots：已有意设计（纯 parent 引用骨骼无 pivot 时塌到原点 + log 告警），非 bug。
  - P2-4/P2-5（parseUV 原始 Size / parseFaceUV 面序隐式契约）：待后续 deep 验证（Blockbench 交叉验证），本轮跳过。

## ADR-042 实施进度（2026-08-24 核对）

ADR-042 §2.1 四项 + §2.2 bone 层直读的实施状态（ADR 只记决策方向，实施进度查知识卡）：

| 项 | 状态 | 证据 |
|----|------|------|
| §2.1 旋转序 ZYX | ✅ 已落地 | `eulerToQuaternion` ZYX intrinsic，commit b8fc3211 |
| §2.1 cube 变换链 | ✅ 已落地 | 3 层 X 镜像/翻号，`verify:port` 全绿 |
| §2.1 scale | ✅ 已落地 | `BoneChannels.scale` → `evaluateClip` 累积 → `ysm-animation-player` 应用到 `THREE.Bone.scale`；`scale=0 → visible=false` |
| §2.1 隐藏联动 | ✅ 已落地 | `bone-visibility.ts` `setBoneVisible` 用 `g.traverse` 递归子骨骼 |
| §2.1 glow | ✅ 已落地 | Go `isGlowBone` 前缀检测 + `BoneData.Glow` → 前端 `MeshStandardMaterial + emissive`，commit a93b61ba |
| §2.1 世界坐标回填 | ⏭️ 无需实现 | Three.js CPU 渲染，`getWorldPosition()` 可替代 |
| §2.2 bone 层二进制直读 | ✅ 已落地 | C++ `YSMParserV3.cpp:862-876` 直读 pivot/rotation 并导出到 geometry JSON |
| §2.2 cube 层反推猜错 | ⏳ 待解决 | `restore_blockbench_cube` 从烘焙 quad 反推 `origin/size`，复杂嵌套旋转会猜错 |

验证脚本：`tests/verify-adr-042.mjs`（scale/隐藏联动/glow/世界坐标回填四项一键回归）

## 相关

- [go_geometry](./go-geometry.md) — BedrockModel 来源（ZIP/7z/JSON 解析）
- [go_ysm_parser](./go-ysm-parser.md) — YSM 格式解析
- AGENTS.md 致命陷阱 §二 #11（3D 坐标变换）
