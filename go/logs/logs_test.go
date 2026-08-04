// ===== go/logs 单测（覆盖率 0% → 补全）=====
package logs

import (
	"os"
	"path/filepath"
	"testing"
)

func newTestLogger(t *testing.T) *Logger {
	l := &Logger{path: filepath.Join(t.TempDir(), "logs.json")}
	l.load()
	return l
}

func TestAdd_GetAll(t *testing.T) {
	l := newTestLogger(t)
	l.Add("m.ysm", "/src", "/dst", 1024, "success", "")
	got := l.GetAll()
	if len(got) != 1 || got[0].ModelName != "m.ysm" || got[0].Operation != "import" {
		t.Fatalf("Add/GetAll 异常: %+v", got)
	}
	if got[0].FileSize != 1024 || got[0].Status != "success" {
		t.Fatalf("字段异常: %+v", got[0])
	}
}

func TestAddOp(t *testing.T) {
	l := newTestLogger(t)
	l.AddOp("sync", "a.ysm", "/s", "/d", 1, "failed", "err")
	got := l.GetAll()
	if len(got) != 1 || got[0].Operation != "sync" || got[0].Status != "failed" || got[0].ErrorMsg != "err" {
		t.Fatalf("AddOp 异常: %+v", got)
	}
}

func TestPersist_Reload(t *testing.T) {
	l := newTestLogger(t)
	l.Add("m.ysm", "/src", "/dst", 5, "success", "")
	// 新实例同 path → load 读回（验证 save 落盘）
	l2 := &Logger{path: l.path}
	l2.load()
	got := l2.GetAll()
	if len(got) != 1 || got[0].ModelName != "m.ysm" {
		t.Fatalf("持久化读回异常: %+v", got)
	}
}

func TestClear(t *testing.T) {
	l := newTestLogger(t)
	l.Add("m.ysm", "/s", "/d", 1, "success", "")
	l.Clear()
	if got := l.GetAll(); len(got) != 0 {
		t.Fatalf("Clear 后应空: %+v", got)
	}
}

func TestMax500(t *testing.T) {
	l := newTestLogger(t)
	for i := 0; i < 510; i++ {
		l.AddOp("import", "m.ysm", "/s", "/d", 1, "success", "")
	}
	if got := l.GetAll(); len(got) != 500 {
		t.Fatalf("应只保留 500 条，实际 %d", len(got))
	}
}

func TestLoad_MissingAndCorrupt(t *testing.T) {
	// 文件不存在 → 空日志（不报错）
	l := &Logger{path: filepath.Join(t.TempDir(), "nope.json")}
	l.load()
	if got := l.GetAll(); len(got) != 0 {
		t.Fatalf("缺失文件应空: %+v", got)
	}
	// 坏 JSON → 空日志（不报错）
	bad := filepath.Join(t.TempDir(), "bad.json")
	if err := os.WriteFile(bad, []byte("{invalid"), 0644); err != nil {
		t.Fatal(err)
	}
	l2 := &Logger{path: bad}
	l2.load()
	if got := l2.GetAll(); len(got) != 0 {
		t.Fatalf("坏 JSON 应空: %+v", got)
	}
}
