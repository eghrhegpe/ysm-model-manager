// Package main — cmd/ccheck 的 run() 直测（不 spawn 子进程，os.Exit 只发生在 main 内）。
//
// 背景（2026-10-08）：cmd/ccheck 覆盖率 0% < 20% 门槛。原 main() 直接写 os.Stdout +
// os.Exit，测试只能 spawn 子进程（成本高且 Windows 路径差异大）。重构为
// `run(args, stdout, stderr) int` 后，本文件直测核心路径：正常扫描 / --json /
// --threshold 过滤 / --top 负值夹取 / --dir 不存在。
package main

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// 建一个含真实函数（if/for 嵌套）的临时 Go 文件，供 ScanDir 扫出结果。
func writeFixture(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	src := `package fixture

func simple() int { return 1 }

func nested(x int) int {
	if x > 0 {
		for i := 0; i < x; i++ {
			x += i
		}
	}
	return x
}
`
	path := filepath.Join(dir, "fixture.go")
	if err := os.WriteFile(path, []byte(src), 0o600); err != nil {
		t.Fatalf("write fixture: %v", err)
	}
	return dir
}

func TestRunTextMode(t *testing.T) {
	dir := writeFixture(t)
	var out, errBuf bytes.Buffer
	// threshold=1：fixture 的 simple（认知 0）/nested（认知 3）都达到，扫出 2 个
	code := run([]string{"--dir", dir, "--threshold", "0"}, &out, &errBuf)
	if code != exitOK {
		t.Fatalf("exit = %d, want %d; stderr=%s", code, exitOK, errBuf.String())
	}
	if !strings.Contains(out.String(), "认知复杂度扫描") {
		t.Errorf("text output missing header: %s", out.String())
	}
	if !strings.Contains(out.String(), "simple") || !strings.Contains(out.String(), "nested") {
		t.Errorf("text output missing function names: %s", out.String())
	}
}

func TestRunJSONMode(t *testing.T) {
	dir := writeFixture(t)
	var out, errBuf bytes.Buffer
	code := run([]string{"--dir", dir, "--threshold", "0", "--json", "--top", "5"}, &out, &errBuf)
	if code != exitOK {
		t.Fatalf("exit = %d, want %d; stderr=%s", code, exitOK, errBuf.String())
	}
	var payload struct {
		Dir       string `json:"dir"`
		Threshold int    `json:"threshold"`
		Funcs     int    `json:"funcs"`
		Active    int    `json:"active"`
		Top       []struct {
			Name      string `json:"name"`
			Cognitive int    `json:"cognitive"`
		} `json:"top"`
	}
	if err := json.Unmarshal(out.Bytes(), &payload); err != nil {
		t.Fatalf("json unmarshal: %v; raw=%s", err, out.String())
	}
	if payload.Funcs != 2 || payload.Active != 2 {
		t.Errorf("funcs=%d active=%d, want 2/2; top=%v", payload.Funcs, payload.Active, payload.Top)
	}
	if len(payload.Top) != 2 {
		t.Errorf("top len = %d, want 2", len(payload.Top))
	}
	// 排序：nested（认知更高）应排在 simple 前
	if len(payload.Top) == 2 && payload.Top[0].Name != "nested" {
		t.Errorf("top[0] = %s, want nested (higher cognitive)", payload.Top[0].Name)
	}
}

func TestRunThresholdFilters(t *testing.T) {
	dir := writeFixture(t)
	var out, errBuf bytes.Buffer
	// threshold 极高 → 无函数达标 → Active=0，文本模式输出「无函数达到阈值」
	code := run([]string{"--dir", dir, "--threshold", "9999"}, &out, &errBuf)
	if code != exitOK {
		t.Fatalf("exit = %d, want %d; stderr=%s", code, exitOK, errBuf.String())
	}
	if !strings.Contains(out.String(), "无函数达到阈值") {
		t.Errorf("text output missing empty marker: %s", out.String())
	}
}

func TestRunTopNegativeClamps(t *testing.T) {
	dir := writeFixture(t)
	var out, errBuf bytes.Buffer
	// --top -1：夹到 0，JSON top 为空数组而非 panic（threshold=1 让 fixture 两个函数都入 active）
	code := run([]string{"--dir", dir, "--threshold", "0", "--json", "--top", "-1"}, &out, &errBuf)
	if code != exitOK {
		t.Fatalf("exit = %d, want %d; stderr=%s", code, exitOK, errBuf.String())
	}
	var payload struct {
		Active int               `json:"active"`
		Top    []json.RawMessage `json:"top"`
	}
	if err := json.Unmarshal(out.Bytes(), &payload); err != nil {
		t.Fatalf("json unmarshal: %v; raw=%s", err, out.String())
	}
	if payload.Active != 2 {
		t.Errorf("active = %d, want 2", payload.Active)
	}
	if payload.Top == nil || len(payload.Top) != 0 {
		t.Errorf("top = %#v, want empty slice", payload.Top)
	}
}

func TestRunMissingDir(t *testing.T) {
	var out, errBuf bytes.Buffer
	code := run([]string{"--dir", filepath.Join(t.TempDir(), "nonexistent")}, &out, &errBuf)
	if code != exitFail {
		t.Fatalf("exit = %d, want %d", code, exitFail)
	}
	if !strings.Contains(errBuf.String(), "目录不存在") {
		t.Errorf("stderr missing dir-not-found: %s", errBuf.String())
	}
}

func TestRunInvalidFlag(t *testing.T) {
	var out, errBuf bytes.Buffer
	code := run([]string{"--unknown-flag"}, &out, &errBuf)
	if code != exitFail {
		t.Fatalf("exit = %d, want %d", code, exitFail)
	}
}

func TestRunHelpFlag(t *testing.T) {
	// `--help` 按惯例 exit 0（flag.ErrHelp 单独放行，2026-10-08 复核补）。
	// usage 文本实际由 flag 包写到 fs.Output()（未设时落 os.Stderr，不落在注入 buffer），
	// 故此处只硬断言退出码语义，不断言输出内容流。
	var out, errBuf bytes.Buffer
	code := run([]string{"--help"}, &out, &errBuf)
	if code != exitOK {
		t.Fatalf("exit = %d, want %d", code, exitOK)
	}
}

func TestRunIncludeTestsFlag(t *testing.T) {
	dir := writeFixture(t)
	// 额外放一个 _test.go：默认应跳过；--tests 时应扫到
	_ = os.WriteFile(filepath.Join(dir, "extra_test.go"), []byte("package fixture\nfunc testOnly() int { return 0 }\n"), 0o600)

	var out, errBuf bytes.Buffer
	code := run([]string{"--dir", dir, "--json"}, &out, &errBuf)
	if code != exitOK {
		t.Fatalf("exit = %d, want %d; stderr=%s", code, exitOK, errBuf.String())
	}
	var payload struct {
		Funcs int `json:"funcs"`
	}
	_ = json.Unmarshal(out.Bytes(), &payload)
	if payload.Funcs != 2 {
		t.Errorf("default funcs = %d, want 2 (skip _test.go)", payload.Funcs)
	}

	var out2, errBuf2 bytes.Buffer
	code = run([]string{"--dir", dir, "--tests", "--json"}, &out2, &errBuf2)
	if code != exitOK {
		t.Fatalf("exit = %d, want %d; stderr=%s", code, exitOK, errBuf2.String())
	}
	var payload2 struct {
		Funcs int `json:"funcs"`
	}
	_ = json.Unmarshal(out2.Bytes(), &payload2)
	if payload2.Funcs != 3 {
		t.Errorf("--tests funcs = %d, want 3 (include _test.go)", payload2.Funcs)
	}
}
