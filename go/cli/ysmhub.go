package cli

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"ysm-model-manager/go/ysmhub"
)

func init() {
	RegisterCommandC("hub", CatResource, "YSM Hub public API (models/authors/search/model/download/login)", runHub)
	// Frontend-facing aliases keep ExecuteCLI's flat command contract while
	// reusing the same Hub implementation and authentication/token store.
	RegisterCommandC("hub-models", CatResource, "YSM Hub model list for the desktop UI", runHubModelsCommand)
	RegisterCommandC("hub-authors", CatResource, "YSM Hub author categories for the desktop UI", runHubAuthorsCommand)
	RegisterCommandC("hub-search", CatResource, "YSM Hub model search for the desktop UI", runHubSearchCommand)
	RegisterCommandC("hub-model", CatResource, "YSM Hub model details for the desktop UI", runHubModelCommand)
	RegisterCommandC("hub-download", CatResource, "Download a YSM Hub model into the local repository", runHubDownloadCommand)
	RegisterCommandC("hub-login", CatResource, "Sign in to YSM Hub from the desktop UI", runHubLoginCommand)
}

// The public OAuth client id is not a secret. Keep an environment override for
// forks/development while allowing the packaged desktop app to work out of the box.
const defaultHubOAuthClientID = "ysm_client_a69879a91e7c52020b7ec7ecbb0d17f24bd82da0442e9d28"

// embeddedHubAPIKey is intentionally empty in source control. A desktop
// build may inject the public read/download key with Go's -ldflags -X so the
// packaged app can browse and download without requiring a shell environment
// variable. Runtime configuration still takes precedence, which keeps local
// development and key rotation straightforward.
var embeddedHubAPIKey string

func hubOAuthClientID() string {
	if id := strings.TrimSpace(os.Getenv("YSMHUB_CLIENT_ID")); id != "" {
		return id
	}
	return defaultHubOAuthClientID
}

func runHubModelsCommand(ctx *CmdContext) error   { return runHubModels(ctx) }
func runHubAuthorsCommand(ctx *CmdContext) error  { return runHubAuthors(ctx) }
func runHubSearchCommand(ctx *CmdContext) error   { return runHubSearch(ctx) }
func runHubModelCommand(ctx *CmdContext) error    { return runHubModel(ctx) }
func runHubDownloadCommand(ctx *CmdContext) error { return runHubDownload(ctx) }
func runHubLoginCommand(ctx *CmdContext) error    { return runHubLogin(ctx) }

// runHub exposes the public browsing flow plus explicit OAuth/download actions.
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
	case "authors":
		return runHubAuthors(subCtx)
	case "search":
		return runHubSearch(subCtx)
	case "model":
		return runHubModel(subCtx)
	case "download":
		return runHubDownload(subCtx)
	case "login":
		return runHubLogin(subCtx)
	case "logout":
		return runHubLogout(subCtx)
	case "me":
		return runHubMe(subCtx)
	default:
		return newParamErrf("hub: 未知子命令 %q", ctx.Args[0])
	}
}

func printHubUsage() {
	fmt.Println("YSM Hub - public API trial")
	fmt.Println()
	fmt.Println("用法：")
	fmt.Println("  app --cli --files-root ./models hub models [options]")
	fmt.Println("  app --cli --files-root ./models hub authors [options]")
	fmt.Println("  app --cli --files-root ./models hub search --q <query> [options]")
	fmt.Println("  app --cli --files-root ./models hub model --slug <slug> [options]")
	fmt.Println("  models              list public models")
	fmt.Println("  authors             list model author categories")
	fmt.Println("  search              search public models")
	fmt.Println("  model               show model details")
	fmt.Println("  download            download a model (requires download scope)")
	fmt.Println("  login               browser OAuth 2.1 + PKCE login")
	fmt.Println("  logout              撤销并删除已保存的 Token")
	fmt.Println("  me                  show current user")
	fmt.Println()
	fmt.Println("常用选项：")
	fmt.Println("  --format table|json     output format (default table)")
	fmt.Println("  --base-url <url>        API base URL (default https://ysmhub.top/api/v1)")
	fmt.Println("  --page <n>              page number")
	fmt.Println("  --page-size <n>         page size (maximum 60)")
	fmt.Println("  --sort <sort>           newest/recently_updated/most_downloaded/most_liked/most_favorited/author")
	fmt.Println()
	fmt.Println("环境变量：")
	fmt.Println("  YSMHUB_API_BASE_URL     override default API base URL")
	fmt.Println("  YSMHUB_API_KEY          optional Bearer token")
	fmt.Println("  Login downloads: hub login --scope \"read download\"")
}

type hubFlags struct {
	baseURL  string
	format   string
	query    string
	author   string
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
	fs.StringVar(&flags.author, "author", "", "model author name")
	fs.StringVar(&flags.sort, "sort", "", "model sort order")
	fs.IntVar(&flags.page, "page", 0, "page number")
	fs.IntVar(&flags.pageSize, "page-size", 0, "page size")
	if _, err := parseFlags(fs, args); err != nil {
		return hubFlags{}, err
	}
	flags.format = strings.ToLower(strings.TrimSpace(flags.format))
	if flags.format != "table" && flags.format != "json" {
		return hubFlags{}, newParamErrf("%s: --format 必须是 table 或 json", name)
	}
	if flags.page < 0 || flags.pageSize < 0 || flags.pageSize > 60 {
		return hubFlags{}, newParamErrf("%s: invalid --page/--page-size", name)
	}
	return flags, nil
}

// newHubPublicClient keeps the build-injected public key out of list/detail
// requests. Public browsing does not need credentials; a runtime key or a
// stored OAuth token is still forwarded so an authenticated user can see
// models that require login.
func newHubPublicClient(flags hubFlags) (*ysmhub.Client, error) {
	key, source, err := loadHubCredential()
	if err != nil {
		return nil, err
	}
	if source == hubCredentialEmbedded {
		key = ""
	}
	return ysmhub.NewClient(flags.baseURL, key)
}

type hubCredentialSource uint8

const (
	hubCredentialNone hubCredentialSource = iota
	hubCredentialRuntime
	hubCredentialOAuth
	hubCredentialEmbedded
)

func loadHubCredential() (string, hubCredentialSource, error) {
	if key := strings.TrimSpace(os.Getenv("YSMHUB_API_KEY")); key != "" {
		return key, hubCredentialRuntime, nil
	}
	token, err := ysmhub.LoadStoredToken()
	if err != nil {
		return "", hubCredentialNone, err
	}
	if token != nil {
		if token.RefreshToken != "" && token.ExpiresIn > 0 && !token.ObtainedAt.IsZero() && time.Now().UTC().After(token.ObtainedAt.Add(time.Duration(token.ExpiresIn-60)*time.Second)) {
			clientID := hubOAuthClientID()
			if clientID != "" {
				fresh, refreshErr := (ysmhub.OAuthConfig{ClientID: clientID}).Refresh(context.Background(), token.RefreshToken)
				if refreshErr == nil {
					if fresh.RefreshToken == "" {
						fresh.RefreshToken = token.RefreshToken
					}
					if saveErr := ysmhub.SaveStoredToken(fresh); saveErr == nil {
						token = &fresh
					}
				}
			}
		}
		if accessToken := strings.TrimSpace(token.AccessToken); accessToken != "" {
			return accessToken, hubCredentialOAuth, nil
		}
	}
	if key := strings.TrimSpace(embeddedHubAPIKey); key != "" {
		return key, hubCredentialEmbedded, nil
	}
	return "", hubCredentialNone, nil
}

func loadHubAccessToken() (string, error) {
	key, _, err := loadHubCredential()
	return key, err
}

func runHubModels(ctx *CmdContext) error {
	flags, err := parseHubFlags("hub models", ctx.Args)
	if err != nil {
		return err
	}
	client, err := newHubPublicClient(flags)
	if err != nil {
		return newParamErrf("hub models: %v", err)
	}
	page, err := client.ListModels(context.Background(), ysmhub.ListOptions{
		Query: flags.query, Author: flags.author, Sort: flags.sort, Page: flags.page, PageSize: flags.pageSize,
	})
	if err != nil {
		return newRuntimeErrf("hub models: %w", err)
	}
	return printHubPage(page, flags.format)
}

func runHubAuthors(ctx *CmdContext) error {
	flags, err := parseHubFlags("hub authors", ctx.Args)
	if err != nil {
		return err
	}
	client, err := newHubPublicClient(flags)
	if err != nil {
		return newParamErrf("hub authors: %v", err)
	}
	authors, err := client.ListAuthors(context.Background())
	if err != nil {
		return newRuntimeErrf("hub authors: %w", err)
	}
	if flags.format == "json" {
		return printHubJSON(authors)
	}
	fmt.Printf("YSM Hub authors (%d)\n", len(authors.Items))
	for _, author := range authors.Items {
		fmt.Printf("  %s (%d)\n", author.Name, author.ModelCount)
	}
	return nil
}

func runHubSearch(ctx *CmdContext) error {
	flags, err := parseHubFlags("hub search", ctx.Args)
	if err != nil {
		return err
	}
	if strings.TrimSpace(flags.query) == "" {
		return newParamErrf("hub search: --q is required")
	}
	// The documented author filter belongs to GET /models. Do not silently
	// accept it on the legacy /search endpoint, which only guarantees q and
	// paging parameters.
	if strings.TrimSpace(flags.author) != "" {
		return newParamErrf("hub search: --author is only supported by hub models")
	}
	client, err := newHubPublicClient(flags)
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
		return newParamErrf("hub model: --slug is required")
	}
	format = strings.ToLower(strings.TrimSpace(format))
	if format != "table" && format != "json" {
		return newParamErrf("hub model: --format 必须是 table 或 json")
	}
	client, err := newHubPublicClient(hubFlags{baseURL: baseURL})
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
		fmt.Println("  (没有模型)")
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

func runHubMe(ctx *CmdContext) error {
	flags, err := parseHubFlags("hub me", ctx.Args)
	if err != nil {
		return err
	}
	key, source, err := loadHubCredential()
	if err != nil {
		return newParamErrf("hub me: %v", err)
	}
	if source == hubCredentialEmbedded {
		return newParamErrf("hub me: the embedded public key only supports browsing/downloads; set YSMHUB_API_KEY or run hub login")
	}
	client, err := ysmhub.NewClient(flags.baseURL, key)
	if err != nil {
		return newParamErrf("hub me: %v", err)
	}
	me, err := client.GetMe(context.Background())
	if err != nil {
		return newRuntimeErrf("hub me: %w", err)
	}
	return printHubJSON(me)
}

func runHubDownload(ctx *CmdContext) error {
	fs := newCmdFlagSet("hub download")
	var baseURL, modelID, versionID, saveDir, format string
	fs.StringVar(&baseURL, "base-url", os.Getenv("YSMHUB_API_BASE_URL"), "YSM Hub API base URL")
	fs.StringVar(&modelID, "id", "", "model id")
	fs.StringVar(&versionID, "version-id", "", "optional version id")
	fs.StringVar(&saveDir, "save-dir", "", "destination directory")
	fs.StringVar(&format, "format", "table", "table or json")
	if _, err := parseFlags(fs, ctx.Args); err != nil {
		return err
	}
	format = strings.ToLower(strings.TrimSpace(format))
	if format != "table" && format != "json" {
		return newParamErrf("hub download: --format must be table or json")
	}
	if strings.TrimSpace(modelID) == "" {
		return newParamErrf("hub download: --id is required")
	}
	if strings.TrimSpace(saveDir) == "" {
		return newParamErrf("hub download: --save-dir is required")
	}
	key, err := loadHubAccessToken()
	if err != nil {
		return newRuntimeErrf("hub download: 读取登录令牌失败: %w", err)
	}
	client, err := ysmhub.NewClient(baseURL, key)
	if err != nil {
		return newParamErrf("hub download: %v", err)
	}
	path, result, err := client.DownloadModelToFile(context.Background(), modelID, versionID, saveDir)
	if err != nil {
		return newRuntimeErrf("hub download: %w (anonymous download is attempted first; run hub login when authorization is required)", err)
	}
	if strings.EqualFold(strings.TrimSpace(format), "json") {
		return printHubJSON(map[string]any{"path": path, "file_name": result.FileName, "file_size": result.FileSize})
	}
	fmt.Printf("下载完成: %s\n", path)
	if result.ExpiresIn > 0 {
		fmt.Printf("临时下载地址有效期: %ds\n", result.ExpiresIn)
	}
	return nil
}

func runHubLogin(ctx *CmdContext) error {
	fs := newCmdFlagSet("hub login")
	clientID := hubOAuthClientID()
	redirectURI := os.Getenv("YSMHUB_REDIRECT_URI")
	scope := os.Getenv("YSMHUB_SCOPE")
	fs.StringVar(&clientID, "client-id", clientID, "OAuth client_id (used to revoke the token)")
	fs.StringVar(&redirectURI, "redirect-uri", redirectURI, "registered callback URL")
	fs.StringVar(&scope, "scope", scope, "OAuth scopes")
	if _, err := parseFlags(fs, ctx.Args); err != nil {
		return err
	}
	if redirectURI == "" {
		redirectURI = "http://127.0.0.1:8765/callback"
	}
	if scope == "" {
		scope = "read"
	}
	cfg := ysmhub.OAuthConfig{ClientID: clientID, RedirectURI: redirectURI, Scope: scope}
	authURL, state, verifier, err := cfg.BeginAuthorization()
	if err != nil {
		return newParamErrf("hub login: %w", err)
	}
	u, err := url.Parse(redirectURI)
	if err != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") {
		return newParamErrf("hub login: redirect-uri must be a valid http(s) URL")
	}
	if u.Scheme != "http" || (u.Hostname() != "127.0.0.1" && u.Hostname() != "localhost") {
		return newParamErrf("hub login: --redirect-uri 必须使用 http://127.0.0.1 或 localhost")
	}
	listener, err := net.Listen("tcp", u.Host)
	if err != nil {
		return newRuntimeErrf("hub login: 无法监听本地回调地址: %w", err)
	}
	defer listener.Close()
	callback := make(chan oauthCallback, 1)
	var callbackOnce sync.Once
	deliver := func(result oauthCallback) { callbackOnce.Do(func() { callback <- result }) }
	server := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.URL.Path != u.Path {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		q := r.URL.Query()
		if q.Get("state") == "" || subtle.ConstantTimeCompare([]byte(q.Get("state")), []byte(state)) != 1 {
			deliver(oauthCallback{err: fmt.Errorf("OAuth state validation failed")})
			w.WriteHeader(http.StatusBadRequest)
			_, _ = w.Write([]byte("Login failed: invalid state"))
			return
		}
		if oauthErr := q.Get("error"); oauthErr != "" {
			deliver(oauthCallback{err: fmt.Errorf("OAuth 授权失败: %s", oauthErr)})
			_, _ = w.Write([]byte("Login cancelled"))
			return
		}
		deliver(oauthCallback{code: q.Get("code")})
		_, _ = w.Write([]byte("Login complete. You can close this window."))
	})}
	go func() { _ = server.Serve(listener) }()
	defer server.Shutdown(context.Background())
	fmt.Printf("正在等待 YSM Hub 授权回调（%s）...\n", redirectURI)
	if ctx.App != nil {
		ctx.App.OpenInBrowser(authURL)
	} else {
		fmt.Printf("请在浏览器打开: %s\n", authURL)
	}
	select {
	case result := <-callback:
		if result.err != nil {
			return newRuntimeErrf("hub login: %w", result.err)
		}
		if result.code == "" {
			return newRuntimeErrf("hub login: 回调缺少 code")
		}
		token, err := cfg.ExchangeCode(context.Background(), result.code, verifier)
		if err != nil {
			return newRuntimeErrf("hub login: 交换 Token 失败: %w", err)
		}
		if err := ysmhub.SaveStoredToken(token); err != nil {
			return newRuntimeErrf("hub login: 保存 Token 失败: %w", err)
		}
		fmt.Println("YSM Hub login succeeded; the token was saved in the local protected config directory.")
		return nil
	case <-time.After(5 * time.Minute):
		return newRuntimeErrf("hub login: callback timed out")
	}
}

type oauthCallback struct {
	code string
	err  error
}

func runHubLogout(ctx *CmdContext) error {
	fs := newCmdFlagSet("hub logout")
	clientID := hubOAuthClientID()
	fs.StringVar(&clientID, "client-id", clientID, "OAuth client_id (used to revoke the token)")
	if _, err := parseFlags(fs, ctx.Args); err != nil {
		return err
	}
	token, err := ysmhub.LoadStoredToken()
	if err != nil {
		return newRuntimeErrf("hub logout: 读取登录令牌失败: %w", err)
	}
	clientID = strings.TrimSpace(clientID)
	if token != nil && clientID == "" {
		return newParamErrf("hub logout: 撤销 Token 需要 --client-id 或 YSMHUB_CLIENT_ID")
	}
	if token != nil {
		cfg := ysmhub.OAuthConfig{ClientID: clientID}
		if err := cfg.Revoke(context.Background(), token.AccessToken); err != nil {
			return newRuntimeErrf("hub logout: 撤销 Token 失败: %w", err)
		}
	}
	if err := ysmhub.DeleteStoredToken(); err != nil {
		return newRuntimeErrf("hub logout: 删除本地 Token 失败: %w", err)
	}
	fmt.Println("YSM Hub logout complete.")
	return nil
}
