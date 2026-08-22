package ysmhub

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestClientListModelsBuildsDocumentedQuery(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/models" {
			t.Fatalf("path = %q", r.URL.Path)
		}
		for key, want := range map[string]string{
			"q": "alex", "theme_id": "2", "category_id": "3", "tag": "cute",
			"owner_id": "9", "sort": "most_downloaded", "page": "2", "page_size": "12",
		} {
			if got := r.URL.Query().Get(key); got != want {
				t.Errorf("query %s = %q, want %q", key, got, want)
			}
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"items":[{"slug":"alex","title":"Alex"}],"total":1,"page":2,"page_size":12,"total_pages":1}`))
	}));
	defer server.Close()

	client, err := NewClient(server.URL+"/api/v1", "")
	if err != nil {
		t.Fatal(err)
	}
	page, err := client.ListModels(context.Background(), ListOptions{
		Query: "alex", ThemeID: "2", CategoryID: "3", Tag: "cute", OwnerID: "9",
		Sort: "most_downloaded", Page: 2, PageSize: 12,
	})
	if err != nil {
		t.Fatal(err)
	}
	if page.Total != 1 || len(page.Items) != 1 || page.Items[0]["slug"] != "alex" {
		t.Fatalf("unexpected page: %#v", page)
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
	}));
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
	}));
	defer server.Close()
	client, err := NewClient(server.URL, "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := client.GetModel(context.Background(), "a/b"); err == nil {
		t.Fatal("expected HTTP error")
	}
}
