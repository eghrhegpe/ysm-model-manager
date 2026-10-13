package cli

import (
	"fmt"
	"strings"
)

func init() {
	RegisterCommandC("creator", CatResource, "创作者数据管理（子命令: scan/list/export/backup）", runCreator)
}

// runCreator 父命令：分发子命令。无子命令时打印用法。
func runCreator(ctx *CmdContext) error {
	if len(ctx.Args) == 0 {
		printCreatorUsage()
		return nil
	}
	sub := ctx.Args[0]
	subCtx := &CmdContext{App: ctx.App, FilesRoot: ctx.FilesRoot, Args: ctx.Args[1:]}

	switch sub {
	case "scan":
		return runCreatorScan(subCtx)
	case "list":
		return runCreatorList(subCtx)
	case "export":
		return runCreatorExport(subCtx)
	case "backup":
		return runCreatorBackup(subCtx)
	default:
		return &ErrParam{CmdName: "creator", Err: fmt.Errorf("未知子命令: %s", sub)}
	}
}

// printCreatorUsage 打印 creator 父命令用法
func printCreatorUsage() {
	fmt.Println("📖 creator - 创作者数据管理")
	fmt.Println()
	fmt.Println("用法:")
	fmt.Println("  app --cli --files-root <路径> creator <子命令> [选项...]")
	fmt.Println()
	fmt.Println("子命令:")
	fmt.Println("  scan                 扫描本地资源目录，从文件名提取作者")
	fmt.Println("  list                 列出已保存的创作者")
	fmt.Println("  export               导出创作者 JSON 文件")
	fmt.Println("  backup               备份创作者数据（带时间戳）")
	fmt.Println()
	fmt.Println("示例:")
	fmt.Println("  app --cli --files-root ./models creator scan")
	fmt.Println("  app --cli --files-root ./models creator list")
}

// runCreatorScan 扫描本地作者（RTypes 见 ADR-337：资源类型，非站点归属）
func runCreatorScan(ctx *CmdContext) error {
	authors := ctx.App.ScanLocalAuthors("")
	if len(authors) == 0 {
		fmt.Println("📭 未扫描到本地作者")
		return nil
	}
	fmt.Printf("👤 扫描到 %d 个本地作者:\n", len(authors))
	for i, a := range authors {
		name := truncateRunes(a.Name, 28)
		rt := strings.Join(a.RTypes, ",")
		fmt.Printf("  %d. %s (%s)\n", i+1, name, rt)
	}
	return nil
}

// runCreatorList 列出已保存的创作者
func runCreatorList(ctx *CmdContext) error {
	creators := ctx.App.LoadWorkshopCreators()
	if len(creators) == 0 {
		fmt.Println("📭 暂无创作者数据")
		return nil
	}
	fmt.Printf("👤 共 %d 个创作者:\n", len(creators))
	fmt.Printf("%-20s %-15s %s\n", "名称", "平台", "描述")
	fmt.Println(strings.Repeat("-", 70))
	for _, c := range creators {
		name := truncateRunes(c.Name, 18)
		typ := truncateRunes(c.Type, 13)
		desc := truncateRunes(c.Desc, 30)
		fmt.Printf("%-20s %-15s %s\n", name, typ, desc)
	}
	return nil
}

// runCreatorExport 导出创作者 JSON
func runCreatorExport(ctx *CmdContext) error {
	path, err := ctx.App.ExportWorkshopCreatorsJSONFile()
	if err != nil {
		return newRuntimeErrf("导出创作者数据失败: %w", err)
	}
	fmt.Printf("✅ 已导出创作者数据: %s\n", path)
	return nil
}

// runCreatorBackup 备份创作者数据
func runCreatorBackup(ctx *CmdContext) error {
	path, err := ctx.App.BackupWorkshopCreators()
	if err != nil {
		return newRuntimeErrf("备份创作者数据失败: %w", err)
	}
	fmt.Printf("✅ 已备份创作者数据: %s\n", path)
	return nil
}
