package sync

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"ysm-model-manager/go/fsutil"
)

// setupTestDirs 创建临时测试目录并返回 (localDir, remoteDir, cleanup)
func setupTestDirs(t *testing.T) (string, string, func()) {
	t.Helper()
	localDir, err := os.MkdirTemp("", "sync-conflict-local-*")
	if err != nil {
		t.Fatal(err)
	}
	remoteDir, err := os.MkdirTemp("", "sync-conflict-remote-*")
	if err != nil {
		os.RemoveAll(localDir)
		t.Fatal(err)
	}
	cleanup := func() {
		os.RemoveAll(localDir)
		os.RemoveAll(remoteDir)
	}
	return localDir, remoteDir, cleanup
}

// writeFile 写入文件并设置修改时间
func writeFile(t *testing.T, dir, name, content string, modTime time.Time) {
	t.Helper()
	path := filepath.Join(dir, name)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Chtimes(path, modTime, modTime); err != nil {
		t.Fatal(err)
	}
}

func TestDetectConflicts_NoConflicts(t *testing.T) {
	localDir, remoteDir, cleanup := setupTestDirs(t)
	defer cleanup()

	// 本地独有文件
	writeFile(t, localDir, "only_local.txt", "local content", time.Now())
	// 远端独有文件
	writeFile(t, remoteDir, "only_remote.txt", "remote content", time.Now())

	report, err := DetectConflicts(localDir, remoteDir, "test")
	if err != nil {
		t.Fatal(err)
	}
	if report.TotalConflicts != 0 {
		t.Errorf("期望 0 个冲突，实际 %d", report.TotalConflicts)
	}
}

func TestDetectConflicts_ContentConflict(t *testing.T) {
	localDir, remoteDir, cleanup := setupTestDirs(t)
	defer cleanup()

	// 同名但内容不同 → 内容冲突
	writeFile(t, localDir, "same_file.txt", "local version content", time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC))
	writeFile(t, remoteDir, "same_file.txt", "remote version content", time.Date(2024, 1, 2, 0, 0, 0, 0, time.UTC))

	report, err := DetectConflicts(localDir, remoteDir, "test")
	if err != nil {
		t.Fatal(err)
	}
	if report.TotalConflicts != 1 {
		t.Fatalf("期望 1 个冲突，实际 %d", report.TotalConflicts)
	}
	if report.Conflicts[0].Type != ConflictContentModified {
		t.Errorf("期望 content_modified 类型，实际 %s", report.Conflicts[0].Type)
	}
	if report.Conflicts[0].Path != "same_file.txt" {
		t.Errorf("期望 same_file.txt，实际 %s", report.Conflicts[0].Path)
	}
	// 远端更新 → 建议使用远端
	if report.Conflicts[0].SuggestedStrategy != ResolveForceRemote {
		t.Errorf("期望建议 force_remote，实际 %s", report.Conflicts[0].SuggestedStrategy)
	}
}

func TestDetectConflicts_SameContent_NoConflict(t *testing.T) {
	localDir, remoteDir, cleanup := setupTestDirs(t)
	defer cleanup()

	// 同名且内容相同 → 无冲突
	writeFile(t, localDir, "identical.txt", "same content", time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC))
	writeFile(t, remoteDir, "identical.txt", "same content", time.Date(2024, 1, 2, 0, 0, 0, 0, time.UTC))

	report, err := DetectConflicts(localDir, remoteDir, "test")
	if err != nil {
		t.Fatal(err)
	}
	if report.TotalConflicts != 0 {
		t.Errorf("相同内容期望 0 个冲突，实际 %d", report.TotalConflicts)
	}
}

func TestDetectConflicts_MultipleConflicts(t *testing.T) {
	localDir, remoteDir, cleanup := setupTestDirs(t)
	defer cleanup()

	// 多个冲突
	writeFile(t, localDir, "file1.txt", "local 1", time.Now())
	writeFile(t, remoteDir, "file1.txt", "remote 1", time.Now())
	writeFile(t, localDir, "sub/file2.txt", "local 2", time.Now())
	writeFile(t, remoteDir, "sub/file2.txt", "remote 2", time.Now())

	report, err := DetectConflicts(localDir, remoteDir, "test")
	if err != nil {
		t.Fatal(err)
	}
	if report.TotalConflicts != 2 {
		t.Fatalf("期望 2 个冲突，实际 %d", report.TotalConflicts)
	}
}

func TestDetectConflicts_EmptyDirs(t *testing.T) {
	localDir, remoteDir, cleanup := setupTestDirs(t)
	defer cleanup()

	report, err := DetectConflicts(localDir, remoteDir, "test")
	if err != nil {
		t.Fatal(err)
	}
	if report.TotalConflicts != 0 {
		t.Errorf("空目录期望 0 个冲突，实际 %d", report.TotalConflicts)
	}
}

func TestDetectConflicts_NonExistentDir(t *testing.T) {
	_, _, cleanup := setupTestDirs(t)
	defer cleanup()

	nonExistent := filepath.Join(os.TempDir(), "ysm-nonexistent-test-12345")
	_, err := DetectConflicts(nonExistent, nonExistent, "test")
	if err == nil {
		t.Error("期望错误，实际 nil")
	}
}

func TestResolveConflict_ForceRemote(t *testing.T) {
	localDir, remoteDir, cleanup := setupTestDirs(t)
	defer cleanup()

	writeFile(t, localDir, "test.txt", "local content", time.Now())
	writeFile(t, remoteDir, "test.txt", "remote content", time.Now())

	conflict := FileConflict{
		Path: "test.txt",
		Type: ConflictContentModified,
	}

	err := ResolveConflict(conflict, ResolveForceRemote, localDir, remoteDir)
	if err != nil {
		t.Fatal(err)
	}

	// 验证本地内容被远端覆盖
	content, err := os.ReadFile(filepath.Join(localDir, "test.txt"))
	if err != nil {
		t.Fatal(err)
	}
	if string(content) != "remote content" {
		t.Errorf("期望 'remote content'，实际 '%s'", string(content))
	}

	// 验证备份已清除
	if _, err := os.Stat(filepath.Join(localDir, "test.txt.bak")); !os.IsNotExist(err) {
		t.Error("备份文件应该已被删除")
	}
}

// TestResolveConflict_ForceRemote_CopyFail_LocalIntact 锁定失败路径契约：
// 远端拷贝失败（此处远端缺失）时，本地文件必须原样保留、.bak 不残留。
// ADR-044 收敛后由 fsutil.CopyFile 的原子 tmp+rename 统一保证——即使中途
// 失败也不会出现"半截目标"，回滚路径同样走原子拷贝。
func TestResolveConflict_ForceRemote_CopyFail_LocalIntact(t *testing.T) {
	localDir, remoteDir, cleanup := setupTestDirs(t)
	defer cleanup()

	writeFile(t, localDir, "test.txt", "local content", time.Now())
	// 远端故意不写 test.txt → 拷贝必然失败

	conflict := FileConflict{
		Path: "test.txt",
		Type: ConflictContentModified,
	}

	err := ResolveConflict(conflict, ResolveForceRemote, localDir, remoteDir)
	if err == nil {
		t.Fatal("远端缺失时应返回错误")
	}

	// 本地内容必须完好无损
	content, err := os.ReadFile(filepath.Join(localDir, "test.txt"))
	if err != nil {
		t.Fatal(err)
	}
	if string(content) != "local content" {
		t.Errorf("失败路径不得破坏本地文件：期望 'local content'，实际 '%s'", string(content))
	}

	// 回滚后备份应被清理
	if _, err := os.Stat(filepath.Join(localDir, "test.txt.bak")); !os.IsNotExist(err) {
		t.Error("失败回滚后备份文件应该已被删除")
	}
}

func TestResolveConflict_ForceLocal(t *testing.T) {
	localDir, remoteDir, cleanup := setupTestDirs(t)
	defer cleanup()

	writeFile(t, localDir, "test.txt", "local content", time.Now())
	writeFile(t, remoteDir, "test.txt", "remote content", time.Now())

	conflict := FileConflict{
		Path: "test.txt",
		Type: ConflictContentModified,
	}

	err := ResolveConflict(conflict, ResolveForceLocal, localDir, remoteDir)
	if err != nil {
		t.Fatal(err)
	}

	// 本地内容应保持不变
	content, err := os.ReadFile(filepath.Join(localDir, "test.txt"))
	if err != nil {
		t.Fatal(err)
	}
	if string(content) != "local content" {
		t.Errorf("期望 'local content'，实际 '%s'", string(content))
	}
}

func TestResolveConflict_Manual(t *testing.T) {
	localDir, remoteDir, cleanup := setupTestDirs(t)
	defer cleanup()

	conflict := FileConflict{
		Path: "test.txt",
		Type: ConflictContentModified,
	}

	err := ResolveConflict(conflict, ResolveManual, localDir, remoteDir)
	if err == nil {
		t.Error("Manual 策略应返回错误")
	}
}

func TestResolveConflict_UnknownStrategy(t *testing.T) {
	localDir, remoteDir, cleanup := setupTestDirs(t)
	defer cleanup()

	conflict := FileConflict{Path: "test.txt"}
	err := ResolveConflict(conflict, "unknown", localDir, remoteDir)
	if err == nil {
		t.Error("未知策略应返回错误")
	}
}

func TestResolveConflicts_Batch(t *testing.T) {
	localDir, remoteDir, cleanup := setupTestDirs(t)
	defer cleanup()

	writeFile(t, localDir, "c1.txt", "local 1", time.Now())
	writeFile(t, remoteDir, "c1.txt", "remote 1", time.Now())
	writeFile(t, localDir, "c2.txt", "local 2", time.Now())
	writeFile(t, remoteDir, "c2.txt", "remote 2", time.Now())

	conflicts := []FileConflict{
		{Path: "c1.txt", Type: ConflictContentModified, SuggestedStrategy: ResolveForceRemote},
		{Path: "c2.txt", Type: ConflictContentModified, SuggestedStrategy: ResolveForceLocal},
	}

	resolved, _, manual := ResolveConflicts(conflicts, ResolveForceRemote, localDir, remoteDir)
	if resolved != 2 {
		t.Errorf("期望 2 resolved，实际 %d", resolved)
	}
	if manual != 0 {
		t.Errorf("期望 0 manual，实际 %d", manual)
	}
}

func TestResolveConflicts_DefaultStrategyForManual(t *testing.T) {
	localDir, remoteDir, cleanup := setupTestDirs(t)
	defer cleanup()

	writeFile(t, localDir, "c1.txt", "local 1", time.Now())
	writeFile(t, remoteDir, "c1.txt", "remote 1", time.Now())

	conflicts := []FileConflict{
		{Path: "c1.txt", Type: ConflictContentModified, SuggestedStrategy: ResolveManual},
	}

	resolved, _, manual := ResolveConflicts(conflicts, ResolveForceRemote, localDir, remoteDir)
	if resolved != 1 {
		t.Errorf("Manual + default=force_remote 期望 1 resolved，实际 %d", resolved)
	}
	if manual != 0 {
		t.Errorf("期望 0 manual（已用 default 策略），实际 %d", manual)
	}
}

func TestSuggestStrategy(t *testing.T) {
	now := time.Now()
	past := now.Add(-1 * time.Hour)
	future := now.Add(1 * time.Hour)

	tests := []struct {
		localTime, remoteTime time.Time
		expected              ResolutionStrategy
	}{
		{future, past, ResolveForceLocal},  // 本地更新 → 保留本地
		{past, future, ResolveForceRemote}, // 远端更新 → 使用远端
		{now, now, ResolveManual},          // 时间相同 → 手动
	}

	for _, tt := range tests {
		result := suggestStrategy(tt.localTime, tt.remoteTime)
		if result != tt.expected {
			t.Errorf("suggestStrategy(%v, %v) = %s, 期望 %s",
				tt.localTime, tt.remoteTime, result, tt.expected)
		}
	}
}

func TestCollectFileEntries(t *testing.T) {
	dir, err := os.MkdirTemp("", "collect-test-*")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(dir)

	// 创建测试文件
	writeFile(t, dir, "file1.txt", "content 1", time.Now())
	writeFile(t, dir, "sub/file2.txt", "content 2", time.Now())

	entries, err := collectFileEntries(dir)
	if err != nil {
		t.Fatal(err)
	}

	if len(entries) != 2 {
		t.Errorf("期望 2 个文件，实际 %d", len(entries))
	}

	if _, ok := entries["file1.txt"]; !ok {
		t.Error("缺少 file1.txt")
	}
	if _, ok := entries["sub/file2.txt"]; !ok {
		t.Error("缺少 sub/file2.txt")
	}

	// 验证哈希非空
	for path, entry := range entries {
		if entry.Hash == "" {
			t.Errorf("%s 的哈希为空", path)
		}
	}
}

// TestSHA256File 验证 fsutil.SHA256File（conflict 曾私有 computeFileHash 薄封装，
// 收编直连后本测试改测底层原语：确定性 + 内容区分）
func TestSHA256File(t *testing.T) {
	dir, err := os.MkdirTemp("", "hash-test-*")
	if err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(dir)

	writeFile(t, dir, "test.txt", "hello world", time.Now())

	hash1, err := fsutil.SHA256File(filepath.Join(dir, "test.txt"))
	if err != nil {
		t.Fatal(err)
	}
	if hash1 == "" {
		t.Error("哈希不应为空")
	}

	// 相同内容应产生相同哈希
	writeFile(t, dir, "test2.txt", "hello world", time.Now())
	hash2, err := fsutil.SHA256File(filepath.Join(dir, "test2.txt"))
	if err != nil {
		t.Fatal(err)
	}
	if hash1 != hash2 {
		t.Error("相同内容应产生相同哈希")
	}

	// 不同内容应产生不同哈希
	writeFile(t, dir, "test3.txt", "different content", time.Now())
	hash3, err := fsutil.SHA256File(filepath.Join(dir, "test3.txt"))
	if err != nil {
		t.Fatal(err)
	}
	if hash1 == hash3 {
		t.Error("不同内容应产生不同哈希")
	}
}

// TestResolveConflict_PathTraversal_Rejected 钉住路径穿越守卫（2026-09-05 三路锐评
// P0/P1 新增防线，code_review 补测试）：
// conflict.Path 含 ".." 逃逸 localDir/remoteDir 时，必须在任何文件操作（备份/拷贝）
// 前被 RelInside 拒绝——否则恶意 ../ 路径可让 ResolveForceRemote 写到目录外。
func TestResolveConflict_PathTraversal_Rejected(t *testing.T) {
	localDir, remoteDir, cleanup := setupTestDirs(t)
	defer cleanup()

	// 在 localDir/remoteDir 之外放一个哨兵文件，验证守卫拒绝后它不被触碰
	outsideDir := t.TempDir()
	writeFile(t, outsideDir, "escape.bin", "must survive", time.Now())
	sentryPath := filepath.Join(outsideDir, "escape.bin")

	// 本地目录内正常文件（若守卫失效，会被当作备份/覆盖目标读取）
	writeFile(t, localDir, "test.txt", "local content", time.Now())
	writeFile(t, remoteDir, "test.txt", "remote content", time.Now())

	conflict := FileConflict{
		Path: filepath.Join("..", filepath.Base(outsideDir), "escape.bin"),
		Type: ConflictContentModified,
	}

	// 穿越路径必须被拒绝（三个策略都要过守卫，取最会写盘的 ForceRemote 验证）
	err := ResolveConflict(conflict, ResolveForceRemote, localDir, remoteDir)
	if err == nil {
		t.Fatal("穿越路径应当被守卫拒绝，实际返回 nil")
	}
	// 错误应含越界语境（而非文件操作失败）
	if !strings.Contains(err.Error(), "冲突路径越界") {
		t.Errorf("错误应指明越界守卫，实际: %v", err)
	}

	// 哨兵文件必须原样保留（守卫在文件操作前拦截）
	sentry, err := os.ReadFile(sentryPath)
	if err != nil {
		t.Fatalf("哨兵文件不应被触碰（读取失败: %v）", err)
	}
	if string(sentry) != "must survive" {
		t.Errorf("哨兵文件内容被改动: %q", string(sentry))
	}
}

// TestResolveConflict_PathTraversal_SafeSubpath 反向钉住：正常相对子路径不被守卫误杀
//（RelInside 判定合法 → 照常执行 ForceRemote 覆盖）。
func TestResolveConflict_PathTraversal_SafeSubpath(t *testing.T) {
	localDir, remoteDir, cleanup := setupTestDirs(t)
	defer cleanup()

	writeFile(t, localDir, "nested/test.txt", "local content", time.Now())
	writeFile(t, remoteDir, "nested/test.txt", "remote content", time.Now())

	conflict := FileConflict{
		Path: filepath.Join("nested", "test.txt"),
		Type: ConflictContentModified,
	}

	if err := ResolveConflict(conflict, ResolveForceRemote, localDir, remoteDir); err != nil {
		t.Fatalf("合法相对子路径不应被守卫拦截: %v", err)
	}
	content, err := os.ReadFile(filepath.Join(localDir, "nested", "test.txt"))
	if err != nil {
		t.Fatal(err)
	}
	if string(content) != "remote content" {
		t.Errorf("期望被远端覆盖为 'remote content'，实际 '%s'", string(content))
	}
}
