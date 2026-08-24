package ysmhub

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestClientListModelsBuildsDocumentedQuery(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/models" {
			t.Fatalf("path = %q", r.URL.Path)
		}
		for key, want := range map[string]string{
			"q": "alex", "theme_id": "2", "category_id": "3", "tag": "cute",
			"owner_id": "9", "author": "Alex", "sort": "most_downloaded", "page": "2", "page_size": "12",
		} {
			if got := r.URL.Query().Get(key); got != want {
				t.Errorf("query %s = %q, want %q", key, got, want)
			}
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"items":[{"slug":"alex","title":"Alex"}],"total":1,"page":2,"page_size":12,"total_pages":1}`))
	}))
	defer server.Close()

	client, err := NewClient(server.URL+"/api/v1", "")
	if err != nil {
		t.Fatal(err)
	}
	page, err := client.ListModels(context.Background(), ListOptions{
		Query: "alex", ThemeID: "2", CategoryID: "3", Tag: "cute", OwnerID: "9",
		Author: "Alex", Sort: "most_downloaded", Page: 2, PageSize: 12,
	})
	if err != nil {
		t.Fatal(err)
	}
	if page.Total != 1 || len(page.Items) != 1 || page.Items[0]["slug"] != "alex" {
		t.Fatalf("unexpected page: %#v", page)
	}
}

func TestClientListAuthors(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/authors" {
			t.Fatalf("path = %q", r.URL.Path)
		}
		_, _ = w.Write([]byte(`{"items":[{"name":"Alex","model_count":3}],"site":{"owner":"JiangKaslana"}}`))
	}))
	defer server.Close()
	client, err := NewClient(server.URL+"/api", "")
	if err != nil {
		t.Fatal(err)
	}
	page, err := client.ListAuthors(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Items) != 1 || page.Items[0].Name != "Alex" || page.Items[0].ModelCount != 3 {
		t.Fatalf("unexpected authors response: %#v", page)
	}
	if page.Site["owner"] != "JiangKaslana" {
		t.Fatalf("unexpected site attribution: %#v", page.Site)
	}
}

func TestClientSearchRequiresQueryAndSendsAPIKey(t *testing.T) {
	client, err := NewClient("https://example.test/api/v1", "secret")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := client.Search(context.Background(), ListOptions{}); err == nil {
		t.Fatal("empty search query should fail before making a request")
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Authorization"); got != "Bearer secret" {
			t.Errorf("authorization = %q", got)
		}
		if got := r.URL.Query().Get("q"); got != "steve" {
			t.Errorf("q = %q", got)
		}
		_, _ = w.Write([]byte(`{"items":[],"total":0,"page":1,"page_size":24,"total_pages":0}`))
	}))
	defer server.Close()
	client.BaseURL = server.URL + "/api/v1"
	if _, err := client.Search(context.Background(), ListOptions{Query: "steve"}); err != nil {
		t.Fatal(err)
	}
}

func TestClientGetModelEscapesSlugAndSurfacesHTTPError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.EscapedPath() != "/models/a%2Fb" {
			t.Errorf("escaped path = %q (path=%q raw=%q)", r.URL.EscapedPath(), r.URL.Path, r.URL.RawPath)
		}
		w.WriteHeader(http.StatusNotFound)
		_, _ = w.Write([]byte(`{"error":"missing"}`))
	}))
	defer server.Close()
	client, err := NewClient(server.URL, "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := client.GetModel(context.Background(), "a/b"); err == nil {
		t.Fatal("expected HTTP error")
	}
}

func TestDownloadModelToFileUsesProxyPathAndSafeFilename(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/v1/models/42/download":
			if r.Method != http.MethodPost || r.URL.Query().Get("version_id") != "7" {
				t.Fatalf("unexpected download request: %s %s", r.Method, r.URL.String())
			}
			if r.Header.Get("Authorization") != "Bearer at" {
				t.Fatalf("missing bearer token")
			}
			_, _ = w.Write([]byte(`{"proxy":true,"path":"/download-proxy/one-time","fileName":"../player.ysm","expires_in":60}`))
		case "/download-proxy/one-time":
			_, _ = w.Write([]byte("ysm-data"))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()
	client, err := NewClient(server.URL+"/api/v1", "at")
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	path, result, err := client.DownloadModelToFile(context.Background(), "42", "7", dir)
	if err != nil {
		t.Fatal(err)
	}
	if result.ExpiresIn != 60 || filepath.Base(path) != "player.ysm" {
		t.Fatalf("unexpected result: %q %#v", path, result)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != "ysm-data" {
		t.Fatalf("data = %q", data)
	}
}

func TestDownloadModelToFileAvoidsExistingFilename(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/v1/models/42/download" {
			_, _ = w.Write([]byte(`{"path":"/download-proxy/two","fileName":"player.ysm"}`))
			return
		}
		if r.URL.Path == "/download-proxy/two" {
			_, _ = w.Write([]byte("new-data"))
			return
		}
		http.NotFound(w, r)
	}))
	defer server.Close()
	client, err := NewClient(server.URL+"/api/v1", "")
	if err != nil {
		t.Fatal(err)
	}
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "player.ysm"), []byte("old-data"), 0o644); err != nil {
		t.Fatal(err)
	}
	path, _, err := client.DownloadModelToFile(context.Background(), "42", "", dir)
	if err != nil {
		t.Fatal(err)
	}
	if filepath.Base(path) != "player (1).ysm" {
		t.Fatalf("unexpected path: %q", path)
	}
	data, err := os.ReadFile(filepath.Join(dir, "player.ysm"))
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != "old-data" {
		t.Fatalf("existing file was replaced: %q", data)
	}
}

func TestDownloadModelToFileDoesNotForwardBearerToExternalSignedURL(t *testing.T) {
	var authHeader string
	external := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		authHeader = r.Header.Get("Authorization")
		_, _ = w.Write([]byte("signed-data"))
	}))
	defer external.Close()
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"url":"` + external.URL + `/signed","fileName":"model.ysm"}`))
	}))
	defer api.Close()
	client, err := NewClient(api.URL+"/api/v1", "at")
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := client.DownloadModelToFile(context.Background(), "42", "", t.TempDir()); err != nil {
		t.Fatal(err)
	}
	if authHeader != "" {
		t.Fatalf("external signed URL received bearer token %q", authHeader)
	}
}
