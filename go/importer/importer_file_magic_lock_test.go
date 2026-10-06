// ===== ImportFromBase64 写盘/魔数分支数据锁（gocyclo 拆解红线）=====
// 既有测试覆盖了校验/错误码/rtype 路由/warn 的 .ysm 分支；改造前 go tool cover 实测
// 唯一未覆盖的是 **.7z 魔数不匹配 warn 分支**（importer_file.go:112-115）——
// 因为「坏 7z」在类型检测阶段就被拦下（无特征 → 空 rtype → 报错），永远走不到魔数校验。
// 唯一可达形态：**扩展名 .7z + 内容实为 zip**（内容检测给 rtype，扩展名决定走哪条魔数分支）。
//
// 这条缝是「类型判定看内容、魔数校验看扩展名」两个口径的交叉点，值得钉死：
// 若哪天魔数校验改成按内容判定的 rtype 分支，这里会静默从「warn 但导入」变成「不 warn」。
package importer

import (
	"encoding/base64"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// TestImportFromBase64_7zExtensionZipContentWarnsAndWrites：.7z 扩展名 + zip 内容
// （内含 pack.mcmeta → rtype=resourcepack）→ 魔数不匹配：warn 一条、落盘成功、
// 且落盘字节与输入逐字节相同（不得被魔数校验路径截断/改写）。
func TestImportFromBase64_7zExtensionZipContentWarnsAndWrites(t *testing.T) {
	root := t.TempDir()
	data := buildZipStd(zipEntry{"pack.mcmeta", []byte("{}")})

	var logs []string
	logFn := func(name, src, dst string, size int64, status, msg string) {
		logs = append(logs, status+"|"+msg)
	}
	dest, rtype, err := ImportFromBase64("m.7z", base64.StdEncoding.EncodeToString(data),
		ImportOptions{}, func(rtype string) string { return root }, logFn)
	if err != nil {
		t.Fatalf("魔数不匹配应仅 warn 不阻断: %v", err)
	}
	if rtype != "resourcepack" {
		t.Fatalf("rtype = %q, 期望 resourcepack（内容检测优先于扩展名）", rtype)
	}
	if want := filepath.Join(root, "m.7z"); dest != want {
		t.Fatalf("destPath = %q, 期望 %q", dest, want)
	}
	if len(logs) != 1 {
		t.Fatalf("应恰好一条 warn 日志, got %v", logs)
	}
	if !strings.HasPrefix(logs[0], "warn|") || !strings.Contains(logs[0], "7z") {
		t.Fatalf("warn 日志内容 = %q, 期望 warn 状态且提及 7z 魔数不匹配", logs[0])
	}

	got, err := os.ReadFile(dest)
	if err != nil {
		t.Fatalf("落盘文件应可读: %v", err)
	}
	if len(got) != len(data) {
		t.Fatalf("落盘字节数 = %d, 期望 %d（魔数校验不得截断 payload）", len(got), len(data))
	}
	for i := range data {
		if got[i] != data[i] {
			t.Fatalf("落盘字节在偏移 %d 处不同（payload 被改写）", i)
		}
	}
}

// TestImportFromBase64_7zMagicBranchSilencedBySkipCheck：SkipCheck 关闭整段魔数校验，
// .7z 扩展名 + zip 内容应零日志落盘——钉住「SkipCheck 优先于扩展名分支」的裁决顺序。
func TestImportFromBase64_7zMagicBranchSilencedBySkipCheck(t *testing.T) {
	root := t.TempDir()
	data := buildZipStd(zipEntry{"pack.mcmeta", []byte("{}")})
	var logs []string
	logFn := func(name, src, dst string, size int64, status, msg string) {
		logs = append(logs, status+"|"+msg)
	}
	dest, rtype, err := ImportFromBase64("skip.7z", base64.StdEncoding.EncodeToString(data),
		ImportOptions{SkipCheck: true}, func(rtype string) string { return root }, logFn)
	if err != nil {
		t.Fatalf("SkipCheck 导入应成功: %v", err)
	}
	if rtype != "resourcepack" {
		t.Fatalf("rtype = %q, 期望 resourcepack", rtype)
	}
	if len(logs) != 0 {
		t.Fatalf("SkipCheck 下不应产生魔数 warn, got %v", logs)
	}
	if _, err := os.Stat(dest); err != nil {
		t.Fatalf("文件应已落盘: %v", err)
	}
}
