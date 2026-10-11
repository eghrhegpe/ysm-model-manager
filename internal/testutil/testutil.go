// internal/testutil — 根内测试断言桥（ADR-202 刀5 testutil 的跨树桥接，G3 清偿 2026-10-11）。
//
// Go internal 可见性规则：go/internal/testutil 只允许 go/ 子树内导入；根
// internal/app（Wails 应用层）在该子树之外，其测试文件同样适用「测试断言
// 增量红线」（check-go-diff-coverage 的 *_test.go 扫描不区分包树）。
//
// **跨树纯转发不可编译**（前序实证：根桥 import go/internal/testutil 触发
// "use of internal package ... not allowed"——internal 元素的父目录是 go/，
// 根 internal/testutil 不在该子树内），故本包**自足实现** 8 个断言函数，
// 实现逐行同源 go/internal/testutil/assert.go（判据/Sprintf label 规则一致，
// 签名与 go 侧完全相同）；生产代码禁止导入本包（测试专属，与
// go/internal/testutil 同纪律）。单一事实源收敛（go 侧改转发）为后续债务，
// 本包与 go 侧断言语义漂移时以 check-go-diff-coverage 全仓扫描兜底。
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
// （同源 go/internal/testutil/assert.go|prefixFromArgs）
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
func ErrorIs(t *testing.T, err, target error, msgAndArgs ...any) {
	t.Helper()
	if err == nil {
		t.Fatalf("%sexpected error matching %v, got nil", prefixFromArgs(msgAndArgs...), target)
	}
	if !errors.Is(err, target) {
		t.Fatalf("%serror %q does not match %v (errors.Is=false)", prefixFromArgs(msgAndArgs...), err.Error(), target)
	}
}

// Equal 断言 got == want（go-cmp 深度比较），失败时输出 diff。参数序 (got, want)。
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

// Nil 断言 v 为 nil（含 typed nil 指针/切片/map）。
func Nil(t *testing.T, v any, msgAndArgs ...any) {
	t.Helper()
	if !isNil(v) {
		t.Fatalf("%sexpected nil, got %T: %+v", prefixFromArgs(msgAndArgs...), v, v)
	}
}

// NotNil 断言 v 非 nil。
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
	// 同源 go/internal/testutil|FileNotExists：os.Lstat 而非 os.Stat——
	// dangling symlink（条目存在、目标缺失）使 os.Stat 报错 → 断言误过
	if _, err := os.Lstat(path); err == nil {
		t.Fatalf("%spath should not exist: %s", prefixFromArgs(msgAndArgs...), path)
	}
}
