// ===== fsutil.ReadLimitedEntry 直测（ADR-033/ADR-044 收敛后的补测：
// limit+1 截断保护是本函数的核心不变量，任何回归都会让超限数据静默装盘）=====
package fsutil

import (
	"bytes"
	"errors"
	"io"
	"math"
	"testing"
	"ysm-model-manager/go/internal/testutil"
)

// ---- 辅助类型 ----

// noopCloser 包装一个 io.Reader，可追踪 Close 是否被调用。
type noopCloser struct {
	io.Reader
	closed bool
}

func (c *noopCloser) Close() error {
	c.closed = true
	return nil
}

// errorReader 每次 Read 直接返回预设错误。
type errorReader struct {
	err error
}

func (r *errorReader) Read(p []byte) (int, error) {
	return 0, r.err
}

// ---- 测试用例 ----

// TestReadLimitedEntry_Normal：内容短于 limit，应返回完整内容。
func TestReadLimitedEntry_Normal(t *testing.T) {
	data := []byte("hello world, this is a short payload")
	rc := &noopCloser{Reader: bytes.NewReader(data)}
	got := ReadLimitedEntry(rc, 100)
	testutil.Equal(t, rc.closed, true, "ReadLimitedEntry 未调用 rc.Close()")
	testutil.Equal(t, string(got), string(data), "内容不符：期望 %q，实际 %q", string(data), string(got))
}

// TestReadLimitedEntry_ExactlyAtLimit：内容恰好等于 limit，应在边界上放行。
func TestReadLimitedEntry_ExactlyAtLimit(t *testing.T) {
	data := make([]byte, 50)
	for i := range data {
		data[i] = 'A'
	}
	rc := &noopCloser{Reader: bytes.NewReader(data)}
	got := ReadLimitedEntry(rc, 50)
	testutil.Equal(t, string(got), string(data), "边界内容不符：长度期望 %d，实际 %d", len(data), len(got))
}

// TestReadLimitedEntry_OverLimit：内容超过 limit，截断保护应生效并返回 nil。
func TestReadLimitedEntry_OverLimit(t *testing.T) {
	data := make([]byte, 51)
	for i := range data {
		data[i] = 'B'
	}
	rc := &noopCloser{Reader: bytes.NewReader(data)}
	got := ReadLimitedEntry(rc, 50)
	testutil.Nil(t, got, "内容超限时应返回 nil，实际得到 %d 字节", len(got))
}

// TestReadLimitedEntry_LimitZero：limit<=0 时统一返回 nil，跳过该条目。
func TestReadLimitedEntry_LimitZero(t *testing.T) {
	data := []byte("whatever")
	rc := &noopCloser{Reader: bytes.NewReader(data)}
	got := ReadLimitedEntry(rc, 0)
	testutil.Nil(t, got, "limit=0 应返回 nil，实际 %q", string(got))
}

// TestReadLimitedEntry_LimitNegative：负 limit 同样返回 nil。
func TestReadLimitedEntry_LimitNegative(t *testing.T) {
	data := []byte("whatever")
	rc := &noopCloser{Reader: bytes.NewReader(data)}
	got := ReadLimitedEntry(rc, -1)
	testutil.Nil(t, got, "limit<0 应返回 nil，实际 %q", string(got))
}

// TestReadLimitedEntry_EmptyContent：limit>0 时空内容返回空切片（非 nil），视为有效。
func TestReadLimitedEntry_EmptyContent(t *testing.T) {
	rc := &noopCloser{Reader: bytes.NewReader(nil)}
	got := ReadLimitedEntry(rc, 100)
	testutil.NotNil(t, got, "limit>0 时空内容应返回空切片，而非 nil")
	testutil.Equal(t, len(got), 0, "空内容长度应为 0，实际 %d", len(got))
}

// TestReadLimitedEntry_ReadError：读取报错时返回 nil（调用方跳过该条目）。
func TestReadLimitedEntry_ReadError(t *testing.T) {
	wantErr := errors.New("读取失败")
	rc := &noopCloser{Reader: &errorReader{err: wantErr}}
	got := ReadLimitedEntry(rc, 100)
	testutil.Nil(t, got, "读取报错应返回 nil，实际 %q", string(got))
}

// TestReadLimitedEntry_MaxInt64：limit==MaxInt64 时 limit+1 溢出为负，统一返回 nil 防误判。
func TestReadLimitedEntry_MaxInt64(t *testing.T) {
	data := []byte("overflow check")
	rc := &noopCloser{Reader: bytes.NewReader(data)}
	got := ReadLimitedEntry(rc, math.MaxInt64)
	testutil.Nil(t, got, "limit=MaxInt64 应返回 nil（防溢出），实际 %q", string(got))
}

// TestReadLimitedEntry_DeferClose：验证 rc.Close 必被调用，即使读取中途出错。
func TestReadLimitedEntry_DeferClose(t *testing.T) {
	// 构造一个在读到一半时报错的 Reader，确认 defer 仍触发 Close。
	partial := &partialReader{data: []byte("abc"), after: 2}
	rc := &noopCloser{Reader: partial}
	got := ReadLimitedEntry(rc, 10)
	testutil.Equal(t, rc.closed, true, "ReadLimitedEntry 应在 defer 中调用 rc.Close()")
	_ = got // 不关心返回值，只验证关闭行为
}

// partialReader 读完 n 字节后开始返回错误，用于模拟中途失败场景。
type partialReader struct {
	data  []byte
	after int
	pos   int
}

func (r *partialReader) Read(p []byte) (int, error) {
	if r.pos >= r.after {
		return 0, errors.New("partial read error")
	}
	n := copy(p, r.data[r.pos:])
	r.pos += n
	if r.pos >= len(r.data) {
		return n, io.EOF
	}
	return n, nil
}
