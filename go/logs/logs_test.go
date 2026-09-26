// ===== go/logs 单测 =====
package logs

import (
	"errors"
	"os"
	"path/filepath"
	"testing"

	"ysm-model-manager/go/types"
)

func TestLogger_AddAndGetAll(t *testing.T) {
	dir := t.TempDir()
	l := &Logger{path: filepath.Join(dir, "test-logs.json")}
	l.Add("模型A", "/src/a.ysm", "/dst", 1024, types.StatusSuccess, "")
	logs := l.GetAll()
	if len(logs) != 1 {
		t.Fatalf("期望 1 条日志, 得到 %d", len(logs))
	}
	if logs[0].ModelName != "模型A" {
		t.Errorf("ModelName = %q, 期望 模型A", logs[0].ModelName)
	}
	if logs[0].Status != types.StatusSuccess {
		t.Errorf("Status = %q, 期望 %s", logs[0].Status, types.StatusSuccess)
	}
	if logs[0].Operation != "import" {
		t.Errorf("Operation = %q, 期望 import", logs[0].Operation)
	}
	if logs[0].Level != types.LevelInfo {
		t.Errorf("Level = %q, 期望 info（StatusToLevel 映射）", logs[0].Level)
	}
}

func TestLogger_AddOp(t *testing.T) {
	dir := t.TempDir()
	l := &Logger{path: filepath.Join(dir, "test-logs.json")}
	l.AddOp("delete", "模型B", "/src/b.ysm", "/dst", 2048, types.StatusSuccess, "")
	logs := l.GetAll()
	if len(logs) != 1 {
		t.Fatalf("期望 1 条日志, 得到 %d", len(logs))
	}
	if logs[0].Operation != "delete" {
		t.Errorf("Operation = %q, 期望 delete", logs[0].Operation)
	}
}

// ===== 锐评②：AddErr / AddOpErr 结构化拆解 =====
func TestLogger_AddErr_AppError(t *testing.T) {
	l := &Logger{path: filepath.Join(t.TempDir(), "test-logs.json")}
	err := types.AppError{
		Code:       types.ErrFileExists,
		Operation:  "导入模型",
		SourcePath: "/src/a.ysm",
		Reason:     "目标已存在同名文件",
		Suggestion: "重命名后重试",
	}
	l.AddErr("模型C", "/src/a.ysm", "/dst", 10, types.StatusFailed, err)
	logs := l.GetAll()
	if len(logs) != 1 {
		t.Fatalf("期望 1 条日志, 得到 %d", len(logs))
	}
	e := logs[0]
	if e.Code != types.ErrFileExists {
		t.Errorf("Code = %q, 期望 %q", e.Code, types.ErrFileExists)
	}
	if e.ErrorMsg != "目标已存在同名文件" {
		t.Errorf("ErrorMsg = %q, 期望 Reason 而非散文模板", e.ErrorMsg)
	}
	if e.Suggestion != "重命名后重试" {
		t.Errorf("Suggestion = %q", e.Suggestion)
	}
	if e.Level != types.LevelError {
		t.Errorf("Level = %q, 期望 error", e.Level)
	}
}

func TestLogger_AddErr_PlainError(t *testing.T) {
	l := &Logger{}
	l.AddErr("模型D", "", "", 0, types.StatusFailed, errors.New("disk full"))
	logs := l.GetAll()
	e := logs[0]
	if e.Code != "" || e.Suggestion != "" {
		t.Errorf("非 AppError 应无结构化字段, got Code=%q Suggestion=%q", e.Code, e.Suggestion)
	}
	if e.ErrorMsg != "disk full" {
		t.Errorf("ErrorMsg = %q, 期望原样 err.Error()", e.ErrorMsg)
	}
}

func TestLogger_AddErr_WrappedAppError(t *testing.T) {
	l := &Logger{}
	inner := types.AppError{Code: types.ErrIO, Reason: "被占用", Suggestion: "关闭占用程序"}
	wrapped := errors.Join(errors.New("推送失败"), inner)
	l.AddOpErr("push", "模型E", "/src", "/dst", 0, types.StatusFailed, wrapped)
	e := l.GetAll()[0]
	if e.Code != types.ErrIO {
		t.Errorf("errors.As 应穿透包装链, got Code=%q", e.Code)
	}
	if e.ErrorMsg != "被占用" {
		t.Errorf("ErrorMsg = %q", e.ErrorMsg)
	}
}

func TestLogger_AddErr_NilErr(t *testing.T) {
	l := &Logger{}
	l.AddErr("模型F", "", "", 0, types.StatusWarn, nil)
	e := l.GetAll()[0]
	if e.ErrorMsg != "" || e.Code != "" {
		t.Errorf("nil err 应产出空字段, got ErrorMsg=%q Code=%q", e.ErrorMsg, e.Code)
	}
	if e.Status != types.StatusWarn || e.Level != types.LevelWarn {
		t.Errorf("status/level 透传错误: %q/%q", e.Status, e.Level)
	}
}

func TestLogger_Clear(t *testing.T) {
	dir := t.TempDir()
	l := &Logger{path: filepath.Join(dir, "test-logs.json")}
	l.Add("模型A", "/src/a.ysm", "/dst", 1024, types.StatusSuccess, "")
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

// TestLogger_Cap 锐评⑤：Cap() 返回实时上限（logMaxEntries 读配置），
// GetLogCaps 绑定据此单源化诊断页检索窗口——契约只锁「正值」，具体数值随配置走。
func TestLogger_Cap(t *testing.T) {
	l := NewLogger(t.TempDir())
	if got := l.Cap(); got <= 0 {
		t.Fatalf("Cap() = %d, 期望正值（logMaxEntries 默认或配置值）", got)
	}
}
