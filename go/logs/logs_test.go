// ===== go/logs 单测 =====
package logs

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLogger_AddAndGetAll(t *testing.T) {
	dir := t.TempDir()
	l := &Logger{path: filepath.Join(dir, "test-logs.json")}
	l.Add("模型A", "/src/a.ysm", "/dst", 1024, "成功", "")
	logs := l.GetAll()
	if len(logs) != 1 {
		t.Fatalf("期望 1 条日志, 得到 %d", len(logs))
	}
	if logs[0].ModelName != "模型A" {
		t.Errorf("ModelName = %q, 期望 模型A", logs[0].ModelName)
	}
	if logs[0].Status != "成功" {
		t.Errorf("Status = %q, 期望 成功", logs[0].Status)
	}
	if logs[0].Operation != "import" {
		t.Errorf("Operation = %q, 期望 import", logs[0].Operation)
	}
}

func TestLogger_AddOp(t *testing.T) {
	dir := t.TempDir()
	l := &Logger{path: filepath.Join(dir, "test-logs.json")}
	l.AddOp("delete", "模型B", "/src/b.ysm", "/dst", 2048, "已完成", "")
	logs := l.GetAll()
	if len(logs) != 1 {
		t.Fatalf("期望 1 条日志, 得到 %d", len(logs))
	}
	if logs[0].Operation != "delete" {
		t.Errorf("Operation = %q, 期望 delete", logs[0].Operation)
	}
}

func TestLogger_Clear(t *testing.T) {
	dir := t.TempDir()
	l := &Logger{path: filepath.Join(dir, "test-logs.json")}
	l.Add("模型A", "/src/a.ysm", "/dst", 1024, "成功", "")
	l.Clear()
	logs := l.GetAll()
	if len(logs) != 0 {
		t.Errorf("Clear 后日志应为空, 得到 %d", len(logs))
	}
}

func TestLogger_GetAllIsCopy(t *testing.T) {
	dir := t.TempDir()
	l := &Logger{path: filepath.Join(dir, "test-logs.json")}
	l.Add("模型A", "/src/a.ysm", "/dst", 1024, "成功", "")
	logs1 := l.GetAll()
	// 修改返回的切片不应影响内部状态
	logs1[0].ModelName = "已修改"
	internal := l.GetAll()
	if internal[0].ModelName == "已修改" {
		t.Error("GetAll 应返回副本，修改返回切片不应影响内部状态")
	}
}

func TestLogger_SaveAndLoad(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "test-logs.json")
	l := &Logger{path: path}
	l.Add("模型A", "/src/a.ysm", "/dst", 1024, "成功", "")

	// 新建 Logger 从同一路径加载
	l2 := &Logger{path: path}
	l2.load()
	logs := l2.GetAll()
	if len(logs) != 1 {
		t.Fatalf("重新加载后期望 1 条日志, 得到 %d", len(logs))
	}
	if logs[0].ModelName != "模型A" {
		t.Errorf("ModelName = %q, 期望 模型A", logs[0].ModelName)
	}
}

func TestLogger_LoadFromInvalidFile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "bad-logs.json")
	if err := os.WriteFile(path, []byte("{invalid json}"), 0644); err != nil {
		t.Fatal(err)
	}
	l := &Logger{path: path}
	l.load()
	logs := l.GetAll()
	if len(logs) != 0 {
		t.Errorf("非法 JSON 文件应加载为空日志, 得到 %d", len(logs))
	}
}

func TestLogger_LoadFromNonExistent(t *testing.T) {
	dir := t.TempDir()
	l := &Logger{path: filepath.Join(dir, "nonexistent.json")}
	l.load()
	logs := l.GetAll()
	if len(logs) != 0 {
		t.Errorf("不存在文件应加载为空日志, 得到 %d", len(logs))
	}
}

func TestLogger_CapAt500(t *testing.T) {
	dir := t.TempDir()
	l := &Logger{path: filepath.Join(dir, "test-logs.json")}
	for i := 0; i < 600; i++ {
		l.Add("模型", "/src", "/dst", 0, "成功", "")
	}
	logs := l.GetAll()
	if len(logs) != 500 {
		t.Errorf("日志应裁剪到 500 条, 得到 %d", len(logs))
	}
}

func TestLogger_NewLogger(t *testing.T) {
	// NewLogger 使用用户配置目录，不能保证写入成功
	// 只验证不 panic
	l := NewLogger()
	if l == nil {
		t.Fatal("NewLogger 应返回非 nil")
	}
	_ = l
}
