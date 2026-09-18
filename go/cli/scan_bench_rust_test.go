//go:build rust_backend

package cli

// scan_bench_rust_test.go — `-tags rust_backend` 构建下的真 Rust 对照断言。
//
// 默认构建（stub）测不到这条路径：`scanEntriesWithRust` 是空实现，Rust 那一栏恒「未采集」。
// CI 的 rust_backend 作业（.github/workflows/test.yml「Rust 桥 DLL + rust_backend Go 测试」）
// 跑本文件——它才是「Go / Rust 对照真的能对起来」的证据。

import (
	"encoding/json"
	"path/filepath"
	"testing"

	"ysm-model-manager/go/scanner"
)

func TestRunScanBench_RustBackendMeasuresBothEngines(t *testing.T) {
	if scanner.ScanBackend != "rust" {
		t.Fatalf("本构建应为 rust 后端, got %q", scanner.ScanBackend)
	}
	root := filepath.Join("..", "..", "tests", "fixtures", "ysm")
	ctx := &CmdContext{FilesRoot: root, Args: []string{"--iterations", "2", "--format", "json"}}

	var err error
	out := captureOutput(t, func() { err = runScanBench(ctx) })
	if err != nil {
		t.Fatalf("scan-bench 报错: %v", err)
	}
	var payload scanBenchJSON
	if err := json.Unmarshal([]byte(out), &payload); err != nil {
		t.Fatalf("stdout 不是纯 JSON: %v\n%s", err, out)
	}

	goEngine, rustEngine := payload.Engines[0], payload.Engines[1]
	for _, e := range []scanBenchEngineJSON{goEngine, rustEngine} {
		if !e.Used {
			t.Fatalf("rust_backend 构建下两端都应实测到（%s: %+v）", e.Engine, e)
		}
		if len(e.RunsMs) != 2 || e.Entries == 0 {
			t.Errorf("%s 应有 2 次样本与条目数: %+v", e.Engine, e)
		}
		if e.Skipped != 0 {
			t.Errorf("逐次前已失效缓存，不该有跳过样本: %+v", e)
		}
	}
	if !payload.Parity.Comparable || !payload.Parity.Match {
		t.Errorf("两端同 fixture 必须逐条一致: %+v", payload.Parity)
	}
	if goEngine.Entries != rustEngine.Entries {
		t.Errorf("条目数应一致: go=%d rust=%d", goEngine.Entries, rustEngine.Entries)
	}
}

func TestBuildScanBenchPayload_ForceGoIsPureGo(t *testing.T) {
	// 强制开关下量到的必须是 Go walk（不得被 Rust 快路径截胡），否则「对照」的 Go 端不纯。
	root := filepath.Join("..", "..", "tests", "fixtures", "ysm")
	eng, entries := measureScanEngine(root, "go", 1)
	if !eng.Used || len(entries) == 0 {
		t.Fatalf("强制 Go 应量到结果: %+v", eng)
	}
	if scanner.ForceGoEngine() {
		t.Error("量完后开关必须复位（不得给生产留下残留状态）")
	}
}
