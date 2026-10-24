package launcher

import (
	"ysm-model-manager/go/internal/testutil"

	"encoding/json"
	"path/filepath"
	"testing"
)

func TestDetectPCLIsolatedInstance(t *testing.T) {
	root := t.TempDir()
	testutil.WriteTestFile(t, filepath.Join(root, "PCL.exe"), "")
	gameRoot := filepath.Join(root, ".minecraft")
	versionDir := filepath.Join(gameRoot, "versions", "Fabric-1.20.1")
	testutil.WriteTestFile(t, filepath.Join(versionDir, "Fabric-1.20.1.json"), `{"id":"fabric-loader","inheritsFrom":"1.20.1"}`)
	testutil.WriteTestFile(t, filepath.Join(versionDir, "PCL", "Setup.ini"), "VersionArgumentIndieV2=True\n")

	got, err := Detect(root)
	testutil.NoError(t, err)
	// OR 型复合断言拆序贯：逐字段 Equal，失败报告首个失配字段（Equal 失败即弃权）
	testutil.Equal(t, len(got), 1, "instances = %d, want 1: %#v", len(got), got)
	inst := got[0]
	testutil.Equal(t, inst.Launcher, "PCL", "unexpected identity: %#v", inst)
	testutil.Equal(t, inst.GameVersion, "1.20.1", "unexpected identity: %#v", inst)
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
	testutil.WriteTestFile(t, filepath.Join(gameRoot, "PCL.ini"), "Version=Forge-1.19.2\n")
	testutil.WriteTestFile(t, filepath.Join(gameRoot, "versions", "Forge-1.19.2", "Forge-1.19.2.json"), `{"id":"1.19.2-forge","inheritsFrom":"1.19.2"}`)
	testutil.WriteTestFile(t, filepath.Join(gameRoot, "versions", "Forge-1.19.2", "PCL", "Setup.ini"), "VersionArgumentIndieV2=False\n")

	got, err := Detect(root)
	testutil.NoError(t, err)
	// OR 型拆序贯：len 前置守卫防 got[0] 越界（Equal 失败即弃权）
	testutil.Equal(t, len(got), 1, "unexpected result: %#v", got)
	testutil.Equal(t, got[0].Launcher, "PCL", "unexpected result: %#v", got)
	if got[0].GameDir != gameRoot {
		t.Errorf("GameDir = %q, want shared root %q", got[0].GameDir, gameRoot)
	}
}

func TestDetectRejectsPlainMinecraftDirectory(t *testing.T) {
	root := t.TempDir()
	testutil.WriteTestFile(t, filepath.Join(root, ".minecraft", "versions", "1.20.1", "1.20.1.json"), `{"id":"1.20.1"}`)
	got, err := Detect(root)
	testutil.NoError(t, err)
	testutil.Equal(t, len(got), 0, "plain Minecraft directory must not be reported as HMCL/PCL: %#v", got)
}

func TestDetectHMCLConfiguredDirectoryAndRunningDirectory(t *testing.T) {
	launcherRoot := t.TempDir()
	gameRoot := filepath.Join(t.TempDir(), ".minecraft")
	configured := `{"$schema":"x","directories":[{"id":"game-directory:00000000-0000-0000-0000-000000000000","path":` + quoteJSON(gameRoot) + `}]}`
	testutil.WriteTestFile(t, filepath.Join(launcherRoot, "config", "user-game-directories.json"), configured)
	versionDir := filepath.Join(gameRoot, "versions", "NeoForge-1.21.1")
	testutil.WriteTestFile(t, filepath.Join(versionDir, "NeoForge-1.21.1.json"), `{"id":"neoforge","clientVersion":"1.21.1"}`)
	runDir := filepath.Join(t.TempDir(), "isolated-game")
	settings := `{"overrideProperties":["runningDirectory"],"settings":{"runningDirectory":` + quoteJSON(runDir) + `}}`
	testutil.WriteTestFile(t, filepath.Join(versionDir, ".hmcl", "config", "instance-game-settings.json"), settings)

	got, err := Detect(launcherRoot)
	testutil.NoError(t, err)
	testutil.Equal(t, len(got), 1, "instances = %d, want 1: %#v", len(got), got)
	inst := got[0]
	// OR 型复合断言拆序贯：逐字段 Equal，失败报告首个失配字段（Equal 失败即弃权）
	testutil.Equal(t, inst.Launcher, "HMCL", "unexpected result: %#v", inst)
	testutil.Equal(t, inst.GameVersion, "1.21.1", "unexpected result: %#v", inst)
	testutil.Equal(t, inst.GameDir, runDir, "unexpected result: %#v", inst)
}

func TestDetectHMCLModpackUsesVersionDirectory(t *testing.T) {
	root := t.TempDir()
	testutil.WriteTestFile(t, filepath.Join(root, "HMCL.jar"), "")
	gameRoot := filepath.Join(root, ".minecraft")
	versionDir := filepath.Join(gameRoot, "versions", "Pack")
	testutil.WriteTestFile(t, filepath.Join(versionDir, "Pack.json"), `{"id":"1.18.2"}`)
	testutil.WriteTestFile(t, filepath.Join(versionDir, "modpack.cfg"), "")

	got, err := Detect(root)
	testutil.NoError(t, err)
	// OR 型拆序贯：len 前置守卫防 got[0] 越界（Equal 失败即弃权）
	testutil.Equal(t, len(got), 1, "unexpected result: %#v", got)
	testutil.Equal(t, got[0].GameDir, versionDir, "unexpected result: %#v", got)
}

func TestDetectRejectsFile(t *testing.T) {
	file := filepath.Join(t.TempDir(), "PCL.exe")
	testutil.WriteTestFile(t, file, "")
	_, err := Detect(file)
	testutil.NotNil(t, err, "Detect(file) should fail")
}

func quoteJSON(s string) string {
	b, _ := json.Marshal(s)
	return string(b)
}
