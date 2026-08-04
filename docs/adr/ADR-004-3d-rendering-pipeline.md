# ADR-004：3D 骨骼渲染管线与坐标系决策

- **状态**：已采纳（Accepted）
- **日期**：2026-08-03（初定，决策时间线 v1.5.1 → v1.8.7）
- **决策人**：Jieling（人类首席架构师）、DeepSeek V4 Pro / V4 Flash、Qwen3.7 Plus、GLM-5.1
- **相关**：`go/threejs/spec.go` / `go/geometry/archive.go` / `go/ysm/extracted.go` / `frontend/js/utils/model3d.js` / `frontend/js/utils/model2d.js` / `frontend/js/widgets/app-preview/preview-wasm.js`

---

## 1. 背景（Context）

3D 预览功能用于在应用内渲染 `.ysm` / `.zip` / `.7z` / `.json` 格式的 Bedrock 版模型。
渲染管线跨越三层：

```
YSM 文件 → [解码层] → BedrockModel JSON → [Go spec 层] → Three.js Spec JSON → [前端渲染层] → Three.js Scene
```

从 v1.5.1 到 v1.8.7，经历了坐标系翻转、骨骼合并错位、纹理索引错误、透明度遮挡
等多个问题。本报告提炼该阶段内做出的**关键架构决策**，而非逐行修复记录。

---

## 2. 决策（Decision）

### 2.1 渲染管线：Go spec 层为单一事实来源

**决策**：骨骼坐标计算以 Go 端 `threejs.Build()` 输出的 spec JSON 为唯一事实来源，
前端 Three.js 直接消费 Go spec，不再维护 JS 兜底计算路径。

| 路径 | 状态 | 说明 |
|------|------|------|
| Go `threejs.Build()` → Three.js | ✅ 主路径 | 生产使用 |
| JS `buildSpecFromModel()` → Three.js | ❌ 死代码 | 输出格式与 `model3d.js` 不兼容，3D 视图不会降级到此路径 |
| Go CLI fallback（wails 不可用时） | ⚠️ 降级路径 | 不设 TexSlot，纹理索引不完整 |

**理由**：JS 兜底路径输出 `origin/size/pivot/rotation` 格式，而 `model3d.js` 只消费
Go spec 的 `positions/normals/uvs/indices` 格式。维护两条不等价路径的代价高于收益。

### 2.2 坐标系：X 轴不取反

**决策**：MC 坐标系到 Three.js 坐标系的转换中，**Origin X 不取反**。

| 修复项 | 旧代码（错误） | 新代码（正确） |
|--------|--------------|--------------|
| Bone pivot X | `vec3{-b.Pivot[0], ...}` | `vec3{b.Pivot[0], ...}` |
| Cube origin X | `ox := -c.Origin[0]` | `ox := c.Origin[0]` |
| Cube pivot X | `cp[0] = -c.Pivot[0]` | `cp[0] = c.Pivot[0]` |

**回退尝试**：曾对 X 取反，但 `copilot-instructions.md` 明确规定"Origin X 不取反"，
取反后与规范冲突，回退。

### 2.3 骨骼旋转：Rx×Ry×Rz 顺序，三轴取反

**决策**：欧拉角到四元数的转换使用 `Rx×Ry×Rz` 旋转顺序，且输入欧拉角三轴均取反。

```go
// spec.go:104 — 骨骼旋转
eulerToQuaternion(-rx, -ry, -rz)  // 三轴取反

// spec.go:531 — Cube 旋转
eulerToQuaternion(-rx, -ry, -rz)  // 三轴取反
```

**回退尝试**：曾尝试 `Ry×Rx×Rz` 顺序，实测无明显改善；与 YSMViewer 源码
`CreateBlockbenchQuaternion` 对比后确认 `Rx×Ry×Rz` 为正确顺序。

### 2.4 纹理排序：按 ysm.json 声明顺序，不按 PNG 尺寸

**决策**：纹理索引按 `ysm.json` 中 `files.player.model[]` 的声明顺序分配，
不按 PNG 文件名或尺寸排序。

| 路径 | 实现 | 状态 |
|------|------|------|
| ZIP | `archive.go` 解析 `model[]` → `texIdxMap` → `Cube2D.TexSlot` → `MeshData.TexIdx` | ✅ |
| 7z/extracted | 同逻辑 | ⚠️ 较弱（7z 不读 ysm.json） |
| CLI fallback | 不设 TexSlot | ⚠️ 已知限制 |
| WASM | `preview-wasm.js` 按 `ysmTexOrder` 排序 | ✅ |

**回退尝试**：曾按 PNG 尺寸排序纹理，但纹理顺序应遵循模型声明，非文件名猜测。

### 2.5 Mesh 合并策略：按 (boneId, texIdx, rotation) 分组

**决策**：同一骨骼下多个 cube 的 mesh 按 `(boneId, texIdx, rotation)` 三元组合并，
而非按 `(boneId)` 单一维度合并。

**理由**：同一骨骼可能有不同纹理槽位（slot 0 主纹理 + slot>0 覆盖层）或不同旋转的 cube，
单一维度合并会导致纹理错乱或旋转丢失。

### 2.6 Cube 顶点公式：`fx = ox`，非 `fx = ox - sx`

**决策**：Cube 顶点 X 坐标使用 `fx = ox`（Cube origin 即顶点起点），
而非 `fx = ox - sx`。

---

## 3. 后果（Consequences）

### 正面
- 坐标系统一后，Head/RightArm/LeftArm 三组数值演算与 Bedrock 模型数据一致
- 多文件模型（main.json + arm.json）骨骼层级正确
- 多纹理模型渲染正常，不再出现马赛克/黄色

### 负面
- JS 兜底路径被确认放弃，wails 不可用时 3D 预览空白
- 7z 路径纹理排序较弱（不读 ysm.json）
- 2D 骨骼图旋转后位置偏移仍未修复（`model2d.js` 只绕 Y 轴投影，不处理 pivot 累积），优先级低

---

## 4. 尝试过但回退的方案

| 方案 | 回退原因 |
|------|---------|
| `eulerToQuaternion` 旋转顺序改为 `Ry×Rx×Rz` | 实测效果无明显改善，YSMViewer 源码确认 `Rx×Ry×Rz` |
| Cube origin X 取反 | 与 `copilot-instructions.md` 明确规定冲突 |
| 按尺寸排序纹理 | 纹理顺序应按 ysm.json 声明，非 PNG 尺寸 |

---

## 5. 关键文件索引

| 文件 | 职责 |
|------|------|
| `go/threejs/spec.go` | Go 端骨骼计算、pivot、顶点、四元数 |
| `go/geometry/archive.go` | ZIP/7z 解析 + ysm.json 读取 + TexSlot 分配 |
| `go/ysm/extracted.go` | 解压后目录的模型/纹理查找 |
| `frontend/js/utils/model3d.js` | Three.js 3D 渲染 |
| `frontend/js/utils/model2d.js` | Canvas 2D 骨骼图 |
| `frontend/js/widgets/app-preview/preview-wasm.js` | WASM 解码 + ysm.json 解析 + 纹理排序 |

---

## 6. 数据溯源

| 来源 | 结果 |
|------|------|
| `docs/3D/3d-rendering-report.md` | 开发报告全文，含修复记录、回退方案、能力对比表 |
| `go/threejs/spec.go` | 实际代码中的坐标系/旋转/顶点公式 |
| `go/geometry/archive.go` | TexIdxMap 分配逻辑 |
| `frontend/js/utils/model3d.js` | 消费 Go spec 格式，JS 兜底路径确认不兼容 |

---

*原文档：`docs/3D/3d-rendering-report.md`，提炼关键架构决策，非逐行修复记录。*
