package cli

import (
	"fmt"
	"strings"
)

func init() {
	RegisterCommandC("instance", CatResource, "整合包实例管理（子命令: list/sync/push/pull）", runInstance)
}

// runInstance 父命令：分发子命令。无子命令时打印用法。
func runInstance(ctx *CmdContext) error {
	if len(ctx.Args) == 0 {
		printInstanceUsage()
		return nil
	}
	sub := ctx.Args[0]
	subCtx := &CmdContext{App: ctx.App, FilesRoot: ctx.FilesRoot, Args: ctx.Args[1:]}

	switch sub {
	case "list":
		return runInstanceList(subCtx)
	case "sync":
		return runInstanceSync(subCtx)
	case "push":
		return runInstancePush(subCtx)
	case "pull":
		return runInstancePull(subCtx)
	default:
		return &ErrParam{CmdName: "instance", Err: fmt.Errorf("未知子命令: %s", sub)}
	}
}

// printInstanceUsage 打印 instance 父命令用法
func printInstanceUsage() {
	fmt.Println("📖 instance - 整合包实例管理")
	fmt.Println()
	fmt.Println("用法:")
	fmt.Println("  app --cli --files-root <路径> instance <子命令> [选项...]")
	fmt.Println()
	fmt.Println("子命令:")
	fmt.Println("  list                 列出所有整合包实例")
	fmt.Println("  sync                 查看资源同步状态（JSON）")
	fmt.Println("  push                 推送缺失资源到整合包")
	fmt.Println("  pull                 拉取多余资源回仓库")
	fmt.Println()
	fmt.Println("示例:")
	fmt.Println("  app --cli --files-root ./models instance list")
	fmt.Println("  app --cli --files-root ./models instance sync --rtype ysm --instance 子言")
}

// runInstanceList 列出所有整合包实例
func runInstanceList(ctx *CmdContext) error {
	fs := newCmdFlagSet("instance list")
	mcRoot := fs.String("mc-root", "", "Minecraft 根目录（不填则用配置中的 McRoot）")
	_, err := parseFlags(fs, ctx.Args)
	if err != nil {
		return err
	}

	instances := ctx.App.ListVersionInstances(*mcRoot)
	if len(instances) == 0 {
		fmt.Println("📭 未找到整合包实例")
		return nil
	}

	fmt.Printf("📦 共 %d 个整合包实例:\n", len(instances))
	fmt.Printf("%-20s %-10s %s\n", "名称", "存在", "版本目录")
	fmt.Println(strings.Repeat("-", 70))
	for _, ins := range instances {
		exists := "❌"
		if ins.Exists {
			exists = "✅"
		}
		name := truncateRunes(ins.Name, 18)
		fmt.Printf("%-20s %-10s %s\n", name, exists, ins.VersionDir)
	}
	return nil
}

// runInstanceSync 查看资源同步状态
func runInstanceSync(ctx *CmdContext) error {
	fs := newCmdFlagSet("instance sync")
	rtype := fs.String("rtype", "ysm", "资源类型 ID（如 ysm）")
	instanceName := fs.String("instance", "", "整合包实例名（必填）")
	_, err := parseFlags(fs, ctx.Args)
	if err != nil {
		return err
	}
	if *instanceName == "" {
		return newParamErrf("instance sync: --instance 参数不能为空")
	}

	result, err := ctx.App.SyncResources(*rtype, *instanceName)
	if err != nil {
		return err
	}
	fmt.Println(result)
	return nil
}

// runInstancePush 推送缺失资源到整合包
func runInstancePush(ctx *CmdContext) error {
	fs := newCmdFlagSet("instance push")
	rtype := fs.String("rtype", "ysm", "资源类型 ID（如 ysm）")
	instanceName := fs.String("instance", "", "整合包实例名（必填）")
	_, err := parseFlags(fs, ctx.Args)
	if err != nil {
		return err
	}
	if *instanceName == "" {
		return newParamErrf("instance push: --instance 参数不能为空")
	}

	count, err := ctx.App.PushResourceToInstance(*rtype, *instanceName)
	if err != nil {
		return newRuntimeErrf("推送资源失败: %w", err)
	}
	fmt.Printf("✅ 已推送 %d 个资源到 %s\n", count, *instanceName)
	return nil
}

// runInstancePull 拉取多余资源回仓库
func runInstancePull(ctx *CmdContext) error {
	fs := newCmdFlagSet("instance pull")
	rtype := fs.String("rtype", "ysm", "资源类型 ID（如 ysm）")
	instanceName := fs.String("instance", "", "整合包实例名（必填）")
	_, err := parseFlags(fs, ctx.Args)
	if err != nil {
		return err
	}
	if *instanceName == "" {
		return newParamErrf("instance pull: --instance 参数不能为空")
	}

	count, err := ctx.App.PullResourceFromInstance(*rtype, *instanceName)
	if err != nil {
		return newRuntimeErrf("拉取资源失败: %w", err)
	}
	fmt.Printf("✅ 已从 %s 拉取 %d 个资源\n", *instanceName, count)
	return nil
}
