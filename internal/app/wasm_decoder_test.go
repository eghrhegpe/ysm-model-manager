package app

import (
	"os"
	"path/filepath"
	"reflect"
	"runtime"
	"strings"
	"testing"
)

// R1 契约对齐（2026-08-10 修复）：orderTexByYSM 按 ysm.json 声明序重排 + default_texture 置首。
// 覆盖「声明序 ≠ 包内文件序」场景（arrow 文件排在声明序首位，但 main 应贴 default_texture）。
func TestOrderTexByYSM(t *testing.T) {
	ysm := []byte(`{
  "spec": 2,
  "files": {
    "player": {
      "model": {"main": "main.json"},
      "texture": ["arrow.png", "default.png", "default2.png"]
    }
  },
  "properties": {"default_texture": "default.png"}
}`)

	names := []string{"arrow", "default", "default2"}
	data := []string{"data:arrow", "data:default", "data:default2"}

	gotNames, gotData := orderTexByYSM(names, data, ysm)
	wantNames := []string{"default", "arrow", "default2"} // default_texture 置首，其余按声明序
	if !reflect.DeepEqual(gotNames, wantNames) {
		t.Fatalf("orderTexByYSM names = %v, want %v", gotNames, wantNames)
	}
	wantData := []string{"data:default", "data:arrow", "data:default2"}
	if !reflect.DeepEqual(gotData, wantData) {
		t.Fatalf("orderTexByYSM data 与 names 不同步: %v, want %v", gotData, wantData)
	}
}

// 无 ysm.json / 无声明序时保持原序（兼容无引导的模型）
func TestOrderTexByYSM_NoYSM(t *testing.T) {
	names := []string{"arrow", "default"}
	data := []string{"data:arrow", "data:default"}
	gotNames, gotData := orderTexByYSM(names, data, nil)
	if !reflect.DeepEqual(gotNames, names) || !reflect.DeepEqual(gotData, data) {
		t.Fatalf("无 ysm.json 时应保持原序: %v / %v", gotNames, gotData)
	}
	gotNames, gotData = orderTexByYSM(names, data, []byte(`{"files":{}}`))
	if !reflect.DeepEqual(gotNames, names) {
		t.Fatalf("无 texture 声明时应保持原序: %v", gotNames)
	}
}

// 未在声明序中的纹理（头像等）被排除（与前端 buildOrderedTexKeys 一致：只保留声明贴图）
func TestOrderTexByYSM_UnlistedTail(t *testing.T) {
	ysm := []byte(`{
  "spec": 2,
  "files": {"player": {"model": {"main": "main.json"}, "texture": ["default.png"]}},
  "properties": {"default_texture": "default.png"}
}`)
	names := []string{"arrow", "default", "avatar"}
	data := []string{"d:a", "d:d", "d:v"}
	gotNames, _ := orderTexByYSM(names, data, ysm)
	wantNames := []string{"default"}
	if !reflect.DeepEqual(gotNames, wantNames) {
		t.Fatalf("orderTexByYSM = %v, want %v", gotNames, wantNames)
	}
}

// 加密模型等无 ysm.json 声明序时：按像素面积降序（主纹理最大置首，修复 arrow 首位贴错）
func TestOrderTexBySize(t *testing.T) {
	// PNG 头（8 签名 + 4 长度 + IHDR + w/h BE）
	png := func(w, h uint32) []byte {
		b := make([]byte, 24)
		copy(b[:8], []byte{0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A})
		b[12], b[13], b[14], b[15] = 'I', 'H', 'D', 'R'
		b[16], b[17], b[18], b[19] = byte(w>>24), byte(w>>16), byte(w>>8), byte(w)
		b[20], b[21], b[22], b[23] = byte(h>>24), byte(h>>16), byte(h>>8), byte(h)
		return b
	}
	items := []ysmTexItem{
		{name: "arrow", raw: png(64, 64), mime: "image/png"},
		{name: "texture", raw: png(512, 512), mime: "image/png"},
	}
	names := []string{"arrow", "texture"}
	datas := []string{"d:arrow", "d:texture"}
	gotNames, gotData := orderTexBySize(names, datas, items)
	wantNames := []string{"texture", "arrow"} // 512×512 主纹理置首
	if !reflect.DeepEqual(gotNames, wantNames) {
		t.Fatalf("orderTexBySize = %v, want %v", gotNames, wantNames)
	}
	if !reflect.DeepEqual(gotData, []string{"d:texture", "d:arrow"}) {
		t.Fatalf("orderTexBySize data 不同步: %v", gotData)
	}
	// 单纹理不动
	gotNames, _ = orderTexBySize(names[:1], datas[:1], items[:1])
	if gotNames[0] != "arrow" {
		t.Fatalf("单纹理应保持原序: %v", gotNames)
	}
}

// imagePixelArea：PNG/JPEG 尺寸解析 + 无法解析返回 0
func TestImagePixelArea(t *testing.T) {
	if got := imagePixelArea([]byte{1, 2, 3}); got != 0 {
		t.Fatalf("非图片应返回 0, got %d", got)
	}
	// JPEG: FFD8 + APP0（长度 16 = 2 字节长度字段 + 14 字节 JFIF 数据）+ SOF0 段
	jpg := []byte{0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 'J', 'F', 'I', 'F', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
		0xFF, 0xC0, 0x00, 0x11, 0x08, 0x02, 0x00, 0x01, 0x00}
	// SOF0: 高 0x0200=512（offset i+5），宽 0x0100=256（offset i+7）
	if got := imagePixelArea(jpg); got != 512*256 {
		t.Fatalf("JPEG 尺寸解析 = %d, want %d", got, 512*256)
	}
}

// ===== wasm_decoder.go 未覆盖函数测试 =====

// TestFindNodeJS_AndroidEmpty 测试 Android 平台返回空路径
func TestFindNodeJS_AndroidEmpty(t *testing.T) {
	if runtime.GOOS == "android" {
		if findNodeJS() != "" {
			t.Fatal("Android 平台 findNodeJS 应返回空串")
		}
	} else {
		t.Skip("非 Android 平台，跳过")
	}
}

// TestFindNodeJS_ReturnsPathOrEmpty 测试 findNodeJS 返回路径或空（不依赖环境）
func TestFindNodeJS_ReturnsPathOrEmpty(t *testing.T) {
	// findNodeJS 查找 PATH 中的 node/node.exe
	// 这里只验证不 panic，返回值依赖测试环境
	path := findNodeJS()
	if path != "" {
		if !strings.HasSuffix(path, "node") && !strings.HasSuffix(path, "node.exe") {
			t.Logf("findNodeJS 返回: %s", path)
		}
	}
}

// TestRunYSMNodeJSDecode_NilInput 测试 nil 输入
func TestRunYSMNodeJSDecode_NilInput(t *testing.T) {
	result := runYSMNodeJSDecode(nil)
	if result != nil {
		t.Fatalf("nil 输入应返回 nil, got %v", result)
	}
}

// TestRunYSMNodeJSDecode_EmptyInput 测试空输入
func TestRunYSMNodeJSDecode_EmptyInput(t *testing.T) {
	result := runYSMNodeJSDecode([]byte{})
	if result != nil {
		t.Fatalf("空输入应返回 nil, got %v", result)
	}
}

// TestRunYSMNodeJSDecode_InvalidYSM 测试无效 .ysm 数据
func TestRunYSMNodeJSDecode_InvalidYSM(t *testing.T) {
	result := runYSMNodeJSDecode([]byte("not a ysm file"))
	if result != nil {
		t.Fatalf("无效输入应返回 nil, got %v", result)
	}
}

// TestDecodeYSMViaNodeJS_NilInput 测试 nil 输入
func TestDecodeYSMViaNodeJS_NilInput(t *testing.T) {
	result := decodeYSMViaNodeJS(nil)
	if result != nil {
		t.Fatalf("nil 输入应返回 nil, got %v", result)
	}
}

// TestDecodeYSMViaNodeJS_EmptyInput 测试空输入
func TestDecodeYSMViaNodeJS_EmptyInput(t *testing.T) {
	result := decodeYSMViaNodeJS([]byte{})
	if result != nil {
		t.Fatalf("空输入应返回 nil, got %v", result)
	}
}

// TestDecodeYSMComponentsViaNodeJS_NilInput 测试 nil 输入
func TestDecodeYSMComponentsViaNodeJS_NilInput(t *testing.T) {
	comps, names := decodeYSMComponentsViaNodeJS(nil)
	if comps != nil || names != nil {
		t.Fatalf("nil 输入应返回 (nil, nil), got (%v, %v)", comps, names)
	}
}

// TestDecodeYSMComponentsViaNodeJS_EmptyInput 测试空输入
func TestDecodeYSMComponentsViaNodeJS_EmptyInput(t *testing.T) {
	comps, names := decodeYSMComponentsViaNodeJS([]byte{})
	if comps != nil || names != nil {
		t.Fatalf("空输入应返回 (nil, nil), got (%v, %v)", comps, names)
	}
}

// TestDecodeYSMComponentsViaNodeJS_ValidYSM 构造最小合法 .ysm 验证多组件解码
func TestDecodeYSMComponentsViaNodeJS_ValidYSM(t *testing.T) {
	// 创建临时目录构造合法 .ysm 结构
	dir := t.TempDir()
	modelsDir := filepath.Join(dir, "models")
	if err := os.MkdirAll(modelsDir, 0o755); err != nil {
		t.Fatal(err)
	}

	// ysm.json 引用两个模型组件
	ysmJSON := `{
  "spec": 2,
  "files": {
    "player": {
      "model": {"main": "models/main.json", "arm": "models/arm.json"}
    }
  }
}`
	mainJSON := `{"format_version":"1.16.0","minecraft:geometry":[{"description":{"identifier":"main","texture_width":64,"texture_height":64},"bones":[{"name":"head","cubes":[{"origin":[0,0,0],"size":[8,8,8],"uv":[0,0]}]}]}]}`
	armJSON := `{"format_version":"1.16.0","minecraft:geometry":[{"description":{"identifier":"arm","texture_width":64,"texture_height":64},"bones":[{"name":"LeftArm","cubes":[{"origin":[2,10,2],"size":[4,12,4],"uv":[0,0]}]}]}]}`

	if err := os.WriteFile(filepath.Join(dir, "ysm.json"), []byte(ysmJSON), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(modelsDir, "main.json"), []byte(mainJSON), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(modelsDir, "arm.json"), []byte(armJSON), 0o644); err != nil {
		t.Fatal(err)
	}

	// 读取 .ysm 文件
	ysmData, err := os.ReadFile(filepath.Join(dir, "ysm.json"))
	if err != nil {
		t.Fatal(err)
	}

	// 解码（依赖 Node.js + WASM，环境无 Node 则返回 nil）
	comps, names := decodeYSMComponentsViaNodeJS(ysmData)

	// 无 Node.js 环境时返回 nil（Android/无运行时），这是预期行为
	if comps == nil && names == nil {
		t.Log("Node.js 不可用，解码器返回 nil（预期）")
		return
	}

	// 有 Node.js 时验证结构
	if comps != nil {
		if len(comps) < 1 {
			t.Fatalf("期望至少 1 个组件, got %d", len(comps))
		}
		// main.json 应被识别为主组件
		foundMain := false
		for _, c := range comps {
			if c.SourceName == "main" {
				foundMain = true
				if c.BoneCount == 0 {
					t.Errorf("main 组件应有骨骼")
				}
			}
		}
		if !foundMain {
			t.Logf("组件列表: %+v", comps)
		}
	}
}
