// ===== go/litematic 单测（覆盖率补全）=====
package litematic

import (
	"bytes"
	"compress/gzip"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// ===== 最小 NBT 构造 helper =====

// nbtTag 构造带名称前缀的 NBT 标签（type + u16 name 长度 + name + body）。
// 统一各 nbt* helper 的「type+name 前缀」样板。
func nbtTag(tagType byte, name string, body []byte) []byte {
	b := []byte{tagType}
	b = append(b, byte(len(name)>>8), byte(len(name)))
	b = append(b, name...)
	return append(b, body...)
}

func nbtString(name, value string) []byte {
	v := []byte{byte(len(value) >> 8), byte(len(value))}
	v = append(v, value...)
	return nbtTag(0x08, name, v) // TAG_String
}

func nbtInt(name string, v int32) []byte {
	body := []byte{byte(v >> 24), byte(v >> 16), byte(v >> 8), byte(v)}
	return nbtTag(0x03, name, body) // TAG_Int
}

func nbtCompound(name string, children ...[]byte) []byte {
	return nbtTag(0x0A, name, nbtCompoundBody(children...)) // TAG_Compound
}

// makeLitematicGz 构造最小 litematic（gzip 压缩 NBT，root 含 Metadata）
func makeLitematicGz(t *testing.T, version int32, extraRootTags ...[]byte) []byte {
	t.Helper()
	metadata := nbtCompound("Metadata",
		nbtString("Name", "test_projection"),
		nbtString("Author", "authorA"),
		nbtInt("TotalBlocks", 42),
		nbtInt("TotalVolume", 100),
		nbtCompound("EnclosingSize",
			nbtInt("x", 16), nbtInt("y", 16), nbtInt("z", 16),
		),
	)
	root := nbtCompound("",
		nbtInt("Version", version),
		metadata,
	)
	for _, tag := range extraRootTags {
		root = append(root, tag...)
	}
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	if _, err := gz.Write(root); err != nil {
		t.Fatal(err)
	}
	if err := gz.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

// ===== 测试 =====

func TestParseMeta_Success(t *testing.T) {
	path := filepath.Join(t.TempDir(), "test.litematic")
	if err := os.WriteFile(path, makeLitematicGz(t, 5), 0644); err != nil {
		t.Fatal(err)
	}
	meta, err := ParseMeta(path)
	if err != nil {
		t.Fatalf("ParseMeta 失败: %v", err)
	}
	if meta.Name != "test_projection" || meta.Author != "authorA" {
		t.Errorf("元数据错误: Name=%q Author=%q", meta.Name, meta.Author)
	}
	if meta.TotalBlocks != 42 || meta.TotalVolume != 100 {
		t.Errorf("统计错误: TotalBlocks=%d TotalVolume=%d", meta.TotalBlocks, meta.TotalVolume)
	}
	if meta.EnclosingSize != [3]int{16, 16, 16} {
		t.Errorf("尺寸错误: got %v", meta.EnclosingSize)
	}
	if meta.Version != 5 {
		t.Errorf("Version 字段应为 5, got %d", meta.Version)
	}
}

func TestParseMeta_Errors(t *testing.T) {
	tests := []struct {
		name            string
		makeFile        func(t *testing.T, path string)
		wantErrContains string
	}{
		{
			name: "非 gzip 数据",
			makeFile: func(t *testing.T, path string) {
				if err := os.WriteFile(path, []byte("notgzip"), 0644); err != nil {
					t.Fatal(err)
				}
			},
			wantErrContains: "",
		},
		{
			name: "缺 Metadata compound",
			makeFile: func(t *testing.T, path string) {
				root := nbtCompound("", nbtInt("Version", 5))
				var buf bytes.Buffer
				gz := gzip.NewWriter(&buf)
				gz.Write(root)
				gz.Close()
				if err := os.WriteFile(path, buf.Bytes(), 0644); err != nil {
					t.Fatal(err)
				}
			},
			wantErrContains: "Metadata",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "test.litematic")
			tt.makeFile(t, path)
			_, err := ParseMeta(path)
			if err == nil {
				t.Fatal("应报错")
			}
			if tt.wantErrContains != "" && !strings.Contains(err.Error(), tt.wantErrContains) {
				t.Errorf("错误信息应包含 %q, got: %v", tt.wantErrContains, err)
			}
		})
	}

	// 文件不存在
	if _, err := ParseMeta(filepath.Join(t.TempDir(), "nope.litematic")); err == nil {
		t.Fatal("不存在文件应报错")
	}
}

// TestParseMeta_VersionField 验证 Version 字段被正确读取
func TestParseMeta_VersionField(t *testing.T) {
	tests := []struct {
		version int32
	}{
		{version: 5},
		{version: 99},
		{version: 0},
	}
	for _, tt := range tests {
		t.Run("", func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "test.litematic")
			if err := os.WriteFile(path, makeLitematicGz(t, tt.version), 0644); err != nil {
				t.Fatal(err)
			}
			meta, err := ParseMeta(path)
			if err != nil {
				t.Fatalf("ParseMeta 失败: %v", err)
			}
			if int(meta.Version) != int(tt.version) {
				t.Errorf("Version 应为 %d, got %d", tt.version, meta.Version)
			}
		})
	}
}

// TestParseMeta_EnclosingSizePartial 验证 EnclosingSize 缺子字段时的行为
func TestParseMeta_EnclosingSizePartial(t *testing.T) {
	// 只含 x/y，缺 z
	root := nbtCompound("",
		nbtInt("Version", 5),
		nbtCompound("Metadata",
			nbtString("Name", "test"),
			nbtCompound("EnclosingSize",
				nbtInt("x", 10),
				nbtInt("y", 10),
				// z 缺失
			),
		),
	)
	var buf bytes.Buffer
	gz := gzip.NewWriter(&buf)
	gz.Write(root)
	gz.Close()

	path := filepath.Join(t.TempDir(), "test.litematic")
	if err := os.WriteFile(path, buf.Bytes(), 0644); err != nil {
		t.Fatal(err)
	}

	meta, err := ParseMeta(path)
	if err != nil {
		t.Fatalf("ParseMeta 失败: %v", err)
	}
	// z 缺失时应为 0（Go 零值）
	if meta.EnclosingSize[2] != 0 {
		t.Errorf("缺失的 z 应为 0, got %d", meta.EnclosingSize[2])
	}
}
