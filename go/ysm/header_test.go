package ysm

import (
	"bufio"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// ====== hasTextHeader ======

func TestHasTextHeader_WithTextHeader(t *testing.T) {
	content := "YSGP\n--- [Metadata]\n<name>TestModel</name>\n---\n"
	path := writeTempFile(t, content)
	defer os.Remove(path)

	if !hasTextHeader(path) {
		t.Error("expected hasTextHeader = true for file with text header")
	}
}

func TestHasTextHeader_WithBOMAndTextHeader(t *testing.T) {
	// UTF-8 BOM + YSGP + text header
	content := "\xef\xbb\xbfYSGP\n--- [Metadata]\n<name>Test</name>\n"
	path := writeTempFile(t, content)
	defer os.Remove(path)

	if !hasTextHeader(path) {
		t.Error("expected hasTextHeader = true for BOM + text header")
	}
}

func TestHasTextHeader_PureBinary(t *testing.T) {
	// Pure binary YSGP V2 — no text markers at all
	var buf []byte
	buf = append(buf, []byte("YSGP")...)
	buf = append(buf, byte(0x02), byte(0x00), byte(0x00), byte(0x00)) // version 2
	for i := 0; i < 100; i++ {
		buf = append(buf, byte(i))
	}
	path := writeTempFile(t, string(buf))
	defer os.Remove(path)

	if hasTextHeader(path) {
		t.Error("expected hasTextHeader = false for pure binary file")
	}
}

func TestHasTextHeader_TooShort(t *testing.T) {
	path := writeTempFile(t, "YSGP")
	defer os.Remove(path)

	if hasTextHeader(path) {
		t.Error("expected hasTextHeader = false for file < 16 bytes")
	}
}

func TestHasTextHeader_EmptyFile(t *testing.T) {
	path := writeTempFile(t, "")
	defer os.Remove(path)

	if hasTextHeader(path) {
		t.Error("expected hasTextHeader = false for empty file")
	}
}

func TestHasTextHeader_NonExistentFile(t *testing.T) {
	if hasTextHeader("/nonexistent/path.ysm") {
		t.Error("expected hasTextHeader = false for nonexistent file")
	}
}

// ====== scanHeader ======

func TestScanHeader_FullMetadata(t *testing.T) {
	input := `YSGP
--- [Metadata]
<name>TestModel</name>
<free>true</free>
<hash>abc123</hash>
<license>CC-BY-SA</license>
<link-home>https://example.com</link-home>
<link_update>https://example.com/update</link_update>
--- [Codec]
<format>3</format>
<crypto>1</crypto>
--- [Tips]
This is a tip line
Another tip line
--- [Authors]
<name>AuthorName</name>
<role>Modeler</role>
<contact-Bilibili>https://b23.tv/xxx</contact-Bilibili>
<contact-Afdian>https://afdian.net/xxx</contact-Afdian>
===`

	h := scanHeader(bufio.NewScanner(strings.NewReader(input)))

	if !h.IsYSM {
		t.Error("IsYSM should be true")
	}
	if !h.IsFree {
		t.Error("IsFree should be true")
	}
	if !h.HasFree {
		t.Error("HasFree should be true")
	}
	if h.Name != "TestModel" {
		t.Errorf("Name = %q, want %q", h.Name, "TestModel")
	}
	if h.Hash != "abc123" {
		t.Errorf("Hash = %q, want %q", h.Hash, "abc123")
	}
	if h.License != "CC-BY-SA" {
		t.Errorf("License = %q, want %q", h.License, "CC-BY-SA")
	}
	if h.LinkHome != "https://example.com" {
		t.Errorf("LinkHome = %q", h.LinkHome)
	}
	if h.LinkUpdate != "https://example.com/update" {
		t.Errorf("LinkUpdate = %q", h.LinkUpdate)
	}
	if h.Format != 3 {
		t.Errorf("Format = %d, want 3", h.Format)
	}
	if h.Crypto != 1 {
		t.Errorf("Crypto = %d, want 1", h.Crypto)
	}
	if !strings.Contains(h.Tips, "This is a tip line") {
		t.Errorf("Tips should contain 'This is a tip line', got %q", h.Tips)
	}
	if h.AuthorName != "AuthorName" {
		t.Errorf("AuthorName = %q, want %q", h.AuthorName, "AuthorName")
	}
	if h.AuthorRole != "Modeler" {
		t.Errorf("AuthorRole = %q", h.AuthorRole)
	}
	if h.AuthorBilibili != "https://b23.tv/xxx" {
		t.Errorf("AuthorBilibili = %q", h.AuthorBilibili)
	}
	if h.AuthorAfdian != "https://afdian.net/xxx" {
		t.Errorf("AuthorAfdian = %q", h.AuthorAfdian)
	}
}

func TestScanHeader_NoFreeTag(t *testing.T) {
	input := "YSGP\n--- [Metadata]\n<name>NoFree</name>\n==="
	h := scanHeader(bufio.NewScanner(strings.NewReader(input)))

	if h.HasFree {
		t.Error("HasFree should be false when <free> tag is absent")
	}
	if h.IsFree {
		t.Error("IsFree should be false when <free> tag is absent")
	}
}

func TestScanHeader_StopsAtDashDashDash(t *testing.T) {
	// --- without [section] should stop scanning (binary data boundary)
	input := "YSGP\n--- [Metadata]\n<name>BeforeBinary</name>\n------------------------------\nBINARYDATA should not be read\n<name>AfterBinary</name>\n"
	h := scanHeader(bufio.NewScanner(strings.NewReader(input)))

	if h.Name != "BeforeBinary" {
		t.Errorf("Name = %q, want %q", h.Name, "BeforeBinary")
	}
	// AfterBinary should NOT overwrite name
	if strings.Contains(h.Name, "AfterBinary") {
		t.Error("scanHeader should stop at --- separator and not read further")
	}
}

func TestScanHeader_MinimalHeader(t *testing.T) {
	input := "YSGP\n--- [Metadata]\n<name>Minimal</name>\n==="
	h := scanHeader(bufio.NewScanner(strings.NewReader(input)))

	if !h.IsYSM {
		t.Error("IsYSM should be true")
	}
	if h.Name != "Minimal" {
		t.Errorf("Name = %q, want %q", h.Name, "Minimal")
	}
	if h.HasFree {
		t.Error("HasFree should be false")
	}
}

func TestScanHeader_PreambleAsTips(t *testing.T) {
	// Lines before any section should become tips
	input := "YSGP\n// A preamble comment\n# Another comment\n<name>Test</name>\n==="
	h := scanHeader(bufio.NewScanner(strings.NewReader(input)))

	if !strings.Contains(h.Tips, "A preamble comment") {
		t.Errorf("Tips should contain preamble, got %q", h.Tips)
	}
}

func TestScanHeader_BOM(t *testing.T) {
	// File with BOM prefix
	input := "\ufeffYSGP\n--- [Metadata]\n<name>BOMTest</name>\n==="
	h := scanHeader(bufio.NewScanner(strings.NewReader(input)))

	if !h.IsYSM {
		t.Error("IsYSM should be true even with BOM")
	}
	if h.Name != "BOMTest" {
		t.Errorf("Name = %q, want %q", h.Name, "BOMTest")
	}
}

func TestScanHeader_LimitLines(t *testing.T) {
	// scanner should stop after 200 lines even without === or ---
	var lines []string
	lines = append(lines, "YSGP")
	lines = append(lines, "--- [Metadata]")
	for i := 0; i < 250; i++ {
		lines = append(lines, "<name>Overshoot</name>")
	}
	input := strings.Join(lines, "\n")
	h := scanHeader(bufio.NewScanner(strings.NewReader(input)))

	if h.Name != "Overshoot" {
		t.Errorf("Name = %q, want %q", h.Name, "Overshoot")
	}
}

// ====== parseInt ======

func TestParseInt(t *testing.T) {
	tests := []struct {
		input string
		want  int
	}{
		{"123", 123},
		{"0", 0},
		{"-5", -5},
		{"abc", 0},
		{"", 0},
		{"  42  ", 42},
		{"3.14", 0}, // float should fail
	}
	for _, tt := range tests {
		got := parseInt(tt.input)
		if got != tt.want {
			t.Errorf("parseInt(%q) = %d, want %d", tt.input, got, tt.want)
		}
	}
}

// ====== AnalyzeYSMHeaderFromBytes ======

func TestAnalyzeYSMHeaderFromBytes_Full(t *testing.T) {
	input := "YSGP\n--- [Metadata]\n<name>ByteTest</name>\n<license>MIT</license>\n--- [Authors]\n<name>AuthorName</name>\n==="
	h := AnalyzeYSMHeaderFromBytes([]byte(input))
	if !h.IsYSM {
		t.Error("IsYSM 应为 true")
	}
	if h.Name != "ByteTest" {
		t.Errorf("Name = %q, 期望 ByteTest", h.Name)
	}
	if h.License != "MIT" {
		t.Errorf("License = %q, 期望 MIT", h.License)
	}
	if h.AuthorName != "AuthorName" {
		t.Errorf("AuthorName = %q, 期望 AuthorName", h.AuthorName)
	}
}

func TestAnalyzeYSMHeaderFromBytes_Truncated(t *testing.T) {
	// 超过 4096 字节应截断
	long := make([]byte, 5000)
	for i := range long {
		long[i] = 'a'
	}
	copy(long, "YSGP\n--- [Metadata]\n<name>Truncated</name>\n===")
	h := AnalyzeYSMHeaderFromBytes(long)
	if !h.IsYSM {
		t.Error("IsYSM 应为 true")
	}
}

func TestAnalyzeYSMHeaderFromBytes_Empty(t *testing.T) {
	h := AnalyzeYSMHeaderFromBytes([]byte{})
	if h.IsYSM {
		t.Error("空字节的 IsYSM 应为 false")
	}
}

// ====== detectYSGPHeader ======

func TestDetectYSGPHeader_Simple(t *testing.T) {
	// detectYSGPHeader 只读取前 100 字节，<name> 值提取到换行符为止
	path := writeTempFile(t, "YSGP\n--- [Metadata]\n<name>TestModel\n</name>\n")
	h := detectYSGPHeader(path)
	if h == nil {
		t.Fatal("期望非 nil")
	}
	if !h.IsYSM {
		t.Error("IsYSM 应为 true")
	}
	if h.Format != 2 {
		t.Errorf("Format = %d, 期望 2 (YSGP)", h.Format)
	}
	if h.Name != "TestModel" {
		t.Errorf("Name = %q, 期望 TestModel", h.Name)
	}
}

func TestDetectYSGPHeader_WithBOM(t *testing.T) {
	path := writeTempFile(t, "\xef\xbb\xbfYSGP\n--- [Metadata]\n<name>BOMTest\n</name>\n")
	h := detectYSGPHeader(path)
	if h == nil {
		t.Fatal("期望非 nil")
	}
	if h.Name != "BOMTest" {
		t.Errorf("Name = %q, 期望 BOMTest", h.Name)
	}
}

func TestDetectYSGPHeader_NotYSGP(t *testing.T) {
	path := writeTempFile(t, "NOTYSGP\n--- [Metadata]\n<name>Test</name>\n")
	h := detectYSGPHeader(path)
	if h != nil {
		t.Errorf("非 YSGP 应返回 nil, 得到 %+v", h)
	}
}

func TestDetectYSGPHeader_EmptyFile(t *testing.T) {
	path := writeTempFile(t, "")
	h := detectYSGPHeader(path)
	if h != nil {
		t.Errorf("空文件应返回 nil, 得到 %+v", h)
	}
}

func TestDetectYSGPHeader_NonExistent(t *testing.T) {
	h := detectYSGPHeader("/nonexistent/path.ysm")
	if h != nil {
		t.Errorf("不存在文件应返回 nil, 得到 %+v", h)
	}
}

func TestDetectYSGPHeader_NameInAuthorSection(t *testing.T) {
	// <name> 在 [Authors] 段内，不应被提取为模型名称
	path := writeTempFile(t, "YSGP\n--- [Authors]\n<name>AuthorName</name>\n")
	h := detectYSGPHeader(path)
	if h == nil {
		t.Fatal("期望非 nil")
	}
	if h.Name != "" {
		t.Errorf("Name 应为空（在 Authors 段内）, 得到 %q", h.Name)
	}
}

// ====== AnalyzeYSMHeader ======

func TestAnalyzeYSMHeader_YSGPWithTextHeader(t *testing.T) {
	// YSGP + 文本头部 → 合并二进制头部和文本头部信息
	path := writeTempFile(t, "YSGP\n--- [Metadata]\n<name>MergedModel</name>\n<license>MIT</license>\n--- [Authors]\n<name>Creator</name>\n<role>Modeler</role>\n===")
	h := AnalyzeYSMHeader(path)
	if !h.IsYSM {
		t.Error("IsYSM 应为 true")
	}
	if h.Name != "MergedModel" {
		t.Errorf("Name = %q, 期望 MergedModel", h.Name)
	}
	if h.License != "MIT" {
		t.Errorf("License = %q, 期望 MIT", h.License)
	}
	if h.AuthorName != "Creator" {
		t.Errorf("AuthorName = %q, 期望 Creator", h.AuthorName)
	}
	if h.AuthorRole != "Modeler" {
		t.Errorf("AuthorRole = %q, 期望 Modeler", h.AuthorRole)
	}
}

func TestAnalyzeYSMHeader_TextOnly(t *testing.T) {
	// 纯文本头部（无 YSGP 魔数）
	path := writeTempFile(t, "--- [Metadata]\n<name>TextOnly</name>\n<free>true</free>\n===")
	h := AnalyzeYSMHeader(path)
	if h.Name != "TextOnly" {
		t.Errorf("Name = %q, 期望 TextOnly", h.Name)
	}
	if !h.IsFree {
		t.Error("IsFree 应为 true")
	}
	if !h.HasFree {
		t.Error("HasFree 应为 true")
	}
}

func TestAnalyzeYSMHeader_NonExistent(t *testing.T) {
	h := AnalyzeYSMHeader("/nonexistent/file.ysm")
	if h.IsYSM {
		t.Error("不存在文件 IsYSM 应为 false")
	}
}

func TestAnalyzeYSMHeader_EmptyFile(t *testing.T) {
	path := writeTempFile(t, "")
	h := AnalyzeYSMHeader(path)
	if h.IsYSM {
		t.Error("空文件 IsYSM 应为 false")
	}
}

// ====== helpers ======

func writeTempFile(t *testing.T, content string) string {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, "test.ysm")
	if err := os.WriteFile(path, []byte(content), 0644); err != nil {
		t.Fatalf("failed to write temp file: %v", err)
	}
	return path
}
