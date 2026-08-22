package ysmhub

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

func TestBeginAuthorizationUsesPKCEAndState(t *testing.T) {
	cfg := OAuthConfig{ClientID: "client", RedirectURI: "http://127.0.0.1:8765/callback", Scope: "read download", AuthorizeURL: "https://example.test/auth"}
	raw, state, verifier, err := cfg.BeginAuthorization()
	if err != nil { t.Fatal(err) }
	u, err := url.Parse(raw)
	if err != nil { t.Fatal(err) }
	q := u.Query()
	for key, want := range map[string]string{"response_type": "code", "client_id": "client", "redirect_uri": cfg.RedirectURI, "scope": cfg.Scope, "state": state, "code_challenge_method": "S256"} {
		if q.Get(key) != want { t.Errorf("%s = %q, want %q", key, q.Get(key), want) }
	}
	if q.Get("code_challenge") == "" || q.Get("code_challenge") == verifier { t.Fatal("invalid PKCE challenge") }
}

func TestExchangeAndRefreshToken(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.Header.Get("Content-Type") != "application/x-www-form-urlencoded" { t.Fatalf("unexpected request: %s %s", r.Method, r.Header.Get("Content-Type")) }
		if err := r.ParseForm(); err != nil { t.Fatal(err) }
		if r.Form.Get("client_id") != "client" { t.Errorf("client_id = %q", r.Form.Get("client_id")) }
		if r.Form.Get("grant_type") == "" { t.Error("missing grant_type") }
		_ = json.NewEncoder(w).Encode(map[string]any{"access_token": "at", "refresh_token": "rt", "token_type": "Bearer", "expires_in": 3600, "scope": "read download"})
	}));
	defer server.Close()
	cfg := OAuthConfig{ClientID: "client", RedirectURI: "http://127.0.0.1:8765/callback", TokenURL: server.URL}
	token, err := cfg.ExchangeCode(context.Background(), "code", "verifier")
	if err != nil { t.Fatal(err) }
	if token.AccessToken != "at" || token.RefreshToken != "rt" || token.ObtainedAt.IsZero() { t.Fatalf("unexpected token: %#v", token) }
	if _, err := cfg.Refresh(context.Background(), token.RefreshToken); err != nil { t.Fatal(err) }
}

func TestTokenRequestRejectsErrorWithoutLeakingRequestValues(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"error":"invalid_grant"}`))
	}));
	defer server.Close()
	cfg := OAuthConfig{ClientID: "client", RedirectURI: "http://127.0.0.1:8765/callback", TokenURL: server.URL}
	_, err := cfg.ExchangeCode(context.Background(), "secret-code", strings.Repeat("v", 8))
	if err == nil || strings.Contains(err.Error(), "secret-code") { t.Fatalf("unexpected error: %v", err) }
}
