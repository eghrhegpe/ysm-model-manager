package cli

import (
	"fmt"
	"strings"

	"ysm-model-manager/go/types"
)

func init() {
	RegisterCommandC("download", CatResource, "下载队列管理（子命令: enqueue/status/cancel/github）", runDownload)
}

// runDownload 父命令：分发子命令。无子命令时打印用法。
func runDownload(ctx *CmdContext) error {
	if len(ctx.Args) == 0 {
		printDownloadUsage()
		return nil
	}
	sub := ctx.Args[0]
	subCtx := &CmdContext{App: ctx.App, FilesRoot: ctx.FilesRoot, Args: ctx.Args[1:]}

	switch sub {
	case "enqueue":
		return runDownloadEnqueue(subCtx)
	case "status":
		return runDownloadStatus(subCtx)
	case "cancel":
		return runDownloadCancel(subCtx)
	case "github":
		return runDownloadGitHub(subCtx)
	default:
		return &ErrParam{CmdName: "download", Err: fmt.Errorf("未知子命令: %s", sub)}
	}
}

// printDownloadUsage 打印 download 父命令用法
func printDownloadUsage() {
	fmt.Println("📖 download - 下载队列管理")
	fmt.Println()
	fmt.Println("用法:")
	fmt.Println("  app --cli --files-root <路径> download <子命令> [选项...]")
	fmt.Println()
	fmt.Println("子命令:")
	fmt.Println("  enqueue              入队一个下载任务（URL 须 https://）")
	fmt.Println("  status               查看队列状态")
	fmt.Println("  cancel               取消队列中所有任务")
	fmt.Println("  github               从 GitHub 下载（raw URL）")
	fmt.Println()
	fmt.Println("示例:")
	fmt.Println("  app --cli --files-root ./models download enqueue --url https://example.com/a.zip --save-dir ./downloads")
	fmt.Println("  app --cli --files-root ./models download status")
}

// runDownloadEnqueue 入队下载任务
func runDownloadEnqueue(ctx *CmdContext) error {
	fs := newCmdFlagSet("download enqueue")
	url := fs.String("url", "", "下载 URL（必填，须 https://）")
	saveDir := fs.String("save-dir", "", "保存目录（必填）")
	_, err := parseFlags(fs, ctx.Args)
	if err != nil {
		return err
	}
	if *url == "" {
		return newParamErrf("download enqueue: --url 参数不能为空")
	}
	// 前置 scheme 校验：app 层 EnqueueDownloads 也会校验，
	// 但 CLI 层早报错能给更友好的错误信息（不进队列才拒绝）
	if !strings.HasPrefix(*url, "https://") {
		return newParamErrf("download enqueue: --url 必须以 https:// 开头")
	}
	if *saveDir == "" {
		return newParamErrf("download enqueue: --save-dir 参数不能为空")
	}

	tasks := []types.DownloadTask{{URL: *url, SaveDir: *saveDir}}
	if err := ctx.App.EnqueueDownloads(tasks); err != nil {
		return newRuntimeErrf("入队失败: %w", err)
	}
	fmt.Printf("✅ 已入队: %s\n", *url)
	return nil
}

// runDownloadStatus 查看队列状态
func runDownloadStatus(ctx *CmdContext) error {
	st := ctx.App.QueueStatus()
	fmt.Printf("📋 下载队列状态:\n")
	fmt.Printf("   剩余任务: %d\n", st.Remaining)
	if st.Running {
		fmt.Printf("   运行状态: 正在下载\n")
	} else {
		fmt.Printf("   运行状态: 空闲\n")
	}
	return nil
}

// runDownloadCancel 取消队列
func runDownloadCancel(ctx *CmdContext) error {
	ctx.App.CancelQueue()
	fmt.Println("✅ 已取消队列中所有任务")
	return nil
}

// runDownloadGitHub 从 GitHub 下载
func runDownloadGitHub(ctx *CmdContext) error {
	fs := newCmdFlagSet("download github")
	url := fs.String("url", "", "GitHub raw URL（必填）")
	saveDir := fs.String("save-dir", "", "保存目录（必填）")
	_, err := parseFlags(fs, ctx.Args)
	if err != nil {
		return err
	}
	if *url == "" {
		return newParamErrf("download github: --url 参数不能为空")
	}
	if *saveDir == "" {
		return newParamErrf("download github: --save-dir 参数不能为空")
	}

	path, err := ctx.App.DownloadFromGitHub(*url, *saveDir)
	if err != nil {
		return newRuntimeErrf("GitHub 下载失败: %w", err)
	}
	fmt.Printf("✅ 已下载: %s\n", path)
	return nil
}
