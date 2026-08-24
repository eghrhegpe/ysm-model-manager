package app

import (
	"os"
	"path/filepath"
	"testing"
)

func TestDetectLaunchersFindsPCLVersionsAndYSMConfig(t *testing.T) {
	root := t.TempDir()
	game := filepath.Join(root, ".minecraft")
	version := filepath.Join(game, "versions", "1.21.1")
	custom := filepath.Join(version, "config", "yes_steve_model", "custom")
	if err := os.MkdirAll(custom, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(game, "PCL"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(game, "PCL", "Setup.ini"), []byte("[PCL]\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(custom, "settings.json"), []byte("{}"), 0o644); err != nil {
		t.Fatal(err)
	}

	launchers, err := (&App{}).DetectLaunchers(root)
	if err != nil {
		t.Fatal(err)
	}
	if len(launchers) != 1 || launchers[0].Type != "pcl" {
		t.Fatalf("unexpected launchers: %#v", launchers)
	}
	if len(launchers[0].Instances) != 2 {
		t.Fatalf("expected global and version entries, got %#v", launchers[0].Instances)
	}
	found := false
	for _, instance := range launchers[0].Instances {
		if instance.Version == "1.21.1" {
			found = true
			if instance.YSMCustomDir != custom || !instance.YSMCustomExists || len(instance.YSMConfigFiles) != 1 {
				t.Fatalf("unexpected YSM entry: %#v", instance)
			}
			if len(instance.LauncherConfigFiles) != 1 {
				t.Fatalf("PCL setup was not detected: %#v", instance)
			}
		}
	}
	if !found {
		t.Fatalf("version entry missing: %#v", launchers[0].Instances)
	}
}

func TestDetectLaunchersIdentifiesHMCLByRootName(t *testing.T) {
	root := filepath.Join(t.TempDir(), "HMCL")
	game := filepath.Join(root, ".minecraft")
	if err := os.MkdirAll(filepath.Join(game, "versions", "isolated"), 0o755); err != nil {
		t.Fatal(err)
	}
	launchers, err := (&App{}).DetectLaunchers(root)
	if err != nil {
		t.Fatal(err)
	}
	if len(launchers) != 1 || launchers[0].Type != "hmcl" {
		t.Fatalf("unexpected HMCL result: %#v", launchers)
	}
}
