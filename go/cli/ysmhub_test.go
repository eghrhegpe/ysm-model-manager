package cli

import (
	"os"
	"strings"
	"testing"
)

func TestHubCommandIsRegistered(t *testing.T) {
	cmd, ok := GetCommand("hub")
	if !ok {
		t.Fatal("hub command was not registered")
	}
	if cmd.Name != "hub" {
		t.Fatalf("unexpected command: %#v", cmd)
	}
}

func TestHubFrontendCommandsAreRegistered(t *testing.T) {
	for _, name := range []string{"hub-models", "hub-search", "hub-model", "hub-download", "hub-login"} {
		cmd, ok := GetCommand(name)
		if !ok || cmd.Name != name {
			t.Fatalf("%s command was not registered: %#v", name, cmd)
		}
	}
}

func TestHubCommandsDoNotRequireFilesRoot(t *testing.T) {
	for _, name := range []string{"hub", "hub-models", "hub-search", "hub-model", "hub-download", "hub-login"} {
		if commandRequiresFilesRoot([]string{name}) {
			t.Errorf("%s should work before a local repository is configured", name)
		}
	}
	if !commandRequiresFilesRoot([]string{"list"}) {
		t.Error("list should still require a files root")
	}
}

func TestRunCLIHubLoginWithoutFilesRootReachesCommand(t *testing.T) {
	err := RunCLI([]string{"hub-login", "--redirect-uri", "https://example.test/callback"})
	if err == nil || !strings.Contains(err.Error(), "redirect-uri") {
		t.Fatalf("hub-login should run without files-root and validate its redirect URI, got %v", err)
	}
}

func TestHubDownloadValidatesFormatBeforeNetwork(t *testing.T) {
	err := runHubDownload(&CmdContext{Args: []string{
		"--id", "4", "--save-dir", t.TempDir(), "--format", "xml",
	}})
	if err == nil || !strings.Contains(err.Error(), "format") {
		t.Fatalf("invalid download format should fail before network, got %v", err)
	}
}

func TestLoadHubAccessTokenUsesEmbeddedKeyAfterRuntimeOverride(t *testing.T) {
	oldEmbedded := embeddedHubAPIKey
	oldRuntime, hadRuntime := os.LookupEnv("YSMHUB_API_KEY")
	t.Cleanup(func() {
		embeddedHubAPIKey = oldEmbedded
		if hadRuntime {
			_ = os.Setenv("YSMHUB_API_KEY", oldRuntime)
		} else {
			_ = os.Unsetenv("YSMHUB_API_KEY")
		}
	})

	// Keep a developer's real OAuth token out of this precedence test.
	oldAppData, hadAppData := os.LookupEnv("APPDATA")
	if err := os.Setenv("APPDATA", t.TempDir()); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if hadAppData {
			_ = os.Setenv("APPDATA", oldAppData)
		} else {
			_ = os.Unsetenv("APPDATA")
		}
	})

	embeddedHubAPIKey = "embedded-read-download-key"
	_ = os.Unsetenv("YSMHUB_API_KEY")
	got, err := loadHubAccessToken()
	if err != nil {
		t.Fatal(err)
	}
	if got != embeddedHubAPIKey {
		t.Fatalf("loadHubAccessToken() = %q, want embedded key", got)
	}

	if err := os.Setenv("YSMHUB_API_KEY", "runtime-key"); err != nil {
		t.Fatal(err)
	}
	got, err = loadHubAccessToken()
	if err != nil {
		t.Fatal(err)
	}
	if got != "runtime-key" {
		t.Fatalf("runtime key did not take precedence: %q", got)
	}
}

func TestParseHubFlagsValidatesFormatAndPageSize(t *testing.T) {
	flags, err := parseHubFlags("hub models", []string{"--format", "JSON", "--page-size", "60"})
	if err != nil {
		t.Fatal(err)
	}
	if flags.format != "json" || flags.pageSize != 60 {
		t.Fatalf("unexpected flags: %#v", flags)
	}
	if _, err := parseHubFlags("hub models", []string{"--format", "xml"}); err == nil {
		t.Fatal("invalid format should fail")
	}
	if _, err := parseHubFlags("hub models", []string{"--page-size", "61"}); err == nil {
		t.Fatal("page size above documented maximum should fail")
	}
}
