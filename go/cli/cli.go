package cli

import (
	"context"
	"errors"
	"fmt"
	"runtime"
	"sort"
	"sync"
	"time"

	"ysm-model-manager/go/version"
)

// cliPrologue 统一 CLI 前置分支：--version/-v、--help/-h、空命令。
// 返回解析出的 filesRoot / jsonMode / 剩余命令参数；handled=true 表示前置分支
// 已消费全部输入（版本或帮助已打印），调用方应立即返回 nil。
// RunCLI 与 ExecuteCLIWithApp 的前置逻辑原先逐字重复，抽此为单一事实源。
func cliPrologue(args []string) (filesRoot string, jsonMode bool, commandArgs []string, handled bool) {
	if len(args) > 0 && (args[0] == "--version" || args[0] == "-v") {
		printVersion()
		return "", false, nil, true
	}

	if len(args) == 0 || args[0] == "--help" || args[0] == "-h" {
		printCLIHelp()
		return "", false, nil, true
	}

	filesRoot, jsonMode, commandArgs = ParseCommandArgs(args)

	if len(commandArgs) == 0 {
		printCLIHelp()
		return "", false, nil, true
	}

	return filesRoot, jsonMode, commandArgs, false
}

// RunCLI 执行 CLI 模式（ADR-145：AppService 由调用方构造传入，本函数不再内部 new app——
// 装配责任留在 main.go；go/cli 生产代码不再 import internal/app）
func RunCLI(a AppService, args []string) error {
	filesRoot, jsonMode, commandArgs, handled := cliPrologue(args)
	if handled {
		return nil
	}

	if filesRoot == "" {
		printCLIHelp()
		if jsonMode {
			resp := NewJsonError(commandArgs[0], &ErrParam{Err: fmt.Errorf("--files-root 参数不能为空")}, 0)
			fmt.Println(resp.ToJson())
		}
		return &ErrParam{Err: fmt.Errorf("--files-root 参数不能为空")}
	}

	// 全局 --json 模式：捕获输出并包装为 JSON 响应
	if jsonMode {
		start := time.Now()
		outputBuf, restoreStdout := captureStdout()
		defer restoreStdout() // panic 兜底：确保 stdout 一定恢复
		ctx, err := DispatchCommand(a, filesRoot, commandArgs, true)
		restoreStdout() // 显式关闭 pipe，确保 outputBuf.String() 不死锁

		cmdName := commandArgs[0]
		// 同 runCLIInProcessCore：信封耗时统一走 durationMs，不另用截断的 Milliseconds()
		elapsed := durationMs(time.Since(start))

		if err != nil {
			resp := NewJsonError(cmdName, err, elapsed)
			// 规律六「错误信息不能丢」在 CLI --json 层的落地：失败分支同样带上捕获的输出，
			// 否则 gui-flow 等命令失败时前端/gate 拿不到阶段明细，无法定位具体失败阶段。
			resp.Data = buildJsonData(ctx, outputBuf.String(), filesRoot)
			fmt.Println(resp.ToJson())
		} else {
			resp := NewJsonSuccess(cmdName, buildJsonData(ctx, outputBuf.String(), filesRoot), elapsed)
			resp.Meta.Platform = runtime.GOOS
			fmt.Println(resp.ToJson())
		}
		return err
	}

	_, err := DispatchCommand(a, filesRoot, commandArgs, true)
	return err
}

// inProcessCliMu 串行化进程内 CLI 执行（code_review 58232c2d5 #5/#12）：captureStdout
// 读写进程级全局 os.Stdout，并发/超时幽灵 goroutine 与后续调用的捕获/恢复交错会
// 静默串扰输出甚至把 os.Stdout 指向已关闭 pipe（进程 stdout 永久失效）。锁由执行
// goroutine 在命令真正结束时释放——超时「放弃等待」返回后幽灵 goroutine 仍持有锁，
// 后续 ExecuteCLI 阻塞等待其完成，保证任一时刻至多一个 capture/dispatch/restore 周期。
var inProcessCliMu sync.Mutex

// cliInProcessTimeout 进程内直调兜底超时（ADR-199）：与 cliCommandTimeout 对齐，
// 防 GUI 桥因命令挂死永久阻塞；正常命令远低于此。
const cliInProcessTimeout = 5 * time.Minute

// RunCLIInProcess 进程内直调入口（ADR-199）：替代 os/exec 自 fork。
// 供 internal/app.ExecuteCLI 直接调用，复用 cliPrologue/DispatchCommand/captureStdout
// 与 json.go 的 JsonResponse 协议，返回 --json 模式 JSON 字符串（成功/失败均为合法 JSON）。
// 生命周期（code_review 58232c2d5 #1-#4 如实化）：进程内命令无法被强杀——超时/取消仅
// 「放弃等待」并返回超时 JSON，命令继续在后台 goroutine 运行直至自行结束；串行化锁
// 保证其 stdout 捕获不与后续命令交错。错误文案如实区分超时与取消，不再宣称「被终止」。
func RunCLIInProcess(a AppService, parent context.Context, args []string) (string, error) {
	ctx, cancel := context.WithTimeout(parent, cliInProcessTimeout)
	defer cancel()

	type result struct {
		json string
		err  error
	}
	done := make(chan result, 1)
	// 先取锁再启动：并发调用在此排队，后启动者等前一条命令（含超时幽灵）真正结束。
	inProcessCliMu.Lock()
	go func() {
		// 命令 panic 不得杀死整个 GUI 进程（旧 os/exec 子进程隔离丢失）——
		// recover 转合规错误 JSON（code_review 58232c2d5 #11）
		var j string
		var e error
		func() {
			defer func() {
				if r := recover(); r != nil {
					e = fmt.Errorf("命令内部 panic: %v", r)
					j = NewJsonError(cmdNameFromArgs(args), e, 0).ToJson()
				}
			}()
			j, e = runCLIInProcessCore(a, args)
		}()
		inProcessCliMu.Unlock() // 命令真正结束才释放（超时放弃等待后由幽灵持有至完成）
		done <- result{json: j, err: e}
	}()

	select {
	case <-ctx.Done():
		// 超时/取消：返回合规 JSON 错误，不向 GUI stdout 泄漏。命令仍在后台运行
		// （无法强杀），串行化锁保证不与其他命令的 stdout 捕获交错。
		cmdName := cmdNameFromArgs(args)
		err := ctx.Err()
		msg := fmt.Sprintf("命令执行超时（超过 %s 放弃等待，仍在后台运行）", cliInProcessTimeout)
		if errors.Is(err, context.Canceled) {
			msg = "应用退出，命令随会话取消（放弃等待，仍在后台运行）"
		}
		return NewJsonError(cmdName, err, 0).ToJson(), fmt.Errorf("%s", msg)
	case r := <-done:
		return r.json, r.err
	}
}

// cmdNameFromArgs 从原始 args 提取真实命令名（跳过 --files-root <值>/--json 等全局
// 参数）——GUI 桥 ExecuteCLI 恒以 --files-root 开头，直接取 args[0] 会把超时/panic
// 错误 JSON 的 command 字段写成 "--files-root"（code_review 58232c2d5 #6/#7/#8）。
func cmdNameFromArgs(args []string) string {
	for i := 0; i < len(args); i++ {
		a := args[i]
		if a == "--files-root" {
			i++ // 跳过其值
			continue
		}
		if a == "--json" || len(a) > 2 && a[:2] == "--" {
			continue
		}
		return a
	}
	return "unknown"
}

// runCLIInProcessCore 实际执行命令并捕获 JSON 输出（在独立 goroutine 内运行以支持超时取消）。
// 与 RunCLI 的 --json 分支一致：捕获 stdout 并包装为 JsonResponse，但结果经返回值传出、
// 不打印到 GUI 的 stdout（避免污染 WebView 控制台）。
func runCLIInProcessCore(a AppService, args []string) (json string, err error) {
	filesRoot, _, commandArgs, handled := cliPrologue(args)
	if handled {
		// 前置分支（--version/--help/空命令）被桥直接触达的概率极低（桥恒带 --json + 真实命令），
		// 此处置为合规 JSON noop，避免向 GUI stdout 直接打印 help 文本。
		return NewJsonError(firstArg(commandArgs), fmt.Errorf("命令为空或请求帮助"), 0).ToJson(), nil
	}

	if filesRoot == "" {
		e := &ErrParam{Err: fmt.Errorf("--files-root 参数不能为空")}
		return NewJsonError(commandArgs[0], e, 0).ToJson(), e
	}

	start := time.Now()
	outputBuf, restoreStdout := captureStdout()
	defer restoreStdout()
	ctx, runErr := DispatchCommand(a, filesRoot, commandArgs, true)
	restoreStdout()

	cmdName := commandArgs[0]
	// 信封耗时走 durationMs（纳秒精度）：`Milliseconds()` 整毫秒截断，快命令（version/缓存查询）
	// 会报 0——前端把它当「命令耗时」展示时，0 就是「没测到」，与 ADR-262 D2 同款陷阱
	// （亚毫秒被截断成 0，再被 omitempty 吞掉）。本包内耗时换算只有 durationMs 一个出口。
	elapsed := durationMs(time.Since(start))

	if runErr != nil {
		resp := NewJsonError(cmdName, runErr, elapsed)
		resp.Data = buildJsonData(ctx, outputBuf.String(), filesRoot)
		return resp.ToJson(), runErr
	}
	resp := NewJsonSuccess(cmdName, buildJsonData(ctx, outputBuf.String(), filesRoot), elapsed)
	return resp.ToJson(), nil
}

// firstArg 取命令名（commandArgs 非空时取首个；否则回退 unknown），用于超时/空集的错误标注。
func firstArg(commandArgs []string) string {
	if len(commandArgs) > 0 {
		return commandArgs[0]
	}
	return "unknown"
}

// ExecuteCLIWithApp 执行 CLI 命令（测试专用入口：复用 cliPrologue + DispatchCommand，
// 便于自动化测试在 AppService 上直接驱动命令；GUI 实际的进程内桥接入口是 RunCLIInProcess）。
// 不接 saveConfigFn：--files-root 仅覆写内存会话配置，磁盘零副作用。
func ExecuteCLIWithApp(a AppService, args []string) error {
	filesRoot, _, commandArgs, handled := cliPrologue(args)
	if handled {
		return nil
	}

	_, err := DispatchCommand(a, filesRoot, commandArgs, false)
	return err
}

// SidecarOutput 结构化结果可选实现的接口（ADR-200 D5）：--json 响应时由 buildJsonData
// 注入人类可读文本与 filesRoot，迁移期保留 output 字段兼容前端 respHasOutput 守卫与
// 复制原文功能。未实现则 Data 为纯结果对象。
type SidecarOutput interface {
	AttachSidecar(output, filesRoot string)
}

// buildJsonData 构造 --json 响应的 Data（ADR-200 D1 渲染与数据分离）：
//   - 命令经 CmdContext.SetResult 设置了结构化结果 → 优先承载于 Data；
//     实现 SidecarOutput 时注入 output/filesRoot 兼容字段；
//   - 未设置（多数未迁移命令）→ 回退文本载荷 jsonDataPayload，行为零变化。
func buildJsonData(ctx *CmdContext, output, filesRoot string) interface{} {
	if ctx != nil && ctx.result != nil {
		if sc, ok := ctx.result.(SidecarOutput); ok {
			sc.AttachSidecar(output, filesRoot)
		}
		return ctx.result
	}
	return jsonDataPayload(output, filesRoot)
}

// printVersion 打印版本信息
func printVersion() {
	fmt.Printf("YSM 模型管理器 v%s\n", version.Version)
	fmt.Println("  CLI 模式")
}

// printCLIHelp 打印 CLI 帮助信息（同包 cli_test 白盒测试直接调用，无需导出——code_review 58232c2d5 #10）
func printCLIHelp() {
	fmt.Println("🎮 YSM 模型管理器 - CLI 模式")
	fmt.Println()
	fmt.Printf("版本: v%s\n", version.Version)
	fmt.Println()
	fmt.Println("用法:")
	fmt.Println("  app --cli --files-root <路径> <命令> [选项]")
	fmt.Println()
	fmt.Println("可用命令（按分类分组）:")

	// 按 category 聚合，每个 category 内按命令名字母序
	byCat := map[string][]CliCommand{}
	for _, cmd := range cliCommands {
		byCat[cmd.Category] = append(byCat[cmd.Category], cmd)
	}

	// category 显示顺序固定
	catOrder := []string{CatModel, CatPerf, CatCache, CatResource, CatConfig, CatOther}
	for _, cat := range catOrder {
		cmds := byCat[cat]
		if len(cmds) == 0 {
			continue
		}
		// 组内字母序
		sort.Slice(cmds, func(i, j int) bool { return cmds[i].Name < cmds[j].Name })
		fmt.Printf("\n  [%s]\n", cat)
		for _, cmd := range cmds {
			fmt.Printf("  %-18s %s\n", cmd.Name, cmd.Description)
		}
	}

	fmt.Println()
	fmt.Println("全局选项:")
	fmt.Println("  --files-root <路径>    模型仓库根目录 (必填)")
	fmt.Println("  --json                 全局 JSON 输出模式")
	fmt.Println("  --help, -h             显示帮助信息")
	fmt.Println("  --version, -v          显示版本号")
	fmt.Println()
	fmt.Println("获取帮助:")
	fmt.Println("  app --cli --help")
	fmt.Println("  app --cli <命令> --help")
	fmt.Println()
	fmt.Println("示例:")
	fmt.Println("  app --cli --files-root ./models search --keyword warrior")
	fmt.Println("  app --cli --files-root ./models list --format table")
	fmt.Println("  app --cli --files-root ./models analyze --model ./models/player/ysm.json")
	fmt.Println("  app --cli --files-root ./models single-bench --model ./models/player.ysm")
	fmt.Println("  app --cli --files-root ./models concurrent-bench --workers 4")
}

// printCommandHelp 打印子命令帮助信息
func printCommandHelp(cmdName string) {
	cmd, exists := cliCommands[cmdName]
	if !exists {
		fmt.Printf("❌ 未知命令: %s\n", cmdName)
		return
	}

	fmt.Printf("📖 命令: %s\n", cmd.Name)
	fmt.Printf("   分类: %s\n", cmd.Category)
	fmt.Println()
	fmt.Printf("说明: %s\n", cmd.Description)
	fmt.Println()
	fmt.Println("用法:")
	fmt.Printf("  app --cli --files-root <路径> %s [选项...]\n", cmdName)
	fmt.Println()
	fmt.Println("详细参数请查看 AGENTS.md 的 CLI 模式使用说明章节。")
}

// jsonDataPayload 构造 CLI --json 响应（json.go JsonResponse.Data）的业务数据载荷。
// 成功/失败分支共用（DRY），保证两者 output 口径一致。output 为空时返回 nil——
// Data 带 `json:"data,omitempty"`，nil 会被省略，前端以 status/error 为准。
// 同包 cli_test 白盒测试直接调用，无需导出（code_review 58232c2d5 #10）。
func jsonDataPayload(output, filesRoot string) map[string]interface{} {
	if output == "" {
		return nil
	}
	return map[string]interface{}{
		"output":    output,
		"lines":     splitLines(output),
		"filesRoot": filesRoot,
	}
}
