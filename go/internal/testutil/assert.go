// 统一断言 helper（ADR-202 刀5）：
// 替代散落在各测试文件里的裸 if+Fatalf，收敛为：
//   - NoError / ErrorContains：错误断言
//   - Equal：struct/slice 值比较（go-cmp，自动 diff 输出）
//   - FileExists / FileNotExists：文件系统断言
//
// 复用判据：同模式在测试中出现 ≥3 处即应改用本 helper。
package testutil

import (
	"errors"
	"fmt"
	"os"
	"reflect"
	"strings"
	"testing"

	"github.com/google/go-cmp/cmp"
)

// prefixFromArgs 把可选消息参数统一成断言失败前缀：
// 首个参数为 string 时作为前缀；若后随额外参数则按 fmt.Sprintf 格式化（如
// Equal(t, got, want, "normalizeScanKey(%q)", key)）。非 string 首参一律忽略，
// 避免测试失败信息里出现字节噪声。全部断言函数共用此规则，语义一致。
func prefixFromArgs(msgAndArgs ...any) string {
	if len(msgAndArgs) == 0 {
		return ""
	}
	s, ok := msgAndArgs[0].(string)
	if !ok {
		return ""
	}
	if len(msgAndArgs) > 1 {
		return fmt.Sprintf(s, msgAndArgs[1:]...) + ": "
	}
	return s + ": "
}

// NoError 断言 err 为 nil，否则致命失败并附加上下文。
func NoError(t *testing.T, err error, msgAndArgs ...any) {
	t.Helper()
	if err != nil {
		t.Fatalf("%sunexpected error: %v", prefixFromArgs(msgAndArgs...), err)
	}
}

// ErrorContains 断言 err 非 nil 且 Error() 包含 substr。
func ErrorContains(t *testing.T, err error, substr string, msgAndArgs ...any) {
	t.Helper()
	if err == nil {
		t.Fatalf("%sexpected error containing %q, got nil", prefixFromArgs(msgAndArgs...), substr)
	}
	if !strings.Contains(err.Error(), substr) {
		t.Fatalf("%serror %q does not contain %q", prefixFromArgs(msgAndArgs...), err.Error(), substr)
	}
}

// ErrorIs 断言 err 非 nil 且 errors.Is(err, target) 成立（错误链可分类）。
// 替代 `if !errors.Is(err, target) { t.Fatalf(...) }`（#11 错误分类正解）。
func ErrorIs(t *testing.T, err error, target error, msgAndArgs ...any) {
	t.Helper()
	if err == nil {
		t.Fatalf("%sexpected error matching %v, got nil", prefixFromArgs(msgAndArgs...), target)
	}
	if !errors.Is(err, target) {
		t.Fatalf("%serror %q does not match %v (errors.Is=false)", prefixFromArgs(msgAndArgs...), err.Error(), target)
	}
}

// Equal 断言 got == want（go-cmp 深度比较），失败时输出 diff。
func Equal[T any](t *testing.T, got, want T, msgAndArgs ...any) {
	t.Helper()
	if diff := cmp.Diff(want, got); diff != "" {
		t.Fatalf("%sunexpected diff (-want +got):\n%s", prefixFromArgs(msgAndArgs...), diff)
	}
}

// isNil 判定 any 值是否为 nil（含 typed nil：指针/切片/map/chan/func/interface）。
func isNil(v any) bool {
	if v == nil {
		return true
	}
	rv := reflect.ValueOf(v)
	switch rv.Kind() {
	case reflect.Chan, reflect.Func, reflect.Interface, reflect.Map, reflect.Ptr, reflect.Slice:
		return rv.IsNil()
	default:
		return false
	}
}

// Nil 断言 v 为 nil（含 typed nil 指针/切片/map）。替代 `if v != nil { t.Fatalf }`。
func Nil(t *testing.T, v any, msgAndArgs ...any) {
	t.Helper()
	if !isNil(v) {
		t.Fatalf("%sexpected nil, got %T: %+v", prefixFromArgs(msgAndArgs...), v, v)
	}
}

// NotNil 断言 v 非 nil。替代 `if v == nil { t.Fatal }`。
func NotNil(t *testing.T, v any, msgAndArgs ...any) {
	t.Helper()
	if isNil(v) {
		t.Fatalf("%sexpected non-nil, got nil", prefixFromArgs(msgAndArgs...))
	}
}

// FileExists 断言 path 存在（文件或目录）。
func FileExists(t *testing.T, path string, msgAndArgs ...any) {
	t.Helper()
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("%spath should exist: %v", prefixFromArgs(msgAndArgs...), err)
	}
}

// FileNotExists 断言 path 不存在。
func FileNotExists(t *testing.T, path string, msgAndArgs ...any) {
	t.Helper()
	// code_review e8d9afdcf（P3）：用 os.Lstat 而非 os.Stat——dangling symlink
	// （条目存在、目标缺失）使 os.Stat 报错 → 断言误过；本 helper 是安全测试断言
	// 「被拒操作不留残留」的标准方式（symlink 逃逸类残留正是要抓的），
	// Lstat 对任何现存条目（含断链）都视为「路径不应存在」而失败
	if _, err := os.Lstat(path); err == nil {
		t.Fatalf("%spath should not exist: %s", prefixFromArgs(msgAndArgs...), path)
	}
}
