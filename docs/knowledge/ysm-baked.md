---
kind: ysm-baked
name: YSM 烘焙与几何反推
tier: architecture
category: core
source_files:
  - frontend/src/preview-3d/decoder/wasm-decode.ts
  - frontend/src/preview-3d/decoder/geometry.ts
tests:
  - frontend/src/preview-3d/decoder/geometry.test.ts
use_when:
  - 烘焙
  - 几何反推
  - pivot
  - 骨骼错位
  - 模型错位
  - UV 对不上
  - 贴图错位
  - RawYsmModel
status: active
---
# YSM 烘焙与几何反推

## 概览

YSM 作者导出模型时，**cube 的语义参数（origin/size/uv/rotation）在导出时被烘焙为纯顶点面**，`RawYsmModel.RawCube.faces` 只保留「每面 4 顶点 + 法线 + 4 组 u/v」。同一份 .ysm 下游有两个消费者，用的数据形态不同：

1. **游戏模组（OpenYSM / ModernYSM 等）**：`YSMBinaryDeserializer` 直读烘焙字节流 → `RawYsmModel`。二进制里 **bone 层的 pivot/rotation 仍然保留**（`YSMBinaryDeserializer.java:495-496`），cube 层只剩 `RawFace`（`RawYsmModel.java:74-79`）；渲染直接消费两者（`YSMClientMapper.java:452` → `NativeModelRenderer`），**不经反推**，所以游戏内模型外观总是正确的；
2. **本应用的预览（前端 WASM / Go 兜底）**：`YSMParser`（公共 C++ 解析器，与 YSMViewer 同源）把烘焙数据**反推**为 BlockBench 语义（`minecraft:geometry[]` bones/cubes/uv），再交给 `parseBedrockGeometryFromJSON` 渲染。

**核心推论：预览里的 cube 语义 = 反推结果，不是原始文件；反推可能猜错。**

## 核心要点

- `RawYsmModel.RawCube.faces`：**cube 的几何**被烘焙成顶点面，每面存 4 顶点 xyz + 1 法线 + 4 组 float u/v，读取见 `YSMBinaryDeserializer.java:472-478`。**bone 的 pivot/rotation 并未丢失**——`YSMBinaryDeserializer.java:495-496` 保留，渲染端真实使用（`YSMClientMapper.java:452` 塞进 GeoBone，矩阵应用见 `NativeModelRenderer.java:244`）。
- `YSMParser` 的几何反推是**由点面重建 cube 语义**（猜 origin/size/uv）的算法：多组参数可视觉完全一致，故反推参数可能与原文件不同，但**外观通常一致**。
- **复杂嵌套旋转 / 极近重合顶点 / 非标准几何体**时，反推可能误判特定骨骼的 pivot 或 rotation 方向 → **关联部件错位甚至方块崩溃**（上游仓库 README FAQ 已列为已知限制）。

## 对外 API / 入口

- `frontend/src/preview-3d/decoder/wasm-decode.ts` — `decodeYsmViaWasm`：WASM 解码出文件列表 → 读 `ysm.json` 取模型/纹理顺序 → 反推出的 geometry JSON → `BedrockGeometry`；最终交 `loader.ts` 消费
- `frontend/src/preview-3d/decoder/geometry.ts` `parseBedrockGeometryFromJSON` — 消费反推 JSON，UV 兼容数组 `[x,y]` / 对象 `{uv:[...],uv_size:[...]}` / JSON 字符串（faceUV）/ 兜底 `[0,0]` 四种形态（`geometry.ts` UV 形态解析）
- Go 兜底侧见 [go_geometry](./go-geometry.md) `ParseBedrockGeometry` / `ParseFromZip`（同一份反推 JSON 的另一输入端）

## 与其他子系统关系

- 上游参照：`upstream/ModernYSM-1.20.1-forge`（开源版）二进制反序列化 + 渲染直接吃烘焙数据，能力对标 YSMViewer（**该 upstream 目录未纳入本仓库**，`YSMBinaryDeserializer.java` / `RawYsmModel.java` 的具体行号引用仅作为外部参考，不在本卡 source_files 中）
- 本仓库实际 YSM 解析落地：`frontend/public/wasm/YSMParser.{js,wasm}` — 由公共 C++ 解析器（与 YSMViewer 同源）编译的 WASM 二进制 + 胶水 JS，前端 `decodeYsmViaWasm` 通过 import 调用；Go 端不直接反序列化 YSM 二进制，仅消费 WASM 反推出的 JSON
- 下游消费：[app_preview](./app-preview.md) 的 model3d/model2d 渲染；`model3d.ts` 的 pivot 符号约定是有历史修复点（见 bug-chronicle）
- 相关卡：[ysm_wasm](./ysm-wasm.md)（解码层机制）、[go_geometry](./go-geometry.md)（Go 端解析）、[go_ysm_parser](./go-ysm-parser.md)

## 不变量

- **UV 基本可放心**：UV 以每面浮点原样烘焙（`RawFace.u/v[4]`），反推不丢贴图；贴图错位只可能出在 `geometry.ts` UV 形态解析或 texSlot 绑定（见 [go_geometry](./go-geometry.md)：`texSlot = 第 i 个模型 → 第 i 个纹理`）
- **bone pivot/rotation 是二进制保留值**：模组与（反推后的）预览根源相同；但 cube 的 origin/size/uv/rotation 是反推补全——预览与游戏内出现骨骼姿态差异、方块错位时，**先怀疑反推误判**而非文件损坏
- 复杂嵌套旋转/重合顶点可能**渲染崩溃**——上游已知限制，不是本应用缺陷，不要在几何反推端打补丁硬修（等上游修复后同步）
- 接入新上游版本时：WASM 资产（两个 *-data.js）与模组侧同一 C++ 源码但导出面不同（内存直解 vs callMain），更新需逐端同步重出（详见 [ysm_wasm](./ysm-wasm.md)）

## 相关

- [ysm_wasm](./ysm-wasm.md) — WASM 解码层机制
- [go_geometry](./go-geometry.md) — Go 端 geometry 解析
- [app_preview](./app-preview.md) — 预览消费端