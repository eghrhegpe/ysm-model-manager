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
