//go:build windows

package app

import (
	"os"
	"path/filepath"
)

// scanMinecraftDirsPlatform Windows 专属启动器路径扫描：
// 盘符扫描 + LOCALAPPDATA/ProgramFiles/ProgramData 环境变量 + 常见盘符根目录
func scanMinecraftDirsPlatform(add func(p string)) {
	// 收集所有可用磁盘（C-Z）
	var drives []string
	for d := 'C'; d <= 'Z'; d++ {
		root := string(d) + ":\\"
		if _, err := os.Stat(root); err == nil {
			drives = append(drives, root)
		}
	}

	// 常见启动器目录名（对各磁盘扫描）
	launcherNames := []string{
		"PCL2", "PCL",
		"HMCL",
		"BakaXL",
		"MC", "Minecraft", "Games\\Minecraft",
		"PrismLauncher", "MultiMC", "PolyMC",
	}
	for _, root := range drives {
		for _, name := range launcherNames {
			add(filepath.Join(root, name, ".minecraft"))
			if name == "PrismLauncher" || name == "MultiMC" || name == "PolyMC" {
				add(filepath.Join(root, name, "instances"))
				add(filepath.Join(root, name))
			}
		}
		add(filepath.Join(root, ".minecraft"))
	}

	// 常见用户目录下的 PrismLauncher（不一定在盘符根目录）
	if cfgDir, err := os.UserConfigDir(); err == nil {
		add(filepath.Join(cfgDir, "PrismLauncher", "instances"))
	}
	if localAppData := os.Getenv("LOCALAPPDATA"); localAppData != "" {
		add(filepath.Join(localAppData, "Programs", "PrismLauncher", "instances"))
		add(filepath.Join(localAppData, "Programs", "PrismLauncher"))
		add(filepath.Join(localAppData, "Programs", "MultiMC", "instances"))
		add(filepath.Join(localAppData, "Programs", "MultiMC"))
	}
	if progData := os.Getenv("ProgramData"); progData != "" {
		add(filepath.Join(progData, "PrismLauncher", "instances"))
	}

	// 常见安装路径下的一级子目录（D:\Games\Minecraft\PCL2 而非 D:\PCL2）
	commonBases := []string{
		filepath.Join(os.Getenv("ProgramFiles"), "Minecraft"),
		filepath.Join(os.Getenv("ProgramFiles(x86)"), "Minecraft"),
		"D:\\Games", "D:\\Game", "D:\\Programs",
		"E:\\Games", "E:\\Game",
	}
	for _, base := range commonBases {
		if _, err := os.Stat(base); err != nil {
			continue
		}
		for _, name := range launcherNames {
			add(filepath.Join(base, name, ".minecraft"))
		}
	}
}
