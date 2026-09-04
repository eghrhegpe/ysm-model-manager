package cli

import (
	"fmt"
	"strings"

	"ysm-model-manager/go/fsutil"
)

func init() {
	RegisterCommandC("recycle", CatResource, "回收站管理（子命令: list/restore/empty）", runRecycle)
}

// runRecycle 父命令：分发子命令。无子命令时打印用法。
func runRecycle(ctx *CmdContext) error {
	if len(ctx.Args) == 0 {
		printRecycleUsage()
		return nil
	}
	sub := ctx.Args[0]
	subCtx := &CmdContext{App: ctx.App, FilesRoot: ctx.FilesRoot, Args: ctx.Args[1:]}

	switch sub {
	case "list":
		return runRecycleList(subCtx)
	case "restore":
		return runRecycleRestore(subCtx)
	case "empty":
		return runRecycleEmpty(subCtx)
	default:
		return &ErrParam{CmdName: "recycle", Err: fmt.Errorf("未知子命令: %s", sub)}
	}
}

// printRecycleUsage 打印 recycle 父命令用法
func printRecycleUsage() {
	fmt.Println("📖 recycle - 回收站管理")
	fmt.Println()
	fmt.Println("用法:")
	fmt.Println("  app --cli --files-root <路径> recycle <子命令> [选项...]")
	fmt.Println()
	fmt.Println("子命令:")
	fmt.Println("  list                 列出回收站所有条目")
	fmt.Println("  restore              从回收站恢复文件到仓库")
	fmt.Println("  empty                清空所有回收站")
	fmt.Println()
	fmt.Println("示例:")
	fmt.Println("  app --cli --files-root ./models recycle list")
	fmt.Println("  app --cli --files-root ./models recycle restore --path ./ysm/.recycle/player.ysm")
}

// runRecycleList 列出回收站条目
func runRecycleList(ctx *CmdContext) error {
	// ListRecycleBin 的 recyclePath 参数在实现里未使用（遍历所有根），传空串
	entries := ctx.App.ListRecycleBin("")
	if len(entries) == 0 {
		fmt.Println("📭 回收站为空")
		return nil
	}
	fmt.Printf("♻️  回收站共 %d 个条目:\n", len(entries))
	fmt.Printf("%-40s %-12s %s\n", "名称", "大小", "路径")
	fmt.Println(strings.Repeat("-", 80))
	for _, e := range entries {
		name := truncateRunes(e.Name, 35)
		fmt.Printf("%-40s %-12s %s\n", name, fsutil.FormatSize(e.Size), e.Path)
	}
	return nil
}

// truncateRunes 按 rune 截断字符串，避免截断多字节 UTF-8（中文模型名）产生乱码。
// 超过 maxRunes 时尾部加 "..."。
func truncateRunes(s string, maxRunes int) string {
	r := []rune(s)
	if len(r) <= maxRunes {
		return s
	}
	return string(r[:maxRunes]) + "..."
}

// runRecycleRestore 从回收站恢复文件
func runRecycleRestore(ctx *CmdContext) error {
	fs := newCmdFlagSet("recycle restore")
	srcPath := fs.String("path", "", "回收站内文件路径（必填）")
	_, err := parseFlags(fs, ctx.Args)
	if err != nil {
		return err
	}
	if *srcPath == "" {
		return newParamErrf("recycle restore: --path 参数不能为空")
	}

	if err := ctx.App.RestoreFromRecycle(*srcPath, ctx.FilesRoot); err != nil {
		return newRuntimeErrf("恢复失败: %w", err)
	}
	fmt.Printf("✅ 已恢复: %s\n", *srcPath)
	return nil
}

// runRecycleEmpty 清空所有回收站
func runRecycleEmpty(ctx *CmdContext) error {
	fs := newCmdFlagSet("recycle empty")
	yes := fs.Bool("yes", false, "跳过确认，直接清空")
	_, err := parseFlags(fs, ctx.Args)
	if err != nil {
		return err
	}

	if !*yes {
		fmt.Print("⚠️  确认清空所有回收站？此操作不可恢复 [y/N]: ")
		var input string
		fmt.Scanln(&input)
		if strings.ToLower(strings.TrimSpace(input)) != "y" {
			fmt.Println("已取消")
			return nil
		}
	}

	count, err := ctx.App.EmptyRecycleBin("")
	if err != nil {
		return newRuntimeErrf("清空回收站失败: %w", err)
	}
	fmt.Printf("✅ 已清空回收站，共删除 %d 个条目\n", count)
	return nil
}
