//go:build android

package app

// scanMinecraftDirsPlatform Android 无桌面启动器扫描——
// 空实现：.minecraft 探测整链在 Android 无意义（ADR-047 P2-2 拆分）
func scanMinecraftDirsPlatform(add func(p string)) {}
