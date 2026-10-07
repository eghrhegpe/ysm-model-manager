// bench_stage_utils.go：单模型阶段汇总与辅助工具（原 bench_single.go 拆分，2026-10 文件行数治理）。
// avgBenchStages / stageMark / stageStatus / speedEmoji / runSingleModelBench 等——
// stage 的均值/分级/emoji 归集，与命令入口（bench_single.go）解耦。
package cli

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"ysm-model-manager/go/fsutil"
	"ysm-model-manager/go/texture_cache"
	"ysm-model-manager/go/types/registry"
)

type benchStageMs struct {
	Name string  `json:"name"`
	Ms   float64 `json:"ms"`
}

// avgBenchStages 计算多次迭代的各阶段平均耗时。
// 按「阶段名」配对而非索引：某次迭代读取失败只返回 1 阶段（runSingleModelBench
// 提前 return）时，索引配对会把后续阶段错位进缺失阶段的均值；名字配对下
// 各迭代同名归组、缺失阶段不计入该阶段均值，长度不齐也不会越界。
// 输出保持阶段首次出现的顺序。
func avgBenchStages(allStages [][]singleBenchStage) []singleBenchStage {
	if len(allStages) == 0 {
		return nil
	}
	var order []string
	totals := map[string]time.Duration{}
	counts := map[string]int{}
	bytes := map[string]int64{}
	notes := map[string]string{}
	runtimes := map[string]string{}
	failed := map[string]bool{}
	for _, stages := range allStages {
		for _, s := range stages {
			if counts[s.Name] == 0 {
				order = append(order, s.Name)
			}
			totals[s.Name] += s.Duration
			counts[s.Name]++
			bytes[s.Name] += s.Bytes
			// 首个非空 Notes 优先："失败: 目录不能 ReadFile" 这类诊断信息不能被平均环节吞掉
			// （原实现只取 Duration，Notes/Bytes/Failed 全丢 → 失败在载荷里表现为 ok）
			if notes[s.Name] == "" && s.Notes != "" {
				notes[s.Name] = s.Notes
			}
			// runtime 同 Notes：归属是阶段事实，平均环节不得丢（首轮非空优先）
			if runtimes[s.Name] == "" && s.Runtime != "" {
				runtimes[s.Name] = s.Runtime
			}
			if s.Failed {
				failed[s.Name] = true
			}
		}
	}
	out := make([]singleBenchStage, 0, len(order))
	for _, name := range order {
		out = append(out, singleBenchStage{
			Name:     name,
			Duration: totals[name] / time.Duration(counts[name]),
			Bytes:    bytes[name] / int64(counts[name]),
			Notes:    notes[name],
			Runtime:  runtimes[name],
			Failed:   failed[name],
		})
	}
	return out
}

// msOf 阶段耗时转毫秒（纳秒精度，与 durationMs 同口径——亚毫秒阶段不截断成 0）
func msOf(s singleBenchStage) float64 {
	return durationMs(s.Duration)
}

// durationMs 裸 duration → 毫秒（纳秒精度）。
// ⚠️ 与 msOf(singleBenchStage) 的区别不只是入参：那个走 Microseconds() 会**截断亚毫秒**，
// 并发基准的串行/并行耗时经常在 1ms 以下（空仓库 + 假 app 时是几十微秒），
// 用截断值会让 speedup = 0/0 或 0/x 退化成 0。ADR-262 D2 同款教训（估算被截断成 0 后遭 omitempty 吞掉）。
func durationMs(d time.Duration) float64 {
	return float64(d.Nanoseconds()) / 1e6
}

// stageMark 阶段耗时的 emoji 分级单一实现：>100ms 瓶颈 / >50 注意 / >10 偏慢 / 其余健康。
func stageMark(ms float64) string {
	switch {
	case ms > 100:
		return "🔴 瓶颈"
	case ms > 50:
		return "🟡 注意"
	case ms > 10:
		return "🟢"
	default:
		return "✅"
	}
}

// stageStatus JSON 口径的阶段状态分级（与 stageMark 同阈值，供 AI 消费）。
func stageStatus(ms float64) string {
	switch {
	case ms > 100:
		return "bottleneck"
	case ms > 50:
		return "warn"
	case ms > 10:
		return "slow"
	default:
		return "ok"
	}
}

// speedEmoji 并发加速比信号灯色点：≥1.5 绿 / ≥1.2 黄 / 否则红（行内与表格两处共享，防阈值漂移）。
func speedEmoji(speedup float64) string {
	switch {
	case speedup >= 1.5:
		return "🟢"
	case speedup >= 1.2:
		return "🟡"
	default:
		return "🔴"
	}
}

// benchNoiseFloorMs 退化判定的绝对噪声下限。
// 当基准耗时近零（如内存操作的 fake 模型、子毫秒阶段）时，纯相对百分比
// (now-base)/base 会因计时抖动而 >阈值% 误报退化（或 now 偶尔比假基准更小而漏报）。
// 两层保护（2026-09-15 补齐第二层）：
//  1. base 与 now **双双**落在噪声区间 → 一律判「无退化」；
//  2. **绝对增量**（now-base）落在噪声区间 → 同样判「无退化」。只挡第 1 层是不够的：
//     base 亚毫秒时 now 只要刚过下限（如 0.5 → 1.4ms），相对百分比即被放大成 +180%
//     的假退化，pre-push 与 vitest 并跑时 go/cli 整包必炸（实测）。
//
// 真实退化不受影响：0.001 → 50ms 增量达 49.999ms，远超下限，仍被拦下。
// 下限取 1ms——低于此值的人眼不可察抖动不计入性能回归。
const benchNoiseFloorMs = 1.0

// runSingleBenchSamples text/json 双模式的唯一采集路径：N 次迭代运行并计时，
// perIter 钩子供 text 模式逐迭代打印（json 静默传 nil），杜绝迭代循环双维护。
func runSingleBenchSamples(a AppService, modelPath, filesRoot string, iterations int, perIter func(iter int, stages []singleBenchStage)) ([][]singleBenchStage, time.Duration) {
	var allStages [][]singleBenchStage
	totalStart := time.Now()
	for iter := 0; iter < iterations; iter++ {
		stages := runSingleModelBench(a, modelPath, filesRoot)
		allStages = append(allStages, stages)
		if perIter != nil {
			perIter(iter, stages)
		}
	}
	return allStages, time.Since(totalStart)
}

// singleBenchRuntime 单模型基准的运行归属恒为 Go：全链路调用的都是 Go 实现
// （os.ReadFile / AnalyzeBedrockModel / 校验 / 几何准备 / 纹理准备 / json.Marshal / 缓存查询），
// 没有任何 WASM / Rust / Three 环节——归属如实报 go，不为好看编造分层（ADR-262 D2）。
const singleBenchRuntime = "go"

// singleBenchReadNote ① 阶段的文案：体量 + 实测读取速率。
// ⚠️ 诚实红线：读几百字节时 `time.Since` 常返回 0（时钟粒度），`float64(bytes)/0s` 会打出
// 「+Inf MB/s」——测不出来的速率宁可不报（2026-09-18 由 e2e 真实渲染抓出）。
func singleBenchReadNote(bytes int64, d time.Duration) string {
	size := fsutil.FormatSize(bytes)
	if d <= 0 {
		return fmt.Sprintf("✅ %s", size)
	}
	return fmt.Sprintf("✅ %s, %.0f MB/s", size, float64(bytes)/d.Seconds()/1024/1024)
}

// runSingleModelBench 执行单次单模型测试
func runSingleModelBench(a AppService, modelPath, filesRoot string) []singleBenchStage {
	var stages []singleBenchStage

	// 目录式模型的入参是 <dir>/ysm.json 清单（见 resolveBenchModelTarget）：读的是清单而非模型体量，
	// 阶段名如实标注，避免用户把「读 115 字节」当成「加载整个模型」。
	readStageName := "① 文件读取"
	if registry.IsYsmEntryJSON(filepath.Base(modelPath)) {
		readStageName = "① 清单读取"
	}

	start := time.Now()
	data, err := os.ReadFile(modelPath)
	readDuration := time.Since(start)

	if err != nil {
		return append(stages, singleBenchStage{
			Name:     readStageName,
			Duration: readDuration,
			Notes:    fmt.Sprintf("❌ 失败: %v", err),
			Runtime:  singleBenchRuntime,
			Failed:   true,
		})
	}

	stages = append(stages, singleBenchStage{
		Name:     readStageName,
		Duration: readDuration,
		Bytes:    int64(len(data)),
		Notes:    singleBenchReadNote(int64(len(data)), readDuration),
	})

	start = time.Now()
	model := a.AnalyzeBedrockModel(modelPath)
	analyzeDuration := time.Since(start)

	stages = append(stages, singleBenchStage{
		Name:     parseStageName(modelPath),
		Duration: analyzeDuration,
		Notes:    fmt.Sprintf("✅ %d bones, %d textures (%s)", len(model.Bones), len(model.Textures), detectModelFormat(modelPath)),
	})

	validateStart := time.Now()
	issues, validateMsg := validateModelData(model)
	validateDuration := time.Since(validateStart)

	validateIcon := "✅"
	if issues > 0 {
		validateIcon = "⚠️"
	}
	stages = append(stages, singleBenchStage{
		Name:     "③ 数据验证",
		Duration: validateDuration,
		Notes:    fmt.Sprintf("%s %s", validateIcon, validateMsg),
	})

	geoStart := time.Now()
	geoSize := prepareGeometryData(model)
	geoDuration := time.Since(geoStart)

	stages = append(stages, singleBenchStage{
		Name:     "④ 几何数据准备",
		Duration: geoDuration,
		Bytes:    geoSize,
		Notes:    fmt.Sprintf("✅ %s", fsutil.FormatSize(geoSize)),
	})

	texStart := time.Now()
	texSize := prepareTextureData(model)
	texDuration := time.Since(texStart)

	stages = append(stages, singleBenchStage{
		Name:     "⑤ 纹理数据准备",
		Duration: texDuration,
		Bytes:    texSize,
		Notes:    fmt.Sprintf("✅ %s", fsutil.FormatSize(texSize)),
	})

	ipcStart := time.Now()
	// 实测序列化载荷（原实现按 (几何+纹理)*4/3 估算字节数，并注释"Base64 4/3 膨胀为历史假设"——
	// 但 Base64 早已在 model.Textures 里，膨胀系数是多余假设。能测的不要估：ADR-262 D2）
	ipcData, ipcErr := json.Marshal(model)
	ipcDuration := time.Since(ipcStart)
	ipcSize := int64(len(ipcData))
	ipcNote := fmt.Sprintf("✅ 实测载荷 %s（Wails binding 走 JSON 序列化）", fsutil.FormatSize(ipcSize))
	if ipcErr != nil {
		ipcNote = fmt.Sprintf("❌ 序列化失败: %v", ipcErr)
	}

	stages = append(stages, singleBenchStage{
		Name:     "⑥ 序列化模拟",
		Duration: ipcDuration,
		Bytes:    ipcSize,
		Notes:    ipcNote,
		Failed:   ipcErr != nil,
	})

	cacheStart := time.Now()
	var cacheNotes string
	if hash, err := texture_cache.TextureHash(modelPath); err == nil {
		if cached, ok, _ := texture_cache.ReadCached(hash); ok && cached != nil {
			cacheNotes = fmt.Sprintf("✅ 缓存命中 (%s, %s)", fsutil.FormatSize(int64(len(cached))), hash[:12]+"...")
		} else {
			cacheStats := texture_cache.GetCacheStats()
			cacheNotes = fmt.Sprintf("⚠️ 缓存未命中（总缓存: %d 个文件, %s）",
				cacheStats.FileCount, fsutil.FormatSize(cacheStats.TotalSize))
		}
	} else {
		cacheStats := texture_cache.GetCacheStats()
		cacheNotes = fmt.Sprintf("⚠️ 哈希计算失败（总缓存: %d 个文件, %s）",
			cacheStats.FileCount, fsutil.FormatSize(cacheStats.TotalSize))
	}
	cacheDuration := time.Since(cacheStart)

	stages = append(stages, singleBenchStage{
		Name:     "⑦ 缓存检查",
		Duration: cacheDuration,
		Notes:    cacheNotes,
	})

	// 归属单一事实：本条链路全部阶段同属 singleBenchRuntime，在出口统一打上，
	// 避免每个阶段字面量各写一次（漏一个就是一个无归属阶段）。
	for i := range stages {
		stages[i].Runtime = singleBenchRuntime
	}
	return stages
}

// printSingleModelStages 打印单模型各阶段耗时
