// Package ysmhub provides a small client for the public YSM Hub API.
//
// The client intentionally keeps the API response flexible: the Hub may add
// model fields without requiring a manager release. Callers can inspect the
// raw model maps while the paging envelope remains typed.
package ysmhub

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

const (
	DefaultBaseURL  = "https://ysmhub.top/api/v1"
	maxResponseSize = 8 << 20
	maxDownloadSize = int64(8) << 30
)

// Client calls the public YSM Hub v1 API. APIKey is optional for public
// browsing and is only sent when explicitly configured by the caller.
type Client struct {
	BaseURL    string
	APIKey     string
	HTTPClient *http.Client
}

// Page is the common paging envelope returned by list/search endpoints.
type Page struct {
	Items      []map[string]any `json:"items"`
	Total      int              `json:"total"`
	Page       int              `json:"page"`
	PageSize   int              `json:"page_size"`
	TotalPages int              `json:"total_pages"`
}

// Author is an author/category entry returned by GET /authors.
type Author struct {
	Name       string `json:"name"`
	ModelCount int    `json:"model_count"`
}

// AuthorsPage is the response envelope returned by GET /authors. Site is
// intentionally flexible because attribution links may grow over time.
type AuthorsPage struct {
	Items []Author       `json:"items"`
	Site  map[string]any `json:"site"`
}

// DownloadResponse is returned by the Hub download endpoint. Public models
// may return a signed URL, while proxy downloads return a short-lived path.
type DownloadResponse struct {
	URL       string `json:"url"`
	Path      string `json:"path"`
	FileName  string `json:"fileName"`
	FileSize  int64  `json:"fileSize"`
	ExpiresIn int    `json:"expires_in"`
	Proxy     bool   `json:"proxy"`
}

// ListOptions controls /models and /search requests.
type ListOptions struct {
	Query      string
	ThemeID    string
	CategoryID string
	Tag        string
	OwnerID    string
	Author     string
	Sort       string
	Page       int
	PageSize   int
}

// NewClient validates baseURL and applies a bounded default timeout.
func NewClient(baseURL, apiKey string) (*Client, error) {
	if strings.TrimSpace(baseURL) == "" {
		baseURL = DefaultBaseURL
	}
	u, err := url.Parse(strings.TrimRight(strings.TrimSpace(baseURL), "/"))
	if err != nil || u.Scheme == "" || u.Host == "" || (u.Scheme != "https" && u.Scheme != "http") {
		return nil, fmt.Errorf("invalid YSM Hub base URL")
	}
	return &Client{
		BaseURL:    strings.TrimRight(u.String(), "/"),
		APIKey:     strings.TrimSpace(apiKey),
		HTTPClient: &http.Client{Timeout: 15 * time.Second},
	}, nil
}

// ListModels calls GET /models.
func (c *Client) ListModels(ctx context.Context, opts ListOptions) (Page, error) {
	query := valuesForList(opts)
	var page Page
	if err := c.getJSON(ctx, "/models", query, &page); err != nil {
		return Page{}, err
	}
	return page, nil
}

// ListAuthors calls GET /authors.
func (c *Client) ListAuthors(ctx context.Context) (AuthorsPage, error) {
	var page AuthorsPage
	if err := c.getJSON(ctx, "/authors", nil, &page); err != nil {
		return AuthorsPage{}, err
	}
	return page, nil
}

// Search calls GET /search. The server treats an empty query as an empty
// result, but rejecting it here avoids an accidental broad request.
func (c *Client) Search(ctx context.Context, opts ListOptions) (Page, error) {
	if strings.TrimSpace(opts.Query) == "" {
		return Page{}, errors.New("search query cannot be empty")
	}
	query := url.Values{}
	query.Set("q", opts.Query)
	setPaging(query, opts)
	var page Page
	if err := c.getJSON(ctx, "/search", query, &page); err != nil {
		return Page{}, err
	}
	return page, nil
}

// GetModel calls GET /models/:slug and returns the server's model object.
func (c *Client) GetModel(ctx context.Context, slug string) (map[string]any, error) {
	slug = strings.TrimSpace(slug)
	if slug == "" {
		return nil, errors.New("model slug cannot be empty")
	}
	var model map[string]any
	if err := c.getJSON(ctx, "/models/"+url.PathEscape(slug), nil, &model); err != nil {
		return nil, err
	}
	return model, nil
}

// GetMe calls GET /me using the configured bearer token.
func (c *Client) GetMe(ctx context.Context) (map[string]any, error) {
	var me map[string]any
	if err := c.getJSON(ctx, "/me", nil, &me); err != nil {
		return nil, err
	}
	return me, nil
}

// DownloadModel requests a model file. The endpoint requires the download
// scope for OAuth access tokens; public visibility is enforced by the server.
func (c *Client) DownloadModel(ctx context.Context, modelID, versionID string) (DownloadResponse, error) {
	modelID = strings.TrimSpace(modelID)
	if modelID == "" {
		return DownloadResponse{}, errors.New("model id cannot be empty")
	}
	query := url.Values{}
	if strings.TrimSpace(versionID) != "" {
		query.Set("version_id", strings.TrimSpace(versionID))
	}
	var result DownloadResponse
	if err := c.postFormJSON(ctx, "/models/"+url.PathEscape(modelID)+"/download", query, &result); err != nil {
		return DownloadResponse{}, err
	}
	if result.URL == "" && result.Path == "" {
		return DownloadResponse{}, errors.New("YSM Hub download response has no URL or proxy path")
	}
	return result, nil
}

// DownloadModelToFile resolves the short-lived response and atomically writes
// it below saveDir. It never trusts a server-provided filename as a path.
func (c *Client) DownloadModelToFile(ctx context.Context, modelID, versionID, saveDir string) (string, DownloadResponse, error) {
	result, err := c.DownloadModel(ctx, modelID, versionID)
	if err != nil {
		return "", DownloadResponse{}, err
	}
	if strings.TrimSpace(saveDir) == "" {
		return "", DownloadResponse{}, errors.New("save directory cannot be empty")
	}
	if err := os.MkdirAll(saveDir, 0o755); err != nil {
		return "", DownloadResponse{}, fmt.Errorf("create download directory: %w", err)
	}
	name := filepath.Base(strings.TrimSpace(result.FileName))
	if name == "." || name == ".." || name == "" || name == string(filepath.Separator) {
		name = "model-download.bin"
	}
	root, err := filepath.Abs(saveDir)
	if err != nil {
		return "", DownloadResponse{}, fmt.Errorf("resolve download directory: %w", err)
	}
	target := availableDownloadPath(saveDir, name)
	targetAbs, err := filepath.Abs(target)
	if err != nil {
		return "", DownloadResponse{}, fmt.Errorf("resolve download path: %w", err)
	}
	rel, err := filepath.Rel(root, targetAbs)
	if err != nil || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", DownloadResponse{}, errors.New("download filename escapes destination directory")
	}
	tmp, err := os.CreateTemp(saveDir, ".ysmhub-download-*")
	if err != nil {
		return "", DownloadResponse{}, fmt.Errorf("create temporary download file: %w", err)
	}
	tmpPath := tmp.Name()
	defer os.Remove(tmpPath)
	streamURL, err := c.resolveDownloadURL(result)
	if err != nil {
		tmp.Close()
		return "", DownloadResponse{}, err
	}
	resp, err := c.doGet(ctx, streamURL)
	if err != nil {
		tmp.Close()
		return "", DownloadResponse{}, err
	}
	limit := maxDownloadSize
	if result.FileSize > 0 && result.FileSize < limit {
		limit = result.FileSize
	}
	n, copyErr := io.Copy(tmp, io.LimitReader(resp.Body, limit+1))
	closeErr := resp.Body.Close()
	if copyErr != nil {
		tmp.Close()
		return "", DownloadResponse{}, fmt.Errorf("write downloaded model: %w", copyErr)
	}
	if n > limit {
		tmp.Close()
		return "", DownloadResponse{}, fmt.Errorf("download exceeds %d bytes", limit)
	}
	if closeErr != nil {
		tmp.Close()
		return "", DownloadResponse{}, fmt.Errorf("close downloaded model: %w", closeErr)
	}
	if err := tmp.Close(); err != nil {
		return "", DownloadResponse{}, fmt.Errorf("close temporary download file: %w", err)
	}
	if err := os.Rename(tmpPath, target); err != nil {
		return "", DownloadResponse{}, fmt.Errorf("finalize downloaded model: %w", err)
	}
	return target, result, nil
}

// availableDownloadPath avoids replacing an existing local model when the Hub
// reuses a filename for a newer version. The final rename remains atomic; a
// concurrent creator can still win the same candidate, in which case the
// caller receives the normal rename error instead of silently overwriting it.
func availableDownloadPath(saveDir, name string) string {
	target := filepath.Join(saveDir, name)
	if _, err := os.Lstat(target); os.IsNotExist(err) {
		return target
	}
	ext := filepath.Ext(name)
	stem := strings.TrimSuffix(name, ext)
	for i := 1; i <= 9999; i++ {
		candidate := filepath.Join(saveDir, fmt.Sprintf("%s (%d)%s", stem, i, ext))
		if _, err := os.Lstat(candidate); os.IsNotExist(err) {
			return candidate
		}
	}
	return target
}

func valuesForList(opts ListOptions) url.Values {
	query := url.Values{}
	if opts.Query != "" {
		query.Set("q", opts.Query)
	}
	if opts.ThemeID != "" {
		query.Set("theme_id", opts.ThemeID)
	}
	if opts.CategoryID != "" {
		query.Set("category_id", opts.CategoryID)
	}
	if opts.Tag != "" {
		query.Set("tag", opts.Tag)
	}
	if opts.OwnerID != "" {
		query.Set("owner_id", opts.OwnerID)
	}
	if opts.Author != "" {
		query.Set("author", opts.Author)
	}
	if opts.Sort != "" {
		query.Set("sort", opts.Sort)
	}
	setPaging(query, opts)
	return query
}

func setPaging(query url.Values, opts ListOptions) {
	if opts.Page > 0 {
		query.Set("page", strconv.Itoa(opts.Page))
	}
	if opts.PageSize > 0 {
		query.Set("page_size", strconv.Itoa(opts.PageSize))
	}
}

func (c *Client) getJSON(ctx context.Context, path string, query url.Values, out any) error {
	resp, body, err := c.doJSON(ctx, http.MethodGet, path, query, nil)
	if err != nil {
		return err
	}
	_ = resp
	if err := json.Unmarshal(body, out); err != nil {
		return fmt.Errorf("decode YSM Hub response: %w", err)
	}
	return nil
}

func (c *Client) postFormJSON(ctx context.Context, path string, query url.Values, out any) error {
	resp, body, err := c.doJSON(ctx, http.MethodPost, path, query, strings.NewReader(""))
	if err != nil {
		return err
	}
	_ = resp
	if err := json.Unmarshal(body, out); err != nil {
		return fmt.Errorf("decode YSM Hub response: %w", err)
	}
	return nil
}

func (c *Client) doJSON(ctx context.Context, method, path string, query url.Values, body io.Reader) (*http.Response, []byte, error) {
	if c == nil {
		return nil, nil, errors.New("YSM Hub client is nil")
	}
	base := strings.TrimRight(c.BaseURL, "/")
	if base == "" {
		base = DefaultBaseURL
	}
	u, err := url.Parse(base + "/" + strings.TrimLeft(path, "/"))
	if err != nil {
		return nil, nil, fmt.Errorf("invalid YSM Hub request URL: %w", err)
	}
	if query != nil {
		u.RawQuery = query.Encode()
	}
	req, err := http.NewRequestWithContext(ctx, method, u.String(), body)
	if err != nil {
		return nil, nil, fmt.Errorf("create YSM Hub request: %w", err)
	}
	req.Header.Set("Accept", "application/json")
	if method == http.MethodPost {
		req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	}
	if c.APIKey != "" {
		req.Header.Set("Authorization", "Bearer "+c.APIKey)
	}
	client := c.HTTPClient
	if client == nil {
		client = &http.Client{Timeout: 15 * time.Second}
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, nil, fmt.Errorf("YSM Hub request failed: %w", err)
	}
	defer resp.Body.Close()
	responseBody, err := io.ReadAll(io.LimitReader(resp.Body, maxResponseSize+1))
	if err != nil {
		return nil, nil, fmt.Errorf("read YSM Hub response: %w", err)
	}
	if len(responseBody) > maxResponseSize {
		return nil, nil, fmt.Errorf("YSM Hub response exceeds %d bytes", maxResponseSize)
	}
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		message := strings.TrimSpace(string(responseBody))
		if len(message) > 512 {
			message = message[:512] + "..."
		}
		return nil, nil, fmt.Errorf("YSM Hub returned HTTP %d: %s", resp.StatusCode, message)
	}
	return resp, responseBody, nil
}

func sameOrigin(left, right string) bool {
	a, errA := url.Parse(left)
	b, errB := url.Parse(right)
	return errA == nil && errB == nil && a.Scheme == b.Scheme && strings.EqualFold(a.Host, b.Host)
}

func (c *Client) doGet(ctx context.Context, rawURL string) (*http.Response, error) {
	u, err := url.Parse(rawURL)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return nil, errors.New("invalid YSM Hub download URL")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, fmt.Errorf("create download request: %w", err)
	}
	if c.APIKey != "" && sameOrigin(rawURL, c.BaseURL) {
		req.Header.Set("Authorization", "Bearer "+c.APIKey)
	}
	client := c.HTTPClient
	if client == nil {
		client = &http.Client{Timeout: 15 * time.Second}
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("download request failed: %w", err)
	}
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		defer resp.Body.Close()
		message, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return nil, fmt.Errorf("YSM Hub download returned HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(message)))
	}
	return resp, nil
}

func (c *Client) resolveDownloadURL(result DownloadResponse) (string, error) {
	if result.URL != "" {
		return result.URL, nil
	}
	path := strings.TrimSpace(result.Path)
	if path == "" {
		return "", errors.New("empty YSM Hub proxy path")
	}
	base, err := url.Parse(c.BaseURL)
	if err != nil || base.Scheme == "" || base.Host == "" {
		return "", errors.New("invalid YSM Hub base URL")
	}
	base.Path = ""
	base.RawQuery = ""
	base.Fragment = ""
	return strings.TrimRight(base.String(), "/") + "/" + strings.TrimLeft(path, "/"), nil
}
