// ===== 第一人称手臂模型 arm.json 排除测试（ZIP 路径）=====
package geometry

import "testing"

// TestParseFromZip_ExcludesArm 验证 ZIP 解析时排除 arm.json：
// arm.json 是第一人称手臂模型，与 main.json 的手臂重叠，合并会渲染出两对手臂。
func TestParseFromZip_ExcludesArm(t *testing.T) {
	ysmJSON := `{
	  "files": {
	    "player": {
	      "model": {"main": "models/main.json", "arm": "models/arm.json"},
	      "texture": ["tex1.png"]
	    }
	  }
	}`
	armJSON := `{"format_version":"1.16.0","minecraft:geometry":[{"description":{"identifier":"arm","texture_width":64,"texture_height":64},"bones":[{"name":"LeftArm","cubes":[{"origin":[2,10,2],"size":[4,12,4],"uv":[0,0]}]}]}]}`
	pngData := string(makePngData(t, "tex1"))
	data := makeZipBytes(t, map[string]string{
		"ysm.json":         ysmJSON,
		"models/main.json": validGeoJSON, // 含 head 骨骼
		"models/arm.json":  armJSON,
		"tex1.png":         pngData,
	})
	model, _, _ := ParseFromZip(data, int64(len(data)))
	if model == nil {
		t.Fatal("模型应为非 nil")
	}
	if model.BoneCount != 1 {
		t.Errorf("BoneCount = %d, 期望 1（仅 main.json 的 head）", model.BoneCount)
	}
	for _, b := range model.Bones {
		if b.Name == "LeftArm" {
			t.Errorf("arm.json 的 LeftArm 不应出现在合并结果中（第一人称手臂须排除）")
		}
	}
}

// TestIsArmModelName 覆盖 isArmModelName 判定规则
func TestIsArmModelName(t *testing.T) {
	cases := []struct {
		name string
		want bool
	}{
		{"models/arm.json", true},
		{"arm.geo.json", true},
		{"arm.json", true},
		{"models/main.json", false},
		{"models/arrow.json", false},
		{"fp.arm.animation.json", false},
		{"models/arm.json.bak", false},
	}
	for _, c := range cases {
		if got := isArmModelName(c.name); got != c.want {
			t.Errorf("isArmModelName(%q) = %v, want %v", c.name, got, c.want)
		}
	}
}
