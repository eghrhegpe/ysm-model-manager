// Package launcher discovers Minecraft instances managed by desktop launchers.
package launcher

import (
	"encoding/json"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"ysm-model-manager/go/types"
)

const ysmCustomSubdir = "config/yes_steve_model/custom"

const (
	launcherHMCL      = "HMCL"
	launcherPCL       = "PCL"
	launcherMinecraft = "Minecraft"
)

// Detect identifies the launcher selected by the user and resolves every
// Minecraft version to its actual run directory and YSM custom directory.
func Detect(selectedDir string) ([]types.LauncherInstance, error) {
	if strings.TrimSpace(selectedDir) == "" {
		return nil, errors.New("启动器目录不能为空")
	}
	root, err := filepath.Abs(filepath.Clean(selectedDir))
	if err != nil {
		return nil, err
	}
	info, err := os.Stat(root)
	if err != nil {
		return nil, err
	}
	if !info.IsDir() {
		return nil, errors.New("请选择启动器所在文件夹，而不是文件")
	}

	launcherName := identifyLauncher(root)
	gameRoots := collectGameRoots(root)
	result := make([]types.LauncherInstance, 0)
	for _, gameRoot := range gameRoots {
		name := launcherName
		if detected := identifyLauncher(gameRoot); detected != launcherMinecraft {
			name = detected
		}
		if name == launcherMinecraft {
			continue
		}
		result = append(result, scanVersions(name, root, gameRoot)...)
	}
	sort.Slice(result, func(i, j int) bool {
		if result[i].Launcher != result[j].Launcher {
			return result[i].Launcher < result[j].Launcher
		}
		if result[i].GameRoot != result[j].GameRoot {
			return result[i].GameRoot < result[j].GameRoot
		}
		return strings.ToLower(result[i].Name) < strings.ToLower(result[j].Name)
	})
	return result, nil
}

func identifyLauncher(root string) string {
	if fileExists(filepath.Join(root, "config", "user-game-directories.json")) ||
		globExists(filepath.Join(root, "HMCL*.jar")) ||
		fileExists(filepath.Join(root, "hmcl.json")) {
		return launcherHMCL
	}
	if globExists(filepath.Join(root, "PCL*.exe")) ||
		fileExists(filepath.Join(root, "PCL.ini")) {
		return launcherPCL
	}
	return launcherMinecraft
}

func collectGameRoots(launcherRoot string) []string {
	roots := make([]string, 0)
	seen := make(map[string]bool)
	add := func(path string) {
		if strings.TrimSpace(path) == "" {
			return
		}
		path = resolvePortablePath(launcherRoot, path)
		if !dirExists(filepath.Join(path, "versions")) {
			return
		}
		key := strings.ToLower(filepath.Clean(path))
		if seen[key] {
			return
		}
		seen[key] = true
		roots = append(roots, filepath.Clean(path))
	}

	add(launcherRoot)
	add(filepath.Join(launcherRoot, ".minecraft"))
	for _, path := range readHMCLGameDirectories(launcherRoot) {
		add(path)
	}

	// A launcher can be stored one or two folders above .minecraft. Keep this
	// bounded so selecting a large drive never turns detection into a full scan.
	_ = filepath.WalkDir(launcherRoot, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil || !entry.IsDir() {
			return nil
		}
		rel, err := filepath.Rel(launcherRoot, path)
		if err != nil {
			return nil
		}
		depth := 0
		if rel != "." {
			depth = len(strings.Split(rel, string(filepath.Separator)))
		}
		if depth > 3 {
			return filepath.SkipDir
		}
		if entry.Name() == ".minecraft" || dirExists(filepath.Join(path, "versions")) {
			add(path)
		}
		return nil
	})
	sort.Strings(roots)
	return roots
}

func readHMCLGameDirectories(launcherRoot string) []string {
	data, err := os.ReadFile(filepath.Join(launcherRoot, "config", "user-game-directories.json"))
	if err != nil {
		return nil
	}
	var document struct {
		Directories []struct {
			Path string `json:"path"`
		} `json:"directories"`
	}
	if json.Unmarshal(data, &document) != nil {
		return nil
	}
	paths := make([]string, 0, len(document.Directories))
	for _, directory := range document.Directories {
		paths = append(paths, directory.Path)
	}
	return paths
}

func resolvePortablePath(base, path string) string {
	path = os.ExpandEnv(strings.TrimSpace(path))
	if path == "~" || strings.HasPrefix(path, "~"+string(filepath.Separator)) || strings.HasPrefix(path, "~/") {
		if home, err := os.UserHomeDir(); err == nil {
			path = filepath.Join(home, strings.TrimLeft(path[1:], "/\\"))
		}
	}
	if !filepath.IsAbs(path) {
		path = filepath.Join(base, path)
	}
	abs, err := filepath.Abs(path)
	if err != nil {
		return filepath.Clean(path)
	}
	return filepath.Clean(abs)
}

func scanVersions(launcherName, launcherRoot, gameRoot string) []types.LauncherInstance {
	entries, err := os.ReadDir(filepath.Join(gameRoot, "versions"))
	if err != nil {
		return nil
	}
	instances := make([]types.LauncherInstance, 0, len(entries))
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		name := entry.Name()
		versionDir := filepath.Join(gameRoot, "versions", name)
		gameDir := resolveRunDirectory(launcherName, launcherRoot, gameRoot, versionDir)
		customDir := filepath.Join(gameDir, filepath.FromSlash(ysmCustomSubdir))
		instances = append(instances, types.LauncherInstance{
			Launcher:    launcherName,
			Name:        name,
			GameVersion: readGameVersion(versionDir, name),
			GameRoot:    gameRoot,
			GameDir:     gameDir,
			CustomDir:   customDir,
			Exists:      dirExists(customDir),
		})
	}
	return instances
}

func resolveRunDirectory(launcherName, launcherRoot, gameRoot, versionDir string) string {
	// Existing data is the strongest signal and also supports older launcher versions.
	if dirExists(filepath.Join(versionDir, filepath.FromSlash(ysmCustomSubdir))) {
		return versionDir
	}
	switch launcherName {
	case launcherPCL:
		if isolated, configured := pclInstanceIsolation(filepath.Join(versionDir, "PCL", "Setup.ini")); isolated || !configured {
			return versionDir
		}
	case launcherHMCL:
		if fileExists(filepath.Join(versionDir, "modpack.cfg")) {
			return versionDir
		}
		if runDir, isolated := hmclRunningDirectory(filepath.Join(versionDir, ".hmcl", "config", "instance-game-settings.json")); isolated {
			if runDir == "" {
				return versionDir
			}
			return resolvePortablePath(launcherRoot, runDir)
		}
		if runDir, isolated := legacyHMCLRunningDirectory(filepath.Join(versionDir, "hmclversion.cfg")); isolated {
			if runDir == "" {
				return versionDir
			}
			return resolvePortablePath(launcherRoot, runDir)
		}
	}
	return gameRoot
}

func pclInstanceIsolation(path string) (isolated bool, configured bool) {
	data, err := os.ReadFile(path)
	if err != nil {
		return false, false
	}
	for _, line := range strings.Split(strings.ReplaceAll(string(data), "\r", ""), "\n") {
		parts := strings.SplitN(strings.TrimSpace(line), "=", 2)
		if len(parts) != 2 {
			continue
		}
		key := strings.ToLower(strings.TrimSpace(parts[0]))
		value := strings.ToLower(strings.TrimSpace(parts[1]))
		if key == "versionargumentindiev2" {
			return value == "true" || value == "1", true
		}
		if key == "versionargumentindie" && (value == "1" || value == "2") {
			return value == "1", true
		}
	}
	return false, false
}

func hmclRunningDirectory(path string) (string, bool) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", false
	}
	var value any
	if json.Unmarshal(data, &value) != nil {
		return "", false
	}
	overridden := jsonArrayContains(value, "overrideProperties", "runningDirectory")
	if !overridden {
		return "", false
	}
	runDir, _ := findJSONString(value, "runningDirectory")
	return runDir, true
}

func legacyHMCLRunningDirectory(path string) (string, bool) {
	data, err := os.ReadFile(path)
	if err != nil {
		return "", false
	}
	var runDir string
	isolated := false
	for _, line := range strings.Split(strings.ReplaceAll(string(data), "\r", ""), "\n") {
		parts := strings.SplitN(strings.TrimSpace(line), "=", 2)
		if len(parts) != 2 {
			continue
		}
		key, value := strings.TrimSpace(parts[0]), strings.TrimSpace(parts[1])
		if key == "gameDir" || key == "runningDirectory" {
			runDir = value
			isolated = true
		}
		if (key == "isolation" || key == "usesGlobal") && (value == "true" || value == "false") {
			isolated = key == "isolation" && value == "true" || key == "usesGlobal" && value == "false"
		}
	}
	return runDir, isolated
}

func jsonArrayContains(value any, key, target string) bool {
	switch current := value.(type) {
	case map[string]any:
		for childKey, child := range current {
			if childKey == key {
				if values, ok := child.([]any); ok {
					for _, item := range values {
						if item == target {
							return true
						}
					}
				}
			}
			if jsonArrayContains(child, key, target) {
				return true
			}
		}
	case []any:
		for _, child := range current {
			if jsonArrayContains(child, key, target) {
				return true
			}
		}
	}
	return false
}

func findJSONString(value any, key string) (string, bool) {
	switch current := value.(type) {
	case map[string]any:
		if raw, ok := current[key]; ok {
			if text, ok := raw.(string); ok {
				return text, true
			}
		}
		for _, child := range current {
			if text, ok := findJSONString(child, key); ok {
				return text, true
			}
		}
	case []any:
		for _, child := range current {
			if text, ok := findJSONString(child, key); ok {
				return text, true
			}
		}
	}
	return "", false
}

func readGameVersion(versionDir, fallback string) string {
	data, err := os.ReadFile(filepath.Join(versionDir, filepath.Base(versionDir)+".json"))
	if err != nil {
		return fallback
	}
	var manifest map[string]any
	if json.Unmarshal(data, &manifest) != nil {
		return fallback
	}
	for _, key := range []string{"clientVersion", "inheritsFrom", "minecraftVersion", "id"} {
		if value, ok := manifest[key].(string); ok && strings.TrimSpace(value) != "" {
			return value
		}
	}
	return fallback
}

func fileExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}

func dirExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.IsDir()
}

func globExists(pattern string) bool {
	matches, err := filepath.Glob(pattern)
	return err == nil && len(matches) > 0
}
