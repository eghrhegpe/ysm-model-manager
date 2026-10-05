# ADR-067：zip 化资源识别：扩展名歧义消解与内容指纹覆盖

- **状态**：✅ 已采纳
- **日期**：2026-08-16
- **决策人**：Jieling（人类首席架构师）、AI 代理
- **相关**：`go/packs/mcmeta.go, go/types/extensions.go, go/importer/importer_file.go, go/types/resource_types_embed.go, resource_types.json, frontend/src/utils/resource/types.ts, ADR-066`

---

## 1. 背景（Context）

全资源预览器（ADR-066）落地 P0「注册表驱动派发」后，暴露出更深一层的墙：**所有资源都能被 `.zip`（乃至 `.7z`）包裹**，但当前 Go 端 `DetectResourceType` 对「zip 化变体」的识别覆盖极不完整。

实测两类检测路径对 EntityPlayer / SceneModel（含 `.vrm`）/ blueprint / litematic 的 `.zip` 包裹**均失效**：

| 路径 | 代码 | 卡点 |
|------|------|------|
| `packs.DetectResourceType` | `go/packs/mcmeta.go:145` `if !hasExt(ext, rt.Extensions) continue` | `.zip` 只放行 `extensions` 含 `.zip` 的类型（仅 resourcepack/shaderpack/ysm）。其余 4 类 `extensions` 不含 `.zip` → 第一关被踢出，detector 永不执行 |
| `importer.DetectZipType` → `MatchZipEntry` | `go/types/extensions.go:172` `if len(rt.ZipEntries) == 0 continue` | 只匹配声明了 `zipEntries` 的类型。其余 4 类未声明 `zipEntries` → 直接跳过，默认回退 `"ysm"` |

**根因**：`resource_types.json` 中 mmd/vrc/蓝图/投影的 `extensions` 未列 `.zip`、且 `detector: "extension"` 根本不看内容。用户拖一个「装 MMD 模型的 `.zip`」进来，两条路径都返回 `""`（未知）。这把「扩展名歧义」问题，从 ADR-066 P0 的「前端查表 vs 硬编码」推到了 **Go 端检测核心的扩展名门槛 + 内容指纹覆盖**。

---

## 2. 决策（Decision）

采用**统一 `zipentry` detector + 内容指纹注册表驱动**方案，零新增检测代码（仅新增一个 switch case 与一个 helper）。

### 2.1 S1 — Schema（双文件同步）

对 EntityPlayer / SceneModel / blueprint / litematic 四类，在 `resource_types.json`（根，前端事实来源）**同步**做三处改动：

1. `extensions` 追加 `.zip`（使扫描层能发现 zip 化资源、且通过 `mcmeta.go:145` 的 `hasExt` 门槛）；
2. `detector` 由 `"extension"` 改为 `"zipentry"`（裸文件按扩展名、容器按内容指纹，杜绝盲判）；
3. 新增 `zipEntries` 内容指纹（形状 `{ "name": "...", "match": "exact"|"prefix"|"suffix" }`，与 resourcepack/shaderpack/ysm 同范式）。

| 类型 | 新增 extensions | detector | zipEntries |
|------|----------------|----------|------------|
| EntityPlayer | `.zip` | `zipentry` | `[{name:".pmx",match:"suffix"},{name:".pmd",match:"suffix"},{name:".vrm",match:"suffix"}]` |
| SceneModel | `.zip` | `zipentry` | `[{name:".pmx",match:"suffix"},{name:".pmd",match:"suffix"},{name:".vrm",match:"suffix"}]` |
| blueprint | `.zip` | `zipentry` | `[{name:".nbt",match:"suffix"},{name:".schematic",match:"suffix"}]` |
| litematic | `.zip` | `zipentry` | `[{name:".litematic",match:"suffix"}]` |

> 注：`EntityPlayer` / `SceneModel` 为 `isDir: true`（目录型资源），zip 化指「导入含模型文件的 `.zip`」。（2026-08-21 更新：原 `mmd-skin` / `vrchat-avatar` 类型已随 ADR-111 variants 解耦退役，`.vrm` 并入 EntityPlayer/SceneModel。）
### 2.2 S2 — Go 检测核心（最小侵入）

`mcmeta.go` 仅新增一个 switch case + 一个 helper，并**行为保持**地把 `hasExt` 提到循环内（不改变准入语义）：

```go
// go/packs/mcmeta.go —— DetectResourceType 内
ext := strings.ToLower(filepath.Ext(path))
isContainer := ext == ".zip" || ext == ".7z"

for _, rt := range registry.ResourceTypes {
    extOK := hasExt(ext, rt.Extensions)
    if !extOK {
        continue // 准入语义与改动前完全一致
    }
    switch strings.ToLower(rt.Detector) {
    case "ysm":
        if isYsmFile(path) { return rt.ID }
    case "mcmeta":
        if hasMcmeta(path) { return rt.ID }
    case "shader":
        if hasShaders(path) { return rt.ID }
    case "zipentry": // ADR-067：裸文件按扩展名、容器按 zipEntries 内容指纹
        if isContainer {
            if matchZipArchive(path, &rt) { return rt.ID }
        } else if extOK {
            return rt.ID
        }
    case "", "extension":
        return rt.ID
    default:
        return rt.ID
    }
}
return ""
```

新增 helper（打开容器、按 `rt.ZipEntries` 匹配条目名）：

```go
// go/packs/mcmeta.go
// matchZipArchive 打开容器（.zip）并按 rt.ZipEntries 内容指纹匹配（ADR-067）。
// .7z 非 ZIP 格式，zip.OpenReader 不可用；.7z 包裹的 mmd/vrc 等内容检测不在本 ADR 范围（见 §3 遗留）。
func matchZipArchive(path string, rt *types.ResourceType) bool {
    r, err := zip.OpenReader(path)
    if err != nil {
        return false
    }
    defer r.Close()
    for _, f := range r.File {
        if rt.MatchZipEntry(strings.ToLower(f.Name)) {
            return true
        }
    }
    return false
}
```

`importer.DetectZipType`（`go/importer/importer_file.go:136`）**无需改代码**——其 `MatchZipEntry` 遍历全注册表，S1 补上 4 类 `zipEntries` 后自动命中（未命中仍默认 `"ysm"`）。

### 2.3 S3 — 冲突优先级（零代码，设计规则）

一个 `.zip` 可能同时满足多个 `zipEntries`（如同时含 `ysm.json` 与 `model.pmx`）。消解规则 = **注册表顺序即优先级**：`DetectResourceType` 与 `MatchZipEntry` 均按注册表顺序遍历、首命中胜出。当前顺序 `[resourcepack, shaderpack, ysm, maid-model, blueprint, litematic, EntityPlayer, SceneModel, CustomAnim, CustomMorph, StageAnim, mmd-shader, DefaultAnim, DefaultMorph, fbx]`（15 类，2026-08-21 核对），使 ysm（唯一根标记 `ysm.json`/`models/`）天然排在 MMD 之前 → YSM 更具体者优先，符合直觉。该规则已隐含于现有遍历逻辑，无需额外代码。

### 2.4 S4 — 前端安全契约

`frontend/src/utils/resource/types.ts` 新增 `AMBIGUOUS_EXTS` + `resolveTypeSafe`：歧义扩展名（`.zip`/`.7z` 归属 ≥2 类型）返回 `null`，强制调用方回退 `DetectResourceType` 内容检测。新分发器（P1 VRM / P2 MMD 适配器）统一使用，从入口杜绝硬编码扩展名派发。

---

## 3. 后果（Consequences）

### 正面
- **zip 化资源可识别**：mmd/vrc/蓝图/投影的 `.zip` 包裹走内容指纹，不再漏检。
- **注册表驱动、零新增检测逻辑**：新增格式只改 JSON（S1），不动 `mcmeta.go` 检测核心——与 ADR-064/065/066 同一治理语言。
- **前后端契约统一**：S4 `resolveTypeSafe` 让前端 dispatch 与 Go `DetectResourceType` 口径对齐。

### 负面 / 风险
- 🔴 **Go 检测核心改动回归风险**（S1/S2）：`mcmeta.go` 是扫描/导入/安装的全链路基础，改动须跑 `go test ./go/...` + `resource_types_consistency_test.go`（embed 与 JSON 双副本一致性）方可放行。
- 🟡 **`.7z` 内容检测缺口**：`zip.OpenReader` 不支持 `.7z`，mmd/vrc 的 `.7z` 包裹暂不走内容指纹（沿用扩展名兜底，与现状一致），列为遗留。
- 🟡 **schema 双副本同步**：`resource_types.json` 与 `resource_types_embed.go` 必须同步，否则一致性测试失败。
- 🟢 **`.zip` 歧义不消失，但被固化**：`.zip` 仍归属多类型，靠 `resolveTypeSafe` 强制回退内容检测（而非静默盲判），属设计内的正确行为。

### 已知遗留
- `.7z` 包裹的非 ysm 资源内容检测（需引入 7z 读取器，范围外）。
- 契约测试：扩展名→类型解析、voxelFn 映射、zip 化识别的单元测试尚未补（ADR-066 §5.3 待办）。

---

## 4. 数据溯源 / 实现说明（审核补注）

### 4.1 现场核验（file:line 实锤）
- `go/packs/mcmeta.go:144-170` — `DetectResourceType`：`hasExt` 门槛（:145）+ detector switch（:149）。
- `go/types/extensions.go:169-180` — `MatchZipEntry`：跳过 `ZipEntries` 为空的类型。
- `go/importer/importer_file.go:136-158` — `DetectZipType`：字节扫描 + `MatchZipEntry`，默认 `"ysm"`。
- `go/types/resource.go:43-66` — `ZipEntryMatch{Name,Match}` + `MatchZipEntry`（exact/prefix/suffix）。
- `resource_types_embed.go:1` — `// Code generated from resource_types.json; DO NOT EDIT.` + 双副本一致性测试 `resource_types_consistency_test.go`。

### 4.2 回归验证口径（zip 化资源检测契约）

1. `go test ./go/types/...`（embed 与 JSON 一致性）
2. `go test ./go/packs/... ./go/importer/...`（检测核心）
3. 前端 `npm run typecheck` + `npx vite build`
4. 构造样本验证：纯 `.pmx`、装 `.pmx` 的 `.zip`、同时含 `ysm.json`+`model.pmx` 的 `.zip`（断言 ysm 优先）

---

<!-- 文件名: zip-packaged-resource-detection.md → 实际文件 ADR-067-zip-packaged-resource-detection.md -->
