// ===== scanner_scan.go processScanDirEntry 条目级错误计数单测（ADR-352 ③）=====
// 锁 errCount 新参数的两个计数点（非根 ReadDir 回调 err / d.Info() 失败各计 1）
// 与 nil 透传分支（全量扫描/作者提取共签路径行为不变：nil 不计数、不 panic）。
// 直调未导出 processScanDirEntry（同包测试），无需真实目录竞态构造。
package scanner

import (
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"

	"ysm-model-manager/go/internal/testutil"
)

// errInfoEntry Info() 恒失败的 DirEntry 桩——驱动 d.Info() 失败分支。
// 对应真实场景：ReadDir 与 lstat 之间文件被删除（并行 walk 下 d.Info() 惰性 stat 落空）。
type errInfoEntry struct{ name string }

func (e *errInfoEntry) Name() string               { return e.name }
func (e *errInfoEntry) IsDir() bool                { return false }
func (e *errInfoEntry) Type() fs.FileMode          { return 0 }
func (e *errInfoEntry) Info() (fs.FileInfo, error) { return nil, errors.New("info unavailable (stub)") }

// TestProcessScanDirEntry_ErrCount errCount 计数与 nil 透传双路覆盖。
func TestProcessScanDirEntry_ErrCount(t *testing.T) {
	root := t.TempDir()

	t.Run("非根条目err且errCount非nil计1", func(t *testing.T) {
		var ec atomic.Int64
		entry, walkRet, rootFailed := processScanDirEntry(
			filepath.Join(root, "missing"), nil, errors.New("readdir boom"), root, true, false, &ec)
		testutil.Nil(t, entry, "err 条目不应产出 entry")
		testutil.Nil(t, walkRet, "非根 err 不应中断 walk")
		testutil.Equal(t, rootFailed, false, "非根 err 不构成根失败")
		testutil.Equal(t, ec.Load(), int64(1), "非根 ReadDir 回调 err 应计 1")
	})

	t.Run("errCount为nil行为不变", func(t *testing.T) {
		entry, walkRet, rootFailed := processScanDirEntry(
			filepath.Join(root, "missing"), nil, errors.New("readdir boom"), root, true, false, nil)
		testutil.Nil(t, entry, "err 条目不应产出 entry")
		testutil.Nil(t, walkRet, "非根 err 不应中断 walk")
		testutil.Equal(t, rootFailed, false, "非根 err 不构成根失败")
	})

	t.Run("根目录err仍整目录失败且不计errCount", func(t *testing.T) {
		var ec atomic.Int64
		entry, walkRet, rootFailed := processScanDirEntry(
			root, nil, errors.New("root boom"), root, true, false, &ec)
		testutil.Nil(t, entry, "根失败不应产出 entry")
		testutil.Nil(t, walkRet)
		testutil.Equal(t, rootFailed, true, "根本身打不开应整目录失败")
		testutil.Equal(t, ec.Load(), int64(0), "根目录失败属 walk 级错误，不计条目级 errCount")
	})

	t.Run("d.Info失败且errCount非nil计1", func(t *testing.T) {
		var ec atomic.Int64
		p := filepath.Join(root, "ghost.ysm")
		entry, walkRet, rootFailed := processScanDirEntry(
			p, &errInfoEntry{name: "ghost.ysm"}, nil, root, true, false, &ec)
		testutil.Nil(t, entry, "d.Info 失败应跳过该文件（不出假条目）")
		testutil.Nil(t, walkRet)
		testutil.Equal(t, rootFailed, false)
		testutil.Equal(t, ec.Load(), int64(1), "d.Info 失败应计 1")
	})

	t.Run("d.Info失败但errCount为nil行为不变", func(t *testing.T) {
		p := filepath.Join(root, "ghost.ysm")
		entry, walkRet, rootFailed := processScanDirEntry(
			p, &errInfoEntry{name: "ghost.ysm"}, nil, root, true, false, nil)
		testutil.Nil(t, entry, "d.Info 失败应跳过该文件（不出假条目）")
		testutil.Nil(t, walkRet)
		testutil.Equal(t, rootFailed, false)
	})
}

// TestProcessScanDirEntry_ErrCountZeroOnCleanPath 干净路径（err=nil、Info 正常）不计数，
// 锁「计数只反映条目级错误」的语义边界。
func TestProcessScanDirEntry_ErrCountZeroOnCleanPath(t *testing.T) {
	root := t.TempDir()
	testutil.NoError(t, os.WriteFile(filepath.Join(root, "ok.ysm"), []byte("x"), 0o644), "fixture 写入失败")
	entries, err := os.ReadDir(root)
	testutil.NoError(t, err, "ReadDir 失败")
	var ec atomic.Int64
	entry, walkRet, rootFailed := processScanDirEntry(
		filepath.Join(root, "ok.ysm"), entries[0], nil, root, true, false, &ec)
	testutil.NotNil(t, entry, "干净 .ysm 应产出 entry")
	testutil.Nil(t, walkRet)
	testutil.Equal(t, rootFailed, false)
	testutil.Equal(t, ec.Load(), int64(0), "干净路径不应计数")
}
