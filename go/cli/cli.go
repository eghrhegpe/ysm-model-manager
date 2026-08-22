package cli

import (
	"fmt"
	"runtime"
	"sort"
	"time"

	"ysm-model-manager/go/version"
	"ysm-model-manager/internal/app"
)

// RunCLI 执行 CLI 模式
func RunCLI(args []string) error {
	if len(args) > 0 && (args[0] == "--version" || args[0] == "-v") {
		printVersion()
		return nil
	}

	if len(args) == 0 || args[0] == "--help" || args[0] == "-h" {
		printCLIHelp()
		return nil
	}

	filesRoot, jsonMode, commandArgs := ParseCommandArgs(args)

	if len(commandArgs) == 0 {
		printCLIHelp()
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

	a := app.NewApp()

	// 全局 --json 模式：捕获输出并包装为 JSON 响应
	if jsonMode {
		start := time.Now()
		outputBuf, restoreStdout := captureStdout()
		defer restoreStdout() // panic 兜底：确保 stdout 一定恢复
		err := DispatchCommand(a, a.SaveAppConfig, filesRoot, commandArgs, true)
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

	return DispatchCommand(a, a.SaveAppConfig, filesRoot, commandArgs, true)
}

// ExecuteCLIWithApp 执行 CLI 命令
func ExecuteCLIWithApp(a *app.App, saveConfigFn func(filesRoot, rpRoot, mcRoot, linkMode, theme string) error, args []string) error {
	if len(args) > 0 && (args[0] == "--version" || args[0] == "-v") {
		printVersion()
		return nil
	}

	if len(args) == 0 || args[0] == "--help" || args[0] == "-h" {
		printCLIHelp()
		return nil
	}

	filesRoot, _, commandArgs := ParseCommandArgs(args)

	if len(commandArgs) == 0 {
		printCLIHelp()
		return nil
	}

	return DispatchCommand(a, saveConfigFn, filesRoot, commandArgs, false)
}

// printVersion 打印版本信息
func printVersion() {
	fmt.Printf("YSM 模型管理器 v%s\n", version.Version)
	fmt.Println("  CLI 模式")
}

// printCLIHelp 打印 CLI 帮助信息
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
	fmt.Println("  app --cli --files-root ./models hub models --format json")
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
