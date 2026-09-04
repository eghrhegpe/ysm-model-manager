package cli

import (
	"fmt"
	"strings"
)

func init() {
	RegisterCommandC("install", CatModel, "安装模型到 Minecraft（全局/整合包自定义目录）", runInstall)
	RegisterCommandC("link-mode", CatConfig, "查看或设置链接模式（symlink/hardlink/copy）", runLinkMode)
}

// runInstall 安装模型
func runInstall(ctx *CmdContext) error {
	fs := newCmdFlagSet("install")
	modelPath := fs.String("model", "", "模型文件路径（必填）")
	mcRoot := fs.String("mc-root", "", "Minecraft 根目录（全局安装时必填）")
	customDir := fs.String("custom-dir", "", "整合包自定义目录（安装到整合包时使用）")
	_, err := parseFlags(fs, ctx.Args)
	if err != nil {
		return err
	}
	if *modelPath == "" {
		return newParamErrf("install: --model 参数不能为空")
	}

	// 优先 custom-dir：安装到整合包自定义目录
	if *customDir != "" {
		if err := ctx.App.InstallModelTo(*modelPath, *customDir); err != nil {
			return newRuntimeErrf("安装到整合包失败: %w", err)
		}
		fmt.Printf("✅ 已安装到整合包: %s -> %s\n", *modelPath, *customDir)
		return nil
	}

	// 全局安装：需要 mcRoot
	if *mcRoot == "" {
		return newParamErrf("install: 需指定 --mc-root（全局安装）或 --custom-dir（整合包安装）")
	}
	target, err := ctx.App.InstallModelFile(*modelPath, *mcRoot)
	if err != nil {
		return newRuntimeErrf("全局安装失败: %w", err)
	}
	fmt.Printf("✅ 已全局安装: %s -> %s\n", *modelPath, target)
	return nil
}

// runLinkMode 查看或设置链接模式（顶层命令；config link-mode 复用 runSetLinkMode）
func runLinkMode(ctx *CmdContext) error {
	fs := newCmdFlagSet("link-mode")
	mode := fs.String("mode", "", "链接模式: symlink|hardlink|copy（不填则查看当前模式）")
	_, err := parseFlags(fs, ctx.Args)
	if err != nil {
		return err
	}
	return runSetLinkMode(ctx, *mode, "link-mode")
}

// runSetLinkMode 链接模式查看/设置共享实现（顶层 link-mode 与 config link-mode
// 共用校验+输出逻辑，消除原先两处逐字重复；cmdName 仅用于错误消息前缀）。
func runSetLinkMode(ctx *CmdContext, mode, cmdName string) error {
	// 无 --mode：查看当前
	if mode == "" {
		current := ctx.App.GetLinkMode()
		fmt.Printf("🔗 当前链接模式: %s\n", current)
		fmt.Println("   可选: symlink | hardlink | copy")
		return nil
	}

	// 有 --mode：设置
	validModes := []string{"symlink", "hardlink", "copy"}
	modeValid := false
	for _, v := range validModes {
		if v == mode {
			modeValid = true
			break
		}
	}
	if !modeValid {
		return newParamErrf("%s: 无效模式 %q，可选: %s", cmdName, mode, strings.Join(validModes, "|"))
	}

	if err := ctx.App.SetLinkMode(mode); err != nil {
		return newRuntimeErrf("设置链接模式失败: %w", err)
	}
	fmt.Printf("✅ 链接模式已设置为: %s\n", mode)
	return nil
}
