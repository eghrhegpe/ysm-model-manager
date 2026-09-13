package cli

import (
	"fmt"
)

func init() {
	RegisterCommandC("avatar", CatResource, "创作者头像管理（子命令: batch/cached/cache）", runAvatar)
}

// runAvatar 父命令：分发子命令。无子命令时打印用法。
func runAvatar(ctx *CmdContext) error {
	if len(ctx.Args) == 0 {
		printAvatarUsage()
		return nil
	}
	sub := ctx.Args[0]
	subCtx := &CmdContext{App: ctx.App, FilesRoot: ctx.FilesRoot, Args: ctx.Args[1:]}

	switch sub {
	case "batch":
		return runAvatarBatch(subCtx)
	case "cached":
		return runAvatarCached(subCtx)
	case "cache":
		return runAvatarCache(subCtx)
	case "purge":
		return runAvatarPurge(subCtx)
	default:
		return &ErrParam{CmdName: "avatar", Err: fmt.Errorf("未知子命令: %s", sub)}
	}
}

// printAvatarUsage 打印 avatar 父命令用法
func printAvatarUsage() {
	fmt.Println("📖 avatar - 创作者头像管理")
	fmt.Println()
	fmt.Println("用法:")
	fmt.Println("  app --cli --files-root <路径> avatar <子命令> [选项...]")
	fmt.Println()
	fmt.Println("子命令:")
	fmt.Println("  batch                批量提取所有有本地模型的创作者头像")
	fmt.Println("  cached               查看缓存中指定作者的头像（data URI）")
	fmt.Println("  cache                从模型文件缓存作者头像")
	fmt.Println("  purge                清空创作者头像缓存（作者换头像后旧图会残留）")
	fmt.Println()
	fmt.Println("示例:")
	fmt.Println("  app --cli --files-root ./models avatar batch")
	fmt.Println("  app --cli --files-root ./models avatar cached --author 子言")
	fmt.Println("  app --cli --files-root ./models avatar cache --model ./ysm/player.ysm")
	fmt.Println("  app --cli --files-root ./models avatar purge")
}

// runAvatarBatch 批量提取创作者头像
func runAvatarBatch(ctx *CmdContext) error {
	avatars, err := ctx.App.BatchExtractCreatorAvatars()
	if err != nil {
		return newRuntimeErrf("批量提取头像失败: %w", err)
	}
	if len(avatars) == 0 {
		fmt.Println("📭 未提取到任何头像")
		return nil
	}
	fmt.Printf("👤 共提取 %d 个创作者头像:\n", len(avatars))
	for name := range avatars {
		fmt.Printf("  ✅ %s\n", name)
	}
	return nil
}

// runAvatarCached 查看缓存中的作者头像
func runAvatarCached(ctx *CmdContext) error {
	fs := newCmdFlagSet("avatar cached")
	author := fs.String("author", "", "作者名（必填）")
	_, err := parseFlags(fs, ctx.Args)
	if err != nil {
		return err
	}
	if *author == "" {
		return newParamErrf("avatar cached: --author 参数不能为空")
	}

	dataURI, err := ctx.App.CachedCreatorAvatar(*author)
	if err != nil {
		return newRuntimeErrf("读取缓存头像失败: %w", err)
	}
	if dataURI == "" {
		fmt.Printf("📭 缓存中无 %s 的头像\n", *author)
		return nil
	}
	fmt.Printf("✅ %s 的头像已缓存（data URI 长度: %d）\n", *author, len(dataURI))
	return nil
}

// runAvatarCache 从模型文件缓存作者头像
func runAvatarCache(ctx *CmdContext) error {
	fs := newCmdFlagSet("avatar cache")
	modelPath := fs.String("model", "", "模型文件路径（必填）")
	_, err := parseFlags(fs, ctx.Args)
	if err != nil {
		return err
	}
	if *modelPath == "" {
		return newParamErrf("avatar cache: --model 参数不能为空")
	}

	ctx.App.CacheModelAvatars(*modelPath)
	fmt.Printf("✅ 已从 %s 缓存作者头像\n", *modelPath)
	return nil
}

// runAvatarPurge 清空创作者头像缓存（P1-2：缓存无失效机制，作者换头像后旧图残留，
// 手动 purge 重建）。缓存低价值且自动重建，无需二次确认（与 batch/cache 一致）。
func runAvatarPurge(ctx *CmdContext) error {
	n, err := ctx.App.PurgeCreatorAvatarCache()
	if err != nil {
		return newRuntimeErrf("清空头像缓存失败: %w", err)
	}
	if n == 0 {
		fmt.Println("📭 头像缓存已是空的")
		return nil
	}
	fmt.Printf("🗑️  已清空 %d 个头像缓存文件（下次提取/批量时自动重建）\n", n)
	return nil
}
