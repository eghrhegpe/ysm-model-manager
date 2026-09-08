// TestFindGeometryInExtractedYSM_ExcludesArm 验证解压目录加载时排除 arm.json
package ysm

import (
	"os"
	"path/filepath"
	"testing"
)

func TestFindGeometryInExtractedYSM_ExcludesArm(t *testing.T) {
	dir := t.TempDir()
	modelsDir := filepath.Join(dir, "models")
	if err := os.MkdirAll(modelsDir, 0755); err != nil {
		t.Fatal(err)
	}
	ysmJSON := `{
	  "files": {
	    "player": {
	      "model": {"main": "models/main.json", "arm": "models/arm.json"}
	    }
	  }
	}`
	mainJSON := `{"format_version":"1.16.0","minecraft:geometry":[{"description":{"identifier":"main","texture_width":64,"texture_height":64},"bones":[{"name":"head","cubes":[{"origin":[0,0,0],"size":[8,8,8],"uv":[0,0]}]}]}]}`
	armJSON := `{"format_version":"1.16.0","minecraft:geometry":[{"description":{"identifier":"arm","texture_width":64,"texture_height":64},"bones":[{"name":"LeftArm","cubes":[{"origin":[2,10,2],"size":[4,12,4],"uv":[0,0]}]}]}]}`
	if err := os.WriteFile(filepath.Join(dir, "ysm.json"), []byte(ysmJSON), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(modelsDir, "main.json"), []byte(mainJSON), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(modelsDir, "arm.json"), []byte(armJSON), 0644); err != nil {
		t.Fatal(err)
	}

	model, err := FindGeometryInExtractedYSM(filepath.Join(dir, "ysm.json"))
	if err != nil {
		t.Fatalf("FindGeometryInExtractedYSM 失败: %v", err)
	}
	if model == nil {
		t.Fatal("模型应为非 nil")
	}
	for _, b := range model.Bones {
		if b.Name == "LeftArm" {
			t.Error("arm 骨骼不应出现在结果中（第一人称手臂须排除）")
		}
	}
}

// TestFindGeometryInExtractedYSM_ArmMissing 验证 arm.json 缺失时仍正常加载 main
func TestFindGeometryInExtractedYSM_ArmMissing(t *testing.T) {
	dir := t.TempDir()
	modelsDir := filepath.Join(dir, "models")
	if err := os.MkdirAll(modelsDir, 0755); err != nil {
		t.Fatal(err)
	}
	ysmJSON := `{"files":{"player":{"model":{"main":"models/main.json","arm":"models/arm.json"}}}}`
	mainJSON := `{"format_version":"1.16.0","minecraft:geometry":[{"description":{"identifier":"main","texture_width":64,"texture_height":64},"bones":[{"name":"head","cubes":[{"origin":[0,0,0],"size":[8,8,8],"uv":[0,0]}]}]}]}`
	if err := os.WriteFile(filepath.Join(dir, "ysm.json"), []byte(ysmJSON), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(modelsDir, "main.json"), []byte(mainJSON), 0644); err != nil {
		t.Fatal(err)
	}
	// arm.json 故意不创建

	model, err := FindGeometryInExtractedYSM(filepath.Join(dir, "ysm.json"))
	if err != nil {
		t.Fatalf("FindGeometryInExtractedYSM 失败: %v", err)
	}
	if model == nil {
		t.Fatal("模型应为非 nil（main.json 应正常加载）")
	}
	if len(model.Bones) != 1 || model.Bones[0].Name != "head" {
		t.Errorf("应仅加载 main 骨骼，得到 %v", model.Bones)
	}
}

// TestFindGeometryInExtractedYSM_MainInvalidFallback 验证 main.json 无效时走 fallback 链
func TestFindGeometryInExtractedYSM_MainInvalidFallback(t *testing.T) {
	dir := t.TempDir()
	modelsDir := filepath.Join(dir, "models")
	if err := os.MkdirAll(modelsDir, 0755); err != nil {
		t.Fatal(err)
	}
	ysmJSON := `{"files":{"player":{"model":{"main":"models/main.json","arm":"models/arm.json"}}}}`
	// main.json 是无效几何（缺 format_version）
	mainJSON := `{"invalid":"geometry"}`
	if err := os.WriteFile(filepath.Join(dir, "ysm.json"), []byte(ysmJSON), 0644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(modelsDir, "main.json"), []byte(mainJSON), 0644); err != nil {
		t.Fatal(err)
	}

	model, _ := FindGeometryInExtractedYSM(filepath.Join(dir, "ysm.json"))
	// main.json 无效 → fallback 链（ysm.json 自身/包裹/WalkDir/裸）尝试解析
	// 此用例验证不会 panic，返回 nil 表示 fallback 也未命中
	if model != nil && len(model.Bones) > 0 {
		t.Logf("fallback 命中: %d 骨骼", len(model.Bones))
	}
}

// TestParseMeta_EnclosingSizePartial 验证 EnclosingSize 缺子字段时的行为
// 注：此测试属于 litematic 包，移至 go/litematic/litematic_test.go
func _TestParseMeta_EnclosingSizePartial_Skip(t *testing.T) {
	// 跳过：跨包调用不允许
	t.Skip("此测试属于 litematic 包")
}
