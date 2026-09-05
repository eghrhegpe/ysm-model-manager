// ===== health-report 命令薄壳测试 =====
// 覆盖：参数校验 / 空仓库体检 / 坏模型扣分 / 去重维度汇总 / --output JSON。
// 策略：与 cli_test.go 一致——零值 &app.App{} + 临时目录，不触碰真实用户配置。
package cli

import (
	"ysm-model-manager/go/internal/testutil"

	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"ysm-model-manager/internal/app"
)

func TestHealthReport_RequiresDir(t *testing.T) {
	err := runHealthReport(&CmdContext{App: &app.App{}, Args: nil})
	if err == nil || !strings.Contains(err.Error(), "--dir") {
		t.Errorf("缺 --dir/FilesRoot 应报错, got: %v", err)
	}
}

func TestHealthReport_EmptyDir(t *testing.T) {
	dir := t.TempDir()
	out := captureOutput(t, func() {
		if err := runHealthReport(&CmdContext{App: &app.App{}, FilesRoot: dir, Args: nil}); err != nil {
			t.Fatalf("空仓库应成功, got %v", err)
		}
	})
	if !strings.Contains(out, "健康体检") {
		t.Errorf("输出应含健康分数, got: %s", out)
	}
	if !strings.Contains(out, "去重") {
		t.Errorf("输出应含去重维度, got: %s", out)
	}
}

func TestHealthReport_BadModelLowersScore(t *testing.T) {
	dir := t.TempDir()
	// 一个残缺 .ysm（非 JSON）→ 完整性扣分
	testutil.WriteTestFileBytes(t, filepath.Join(dir, "broken.ysm"), []byte("this is not json"))

	good := t.TempDir()
	// 好模型须通过 isModelFileValid 加严校验（合法 JSON + format_version）
	testutil.WriteTestFileBytes(t, filepath.Join(good, "ok.ysm"), []byte(`{"format_version": "1.8.0", "name": "ok"}`))

	badOut := captureOutput(t, func() {
		if err := runHealthReport(&CmdContext{App: &app.App{}, FilesRoot: dir, Args: []string{"--dir", dir}}); err != nil {
			t.Fatalf("坏模型体检应成功, got %v", err)
		}
	})
	goodOut := captureOutput(t, func() {
		if err := runHealthReport(&CmdContext{App: &app.App{}, FilesRoot: good, Args: []string{"--dir", good}}); err != nil {
			t.Fatalf("好模型体检应成功, got %v", err)
		}
	})
	if strings.Contains(badOut, "无效 0") {
		t.Errorf("坏模型应报告无效>0, got: %s", badOut)
	}
	if !strings.Contains(goodOut, "无效 0") {
		t.Errorf("好模型应零无效, got: %s", goodOut)
	}
}

func TestHealthReport_ReportsDuplicates(t *testing.T) {
	dir := t.TempDir()
	testutil.WriteTestFileBytes(t, filepath.Join(dir, "a.ysm"), []byte("dup content"))
	testutil.WriteTestFileBytes(t, filepath.Join(dir, "b.ysm"), []byte("dup content"))

	out := captureOutput(t, func() {
		if err := runHealthReport(&CmdContext{App: &app.App{}, FilesRoot: dir, Args: []string{"--dir", dir}}); err != nil {
			t.Fatalf("体检应成功, got %v", err)
		}
	})
	if !strings.Contains(out, "组重复") || !strings.Contains(out, "多余 1 个文件") {
		t.Errorf("应报告去重维度 1 组 1 多余, got: %s", out)
	}
}

// --output 写 JSON 且字段完整（去重/完整性/分数都在），写盘后不刷屏全量报告
func TestHealthReport_OutputJSON(t *testing.T) {
	dir := t.TempDir()
	testutil.WriteTestFileBytes(t, filepath.Join(dir, "a.ysm"), []byte("dup content"))
	testutil.WriteTestFileBytes(t, filepath.Join(dir, "b.ysm"), []byte("dup content"))
	outFile := filepath.Join(dir, "health.json")

	out := captureOutput(t, func() {
		if err := runHealthReport(&CmdContext{App: &app.App{}, FilesRoot: dir, Args: []string{"--dir", dir, "--output", outFile}}); err != nil {
			t.Fatalf("--output 应成功, got %v", err)
		}
	})
	if !strings.Contains(out, "已保存到") {
		t.Errorf("应打印保存提示, got: %s", out)
	}
	if strings.Contains(out, "健康体检") || strings.Contains(out, "完整性") || strings.Contains(out, "去重:") {
		t.Errorf("--output 写盘后不应刷屏全量报告, got: %s", out)
	}

	data, err := os.ReadFile(outFile)
	if err != nil {
		t.Fatalf("读取 JSON 失败: %v", err)
	}
	var hr healthReportJSON
	if err := json.Unmarshal(data, &hr); err != nil {
		t.Fatalf("JSON 解析失败: %v", err)
	}
	if hr.Score <= 0 || hr.Score > 100 {
		t.Errorf("分数应在 1-100, got %d", hr.Score)
	}
	if hr.Dedup.Groups != 1 || hr.Dedup.ExtraFiles != 1 {
		t.Errorf("去重维度应为 1 组 1 多余, got %+v", hr.Dedup)
	}
	if hr.Completeness.Checked != 2 {
		t.Errorf("完整性应检查 2 个 ysm, got %d", hr.Completeness.Checked)
	}
}
