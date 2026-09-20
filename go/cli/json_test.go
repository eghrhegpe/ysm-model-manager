package cli

import (
	"encoding/json"
	"math"
	"os"
	"strings"
	"testing"
	"time"
)

// json_test.go — ToJson 兜底分支的 JSON 合法性契约。
// 兜底是「最后一次序列化」，它自己必须是合法 JSON，否则前端 JSON.parse
// 当场抛错——吞错修了一圈，兜底却成了唯一的手拼 JSON 死角。

// TestToJson_MarshalFallbackIsValidJSON：marshal 失败时兜底输出须可被解析。
// NaN 无法被 encoding/json 编码，强制进入兜底分支。
func TestToJson_MarshalFallbackIsValidJSON(t *testing.T) {
	resp := NewJsonSuccess("bench", map[string]float64{"ms": math.NaN()}, 1)
	got := resp.ToJson()

	if !strings.Contains(got, `"code":"marshal_error"`) {
		t.Fatalf("应进入 marshal_error 兜底分支, got: %s", got)
	}
	var out map[string]interface{}
	if err := json.Unmarshal([]byte(got), &out); err != nil {
		t.Fatalf("兜底输出不是合法 JSON: %v\ngot: %s", err, got)
	}
	if out["status"] != "error" {
		t.Errorf("兜底 status 应为 error, got %v", out["status"])
	}
	errObj, ok := out["error"].(map[string]interface{})
	if !ok {
		t.Fatalf("兜底 error 字段缺失或类型异常: %v", out["error"])
	}
	if msg, _ := errObj["message"].(string); msg == "" {
		t.Errorf("兜底 message 不应为空（会丢失 marshal 失败原因）")
	}
}

// TestDurationMs_SubMillisecondNotTruncated：信封耗时不得用整毫秒截断。
//
// 立因（2026-09-21）：两处信封组装点原写 `float64(time.Since(start).Milliseconds())`——
// 亚毫秒被截断成 0，前端把它当「命令耗时」展示时，`version`/缓存查询这类快命令恒显 0，
// 而 0 在 Go 口径里是「没测到」。与 ADR-262 D2 同款陷阱（估算被截断成 0 后遭 omitempty 吞掉）。
// 本包内耗时换算只有 durationMs 一个出口，本测试钉死它的亚毫秒分辨率。
func TestDurationMs_SubMillisecondNotTruncated(t *testing.T) {
	t.Parallel()
	// 500µs：Milliseconds() 会得到 0，durationMs 必须给出 0.5
	if got := durationMs(500 * time.Microsecond); got <= 0 {
		t.Errorf("durationMs(500µs) 应为正数（截断成 0 即「没测到」的假象），got %v", got)
	} else if got < 0.4 || got > 0.6 {
		t.Errorf("durationMs(500µs) 应在 0.5 附近，got %v", got)
	}
	// 纳秒级同理：不得为 0
	if got := durationMs(1500 * time.Nanosecond); got <= 0 {
		t.Errorf("durationMs(1.5µs) 应为正数，got %v", got)
	}
}

// TestEnvelopeTiming_UsesDurationMs：两处信封组装点都走 durationMs，不得回退 Milliseconds()。
// 用源码断言是因为这两处在 DispatchCommand 的闭包里，起真实命令才能覆盖，成本远高于收益；
// 而这条回归的形态是**固定的**（写成 .Milliseconds()），文本断言足够且精确。
func TestEnvelopeTiming_UsesDurationMs(t *testing.T) {
	t.Parallel()
	src, err := os.ReadFile("cli.go")
	if err != nil {
		t.Fatalf("读 cli.go 失败: %v", err)
	}
	s := string(src)
	if strings.Contains(s, "time.Since(start).Milliseconds()") {
		t.Errorf("信封耗时仍用 Milliseconds() 截断（快命令会报 0，前端当「没测到」）——应走 durationMs")
	}
	if n := strings.Count(s, "durationMs(time.Since(start))"); n < 2 {
		t.Errorf("信封组装点应有两处走 durationMs，实际 %d 处", n)
	}
}

// TestToJson_SuccessPathUnchanged：正常路径不受兜底改动影响。
func TestToJson_SuccessPathUnchanged(t *testing.T) {
	resp := NewJsonSuccess("cache-status", map[string]int{"files": 3}, 12.5)
	got := resp.ToJson()
	var out map[string]interface{}
	if err := json.Unmarshal([]byte(got), &out); err != nil {
		t.Fatalf("正常路径输出非法 JSON: %v", err)
	}
	if out["status"] != "success" {
		t.Errorf("status 应为 success, got %v", out["status"])
	}
}
