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
	RegisterCommandC("hub", CatResource, "YSM Hub public API (models/search/model/download/login)", runHub)
}

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
		return newParamErrf("hub: 闂佸搫鐗滄禍鐐烘偂閿涘嫧鍋撳☉娆忓闁规枼鍓濈粋?%q", ctx.Args[0])
	}
}

func printHubUsage() {
	fmt.Println("YSM Hub - public API trial")
	fmt.Println()
	fmt.Println("闂佹椿娼块崝宥囨兜?")
	fmt.Println("  app --cli --files-root ./models hub models [options]")
	fmt.Println("  app --cli --files-root ./models hub search --q <query> [options]")
	fmt.Println("  app --cli --files-root ./models hub model --slug <slug> [options]")
	fmt.Println("  models              list public models")
	fmt.Println("  search              search public models")
	fmt.Println("  model               show model details")
	fmt.Println("  download            download a model (requires download scope)")
	fmt.Println("  login               browser OAuth 2.1 + PKCE login")
	fmt.Println("  logout              闂侀€涘嫎閸婃繈寮ㄩ姀銈囧祦閻犲搫鎼悘鈺呮⒒閸曗晛鈧牕锕㈡导鏉戞嵍?Token")
	fmt.Println("  me                  show current user")
	fmt.Println()
	fmt.Println("闂備緡鍋勯ˇ鐢稿Υ?")
	fmt.Println("  --format table|json     output format (default table)")
	fmt.Println("  --base-url <url>        API base URL (default https://ysmhub.top/api/v1)")
	fmt.Println("  --page <n>              page number")
	fmt.Println("  --page-size <n>         page size (maximum 60)")
	fmt.Println("  --sort <sort>           newest/recently_updated/most_downloaded/most_liked/most_favorited")
	fmt.Println()
	fmt.Println("闂佺粯绮犻崹浼淬€傞妸鈺佺煑婵せ鍋撻柛?")
	fmt.Println("  YSMHUB_API_BASE_URL     override default API base URL")
	fmt.Println("  YSMHUB_API_KEY          optional Bearer token")
	fmt.Println("  Login downloads: hub login --scope \"read download\"")
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
		return hubFlags{}, newParamErrf("%s: --format 闂佸憡鐟禍锝夊礂濮椻偓瀵?table 闂?json", name)
	}
	if flags.page < 0 || flags.pageSize < 0 || flags.pageSize > 60 {
		return hubFlags{}, newParamErrf("%s: invalid --page/--page-size", name)
	}
	return flags, nil
}

func newHubClient(flags hubFlags) (*ysmhub.Client, error) {
	key, err := loadHubAccessToken()
	if err != nil { return nil, err }
	return ysmhub.NewClient(flags.baseURL, key)
}

func loadHubAccessToken() (string, error) {
	if key := strings.TrimSpace(os.Getenv("YSMHUB_API_KEY")); key != "" { return key, nil }
	token, err := ysmhub.LoadStoredToken()
	if err != nil { return "", err }
	if token == nil { return "", nil }
	if token.RefreshToken != "" && token.ExpiresIn > 0 && !token.ObtainedAt.IsZero() && time.Now().UTC().After(token.ObtainedAt.Add(time.Duration(token.ExpiresIn-60)*time.Second)) {
		clientID := strings.TrimSpace(os.Getenv("YSMHUB_CLIENT_ID"))
		if clientID != "" {
			fresh, refreshErr := (ysmhub.OAuthConfig{ClientID: clientID}).Refresh(context.Background(), token.RefreshToken)
			if refreshErr == nil {
				if fresh.RefreshToken == "" { fresh.RefreshToken = token.RefreshToken }
				if saveErr := ysmhub.SaveStoredToken(fresh); saveErr == nil { token = &fresh }
			}
		}
	}
	return token.AccessToken, nil
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
		return newParamErrf("hub search: --q is required")
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
		return newParamErrf("hub model: --slug is required")
	}
	format = strings.ToLower(strings.TrimSpace(format))
	if format != "table" && format != "json" {
		return newParamErrf("hub model: --format 闂佸憡鐟禍锝夊礂濮椻偓瀵?table 闂?json")
	}
	client, err := newHubClient(hubFlags{baseURL: baseURL})
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
		fmt.Println("  (闂佸搫鍟版慨椋庡垝閵娾晛鍑?")
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
	if err != nil { return err }
	client, err := newHubClient(flags)
	if err != nil { return newParamErrf("hub me: %v", err) }
	me, err := client.GetMe(context.Background())
	if err != nil { return newRuntimeErrf("hub me: %w", err) }
	return printHubJSON(me)
}

func runHubDownload(ctx *CmdContext) error {
	fs := newCmdFlagSet("hub download")
	var baseURL, modelID, versionID, saveDir string
	fs.StringVar(&baseURL, "base-url", os.Getenv("YSMHUB_API_BASE_URL"), "YSM Hub API base URL")
	fs.StringVar(&modelID, "id", "", "model id")
	fs.StringVar(&versionID, "version-id", "", "optional version id")
	fs.StringVar(&saveDir, "save-dir", "", "destination directory")
	if _, err := parseFlags(fs, ctx.Args); err != nil { return err }
	if strings.TrimSpace(modelID) == "" { return newParamErrf("hub download: --id is required") }
	if strings.TrimSpace(saveDir) == "" { return newParamErrf("hub download: --save-dir is required") }
	key, err := loadHubAccessToken()
	if err != nil { return newRuntimeErrf("hub download: 闁荤姴娲╅褑銇愰崶顒佸剬閻犲洩灏欑粔鍧楁煟濡灝鐓愰柍褜鍏涚粈渚€濡甸幋鐘冲? %w", err) }
	client, err := ysmhub.NewClient(baseURL, key)
	if err != nil { return newParamErrf("hub download: %v", err) }
	path, result, err := client.DownloadModelToFile(context.Background(), modelID, versionID, saveDir)
	if err != nil {
		return newRuntimeErrf("hub download: %w (anonymous download is attempted first; run hub login when authorization is required)", err)
	}
	fmt.Printf("閻庤鐡曞鎾剁箔閸涱喗濮? %s\n", path)
	if result.ExpiresIn > 0 { fmt.Printf("婵炴垶鎸搁悺銊ヮ渻閸岀偛鎹堕柡澶嬪缁插鏌￠崼婵愭Ч闁哄懌鍎靛? %ds\n", result.ExpiresIn) }
	return nil
}

func runHubLogin(ctx *CmdContext) error {
	fs := newCmdFlagSet("hub login")
	clientID := os.Getenv("YSMHUB_CLIENT_ID")
	redirectURI := os.Getenv("YSMHUB_REDIRECT_URI")
	scope := os.Getenv("YSMHUB_SCOPE")
	fs.StringVar(&clientID, "client-id", clientID, "OAuth client_id (used to revoke the token)")
	fs.StringVar(&redirectURI, "redirect-uri", redirectURI, "registered callback URL")
	fs.StringVar(&scope, "scope", scope, "OAuth scopes")
	if _, err := parseFlags(fs, ctx.Args); err != nil { return err }
	if redirectURI == "" { redirectURI = "http://127.0.0.1:8765/callback" }
	if scope == "" { scope = "read" }
	cfg := ysmhub.OAuthConfig{ClientID: clientID, RedirectURI: redirectURI, Scope: scope}
	authURL, state, verifier, err := cfg.BeginAuthorization()
	if err != nil { return newParamErrf("hub login: %w", err) }
	u, err := url.Parse(redirectURI)
	if err != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") {
		return newParamErrf("hub login: redirect-uri must be a valid http(s) URL")
	}
	if u.Scheme != "http" || (u.Hostname() != "127.0.0.1" && u.Hostname() != "localhost") {
		return newParamErrf("hub login: CLI 闂佹悶鍎抽崑鐘绘儍閻旇崵鐤€闁告稒鐣埀顒€绻戦幏鍛崉閵婏附娈㈤梺鍝勭墱閸撴艾鈹冮埀?http://127.0.0.1 闂?localhost")
	}
	listener, err := net.Listen("tcp", u.Host)
	if err != nil { return newRuntimeErrf("hub login: 闂佺儵鏅滈崹鐢稿箚婢舵劕鐐婇柣鎰濞堝爼鏌涢敂鑺ョ凡婵炵厧鍟鍕綇椤愩儛? %w", err) }
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
			deliver(oauthCallback{err: fmt.Errorf("OAuth 闂佺懓鎼悧濠傤焽閸垺鍋栨い鎰剁到閻濇洜绱? %s", oauthErr)})
			_, _ = w.Write([]byte("Login cancelled"))
			return
		}
		deliver(oauthCallback{code: q.Get("code")})
		_, _ = w.Write([]byte("Login complete. You can close this window."))
	})}
	go func() { _ = server.Serve(listener) }()
	defer server.Shutdown(context.Background())
	fmt.Printf("濠殿喗绻愮徊钘夛耿椤忓牆绠ラ柟鎯х－绾?YSM Hub 闂佽皫鍡╁殭缂傚秴绉甸妵鍕偨閸涘﹥銆冮梺鎸庣☉閻楀棗煤閺嶎偅瀚?%s闂?..\n", redirectURI)
	if ctx.App != nil { ctx.App.OpenInBrowser(authURL) } else { fmt.Printf("闁荤姴娲弨杈ㄦ櫠濠婂牆绀夐柕濠忕畱閳數鈧鍠掗崑? %s\n", authURL) }
	select {
	case result := <-callback:
		if result.err != nil { return newRuntimeErrf("hub login: %w", result.err) }
		if result.code == "" { return newRuntimeErrf("hub login: 闂佹悶鍎抽崑鐘绘儍閻旇櫣纾介柛婵嗗濮?code") }
		token, err := cfg.ExchangeCode(context.Background(), result.code, verifier)
		if err != nil { return newRuntimeErrf("hub login: 闂佺懓绠嶉崹纭呫亹?Token 婵犮垺鍎肩划鍓ф喆? %w", err) }
		if err := ysmhub.SaveStoredToken(token); err != nil { return newRuntimeErrf("hub login: 婵烇絽娲︾换鍌炴偤?Token 婵犮垺鍎肩划鍓ф喆? %w", err) }
		fmt.Println("YSM Hub login succeeded; the token was saved in the local protected config directory.")
		return nil
	case <-time.After(5 * time.Minute):
		return newRuntimeErrf("hub login: callback timed out")
	}
}

type oauthCallback struct { code string; err error }

func runHubLogout(ctx *CmdContext) error {
	fs := newCmdFlagSet("hub logout")
	clientID := os.Getenv("YSMHUB_CLIENT_ID")
	fs.StringVar(&clientID, "client-id", clientID, "OAuth client_id (used to revoke the token)")
	if _, err := parseFlags(fs, ctx.Args); err != nil { return err }
	token, err := ysmhub.LoadStoredToken()
	if err != nil { return newRuntimeErrf("hub logout: 闁荤姴娲╅褑銇愰崶顒佸剬閻犲洩灏欑粔鍧楁煟濡灝鐓愰柍褜鍏涚粈渚€濡甸幋鐘冲? %w", err) }
	clientID = strings.TrimSpace(clientID)
	if token != nil && clientID == "" {
		return newParamErrf("hub logout: 闂侀€涘嫎閸婃繈寮?Token 闂傚倸娲犻崑鎾绘偡?--client-id 闂?YSMHUB_CLIENT_ID")
	}
	if token != nil {
		cfg := ysmhub.OAuthConfig{ClientID: clientID}
		if err := cfg.Revoke(context.Background(), token.AccessToken); err != nil {
			return newRuntimeErrf("hub logout: 闂侀€涘嫎閸婃繈寮?Token 婵犮垺鍎肩划鍓ф喆? %w", err)
		}
	}
	if err := ysmhub.DeleteStoredToken(); err != nil { return newRuntimeErrf("hub logout: 闂佸憡甯炴繛鈧繛鍛叄瀵敻顢楅埀顒€锕?Token 婵犮垺鍎肩划鍓ф喆? %w", err) }
	fmt.Println("YSM Hub logout complete.")
	return nil
}
