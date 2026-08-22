package ysmhub

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const (
	DefaultAuthorizeURL = "https://ysmhub.top/api/auth/authorize"
	DefaultTokenURL     = "https://ysmhub.top/api/auth/token"
	DefaultRevokeURL    = "https://ysmhub.top/api/auth/revoke"
)

type OAuthConfig struct {
	ClientID     string
	RedirectURI  string
	Scope        string
	AuthorizeURL string
	TokenURL     string
	RevokeURL    string
	HTTPClient   *http.Client
}

type Token struct {
	AccessToken  string `json:"access_token"`
	TokenType    string `json:"token_type"`
	ExpiresIn    int    `json:"expires_in"`
	RefreshToken string `json:"refresh_token"`
	Scope        string `json:"scope"`
	ObtainedAt   time.Time `json:"obtained_at"`
}

func (c OAuthConfig) withDefaults() OAuthConfig {
	if c.AuthorizeURL == "" { c.AuthorizeURL = DefaultAuthorizeURL }
	if c.TokenURL == "" { c.TokenURL = DefaultTokenURL }
	if c.RevokeURL == "" { c.RevokeURL = DefaultRevokeURL }
	if c.Scope == "" { c.Scope = "read" }
	if c.HTTPClient == nil { c.HTTPClient = &http.Client{Timeout: 15 * time.Second} }
	return c
}

func (c OAuthConfig) validate() error {
	if strings.TrimSpace(c.ClientID) == "" { return errors.New("OAuth client_id is required") }
	seen := map[string]bool{}
	for _, scope := range strings.Fields(c.Scope) {
		if scope != "read" && scope != "download" { return fmt.Errorf("unsupported OAuth scope: %s", scope) }
		if seen[scope] { return fmt.Errorf("duplicate OAuth scope: %s", scope) }
		seen[scope] = true
	}
	if len(seen) == 0 { return errors.New("OAuth scope is required") }
	return nil
}

func (c OAuthConfig) validateRedirect() error {
	if strings.TrimSpace(c.RedirectURI) == "" { return errors.New("OAuth redirect_uri is required") }
	if _, err := url.ParseRequestURI(c.RedirectURI); err != nil { return fmt.Errorf("invalid OAuth redirect_uri: %w", err) }
	return nil
}

// BeginAuthorization creates a one-time state/verifier pair and authorization URL.
func (c OAuthConfig) BeginAuthorization() (authorizationURL, state, verifier string, err error) {
	c = c.withDefaults()
	if err = c.validate(); err != nil { return "", "", "", err }
	if err = c.validateRedirect(); err != nil { return "", "", "", err }
	state, err = randomURLString(32)
	if err != nil { return "", "", "", fmt.Errorf("generate OAuth state: %w", err) }
	verifier, err = randomURLString(64)
	if err != nil { return "", "", "", fmt.Errorf("generate PKCE verifier: %w", err) }
	digest := sha256.Sum256([]byte(verifier))
	challenge := base64.RawURLEncoding.EncodeToString(digest[:])
	u, err := url.Parse(c.AuthorizeURL)
	if err != nil { return "", "", "", fmt.Errorf("invalid OAuth authorize URL: %w", err) }
	q := u.Query()
	q.Set("response_type", "code")
	q.Set("client_id", c.ClientID)
	q.Set("redirect_uri", c.RedirectURI)
	q.Set("scope", c.Scope)
	q.Set("state", state)
	q.Set("code_challenge", challenge)
	q.Set("code_challenge_method", "S256")
	u.RawQuery = q.Encode()
	return u.String(), state, verifier, nil
}

func (c OAuthConfig) ExchangeCode(ctx context.Context, code, verifier string) (Token, error) {
	c = c.withDefaults()
	if err := c.validate(); err != nil { return Token{}, err }
	if err := c.validateRedirect(); err != nil { return Token{}, err }
	form := url.Values{}
	form.Set("grant_type", "authorization_code")
	form.Set("client_id", c.ClientID)
	form.Set("code", strings.TrimSpace(code))
	form.Set("redirect_uri", c.RedirectURI)
	form.Set("code_verifier", verifier)
	return c.tokenRequest(ctx, form)
}

func (c OAuthConfig) Refresh(ctx context.Context, refreshToken string) (Token, error) {
	c = c.withDefaults()
	if err := c.validate(); err != nil { return Token{}, err }
	form := url.Values{}
	form.Set("grant_type", "refresh_token")
	form.Set("client_id", c.ClientID)
	form.Set("refresh_token", strings.TrimSpace(refreshToken))
	return c.tokenRequest(ctx, form)
}

func (c OAuthConfig) Revoke(ctx context.Context, token string) error {
	c = c.withDefaults()
	if err := c.validate(); err != nil { return err }
	form := url.Values{}
	form.Set("client_id", c.ClientID)
	form.Set("token", strings.TrimSpace(token))
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.RevokeURL, strings.NewReader(form.Encode()))
	if err != nil { return err }
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := c.HTTPClient.Do(req)
	if err != nil { return fmt.Errorf("OAuth revoke request failed: %w", err) }
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
		return fmt.Errorf("OAuth revoke returned HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	return nil
}

func (c OAuthConfig) tokenRequest(ctx context.Context, form url.Values) (Token, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.TokenURL, strings.NewReader(form.Encode()))
	if err != nil { return Token{}, fmt.Errorf("create OAuth token request: %w", err) }
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := c.HTTPClient.Do(req)
	if err != nil { return Token{}, fmt.Errorf("OAuth token request failed: %w", err) }
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil { return Token{}, fmt.Errorf("read OAuth token response: %w", err) }
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return Token{}, fmt.Errorf("OAuth token returned HTTP %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	var token Token
	if err := json.Unmarshal(body, &token); err != nil { return Token{}, fmt.Errorf("decode OAuth token response: %w", err) }
	if token.AccessToken == "" { return Token{}, errors.New("OAuth token response has no access_token") }
	if token.TokenType == "" { token.TokenType = "Bearer" }
	token.ObtainedAt = time.Now().UTC()
	return token, nil
}

func randomURLString(size int) (string, error) {
	b := make([]byte, size)
	if _, err := rand.Read(b); err != nil { return "", err }
	return base64.RawURLEncoding.EncodeToString(b), nil
}
