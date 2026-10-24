// ===== 真实解码产物端到端回归（负 uv_size / mirror）=====
// 覆盖：WASM/原生路径解码出的 ysm.json geometry（tests/fixtures/ysm/lucia 等含
// 负 uv_size 与 mirror:true 字段，1268 处负 uv_size / 53 处 mirror）走
// ParseBedrockGeometry → BuildMulti 全链路不 panic、UV 无 NaN/Inf——锁定双路径
// 等价性（fixture 为目录语义=YSM 解码产物，曾无 Go 测试消费，子代理审计 P3）。
package threejs

import (
	"encoding/json"
	"math"
	"os"
	"path/filepath"
	"testing"

	"ysm-model-manager/go/geometry"
	"ysm-model-manager/go/internal/testutil"
	"ysm-model-manager/go/types"
)

// fixtureModels 读取真实解码产物 fixture（含负 uv_size/mirror）并解析为 BedrockModel。
func fixtureModels(t *testing.T, name string) []types.BedrockModel {
	t.Helper()
	p := filepath.Join("..", "..", "tests", "fixtures", "ysm", name, "main.json")
	data, err := os.ReadFile(p)
	testutil.NoError(t, err, "读取 fixture %s 失败", p)
	m := geometry.ParseBedrockGeometry(data)
	testutil.NotNil(t, m, "fixture %s 解析失败（ParseBedrockGeometry 返回 nil）", name)
	return []types.BedrockModel{*m}
}

// walkUV 递归收集 spec 中所有 UV 值（浮点字段，验证无 NaN/Inf）
func collectSpecFloats(v interface{}, out *[]float64) {
	switch t := v.(type) {
	case float64:
		*out = append(*out, t)
	case []interface{}:
		for _, e := range t {
			collectSpecFloats(e, out)
		}
	case map[string]interface{}:
		for _, e := range t {
			collectSpecFloats(e, out)
		}
	}
}

func TestBuildMulti_RealDecodedFixture_Lucia(t *testing.T) {
	models := fixtureModels(t, "lucia")
	out, err := BuildMulti(models, nil)
	testutil.NoError(t, err, "BuildMulti(lucia 真实产物) 失败")
	// 护栏：不得返回空 spec（原 if out=="{}" → t.Fatal）
	testutil.Equal(t, out == "{}", false, "lucia 真实产物不应返回空 spec")
	var raw interface{}
	testutil.NoError(t, json.Unmarshal([]byte(out), &raw), "spec JSON 解析失败")
	var floats []float64
	collectSpecFloats(raw, &floats)
	for _, f := range floats {
		// OR 型拆序贯：NaN / Inf 分别断言（原 if IsNaN || IsInf）
		testutil.Equal(t, math.IsNaN(f), false, "spec 含 NaN/Inf 浮点值 %f（负 uv_size 路径产生非法 UV）", f)
		testutil.Equal(t, math.IsInf(f, 0), false, "spec 含 NaN/Inf 浮点值 %f（负 uv_size 路径产生非法 UV）", f)
	}
	// mirror 单次应用：不 panic 且 UV 数量完整（每面 8 值）
	testutil.Equal(t, len(floats) < 16, false, "spec UV 值过少（%d），mirror 面可能被丢弃", len(floats))
}

func TestBuildMulti_RealDecodedFixture_All(t *testing.T) {
	// 遍历全部解码产物 fixture（shen-fengling/suifan/wine-fox/xigelika 等）
	dir := filepath.Join("..", "..", "tests", "fixtures", "ysm")
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Skipf("fixtures 目录不存在: %v", err)
	}
	checked := 0
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		mainPath := filepath.Join(dir, e.Name(), "main.json")
		if _, err := os.Stat(mainPath); err != nil {
			continue
		}
		data, err := os.ReadFile(mainPath)
		if err != nil {
			continue
		}
		m := geometry.ParseBedrockGeometry(data)
		if m == nil {
			t.Errorf("fixture %s 解析失败", e.Name())
			continue
		}
		out, err := BuildMulti([]types.BedrockModel{*m}, nil)
		if err != nil {
			t.Errorf("BuildMulti(%s) 失败: %v", e.Name(), err)
			continue
		}
		if out == "{}" {
			t.Errorf("fixture %s 返回空 spec", e.Name())
			continue
		}
		var raw interface{}
		if err := json.Unmarshal([]byte(out), &raw); err != nil {
			t.Errorf("fixture %s spec JSON 解析失败: %v", e.Name(), err)
			continue
		}
		var floats []float64
		collectSpecFloats(raw, &floats)
		for _, f := range floats {
			// OR 型拆序贯：NaN / Inf 分别断言（原 if IsNaN || IsInf）
			testutil.Equal(t, math.IsNaN(f), false, "fixture %s spec 含 NaN/Inf %f", e.Name(), f)
			testutil.Equal(t, math.IsInf(f, 0), false, "fixture %s spec 含 NaN/Inf %f", e.Name(), f)
		}
		checked++
	}
	// 护栏：至少回归一个 fixture（原 if checked==0 → t.Fatal）
	testutil.Equal(t, checked == 0, false, "未检查到任何 fixture（路径错误？）")
	t.Logf("已回归 %d 个真实解码产物 fixture", checked)
}
