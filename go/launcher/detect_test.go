package launcher

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func writeFile(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestDetectPCLIsolatedInstance(t *testing.T) {
	root := t.TempDir()
	writeFile(t, filepath.Join(root, "PCL.exe"), "")
	gameRoot := filepath.Join(root, ".minecraft")
	versionDir := filepath.Join(gameRoot, "versions", "Fabric-1.20.1")
	writeFile(t, filepath.Join(versionDir, "Fabric-1.20.1.json"), `{"id":"fabric-loader","inheritsFrom":"1.20.1"}`)
	writeFile(t, filepath.Join(versionDir, "PCL", "Setup.ini"), "VersionArgumentIndieV2=True\n")

	got, err := Detect(root)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 {
		t.Fatalf("instances = %d, want 1: %#v", len(got), got)
	}
	inst := got[0]
	if inst.Launcher != "PCL" || inst.GameVersion != "1.20.1" {
		t.Fatalf("unexpected identity: %#v", inst)
	}
	if inst.GameDir != versionDir {
		t.Errorf("GameDir = %q, want %q", inst.GameDir, versionDir)
	}
	wantCustom := filepath.Join(versionDir, "config", "yes_steve_model", "custom")
	if inst.CustomDir != wantCustom {
		t.Errorf("CustomDir = %q, want %q", inst.CustomDir, wantCustom)
	}
}

func TestDetectPCLSharedInstance(t *testing.T) {
	root := t.TempDir()
	gameRoot := filepath.Join(root, ".minecraft")
	writeFile(t, filepath.Join(gameRoot, "PCL.ini"), "Version=Forge-1.19.2\n")
	writeFile(t, filepath.Join(gameRoot, "versions", "Forge-1.19.2", "Forge-1.19.2.json"), `{"id":"1.19.2-forge","inheritsFrom":"1.19.2"}`)

	got, err := Detect(root)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got[0].Launcher != "PCL" {
		t.Fatalf("unexpected result: %#v", got)
	}
	if got[0].GameDir != gameRoot {
		t.Errorf("GameDir = %q, want shared root %q", got[0].GameDir, gameRoot)
	}
}

func TestDetectHMCLConfiguredDirectoryAndRunningDirectory(t *testing.T) {
	launcherRoot := t.TempDir()
	gameRoot := filepath.Join(t.TempDir(), ".minecraft")
	configured := `{"$schema":"x","directories":[{"id":"game-directory:00000000-0000-0000-0000-000000000000","path":` + quoteJSON(gameRoot) + `}]}`
	writeFile(t, filepath.Join(launcherRoot, "config", "user-game-directories.json"), configured)
	versionDir := filepath.Join(gameRoot, "versions", "NeoForge-1.21.1")
	writeFile(t, filepath.Join(versionDir, "NeoForge-1.21.1.json"), `{"id":"neoforge","clientVersion":"1.21.1"}`)
	runDir := filepath.Join(t.TempDir(), "isolated-game")
	settings := `{"overrideProperties":["runningDirectory"],"settings":{"runningDirectory":` + quoteJSON(runDir) + `}}`
	writeFile(t, filepath.Join(versionDir, ".hmcl", "config", "instance-game-settings.json"), settings)

	got, err := Detect(launcherRoot)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 {
		t.Fatalf("instances = %d, want 1: %#v", len(got), got)
	}
	inst := got[0]
	if inst.Launcher != "HMCL" || inst.GameVersion != "1.21.1" || inst.GameDir != runDir {
		t.Fatalf("unexpected result: %#v", inst)
	}
}

func TestDetectHMCLModpackUsesVersionDirectory(t *testing.T) {
	root := t.TempDir()
	writeFile(t, filepath.Join(root, "HMCL.jar"), "")
	gameRoot := filepath.Join(root, ".minecraft")
	versionDir := filepath.Join(gameRoot, "versions", "Pack")
	writeFile(t, filepath.Join(versionDir, "Pack.json"), `{"id":"1.18.2"}`)
	writeFile(t, filepath.Join(versionDir, "modpack.cfg"), "")

	got, err := Detect(root)
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got[0].GameDir != versionDir {
		t.Fatalf("unexpected result: %#v", got)
	}
}

func TestDetectRejectsFile(t *testing.T) {
	file := filepath.Join(t.TempDir(), "PCL.exe")
	writeFile(t, file, "")
	if _, err := Detect(file); err == nil {
		t.Fatal("Detect(file) should fail")
	}
}

func quoteJSON(s string) string {
	b, _ := json.Marshal(s)
	return string(b)
}
