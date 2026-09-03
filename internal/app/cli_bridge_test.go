package app

import (
	"encoding/json"
	"strings"
	"testing"
)

// cliBridgeTestCommands 测试用注入命令列表（对应 go/cli 注册表，避免 app→cli 循环依赖）
var cliBridgeTestCommands = []string{
	"search", "analyze", "list", "verify", "benchmark", "export",
	"file-bench", "single-bench", "concurrent-bench",
	"scan-dir", "analyze-mmd", "perf-log",
	"cache-status", "cache-verify", "cache-clear", "cache-diag",
	"config-show", "gui-flow",
	"resource-scan", "repo-audit",
}

// newAppWithCommands 创建已注入命令列表的 App
func newAppWithCommands() *App {
	a := NewApp()
	a.SetAllowedCommands(cliBridgeTestCommands)
	return a
}

// TestExecuteCLI_CommandNotAllowed 测试命令不在白名单中
func TestExecuteCLI_CommandNotAllowed(t *testing.T) {
	a := NewApp()
	result := a.ExecuteCLI("unknown-command", nil)

	var resp map[string]interface{}
	if err := json.Unmarshal([]byte(result), &resp); err != nil {
		t.Fatalf("JSON 解析失败: %v", err)
	}

	if resp["status"] != "not_supported" {
		t.Errorf("期望 status=not_supported, 实际=%v", resp["status"])
	}

	if resp["command"] != "unknown-command" {
		t.Errorf("期望 command=unknown-command, 实际=%v", resp["command"])
	}
}

// TestExecuteCLI_CommandAllowed 测试可用命令（不需要真实文件系统）
func TestExecuteCLI_CommandAllowed(t *testing.T) {
	a := newAppWithCommands()

	// 测试 config-show 命令（不需要文件系统操作）
	result := a.ExecuteCLI("config-show", map[string]interface{}{})

	var resp map[string]interface{}
	if err := json.Unmarshal([]byte(result), &resp); err != nil {
		t.Fatalf("JSON 解析失败: %v", err)
	}

	// 应该有 status 字段
	if _, ok := resp["status"]; !ok {
		t.Error("响应缺少 status 字段")
	}

	// 应该有 command 字段
	if resp["command"] != "config-show" {
		t.Errorf("期望 command=config-show, 实际=%v", resp["command"])
	}
}

// TestExecuteCLI_AllAllowedCommands 测试所有注入命令都能通过验证
func TestExecuteCLI_AllAllowedCommands(t *testing.T) {
	a := newAppWithCommands()
	commands := cliBridgeTestCommands

	for _, cmd := range commands {
		result := a.ExecuteCLI(cmd, map[string]interface{}{})
		var resp map[string]interface{}
		if err := json.Unmarshal([]byte(result), &resp); err != nil {
			t.Errorf("命令 %s JSON 解析失败: %v", cmd, err)
			continue
		}
		// 应该返回 success 或 error（不是 not_supported）
		status := resp["status"]
		if status == "not_supported" {
			t.Errorf("命令 %s 不应返回 not_supported", cmd)
		}
	}
}

// TestExecuteCLI_ArgsBuilding 测试参数构建逻辑
func TestExecuteCLI_ArgsBuilding(t *testing.T) {
	a := NewApp()

	// 测试带参数的命令
	result := a.ExecuteCLI("search", map[string]interface{}{
		"keyword": "test",
		"format":  "json",
	})

	var resp map[string]interface{}
	if err := json.Unmarshal([]byte(result), &resp); err != nil {
		t.Fatalf("JSON 解析失败: %v", err)
	}

	// 验证响应结构
	if _, ok := resp["timing"]; !ok {
		t.Error("响应缺少 timing 字段")
	}

	if _, ok := resp["meta"]; !ok {
		t.Error("响应缺少 meta 字段")
	}
}

// TestGetAllowedCLICommands 测试获取可用命令列表（注入后与注册表一致）
func TestGetAllowedCLICommands(t *testing.T) {
	a := newAppWithCommands()
	result := a.GetAllowedCLICommands()

	var commands []string
	if err := json.Unmarshal([]byte(result), &commands); err != nil {
		t.Fatalf("JSON 解析失败: %v", err)
	}

	expectedCount := len(cliBridgeTestCommands)
	if len(commands) != expectedCount {
		t.Errorf("期望 %d 个命令, 实际 %d 个: %v", expectedCount, len(commands), commands)
	}

	// 检查关键命令是否存在
	expectedCmds := []string{"search", "list", "analyze", "config-show"}
	for _, cmd := range expectedCmds {
		found := false
		for _, c := range commands {
			if c == cmd {
				found = true
				break
			}
		}
		if !found {
			t.Errorf("命令 %s 不在列表中", cmd)
		}
	}
}

// TestMakeJsonResponse 测试 JSON 响应构建
func TestMakeJsonResponse(t *testing.T) {
	t.Run("success response", func(t *testing.T) {
		result, err := makeJsonResponse("success", "test-cmd", map[string]string{"key": "value"}, nil, 100.0)
		if err != nil {
			t.Fatalf("makeJsonResponse 返回错误: %v", err)
		}

		var resp map[string]interface{}
		if err := json.Unmarshal([]byte(result), &resp); err != nil {
			t.Fatalf("JSON 解析失败: %v", err)
		}

		if resp["status"] != "success" {
			t.Errorf("期望 status=success, 实际=%v", resp["status"])
		}
		if resp["command"] != "test-cmd" {
			t.Errorf("期望 command=test-cmd, 实际=%v", resp["command"])
		}

		// data 应该存在
		if resp["data"] == nil {
			t.Error("data 不应为 nil")
		}
	})

	t.Run("error response", func(t *testing.T) {
		errData := map[string]string{"code": "test_error", "message": "test error message"}
		result, err := makeJsonResponse("error", "test-cmd", nil, errData, 50.0)
		if err != nil {
			t.Fatalf("makeJsonResponse 返回错误: %v", err)
		}

		var resp map[string]interface{}
		if err := json.Unmarshal([]byte(result), &resp); err != nil {
			t.Fatalf("JSON 解析失败: %v", err)
		}

		if resp["status"] != "error" {
			t.Errorf("期望 status=error, 实际=%v", resp["status"])
		}
		if resp["data"] != nil {
			t.Error("data 应为 nil")
		}

		// error 应该存在
		if resp["error"] == nil {
			t.Error("error 不应为 nil")
		}
	})

	t.Run("timing info", func(t *testing.T) {
		result, err := makeJsonResponse("success", "cmd", nil, nil, 123.456)
		if err != nil {
			t.Fatalf("makeJsonResponse 返回错误: %v", err)
		}

		var resp map[string]interface{}
		if err := json.Unmarshal([]byte(result), &resp); err != nil {
			t.Fatalf("JSON 解析失败: %v", err)
		}

		timing, ok := resp["timing"].(map[string]interface{})
		if !ok {
			t.Fatal("timing 字段格式错误")
		}

		totalMs, ok := timing["total_ms"].(float64)
		if !ok {
			t.Fatal("timing.total_ms 字段类型错误")
		}
		if totalMs != 123.456 {
			t.Errorf("期望 total_ms=123.456, 实际=%v", totalMs)
		}
	})

	t.Run("meta info", func(t *testing.T) {
		result, err := makeJsonResponse("success", "cmd", nil, nil, 0.0)
		if err != nil {
			t.Fatalf("makeJsonResponse 返回错误: %v", err)
		}

		var resp map[string]interface{}
		if err := json.Unmarshal([]byte(result), &resp); err != nil {
			t.Fatalf("JSON 解析失败: %v", err)
		}

		meta, ok := resp["meta"].(map[string]interface{})
		if !ok {
			t.Fatal("meta 字段格式错误")
		}

		platform, ok := meta["platform"].(string)
		if !ok {
			t.Fatal("meta.platform 字段类型错误")
		}
		if platform == "" {
			t.Error("meta.platform 不应为空")
		}
	})

	t.Run("serialization error", func(t *testing.T) {
		// 使用 chan 类型触发 json.Marshal 错误（chan 不可序列化）
		_, err := makeJsonResponse("success", "cmd", make(chan int), nil, 0.0)
		if err == nil {
			t.Error("期望序列化错误，但返回 nil")
		}
	})
}

// ===== ADR-173 buildCLIArgs 序列化测试 =====

var searchSpec = []ParamSpecDTO{
	{Key: "keyword", Type: "string"},
	{Key: "min-bones", Type: "number"},
	{Key: "max-tex", Type: "number"},
	{Key: "verbose", Type: "bool"},
}

// TestBuildCLIArgs_OrderedBySpec 规格路径按声明序输出（消除 map 无序）
func TestBuildCLIArgs_OrderedBySpec(t *testing.T) {
	got, warns := buildCLIArgs("search", []string{"--files-root", "/r"}, map[string]interface{}{
		"verbose":   true,
		"keyword":   "steve",
		"max-tex":   float64(512),
		"min-bones": float64(5),
	}, searchSpec)
	if len(warns) != 0 {
		t.Errorf("不应有告警: %v", warns)
	}
	want := []string{"--files-root", "/r", "--keyword", "steve", "--min-bones", "5", "--max-tex", "512", "--verbose"}
	assertStringSlicesEqual(t, got, want)
}

// TestBuildCLIArgs_EmptyValueDropped AllowEmpty=false：空串/0/false 丢弃（legacy 等价语义）
func TestBuildCLIArgs_EmptyValueDropped(t *testing.T) {
	got, warns := buildCLIArgs("search", nil, map[string]interface{}{
		"keyword":   "",
		"min-bones": float64(0),
		"verbose":   false,
	}, searchSpec)
	if len(warns) != 0 {
		t.Errorf("空值丢弃不应告警: %v", warns)
	}
	if len(got) != 0 {
		t.Errorf("全部空值应被丢弃, 实际输出 %v", got)
	}
}

// TestBuildCLIArgs_AllowEmpty 显式空值仅 AllowEmpty=true 时产出（未传 vs 传空 可区分）
func TestBuildCLIArgs_AllowEmpty(t *testing.T) {
	spec := []ParamSpecDTO{
		{Key: "keyword", Type: "string", AllowEmpty: true},
		{Key: "iterations", Type: "number", AllowEmpty: true},
		{Key: "verbose", Type: "bool", AllowEmpty: true},
	}
	got, warns := buildCLIArgs("cmd", nil, map[string]interface{}{
		"keyword":    "",
		"iterations": float64(0),
		"verbose":    false,
	}, spec)
	if len(warns) != 0 {
		t.Errorf("不应有告警: %v", warns)
	}
	// --keyword=（空串）、--iterations 0、--verbose=false
	want := []string{"--keyword=", "--iterations", "0", "--verbose=false"}
	assertStringSlicesEqual(t, got, want)
}

// TestBuildCLIArgs_UnknownKeyWarned 规格外键：告警 + legacy 尾部追加（渐进期不丢参）
func TestBuildCLIArgs_UnknownKeyWarned(t *testing.T) {
	got, warns := buildCLIArgs("search", nil, map[string]interface{}{
		"keyword": "steve",
		"typo":    "oops",
	}, searchSpec)
	if len(warns) != 1 {
		t.Fatalf("期望 1 条未知键告警, 实际 %d: %v", len(warns), warns)
	}
	want := []string{"--keyword", "steve", "--typo", "oops"}
	assertStringSlicesEqual(t, got, want)
}

// TestBuildCLIArgs_TypeMismatchWarned 类型不符：告警跳过
func TestBuildCLIArgs_TypeMismatchWarned(t *testing.T) {
	got, warns := buildCLIArgs("search", nil, map[string]interface{}{
		"keyword": float64(42), // 期望 string
	}, searchSpec)
	if len(warns) != 1 {
		t.Fatalf("期望 1 条类型告警, 实际 %d: %v", len(warns), warns)
	}
	if len(got) != 0 {
		t.Errorf("类型不符参数应跳过, 实际输出 %v", got)
	}
}

// TestBuildCLIArgs_LegacyEquivalence 无规格命令走 legacy：空值丢/布尔开关/数字整数化
func TestBuildCLIArgs_LegacyEquivalence(t *testing.T) {
	got, warns := buildCLIArgs("verify", []string{"--files-root", "/r"}, map[string]interface{}{
		"repair":     true,
		"keyword":    "x",
		"empty":      "",
		"zero":       float64(0),
		"threshold":  float64(2.5),
		"iterations": float64(3),
	}, nil)
	if len(warns) != 0 {
		t.Errorf("不应有告警: %v", warns)
	}
	// legacy 键按字典序输出（历史 map 无序的确定性超集）
	want := []string{"--files-root", "/r", "--iterations", "3", "--keyword", "x", "--repair", "--threshold", "2.5"}
	assertStringSlicesEqual(t, got, want)
}

// TestBuildCLIArgs_UnsupportedTypeWarned legacy 不支持类型：告警不产出
func TestBuildCLIArgs_UnsupportedTypeWarned(t *testing.T) {
	got, warns := buildCLIArgs("cmd", nil, map[string]interface{}{
		"list": []string{"a"},
	}, nil)
	if len(warns) != 1 {
		t.Fatalf("期望 1 条类型告警, 实际 %d: %v", len(warns), warns)
	}
	if len(got) != 0 {
		t.Errorf("不支持类型应跳过, 实际输出 %v", got)
	}
}

// TestBuildCLIArgs_FilesRootExcluded filesRoot 不入规格路径（全局参数由调用方处理）
func TestBuildCLIArgs_FilesRootExcluded(t *testing.T) {
	got, warns := buildCLIArgs("search", nil, map[string]interface{}{
		"filesRoot": "/custom",
		"keyword":   "steve",
	}, searchSpec)
	if len(warns) != 0 {
		t.Errorf("filesRoot 不应告警: %v", warns)
	}
	want := []string{"--keyword", "steve"}
	assertStringSlicesEqual(t, got, want)
}

func assertStringSlicesEqual(t *testing.T, got, want []string) {
	t.Helper()
	if len(got) != len(want) {
		t.Fatalf("长度不匹配:\n  got:  %v\n  want: %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("元素 [%d] 不匹配:\n  got:  %v\n  want: %v", i, got, want)
		}
	}
}

// TestExecuteCLI_WithSpecsInjected 模拟 main.go 双注入（名单 + ADR-173 规格）：
// 登记命令走规格序列化路径后 ExecuteCLI 仍正常响应（非 not_supported），
// 未登记命令（cache-status）不受规格注入影响
func TestExecuteCLI_WithSpecsInjected(t *testing.T) {
	a := NewApp()
	a.SetAllowedCommands(cliBridgeTestCommands)
	a.SetAllowedCommandSpecs([]CommandSpecDTO{
		{Name: "search", Params: searchSpec},
	})

	for _, tc := range []struct {
		cmd  string
		args map[string]interface{}
	}{
		{"search", map[string]interface{}{"keyword": "steve", "format": "json"}},
		{"cache-status", map[string]interface{}{}},
	} {
		result := a.ExecuteCLI(tc.cmd, tc.args)
		var resp map[string]interface{}
		if err := json.Unmarshal([]byte(result), &resp); err != nil {
			t.Fatalf("命令 %s JSON 解析失败: %v", tc.cmd, err)
		}
		if resp["status"] == "not_supported" {
			t.Errorf("命令 %s 不应 not_supported", tc.cmd)
		}
	}
}

// TestAllowedCommandsCount 测试注入的命令列表与注册表保持一致（SetAllowedCommands 注入后）
func TestAllowedCommandsCount(t *testing.T) {
	// 注入后的可用命令列表（来自 cliBridgeTestCommands，对应 go/cli 注册表）
	a := newAppWithCommands()
	result := a.GetAllowedCLICommands()

	var commands []string
	if err := json.Unmarshal([]byte(result), &commands); err != nil {
		t.Fatalf("JSON 解析失败: %v", err)
	}

	expectedCommands := cliBridgeTestCommands

	if len(commands) != len(expectedCommands) {
		t.Errorf("命令数量不匹配: 注入=%d, 期望=%d", len(commands), len(expectedCommands))
	}

	// 检查所有期望的命令都在可用列表中
	cmdSet := make(map[string]bool, len(commands))
	for _, c := range commands {
		cmdSet[c] = true
	}
	for _, cmd := range expectedCommands {
		if !cmdSet[cmd] {
			t.Errorf("命令 %s 不在可用列表中", cmd)
		}
	}
}

// TestExecuteCLI_InvalidJSONResponse 测试参数 map 中不同类型值的处理
func TestExecuteCLI_InvalidJSONResponse(t *testing.T) {
	a := NewApp()

	// 测试字符串参数
	result := a.ExecuteCLI("search", map[string]interface{}{
		"keyword": "test keyword",
	})
	if !strings.Contains(result, `"status"`) {
		t.Error("响应应包含 status 字段")
	}

	// 测试数字参数（float64）
	result = a.ExecuteCLI("benchmark", map[string]interface{}{
		"iterations": float64(5),
	})
	if !strings.Contains(result, `"status"`) {
		t.Error("响应应包含 status 字段")
	}

	// 测试布尔参数
	result = a.ExecuteCLI("verify", map[string]interface{}{
		"repair": true,
	})
	if !strings.Contains(result, `"status"`) {
		t.Error("响应应包含 status 字段")
	}
}
