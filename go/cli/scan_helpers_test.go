package cli

import (
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"ysm-model-manager/go/texture_cache"
)

// TestScanCacheVerify 覆盖 a0a1bb00 抽出的 scanCacheVerify：
// 扩展名分类、非贴图忽略、递归扫描、缓存命中与 cacheSize。
func TestScanCacheVerify(t *testing.T) {
	root := t.TempDir()
	withTempCache(t) // 重定向 texture_cache.CacheDir，t.Cleanup 自动恢复

	mustWrite(t, filepath.Join(root, "a.png"), []byte("png-bytes"))
	mustWrite(t, filepath.Join(root, "b.jpg"), []byte("jpg-bytes"))
	mustWrite(t, filepath.Join(root, "notes.txt"), []byte("ignored-not-texture"))
	if err := os.MkdirAll(filepath.Join(root, "sub"), 0o755); err != nil {
		t.Fatal(err)
	}
	mustWrite(t, filepath.Join(root, "sub", "c.tga"), []byte("tga-bytes"))

	infos, walkErrs, err := scanCacheVerify(root)
	if err != nil {
		t.Fatalf("scanCacheVerify error: %v", err)
	}
	if len(walkErrs) != 0 {
		t.Fatalf("unexpected walkErrors: %v", walkErrs)
	}

	byName := make(map[string]cacheVerifyTexInfo)
	for _, ti := range infos {
		byName[filepath.Base(ti.path)] = ti
	}

	// 非贴图扩展名应被忽略：仅 3 个贴图
	if len(infos) != 3 {
		t.Fatalf("期望 3 个贴图, 实际 %d: %v", len(infos), infos)
	}
	for _, name := range []string{"a.png", "b.jpg", "c.tga"} {
		ti, ok := byName[name]
		if !ok {
			t.Errorf("贴图 %s 未被扫描", name)
			continue
		}
		if ti.hash == "" || ti.hash == "ERROR" {
			t.Errorf("%s hash 异常: %q", name, ti.hash)
		}
		if ti.cached {
			t.Errorf("%s 空缓存下不应命中", name)
		}
	}
	if _, ok := byName["notes.txt"]; ok {
		t.Errorf("非贴图 notes.txt 不应出现在结果中")
	}

	// 缓存命中：预写 a.png 的哈希后重扫，应命中且 cacheSize 等于写入长度
	aPath := filepath.Join(root, "a.png")
	h, err := texture_cache.TextureHash(aPath)
	if err != nil {
		t.Fatalf("TextureHash: %v", err)
	}
	if err := texture_cache.WriteCached(h, []byte("ktx2-payload")); err != nil {
		t.Fatalf("WriteCached: %v", err)
	}
	infos2, _, _ := scanCacheVerify(root)
	for _, ti := range infos2 {
		if filepath.Base(ti.path) == "a.png" {
			if !ti.cached {
				t.Errorf("a.png 应命中缓存")
			}
			if ti.cacheSize != int64(len("ktx2-payload")) {
				t.Errorf("a.png cacheSize=%d, 期望 %d", ti.cacheSize, len("ktx2-payload"))
			}
		}
	}
}

// TestScanMMDAssets 覆盖 a0a1bb00 抽出的 scanMMDAssets：
// 扩展名聚合、大小累加、目录计数（WalkTotalDirs/WalkErrCount）。
func TestScanMMDAssets(t *testing.T) {
	root := t.TempDir()

	mustWrite(t, filepath.Join(root, "m1.pmx"), []byte("x"))
	mustWrite(t, filepath.Join(root, "m2.pmd"), []byte("yy"))
	mustWrite(t, filepath.Join(root, "v.vrm"), []byte("zzz"))
	mustWrite(t, filepath.Join(root, "a.vmd"), []byte("w"))
	mustWrite(t, filepath.Join(root, "p.vpd"), []byte("v"))
	mustWrite(t, filepath.Join(root, "t.png"), []byte("tt"))
	if err := os.MkdirAll(filepath.Join(root, "sub"), 0o755); err != nil {
		t.Fatal(err)
	}
	mustWrite(t, filepath.Join(root, "sub", "deep.pmx"), []byte("dd"))
	mustWrite(t, filepath.Join(root, "ignore.txt"), []byte("no"))

	s, err := scanMMDAssets(root)
	if err != nil {
		t.Fatalf("scanMMDAssets error: %v", err)
	}

	// 注意：scanMMDAssets 中 case ".pmx", ".pmd" 共享同一分支，
	// PmxFiles 字段语义实为"模型文件"（同时容纳 pmd）。
	pmxNames := make(map[string]bool)
	for _, p := range s.PmxFiles {
		pmxNames[filepath.Base(p)] = true
	}
	if len(s.PmxFiles) != 3 {
		t.Errorf("PmxFiles=%d, 期望 3 (m1.pmx + m2.pmd + sub/deep.pmx)", len(s.PmxFiles))
	}
	for _, want := range []string{"m1.pmx", "m2.pmd", "deep.pmx"} {
		if !pmxNames[want] {
			t.Errorf("PmxFiles 缺少 %s, 实际 %v", want, s.PmxFiles)
		}
	}
	if len(s.VrmFiles) != 1 {
		t.Errorf("VrmFiles=%d, 期望 1", len(s.VrmFiles))
	}
	if len(s.VmdFiles) != 1 {
		t.Errorf("VmdFiles=%d, 期望 1", len(s.VmdFiles))
	}
	if len(s.VpdFiles) != 1 {
		t.Errorf("VpdFiles=%d, 期望 1", len(s.VpdFiles))
	}
	if len(s.TextureFiles) != 1 || !strings.HasSuffix(s.TextureFiles[0], "t.png") {
		t.Errorf("TextureFiles=%v, 期望 [t.png]", s.TextureFiles)
	}

	// ModelSize = pmx(1)+pmd(2)+vrm(3)+sub/deep.pmx(2)=8; TextureSize = png(2)
	if s.ModelSize != 8 {
		t.Errorf("ModelSize=%d, 期望 8", s.ModelSize)
	}
	if s.TextureSize != 2 {
		t.Errorf("TextureSize=%d, 期望 2", s.TextureSize)
	}

	// 目录计数：根目录 + sub = 2；无不可访问路径
	if s.WalkTotalDirs != 2 {
		t.Errorf("WalkTotalDirs=%d, 期望 2", s.WalkTotalDirs)
	}
	if s.WalkErrCount != 0 {
		t.Errorf("WalkErrCount=%d, 期望 0", s.WalkErrCount)
	}
}

// TestExtractBulletSection 覆盖 a0a1bb00 拆出的纯文本段落解析 helper。
func TestExtractBulletSection(t *testing.T) {
	lines := []string{
		"# Title",
		"## Overview",
		"- item one",
		"- item two",
		"## Details",
		"- detail a",
	}
	if got := extractBulletSection(lines, "Overview"); !reflect.DeepEqual(got, []string{"item one", "item two"}) {
		t.Errorf("Overview: got %v", got)
	}
	if got := extractBulletSection(lines, "Missing"); len(got) != 0 {
		t.Errorf("Missing header 应返回空, 实际 %v", got)
	}
}

// TestExtractTableSection 覆盖 a0a1bb00 拆出的 md 表格解析 helper。
func TestExtractTableSection(t *testing.T) {
	lines := []string{
		"## Metrics",
		"| col0 | col1 | col2 | col3 | col4 |",
		"| --- | --- | --- | --- | --- |",
		"| a | b | c | d | e |",
		"| f | g | h | i | j |",
		"## End",
		"| skip | this | should | not | appear |",
	}
	want := []string{"a | b | c | d", "f | g | h | i"}
	if got := extractTableSection(lines, "Metrics"); !reflect.DeepEqual(got, want) {
		t.Errorf("Metrics table: got %v, want %v", got, want)
	}
}
