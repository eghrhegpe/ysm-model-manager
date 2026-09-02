package container

import (
	"testing"
	"unicode/utf8"

	"golang.org/x/text/encoding/japanese"
	"golang.org/x/text/encoding/simplifiedchinese"
	"golang.org/x/text/encoding/traditionalchinese"
	"golang.org/x/text/transform"
)

// mustEncode 用指定编码器编码字符串（测试辅助）；失败 panic。
func mustEncode(t *testing.T, enc transform.Transformer, s string) string {
	t.Helper()
	b, _, err := transform.String(enc, s)
	if err != nil {
		t.Fatalf("encode %q failed: %v", s, err)
	}
	return b
}

func TestNormalizeEntryName_UTF8Passthrough(t *testing.T) {
	// flag 未置 + 合法 UTF-8 → 原样返回
	got := normalizeEntryName("モデル/初音ミク.pmx", false)
	if got != "モデル/初音ミク.pmx" {
		t.Errorf("normalizeEntryName = %q, want %q", got, "モデル/初音ミク.pmx")
	}
	if got := normalizeEntryName("model.pmx", false); got != "model.pmx" {
		t.Errorf("normalizeEntryName = %q, want %q", got, "model.pmx")
	}
}

func TestNormalizeEntryName_GBK(t *testing.T) {
	// 中文文件名 GBK 字节 + NonUTF8 标志 → 解出原中文
	raw := mustEncode(t, simplifiedchinese.GBK.NewEncoder(), "[VUP]初音未来-焔色模型ver1.2.pmx")
	got := normalizeEntryName(raw, true)
	want := "[VUP]初音未来-焔色模型ver1.2.pmx"
	if got != want {
		t.Errorf("normalizeEntryName(gbk) = %q, want %q", got, want)
	}
	if !utf8.ValidString(got) {
		t.Errorf("结果应为合法 UTF-8，实际 %q", got)
	}
}

func TestNormalizeEntryName_ShiftJIS(t *testing.T) {
	// 日文文件名 Shift-JIS 字节（MMD 圈常见）
	raw := mustEncode(t, japanese.ShiftJIS.NewEncoder(), "初音ミク/model.pmx")
	got := normalizeEntryName(raw, true)
	if got != "初音ミク/model.pmx" {
		t.Errorf("normalizeEntryName(sjis) = %q, want %q", got, "初音ミク/model.pmx")
	}
}

func TestNormalizeEntryName_Big5(t *testing.T) {
	// 繁体中文文件名 Big5 字节（台湾作者常见）
	raw := mustEncode(t, traditionalchinese.Big5.NewEncoder(), "模型資料夾/model.pmx")
	got := normalizeEntryName(raw, true)
	if got != "模型資料夾/model.pmx" {
		t.Errorf("normalizeEntryName(big5) = %q, want %q", got, "模型資料夾/model.pmx")
	}
}

func TestNormalizeEntryName_FlagFalseButBadBytes(t *testing.T) {
	// flag 未置但字节非法 UTF-8（打包工具漏置 EFS 位的坏 zip）→ 仍走解码救援
	raw := mustEncode(t, simplifiedchinese.GBK.NewEncoder(), "模型.pmx")
	got := normalizeEntryName(raw, false)
	if got != "模型.pmx" {
		t.Errorf("normalizeEntryName(flag=false, gbk bytes) = %q, want %q", got, "模型.pmx")
	}
}

func TestNormalizeEntryName_ASCIIUnchanged(t *testing.T) {
	// NonUTF8 标志置位但内容纯 ASCII（SJIS/GBK 均为 ASCII 超集）→ 不应损坏
	if got := normalizeEntryName("model.pmx", true); got != "model.pmx" {
		t.Errorf("normalizeEntryName(ascii, flag=true) = %q, want %q", got, "model.pmx")
	}
}

func TestNormalizeEntryName_InvalidBytesNoPanic(t *testing.T) {
	// 完全无效的字节 → 不 panic、结果无 RuneError
	got := normalizeEntryName("\x80\x81\x82\xff", true)
	for _, r := range got {
		if r == utf8.RuneError {
			t.Errorf("无效字节解码后不应含 RuneError，实际 %q", got)
		}
	}
}

func TestNormalizeEntryName_Empty(t *testing.T) {
	if got := normalizeEntryName("", false); got != "" {
		t.Errorf("normalizeEntryName(empty) = %q, want empty", got)
	}
}

func TestNormalizeEntryName_ControlCharsRemoved(t *testing.T) {
	// 合法 UTF-8 但含控制字符 → 剔除（保留 \t \n \r）
	got := normalizeEntryName("a\x00b\x1Bc", false)
	if got != "abc" {
		t.Errorf("normalizeEntryName = %q, want %q", got, "abc")
	}
}
