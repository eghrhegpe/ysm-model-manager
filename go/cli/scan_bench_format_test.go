package cli

import (
	"strings"
	"testing"
)

// ===== scan-bench 耗时渲染：亚分辨率必须与「未采集」字面区分 =====
//
// 背景（本文件要钉的既有缺陷，2026-10-07）：scan_bench.go 的诚实红线 #2 写明
// 「未参与时写未采集，**绝不填 0.00ms**（0ms 会被读成『快到测不出』，正好相反）」。
// `!Used` 分支确实渲染「未采集＋原因」，但 `Used` 分支原用 `%.2f` 直出——粗时钟粒度下
// **合法采集到的亚分辨率样本**（Windows 单调时钟实测 2MB 热缓存读 `time.Since` 可为 0s）
// 会渲染成 `0.00ms`，与「未采集」在字面上不可区分，正是该红线要防的。
//
// 同时钉住一个**测试侧**陷阱：`strings.Contains(out, "0.00ms")` 会命中 `10.00ms` 的
// **子串**，故端到端断言必须锚定字段位（`中位 0.00ms` / `p95 0.00ms`），不能用裸子串——
// 这正是既有 `TestRunScanBench_TextModeDoesNotFabricate` 会假红约 1/3 的第二重根因。

func TestFormatMs_SubResolutionIsMarkedNotZero(t *testing.T) {
	cases := []struct {
		in   float64
		want string
	}{
		{0, "<0.01ms"},     // 粗时钟粒度：合法测量值本就可能是 0
		{0.004, "<0.01ms"}, // 会舍入成 0.00
		{0.005, "0.01ms"},  // 恰好跨过舍入阈值（边界）
		{0.01, "0.01ms"},
		{1.234, "1.23ms"},
		{10, "10.00ms"}, // 注意：字面含子串 "0.00ms"，故端到端断言必须锚字段
		{1234.5, "1234.50ms"},
	}
	for _, c := range cases {
		if got := formatMs(c.in); got != c.want {
			t.Errorf("formatMs(%v) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestFormatMs_NeverRendersBareZero(t *testing.T) {
	// 亚分辨率的定义就是「`%.2f` 会把它舍成 0.00」的那一段；这段绝不可能是 "0.00ms"。
	for _, ms := range []float64{0, 0.0001, 0.0049} {
		if got := formatMs(ms); strings.HasPrefix(got, "0.00") {
			t.Errorf("formatMs(%v) = %q：亚分辨率不得渲染成 0.00（与未采集混淆）", ms, got)
		}
	}
}

func TestFormatMsList_SubResolutionIsMarked(t *testing.T) {
	got := formatMsList([]float64{0, 0.302, 1.5})
	if strings.Contains(got, "0.00") {
		t.Errorf("formatMsList 含未标记的 0.00: %q", got)
	}
	if !strings.Contains(got, "<0.01") {
		t.Errorf("formatMsList 未标记亚分辨率样本: %q", got)
	}
	// 非亚分辨率样本渲染口径不变（沿用既有 %.2f，避免动报告版式）
	if !strings.Contains(got, "0.30") || !strings.Contains(got, "1.50") {
		t.Errorf("formatMsList 常规样本渲染口径漂移: %q", got)
	}
}

func TestFormatMsList_Empty(t *testing.T) {
	if got := formatMsList(nil); got != "" {
		t.Errorf("formatMsList(nil) = %q, want 空串", got)
	}
}
