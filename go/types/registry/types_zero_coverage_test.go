// ===== types 包 0% 覆盖函数补测（IsDirLevelSync / IsScanInstance / InstallExtsFor /
// MatchZipEntry / StatusToLevel）=====
package types

import (
	"testing"
)

func TestStatusToLevel(t *testing.T) {
	tests := []struct {
		input    string
		expected LogLevel
	}{
		{"success", LevelInfo},
		{"failed", LevelError},
		{"warn", LevelWarn},
		{"skipped", LevelDebug},
		{"unknown", LevelInfo},
		{"", LevelInfo},
	}
	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			got := StatusToLevel(tt.input)
			if got != tt.expected {
				t.Errorf("StatusToLevel(%q) = %q, 期望 %q", tt.input, got, tt.expected)
			}
		})
	}
}

func TestIsDirLevelSync(t *testing.T) {
	tests := []struct {
		rtype    string
		expected bool
	}{
		{"resourcepack", false},
		{"shaderpack", false},
		{"ysm", true},
		{"blueprint", true},
		{"litematic", true},
		{"EntityPlayer", true},
		{"maid-model", true},
		{"vrm", false},
		{"unknown", false},
		{"", false},
	}
	for _, tt := range tests {
		t.Run(tt.rtype, func(t *testing.T) {
			got := IsDirLevelSync(tt.rtype)
			if got != tt.expected {
				t.Errorf("IsDirLevelSync(%q) = %v, 期望 %v", tt.rtype, got, tt.expected)
			}
		})
	}
}

func TestIsScanInstance(t *testing.T) {
	tests := []struct {
		rtype    string
		expected bool
	}{
		{"resourcepack", false},
		{"shaderpack", false},
		{"blueprint", true},
		{"ysm", false},
		{"litematic", false},
		{"EntityPlayer", false},
		{"vrm", false},
		{"unknown", false},
		{"", false},
	}
	for _, tt := range tests {
		t.Run(tt.rtype, func(t *testing.T) {
			got := IsScanInstance(tt.rtype)
			if got != tt.expected {
				t.Errorf("IsScanInstance(%q) = %v, 期望 %v", tt.rtype, got, tt.expected)
			}
		})
	}
}

func TestInstallExtsFor(t *testing.T) {
	exts := InstallExtsFor("ysm")
	if len(exts) != 5 {
		t.Fatalf("InstallExtsFor('ysm') 长度 = %d, 期望 5", len(exts))
	}
	expectedYsm := map[string]bool{".ysm": false, ".json": false, ".png": false, ".jpg": false, ".jpeg": false}
	for _, e := range exts {
		expectedYsm[e] = true
	}
	for e, found := range expectedYsm {
		if !found {
			t.Errorf("InstallExtsFor('ysm') 缺少 %q: %v", e, exts)
		}
	}

	exts = InstallExtsFor("maid-model")
	if len(exts) == 0 {
		t.Fatal("InstallExtsFor('maid-model') = 空")
	}
	foundPng := false
	for _, e := range exts {
		if e == ".png" {
			foundPng = true
			break
		}
	}
	if !foundPng {
		t.Errorf("InstallExtsFor('maid-model') 缺少 .png: %v", exts)
	}

	if exts := InstallExtsFor("unknown"); exts != nil {
		t.Errorf("InstallExtsFor('unknown') = %v, 期望 nil", exts)
	}

	if exts := InstallExtsFor(""); exts != nil {
		t.Errorf("InstallExtsFor('') = %v, 期望 nil", exts)
	}

	exts = InstallExtsFor("ysm")
	if len(exts) > 0 {
		exts[0] = ".hacked"
		exts2 := InstallExtsFor("ysm")
		if len(exts2) > 0 && exts2[0] == ".hacked" {
			t.Error("InstallExtsFor 返回的切片不应共享注册表内存")
		}
	}
}

func TestMatchZipEntry(t *testing.T) {
	// pack.mcmeta → resourcepack（exact 匹配）
	if got := MatchZipEntry("pack.mcmeta"); got != "resourcepack" {
		t.Errorf("MatchZipEntry('pack.mcmeta') = %q, 期望 'resourcepack'", got)
	}
	// shaders/ → shaderpack（prefix 匹配）
	if got := MatchZipEntry("shaders/"); got != "shaderpack" {
		t.Errorf("MatchZipEntry('shaders/') = %q, 期望 'shaderpack'", got)
	}
	// 未知条目返回空
	if got := MatchZipEntry("unknown.txt"); got != "" {
		t.Errorf("MatchZipEntry('unknown.txt') = %q, 期望 ''", got)
	}
	// 空字符串返回空
	if got := MatchZipEntry(""); got != "" {
		t.Errorf("MatchZipEntry('') = %q, 期望 ''", got)
	}
}
