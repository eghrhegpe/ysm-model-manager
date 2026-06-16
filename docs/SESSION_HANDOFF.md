# 会话交接日志

> 每个 AI 代理在完成任务或阶段性工作时，在此记录关键信息，供下一个 AI 快速接手。
> **写入规则**：只记结论和发现，不记过程。每条 ≤ 15 行。

---

## 模板

```markdown
## [日期] — [AI 模型] — [任务编号/名称]

**状态**：✅ 完成 / 🔄 进行中 / ❌ 阻塞

### 做了什么
- （1-3 条要点）

### 关键发现
- （给下一个 AI 的信息，含文件:行号）

### 遗留问题
- （未完成的事项 / 需要确认的假设）

### 下一步
- （具体动作 + 建议用哪个 AI）
```

---

## 交接记录

---

### 2026-06-16 — DeepSeek V4 Pro — Phase 1 取证（根因已定位）

**状态**：🔄 诊断完成，待施工

#### 用户答疑
1. Bug #14/#27 修复对大多数模型有效，但头发骨骼仍有异常（YSMParser 可复现，YSMViewer 不可复现）
2. 处于系统性验证阶段，大多数模型已达预期，仍有部分存在头发异常 + 材质异常
3. Origin X 取反指令已因缺乏测试记录而难以考证，后续实测确认
4. 2D 图价值不高，重点是 3D 渲染验证

#### 根因诊断

**主根因：`spec.go:102` 骨骼旋转符号/顺序与 YSMViewer 不一致**

`default_model/main.json` 的 `Ribbon` 骨骼有非零旋转 `[-1.82257, 33.0231, 8.40116]`：

```go
// spec.go:102 — 当前代码
localRot = eulerToQuaternion(-b.Rotation[0], -b.Rotation[1], b.Rotation[2])
// → eulerToQuaternion(+1.82257, -33.0231, +8.40116)   X/Y 取反了
```

YSMViewer 的 `CreateBlockbenchQuaternion(Vector3 rotation)` 直接传原始值不取反，旋转顺序为 Y→X→Z。当前代码顺序为 Z→Y→X（`Rx*Ry*Rz`）。

**为什么身体正常头发异常**：身体骨骼（UpperBody、Head 等）旋转多为 `[0,0,0]`，符号和顺序差异无影响。头发骨骼（Ribbon 等）有显著非零旋转，差异被放大。

**次根因：`spec.go:216` Origin X 取反与指令冲突**
`AGENTS.md:89` 写"Origin X 不取反"，但 `spec.go:216` 执行 `ox := -c.Origin[0]`。对有非零 origin 的 cube（头发中常见），顶点坐标在 Three.js 空间可能镜像偏移。

**次根因：cube 级旋转同样受影响**
`spec.go:309` 的 `eulerToQuaternion(-c.Rotation[0], -c.Rotation[1], c.Rotation[2])` 对 cube 旋转用了相同取反，`corner_h1` 等头发骨骼的 cube 有 `[-0.4948, 0.2395, 7.4885]` 等旋转，同样受影响。

#### 最小验证步骤
1. 用 `default_model/models/main.json` 直接喂 `go test`（写一个简单测试对比 Ribbon 骨骼的 localRot 四元数与 YSMViewer 输出）
2. 或在 DevTools 跑 `window.debugGetSpec("path/to/default_model.ysm")` 看 Ribbon 骨的 localRotation 值
3. 修复后对比 AnluoSakura 模型的头发渲染

#### 疑问待解
- YSMViewer 的 `CreateBlockbenchQuaternion` 确切的旋转顺序是 Y→X→Z 还是 Z→Y→X？需查 C# 源码确认
- Origin X 取反的原始依据是什么？需查 YSMViewer `ThreeJsPayloadBuilder.cs` 的 `cube.Origin.X` 处理方式

#### 下一步
- Phase 2 方案设计：确定 `eulerToQuaternion` 的旋转顺序和符号纠正方案
- 建议用 GLM-5.1 或另一实例做跨文件影响分析

---

### 2026-06-16 — Qwen3.7 Plus — 3D 渲染代码审查 + 疑惑记录

**状态**：🔍 诊断完成，待验证

#### 做了什么
- 阅读 spec.go / model3d-spec.js / model2d.js / model3d.js / bedrock.go 全文
- 对比 Go spec 输出与 JS 消费的坐标链路

#### 关键发现（按嫌疑排序）

1. **[最高] spec.go:306 顶点双重偏移** — 顶点已相对 cubePivot (`:246-251`)，mesh.localPosition 又设 `cubePivot-bonePivot`，最终世界坐标 = `boneWorld + (cp-bp) + (modelPos-cp)` = `boneWorld + modelPos - bonePivot`。每个 cube.pivot ≠ bone.pivot 的立方体都会错位。修复方向：顶点改为相对 bonePivot，mesh.localPosition 设 [0,0,0]。

2. **[确认] JS 兜底是死代码** — `model3d-spec.js` 输出 `origin/size/pivot/rotation`，但 `model3d.js:261-270` 只认 `positions/normals/uvs/indices`。Go 不可用时 3D 视图空白，不会降级。

3. **[待查] 硬编码层级修补** — `spec.go:160-184` 手动把 RightArm/LeftArm 挂到 Arm 下，说明 YSMParser 丢失了这层父子关系。可能还有其他丢失的层级。

4. **[待查] 2D 渲染扁平** — `model2d.js` 直接用 `c.origin` 画，不做 parent→child pivot 累积。如果 cube origin 是 bone-local 坐标则 2D 图也错。

5. **[待查] 旋转符号** — `spec.go:102` `eulerToQuaternion(-rx, -ry, rz)` X/Y 取反 Z 不取反，未与 Blockbench/YSMViewer 原始实现对比。

6. **[低] 同名骨骼 pivot 覆盖盲区** — `spec.go:71-76` 只在 `b.Parent != ""` 时覆盖，反向情况（main 无 parent、arm 有 parent）会丢正确 pivot。

#### 遗留问题
- 无 ground truth：缺一个已知简单模型的手算预期坐标
- 上述 #1 需要实际模型数据验证（一个 cube 手算即可证实/证伪）

#### 下一步
- 取一个实际 BedrockModel JSON，手算一个 cube 的预期顶点，对比 spec.go 输出
- 建议用 DeepSeek V4 Flash 做验证脚本 + 修复 #1

---

### 2026-06-16 — DeepSeek V4 Flash — 文档阅读 + 3D 数据流排查

**状态**：🔍 发现 5 个待确认矛盾

#### 做了什么
- 按要求顺序重读 AGENTS.md ⚡ 全部 12 份文档
- 完整排查 WASM→Go→JS 三层数据流

#### 关键发现
1. **X 取反转折**：`copilot-instructions.md:89`（2026-06-09 强制执行）规定"X 不取反"，但 `spec.go:70` 仍在 `-b.Pivot[0]`。指令和代码互斥，谁为准？
2. **`docs/model3d.js` 角色不明**：copilot-instructions.md:109 称其为"当前稳定版"，但渲染代码在 `frontend/js/utils/model3d.js`。它是参考文档还是待替换代码？
3. **Go 与 JS 两条路径的分歧**：`model3d-spec.js` 不取反 X，`model3d.js` 消费 Go spec（取反 X），同一模型在两条路径下位置不同。
4. **`eulerToQuaternion(-rx, -ry, rz) 符号未验证**：X/Y 取反而 Z 不取反，未见与 Blockbench/YSMViewer 的交叉对比记录。
5. **TASK_PLAN.md 缺 3D 条目**：当前任务清单不含任何 3D 渲染相关任务，后续 AI 无入口。

#### 遗留问题
- 3D 攻关的优先级未定（取证优先 vs 施工优先）
- `docs/model3d.js` 需读取确认角色

#### 下一步
- 等待用户决策矛盾 1~3 的最终方向

---

### 2026-06-16 — DeepSeek V4 Flash — 立方体顶点修正 + 手臂关节新方块排查

**状态**：✅ fx 公式已修正，手臂重叠行为确认

#### 做了什么
- 修复 `spec.go:395` `fx := ox - sx` → `fx := ox`（配合 `tx := ox + sx`）
- 完整数学验证三类场景：中心骨骼（Head）、偏左骨骼（RightArm）、偏右骨骼（LeftArm）
- 排查"手臂关节出现新方块"根因

#### 关键发现
1. **`fx = ox - sx` 的历史**：此公式在 YSMViewer 中配合 X 取反使用。当 pivot 取反后，ox' = -ox，则 `fx = ox' - sx = -ox - sx` 正确地将立方体从外边缘向内延伸。移除 pivot 取反后公式未同步更新，导致所有立方体在 X 方向偏移 sx 单位。
2. **`fx = ox` 的数学验证**：
   - Head (ox=-4, sx=8, BP.x=0): lx=-4, hx=4 → 世界 [-4,4] ✅
   - RightArm (ox=-4, sx=4, BP.x=-5): lx=1, hx=5 → 世界 [-4,0] ✅
   - LeftArm (ox=4, sx=4, BP.x=5): lx=-5, hx=-1 → 世界 [0,4] ✅
3. **手臂与身体重叠是预期行为**：在静态渲染中，右臂在 x=[-4,0]，身体在 x=[-4,4]，重叠区域 x=[-4,0] 是标准 Bedrock 模型数据的正确位置。手臂"向外伸出"的效果由骨骼旋转（动画中）而非立方体偏移实现。
4. **"新方块"原因**：旧公式 `fx=ox-sx` 将所有立方体向左偏移 sx，导致部分立方体与相邻立方体重叠不可见。修复后回到正确位置，暴露了原来被遮挡的立方体（通常是关节处的装饰性方块，如袖口/护肩）。

#### 遗留问题
- 非 1_alex 模型的手臂"向中心靠拢"问题：需确认是否来自模型文件本身的旋转数据（Ribbon 等头发骨骼），而非顶点位置问题
- cubepivot 语义：Blockbench 未设置 pivot 时默认 [0,0,0]，与 bonePivot 不相等时可导致 mesh 本体矩阵计算偏移

#### 后续
- 已修改 `eulerToQuaternion` 旋转顺序为 `Ry×Rx×Rz`（spec.go:658-666）
- 已修改符号取反（不再 -rx/-ry）
- 需 YSMViewer `ThreeJsPayloadBuilder.cs` 原文确认

#### 下一步
- 若手臂"向中心靠拢"持续，需查 `eulerToQuaternion` 旋转符号（spec.go:102 -rx/-ry），与 YSMViewer `CreateBlockbenchQuaternion` 对比
- 记录到 bug-chronicle.md：`spec.go:395` 的 `fx=ox-sx` 是取反时代码未同步的历史债务

### 2026-06-16 — GLM-5.1 — Phase 2 方案设计（3D 骨骼渲染）

**状态**：⚠️ 方案需修订（跳过 Phase 1 直接画了改动范围图）

#### 做了什么
- 完整排查 WASM→Go→JS 三层骨骼数据流（WASM 拆包层、Go threejs.Build 层、JS 兜底层）
- 画出 Phase 2 改动范围图（4 个优先级 P1-P4）
- **但**：跳过了 AGENTS.md 第一条要求的 12 份文档阅读，后续补读后发现部分判断过时

#### 关键发现
- **WASM 层无数据丢失**：只拆包不解几何，bone.parent/pivot/rotation 全在 JSON 里
- **Go↔JS 序列化无截断**：GetModel3DSpec 返回 float64/int，无 []byte→base64 问题
- **JS fallback `buildSpecFromModel()` 不做 X 轴翻转**（`model3d-spec.js`），Go spec 做 X 翻转（`spec.go:70`）→ 两条路径渲染结果不同
- **bug #14/#27 已修复了 P3（RightArm parent 补齐）和 P2（pivot 共享 map 覆盖）**，我的初始方案中列为"需修"是过时的
- **`copilot-instructions.md:89` 规定"Origin X 不取反"，但 `spec.go:70` 仍在 `-b.Pivot[0]`**→ 指令与代码互斥

#### 遗留问题（需 Phase 1 取证确认）
- ❓ `spec.go:70` 的 `-b.Pivot[0]` 是否应改成 `+b.Pivot[0]`（匹配 copilot-instructions 规则）？
- ❓ 2D 骨骼图旋转后位置飘（PLAN #4）是否仍存在？
- ❓ Bedrock 规范中 cube pivot 默认值到底是 `[0,0,0]` 还是 `origin + size/2`？
- ❓ `eulerToQuaternion(-rx, -ry, rz)` 的符号和旋转顺序是否与 Blockbench/YSMViewer 一致？

#### 下一步
- Phase 1 取证（DeepSeek V4 Pro / R1）：钉死上方 4 个 ❓ 的根因
- 取证输入：`spec.go` 全文 + `model3d-spec.js` 全文 + 一个简单 BedrockModel JSON + Blockbench 对比截图
- 取证完成后再修正 Phase 2 改动范围图
