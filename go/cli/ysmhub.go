package cli

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strconv"
	"strings"

	"ysm-model-manager/go/ysmhub"
)

func init() {
	RegisterCommandC("hub", CatResource, "浏览 YSM Hub 公共 API（models/search/model）", runHub)
}

// runHub is intentionally read-only. Downloading from the Hub requires a
// user API key with the download scope and will be added only after the public
// browsing flow is verified.
func runHub(ctx *CmdContext) error {
	if len(ctx.Args) == 0 {
		printHubUsage()
		return nil
	}
	subCtx := &CmdContext{App: ctx.App, FilesRoot: ctx.FilesRoot, Args: ctx.Args[1:]}
	sub := ctx.Args[0]
	switch sub {
	case "models":
		return runHubModels(subCtx)
	case "search":
		return runHubSearch(subCtx)
	case "model":
		return runHubModel(subCtx)
	default:
		return newParamErrf("hub: 未知子命令 %q", ctx.Args[0])
	}
}

func printHubUsage() {
	fmt.Println("YSM Hub - 公共 API 试用")
	fmt.Println()
	fmt.Println("用法:")
	fmt.Println("  app --cli --files-root ./models hub models [选项]")
	fmt.Println("  app --cli --files-root ./models hub search --q <关键词> [选项]")
	fmt.Println("  app --cli --files-root ./models hub model --slug <slug> [选项]")
	fmt.Println("  models              列出公开模型")
	fmt.Println("  search              搜索公开模型")
	fmt.Println("  model               查看模型详情")
	fmt.Println()
	fmt.Println("选项:")
	fmt.Println("  --format table|json     输出格式（默认 table）")
	fmt.Println("  --base-url <url>        API 地址（默认 https://ysmhub.top/api/v1）")
	fmt.Println("  --page <n>              页码（默认由服务端决定）")
	fmt.Println("  --page-size <n>         每页数量（最大 60）")
	fmt.Println("  --sort <sort>           newest/recently_updated/most_downloaded/most_liked/most_favorited")
	fmt.Println()
	fmt.Println("环境变量:")
	fmt.Println("  YSMHUB_API_BASE_URL     覆盖默认 API 地址")
	fmt.Println("  YSMHUB_API_KEY          可选 Bearer 密钥（只读请求也可不填）")
}

type hubFlags struct {
	baseURL  string
	format   string
	query    string
	sort     string
	page     int
	pageSize int
}

func parseHubFlags(name string, args []string) (hubFlags, error) {
	fs := newCmdFlagSet(name)
	flags := hubFlags{}
	fs.StringVar(&flags.baseURL, "base-url", os.Getenv("YSMHUB_API_BASE_URL"), "YSM Hub API base URL")
	fs.StringVar(&flags.format, "format", "table", "table or json")
	fs.StringVar(&flags.query, "q", "", "search query")
	fs.StringVar(&flags.sort, "sort", "", "model sort order")
	fs.IntVar(&flags.page, "page", 0, "page number")
	fs.IntVar(&flags.pageSize, "page-size", 0, "page size")
	if _, err := parseFlags(fs, args); err != nil {
		return hubFlags{}, err
	}
	flags.format = strings.ToLower(strings.TrimSpace(flags.format))
	if flags.format != "table" && flags.format != "json" {
		return hubFlags{}, newParamErrf("%s: --format 只能是 table 或 json", name)
	}
	if flags.page < 0 || flags.pageSize < 0 || flags.pageSize > 60 {
		return hubFlags{}, newParamErrf("%s: --page/--page-size 参数无效", name)
	}
	return flags, nil
}

func newHubClient(flags hubFlags) (*ysmhub.Client, error) {
	return ysmhub.NewClient(flags.baseURL, os.Getenv("YSMHUB_API_KEY"))
}

func runHubModels(ctx *CmdContext) error {
	flags, err := parseHubFlags("hub models", ctx.Args)
	if err != nil {
		return err
	}
	client, err := newHubClient(flags)
	if err != nil {
		return newParamErrf("hub models: %v", err)
	}
	page, err := client.ListModels(context.Background(), ysmhub.ListOptions{
		Query: flags.query, Sort: flags.sort, Page: flags.page, PageSize: flags.pageSize,
	})
	if err != nil {
		return newRuntimeErrf("hub models: %w", err)
	}
	return printHubPage(page, flags.format)
}

func runHubSearch(ctx *CmdContext) error {
	flags, err := parseHubFlags("hub search", ctx.Args)
	if err != nil {
		return err
	}
	if strings.TrimSpace(flags.query) == "" {
		return newParamErrf("hub search: --q 参数不能为空")
	}
	client, err := newHubClient(flags)
	if err != nil {
		return newParamErrf("hub search: %v", err)
	}
	page, err := client.Search(context.Background(), ysmhub.ListOptions{
		Query: flags.query, Page: flags.page, PageSize: flags.pageSize,
	})
	if err != nil {
		return newRuntimeErrf("hub search: %w", err)
	}
	return printHubPage(page, flags.format)
}

func runHubModel(ctx *CmdContext) error {
	fs := newCmdFlagSet("hub model")
	var baseURL, slug, format string
	fs.StringVar(&baseURL, "base-url", os.Getenv("YSMHUB_API_BASE_URL"), "YSM Hub API base URL")
	fs.StringVar(&slug, "slug", "", "model slug")
	fs.StringVar(&format, "format", "json", "table or json")
	if _, err := parseFlags(fs, ctx.Args); err != nil {
		return err
	}
	slug = strings.TrimSpace(slug)
	if slug == "" {
		return newParamErrf("hub model: --slug 参数不能为空")
	}
	format = strings.ToLower(strings.TrimSpace(format))
	if format != "table" && format != "json" {
		return newParamErrf("hub model: --format 只能是 table 或 json")
	}
	client, err := ysmhub.NewClient(baseURL, os.Getenv("YSMHUB_API_KEY"))
	if err != nil {
		return newParamErrf("hub model: %v", err)
	}
	model, err := client.GetModel(context.Background(), slug)
	if err != nil {
		return newRuntimeErrf("hub model: %w", err)
	}
	if format == "json" {
		return printHubJSON(model)
	}
	fmt.Printf("YSM Hub model: %s\n", hubModelLabel(model))
	for _, key := range []string{"slug", "name", "title", "description", "updated_at"} {
		if value, ok := model[key]; ok && value != nil {
			fmt.Printf("  %s: %v\n", key, value)
		}
	}
	return nil
}

func printHubPage(page ysmhub.Page, format string) error {
	if format == "json" {
		return printHubJSON(page)
	}
	pageLabel := strconv.Itoa(page.Page)
	if page.TotalPages > 0 {
		pageLabel += "/" + strconv.Itoa(page.TotalPages)
	}
	fmt.Printf("YSM Hub models (page %s, total %d)\n", pageLabel, page.Total)
	if len(page.Items) == 0 {
		fmt.Println("  (无结果)")
		return nil
	}
	for _, item := range page.Items {
		fmt.Printf("  %s\n", hubModelLabel(item))
	}
	return nil
}

func printHubJSON(value any) error {
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return newRuntimeErrf("hub: encode JSON failed: %w", err)
	}
	fmt.Println(string(data))
	return nil
}

func hubModelLabel(model map[string]any) string {
	name := firstHubString(model, "title", "name", "display_name", "slug")
	slug := firstHubString(model, "slug", "id")
	if slug == "" {
		return name
	}
	if name == "" || name == slug {
		return slug
	}
	return slug + " - " + name
}

func firstHubString(model map[string]any, keys ...string) string {
	for _, key := range keys {
		if value, ok := model[key]; ok && value != nil {
			text := strings.TrimSpace(fmt.Sprint(value))
			if text != "" {
				return text
			}
		}
	}
	return ""
}
