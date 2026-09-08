package geometry

import (
	"strings"
	"testing"

	"ysm-model-manager/go/types"
)

// ===== 投射物/未声明组件 ComponentTextures 条目缺口实证 =====
// 背景：三叉戟灰定位——Go buildComponents 的 compTex 只在 texBase64 != "" 时填条目，
// 未声明纹理的组件（arm/arrow 等，modelOrder 无条目）即使同名纹理文件存在也**无条目**，
// 前端 componentTexMap.get(compName) 落空 → fallback 全局 texArr → 贴错/灰。

const armMiniJSON = `{"minecraft:geometry":[{"description":{"texture_width":64,"texture_height":64},"bones":[{"name":"arm","pivot":[0,0,0],"cubes":[{"origin":[0,0,0],"size":[2,2,2],"uv":[0,0]}]}]}]}`
const arrowMiniJSON = `{"minecraft:geometry":[{"description":{"texture_width":32,"texture_height":32},"bones":[{"name":"arrow","pivot":[0,0,0],"cubes":[{"origin":[0,0,0],"size":[1,1,1],"uv":[0,0]}]}]}]}`

// 声明了纹理的组件（projectiles arrow）→ compTex 有条目
func TestComponentTextures_Declared_HasEntry(t *testing.T) {
	data := makeZipWithFiles(t, map[string]string{
		"ysm.json":           `{"files":{"player":{"model":{"main":"models/main.json"},"texture":["textures/skin.png"]},"projectiles":{"minecraft:arrow":{"model":"models/arrow.json","texture":"textures/arrow.png"}}}}`,
		"models/main.json":   minimalMainJSON,
		"models/arrow.json":  arrowMiniJSON,
		"textures/skin.png":  tinyPNG(),
		"textures/arrow.png": tinyPNG(),
	})
	models, _, err := ParseComponentsFromZip(data, int64(len(data)))
	if err != nil {
		t.Fatalf("ParseComponentsFromZip: %v", err)
	}
	var arrowComp *types.BedrockModel
	for i := range models {
		if models[i].SourceName == "arrow" {
			arrowComp = &models[i]
			break
		}
	}
	if arrowComp == nil {
		t.Fatal("未找到 arrow 组件")
	}
	// arrow 声明了 textures/arrow.png → ComponentTextures["arrow"] 应有 base64 条目
	texs := arrowComp.ComponentTextures["arrow"]
	if len(texs) == 0 {
		t.Errorf("声明纹理的 arrow 组件应有 compTex 条目, 实际 %v", arrowComp.ComponentTextures)
	} else if !strings.HasPrefix(texs[0], "data:image/png;base64,") {
		t.Errorf("compTex[arrow][0] 应为 base64 data URI, 实际前 20 字符 %q", texs[0][:min(20, len(texs[0]))])
	}
}

// 未声明纹理但同名文件存在（arm.png）→ 兜底绑定（修复后：compTex 有条目）
func TestComponentTextures_Undeclared_SameNameFallback(t *testing.T) {
	data := makeZipWithFiles(t, map[string]string{
		// model 只声明 main；arm.json 存在但未声明 → arm 无声明纹理
		"ysm.json":          `{"files":{"player":{"model":{"main":"models/main.json"},"texture":["textures/skin.png"]}}}`,
		"models/main.json":  minimalMainJSON,
		"models/arm.json":   armMiniJSON,
		"textures/skin.png": tinyPNG(),
		"textures/arm.png":  tinyPNG(), // arm.png 存在：同名兜底应绑定
	})
	models, _, err := ParseComponentsFromZip(data, int64(len(data)))
	if err != nil {
		t.Fatalf("ParseComponentsFromZip: %v", err)
	}
	var armComp *types.BedrockModel
	for i := range models {
		if models[i].SourceName == "arm" {
			armComp = &models[i]
			break
		}
	}
	if armComp == nil {
		t.Fatal("未找到 arm 组件")
	}
	// arm 与 main 共用同一套 player.texture 皮肤（ModernYSM 权威，见 IsArmModelName 注释）：
	// arm 不走同名纹理兜底，不填 ComponentTextures，前端走全局 texArr[0]。
	// 即使 arm.png 存在，arm 也不会绑定它——arm 的纹理来自 main 的皮肤数组。
	if len(armComp.ComponentTextures) != 0 {
		t.Errorf("arm 不应填 ComponentTextures（与 main 共用皮肤）, 实际 %v", armComp.ComponentTextures)
	}
}

// 未声明纹理且同名文件不存在 → 不兜底（无条目，行为不变）
func TestComponentTextures_Undeclared_NoSameNameFile(t *testing.T) {
	data := makeZipWithFiles(t, map[string]string{
		"ysm.json":          `{"files":{"player":{"model":{"main":"models/main.json"},"texture":["textures/skin.png"]}}}`,
		"models/main.json":  minimalMainJSON,
		"models/arm.json":   armMiniJSON,
		"textures/skin.png": tinyPNG(),
	})
	models, _, err := ParseComponentsFromZip(data, int64(len(data)))
	if err != nil {
		t.Fatalf("ParseComponentsFromZip: %v", err)
	}
	var armComp *types.BedrockModel
	for i := range models {
		if models[i].SourceName == "arm" {
			armComp = &models[i]
			break
		}
	}
	if armComp == nil {
		t.Fatal("未找到 arm 组件")
	}
	// 无 arm.png → 兜底不触发 → 无条目（既有行为不变）
	if len(armComp.ComponentTextures["arm"]) != 0 {
		t.Errorf("无同名纹理文件不应兜底, 实际 %v", armComp.ComponentTextures)
	}
}
