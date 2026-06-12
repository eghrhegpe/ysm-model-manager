package recycle

import (
"os"
"path/filepath"
"testing"
)

func createTestFile(t *testing.T, dir, name, content string) string {
t.Helper()
p := filepath.Join(dir, name)
if err := os.MkdirAll(filepath.Dir(p), 0755); err != nil {
t.Fatal(err)
}
if err := os.WriteFile(p, []byte(content), 0644); err != nil {
t.Fatal(err)
}
return p
}

func TestNew(t *testing.T) {
tm := New("/tmp/testroot")
if tm.RecycleDir() != filepath.Join("/tmp/testroot", ".recycle") {
t.Errorf("unexpected recycle dir: %s", tm.RecycleDir())
}
}

func TestMoveAndRestore(t *testing.T) {
dir := t.TempDir()
tm := New(dir)

src := createTestFile(t, dir, "test.ysm", "test content")
// 移到回收站
if err := tm.Move(src); err != nil {
t.Fatal(err)
}
if _, err := os.Stat(src); !os.IsNotExist(err) {
t.Error("源文件应该已被删除")
}

// 列出回收站
entries := tm.List()
if len(entries) != 1 {
t.Fatalf("回收站应有 1 个文件，得到 %d", len(entries))
}

// 恢复
if err := tm.Restore(entries[0].Path); err != nil {
t.Fatal(err)
}
if _, err := os.Stat(src); os.IsNotExist(err) {
t.Error("恢复后源文件应存在")
}
}

func TestDelete(t *testing.T) {
dir := t.TempDir()
tm := New(dir)

src := createTestFile(t, dir, "test.ysm", "delete me")
if err := tm.Move(src); err != nil {
t.Fatal(err)
}
entries := tm.List()
if len(entries) != 1 {
t.Fatalf("回收站应有 1 个文件")
}
if err := tm.Delete(entries[0].Path); err != nil {
t.Fatal(err)
}
if len(tm.List()) != 0 {
t.Error("删除后回收站应为空")
}
}

func TestEmpty(t *testing.T) {
dir := t.TempDir()
tm := New(dir)

createTestFile(t, dir, "a.ysm", "a")
createTestFile(t, dir, "b.ysm", "b")
tm.Move(filepath.Join(dir, "a.ysm"))
tm.Move(filepath.Join(dir, "b.ysm"))

count, err := tm.Empty()
if err != nil {
t.Fatal(err)
}
if count != 2 {
t.Errorf("应清空 2 个文件，得到 %d", count)
}
if len(tm.List()) != 0 {
t.Error("清空后回收站应为空")
}
}

func TestMoveExResult(t *testing.T) {
dir := t.TempDir()
tm := New(dir)

src := createTestFile(t, dir, "test.ysm", "result test")
res := tm.MoveEx(src)
if res.Action != "recycled" {
t.Errorf("期望 action=recycled，得到 %s", res.Action)
}
}
