# 渲染对齐黄金对比（YSMViewer vs 本项目）

对比 **YSMViewer C# 渲染管线**（`ThreeJsPayloadBuilder.cs`）与 **本项目 Go 渲染管线**（`go/threejs/spec.go`）对同一 `.ysm` 的 spec 输出，逐字段数值级验证对齐。

## 工具

| 文件 | 作用 |
|------|------|
| `csharp-builder.mjs` | **C# `ThreeJsPayloadBuilder` + `ConvertBones` 的 JS 忠实复刻**（含 `MinecraftCubeUV.Expand` box UV、`CreateBlockbenchQuaternion` Shepperd 法）——严禁按 Go 口径"修正" |
| `cmd/specgen/main.go` | Go 侧：Bedrock geometry JSON → `geometry.ParseBedrockGeometry` → `threejs.Build()` → spec JSON |
| `compare.mjs` | 主脚本：同一 geometry JSON 双侧生成 spec，逐字段对比（容差 1e-3，长度量归一化 ×1/16 对齐 C# ExportScale） |

用法：

```bash
# 1. 解码 .ysm → Bedrock JSON（落盘 tests/ysm-reference/）
node scripts/test-decode-from-memory.mjs "upstream/<模型>.ysm"
# 2. 对比某个 geometry JSON
node tests/port-verification/compare.mjs "tests/ysm-reference/<模型>/output/model/models/main.json"
```

## 已验证（2026-08-08，3 个模型 / 4 个 geometry）

| 模型 | 骨骼 | localRotation 真差异 | mesh 数量差 |
|------|------|---------------------|------------|
| 黎歌·国风款（main，169 骨） | ✅ 169=169 | 14（均带 Z 旋转） | -3（0 厚度 cube） |
| 黎歌·国风款（arm，8 骨） | ✅ 8=8 | 0 | 0 |
| 双月希瞳 v2.2（main，836 骨） | ✅ 836=836 | 91（均带 Z 旋转） | -51（0 厚度 cube 为主） |

几何层：**normals 0 差异、indices 0 差异、positions 归一化后 1831/1955 ✅**（剩余 124 为同名骨骼族 pivot 差）。

## 差异分类（按影响排序）

### 1. ExportScale 缺失（全局尺度）
- C# 所有长度量 `× 1/16`（`ExportScale`，`ThreeJsPayloadBuilder.cs:10`）；Go spec 无 scale，前端 `model3d.ts:137` 用**动态启发式**（`>32→1/16, >4→1/4, else 1`）补偿。
- **风险**：YSMViewer 固定 1/16；模型最大边长落在 4~32 时前端用 1/4，渲染尺寸比 YSMViewer 大 4 倍。属设计差异，但动态分档与固定 1/16 不等价。

### 2. Z 轴旋转符号（localRotation 真差异）
- C#：`ConvertBones` 对 rotation 做 `(-rx, -ry, +rz)`（`YsmLoaderService.cs:718`）+ builder 正角度四元数 → 等效 `q(-rx,-ry,+rz)`。
- Go：`eulerToQuaternion(-rx,-ry,-rz)`（`spec.go:123/:442`）三轴取反。
- **Z 轴符号相反**，所有带 Z 旋转的骨骼/mesh 镜像（黎歌 14、双月 91）。
- 注：`docs/archive/3D/quaternion-investigation.md` 曾测试 `(-rx,-ry,+rz)`（公式 2）判定"❌翻转"，与 C# 口径矛盾——需以数值对比为准重新裁决。

### 3. 0 厚度 cube 被丢弃（mesh 数量差）
- C#：`BuildCubeMeshData` 对零厚度面做 `+0.001` 修正**保留**（`ThreeJsPayloadBuilder.cs:151-153`）。
- Go：`spec.go:358` `if sx==0||sy==0||sz==0 { return nil }` **直接丢弃**。
- 影响：黑板（size z=0）、眉毛、缎带、贴花等薄片模型**整个消失**（双月希瞳 -51 个 mesh 主要来源）。

### 4. 同名骨骼族位置差（localPosition 真差异 64/169）
- C#：`bonePivots` Dictionary 按序**覆盖**，`localPosition = pivot - parentPivot`（`ThreeJsPayloadBuilder.cs:55-63`）。
- Go：`spec.go:70-98` 同名骨骼 overwrite 规则 + `:287-311` `RightArm/LeftArm→Arm` 层级修补。
- 影响：LeftArm/RightArm/Arm、zs、Brow 等重名骨骼族位置偏移（÷16 后 0.02~0.4）。

### 5. UV 差异（347/1955 mesh）
- 真差异为主（n>1e-2 有 335 个，max 0.51）。需进一步定位：face_uv 面序映射（east/west/north/south 顺序）或 box UV expand 公式差异。
- 待办：对比 `spec.go parseUV/expandBoxUV` 与 C# `MinecraftCubeUV.Expand` 逐面。

## 复刻正确性说明

- `csharp-builder.mjs` 中 `getFaceUV` 曾因 JS 对象键 `v1` 缺失产生 undefined（已修）；修后 uvs 差异从"NaN"收敛为真实 UV 差异。
- 四元数用 Shepperd 法（与 .NET `Quaternion.CreateFromRotationMatrix` 标量路径一致）；C# 侧 float 精度，JS/Go 为 double，1e-3 容差可容纳（positions 160 个 1e-3~1e-2 级差异即精度差）。
