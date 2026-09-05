// ===== parseModelFromEntries 白盒行为锁定测试（重构红线）=====
// 现有 L0/textSlot 测试全走公开 API ParseFromZip（黑盒），拿不到函数本体的
// 中间产物。本文件直接喂 []container.Entry 锁定私有函数 parseModelFromEntries
// 的第四返回元组 geoFiles（L0/L1 口径 + 排 arm + 声明序排序）与 SubModels，
// 作为「L0 子域收进 struct」重构前必须保持逐字节不变的判定锚点。
package geometry

import (
	"reflect"
	"strings"
	"testing"

	"ysm-model-manager/go/container"
	"ysm-model-manager/go/internal/testutil"
	"ysm-model-manager/go/types"
)

// openZipEntries 构造内存 zip 并返回其条目集合（喂给 parseModelFromEntries）。
func openZipEntries(t *testing.T, entries map[string]string) []container.Entry {
	t.Helper()
	data := testutil.MakeZipBytes(t, entries)
	reader, err := container.OpenZipBytes(data, int64(len(data)))
	if err != nil {
		t.Fatalf("OpenZipBytes 失败: %v", err)
	}
	return reader.Entries()
}

// geoFileBases 取 geoEntry 的 basename（去目录），便于断言顺序与排除。
func geoFileBases(gfs []geoEntry) []string {
	bases := make([]string, 0, len(gfs))
	for _, gf := range gfs {
		base := gf.name
		if i := strings.LastIndex(base, "/"); i >= 0 {
			base = base[i+1:]
		}
		bases = append(bases, base)
	}
	return bases
}

// subModelNames 取 SubModels 的 Name 序列（断言 L0/L1 来源与顺序）。
func subModelNames(sms []types.SubModel) []string {
	names := make([]string, 0, len(sms))
	for _, sm := range sms {
		names = append(names, sm.Name)
	}
	return names
}

// TestParseFromEntries_L0GeoFilesExcludesJunk：L0 生效时 geoFiles 只含清单引用的
// 模型，清单外的 junk.geo.json 必须被排除，且顺序按 manifest 声明序（reimu→marisa）。
func TestParseFromEntries_L0GeoFilesExcludesJunk(t *testing.T) {
	maidModel := `{
		"pack_name": "白盒红线 L0",
		"model": [
			{"name": "reimu",  "model": "models/reimu.geo.json",  "texture": "textures/reimu.png"},
			{"name": "marisa", "model": "models/marisa.geo.json", "texture": "textures/marisa.png"}
		]
	}`
	entries := openZipEntries(t, map[string]string{
		"assets/touhou/maid_model.json":        maidModel,
		"assets/touhou/models/reimu.geo.json":  maidMiniGeo("reimu", 0),
		"assets/touhou/models/marisa.geo.json": maidMiniGeo("marisa", 1),
		"assets/touhou/models/junk.geo.json":   maidMiniGeo("junk", 2), // 清单外，L0 应排除
		"assets/touhou/textures/reimu.png":     "REIMU",
		"assets/touhou/textures/marisa.png":    "MARISA",
	})

	geo, _, _, geoFiles := parseModelFromEntries(entries, "zip")
	if geo == nil {
		t.Fatal("模型不应为 nil")
	}
	if got, want := geoFileBases(geoFiles), []string{"reimu.geo.json", "marisa.geo.json"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("geoFiles = %v, 期望 %v（L0 生效应排除清单外 junk 且按声明序）", got, want)
	}
	if got, want := subModelNames(geo.SubModels), []string{"reimu", "marisa"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("SubModels = %v, 期望 %v", got, want)
	}
}

// TestParseFromEntries_L0EmptyHit_KeepL1GeoFiles：清单存在但声明条目路径全部未命中
// （len(l0GeoFiles)==0）。现状行为（红线）：
//   - geoFiles 覆盖判定 len(l0GeoFiles)>0 为假 → 回退，保留遍历收集的 L1 产物（x.geo.json）；
//   - 但 SubModels 分支只看 len(maidManifest)>0 → 仍按 manifest 派生 Name="declared"，
//     且因模型未解析到 resolvedPathByItem 无条目 → SourcePath 为空。
//
// 两处判定不对称是现状实现的事实，搬迁 L0 子域时不得"顺手统一"成不一致→一致，否则改行为。
func TestParseFromEntries_L0EmptyHit_KeepL1GeoFiles(t *testing.T) {
	// 清单声明 models/a.geo.json / textures/a.png，但 zip 里实际只有 models/x.geo.json
	maidModel := `{
		"pack_name": "白盒红线 L1 回退",
		"model": [
			{"name": "declared", "model": "models/a.geo.json", "texture": "textures/a.png"}
		]
	}`
	entries := openZipEntries(t, map[string]string{
		"assets/ns/maid_model.json":   maidModel,
		"assets/ns/models/x.geo.json": maidMiniGeo("x", 0),
	})

	geo, _, _, geoFiles := parseModelFromEntries(entries, "zip")
	if geo == nil {
		t.Fatal("模型不应为 nil")
	}
	// geoFiles 回退：保留 L1 全量收集
	if got := geoFileBases(geoFiles); !reflect.DeepEqual(got, []string{"x.geo.json"}) {
		t.Fatalf("geoFiles = %v, 期望 [x.geo.json]（L0 空命中回退保留 L1 收集）", got)
	}
	// SubModels 仍走 manifest 派生（不看命中），此为现状不对称行为
	if len(geo.SubModels) != 1 {
		t.Fatalf("SubModels = %d, 期望 1（manifest 派生，非 L1 兜底）", len(geo.SubModels))
	}
	if geo.SubModels[0].Name != "declared" {
		t.Fatalf("SubModels[0].Name = %q, 期望 %q（manifest 派生不看命中）", geo.SubModels[0].Name, "declared")
	}
	if geo.SubModels[0].SourcePath != "" {
		t.Fatalf("SubModels[0].SourcePath = %q, 期望空（模型未命中，resolvedPathByItem 无条目）", geo.SubModels[0].SourcePath)
	}
}
