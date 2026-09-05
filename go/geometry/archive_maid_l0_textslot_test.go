// ===== L0 texSlot 漂移修复回归测试（wine_fox 多组件 + maid L0 共存场景）=====
package geometry

import (
	"testing"

	"ysm-model-manager/internal/testutil"
)

// TestL0_TexSlot_SharedTexture 验证 L0 多角色包（共享纹理上下文）的 texSlot 绑定正确性。
// 场景：reimu/marisa/flandre 三个角色，各自的 texture 字段正确声明。
// 核心断言：每个角色的 cube.texSlot 对应其在 l0Pngs 中的位置。
func TestL0_TexSlot_SharedTexture(t *testing.T) {
	maidModel := `{
		"pack_name": "东方测试",
		"model": [
			{"name": "reimu",  "model": "models/reimu.geo.json",  "texture": "textures/reimu.png"},
			{"name": "marisa", "model": "models/marisa.geo.json", "texture": "textures/marisa.png"},
			{"name": "flandre","model": "models/flandre.geo.json","texture": "textures/flandre.png"}
		]
	}`
	data := testutil.MakeZipBytes(t, map[string]string{
		"assets/touhou/maid_model.json":         maidModel,
		"assets/touhou/models/reimu.geo.json":   maidMiniGeo("reimu", 0),
		"assets/touhou/models/marisa.geo.json":  maidMiniGeo("marisa", 1),
		"assets/touhou/models/flandre.geo.json": maidMiniGeo("flandre", 2),
		"assets/touhou/textures/reimu.png":      "REIMU",
		"assets/touhou/textures/marisa.png":     "MARISA",
		"assets/touhou/textures/flandre.png":    "FLANDRE",
	})
	model, pngs, _ := ParseFromZip(data, int64(len(data)))
	if model == nil {
		t.Fatal("模型不应为 nil")
	}
	if len(model.SubModels) != 3 {
		t.Fatalf("SubModels = %d, 期望 3", len(model.SubModels))
	}
	// texSlot 应等于对应纹理在 l0Pngs 中的排序位置
	wantSlots := map[string]int{"reimu": 0, "marisa": 1, "flandre": 2}
	for _, sm := range model.SubModels {
		want, ok := wantSlots[sm.Name]
		if !ok {
			t.Errorf("未知角色 %q", sm.Name)
			continue
		}
		if sm.TexSlot != want {
			t.Errorf("角色 %s TexSlot = %d, 期望 %d", sm.Name, sm.TexSlot, want)
		}
	}
	if len(pngs) != 3 {
		t.Errorf("pngs = %d, 期望 3", len(pngs))
	}
}

// TestL0_TexSlot_ModelIdInfer 验证 model_id 形式（TLM 原生）的 texSlot 绑定。
// 清单只有 model_id 没有显式 model/texture 路径，靠推断拿到文件。
func TestL0_TexSlot_ModelIdInfer(t *testing.T) {
	maidModel := `{
		"pack_name": "model_id 推断测试",
		"model_list": [
			{"model_id": "mypack:hero",    "name": "勇者"},
			{"model_id": "mypack:heroine", "name": "女主角"}
		]
	}`
	data := testutil.MakeZipBytes(t, map[string]string{
		"assets/mypack/maid_model.json":             maidModel,
		"assets/mypack/models/entity/hero.json":     maidMiniGeo("hero", 0),
		"assets/mypack/models/entity/heroine.json":  maidMiniGeo("heroine", 1),
		"assets/mypack/textures/entity/hero.png":    "HERO",
		"assets/mypack/textures/entity/heroine.png": "HEROINE",
	})
	model, _, _ := ParseFromZip(data, int64(len(data)))
	if model == nil {
		t.Fatal("模型不应为 nil")
	}
	if len(model.SubModels) != 2 {
		t.Fatalf("SubModels = %d, 期望 2", len(model.SubModels))
	}
	// model_id 推断时 texture 也靠候选路径字典，两个角色各有一套独立纹理
	// hero → textures/entity/hero.png → pngs[0], heroine → textures/entity/heroine.png → pngs[1]
	wantSlots := map[string]int{"勇者": 0, "女主角": 1}
	for _, sm := range model.SubModels {
		want, ok := wantSlots[sm.Name]
		if !ok {
			t.Errorf("未知角色 %q", sm.Name)
			continue
		}
		if sm.TexSlot != want {
			t.Errorf("角色 %s TexSlot = %d, 期望 %d", sm.Name, sm.TexSlot, want)
		}
	}
}

// TestL0_TexSlot_MissingTexture_NoPanic 验证 texture 字段缺失时不 panic、不崩溃。
func TestL0_TexSlot_MissingTexture_NoPanic(t *testing.T) {
	maidModel := `{
		"pack_name": "缺纹理测试",
		"model": [
			{"name": "a", "model": "models/a.geo.json"},
			{"name": "b", "model": "models/b.geo.json", "texture": "textures/b.png"}
		]
	}`
	data := testutil.MakeZipBytes(t, map[string]string{
		"assets/ns/maid_model.json":   maidModel,
		"assets/ns/models/a.geo.json": maidMiniGeo("a", 0),
		"assets/ns/models/b.geo.json": maidMiniGeo("b", 1),
		"assets/ns/textures/b.png":    "B-PNG",
	})
	model, _, _ := ParseFromZip(data, int64(len(data)))
	if model == nil {
		t.Fatal("模型不应为 nil")
	}
	if len(model.SubModels) != 2 {
		t.Fatalf("SubModels = %d, 期望 2", len(model.SubModels))
	}
	// a 没有 texture 声明 → texNameByItem 无 a 的 key → TexSlot 用默认值 0
	// b 有 texture 声明 → TexSlot = orderMap["b"] = 0（仅 1 张 png）
	for _, sm := range model.SubModels {
		if sm.TexSlot < 0 || sm.TexSlot >= len(model.TextureNames) {
			t.Errorf("角色 %s TexSlot=%d 越界（pngs=%d）", sm.Name, sm.TexSlot, len(model.TextureNames))
		}
	}
}

// TestL0_TexSlot_MixedCaseEntries 验证：zip 条目名含大写（Windows 工具产物，本仓其他
// 注释反复防御的混合大小写场景）时，L0 路径的纹理收集与 texSlot 绑定不受大小写断裂影响。
// 回归（code review 7efe6aa9）：
//   - resolveL0Texture 形式 B 候选分支返回 e.Name()（原始大小写），但 entryByPath 的 key
//     全小写 → 主循环 entryByPath[texAbs] 重查 miss → 纹理静默丢弃；
//   - l0ModelOrder 小写化（modelAbs[len(maidNs):]），但 orderMap/texIdxMap 查询键用
//     geoFiles[i].name（原始大小写）→ miss → cube TexSlot 不绑定（全 0）。
//
// fixture 刻意让两个 cube 都 texture=0（不烘焙槽位）：若 texIdxMap 重绑（geoName ToLower）
// 失效，cube.TexSlot 保持解析值 0/0，heroine 断言 1 必失败——真实暴露绑定路径回归；
// 若烘焙 texture=0/1 会与期望槽位恰好一致，掩盖绑定失效（code review 补强）。
func TestL0_TexSlot_MixedCaseEntries(t *testing.T) {
	maidModel := `{
		"pack_name": "大小写混合条目测试",
		"model": [
			{"model_id": "mypack:hero",    "name": "勇者"},
			{"model_id": "mypack:heroine", "name": "女主角"}
		]
	}`
	// 模型/纹理条目名含大写（Windows 工具产出 zip 的常见形态）
	data := testutil.MakeZipBytes(t, map[string]string{
		"assets/mypack/maid_model.json":             maidModel,
		"assets/mypack/Models/Entity/Hero.json":     maidMiniGeo("hero", 0),
		"assets/mypack/Models/Entity/Heroine.json":  maidMiniGeo("heroine", 0),
		"assets/mypack/Textures/Entity/Hero.png":    "HERO",
		"assets/mypack/Textures/Entity/Heroine.png": "HEROINE",
	})
	model, pngs, _ := ParseFromZip(data, int64(len(data)))
	if model == nil {
		t.Fatal("模型不应为 nil")
	}
	if len(model.SubModels) != 2 {
		t.Fatalf("SubModels = %d, 期望 2", len(model.SubModels))
	}
	// 纹理不得静默丢失（resolveL0Texture 候选分支大小写断裂 → entryByPath miss）
	if len(pngs) != 2 {
		t.Fatalf("pngs = %d, 期望 2（大小写混合条目纹理不得丢失）", len(pngs))
	}
	// texSlot 必须正确绑定（l0ModelOrder 小写 vs geoFiles.name 原始大小写断裂 → 全 0）
	wantSlots := map[string]int{"勇者": 0, "女主角": 1}
	for _, sm := range model.SubModels {
		want, ok := wantSlots[sm.Name]
		if !ok {
			t.Errorf("未知角色 %q", sm.Name)
			continue
		}
		if sm.TexSlot != want {
			t.Errorf("角色 %s TexSlot = %d, 期望 %d（大小写断裂致 texSlot 绑定失效）", sm.Name, sm.TexSlot, want)
		}
	}
	// cube 级 TexSlot 断言：geoName ToLower / texIdxMap 重绑（archive.go 918-925）的真实守护点。
	// geoFiles 按 modelOrder 排序后 hero 在前、heroine 在后（各 1 骨骼 1 方块）。
	if len(model.Bones) != 2 {
		t.Fatalf("Bones = %d, 期望 2（hero + heroine）", len(model.Bones))
	}
	wantCubeSlots := []int{0, 1} // hero → 0, heroine → 1（texOrder 位置）
	for bi, want := range wantCubeSlots {
		cubes := model.Bones[bi].Cubes
		if len(cubes) == 0 {
			t.Fatalf("Bones[%d] 无 cube", bi)
		}
		if cubes[0].TexSlot != want {
			t.Errorf("Bones[%d].Cubes[0].TexSlot = %d, 期望 %d（texIdxMap 重绑失效）", bi, cubes[0].TexSlot, want)
		}
	}
}
