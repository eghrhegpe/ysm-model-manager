# R29 审核：go/ysm + go/geometry（两模块并行）

> 审核日期：2026-08-31｜审核人：deepseek（主模型）× 2 explore 子代理｜状态：⏳ 修复闭环中
> 前置：R26 installer+recycle+download / R27 sync+dedup / R28 cli+litematic

## 范围与岔开依据

**审核**（两模块并行，single 深度，只读）：

| 模块 | 非测试文件 | 规模 | 前置审核 |
|---|---|---|---|
| ysm | 7 个（extracted.go/summary.go/header.go/texsize.go/parse.go/ysm.go/decode_inject.go） | 2517 行 | 无 R 级系统审核 |
| geometry | 3 个（archive.go/ysm_parser.go/parse.go） | 2316 行 | 无 R 级系统审核 |

**岔开**：R28 完结 cli+litematic。ysm 是 YSM 模型格式解析包（与 litematic 同属「外部输入解析」域），geometry 是归档解压+几何计算包（与 litematic 的 voxel 渲染耦合）。两包同属「模型解析/归档处理」域，一次性过。

## 总体结论：通过（3 项 P2 + 8 项 P3 + 9 项 P4）

两包代码质量分化明显：

- **go/ysm**：防御性扎实——整数溢出钳制（`parseInt`/`clampTexDim`）、路径穿越防护（`safeJoinModelPath`/`bindPerComponentTex` HasPrefix 检查）、截断探测（`ReadLimitedEntry` limit+1）、ZIP 大小预检（`parse.go`）等关键防线均已就位且注释清晰。残留风险集中在 summary.go 的 ZIP 降级扫描缺少条目数封顶（P3-1 DoS）、裸 JSON 分支的 TOCTOU 窗口（P2-2），以及 summary/extracted 两处 model 解析口径不一致（P4-1）。
- **go/geometry**：核心安全面（单条目大小限制、reader 泄漏、Zip Slip）已妥善处理，注释中大量「code review P2/P3」标记表明经过多轮审查。最值得关注的是 **archive.go 缺少总条目数/总大小上限导致 OOM**（P2-1）——这是唯一可能被恶意归档利用的实际安全风险，建议优先修复。archive.go 1725 行单文件包含至少 7 个独立职责域，函数间隐式时序约束仅靠注释维护，无编译期保障。

## 发现项汇总

| 模块 | P2 | P3 | P4 | deep 复审 |
|---|---|---|---|---|
| ysm | 3 | 4 | 4 | 是（P3-1 DoS + P4-1 口径分歧 + P4-4 pngNameMap 键不匹配） |
| geometry | 2 | 4 | 5 | 是（P2-1 OOM + P3-1 sortByTexOrder 双排序同序假设） |
| **合计** | **5** | **8** | **9** | — |

## ysm 发现项

### P2（正确性）

| # | 位置 | 问题 | 修复方向 |
|---|---|---|---|
| P2-1 | parse.go:114-126 | `modelFile.Open()` 拿到的 rc 传给 `fsutil.ReadLimitedEntry`（该函数内部 `defer rc.Close()`），但 `ReadLimitedEntry` 对**读取 IO 错误**和**超限**统一返回 nil，`AnalyzeYSMModel` 仅在 `data == nil` 时报「读取 model.json 失败或超过 5MB 上限」——两种不同故障被合并为一条模糊消息，且丢失了底层 error 链。 | 要么保留 `extractYsmRootFromZip` 那样的手写 LimitReader 路径以区分错误，要么接受现状（当前注释已解释此取舍，严重性低）。 |
| P2-2 | summary.go:318-322 | 裸 ysm.json 分支先 `os.Stat` 检查 `fi.Size() > types.MaxReadLimit` 再 `os.ReadFile`，存在 **TOCTOU 窗口**：Stat 后文件被替换为更大文件，ReadFile 无界读入内存。 | 用 `io.LimitReader` + `os.Open` 流式读取，或接受该窗口（本地文件，风险低）。 |
| P2-3 | summary.go:319 / parse.go:84 | `types.MaxReadLimit`（50MB）与 `types.MaxImportSize`（500MB）是不同常量，但 `parse.go:84` 用 `MaxImportSize` 检查单条目 `UncompressedSize64`，而 `summary.go` / `texsize.go` 用 `MaxReadLimit` 检查读取上限。两道防线口径不同本身合理，但 `parse.go:84` 的单条目上限 500MB 远大于实际读取上限 50MB——单条目 400MB 的 ZIP 条目会通过 parse.go 的检查，随后 `ReadLimitedEntry` 拒绝（返回 nil），功能正确但防线层级不一致。 | 统一单条目声明上限与读取上限。严重性低。 |

### P3（可靠性）

| # | 位置 | 问题 | 修复方向 |
|---|---|---|---|
| P3-1 | summary.go:231-261 `scanZipBasicStats` | 遍历 ZIP 所有 `.json` 条目逐个 `Open()+ReadLimitedEntry(5MB)`，**无条目数上限**。恶意 ZIP 塞入数万个微小 `.json` 条目可造成显著 CPU/IO 耗时。`parse.go` 有总大小检查但 `summary.go` 的 ZIP 分支无任何预检。 | 给 `scanZipBasicStats` 加条目数封顶（如 2000），超限即停止并标记统计不完整。 |
| P3-2 | header.go:47-169 `scanHeader` | 使用 `bufio.NewScanner` 默认 64KB 行长限制，**不检查 `scanner.Err()`**。恶意/畸形 YSM 文件头部含超长行（>64KB）会导致 `Scan()` 返回 false 且函数静默返回空 header，与「正常头部」无法区分。 | 循环结束后检查 `scanner.Err()`，若是 `bufio.ErrTooLong` 则日志标记或增大 `Scanner.Buffer`。 |
| P3-3 | texsize.go:163-186 `ScanFiles` | `filepath.WalkDir` 的返回 error 被**完全忽略**（无 `_ =` 也无日志）。若遍历中途发生不可恢复错误，调用方无任何信号。 | 至少 `_ = filepath.WalkDir(...)` 显式标注忽略，或记录 error 日志。 |
| P3-4 | extracted.go:124-214 `parsePlayerModel` | map 分支中 `dec.Decode(&val)` 对非字符串 value（数字/对象/数组）会返回 error 并 `continue`，但若 value 是**畸形 JSON 片段**（如截断的对象），Decoder 可能消费到非法 token 后停止，后续 `dec.More()` 行为依赖 Decoder 内部状态。 | 对畸形输入添加针对性测试，确认 map 分支不会因单个畸形 value 丢失全部后续键。 |

### P4（可维护性）

| # | 位置 | 问题 | 修复方向 |
|---|---|---|---|
| P4-1 | summary.go:471-546 `extractFileStats` vs extracted.go:124-214 `parsePlayerModel` | 两处对 `files.player.model` 的**解析口径不一致**：summary 先试 `[]struct{Path string "json:path"}`（对象数组带 path 字段），再 fallback；extracted 先试 map（Decoder 保序），再 `[]string`，再 trimmed string。若实际 ysm.json 的 model 字段是 `[{"path":"models/main.geo.json"}]` 格式，extracted 的 array 分支会失败并误入 trimmed string 分支产生畸形模型名。 | 确认 YSM model 字段的实际合法形态集合，统一两处解析口径（或文档化差异原因）。 |
| P4-2 | texsize.go:109 vs texsize.go:74-90 | `readTexFrom7z` 显式跳过 `types.IsYsmEntryJSON`（ysm.json 自身），`readTexFromZip` **无此跳过**。功能等价（ysm.json 无 `minecraft:geometry`，`extractTexSizeFromGeometryBytes` 返回 0,0 被跳过），但口径不一致易在后续维护中引入漂移。 | 统一两路径的条目过滤逻辑。 |
| P4-3 | summary.go:443 | 局部变量 `types := extractControlTypes(b.ConfigForms)` **遮蔽包级 `types`**（`ysm-model-manager/go/types`）。当前函数体内此后未再引用包级 `types`，故无实际 bug，但遮蔽标准库/包名是已知可读性陷阱。 | 将局部变量重命名为 `controlTypes` 或 `ctypes`。 |
| P4-4 | extracted.go:752 `bindPerComponentTex` 分支 B | `c.pngNameMap[texName]` 查找，`texName` 来自 `computeTexSlotForComponent` 计算的结果。`buildPngNameMap` 的键是 `strings.TrimSuffix(tf.name, filepath.Ext(tf.name))`——`tf.name` 是**小写 basename 含扩展名**，去扩展名得小写 basename 无扩展名。而 `texName` 在 `computeTexSlotForComponent` 中初始化为 `strings.ToLower(base)`。`base` 在 `FindComponentsInExtractedYSM` 第 849-853 行是 `mn` 去路径去 `.geo.json`/`.json`。口径**基本一致**但 `buildPngNameMap` 用 `filepath.Ext` 去扩展名（只去最后一段），而 `base` 去除用 `TrimSuffix` 显式去 `.geo.json` 和 `.json`——对 `.geo.json` 文件，前者去 `.json` 得 `xxx.geo`，后者去 `.geo.json` 得 `xxx`。**若组件模型文件名含 `.geo.json`，pngNameMap 键与 texName 不匹配**，导致分支 B 同名纹理兜底失效。 | 统一去扩展名口径，或在 `buildPngNameMap` 中也按 `.geo.json` → `.json` 顺序 TrimSuffix。此为潜在行为 bug，但因依赖实际文件命名约定，暂列 P4 待确认。 |

## geometry 发现项

### P2（正确性）

| # | 位置 | 问题 | 修复方向 |
|---|---|---|---|
| P2-1 | archive.go:223-246 `classifyFileInventory` | **缺少总条目数/总大小上限导致 OOM**。`classifyFileInventory` 遍历归档所有条目，`FileInventory` 的 `GeoFiles`/`PngFiles`/`Animations`/`Textures`/`Models` 等 slice 无上限 append。恶意归档塞入数十万微小条目可导致 `FileInventory` 结构占用数 GB 内存。`parse.go` 有 `totalSize` 检查但 `classifyFileInventory` 在 `OpenArchive` 后直接遍历，无独立预检。这是唯一可能被恶意归档利用的实际安全风险。 | 给 `classifyFileInventory` 加条目数封顶（如 10000）+ 总解压大小封顶（如 2GB），超限即停止并返回 `ErrTooManyEntries`/`ErrArchiveTooLarge`。**建议对 P2-1 做 deep 复审**（构造超多条目归档验证 OOM）。 |
| P2-2 | archive.go:640-648 `selectBestMaidCandidate` | `best := candidates[0]` 在空切片时 panic。当前唯一调用点 `collectMaidManifest` 有 `len(candidates) > 0` guard，但函数本身不防御。 | 函数开头加 `if len(candidates) == 0 { return maidNsCandidate{} }`。 |

### P3（可靠性）

| # | 位置 | 问题 | 修复方向 |
|---|---|---|---|
| P3-1 | archive.go:595-627 `sortByTexOrder` | 两次 `sort.SliceStable` 分别排序 `pngs` 和 `pngNames`，比较器 `less` 闭包都读 `pngNames`。正确性依赖"两切片同序 + 比较器相同 → 产生相同排列"这一不变量。如果未来有代码路径在 `pngs` 和 `pngNames` 不同序时调用此函数，排序结果将错乱。 | 用 `sort.Slice` 排序索引数组，再按索引重排两个切片，消除对同序不变量的依赖。 |
| P3-2 | archive.go:223-246 `classifyFileInventory` switch case 顺序 | `.animation.json` 后缀的几何文件被误分类：名为 `arrow.animation.json` 的旧格式几何文件会被 `case ".animation.json"` 先命中并归入 `Animations`，而非 `LegacyModels`。实际场景中几何文件不会以 `.animation.json` 命名，风险低。 | 在 `.animation.json` 分支加 `isLegacyGeometryName` 排除，或调整 case 优先级。 |
| P3-3 | archive.go:595-627 `parseMaidModelJSON` 的 `len(parts) < 3` 检查 | 要求路径至少 3 段（`assets/<ns>/maid_model.json`），单层命名空间的 `mymod/maid_model.json`（2 段）被静默跳过。这是有意的标准 YSM 口径，但对非标准包可能导致清单丢失。 | 如需支持非标准包，改为 `len(parts) < 2`；否则在注释中明确此限制。 |
| P3-4 | ysm_parser.go:122-173 `parseProjModels` | `dec2.Decode(&cfg)` 失败时静默跳过，不记录错误。若 ysm.json 的 `project` 字段含畸形 JSON，调用方无任何信号。 | 至少 `log.Printf` 记录解码失败，或返回 error 让调用方决策。 |

### P4（可维护性）

| # | 位置 | 问题 | 修复方向 |
|---|---|---|---|
| P4-1 | archive.go 1725 行单文件 | 包含归档打开、条目枚举、ysm.json 解析、L0/L1 清单分层、纹理排序、组件构建、SubModels 构建等至少 7 个独立职责域。函数间隐式时序约束（如 `sortByTexOrder` 必须在 `buildSubModels` 之前调用、`sortByModelOrder` 必须在 `mergeGeoFiles` 之前）仅靠注释维护，无编译期保障。 | 按职责拆分为 `archive_collect.go`、`archive_l0.go`、`archive_components.go`、`archive_sort.go` 等子文件。 |
| P4-2 | ysm_parser.go vs go/ysm/ | `ysm_parser.go` 的 `parseYsmArchive`/`parseProjModels`/`parseModelOrder` 与 `go/ysm/` 包的 YSM 模型解析存在概念重叠（注释中多次提到"与 go/ysm 口径一致"）。两个包各自维护 YSM 解析逻辑，口径漂移风险高。 | 评估将共享的 YSM 结构解码逻辑收敛到 `go/ysm/` 或独立的 `go/ysmproto/` 包。 |
| P4-3 | archive.go:898 注释与代码脱节 | 注释说"IsArmModelName 检查发生在 Open+Read 之后（保持原序，勿顺手优化成先判断再读）"，但 L927 `if IsArmModelName(e.Name()) { continue }` 确实在 `ReadLimitedEntry` 之后。注释暗示这是有意保留的浪费（先读 arm.json 到内存再丢弃），但没有解释**为什么**不能先判断——实际上 `IsArmModelName` 只需文件名，可以在 Open 前判断。 | 要么优化为先判断再 Open（减少不必要的 IO），要么在注释中明确解释保留此序的原因。 |
| P4-4 | archive.go:83-88 `coverCandidateNames` 与 `extractFirstPNG` 逻辑分散 | 封面候选名定义在 `archive.go`，但 `extractFirstPNG` 的两遍扫描逻辑（精确候选 → 回退第一张 PNG）与 `fileops.FindPreviewImage` 的散图候选逻辑平行存在，无统一收敛点。 | 将封面候选名和扫描逻辑收敛到 `go/fsutil/` 或 `go/types/` 的单一事实来源。 |
| P4-5 | archive.go:640-648 `selectBestMaidCandidate` 无空切片保护 | `best := candidates[0]` 在空切片时 panic。当前唯一调用点 `collectMaidManifest` 有 `len(candidates) > 0` guard，但函数本身不安全——如果未来有其他调用点传入空切片就会 panic。 | 函数开头加 `if len(candidates) == 0 { return maidNsCandidate{} }`。 |

## 修复状态注记（2026-08-31 闭环进行中）

| 级别 | 位置 | 状态 |
|---|---|---|
| ysm P2-1 (ReadLimitedEntry 错误合并) | parse.go:114-126 | ⏳ 待修 |
| ysm P2-2 (裸 JSON TOCTOU) | summary.go:318-322 | ⏳ 待修 |
| ysm P2-3 (MaxReadLimit vs MaxImportSize) | summary.go:319 / parse.go:84 | ⏳ 待修 |
| ysm P3-1 (scanZipBasicStats 无条目数封顶) | summary.go:231-261 | ⏳ 待修 |
| ysm P3-2 (scanHeader 不检查 scanner.Err) | header.go:47-169 | ⏳ 待修 |
| ysm P3-3 (ScanFiles WalkDir error 忽略) | texsize.go:163-186 | ⏳ 待修 |
| ysm P3-4 (parsePlayerModel 畸形 JSON) | extracted.go:124-214 | ⏳ 待修 |
| ysm P4-1~P4-4 | 多处 | ⏳ 待修 |
| geometry P2-1 (classifyFileInventory OOM) | archive.go:223-246 | ⏳ 待修 |
| geometry P2-2 (selectBestMaidCandidate 空切片) | archive.go:640-648 | ⏳ 待修 |
| geometry P3-1 (sortByTexOrder 双排序同序假设) | archive.go:595-627 | ⏳ 待修 |
| geometry P3-2 (classifyFileInventory case 顺序) | archive.go:223-246 | ⏳ 待修 |
| geometry P3-3 (parseMaidModelJSON len(parts) < 3) | archive.go:595-627 | ⏳ 待修 |
| geometry P3-4 (parseProjModels 静默跳过) | ysm_parser.go:122-173 | ⏳ 待修 |
| geometry P4-1~P4-5 | 多处 | ⏳ 待修 |
