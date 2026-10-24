// ===== 全量扫描条目 Type 派生测试（ADR-343 刀 1：ScanModelEntries 派生 Type）=====
// 判定单一事实源 = resource_types.json + Go 分类器（packs.DetectResourceType 三段：
// 嵌套模式 → location 消歧 → 内容指纹/扩展名裁决，占位 container/other 不猜）；
// 前端只读 Type 字段，不判定（回归红线）。
package app

import (
	"archive/zip"
	"os"
	"path/filepath"
	"testing"

	"ysm-model-manager/go/types"
	"ysm-model-manager/internal/testutil"
)

// writeTestZip 造一个内容受控的 zip（条目名 → 内容），返回路径
func writeTestZip(t *testing.T, dir, name string, entries map[string]string) string {
	t.Helper()
	p := filepath.Join(dir, name)
	f, err := os.Create(p)
	testutil.NoError(t, err, "create %s", name)
	defer f.Close()
	zw := zip.NewWriter(f)
	// map 迭代序随机——条目序对分类无影响（分类按内容匹配，不按序），不排序直接写
	for n, c := range entries {
		w, err := zw.Create(n)
		testutil.NoError(t, err, "zip create %s", n)
		_, err = w.Write([]byte(c))
		testutil.NoError(t, err, "zip write %s", n)
	}
	testutil.NoError(t, zw.Close(), "zip close %s", name)
	return p
}

func writeTextFile(t *testing.T, dir, name, content string) string {
	t.Helper()
	p := filepath.Join(dir, name)
	testutil.NoError(t, os.WriteFile(p, []byte(content), 0o644), "write %s", name)
	return p
}

// TestScanModelEntries_FillsType：全量扫描条目带 Type（刀 1 口径）：
// - 单声明者裸扩展名直判（.ysm→ysm / .nbt→blueprint / ysm.json→ysm）
// - 多声明者按 location 消歧（.pmx 落 3d-skin/EntityPlayer → EntityPlayer）
// - 多声明者无 location 锚 → 确定性裁决（.vmd 三声明者 priority 全 0 → id 升序 CustomAnim）
// - 容器按内容指纹（pack.mcmeta→resourcepack / ysm 条目→ysm / 未识别内容→container 占位）
func TestScanModelEntries_FillsType(t *testing.T) {
	base := t.TempDir()
	neutral := filepath.Join(base, "misc")
	testutil.NoError(t, os.MkdirAll(neutral, 0o755))
	epDir := filepath.Join(base, "3d-skin", "EntityPlayer")
	testutil.NoError(t, os.MkdirAll(epDir, 0o755))

	writeTextFile(t, neutral, "m.ysm", "data")
	writeTextFile(t, neutral, "blueprint.nbt", "data")
	writeTextFile(t, neutral, "ysm.json", "{}")
	writeTextFile(t, neutral, "loose.vmd", "data") // 无 location 锚的 .vmd
	writeTextFile(t, epDir, "e.pmx", "data")
	writeTestZip(t, neutral, "pack.zip", map[string]string{"pack.mcmeta": `{}`})
	writeTestZip(t, neutral, "ysmpack.zip", map[string]string{"ysm.json": `{}`, "models/main.json": `{}`})
	writeTestZip(t, neutral, "unk.zip", map[string]string{"readme.txt": "hi"})

	a := scanApp(t, types.AppConfig{FilesRoot: base})
	entries := a.ScanModelEntries(base)
	testutil.Equal(t, len(entries) == 0, false, "扫描应返回条目")
	byName := make(map[string]string, len(entries))
	for _, e := range entries {
		byName[filepath.Base(e.Path)] = e.Type
	}

	cases := map[string]string{
		"m.ysm":         "ysm",
		"blueprint.nbt": "blueprint",
		"ysm.json":      "ysm",
		"loose.vmd":     "CustomAnim", // 三声明者（CustomAnim/StageAnim/DefaultAnim）priority 平 → id 升序
		"e.pmx":         "EntityPlayer",
		"pack.zip":      "resourcepack",
		"ysmpack.zip":   "ysm",
		"unk.zip":       "container", // 内容未识别 → 诚实占位，不猜
	}
	for name, want := range cases {
		if got := byName[name]; got != want {
			t.Errorf("Type[%s] = %q，期望 %q（全部条目：%v）", name, got, want, byName)
		}
	}
}

// TestScanModelEntriesFiltered_TypeUnchangedByFill：Filtered 路径的 rtype 覆盖优先于
// 全量派生（e.Type = rtype 的既有语义不被刀 1 破坏）
func TestScanModelEntriesFiltered_TypeUnchangedByFill(t *testing.T) {
	base := t.TempDir()
	neutral := filepath.Join(base, "misc")
	testutil.NoError(t, os.MkdirAll(neutral, 0o755))
	writeTextFile(t, neutral, "m.ysm", "data")

	a := scanApp(t, types.AppConfig{FilesRoot: base})
	entries := a.ScanModelEntriesFiltered(base, "ysm", "", "标签")
	testutil.Equal(t, len(entries), 1, "Filtered(ysm) 应回 1 条")
	if entries[0].Type != "ysm" {
		t.Errorf("Filtered 路径 Type 应为 rtype（ysm），实际 %q", entries[0].Type)
	}
}
