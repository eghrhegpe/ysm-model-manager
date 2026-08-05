> **重定向**：关键架构决策已提炼至 **[ADR-004: 3D 骨骼渲染管线与坐标系决策](../adr/ADR-004-3d-rendering-pipeline.md)**。
> 本文档保留为完整开发报告（逐行修复记录、版本变更摘要、调试工具清单），如需查阅细节请继续。

# 3D 渲染引擎开发报告

> 时间线：v1.5.1 → v1.8.7
> 参与者：DeepSeek V4 Pro / V4 Flash、Qwen3.7 Plus、GLM-5.1
> 状态：✅ 开发结束

---

## 一、项目概况

YSM 模型管理器的 3D 预览功能用于在应用内渲染 `.ysm` / `.zip` / `.7z` / `.json` 格式的 Bedrock 版模型。渲染管线跨越三层：

```
YSM 文件 → [解码层] → BedrockModel JSON → [Go spec 层] → Three.js Spec JSON → [前端渲染层] → Three.js Scene
```

本报告记录 3D 渲染引擎从"问题频出"到"功能基本完整"的全过程。

---

## 二、解决的问题清单

### 2.1 坐标系修正（v1.8.6 核心）

**根因**：Go 端 `spec.go` 从 YSMViewer C# 代码移植时，引入了 Minecraft 坐标系（左手系 Y-up）到 Three.js（右手系 Y-up）的 X 轴翻转，但后续 `copilot-instructions.md` 规定"Origin X 不取反"，导致代码与规范冲突。

| 修复项 | 旧代码 | 新代码 | 文件:行 |
|--------|--------|--------|---------|
| Bone pivot X 取反 | `vec3{-b.Pivot[0], ...}` | `vec3{b.Pivot[0], ...}` | spec.go:72 |
| Bone 旋转 X/Y 取反 | `eulerToQuaternion(-rx, -ry, rz)` | `eulerToQuaternion(-rx, -ry, -rz)` 三轴均取反 | spec.go:104 |
| Cube origin X 取反 | `ox := -c.Origin[0]` | `ox := c.Origin[0]` | — (已在 v1.8.5 前移除) |
| Cube pivot X 取反 | `cp[0] = -c.Pivot[0]` | `cp[0] = c.Pivot[0]` | — (同上) |
| Cube 顶点 fx 公式 | `fx := ox - sx` | `fx := ox` | — (已在 v1.8.6 修复) |
| Cube 旋转 X/Y 取反 | `eulerToQuaternion(-rx, -ry, rz)` | `eulerToQuaternion(-rx, -ry, -rz)` | spec.go:531 |

**验证**：Head/RightArm/LeftArm 三组数值演算，修复后顶点坐标与 Bedrock 模型数据一致。

### 2.2 多文件模型骨骼合并（bug #14/#27 延续）

**问题**：`.zip` 模型含 `main.json` + `arm.json`，同名骨骼（RightArm/LeftArm）覆盖策略导致层级错误、pivot 丢失、rotation 丢失。

**修复**：
- `pivots` map 优先保留有 `parent` 的骨骼 pivot（`spec.go:73-78`）
- 同名骨骼去重时同步更新 `ParentID`、`LocalPosition`、`LocalRotation`（`spec.go:127-134`）
- cube 合并：空间重叠的替换，不重叠的追加（`mergeCubes` 函数）
- RightArm/LeftArm 自动挂载到 Arm 骨骼下（`spec.go:384-407`）

### 2.3 纹理映射（v1.8.7）

**问题**：Go 路径（ZIP/7z/extracted）多纹理模型渲染为马赛克/黄色，因为 texIdx 永远为 0。

**修复**：
- `archive.go`：解析 `ysm.json` 的 `files.player.model[]` 建立 `texIdxMap`，按模型文件位置分配 `Cube2D.TexSlot`
- `extracted.go`：同上逻辑
- `spec.go`：`MeshData.TexIdx` 透传 `Cube2D.TexSlot`（`spec.go:47,542`）
- `model3d.js`：按 `md.texIdx` 选择对应纹理，slot>0 的面用 `BackSide` + `alphaTest:0.5`

### 2.4 非贴图 PNG 过滤（v1.8.6+）

**问题**：ZIP 中的头像/预览小图（32×32 arrow.png）被当作 `texArr[0]`，身体渲染为马赛克。

**修复**：
- `preview-wasm.ts`：仅使用 `ysmTexOrder` 显式声明的纹理（移除了 `Object.keys(textures)` 追加逻辑）
- `archive.go`：跳过 `avatar/` 目录下的 PNG

### 2.5 透明度遮挡（bug #15）

**问题**：`transparent: true` 使所有 mesh 走透明通道，深度排序错乱，手臂被身体遮挡。

**修复**：
- 主纹理（slot 0）用 `alphaTest: 0.02`（仅丢弃完全透明像素）
- 覆盖层（slot>0）用 `alphaTest: 0.5` + `BackSide`

### 2.7 ysm.json model 字段格式兼容（v1.8.7）

**问题**：`archive.go` 只处理 `[]string` 格式；`extracted.go` 不处理 `{path, uv}` 对象数组；21_saint 模型的 `projectiles` 字段用数组导致 `json.Unmarshal` 整体失败。

**修复**：
- `archive.go`：model 字段支持 4 种格式（单字符串、字符串数组、对象数组带 path/uv、map 格式）
- `extracted.go`：`json.RawMessage` 手动解析 `projectiles` 字段，兼容数组和对象两种格式

---

## 三、尝试过但回退的方案

| 方案 | 原因 |
|------|------|
| `eulerToQuaternion` 旋转顺序改为 `Ry×Rx×Rz` | 实测效果无明显改善，且 YSMViewer 源码确认顺序为 `Rx×Ry×Rz`（对应 Blockbench 约定） |
| Cube origin X 取反 | `copilot-instructions.md:89` 明确规定"Origin X 不取反"，取反后与指令冲突 |
| 按尺寸排序纹理 | 纹理顺序应按 `ysm.json` 声明，而非 PNG 尺寸 |

---

## 四、Go 端 vs WASM 端能力对比（最终状态）

| # | 能力 | WASM 路径 | Go 路径 | 状态 |
|---|------|-----------|---------|------|
| 1 | 解码 .ysm → 文件 | ✅ YSMParser | ✅ ZIP/7z 标准库 + CLI fallback | 等价 |
| 2 | ysm.json model 字段解析 | ✅ 三种格式 | ✅ 四种格式（v1.8.7 补齐） | 等价 |
| 3 | 纹理按声明顺序排列 | ✅ orderedTexKeys | ✅ defaultTex + modelOrder（ZIP）；⚠ 7z/extracted 较弱 | 基本等价 |
| 4 | 模型文件→纹理索引映射 | ✅ 按 ysmModelOrder | ✅ texIdxMap（ZIP/extracted）；⚠ CLI fallback 无 | 基本等价 |
| 5 | mesh 级 texIdx | ✅ b._texIdx | ✅ MeshData.TexIdx + TexSlot | 等价 |
| 6 | UV 负尺寸处理 | ✅ Three.js 原生 | ✅ expandBoxUV 保留负值 fw/fh | 等价 |
| 7 | 非 avatar PNG 过滤 | ✅ 跳过 avatar/ | ✅ 跳过 avatar/ | 等价 |
| 8 | 旋转坐标系 | ✅ 前端直接消费 Go spec | ✅ 三轴取反 + Rx×Ry×Rz 顺序 | 等价 |
| 9 | JS 兜底路径 | ❌ 死代码（格式不兼容） | — | 已知限制 |

---

## 五、关键文件索引

| 文件 | 职责 | 行数 |
|------|------|------|
| `go/threejs/spec.go` | Go 端骨骼计算、pivot、顶点、四元数 | ~636 |
| `go/geometry/archive.go` | ZIP/7z 解析 + ysm.json 读取 + TexSlot 分配 | ~288 |
| `go/ysm/extracted.go` | 解压后目录的模型/纹理查找 | ~209 |
| `go/types/bedrock.go` | BedrockModel/Bone2D/Cube2D 数据结构 | ~34 |
| `frontend/src/utils/3d/model3d.ts` | Three.js 3D 渲染（场景/相机/光照/网格） | ~464 |
| `frontend/src/utils/3d/model3d-spec.ts` | JS 兜底 Spec 构建（死代码，格式不兼容） | ~255 |
| `frontend/src/utils/3d/model2d.ts` | Canvas 2D 骨骼线条图 | ~556 |
| `frontend/src/views/app-preview/wasm.ts` | WASM 解码 + ysm.json 解析 + 纹理排序 | ~513 |
| `app_model.go` | Wails Binding 入口 + CLI fallback | ~237 |

---

## 六、已知限制

1. **JS 兜底路径是死代码**：`model3d-spec.js` 输出 `origin/size/pivot/rotation` 格式，但 `model3d.js:113` 只消费 Go spec 的 `positions/normals/uvs/indices` 格式。Go 不可用时 3D 视图空白，不会降级到 JS 路径。
2. **7z 路径纹理排序较弱**：7z 解析不读 ysm.json，纹理顺序由遍历顺序决定。
3. **Go CLI fallback 不设 TexSlot**：`runYSMParserOnFile` 路径解码后直接 `ParseBedrockGeometry`，不经过 ysm.json 映射。
4. **2D 骨骼图旋转后位置偏移**：`model2d.js` 的 `rot()` 只绕 Y 轴投影，不处理骨骼层级 pivot 累积。对于非零旋转的骨骼，2D 图位置可能偏移。优先级低（用户不常看 2D 图）。
5. **eulerToQuaternion 旋转顺序**：当前为 `Rx×Ry×Rz`，与 YSMViewer 的 `CreateBlockbenchQuaternion` 实现对比后保留。如果未来引入动画播放，可能需改为 `Ry×Rx×Rz`。

---

## 七、调试工具（开发期间使用，已清理）

- `window.debugGetSpec(path)` — 在 DevTools 中获取 Go spec JSON（仅 localhost）
- `window.__dumpScene()` — 在 DevTools 中打印 Three.js 场景所有骨骼和 mesh 信息
- `spec.go` 中的 `log.Printf("[spec]...")` 调试日志 — 已删除，仅保留 2 处必要日志

---

## 八、排查方法论总结

### 8.1 坐标系问题排查流程

1. **先看 spec JSON**：`window.debugGetSpec(path)` 直接看 Go 输出的 localPosition/localRotation
2. **再对 BedrockModel 原始数据**：`model.bones[i].pivot` vs `spec.models[0].bones[i].localPosition`
3. **手算验证**：取一个已知骨骼（如 Head: pivot=[0,24,0], parent=AllBody: pivot=[0,0,0]），预期 `localPosition = [0,24,0] - [0,0,0] = [0,24,0]`
4. **比对 YSMViewer**：用同一模型在 YSMViewer 和本应用中截图对比

### 8.2 纹理映射问题排查流程

1. 看控制台 `[YSM] 纹理:` 日志确认 texIdx 分配
2. 看 `[3dspec]` 日志确认 MeshData.texIdx 值
3. 在 model3d.js 中临时加 `console.log(meshTexIdx)` 确认渲染时用的纹理索引
4. 确认 PNG 不是头像/小图（检查尺寸）

### 8.3 多文件模型排查流程

1. 看 `[spec] 同名骨骼` 日志确认合并策略
2. 看 `[spec] 根节点骨骼` 日志确认层级
3. 看手部骨骼的 `localPosition` 是否合并后偏移
4. 确认 `pivots` map 中同名骨骼保留的是有 parent 的版本

---

## 九、发版变更摘要

| 版本 | 3D 渲染相关变更 |
|------|----------------|
| v1.5.1 | 新增 WASM 内嵌解码、Go spec 构建、Go CLI fallback |
| v1.5.4 | 修复 ZIP 模型骨骼偏移（bug #14/#27） |
| v1.5.5 | 透明度遮挡修复（bug #15） |
| v1.8.5 | 资源类型重构（非 3D） |
| v1.8.6 | 3D 渲染引擎重构：坐标系修正（X 不取反 + fx=ox）、旋转符号三轴取反、JS 兜底 spec 格式对齐、多纹理 texIdx 支持、非贴图 PNG 过滤、mesh 合并策略按 (boneId, texIdx, rotation) 分组 |
| v1.8.7 | Go 路径纹理映射补齐：archive.go 四种 model 格式支持、extracted.go projectiles 数组兼容、TexSlot 透传到 spec.go |
