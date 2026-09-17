package cli

// bench_serialize_measured_test.go — 「能测的不要估」：序列化载荷字节数为实测值（ADR-262 D2）。
//
// 原实现用 (几何估算 + 纹理估算) * 4/3 推算 IPC 载荷字节数，并注明「Base64 4/3 膨胀为历史假设」——
// 但 Base64 早已在 model.Textures 里，膨胀系数是多余假设。json.Marshal 是真实可测的，故直接取实测长度。

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"ysm-model-manager/go/types"
)

func TestSingleModelBench_SerializedPayloadMeasured(t *testing.T) {
	t.Parallel()
	dir := t.TempDir()
	modelPath := filepath.Join(dir, "m.ysm")
	if err := os.WriteFile(modelPath, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}

	stages := runSingleModelBench(&benchFakeApp{}, modelPath, dir)

	var serial *singleBenchStage
	for i := range stages {
		if stages[i].Name == "⑥ 序列化模拟" {
			serial = &stages[i]
			break
		}
	}
	if serial == nil {
		t.Fatalf("缺少 ⑥ 序列化模拟 阶段: %+v", stages)
	}

	// benchFakeApp.AnalyzeBedrockModel 返回固定模型 → 期望字节数可精确复算
	want, err := json.Marshal(types.BedrockModel{BoneCount: 1})
	if err != nil {
		t.Fatal(err)
	}
	if serial.Bytes != int64(len(want)) {
		t.Errorf("⑥ 字节数应为实测序列化长度 %d, got %d（估算会随 4/3 假设漂移）", len(want), serial.Bytes)
	}
	if !strings.Contains(serial.Notes, "实测") {
		t.Errorf("⑥ 的 note 应标明为实测载荷: %q", serial.Notes)
	}
	if strings.Contains(serial.Notes, "估算") {
		t.Errorf("⑥ 不应再自称估算: %q", serial.Notes)
	}
}
