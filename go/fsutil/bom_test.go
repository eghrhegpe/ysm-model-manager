// ===== fsutil.StripBOM 直测（UTF-8 BOM 剥离为多包共享基础设施，
// 7 处手写字面量收敛至此，回归风险高）=====
package fsutil

import (
	"bytes"
	"testing"
)

func TestStripBOM_RemovesBOM(t *testing.T) {
	data := []byte{0xEF, 0xBB, 0xBF, 'h', 'e', 'l', 'l', 'o'}
	got := StripBOM(data)
	expected := []byte("hello")
	if !bytes.Equal(got, expected) {
		t.Errorf("StripBOM(BOM+hello) = %q, 期望 %q", got, expected)
	}
}

func TestStripBOM_NoBOM(t *testing.T) {
	data := []byte("hello")
	got := StripBOM(data)
	if !bytes.Equal(got, data) {
		t.Errorf("StripBOM(hello) = %q, 期望 %q", got, data)
	}
}

func TestStripBOM_Empty(t *testing.T) {
	got := StripBOM([]byte{})
	if len(got) != 0 {
		t.Errorf("StripBOM(empty) = %q, 期望空", got)
	}
}

func TestStripBOM_Nil(t *testing.T) {
	got := StripBOM(nil)
	if got != nil {
		t.Errorf("StripBOM(nil) = %q, 期望 nil", got)
	}
}

func TestStripBOM_PartialBOM(t *testing.T) {
	// 只有 EF BB（缺 BF）不应被剥离
	data := []byte{0xEF, 0xBB, 'h', 'e', 'l', 'l', 'o'}
	got := StripBOM(data)
	if !bytes.Equal(got, data) {
		t.Errorf("StripBOM(部分BOM) 不应剥离，实际 %q", got)
	}
}

func TestStripBOM_BOMOnly(t *testing.T) {
	data := []byte{0xEF, 0xBB, 0xBF}
	got := StripBOM(data)
	if len(got) != 0 {
		t.Errorf("StripBOM(纯BOM) = %q, 期望空", got)
	}
}

func TestUTF8BOM_Value(t *testing.T) {
	expected := []byte{0xEF, 0xBB, 0xBF}
	if !bytes.Equal(UTF8BOM, expected) {
		t.Errorf("UTF8BOM = %v, 期望 %v", UTF8BOM, expected)
	}
}
