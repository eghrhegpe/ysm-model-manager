package cli

import (
	"context"
	"fmt"
	"runtime"
	"sort"
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
		err := DispatchCommand(a, nil, filesRoot, commandArgs, true)
		restoreStdout() // 显式关闭 pipe，确保 outputBuf.String() 不死锁

		cmdName := commandArgs[0]
		elapsed := float64(time.Since(start).Milliseconds())

		if err != nil {
			resp := NewJsonError(cmdName, err, elapsed)
			// 规律六「错误信息不能丢」在 CLI --json 层的落地：失败分支同样带上捕获的输出，
			// 否则 gui-flow 等命令失败时前端/gate 拿不到阶段明细，无法定位具体失败阶段。
			resp.Data = jsonDataPayload(outputBuf.String(), filesRoot)
			fmt.Println(resp.ToJson())
		} else {
			resp := NewJsonSuccess(cmdName, jsonDataPayload(outputBuf.String(), filesRoot), elapsed)
			resp.Meta.Platform = runtime.GOOS
			fmt.Println(resp.ToJson())
		}
		return err
	}

	return DispatchCommand(a, nil, filesRoot, commandArgs, true)
}

// cliInProcessTimeout 进程内直调兜底超时（ADR-199）：与 cliCommandTimeout 对齐，
// 防 GUI 桥因命令挂死永久阻塞；正常命令远低于此。
const cliInProcessTimeout = 5 * time.Minute

// RunCLIInProcess 进程内直调入口（ADR-199）：替代 os/exec 自 fork。
// 供 internal/app.ExecuteCLI 直接调用，复用 cliPrologue/DispatchCommand/captureStdout
// 与 json.go 的 JsonResponse 协议，返回 --json 模式 JSON 字符串（成功/失败均为合法 JSON）。
// 生命周期：内置超时 + 透传 parent.Done（parent 通常为 App.appCtx），应用退出时
// 命令随 parent 取消，不再产生 Context 脱离的孤儿进程。
func RunCLIInProcess(a AppService, parent context.Context, args []string) (string, error) {
	ctx, cancel := context.WithTimeout(parent, cliInProcessTimeout)
	defer cancel()

	type result struct {
		json string
		err  error
	}
	done := make(chan result, 1)
	go func() {
		j, e := runCLIInProcessCore(a, args)
		done <- result{json: j, err: e}
	}()

	select {
	case <-ctx.Done():
		// 超时：返回合规 JSON 错误，不向 GUI stdout 泄漏。
		cmdName := "unknown"
		if len(args) > 0 {
			cmdName = args[0]
		}
		return NewJsonError(cmdName, ctx.Err(), 0).ToJson(),
			fmt.Errorf("命令执行超时（超过 %s 被终止）", cliInProcessTimeout)
	case r := <-done:
		return r.json, r.err
	}
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
	runErr := DispatchCommand(a, nil, filesRoot, commandArgs, true)
	restoreStdout()

	cmdName := commandArgs[0]
	elapsed := float64(time.Since(start).Milliseconds())

	if runErr != nil {
		resp := NewJsonError(cmdName, runErr, elapsed)
		resp.Data = jsonDataPayload(outputBuf.String(), filesRoot)
		return resp.ToJson(), runErr
	}
	resp := NewJsonSuccess(cmdName, jsonDataPayload(outputBuf.String(), filesRoot), elapsed)
	return resp.ToJson(), nil
}

// firstArg 取命令名（commandArgs 非空时取首个；否则回退 unknown），用于超时/空集的错误标注。
func firstArg(commandArgs []string) string {
	if len(commandArgs) > 0 {
		return commandArgs[0]
	}
	return "unknown"
}

// ExecuteCLIWithApp 执行 CLI 命令（GUI 桥接入口：内部经 AppService 分发）
func ExecuteCLIWithApp(a AppService, saveConfigFn func(filesRoot, rpRoot, mcRoot, linkMode, theme string) error, args []string) error {
	filesRoot, _, commandArgs, handled := cliPrologue(args)
	if handled {
		return nil
	}

	return DispatchCommand(a, saveConfigFn, filesRoot, commandArgs, false)
}

// printVersion 打印版本信息
func printVersion() {
	fmt.Printf("YSM 模型管理器 v%s\n", version.Version)
	fmt.Println("  CLI 模式")
}

// printCLIHelp 打印 CLI 帮助信息（导出供 cli_test 外部测试包复用）
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
// 导出供 cli_test 外部测试包复用。
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
