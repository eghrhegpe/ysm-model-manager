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
# 1. 解码 .ysm → Bedrock JSON（落盘 tests/ysm-reference/，git 忽略）
node scripts/test-decode-from-memory.mjs "upstream/<模型>.ysm"
# 2. 对比某个 geometry JSON
node tests/port-verification/compare.mjs "tests/ysm-reference/<模型>/output/model/models/main.json"
```

## 当前状态（2026-08-08，ADR-041 落地后）：全字段归零

| 模型 | 骨骼 | 骨骼差异 | mesh | mesh 差异 |
|------|------|---------|------|----------|
| 黎歌·国风款（main，169 骨） | ✅ 169=169 | ❌ 0/169 | ✅ 1958=1958 | ❌ **0/1958** |
| 黎歌·国风款（arm，8 骨） | ✅ 8=8 | 0 | ✅ | 0 |
| 双月希瞳 v2.2（main，836 骨） | ✅ 836=836 | ❌ 0/836 | ✅ 5678=5678 | ❌ **0/5678** |

- positions / normals / uvs / indices / localPosition / localRotation **全部 0 差异**
- 五类差异的修复记录见 [ADR-041](../docs/adr/ADR-041-spec-render-alignment.md)

## 五类差异 → 修复结论（ADR-041）

| # | 差异 | 根因 | 处置 |
|---|------|------|------|
| 1 | ExportScale 缺失（全局尺度） | C# 全量 ×1/16；前端原用动态 scale（>32→1/16、>4→1/4、else 1） | **已修**：`model3d.ts` 固定 1/16 |
| 2 | Z 轴旋转符号（localRotation） | C# 等效 `q(-rx,-ry,+rz)`；Go 原三轴取反 | **已修**：`spec.go` Z 不取反 |
| 3 | 0 厚度 cube 丢弃（mesh 数量差） | C# `+0.001` 保留；Go 原 `return nil` | **已修**：删除丢弃分支 |
| 4 | 同名骨骼族位置差（localPosition） | 实为坐标系 X 镜像：C# `ConvertBones` 翻转 pivot.X；Go 基岩坐标 | **已修**：12 处 localPosition X 翻转 |
| 5 | UV 差异 | 公式与 C# 逐面一致；历史差异是 #3 导致的 mesh 顺序错位假象 | **无需修改**（#3 修复后归零） |

## 复刻正确性说明

- `csharp-builder.mjs` 中 `getFaceUV` 曾因 JS 对象键 `v1` 缺失产生 undefined（已修）；修后 uvs 差异从"NaN"收敛为真实 UV 差异。
- 四元数用 Shepperd 法（与 .NET `Quaternion.CreateFromRotationMatrix` 标量路径一致）；C# 侧 float 精度，JS/Go 为 double，1e-3 容差可容纳。
- X 翻转后注意：`csharp-builder.mjs` 是**基准**，Go 侧 `spec.go` 的 12 处 localPosition 计算与 C# 逐一对齐（含 Arm 修补路径）。
