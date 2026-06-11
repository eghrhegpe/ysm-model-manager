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
