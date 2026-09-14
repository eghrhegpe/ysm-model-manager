package cli

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// mmd_test.go — MMD 资产扫描的入口结论可信度。
// 根目录不存在时 filepath.Walk 仅回调一次错误即返回 nil，上层错误率
// 恒为 100%，把「路径写错」误报成「系统性问题：错误率过高」。

func TestScanMMDAssets_MissingRoot(t *testing.T) {
	missing := filepath.Join(t.TempDir(), "no-such-dir")

	scan, err := scanMMDAssets(missing)
	if err == nil {
		t.Fatalf("根目录不存在时应返回错误, got scan=%+v", scan)
	}
	if scan != nil {
		t.Errorf("出错时不应返回部分结果, got %+v", scan)
	}
	if !strings.Contains(err.Error(), "不存在或无法访问") {
		t.Errorf("错误应指出目录不存在/不可访问, got: %v", err)
	}
	// 关键：不得是「错误率过高」这类误导性结论
	if strings.Contains(err.Error(), "错误率") {
		t.Errorf("不得把路径不存在误报成错误率过高: %v", err)
	}
}

func TestScanMMDAssets_RootIsFile(t *testing.T) {
	f := filepath.Join(t.TempDir(), "a.pmx")
	if err := os.WriteFile(f, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}

	if _, err := scanMMDAssets(f); err == nil || !strings.Contains(err.Error(), "不是目录") {
		t.Errorf("期望「路径不是目录」错误, got: %v", err)
	}
}

// TestScanMMDAssets_HappyPath：正常目录仍能按扩展名聚合（防入口校验误伤）。
func TestScanMMDAssets_HappyPath(t *testing.T) {
	root := t.TempDir()
	for _, n := range []string{"m.pmx", "a.vmd", "t.png", "x.txt"} {
		if err := os.WriteFile(filepath.Join(root, n), []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
	}

	scan, err := scanMMDAssets(root)
	if err != nil {
		t.Fatalf("scanMMDAssets: %v", err)
	}
	if len(scan.ModelFiles) != 1 || len(scan.VmdFiles) != 1 || len(scan.TextureFiles) != 1 {
		t.Errorf("分类聚合异常: model=%d vmd=%d tex=%d",
			len(scan.ModelFiles), len(scan.VmdFiles), len(scan.TextureFiles))
	}
	if scan.WalkErrCount != 0 {
		t.Errorf("正常目录不应有扫描错误, got %d", scan.WalkErrCount)
	}
}
