package dedup

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"
)

// Bug 1 (HIGH): filepath.WalkDir follows symlinked subdirectories.
// Only the root-level symlink is blocked. If a symlinked directory exists
// INSIDE the walk tree, WalkDir may descend into it and hash files outside
// the intended scope.
func TestAdversarial_SymlinkSubdirEscape(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux only")
		return
	}

	// 1) Create a "secret" directory OUTSIDE the scan root
	secretDir, err := os.MkdirTemp("", "secret")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(secretDir)

	secretFile := filepath.Join(secretDir, "secret.txt")
	if err := os.WriteFile(secretFile, []byte("SECRET_CONTENT_12345"), 0644); err != nil {
		t.Fatal(err)
	}

	// 2) Create the scan root
	scanDir, err := os.MkdirTemp("", "scan")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(scanDir)

	// 3) Create a symlink inside scanDir -> secretDir
	symlinkPath := filepath.Join(scanDir, "subdir")
	if err := os.Symlink(secretDir, symlinkPath); err != nil {
		t.Fatal(err)
	}

	// 4) Scan — if WalkDir follows the symlinked subdir, secret.txt appears
	groups, err := FindDuplicateFiles(scanDir, false)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// 5) Check whether the file outside scanDir was hashed
	for _, g := range groups {
		for _, f := range g.Files {
			cleanResult := filepath.Clean(f.Path)
			cleanTarget := filepath.Clean(secretFile)
			if cleanResult == cleanTarget {
				t.Fatalf("BUG-1 CONFIRMED: symlinked subdirectory was followed. "+
					"File at %s was hashed despite being outside scan root.", secretFile)
			}
		}
	}
}

// Bug 2 (MEDIUM): Relative path traversal — FindDuplicateFiles("..", false)
// resolves to the parent of CWD and walks it without restriction.
// 已修复（resolveScanRoot）：相对路径一律拒绝，返回 ErrRelativePath
// （调用方 CLI/GUI 均传绝对路径，dedup 层是最后一道防线）。
func TestAdversarial_RelativePathTraversal(t *testing.T) {
	// 相对路径 ".." 指向父目录——这是真实安全隐患；
	// 守卫必须显式返回 ErrRelativePath（errors.Is 可分类，禁文本匹配）。
	_, err := FindDuplicateFiles("..", false)
	if !errors.Is(err, ErrRelativePath) {
		t.Fatalf("BUG-2: FindDuplicateFiles(\"..\") 应返回 ErrRelativePath（相对路径穿越未防护），got: %v", err)
	}
}

// Bug 3 (MEDIUM): NUL byte injection in the path argument.
// Windows 下 filepath.Abs 拒 NUL，Linux 下 Abs 放行（放行后 WalkDir→Lstat
// 失败被 log-and-skip 吞掉 = 假绿）——resolveScanRoot 已在入口统一显式拒绝，
// 行为跨平台一致，不再需要平台分支。
func TestAdversarial_NULByteInPath(t *testing.T) {
	validDir, err := os.MkdirTemp("", "nul-test")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(validDir)

	// Inject NUL byte after the valid prefix
	badPath := validDir + "\x00" + "dir"

	if _, err := FindDuplicateFiles(badPath, false); err == nil {
		t.Fatalf("BUG-3: NUL 字节路径未被拒绝——调用方可扫描非预期路径（路径混淆）")
	}
}

// Bug 5 (INFO): Massive directory hashing performance.
// Not a bug — measures how long FindDuplicateFiles takes with many duplicate files.
func TestAdversarial_MassiveDirectoryPerformance(t *testing.T) {
	dir, err := os.MkdirTemp("", "perf")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(dir)

	const numFiles = 100
	content := []byte("duplicate content used for performance measurement\n")

	// Create numFiles identical files
	for i := 0; i < numFiles; i++ {
		fn := filepath.Join(dir, fmt.Sprintf("file_%04d.txt", i))
		if err := os.WriteFile(fn, content, 0644); err != nil {
			t.Fatal(err)
		}
	}

	start := time.Now()
	groups, err := FindDuplicateFiles(dir, false)
	elapsed := time.Since(start)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	t.Logf("FindDuplicateFiles on %d files: %d groups in %v", numFiles, len(groups), elapsed)
}

// Bug 6: Verify that empty files are skipped (not hashed, not in results).
// Non-empty files are hashed as expected.
func TestAdversarial_EmptyFileSkip(t *testing.T) {
	dir, err := os.MkdirTemp("", "empty-skip")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(dir)

	// Create an empty file
	emptyFile := filepath.Join(dir, "empty.txt")
	if err := os.WriteFile(emptyFile, []byte{}, 0644); err != nil {
		t.Fatal(err)
	}

	// Create a non-empty file
	nonEmptyFile := filepath.Join(dir, "data.txt")
	if err := os.WriteFile(nonEmptyFile, []byte("hello"), 0644); err != nil {
		t.Fatal(err)
	}

	groups, err := FindDuplicateFiles(dir, false)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	// No duplicates expected (only 1 non-empty file), but verify empty file
	// is NOT referenced anywhere in the results
	for _, g := range groups {
		for _, f := range g.Files {
			if filepath.Clean(f.Path) == filepath.Clean(emptyFile) {
				t.Fatalf("BUG-6 CONFIRMED: empty file %s appeared in results — "+
					"empty files must be skipped", emptyFile)
			}
		}
	}

	// Also verify with CountDuplicates
	groupsCount, extraCount, err := CountDuplicates(dir, false)
	if err != nil {
		t.Fatalf("unexpected error from CountDuplicates: %v", err)
	}
	if groupsCount != 0 || extraCount != 0 {
		t.Fatalf("expected 0 groups, 0 extra from single non-empty file, got %d groups, %d extra",
			groupsCount, extraCount)
	}
}
