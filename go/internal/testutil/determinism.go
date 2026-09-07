// 确定性测试三件套（ADR-202 刀4）：
//   - SortedKeys：map 遍历确定性排序，根治「map 随机序 flaky」（dfa190b8b / a3382de92 散修收编）
//   - WithFixedClock：冻结时钟注入点，根治「时间依赖 flaky」（测试断言跨秒/跨日边界漂移）
//   - CleanAbsPath：平台原生绝对路径构造，根治「手拼 POSIX 路径串在 Windows 下语义漂移」
//     （276fd42e6 先例：filepath.Join 构造干净平台绝对路径）
//
// 复用判据（照搬 test_tax_reduction 卡刀三）：同模式在测试中出现 ≥3 处即应改用本三件套。
package testutil

import (
	"path/filepath"
	"sort"
	"testing"
	"time"
)

// SortedKeys 返回 map 的 key 升序切片（泛型，支持任意 value 类型）。
// 测试遍历 map 做断言时，用 `for _, k := range testutil.SortedKeys(m)` 替代
// `for k := range m`——后者迭代序随机，任一断言依赖遍历序即 flaky。
func SortedKeys[V any](m map[string]V) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

// WithFixedClock 将时钟注入点 *clock 冻结为 now，测试结束自动恢复原时钟。
// clock 应指向生产/被测包的包级时钟变量（如 `var now = time.Now` 或
// `var Now = time.Now`），使被测代码经该注入点读时间——测试传固定值即
// 完全确定，无需 sleep / 容忍窗口。
// 用法：testutil.WithFixedClock(t, &pkg.Now, time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC))
func WithFixedClock(t *testing.T, clock *func() time.Time, now time.Time) {
	t.Helper()
	if clock == nil {
		t.Fatal("WithFixedClock: clock 为 nil")
	}
	orig := *clock
	*clock = func() time.Time { return now }
	t.Cleanup(func() { *clock = orig })
}

// CleanAbsPath 用 filepath.Join 拼接 parts，filepath.Clean 归一化后返回平台原生路径。
// 替代测试里手写的 `"/repo/mmd/PMX/xx"`——POSIX 字符串在 Windows 下经 filepath
// 归一化为 `\repo\mmd\PMX`（根相对），手拼 + 手切分隔符会随平台漂移（276fd42e6 先例）。
// 不做 IsAbs 断言："/repo" 在 Windows 下是根相对而非绝对，绝对性语义由被测函数
// 内部的 filepath 归一化承担（本仓库被测代码统一走 filepath，跨平台一致）。
func CleanAbsPath(t *testing.T, parts ...string) string {
	t.Helper()
	if len(parts) == 0 || parts[0] == "" {
		t.Fatal("CleanAbsPath: parts 为空或首段为空")
	}
	return filepath.Clean(filepath.Join(parts...))
}
