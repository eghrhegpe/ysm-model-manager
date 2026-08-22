// Package ysmhub provides a small, read-only client for the public YSM Hub API.
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
	"strconv"
	"strings"
	"time"
)

const (
	DefaultBaseURL = "https://ysmhub.top/api/v1"
	maxResponseSize = 8 << 20
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

// ListOptions controls /models and /search requests.
type ListOptions struct {
	Query    string
	ThemeID  string
	CategoryID string
	Tag      string
	OwnerID  string
	Sort     string
	Page     int
	PageSize int
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
	if c == nil {
		return errors.New("YSM Hub client is nil")
	}
	base := strings.TrimRight(c.BaseURL, "/")
	if base == "" {
		base = DefaultBaseURL
	}
	u, err := url.Parse(base + "/" + strings.TrimLeft(path, "/"))
	if err != nil {
		return fmt.Errorf("invalid YSM Hub request URL: %w", err)
	}
	if query != nil {
		u.RawQuery = query.Encode()
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return fmt.Errorf("create YSM Hub request: %w", err)
	}
	req.Header.Set("Accept", "application/json")
	if c.APIKey != "" {
		req.Header.Set("Authorization", "Bearer "+c.APIKey)
	}
	client := c.HTTPClient
	if client == nil {
		client = &http.Client{Timeout: 15 * time.Second}
	}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("YSM Hub request failed: %w", err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxResponseSize+1))
	if err != nil {
		return fmt.Errorf("read YSM Hub response: %w", err)
	}
	if len(body) > maxResponseSize {
		return fmt.Errorf("YSM Hub response exceeds %d bytes", maxResponseSize)
	}
	if resp.StatusCode < http.StatusOK || resp.StatusCode >= http.StatusMultipleChoices {
		message := strings.TrimSpace(string(body))
		if len(message) > 512 {
			message = message[:512] + "..."
		}
		return fmt.Errorf("YSM Hub returned HTTP %d: %s", resp.StatusCode, message)
	}
	if err := json.Unmarshal(body, out); err != nil {
		return fmt.Errorf("decode YSM Hub response: %w", err)
	}
	return nil
}
