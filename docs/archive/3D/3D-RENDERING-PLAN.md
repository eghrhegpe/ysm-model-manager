# 3D 骨骼渲染攻关计划

> 本文档定义多 AI 协作分工流程，解决骨骼图坐标计算不准、3D 渲染错位等历史遗留问题。

---

## 问题诊断

### 当前代码结构

| 文件 | 职责 | 行数 |
|------|------|------|
| `go/threejs/spec.go` | Go 端骨骼计算：pivot 收集、localPos 计算、欧拉角→四元数 | ~533 |
| `frontend/js/utils/model3d.ts` | Three.js 3D 渲染：场景/相机/灯光/网格 | ~464 |
| `frontend/js/utils/model3d-spec.ts` | JS 兜底 Spec 构建（Go 不可用时） | ~255 |
| `frontend/js/utils/model2d.ts` | Canvas 2D 骨骼图：正交投影、旋转、热区 | ~556 |
| `frontend/js/views/app-preview/preview-litematic-3d.ts` | 3D 全屏预览覆盖层 | ~212 |

### 已知痛点

| # | 问题 | 疑似根因 | 验证方式 |
|---|------|----------|----------|
| 1 | 多文件模型（main.json + arm.json）骨骼层级错误 | 同名骨骼 pivot 覆盖逻辑 `spec.go:66-77` | 打印 `pivots` map 对比 |
| 2 | 手臂立方体偏移 | cube pivot 与 bone pivot 混淆 `spec.go:304` | 对比 YSMViewer 输出 |
| 3 | 骨骼旋转丢失 | `eulerToQuaternion` 旋转顺序 `spec.go:102` | 打印四元数对比 |
| 4 | 2D 图旋转后位置飘 | `model2d.js` 只绕 Y 轴旋转，未考虑 pivot | 对比 3D 视图 |
| 5 | 坐标手性不一致 | MC 右手系 Y-up vs Three.js 左手系 | 检查 X 轴取反位置 |

---

## 分工流程

### Phase 1 — 取证（DeepSeek V4 Pro / DeepSeek R1）

**目标**：钉死"为什么之前算不准"的根因

**输入材料**（一次性喂够）：
```
1. go/threejs/spec.go 全文
2. frontend/js/utils/model3d-spec.ts 全文
3. frontend/js/utils/model2d.ts 全文
4. go/types/types.go 中 BedrockModel / Bone / Cube 结构体定义
5. 一个已知简单模型的 BedrockModel JSON（2-3 根骨，知道"应该长什么样"）
6. 当前渲染结果截图 + 期望结果截图
```

**任务提示词**：
```
你是一个三维几何专家。以下是 YSM 模型管理器的骨骼渲染代码。

**问题**：多文件模型（main.json + arm.json）合并后，骨骼层级错误、手臂立方体偏移。

**请你诊断**：
1. `spec.go:66-77` 的 pivot 收集逻辑是否正确？同名骨骼覆盖策略是否合理？
2. `spec.go:87-97` 的 localPos 计算是否正确？是否应该用 parent 的 pivot 还是 bone 自己的 pivot？
3. `spec.go:102` 的 eulerToQuaternion 旋转顺序（XYZ? ZYX?）是否符合 Blockbench/MC 约定？
4. `model2d.js` 的 2D 投影是否正确处理了 pivot？

**输出要求**：
- 不超过 2 页的诊断结论
- 指出具体哪一行代码有问题，应该改成什么
- 给出最小验证步骤：先用一个 bone 手动算出预期坐标
```

**预期产出**：
- 根因清单（哪几行代码有问题）
- 修正方案（具体代码改动）
- 验证步骤（用什么模型、看什么输出）

---

### Phase 2 — 方案设计（GLM-5.1 / DeepSeek V4）

**目标**：确定改动范围，避免牵一发动全身

**输入材料**：
```
1. Phase 1 的诊断结论
2. go/threejs/spec.go
3. frontend/js/utils/model3d.ts
4. frontend/js/utils/model2d.ts
5. docs/architecture.md（了解三层解耦原则）
```

**任务提示词**：
```
你是系统架构师。基于以下诊断结论，设计骨骼渲染修正方案。

**诊断结论**：
[粘贴 Phase 1 的输出]

**设计约束**：
1. Go 端 `threejs.Build()` 输出 JSON spec，JS 端直接消费
2. JS 兜底 `buildSpecFromModel()` 必须与 Go 逻辑一致
3. 2D 骨骼图（model2d.js）和 3D 渲染（model3d.js）必须使用相同的坐标计算
4. 不能破坏现有的多文件合并逻辑（main.json + arm.json）

**请输出**：
1. 改动文件清单（哪些文件、哪些函数）
2. 接口变更（如果有字段增减）
3. 测试策略（用什么模型验证、预期输出是什么）
4. 回滚方案（如果改坏了怎么快速恢复）
```

**预期产出**：
- 改动范围图
- 接口变更说明
- 测试用例设计

---

### Phase 3 — 施工（DeepSeek V4 Flash / Qwen3.7 Plus）

**目标**：按方案实现代码改动

**分工**：
| AI | 任务 | 文件 |
|-----|------|------|
| DeepSeek V4 Flash | Go 端 `spec.go` 修正 | `go/threejs/spec.go` |
| DeepSeek V4 Flash | JS 兜底 `model3d-spec.js` 同步 | `frontend/js/utils/model3d-spec.ts` |
| Qwen3.7 Plus | 2D 骨骼图修正 | `frontend/js/utils/model2d.ts` |
| Qwen3.7 Plus | 调试可视化（骨骼名标签、坐标打印） | 上述文件 |

**施工规范**：
```
1. 每个函数加 dbg() 打印关键中间值：
   - pivots map
   - localPos / localRot
   - 最终 spec 的 bones[] 数组

2. 写验证脚本：
   - 输入：一个简单模型的 BedrockModel JSON
   - 输出：每根骨的 localPos → worldPos（含矩阵）
   - 对比：期望值 vs 实际值

3. 不攒修改：
   - 改完 spec.go → go build 验证
   - 改完 model3d-spec.js → npx vite build 验证
   - 改完 model2d.js → 截图对比
```

---

### Phase 4 — 调坐标（全员协作）

**目标**：用 T-pose 简单模型做 ground truth 验证

**验证流程**：
```
1. 准备测试模型：
   - 一个只有 3 根骨（root → spine → head）的简单模型
   - 知道每根骨的 pivot 和预期 worldPos

2. 运行验证：
   - Go: threejs.Build(model) → 打印 spec JSON
   - JS: buildSpecFromModel(model) → 打印 spec JSON
   - 对比两者是否一致

3. 渲染对比：
   - 2D 骨骼图截图
   - 3D 视图截图
   - 与 Blockbench / YSMViewer 截图对比

4. 如果有偏差：
   - 截图发给 Qwen3.7 Plus（多模态看图）
   - 让它指出"这根骨头应该在 X 位置，但渲染在 Y 位置"
   - 让它反推是哪一步计算错了
```

---

## AI 分工速查表

| 阶段 | AI | 任务 | 为什么选它 |
|------|-----|------|-----------|
| 取证 | DeepSeek V4 Pro / R1 | 诊断根因 | 三维数学推理最准 |
| 设计 | GLM-5.1 | 方案设计 | 看清跨层影响 |
| 施工 | DeepSeek V4 Flash | Go/JS 代码修正 | 便宜，适合反复迭代 |
| 施工 | Qwen3.7 Plus | 2D 渲染 + 调试可视化 | 多模态看图省口述 |
| 调坐标 | DeepSeek V4 Pro | 复核矩阵计算 | 精确推导 |
| 调坐标 | Qwen3.7 Plus | 截图对比 | 看图说话 |

---

## 关键文件索引

| 文件 | 关键函数/位置 | 说明 |
|------|---------------|------|
| `go/threejs/spec.go` | `Build()` :53 | 入口，生成 Three.js spec |
| `go/threejs/spec.go` | pivot 收集 :66-77 | 同名骨骼覆盖逻辑 |
| `go/threejs/spec.go` | localPos 计算 :87-97 | bone.pivot - parent.pivot |
| `go/threejs/spec.go` | `eulerToQuaternion()` :102 | 旋转顺序 |
| `go/threejs/spec.go` | cube mesh 生成 :304 | cube.pivot - bone.pivot |
| `frontend/js/utils/model3d-spec.ts` | `buildSpecFromModel()` :8 | JS 兜底，必须与 Go 一致 |
| `frontend/js/utils/model2d.ts` | `renderModel2D()` :15 | 2D 正交投影 |
| `frontend/js/utils/model2d.ts` | `rot()` :64 | Y 轴旋转函数 |
| `frontend/js/utils/model3d.ts` | `renderModel3D()` :36 | Three.js 场景构建 |

---

## 验证检查清单

- [ ] Go `threejs.Build()` 输出的 spec 与 JS `buildSpecFromModel()` 一致
- [ ] 简单模型（3 根骨）的 localPos → worldPos 计算正确
- [ ] 多文件模型（main + arm）的骨骼层级正确
- [ ] 2D 骨骼图与 3D 视图的骨骼位置一致
- [ ] 旋转后的模型与 Blockbench / YSMViewer 截图一致
- [ ] `dbg()` 打印的中间值可追溯

---

## 附录：已知陷阱

1. **同名骨骼覆盖**：`spec.go:73-75` 只在 `b.Parent != ""` 时覆盖，如果 arm.json 的骨骼没有 parent，pivot 不会被覆盖 → 层级错误

2. **cube pivot vs bone pivot**：`spec.go:304` 用 `cube.pivot - bone.pivot` 计算 mesh localPos，但 cube.pivot 可能是相对于 bone 的偏移，不是世界坐标

3. **旋转顺序**：Blockbench 用 ZXY 还是 XYZ？`spec.go:102` 的 `eulerToQuaternion(-rx, -ry, rz)` 符号是否正确？

4. **坐标手性**：MC 是右手系 Y-up，Three.js 默认是右手系 Y-up，但 `spec.go:70` 对 X 取反了（`-b.Pivot[0]`），这可能导致左右镜像

5. **2D 投影**：`model2d.js:64-67` 的 `rot()` 只绕 Y 轴旋转，没有考虑骨骼的 pivot，旋转后位置会飘
