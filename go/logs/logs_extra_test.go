// ===== go/logs 补充单测（P4 补测：NewLogger/load/save/cleanupStaleCorrupt/addOp 热点全覆盖）=====
package logs

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"ysm-model-manager/go/types"
)

// ====== NewLogger ======

// TestLogger_NewLogger_EmptyConfigDir configDir=="" 应返回内存态 logger（save no-op）
func TestLogger_NewLogger_EmptyConfigDir(t *testing.T) {
	l := NewLogger("")
	if l == nil {
		t.Fatal("NewLogger(\"\") 应返回非 nil")
	}
	if l.path != "" {
		t.Errorf("内存态 logger 的 path 应为空, got %q", l.path)
	}
	l.Add("模型A", "/s", "/d", 0, "成功", "") // 不 panic
	if got := l.GetAll(); len(got) != 1 {
		t.Errorf("内存态 Add 后应 1 条, got %d", len(got))
	}
}

// TestLogger_NewLogger_MkdirFail 配置目录创建失败应降级为内存态 logger（不落盘不 panic）
func TestLogger_NewLogger_MkdirFail(t *testing.T) {
	base := t.TempDir()
	blocker := filepath.Join(base, "file")
	if err := os.WriteFile(blocker, []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}
	l := NewLogger(filepath.Join(blocker, "sub")) // blocker 是文件 → MkdirAll 失败
	if l.path != "" {
		t.Errorf("MkdirAll 失败后应降级为内存态, path = %q", l.path)
	}
	if got := l.GetAll(); len(got) != 0 {
		t.Errorf("内存态初始应无日志, got %d", len(got))
	}
	l.Add("x", "s", "d", 0, "ok", "") // 不 panic
}

// ====== load ======

// TestLogger_Load_ReadErrorBackup 读取失败（非 NotExist，如路径是目录）应备份 .corrupt 再置空
func TestLogger_Load_ReadErrorBackup(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "logs.json")
	if err := os.MkdirAll(path, 0755); err != nil { // 目录占位 → ReadFile 报非 NotExist 错误
		t.Fatal(err)
	}
	l := &Logger{path: path}
	l.load()
	if _, err := os.Stat(path + corruptSuffix); err != nil {
		t.Fatalf("读失败后应备份为 .corrupt: %v", err)
	}
	if got := l.GetAll(); len(got) != 0 {
		t.Errorf("读失败后日志应为空, got %d", len(got))
	}
}

// TestLogger_Load_ReadErrorBackupRenameFail 备份目标被占用（非空目录）时仅记录不崩溃
func TestLogger_Load_ReadErrorBackupRenameFail(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "logs.json")
	if err := os.MkdirAll(path, 0755); err != nil {
		t.Fatal(err)
	}
	corrupt := path + corruptSuffix
	if err := os.MkdirAll(corrupt, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(corrupt, "x"), []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}
	l := &Logger{path: path}
	l.load() // Rename 失败仅记日志
	if got := l.GetAll(); len(got) != 0 {
		t.Errorf("读失败后日志应为空, got %d", len(got))
	}
	if _, err := os.Stat(corrupt); err != nil {
		t.Fatalf("占用中的 .corrupt 不应被破坏: %v", err)
	}
}

// TestLogger_Load_CorruptJSONBackupRenameFail 损坏 JSON 备份失败（目标占用）仅记录不崩溃
func TestLogger_Load_CorruptJSONBackupRenameFail(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "logs.json")
	if err := os.WriteFile(path, []byte("{invalid json"), 0644); err != nil {
		t.Fatal(err)
	}
	corrupt := path + corruptSuffix
	if err := os.MkdirAll(corrupt, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(corrupt, "x"), []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}
	l := &Logger{path: path}
	l.load()
	if got := l.GetAll(); len(got) != 0 {
		t.Errorf("损坏 JSON 加载后应为空, got %d", len(got))
	}
	if _, err := os.Stat(corrupt); err != nil {
		t.Fatalf("占用中的 .corrupt 不应被破坏: %v", err)
	}
}

// TestLogger_Load_JSONNull 合法 JSON 但为 null 时 logs 保持 nil → 应归一为空切片
func TestLogger_Load_JSONNull(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "logs.json")
	if err := os.WriteFile(path, []byte("null"), 0644); err != nil {
		t.Fatal(err)
	}
	l := &Logger{path: path}
	l.load()
	if l.logs == nil {
		t.Fatal("null JSON 加载后 logs 不应为 nil")
	}
	if got := l.GetAll(); len(got) != 0 {
		t.Errorf("null JSON 应加载为空, got %d", len(got))
	}
}

// TestLogger_Load_Over500Trim 合法但超 500 条的旧文件 load 后应裁到上限（与写入路径口径一致）
func TestLogger_Load_Over500Trim(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "logs.json")
	entries := make([]types.ImportLog, 600)
	for i := range entries {
		entries[i] = types.ImportLog{ModelName: "m", Timestamp: int64(i)}
	}
	data, err := json.Marshal(entries)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, data, 0644); err != nil {
		t.Fatal(err)
	}
	l := &Logger{path: path}
	l.load()
	if got := l.GetAll(); len(got) != maxLogEntries {
		t.Errorf("超限文件应裁剪到 %d 条, got %d", maxLogEntries, len(got))
	}
	// 应保留最末 500 条
	if got := l.GetAll(); got[0].Timestamp != int64(100) {
		t.Errorf("应保留最末 500 条, 首条 Timestamp = %d", got[0].Timestamp)
	}
}

// TestLogger_Load_MemoryLogger 内存态 logger（path==""）直接调 load 应为 no-op：
// 不 panic、不创建 .corrupt、日志保持为空（cleanupStaleCorrupt 的 path=="" 早退 + ReadFile("") 的 NotExist 分支）
func TestLogger_Load_MemoryLogger(t *testing.T) {
	l := NewLogger("")
	l.load() // 不 panic
	if got := l.GetAll(); len(got) != 0 {
		t.Errorf("内存态 load 后应为空, got %d", len(got))
	}
	(&Logger{}).load() // 裸结构体 load 同样 no-op
	if _, err := os.Stat(corruptSuffix); !os.IsNotExist(err) {
		t.Fatalf("内存态 load 不应落盘 .corrupt: %v", err)
	}
}

// ====== cleanupStaleCorrupt ======

func TestLogger_CleanupStaleCorrupt(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "logs.json")
	corrupt := path + corruptSuffix
	l := &Logger{path: path}

	t.Run("path 为空时 no-op", func(t *testing.T) {
		(&Logger{}).cleanupStaleCorrupt() // 不 panic
	})

	t.Run("不存在时跳过", func(t *testing.T) {
		l.cleanupStaleCorrupt()
		if _, err := os.Stat(corrupt); !os.IsNotExist(err) {
			t.Fatalf("不应创建 .corrupt: %v", err)
		}
	})

	t.Run("过新的不删", func(t *testing.T) {
		if err := os.WriteFile(corrupt, []byte("x"), 0644); err != nil {
			t.Fatal(err)
		}
		now := time.Now()
		if err := os.Chtimes(corrupt, now, now); err != nil {
			t.Fatal(err)
		}
		l.cleanupStaleCorrupt()
		if _, err := os.Stat(corrupt); err != nil {
			t.Fatalf("保留期内 .corrupt 不应被删除: %v", err)
		}
		os.Remove(corrupt)
	})

	t.Run("过旧的删除", func(t *testing.T) {
		if err := os.WriteFile(corrupt, []byte("x"), 0644); err != nil {
			t.Fatal(err)
		}
		old := time.Now().Add(-(corruptRetentionDays + 1) * 24 * time.Hour)
		if err := os.Chtimes(corrupt, old, old); err != nil {
			t.Fatal(err)
		}
		l.cleanupStaleCorrupt()
		if _, err := os.Stat(corrupt); !os.IsNotExist(err) {
			t.Fatalf("超过保留期的 .corrupt 应被删除: %v", err)
		}
	})

	t.Run("删除失败仅记录", func(t *testing.T) {
		if err := os.MkdirAll(corrupt, 0755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(filepath.Join(corrupt, "x"), []byte("x"), 0644); err != nil {
			t.Fatal(err)
		}
		old := time.Now().Add(-(corruptRetentionDays + 1) * 24 * time.Hour)
		if err := os.Chtimes(corrupt, old, old); err != nil {
			t.Fatal(err)
		}
		l.cleanupStaleCorrupt() // 非空目录 os.Remove 失败 → 仅记录
		if _, err := os.Stat(corrupt); err != nil {
			t.Fatalf("删除失败时 .corrupt 应保留: %v", err)
		}
	})
}

// ====== save ======

// TestLogger_Save_NoPath 内存态 logger（path==""）save 应为 no-op
func TestLogger_Save_NoPath(t *testing.T) {
	l := NewLogger("")
	l.Add("模型A", "/s", "/d", 0, "成功", "")
	if got := l.GetAll(); len(got) != 1 {
		t.Errorf("内存态 Add 后应 1 条, got %d", len(got))
	}
}

// TestLogger_Save_MkdirFail 日志目录创建失败时仅记录不 panic
func TestLogger_Save_MkdirFail(t *testing.T) {
	base := t.TempDir()
	blocker := filepath.Join(base, "file")
	if err := os.WriteFile(blocker, []byte("x"), 0644); err != nil {
		t.Fatal(err)
	}
	l := &Logger{path: filepath.Join(blocker, "sub", "logs.json"), logs: []types.ImportLog{{ModelName: "m"}}}
	l.save() // MkdirAll 失败 → 仅日志
}

// TestLogger_Save_WriteFileAtomicFail 落盘失败（目标是已存在目录 → rename 失败）仅记录不 panic，
// 且失败路径无 .atomic-*.tmp 残渣（fsutil.WriteFileAtomic 清理不变量，对齐 fsutil/write_fail_test.go）
func TestLogger_Save_WriteFileAtomicFail(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "logs.json")
	if err := os.MkdirAll(path, 0755); err != nil { // 目录占位 → WriteFileAtomic 最终 rename 失败
		t.Fatal(err)
	}
	l := &Logger{path: path, logs: []types.ImportLog{{ModelName: "m"}}}
	l.save() // 仅日志，不 panic
	// 失败清理不变量：无临时文件残渣
	matches, _ := filepath.Glob(filepath.Join(dir, ".atomic-*.tmp"))
	if len(matches) != 0 {
		t.Errorf("save 失败后不应残留临时文件: %v", matches)
	}
	// 目标目录占位不应被破坏
	if fi, err := os.Stat(path); err != nil || !fi.IsDir() {
		t.Errorf("logs.json 目录占位应原样保留: %v", err)
	}
}

// ====== addOp ======

// TestLogger_AddOp_Truncate 超 maxFieldLen 的字段按 rune 截断，短字段原样保留
func TestLogger_AddOp_Truncate(t *testing.T) {
	dir := t.TempDir()
	l := &Logger{path: filepath.Join(dir, "logs.json")}
	long := strings.Repeat("界", 2000) // 2000 runes > maxFieldLen
	l.AddOp("import", long, long, long, 0, "ok", long)
	got := l.GetAll()
	if len(got) != 1 {
		t.Fatalf("应 1 条, got %d", len(got))
	}
	for name, f := range map[string]string{
		"ModelName": got[0].ModelName, "SourcePath": got[0].SourcePath,
		"TargetDir": got[0].TargetDir, "ErrorMsg": got[0].ErrorMsg,
	} {
		if n := len([]rune(f)); n != maxFieldLen {
			t.Errorf("%s 应截断到 %d rune, got %d", name, maxFieldLen, n)
		}
	}

	short := "短字段"
	l2 := &Logger{path: filepath.Join(t.TempDir(), "logs.json")}
	l2.Add(short, "s", "d", 0, "ok", "")
	if got := l2.GetAll(); got[0].ModelName != short {
		t.Errorf("短字段应原样保留, got %q", got[0].ModelName)
	}
}

// TestLogger_AddOp_FieldLenExactBoundary 字段长度恰为 maxFieldLen 时不应截断
// （截断条件为 len(r) > maxFieldLen 严格大于，等号边界走原样保留分支）
func TestLogger_AddOp_FieldLenExactBoundary(t *testing.T) {
	dir := t.TempDir()
	l := &Logger{path: filepath.Join(dir, "logs.json")}
	exact := strings.Repeat("界", maxFieldLen) // 恰为上限
	l.AddOp("import", exact, "s", "d", 0, "ok", "")
	got := l.GetAll()
	if len(got) != 1 {
		t.Fatalf("应 1 条, got %d", len(got))
	}
	if n := len([]rune(got[0].ModelName)); n != maxFieldLen {
		t.Errorf("恰为 maxFieldLen 的字段不应截断, got %d rune", n)
	}
	if got[0].ModelName != exact {
		t.Error("恰为 maxFieldLen 的字段应原样保留")
	}
}

// TestLogger_AddOp_CapRealloc 底层数组过大（cap > maxLogEntries*4）时应重分配释放峰值占用。
// 注意：正常 Add 流中 append 的 slice cap 被裁剪钳制在 ~2×maxLogEntries（growslice 翻倍上限），
// 达不到 4× 阈值——该分支仅在初始 backing 数组超大（突发峰值后回落）时触发，此处直接构造该状态。
func TestLogger_AddOp_CapRealloc(t *testing.T) {
	l := &Logger{logs: make([]types.ImportLog, 0, 5000), path: ""} // 内存态 + 超大 backing
	for i := 0; i < 501; i++ {
		l.Add("m", "s", "d", 0, "ok", "")
	}
	all := l.GetAll()
	if len(all) != maxLogEntries {
		t.Errorf("应裁剪到 %d 条, got %d", maxLogEntries, len(all))
	}
	if got := cap(l.logs); got != maxLogEntries {
		t.Errorf("重分配后 cap 应为 %d, got %d", maxLogEntries, got)
	}
}

// ====== RuntimeBuffer.Write 重分配分支 ======

// TestRuntimeBuffer_WriteRealloc 底层数组过大（cap > cap*4）时应重分配释放峰值占用。
// 与 addOp 同理：正常 Write 流中 cap 被钳制在 ~2×cap，需构造超大初始 backing 触发。
func TestRuntimeBuffer_WriteRealloc(t *testing.T) {
	b := &RuntimeBuffer{logs: make([]types.RuntimeLog, 0, 100), cap: 3}
	for i := 0; i < 4; i++ {
		if _, err := b.Write([]byte("msg")); err != nil {
			t.Fatal(err)
		}
	}
	if got := len(b.GetAll()); got != 3 {
		t.Fatalf("应保留 3 条, got %d", got)
	}
	if got := cap(b.logs); got != 3 {
		t.Errorf("重分配后 cap 应为 3, got %d", got)
	}
}
