# R28 审核：go/cli + go/litematic（两模块并行）

> 审核日期：2026-08-31｜审核人：deepseek（主模型）× 2 explore 子代理｜状态：⏳ 修复闭环中
> 前置：R19 watcher / R20 avatar / R21 dedup / R22 app_workshop / R23 app_install / R24 go/recycle / R25 go/installer / R26 installer+recycle+download / R27 sync+dedup

## 范围与岔开依据

**审核**（两模块并行，single 深度，只读）：

| 模块 | 非测试文件 | 规模 | 前置审核 |
|---|---|---|---|
| cli | 17 个（cli.go/concurrent.go/mmd.go/perf.go/cache.go/flow.go/model.go/resource.go/dedup.go/shared.go/tags.go/instance.go/health.go/download.go 等） | 6422 行 | 无 R 级系统审核 |
| litematic | 10 个（block_ids_data.go/voxel.go/block_colors.go/nbt.go/parser.go/schematic.go/bedrock.go/structure.go/palette.go/block_ids.go） | 5342 行 | 无 R 级系统审核 |

**岔开**：R26/R27 完结 installer/recycle/download/sync/dedup 五模块。cli 是最大的未审包（6422 行，CLI 模式入口），litematic 次大（5342 行，二进制解析高风险面）。两包同属「外部输入解析/命令执行」域，一次性过。

## 总体结论：通过（3 项 P2 + 5 项 P3 + 6 项 P4）

两包代码质量分化明显：

- **go/cli**：防御意识中等，`captureOutput` 的 `os.Pipe` 历史坑已修复（`restoreStdout` 用 `sync.Once` 保护，reader goroutine 遇 EOF 正常退出）。残留风险集中在 `benchParallelAnalyze` 的 channel 关闭时序、`flow.go` 的切片越界、`parseOptimizationEntries` 的冗余代码。
- **go/litematic**：防御意识强（`probeNbtDepth` 递归深度守卫、`maxDecodedBytes` 物化预算、`int16` 坐标守卫、comma-ok 断言），注释详尽且与 ADR 对齐。但**物化预算的「漏 charge」是系统性疏漏**——intArray/longArray/byteArray 标签未计入 `charge()`，恶意文件可绕过 512MB 预算导致 OOM。schematic 零尺寸除零是损坏文件 fatal crash 面。

## 发现项汇总

| 模块 | P2 | P3 | P4 | deep 复审 |
|---|---|---|---|---|
| cli | 1 | 2 | 3 | 是（concurrent.go channel 时序 + flow.go 越界） |
| litematic | 2 | 3 | 3 | 是（nbt.go 物化预算漏洞） |
| **合计** | **3** | **5** | **6** | — |

## cli 发现项

### P2（正确性）

| # | 位置 | 问题 | 修复方向 |
|---|---|---|---|
| P2-1 | concurrent.go:79 `benchParallelAnalyze` | `resultCh` 关闭时序：`go func() { wg.Wait(); close(resultCh) }()` 在所有 worker 完成后关闭 channel。但若 `modelCh` 的生产者 goroutine 在 `close(modelCh)` 前 panic，worker 会阻塞在 `for path := range modelCh`，`wg.Wait()` 永不返回，`resultCh` 永不关闭，主 goroutine 死锁。 | 生产者 goroutine 加 `defer recover()`；或 `modelCh` 改为 buffered + `defer close(modelCh)`。 |

### P3（可靠性）

| # | 位置 | 问题 | 修复方向 |
|---|---|---|---|
| P3-1 | flow.go:684 `results[len(results)-1]` | 若 `runSingleModelBench` 返回空 `stages` 切片（理论上不会，但防御性缺失），`results[len(results)-1]` 越界 panic。 | `if len(results) == 0 { return nil }` 前置守卫；或确认 `runSingleModelBench` 契约保证 ≥1 阶段。 |
| P3-2 | concurrent.go:919 `printOptimizationHints(allStages[0])` | `allStages[0]` 访问假设 `allStages` 非空。若 `runSingleModelBench` 因文件读取失败返回空切片，此处越界 panic。 | `if len(allStages) == 0 { return }` 前置守卫。 |

### P4（可维护性）

| # | 位置 | 问题 | 修复方向 |
|---|---|---|---|
| P4-1 | perf.go `parseOptimizationEntries` | 冗余代码：`entries = append(entries, ...)` 在多个分支重复，可提取公共 helper。 | 提取 `appendEntry(entries []OptEntry, stage string, hint string) []OptEntry`。 |
| P4-2 | perf.go:684 `compareSingleBenchBaseline` | `baseMs > 0` 检查在 L684，但 `baseMs` 的计算在 L671，中间有 13 行间隔——检查与计算脱节，易让维护者误读。 | 将 `baseMs > 0` 检查移到 `baseMs` 计算后立即执行。 |
| P4-3 | shared.go `captureOutput` | `os.Pipe` 的写端 `os.Stdout = pipe.Writer` 在 `restoreStdout` 后恢复，但 `pipe.Reader` 的关闭时序依赖 reader goroutine 的 `io.Copy` 退出——注释未说明此依赖。 | 在 `captureOutput` 注释中补「reader goroutine 依赖写端关闭退出，restoreStdout 必须在读取 outputBuf 前调用」。 |

## litematic 发现项

### P2（正确性）

| # | 位置 | 问题 | 修复方向 |
|---|---|---|---|
| P2-1 | nbt.go:100 `intArray`/`longArray` 物化 | **物化预算漏洞**：intArray/longArray 标签长 `n` 的物化未计入 `charge()`。`maxDecodedBytes=512MB` 限制单标签，但 intArray 长 n 物化为 `n * 8` 字节（longArray），单标签可物化 ~4GB（n=512MB/8），绕过 512MB 预算。恶意 litematic 可构造超长 intArray 导致 OOM。 | intArray/longArray 也 `charge(n)`，或将 `charge` 改为按物化后字节计算（`n * elementSize`）。 |
| P2-2 | schematic.go:33 `result["size"] = []int{int(sx), int(sy), int(sz)}` | **零尺寸除零**：若 `sx/sy/sz` 为 0（损坏文件），下游 `voxel.go` 的 `totalBlocks := int64(info.sizeX) * info.sizeY * info.sizeZ` 会产生 0，但 `buildRegionInfo` 的 `maxRegionAxis = 1<<21` 守卫不查零尺寸。后续 `gx := int16(info.originX + (i % info.sizeX))` 在 `sizeX==0` 时 panic（除零）。 | `buildRegionInfo` 入口加 `if sx == 0 || sy == 0 || sz == 0 { return ..., ErrZeroSize }`。 |

### P3（可靠性）

| # | 位置 | 问题 | 修复方向 |
|---|---|---|---|
| P3-1 | nbt.go:122 `byteArray` | 与 P2-1 同型：byteArray 长 `n` 未调用 `charge`，且 `read(n)` 后未对 n 计入物化预算。 byteArray 单标签物化上限即 ~100MB（maxDecodedBytes），叠加风险低于 intArray，但仍是漏 charge。 | byteArray 也 `charge(n)`。 |
| P3-2 | structure.go:33 `sizeList` 元素非 int32 | `comma, ok := sizeList[i].(int32)` 在类型断言失败时 `ok=false` 给零值，静默返回 `[0,0,0]` 而非跳过。前端拿到全零 size 可能渲染异常。 | 三个元素任一类型断言失败则不设 size，或返回 error。 |
| P3-3 | voxel.go:282 `log.Printf` 容量不足 | region 容量不足时 `log.Printf` 打印，但错误已返回；高频畸形文件会刷日志。 | 降级为不打印或限流（如 `sync.Once` 只打印一次）。 |

### P4（可维护性）

| # | 位置 | 问题 | 修复方向 |
|---|---|---|---|
| P4-1 | nbt.go:197 `default: return false` | 注释说「交给 go-mc 报错」，但 `readRootCompound` 在 probe 返回 `ok=false` 时**直接拒绝、根本不调用 go-mc**（L45-52）。注释与控制流脱节。 | 改为「未知 tag 类型：畸形，调用方拒绝」。 |
| P4-2 | block_ids_data.go | 生成物 3220 行，`//go:generate go run ./gen` 在 `block_ids.go:8`，但生成物与 `gen/main.go` 输出一致性无法在只读审查中验证（需跑生成器 diff）。 | 建议在 CI 加 `go generate ./... && git diff --exit-code` 守卫。 |
| P4-3 | schematic.go:10 注释「返回裸 map 是历史契约」 | `ParseSchematicSummary` 在 `len(result) <= 1` 时返回 nil（L93），而 `bedrock.go:87` 用 `!hasSize && len(result) <= 1`——两处「有效判定」口径不同且无文档统一。 | 抽公共 `isValidSummary(result)` helper。 |

## 修复状态注记（2026-08-31 闭环进行中）

| 级别 | 位置 | 状态 |
|---|---|---|
| cli P2-1 (benchParallelAnalyze 死锁) | concurrent.go:79 | ⏳ 待修 |
| cli P3-1 (flow.go 越界) | flow.go:684 | ⏳ 待修 |
| cli P3-2 (concurrent.go 越界) | concurrent.go:919 | ⏳ 待修 |
| cli P4-1~P4-3 | 多处 | ⏳ 待修 |
| litematic P2-1 (intArray/longArray 漏 charge) | nbt.go:100 | ⏳ 待修 |
| litematic P2-2 (schematic 零尺寸除零) | schematic.go:33 | ⏳ 待修 |
| litematic P3-1 (byteArray 漏 charge) | nbt.go:122 | ⏳ 待修 |
| litematic P3-2 (structure.go 零尺寸静默) | structure.go:33 | ⏳ 待修 |
| litematic P3-3 (voxel.go 刷日志) | voxel.go:282 | ⏳ 待修 |
| litematic P4-1~P4-3 | 多处 | ⏳ 待修 |
