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
	// 防抖落盘（ADR-082 续）：Add 后未过窗口不落盘，Flush 强制立即写入
	l.Flush()

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

// 防抖合并写（ADR-082 续）：批量高频 addOp 只落盘一次（窗口内合并），
// 消除 O(N²) 全量重写；Flush 可强制提前落盘
func TestLogger_DebouncedSave(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "test-logs.json")
	l := &Logger{path: path}

	// 连续写入多条（模拟 sync 逐文件 InstallModelTo 批量场景）
	for i := 0; i < 50; i++ {
		l.Add("模型", "/src", "/dst", 0, "成功", "")
	}
	// 未 Flush 前磁盘不应有文件（防抖窗口内合并中）
	if _, err := os.Stat(path); err == nil {
		t.Fatal("防抖窗口内不应已落盘（批量写入应合并为一次 save）")
	}
	// Flush 强制落盘后应完整可读
	l.Flush()
	l2 := &Logger{path: path}
	l2.load()
	if got := len(l2.GetAll()); got != 50 {
		t.Fatalf("Flush 后应 50 条, 得到 %d", got)
	}
}

// 内存态（path==""）addOp 不启动定时器、不落盘（save no-op 语义保持）
func TestLogger_DebounceMemoryMode(t *testing.T) {
	l := &Logger{} // path 为空 → 内存态
	l.Add("模型", "/src", "/dst", 0, "成功", "")
	if l.saveTimer != nil {
		t.Fatal("内存态不应启动防抖定时器")
	}
	l.Flush() // 不 panic
	if got := len(l.GetAll()); got != 1 {
		t.Fatalf("内存态应保留 1 条, 得到 %d", got)
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
	// 损坏现场必须备份为 .corrupt 再置空（load 解析失败分支，logs.go L120-128）：
	// 原文件被 rename 走、.corrupt 备份在场，损坏可溯
	if _, err := os.Stat(path + ".corrupt"); err != nil {
		t.Errorf("损坏 JSON 应备份为 .corrupt: %v", err)
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Errorf("原损坏文件应已被 rename 为 .corrupt, 不应仍在原位: %v", err)
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
	// NewLogger 使用注入的配置目录，不能保证写入成功
	// 只验证不 panic
	l := NewLogger(t.TempDir())
	if l == nil {
		t.Fatal("NewLogger 应返回非 nil")
	}
	_ = l
}
