package dedup

import (
	"os"
	"path/filepath"
	"testing"

	"ysm-model-manager/go/types"
)

func TestNewHashStrategy_Default(t *testing.T) {
	algo := NewHashAlgorithm(nil)
	if algo.Name() != "deep_hash" {
		t.Errorf("期望 deep_hash，实际 %s", algo.Name())
	}
}

func TestNewHashStrategy_DeepHash(t *testing.T) {
	cfg := &types.DedupConfig{Strategy: "deep_hash"}
	algo := NewHashAlgorithm(cfg)
	if algo.Name() != "deep_hash" {
		t.Errorf("期望 deep_hash，实际 %s", algo.Name())
	}
}

func TestNewHashStrategy_QuickHash(t *testing.T) {
	cfg := &types.DedupConfig{Strategy: "quick_hash"}
	algo := NewHashAlgorithm(cfg)
	if algo.Name() != "quick_hash" {
		t.Errorf("期望 quick_hash，实际 %s", algo.Name())
	}
}

func TestNewHashStrategy_NameSizeHash(t *testing.T) {
	cfg := &types.DedupConfig{Strategy: "name_size"}
	algo := NewHashAlgorithm(cfg)
	if algo.Name() != "name_size" {
		t.Errorf("期望 name_size，实际 %s", algo.Name())
	}
}

func TestNewHashStrategy_UnknownFallback(t *testing.T) {
	cfg := &types.DedupConfig{Strategy: "unknown_strategy"}
	algo := NewHashAlgorithm(cfg)
	if algo.Name() != "deep_hash" {
		t.Errorf("未知策略应回退到 deep_hash，实际 %s", algo.Name())
	}
}

func TestDeepHash_ComputeHash(t *testing.T) {
	dir, err := os.MkdirTemp("", "deep-hash-test-*")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(dir)

	path := filepath.Join(dir, "test.txt")
	if err := os.WriteFile(path, []byte("hello world"), 0o644); err != nil {
		t.Fatal(err)
	}

	dh := &DeepHash{}
	hash1, err := dh.ComputeHash(path)
	if err != nil {
		t.Fatal(err)
	}
	if hash1 == "" {
		t.Error("哈希不应为空")
	}

	// 相同内容应产生相同哈希
	path2 := filepath.Join(dir, "test2.txt")
	if err := os.WriteFile(path2, []byte("hello world"), 0o644); err != nil {
		t.Fatal(err)
	}
	hash2, err := dh.ComputeHash(path2)
	if err != nil {
		t.Fatal(err)
	}
	if hash1 != hash2 {
		t.Error("相同内容应产生相同哈希")
	}

	// 不同内容应产生不同哈希
	path3 := filepath.Join(dir, "test3.txt")
	if err := os.WriteFile(path3, []byte("different"), 0o644); err != nil {
		t.Fatal(err)
	}
	hash3, err := dh.ComputeHash(path3)
	if err != nil {
		t.Fatal(err)
	}
	if hash1 == hash3 {
		t.Error("不同内容应产生不同哈希")
	}
}

func TestQuickHash_ComputeHash(t *testing.T) {
	dir, err := os.MkdirTemp("", "quick-hash-test-*")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(dir)

	path := filepath.Join(dir, "test.txt")
	if err := os.WriteFile(path, []byte("hello world"), 0o644); err != nil {
		t.Fatal(err)
	}

	qh := &QuickHash{}
	hash, err := qh.ComputeHash(path)
	if err != nil {
		t.Fatal(err)
	}
	if hash == "" {
		t.Error("哈希不应为空")
	}
}

func TestNameSizeHash_ComputeHash(t *testing.T) {
	dir, err := os.MkdirTemp("", "name-size-hash-test-*")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(dir)

	path := filepath.Join(dir, "test.txt")
	content := "hello world"
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}

	nsh := &NameSizeHash{}
	hash, err := nsh.ComputeHash(path)
	if err != nil {
		t.Fatal(err)
	}
	if hash == "" {
		t.Error("哈希不应为空")
	}

	// 验证哈希包含文件名和大小
	// NameSizeHash uses fmt.Sprintf("%s_%d", name, info.Size())
	expectedHash := "test.txt_" + itoa(int64(len(content)))
	if hash != expectedHash {
		t.Fatalf("NameSizeHash 期望 %s, 实际 %s", expectedHash, hash)
	}
}

// itoa 辅助函数：int64 转字符串
func itoa(v int64) string {
	if v == 0 {
		return "0"
	}
	neg := v < 0
	if neg {
		v = -v
	}
	var buf [20]byte
	i := len(buf)
	for v > 0 {
		i--
		buf[i] = byte(v%10) + '0'
		v /= 10
	}
	if neg {
		i--
		buf[i] = '-'
	}
	return string(buf[i:])
}

func TestHashAlgorithm_FileNotFound(t *testing.T) {
	dh := &DeepHash{}
	_, err := dh.ComputeHash("/nonexistent/file.txt")
	if err == nil {
		t.Error("期望文件不存在错误")
	}

	qh := &QuickHash{}
	_, err = qh.ComputeHash("/nonexistent/file.txt")
	if err == nil {
		t.Error("期望文件不存在错误")
	}

	nsh := &NameSizeHash{}
	_, err = nsh.ComputeHash("/nonexistent/file.txt")
	if err == nil {
		t.Error("期望文件不存在错误")
	}
}

func TestFindDuplicateFiles_WithConfig(t *testing.T) {
	dir, err := os.MkdirTemp("", "dedup-config-test-*")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(dir)

	// 创建重复文件
	writeTestFile(t, dir, "a.txt", "same content")
	writeTestFile(t, dir, "b.txt", "same content")
	writeTestFile(t, dir, "c.txt", "different content")

	// 使用默认配置（DeepHash）找重复
	cfg := &types.DedupConfig{Strategy: "deep_hash"}
	groups, err := FindDuplicateFiles(dir, false, cfg)
	if err != nil {
		t.Fatal(err)
	}
	if len(groups) != 1 {
		t.Errorf("期望 1 组重复，实际 %d", len(groups))
	}
	if len(groups) > 0 && len(groups[0].Files) != 2 {
		t.Errorf("期望 2 个文件在组内，实际 %d", len(groups[0].Files))
	}

	// 使用 QuickHash 也应找到相同重复
	cfg2 := &types.DedupConfig{Strategy: "quick_hash"}
	groups2, err := FindDuplicateFiles(dir, false, cfg2)
	if err != nil {
		t.Fatal(err)
	}
	if len(groups2) != 1 {
		t.Errorf("QuickHash 期望 1 组重复，实际 %d", len(groups2))
	}
}

func TestFindDuplicateFiles_DefaultConfig(t *testing.T) {
	dir, err := os.MkdirTemp("", "dedup-default-test-*")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(dir)

	writeTestFile(t, dir, "a.txt", "same")
	writeTestFile(t, dir, "b.txt", "same")

	// 不传配置，应使用默认 DeepHash
	groups, err := FindDuplicateFiles(dir, false)
	if err != nil {
		t.Fatal(err)
	}
	if len(groups) != 1 {
		t.Errorf("默认配置期望 1 组重复，实际 %d", len(groups))
	}
}

func TestFindDuplicateFiles_NameSizeStrategy(t *testing.T) {
	dir, err := os.MkdirTemp("", "dedup-namesize-test-*")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(dir)

	// 不同文件名但相同大小 → NameSizeHash 策略下不会被判定为重复
	writeTestFile(t, dir, "aaa.txt", "123")
	writeTestFile(t, dir, "bbb.txt", "123")

	cfg := &types.DedupConfig{Strategy: "name_size"}
	groups, err := FindDuplicateFiles(dir, false, cfg)
	if err != nil {
		t.Fatal(err)
	}
	// NameSizeHash 基于文件名+大小，不同文件名不会被判定为重复
	if len(groups) != 0 {
		t.Fatalf("NameSizeHash: 不同文件名+相同大小期望 0 组重复，实际 %d 组（内容相同不影响 name_size 策略）", len(groups))
	}

	// 相同文件名 + 相同大小 → 应判定为重复
	dir2, _ := os.MkdirTemp("", "dedup-namesize-test2-*")
	defer os.RemoveAll(dir2)
	writeTestFile(t, dir2, "same.txt", "same content size")
	writeTestFile(t, dir2, "same.txt", "same content size") // 同名文件（覆盖）
	// 实际上同名文件会被覆盖，所以创建不同名但同大小的
	writeTestFile(t, dir2, "x.txt", "test content")
	writeTestFile(t, dir2, "y.txt", "test content")

	groups2, err := FindDuplicateFiles(dir2, false, cfg)
	if err != nil {
		t.Fatal(err)
	}
	// NameSizeHash: x.txt_test content vs y.txt_test content → 不同 hash（文件名不同）
	if len(groups2) != 0 {
		t.Fatalf("NameSizeHash: 不同文件名相同内容期望 0 组，实际 %d 组（name_size 基于文件名+大小，不同名应不同 hash）", len(groups2))
	}
}

func TestCountDuplicates_WithConfig(t *testing.T) {
	dir, err := os.MkdirTemp("", "count-config-test-*")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(dir)

	writeTestFile(t, dir, "a.txt", "dup content")
	writeTestFile(t, dir, "b.txt", "dup content")
	writeTestFile(t, dir, "c.txt", "unique")

	cfg := &types.DedupConfig{Strategy: "deep_hash"}
	groups, extra, err := CountDuplicates(dir, false, cfg)
	if err != nil {
		t.Fatal(err)
	}
	if groups != 1 {
		t.Errorf("期望 1 组，实际 %d", groups)
	}
	if extra != 1 {
		t.Errorf("期望 1 个额外文件，实际 %d", extra)
	}
}

// writeTestFile 辅助函数
func writeTestFile(t *testing.T, dir, name, content string) {
	t.Helper()
	path := filepath.Join(dir, name)
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}
