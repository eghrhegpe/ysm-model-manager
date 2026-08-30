package fsutil

import (
	"errors"
	"strings"
	"testing"
)

func TestDecodeBase64Limited_OK(t *testing.T) {
	data, err := DecodeBase64Limited("aGVsbG8=", 100) // "hello"
	if err != nil {
		t.Fatalf("合法输入不应报错: %v", err)
	}
	if string(data) != "hello" {
		t.Fatalf("解码结果不符: %q", data)
	}
}

func TestDecodeBase64Limited_PrecheckRejects(t *testing.T) {
	// 8MB 的 'a' base64 → 解码后约 6MB，max=1KB 应被预检拒绝且不产出解码数据
	big := strings.Repeat("a", 8<<20)
	_, err := DecodeBase64Limited(big, 1024)
	if !errors.Is(err, ErrB64TooLarge) {
		t.Fatalf("预检应返回 ErrB64TooLarge, got %v", err)
	}
}

func TestDecodeBase64Limited_PostcheckRejects(t *testing.T) {
	// 小输入但复检兜底：max=2，"aGVsbG8=" 解码为 5 字节 → 复检拒绝
	_, err := DecodeBase64Limited("aGVsbG8=", 2)
	if !errors.Is(err, ErrB64TooLarge) {
		t.Fatalf("复检应返回 ErrB64TooLarge, got %v", err)
	}
}

func TestDecodeBase64Limited_InvalidBase64(t *testing.T) {
	if _, err := DecodeBase64Limited("!!!", 100); err == nil || errors.Is(err, ErrB64TooLarge) {
		t.Fatalf("非法 base64 应返回解码错误, got %v", err)
	}
}

func TestDecodeBase64Limited_NoLimit(t *testing.T) {
	if _, err := DecodeBase64Limited("aGVsbG8=", 0); err != nil {
		t.Fatalf("max<=0 应跳过大小限制: %v", err)
	}
}
