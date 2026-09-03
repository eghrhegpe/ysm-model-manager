---
kind: fbx-cli-pipeline
name: FBX CLI 处理管线 fbx-cli-pipeline
tier: architecture
category: go
source_files:
  - go/cli/
auto_fields:
  symbols_with_lines:
    - AppService
    - CatCache
    - CatConfig
    - CatModel
    - CatOther
    - CatPerf
    - CatResource
    - CliCommand
    - CmdContext
    - DispatchCommand
    - ErrParam
    - ErrParam.Error
    - ErrParam.Unwrap
    - ErrRuntime
    - ErrRuntime.Error
    - ErrRuntime.Unwrap
    - ExecuteCLIWithApp
    - ExitCodeOf
    - ExitParamErr
    - ExitRuntimeErr
    - ExitSuccess
    - GetAllCommands
    - GetAllowedCommands
    - GetCommand
    - IsCommandAllowed
    - JsonError
    - JsonResponse
    - JsonResponse.ToJson
    - MetaInfo
    - NewJsonError
    - NewJsonNotSupported
    - NewJsonSuccess
    - ParseCommandArgs
    - PrintError
    - RegisterCommand
    - RegisterCommandC
    - RunCLI
    - String
    - TimingInfo
  use_when:
    - FBX
    - CLI
    - 命令行
    - 转换
    - glTF
    - GLB
    - fbx2gltf
    - assimp
use_when:
  - FBX
  - CLI
  - 命令行
  - 转换
  - glTF
  - GLB
  - fbx2gltf
  - assimp
pitfalls:
  - "FBX 不直接解析——走 FBX2glTF + qmuntal/gltf 双段式"
  - "FBX2glTF 是 npm 包装（node 脚本），需要 node 环境"
  - "GLB 中间格式内存占用可能很大，大文件需监控"
  - "GUI 预览（ADR-112 前端 worker）与 CLI 管线互补不冲突"
  - "fbx2gltf 版本漂移可能导致输出 GLB 结构变化"
quick_intents:
  - "批量转换 FBX 到 GLB"
  - "分析 FBX 模型结构（骨骼/材质/动画）"
  - "CLI 模式 FBX 处理流程"
  - "排查 FBX 转换失败原因"
status: active
---
# FBX CLI 处理管线 fbx-cli-pipeline

## 概览

**CLI 模式处理 FBX 的成熟路径，不是「Go 直接解析 FBX」，而是「现成转换器转中间格式 + 成熟库读取」的双段式**：

```
FBX ──FBX2glTF（npm 包装，node 脚本调）──▶ GLB ──qmuntal/gltf（Go）──▶ 分析 / 统计 / 再分发
```

与 GUI 预览（ADR-112 前端 worker 路径）互补不冲突：转换管线服务批处理/分析场景，GUI 拖入 .fbx 预览仍走既有 worker 路径。

## 三路情报（2026-08-22 web 调研）

### ① Go 生态 FBX 解析库——全部不成熟 ❌

| 库 | 状态 |
|----|------|
| `oakmound/ofbx` | OpenFBX（nem0）的 Go port，v0.1，功能有限，**API 即将大改** |
| `o5h/fbx` | Go FBX reader，作者自述 "Not well tested, but should work" |
| `elicdavis/fbx` | v0.0.0-2020，无后续维护 |

社区共识（StackOverflow）：FBX 格式**极泛化、允许厂商扩展**，自写 importer 极难；官方只有 Autodesk FBX SDK（C++）。这印证 ADR-112 选型——前端走 three 官方 FBXLoader（`three/addons` 子路径，ADR-171 已删 `preview-3d/vendor/fbx` 自维护副本，改由 node_modules 版本管理接管）是正确姿势，Go 侧无等价物。

### ② CLI 转换工具——现成可用 ✅

| 工具 | 用法 | 亮点 |
|------|------|------|
| `facebookincubator/FBX2glTF` | `FBX2glTF --binary --draco in.fbx -o out.glb` | Win/Linux/Mac 预编译；**有 npm 包装包 `fbx2gltf`**（`convert(src, dest, opts)` 一行调用） |
| `assimp` | `assimp export in.fbx out.gltf -fgltf2` | 老牌通用，转换面广 |

### ③ Go 读中间格式（glTF/GLB）——成熟 ✅

| 库 | 能力 |
|----|------|
| `qmuntal/gltf` | **完整 glTF 2.0 实现**（`gltf.Open/Save` + modeler/binary 子包），Awesome Go 收录，维护活跃 |
| `qmuntal/draco-go` | 配套 draco 压缩解码（对应 FBX2glTF 的 `--draco` 输出） |

## 推荐落地形态

- **转换器走 node 脚本**：与现有 `scripts/*.mjs` 工具链（doctor/gen-* 零依赖 node）同构，npm 包装免编译，Windows 直接可用
- **读取走 Go**：qmuntal/gltf 成熟，可做成 CLI 命令（如 `fbx-info` / `fbx-export`），接入现有 `file-bench` / `analyze-mmd` 同款分析管线
- **副产品**：GLB 是 three 原生格式，未来前端直读转换产物也顺

## 相关

- [ADR-112：FBX 格式接入与独立预览地基](./../adr/ADR-112-fbx-loader-preview-foundation.md)——前端独立预览路径；FBX→PMX 重定向仍为推迟项
- 本卡为**情报型调研**（2026-08-22 联网搜索三路核实），落地（新 CLI 命令/转换脚本）待排期，未做决策
