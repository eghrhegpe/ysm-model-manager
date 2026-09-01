package cli

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
)

func init() {
	RegisterCommandC("tags", CatModel, "模型标签管理（子命令: list/set/by/count/get）", runTags)
}

// runTags 父命令：分发子命令。无子命令时打印用法。
func runTags(ctx *CmdContext) error {
	if len(ctx.Args) == 0 {
		printTagsUsage()
		return nil
	}
	sub := ctx.Args[0]
	subCtx := &CmdContext{App: ctx.App, FilesRoot: ctx.FilesRoot, Args: ctx.Args[1:]}

	switch sub {
	case "list":
		return runTagsList(subCtx)
	case "set":
		return runTagsSet(subCtx)
	case "by":
		return runTagsBy(subCtx)
	case "count":
		return runTagsCount(subCtx)
	case "get":
		return runTagsGet(subCtx)
	default:
		return &ErrParam{CmdName: "tags", Err: fmt.Errorf("未知子命令: %s", sub)}
	}
}

// printTagsUsage 打印 tags 父命令用法
func printTagsUsage() {
	fmt.Println("📖 tags - 模型标签管理")
	fmt.Println()
	fmt.Println("用法:")
	fmt.Println("  app --cli --files-root <路径> tags <子命令> [选项...]")
	fmt.Println()
	fmt.Println("子命令:")
	fmt.Println("  list                 列出所有标签（按使用次数降序）")
	fmt.Println("  set                  设置模型的标签（覆盖写入）")
	fmt.Println("  get                  查看模型的标签")
	fmt.Println("  by                   按标签查模型")
	fmt.Println("  count                统计标签使用次数")
	fmt.Println()
	fmt.Println("示例:")
	fmt.Println("  app --cli --files-root ./models tags list")
	fmt.Println("  app --cli --files-root ./models tags set --model ./ysm/player.ysm --tags 战士,稀有")
	fmt.Println("  app --cli --files-root ./models tags by --tag 战士")
}

// runTagsList 列出所有标签
func runTagsList(ctx *CmdContext) error {
	tags, err := ctx.App.AllTags()
	if err != nil {
		return newRuntimeErrf("获取标签列表失败: %w", err)
	}
	if len(tags) == 0 {
		fmt.Println("📭 暂无标签")
		return nil
	}
	fmt.Printf("🏷️  共 %d 个标签:\n", len(tags))
	for i, t := range tags {
		fmt.Printf("  %d. %s\n", i+1, t)
	}
	return nil
}

// runTagsSet 设置模型标签（覆盖写入）
func runTagsSet(ctx *CmdContext) error {
	fs := newCmdFlagSet("tags set")
	modelPath := fs.String("model", "", "模型文件路径（必填）")
	tagsStr := fs.String("tags", "", "标签列表，逗号分隔（必填）")
	_, err := parseFlags(fs, ctx.Args)
	if err != nil {
		return err
	}
	if *modelPath == "" {
		return newParamErrf("tags set: --model 参数不能为空")
	}
	if *tagsStr == "" {
		return newParamErrf("tags set: --tags 参数不能为空")
	}

	// 逗号分隔 → 切片，自动去空白
	var tags []string
	for _, t := range strings.Split(*tagsStr, ",") {
		t = strings.TrimSpace(t)
		if t != "" {
			tags = append(tags, t)
		}
	}

	// 拦截「全分隔符/全空白」输入：解析后空切片会触发 SetModelTags 的 delete 分支，
	// 静默清空该模型所有标签——属数据丢失边界，应报错而非误操作
	if len(tags) == 0 {
		return newParamErrf("tags set: --tags 解析后无有效标签")
	}

	if err := ctx.App.SetModelTags(*modelPath, tags); err != nil {
		return newRuntimeErrf("设置标签失败: %w", err)
	}
	fmt.Printf("✅ 已为 %s 设置 %d 个标签: %s\n", *modelPath, len(tags), strings.Join(tags, ", "))
	return nil
}

// runTagsGet 查看模型的标签
func runTagsGet(ctx *CmdContext) error {
	fs := newCmdFlagSet("tags get")
	modelPath := fs.String("model", "", "模型文件路径（必填）")
	_, err := parseFlags(fs, ctx.Args)
	if err != nil {
		return err
	}
	if *modelPath == "" {
		return newParamErrf("tags get: --model 参数不能为空")
	}

	tags, err := ctx.App.GetModelTags(*modelPath)
	if err != nil {
		return newRuntimeErrf("获取标签失败: %w", err)
	}
	if len(tags) == 0 {
		fmt.Printf("📭 %s 暂无标签\n", *modelPath)
		return nil
	}
	fmt.Printf("🏷️  %s 共 %d 个标签:\n", *modelPath, len(tags))
	for i, t := range tags {
		fmt.Printf("  %d. %s\n", i+1, t)
	}
	return nil
}

// runTagsBy 按标签查模型
func runTagsBy(ctx *CmdContext) error {
	fs := newCmdFlagSet("tags by")
	tag := fs.String("tag", "", "标签名（必填）")
	_, err := parseFlags(fs, ctx.Args)
	if err != nil {
		return err
	}
	if *tag == "" {
		return newParamErrf("tags by: --tag 参数不能为空")
	}

	paths, err := ctx.App.ListByTag(*tag)
	if err != nil {
		return newRuntimeErrf("按标签查询失败: %w", err)
	}
	if len(paths) == 0 {
		fmt.Printf("📭 标签 %q 无匹配模型\n", *tag)
		return nil
	}
	fmt.Printf("✅ 标签 %q 匹配 %d 个模型:\n", *tag, len(paths))
	for i, p := range paths {
		fmt.Printf("  %d. %s\n", i+1, p)
	}
	return nil
}

// runTagsCount 统计标签使用次数
func runTagsCount(ctx *CmdContext) error {
	fs := newCmdFlagSet("tags count")
	tag := fs.String("tag", "", "标签名（不填则统计所有标签）")
	_, err := parseFlags(fs, ctx.Args)
	if err != nil {
		return err
	}

	// --tag 指定：统计该标签的模型数
	if *tag != "" {
		paths, err := ctx.App.ListByTag(*tag)
		if err != nil {
			return newRuntimeErrf("按标签查询失败: %w", err)
		}
		fmt.Printf("🏷️  标签 %q: %d 个模型\n", *tag, len(paths))
		return nil
	}

	// 无 --tag：统计所有标签的使用次数
	all, err := ctx.App.AllTags()
	if err != nil {
		return newRuntimeErrf("获取标签列表失败: %w", err)
	}
	if len(all) == 0 {
		fmt.Println("📭 暂无标签")
		return nil
	}
	fmt.Printf("🏷️  标签使用统计:\n")
	// AllTags 已按使用次数降序，但只返回标签名；逐个查 ListByTag 取计数。
	// ListByTag 失败时跳过该标签并打印警告，不记误导性 0 计数
	for _, t := range all {
		paths, lerr := ctx.App.ListByTag(t)
		if lerr != nil {
			fmt.Fprintf(os.Stderr, "⚠️  统计标签 %q 失败: %v\n", t, lerr)
			continue
		}
		fmt.Printf("  %-20s %d\n", t, len(paths))
	}
	return nil
}

// 保留 json 导入（未来 --format json 下沉时用）
var _ = json.Marshal
