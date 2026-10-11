// ===== readTexFrom7z 真解压 7z 纹理尺寸提取测试（texsize.go:117）=====
// 复用 go/geometry/testdata/ 下预生成 7z 夹具（7-Zip CLI -mx=0 存储模式，见
// go/geometry/archive_7z_test.go 的 load7zFixture 惯例）：readTexFrom7z 直接
// 遍历 7z 条目找 geometry JSON，与 zip 路径行为对齐。
// 覆盖：正常命中（含 ysm.json 按名跳过、无 geometry 条目跳过）、无 ysm.json、
// map/str/badmap/invalid 变体、非 7z / 截断 7z、超大条目上限（ADR-044 策略 A，
// 运行时用 7-Zip CLI 生成 51MB 条目，CLI 缺失时跳过）。
package ysm

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"ysm-model-manager/go/internal/testutil"
)

// fixture7zPath 返回 geometry 包 testdata 下 7z 夹具的路径（相对 go/ysm 包目录）
func fixture7zPath(t *testing.T, name string) string {
	t.Helper()
	p := filepath.Join("..", "geometry", "testdata", name)
	if _, err := os.Stat(p); err != nil {
		t.Skipf("7z 夹具不存在: %s", p)
	}
	return p
}

// find7zBin 定位 7-Zip CLI（运行时生成 7z 夹具用），找不到返回空串
func find7zBin() string {
	for _, c := range []string{
		"C:/Program Files/7-Zip/7z.exe",
		"C:/Program Files (x86)/7-Zip/7z.exe",
		"C:\\Program Files\\7-Zip\\7z.exe",
	} {
		if _, err := os.Stat(c); err == nil {
			return c
		}
	}
	if p, err := exec.LookPath("7z"); err == nil {
		return p
	}
	return ""
}

// generateTest7z 用 7-Zip CLI（-mx=0 存储模式，与 testdata 预生成同法）在 dir 下
// 按 files 顺序打包生成 7z，返回归档路径；CLI 缺失或生成失败时跳过测试。
// 条目顺序即 sevenzip 遍历顺序（readTexFrom7z 首个命中即返回）。
func generateTest7z(t *testing.T, dir, name string, files []string) string {
	t.Helper()
	bin := find7zBin()
	if bin == "" {
		t.Skip("未找到 7-Zip CLI，跳过运行时生成 7z 的测试")
	}
	cmd := exec.Command(bin, append([]string{"a", "-mx=0", "-bd", name}, files...)...)
	cmd.Dir = dir
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Skipf("7-Zip 生成 7z 失败（环境限制）: %v %s", err, out)
	}
	return filepath.Join(dir, name)
}

func TestReadTexFrom7z_Full(t *testing.T) {
	// 完整 7z：首个命中条目是 arm.geo.json（32x32）——animations_idle.json
	// 无 minecraft:geometry 跳过，ysm.json 按名（含 ysm.json）跳过，arrow.png 非 json 跳过
	w, h := readTexFrom7z(fixture7zPath(t, "7z_full.7z"))
	if w != 32 || h != 32 {
		t.Errorf("期望 32x32（arm.geo.json 首命中）, 得到 %dx%d", w, h)
	}
}

func TestReadTexFrom7z_Map(t *testing.T) {
	// map 格式 ysm.json：readTexFrom7z 不解析 ysm.json，直接扫几何 → main.geo.json 64x32
	w, h := readTexFrom7z(fixture7zPath(t, "7z_map.7z"))
	if w != 64 || h != 32 {
		t.Errorf("期望 64x32, 得到 %dx%d", w, h)
	}
}

func TestReadTexFrom7z_Str(t *testing.T) {
	// 单字符串格式 ysm.json → main.geo.json 64x32
	w, h := readTexFrom7z(fixture7zPath(t, "7z_str.7z"))
	if w != 64 || h != 32 {
		t.Errorf("期望 64x32, 得到 %dx%d", w, h)
	}
}

func TestReadTexFrom7z_NoYsm(t *testing.T) {
	// 无 ysm.json 的 7z（仅几何 + 纹理）→ 几何扫描仍命中 main.geo.json
	w, h := readTexFrom7z(fixture7zPath(t, "7z_noym.7z"))
	if w != 64 || h != 32 {
		t.Errorf("期望 64x32, 得到 %dx%d", w, h)
	}
}

func TestReadTexFrom7z_Badmap(t *testing.T) {
	// ysm.json model 值为数字（畸形）不影响几何直接扫描 → main.geo.json 64x32
	w, h := readTexFrom7z(fixture7zPath(t, "7z_badmap.7z"))
	if w != 64 || h != 32 {
		t.Errorf("期望 64x32, 得到 %dx%d", w, h)
	}
}

func TestReadTexFrom7z_InvalidYsm(t *testing.T) {
	// ysm.json 内容非法 JSON → 按名跳过；main.geo.json 仍有效 → 64x32
	w, h := readTexFrom7z(fixture7zPath(t, "7z_invalid.7z"))
	if w != 64 || h != 32 {
		t.Errorf("期望 64x32, 得到 %dx%d", w, h)
	}
}

func TestReadTexFrom7z_Subdir(t *testing.T) {
	// 子目录条目 sub/main.geo.json 首命中（64x32）；sub/extra.geo.json 16x16 靠后
	w, h := readTexFrom7z(fixture7zPath(t, "7z_obj.7z"))
	if w != 64 || h != 32 {
		t.Errorf("期望 64x32, 得到 %dx%d", w, h)
	}
}

func TestReadTexFrom7z_Not7z(t *testing.T) {
	// 非 7z 内容 → OpenReader 报错 → 0,0
	path := filepath.Join(t.TempDir(), "model.7z")
	if err := os.WriteFile(path, []byte("not a real 7z archive"), 0644); err != nil {
		testutil.NoError(t, err)
	}
	w, h := readTexFrom7z(path)
	if w != 0 || h != 0 {
		t.Errorf("非 7z 应返回 0,0, 得到 %dx%d", w, h)
	}
}

func TestReadTexFrom7z_Truncated7z(t *testing.T) {
	// 合法 7z 截断为一半 → 主 header 读取失败 → 0,0（不 panic）
	data, err := os.ReadFile(fixture7zPath(t, "7z_full.7z"))
	testutil.NoError(t, err)
	path := filepath.Join(t.TempDir(), "trunc.7z")
	if err := os.WriteFile(path, data[:len(data)/2], 0644); err != nil {
		testutil.NoError(t, err)
	}
	w, h := readTexFrom7z(path)
	if w != 0 || h != 0 {
		t.Errorf("截断 7z 应返回 0,0, 得到 %dx%d", w, h)
	}
}

func TestReadTexFrom7z_OversizedEntry(t *testing.T) {
	// 超大条目（>50MB）触发 ReadLimitedEntry 截断防线（ADR-044 策略 A，50MB/条目）：
	// 条目跳过继续遍历，最终命中后续小几何 JSON。
	dir := t.TempDir()
	// 51MB 合法几何 JSON（空格填充）——若未触发上限会返回 999x888
	hugeJSON := `{"minecraft:geometry":[{"description":{"texture_width":999,"texture_height":888}}]}`
	pad := 51<<20 - len(hugeJSON)
	if pad <= 0 {
		t.Fatal("超大条目构造失败")
	}
	bigPath := filepath.Join(dir, "huge.json")
	if err := os.WriteFile(bigPath, []byte(hugeJSON+strings.Repeat(" ", pad)), 0644); err != nil {
		testutil.NoError(t, err)
	}
	smallPath := filepath.Join(dir, "small.geo.json")
	smallJSON := `{"minecraft:geometry":[{"description":{"texture_width":64,"texture_height":32},"bones":[{"name":"s","cubes":[]}]}]}`
	if err := os.WriteFile(smallPath, []byte(smallJSON), 0644); err != nil {
		testutil.NoError(t, err)
	}
	// 条目顺序：huge.json 在前，验证超大条目被跳过而非返回 999x888
	archive := generateTest7z(t, dir, "oversize.7z", []string{"huge.json", "small.geo.json"})
	w, h := readTexFrom7z(archive)
	if w != 64 || h != 32 {
		t.Errorf("超大条目应被跳过并命中 small.geo.json 64x32, 得到 %dx%d", w, h)
	}
}

func TestReadTexFrom7z_SkipNonJsonAndYsmJson(t *testing.T) {
	// 非 .json（tex1.png）与含 ysm.json 的条目（ysm.json）在首个几何命中前被跳过，
	// 继续遍历 → 命中 main.geo.json 64x32（7z_full 等夹具中 ysm.json 排在几何之后，
	// 此场景只能运行时构造）。
	dir := t.TempDir()
	for f, content := range map[string]string{
		"tex1.png":      "PNG",
		"ysm.json":      `{"files":{}}`,
		"main.geo.json": `{"minecraft:geometry":[{"description":{"texture_width":64,"texture_height":32},"bones":[]}]}`,
	} {
		if err := os.WriteFile(filepath.Join(dir, f), []byte(content), 0644); err != nil {
			testutil.NoError(t, err)
		}
	}
	archive := generateTest7z(t, dir, "skip.7z", []string{"tex1.png", "ysm.json", "main.geo.json"})
	w, h := readTexFrom7z(archive)
	if w != 64 || h != 32 {
		t.Errorf("跳过非几何条目后应命中 main.geo.json 64x32, 得到 %dx%d", w, h)
	}
}

func TestReadTexFrom7z_NoGeometryFound(t *testing.T) {
	// 全部 .json 条目均无 geometry（data.json 无 minecraft:geometry，ysm.json 按名跳过）
	// → 循环结束返回 0,0（走完遍历的兜底分支）。
	dir := t.TempDir()
	for f, content := range map[string]string{
		"tex1.png":  "PNG",
		"ysm.json":  `{"files":{}}`,
		"data.json": `{"format_version":"1.8.0","animations":{}}`,
	} {
		if err := os.WriteFile(filepath.Join(dir, f), []byte(content), 0644); err != nil {
			testutil.NoError(t, err)
		}
	}
	archive := generateTest7z(t, dir, "nogeo.7z", []string{"tex1.png", "ysm.json", "data.json"})
	w, h := readTexFrom7z(archive)
	if w != 0 || h != 0 {
		t.Errorf("无 geometry 的 7z 应返回 0,0, 得到 %dx%d", w, h)
	}
}
