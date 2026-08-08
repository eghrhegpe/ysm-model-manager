# JS spec ↔ Go 口径对齐验证（全平台查看器可行性前置调研）

> 日期：2026-08-08
> 状态：📦 已存档（结论备忘，暂不动手）
> 触发：用户想折腾「全平台可用的查看器」，先评估当前预览界面可用性，并验证 JS 端 spec 兜底（`model3d-spec.ts`）与 Go 端 `threejs.Build()` 的口径对齐程度，判断「复活 JS spec 生成」这条路线的工作量。

## 结论速览

- **当前预览界面作为「查看器」很能打**：2D/3D 双视图、骨骼悬停/拾取、调试模式（normal/pivot/bone）、动画解析、Litematic 蓝图 3D、多角度透明截图导出、全屏放大、预览缓存，功能密度接近小型专用查看器。
- **全平台化的硬债在数据链路**：spec 生成（顶点/UV/四元数）唯一事实来源是 Go 端 `threejs.Build()`，前端已删除 JS 兜底；WASM 解码也要经 Go `ReadFileBytes` 喂字节。脱离 Wails 桌面壳即无法渲染。
- **黄金样本测试全绿，但只锁「结构层」**：`model3d-spec.test.ts` 6/6 通过、`go test ./go/threejs/...` 通过；但测试自述「UV 数值口径（归一化/面序）尚未与 Go 对齐，此处仅锁结构」。
- **JS 兜底产出的是 cube 元数据，不是可渲染 spec**：缺顶点缓冲、骨骼层级、UV 数值对齐、多纹理细节四大块。「复活」实为「移植 + 补全」，工作量中偏大，且处于陷阱 #11 的高危坐标区域。

## 一、验证方法

1. 读 `frontend/src/utils/3d/model3d-spec.test.ts`（黄金样本用例镜像 `go/threejs/spec_test.go`）与 `model3d-spec.ts` 实现；
2. 读 `go/threejs/spec.go` 的 `Build()` / `buildCubeMeshData` 及 `spec_test.go`，逐项对照口径；
3. 运行两端测试确认实际对齐程度。

## 二、验证结果

| 端 | 命令 | 结果 |
|----|------|------|
| 前端黄金样本 | `npx vitest run frontend/src/utils/3d/model3d-spec.test.ts` | ✅ 6/6 通过（4ms） |
| Go 端 | `go test ./go/threejs/...` | ✅ 通过 |

**已对齐（结构层，双边锁定）**：
- 同名骨骼去重：首次无 parent → 后续带 parent 时 cube 整体替换（overwrite）；
- mergeCubes：重叠 cube（origin/size/rotation 全等）替换保留新 UV、非重叠追加；
- cube 坐标相对骨骼 pivot（`origin - bonePivot` / `pivot - bonePivot`）；
- 缺省纹理尺寸回退 64×64；faceUV 布尔与 texIdx 字段存在。

## 三、缺口清单（JS 兜底 → 可渲染 spec）

| # | 缺口 | Go 端（spec.go） | JS 端（model3d-spec.ts） |
|---|------|------------------|--------------------------|
| 1 | **顶点缓冲** | `buildCubeMeshData` 生成 positions/normals/uvs/indices 全量顶点 + 6 面定义（east/west/up/down/south/north）+ thicknessEpsilon 防零厚度 | 只输出 cube 元数据（origin/size/pivot/rotation/uv），**无顶点数组** |
| 2 | **骨骼层级** | 完整：pivot 收集（同名保留规则一致）、`localPosition = bone.pivot - parent.pivot`、欧拉→四元数（三轴取反）、纯 parent 引用补骨骼、断链修复、RightArm/LeftArm 挂到 Arm 下 | `bones: model.bones` **原样透传**，零层级计算 |
| 3 | **UV 数值/面序** | `expandBoxUV`/`parseFaceUV` 归一化 + 固定面序（每 face 8 值） | 公式与面序未对齐（测试只锁 uv 数组长度 6，不断言数值） |
| 4 | **多纹理/细节** | `TexSlot` 多纹理槽、`CubeTexW/H` 覆盖全局纹理、零尺寸 cube 返回 nil 丢弃 | `texIdx` 恒 0、无 cube 纹理维度、无零尺寸守卫 |

**其他已知差异**：
- Go 有「双 parent 且 rotation 完整 → overwrite」规则，JS 注释自认不适用（SpecBone 无 rotation 字段）；
- 骨骼/立方体旋转取负转四元数：Go 有（`eulerToQuaternion(-rx,-ry,-rz)`），JS 仅透传欧拉角；
- meshID 十进制规则（`b1_10`，回归防 `string(rune('0'+idx))`）：Go 有测试锁定，JS 端无对应实现。

## 四、路线建议

| 路线 | 做法 | 特点 |
|------|------|------|
| **B：Go 编译 WASM**（推荐） | `go/threejs` 直接编成 wasm，前端调它生成 spec，渲染层原样复用 | 口径零漂移、一行算法不重写；与已有 YSMParser WASM（ADR-029）同模式；spec 生成是小计算，wasm 体积开销可接受 |
| A：JS 完整移植 | 照 Go 逐函数移植 + 双边黄金测试 | 纯前端无 wasm，但工作量大、坐标口径风险高（陷阱 #11 历史 9 次 fix 教训） |

两条路线都能让「文件 → 解析 → spec → 渲染」整条链路脱离 Wails 进浏览器；`model3d.ts` 渲染层（前端 Three.js）完全不动。**用户已选择「先存档，暂不动手」，后续决策时优先评估路线 B。**

## 五、关联

- 知识卡：[model3d](../knowledge/model3d.md)、[app-preview](../knowledge/app-preview.md)、[go-threejs](../knowledge/go-threejs.md)、[model2d](../knowledge/model2d.md)
- ADR：[ADR-004 3D 骨骼渲染管线](../adr/ADR-004-3d-rendering-pipeline.md)、[ADR-029 YSMParser WASM 内嵌](../adr/ADR-029-ysmparser-wasm-embed.md)
- 历史报告：[3d-rendering-report.md](./3d-rendering-report.md)（坐标口径修复全过程）、[quaternion-investigation.md](./quaternion-investigation.md)
- 陷阱：AGENTS.md 致命陷阱 #11（3D 坐标变换高危区）
- 关键文件：`frontend/src/utils/3d/model3d-spec.ts`（JS 兜底，已废弃无消费方）、`go/threejs/spec.go`（事实来源）、`frontend/src/utils/3d/model3d-spec.test.ts`（黄金样本）
