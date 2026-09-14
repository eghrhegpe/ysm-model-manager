package cli

import (
	"encoding/json"
	"math"
	"strings"
	"testing"
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
