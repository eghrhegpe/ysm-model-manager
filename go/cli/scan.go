package cli

import (
	"fmt"

	"ysm-model-manager/go/fsutil"
)

func init() {
	RegisterCommandC("scan", CatResource, "扫描入口聚合（子命令: models/authors/resources）", runScan)
}

// runScan 父命令：分发子命令。无子命令时打印用法。
func runScan(ctx *CmdContext) error {
	if len(ctx.Args) == 0 {
		printScanUsage()
		return nil
	}
	sub := ctx.Args[0]
	subCtx := &CmdContext{App: ctx.App, FilesRoot: ctx.FilesRoot, Args: ctx.Args[1:]}

	switch sub {
	case "models":
		return runScanModels(subCtx)
	case "authors":
		return runScanAuthors(subCtx)
	case "resources":
		// 复用已有 resource-scan 命令体
		return runResourceScan(subCtx)
	default:
		return &ErrParam{CmdName: "scan", Err: fmt.Errorf("未知子命令: %s", sub)}
	}
}

// printScanUsage 打印 scan 父命令用法
func printScanUsage() {
	fmt.Println("📖 scan - 扫描入口聚合")
	fmt.Println()
	fmt.Println("用法:")
	fmt.Println("  app --cli --files-root <路径> scan <子命令> [选项...]")
	fmt.Println()
	fmt.Println("子命令:")
	fmt.Println("  models               扫描目录下的模型条目")
	fmt.Println("  authors              统计 [作者] 前缀（走扫描缓存）")
	fmt.Println("  resources            扫描模型仓库资源，统计资产分布")
	fmt.Println()
	fmt.Println("示例:")
	fmt.Println("  app --cli --files-root ./models scan models --dir ./ysm")
	fmt.Println("  app --cli --files-root ./models scan authors")
}

// runScanModels 扫描模型条目
func runScanModels(ctx *CmdContext) error {
	fs := newCmdFlagSet("scan models")
	dir := fs.String("dir", ctx.FilesRoot, "目录路径（默认 --files-root）")
	_, err := parseFlags(fs, ctx.Args)
	if err != nil {
		return err
	}
	if *dir == "" {
		return newParamErrf("scan models: --dir 参数不能为空")
	}

	entries := ctx.App.ScanModelEntries(*dir)
	if len(entries) == 0 {
		fmt.Println("📭 未扫描到模型条目")
		return nil
	}
	fmt.Printf("📦 共扫描到 %d 个模型条目:\n", len(entries))
	for i, e := range entries {
		if i >= 20 {
			fmt.Printf("  ...（还有 %d 个，省略）\n", len(entries)-20)
			break
		}
		name := truncateRunes(e.Name, 38)
		fmt.Printf("  %-40s %s\n", name, fsutil.FormatSize(e.Size))
	}
	return nil
}

// runScanAuthors 统计作者前缀
func runScanAuthors(ctx *CmdContext) error {
	authors := ctx.App.ListModelAuthors()
	if len(authors) == 0 {
		fmt.Println("📭 未扫描到作者")
		return nil
	}
	fmt.Printf("👤 共 %d 个作者:\n", len(authors))
	fmt.Printf("%-20s %s\n", "作者", "模型数")
	fmt.Println("------------------------------------------------------------")
	for _, a := range authors {
		name := truncateRunes(a.Name, 18)
		fmt.Printf("%-20s %d\n", name, a.Count)
	}
	return nil
}
