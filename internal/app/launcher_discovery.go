package app

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"ysm-model-manager/go/types"
)

// DetectLaunchers inspects a selected directory, or a small set of known
// Minecraft locations when root is empty. Discovery is deliberately bounded:
// it never walks an entire drive and it never writes launcher files.
func (a *App) DetectLaunchers(root string) ([]types.LauncherInfo, error) {
	candidates, err := launcherCandidates(root)
	if err != nil {
		return nil, err
	}
	seen := make(map[string]bool)
	result := make([]types.LauncherInfo, 0, len(candidates))
	for _, candidate := range candidates {
		info, ok := detectLauncher(candidate)
		if !ok {
			continue
		}
		key := normalizePath(info.RootDir)
		if seen[key] {
			continue
		}
		seen[key] = true
		result = append(result, info)
	}
	sort.Slice(result, func(i, j int) bool {
		if result[i].Type != result[j].Type {
			return result[i].Type < result[j].Type
		}
		return strings.ToLower(result[i].RootDir) < strings.ToLower(result[j].RootDir)
	})
	return result, nil
}

func launcherCandidates(root string) ([]string, error) {
	if strings.TrimSpace(root) != "" {
		abs, err := filepath.Abs(filepath.Clean(root))
		if err != nil {
			return nil, fmt.Errorf("resolve launcher directory: %w", err)
		}
		info, err := os.Stat(abs)
		if err != nil {
			return nil, fmt.Errorf("launcher directory is not accessible: %w", err)
		}
		if !info.IsDir() {
			return nil, fmt.Errorf("launcher path is not a directory")
		}
		return []string{abs}, nil
	}

	var result []string
	// Existing Minecraft discovery already knows the platform-specific default
	// locations. Treat those game roots as launcher candidates as well.
	result = append(result, scanMinecraftDirs()...)
	if home, err := os.UserHomeDir(); err == nil && home != "" {
		result = append(result,
			filepath.Join(home, ".minecraft"),
			filepath.Join(home, ".hmcl"),
			filepath.Join(home, "HMCL"),
			filepath.Join(home, "PCL2"),
			filepath.Join(home, "PCL"),
		)
	}
	for _, envName := range []string{"APPDATA", "LOCALAPPDATA", "PROGRAMDATA", "PROGRAMFILES", "PROGRAMFILES(X86)"} {
		if base := strings.TrimSpace(os.Getenv(envName)); base != "" {
			for _, name := range []string{"HMCL", "HMCL3", "PCL2", "PCL", "Plain Craft Launcher 2"} {
				result = append(result, filepath.Join(base, name))
			}
		}
	}
	return uniqueExistingDirs(result), nil
}

func uniqueExistingDirs(paths []string) []string {
	seen := make(map[string]bool)
	result := make([]string, 0, len(paths))
	for _, path := range paths {
		if strings.TrimSpace(path) == "" {
			continue
		}
		abs, err := filepath.Abs(filepath.Clean(path))
		if err != nil || seen[normalizePath(abs)] {
			continue
		}
		info, err := os.Stat(abs)
		if err != nil || !info.IsDir() {
			continue
		}
		seen[normalizePath(abs)] = true
		result = append(result, abs)
	}
	return result
}

func detectLauncher(candidate string) (types.LauncherInfo, bool) {
	root, err := filepath.Abs(filepath.Clean(candidate))
	if err != nil {
		return types.LauncherInfo{}, false
	}
	gameRoots := discoverGameRoots(root)
	if len(gameRoots) == 0 {
		return types.LauncherInfo{}, false
	}
	launcherType := detectLauncherType(root, gameRoots)
	instances := make([]types.LauncherInstance, 0)
	seen := make(map[string]bool)
	for _, gameRoot := range gameRoots {
		for _, instance := range discoverLauncherInstances(gameRoot.path, gameRoot.name) {
			key := normalizePath(instance.Path)
			if seen[key] {
				continue
			}
			seen[key] = true
			instances = append(instances, instance)
		}
	}
	if len(instances) == 0 {
		return types.LauncherInfo{}, false
	}
	sort.Slice(instances, func(i, j int) bool {
		return strings.ToLower(instances[i].Path) < strings.ToLower(instances[j].Path)
	})
	return types.LauncherInfo{
		Type:      launcherType,
		Name:      launcherDisplayName(launcherType),
		RootDir:   root,
		Instances: instances,
	}, true
}

type launcherGameRoot struct {
	path string
	name string
}

func discoverGameRoots(root string) []launcherGameRoot {
	seen := make(map[string]bool)
	result := make([]launcherGameRoot, 0, 8)
	add := func(path, name string) {
		info, err := os.Stat(path)
		if err != nil || !info.IsDir() {
			return
		}
		abs, err := filepath.Abs(filepath.Clean(path))
		if err != nil || seen[normalizePath(abs)] {
			return
		}
		seen[normalizePath(abs)] = true
		if name == "" {
			name = filepath.Base(abs)
		}
		result = append(result, launcherGameRoot{path: abs, name: name})
	}

	if isMinecraftGameRoot(root) {
		add(root, filepath.Base(root))
	}
	for _, name := range []string{".minecraft", "minecraft"} {
		add(filepath.Join(root, name), name)
	}
	instancesDir := filepath.Join(root, "instances")
	if entries, err := os.ReadDir(instancesDir); err == nil {
		for _, entry := range entries {
			if !entry.IsDir() {
				continue
			}
			instanceRoot := filepath.Join(instancesDir, entry.Name())
			added := false
			for _, name := range []string{".minecraft", "minecraft"} {
				before := len(result)
				add(filepath.Join(instanceRoot, name), entry.Name())
				added = added || len(result) != before
			}
			if !added && isMinecraftGameRoot(instanceRoot) {
				add(instanceRoot, entry.Name())
			}
		}
	}
	// A selected launcher install directory may contain a game root one level
	// below without an instances/ directory. Keep this bounded to avoid a disk
	// scan while still covering common PCL/HMCL layouts.
	if entries, err := os.ReadDir(root); err == nil {
		for _, entry := range entries {
			if !entry.IsDir() || strings.HasPrefix(entry.Name(), ".") {
				continue
			}
			child := filepath.Join(root, entry.Name())
			if isMinecraftGameRoot(child) {
				add(child, entry.Name())
			}
			for _, name := range []string{".minecraft", "minecraft"} {
				add(filepath.Join(child, name), entry.Name())
			}
		}
	}
	return result
}

func isMinecraftGameRoot(path string) bool {
	if info, err := os.Stat(path); err != nil || !info.IsDir() {
		return false
	}
	base := strings.ToLower(filepath.Base(path))
	if base == ".minecraft" || base == "minecraft" {
		return true
	}
	for _, marker := range []string{"versions", "assets", "config", "mods", "launcher_profiles.json", "instances"} {
		if _, err := os.Stat(filepath.Join(path, marker)); err == nil {
			return true
		}
	}
	return false
}

func detectLauncherType(root string, gameRoots []launcherGameRoot) string {
	text := strings.ToLower(filepath.Clean(root))
	if strings.Contains(text, "hmcl") || hasAnyMarker(root, ".hmcl", "hmcl.json", "hmcl.cfg", "hmcl.ini") {
		return "hmcl"
	}
	if strings.Contains(text, "pcl") || hasAnyMarker(root, "PCL", "PCL2.exe", "Plain Craft Launcher 2.exe") {
		return "pcl"
	}
	for _, gameRoot := range gameRoots {
		if hasPCLSetup(gameRoot.path) {
			return "pcl"
		}
	}
	return "minecraft"
}

func launcherDisplayName(kind string) string {
	switch kind {
	case "hmcl":
		return "HMCL"
	case "pcl":
		return "PCL"
	default:
		return "Minecraft"
	}
}

func hasAnyMarker(root string, markers ...string) bool {
	for _, marker := range markers {
		if _, err := os.Stat(filepath.Join(root, marker)); err == nil {
			return true
		}
	}
	return false
}

func discoverLauncherInstances(gameRoot, rootName string) []types.LauncherInstance {
	result := make([]types.LauncherInstance, 0, 8)
	rootLauncherConfig := launcherConfigFiles(gameRoot)
	add := func(path, name, version string) {
		abs, err := filepath.Abs(filepath.Clean(path))
		if err != nil {
			return
		}
		custom := filepath.Join(abs, types.SubDirMap("ysm"))
		launcherConfigs := launcherConfigFiles(abs)
		if version != "" {
			launcherConfigs = append(append([]string(nil), rootLauncherConfig...), launcherConfigs...)
		}
		result = append(result, types.LauncherInstance{
			Name:                name,
			Version:             version,
			Path:                abs,
			YSMCustomDir:        custom,
			YSMCustomExists:     launcherIsDir(custom),
			YSMConfigFiles:      listConfigFiles(custom),
			LauncherConfigFiles: uniqueStrings(launcherConfigs),
		})
	}

	// The game root itself is useful for non-isolated PCL profiles and for the
	// global HMCL configuration. Version-specific entries follow below.
	add(gameRoot, rootName, "")
	versionsDir := filepath.Join(gameRoot, "versions")
	entries, err := os.ReadDir(versionsDir)
	if err != nil {
		return result
	}
	for _, entry := range entries {
		if entry.IsDir() {
			add(filepath.Join(versionsDir, entry.Name()), entry.Name(), entry.Name())
		}
	}
	return result
}

func uniqueStrings(values []string) []string {
	seen := make(map[string]bool, len(values))
	result := make([]string, 0, len(values))
	for _, value := range values {
		key := normalizePath(value)
		if value == "" || seen[key] {
			continue
		}
		seen[key] = true
		result = append(result, value)
	}
	return result
}

func launcherConfigFiles(root string) []string {
	result := make([]string, 0, 2)
	for _, path := range []string{
		filepath.Join(root, "PCL", "Setup.ini"),
		filepath.Join(root, "PCL2", "Setup.ini"),
		filepath.Join(root, "Setup.ini"),
	} {
		if info, err := os.Stat(path); err == nil && !info.IsDir() {
			result = append(result, path)
		}
	}
	return result
}

func hasPCLSetup(root string) bool { return len(launcherConfigFiles(root)) > 0 }

func listConfigFiles(root string) []string {
	entries, err := os.ReadDir(root)
	if err != nil {
		return nil
	}
	result := make([]string, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		result = append(result, filepath.Join(root, entry.Name()))
	}
	sort.Strings(result)
	return result
}

func launcherIsDir(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.IsDir()
}

func normalizePath(path string) string {
	abs, err := filepath.Abs(filepath.Clean(path))
	if err != nil {
		abs = filepath.Clean(path)
	}
	return strings.ToLower(filepath.ToSlash(abs))
}
