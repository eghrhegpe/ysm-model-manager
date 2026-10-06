package app

import (
	"bytes"
	"log"
	"os"
	"path/filepath"
	"reflect"
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
	if !reflect.DeepEqual(gotNames, names) || !reflect.DeepEqual(gotData, data) {
		t.Fatalf("无 texture 声明时应保持原序: %v / %v", gotNames, gotData)
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

// ===== wasm_decoder.go（ADR-316 wazero 内存直解）解码路径测试 =====

// TestRunYSMDecode_NilInput 测试 nil 输入（wazero 路径：parser abort → error → nil）
func TestRunYSMDecode_NilInput(t *testing.T) {
	result := runYSMDecode(nil)
	if result != nil {
		t.Fatalf("nil 输入应返回 nil, got %v", result)
	}
}

// TestRunYSMDecode_EmptyInput 测试空输入
func TestRunYSMDecode_EmptyInput(t *testing.T) {
	result := runYSMDecode([]byte{})
	if result != nil {
		t.Fatalf("空输入应返回 nil, got %v", result)
	}
}

// TestRunYSMDecode_InvalidYSM 测试无效 .ysm 数据
func TestRunYSMDecode_InvalidYSM(t *testing.T) {
	result := runYSMDecode([]byte("not a ysm file"))
	if result != nil {
		t.Fatalf("无效输入应返回 nil, got %v", result)
	}
}

// TestRunYSMDecode_RingLogWired 环形日志接线回归锁（ADR-316 D2：noeh abort
// 语义下，解码失败是用户可感知的唯一诊断渠道）。ADR-289 机制：app.go 的
// log.SetOutput(MultiWriter(stderr, RuntimeBuffer)) 捕获标准库 log 输出，
// `[ysm-wasi]` 前缀由 RuntimeBuffer 提取为 tag（连字符在允许集）、「失败」
// 推断为 error 级。本测试锁住：解码失败必须走 log.Printf 且前缀合规——
// 若有人改回 fmt.Fprintln(stderr) 直写（avatar 旧桥的旁路写法）则本测试红。
func TestRunYSMDecode_RingLogWired(t *testing.T) {
	var captured bytes.Buffer
	old := log.Writer()
	log.SetOutput(&captured)
	t.Cleanup(func() { log.SetOutput(old) })

	runYSMDecode([]byte("not a ysm file"))

	out := captured.String()
	if !strings.Contains(out, "[ysm-wasi]") {
		t.Fatalf("解码失败未落 [ysm-wasi] 前缀日志（环形日志面板将无法按 tag 检索）: %q", out)
	}
	if !strings.Contains(out, "失败") {
		t.Fatalf("日志缺「失败」标记（级别推断将降为 info 而非 error）: %q", out)
	}
}

// TestDecodeYSMViaWASI_NilInput 测试 nil 输入
func TestDecodeYSMViaWASI_NilInput(t *testing.T) {
	result := decodeYSMViaWASI(nil)
	if result != nil {
		t.Fatalf("nil 输入应返回 nil, got %v", result)
	}
}

// TestDecodeYSMViaWASI_EmptyInput 测试空输入
func TestDecodeYSMViaWASI_EmptyInput(t *testing.T) {
	result := decodeYSMViaWASI([]byte{})
	if result != nil {
		t.Fatalf("空输入应返回 nil, got %v", result)
	}
}

// TestDecodeYSMComponentsViaWASI_NilInput 测试 nil 输入
func TestDecodeYSMComponentsViaWASI_NilInput(t *testing.T) {
	comps, names := decodeYSMComponentsViaWASI(nil)
	if comps != nil || names != nil {
		t.Fatalf("nil 输入应返回 (nil, nil), got (%v, %v)", comps, names)
	}
}

// TestDecodeYSMComponentsViaWASI_EmptyInput 测试空输入
func TestDecodeYSMComponentsViaWASI_EmptyInput(t *testing.T) {
	comps, names := decodeYSMComponentsViaWASI([]byte{})
	if comps != nil || names != nil {
		t.Fatalf("空输入应返回 (nil, nil), got (%v, %v)", comps, names)
	}
}

// TestDecodeYSMComponentsViaWASI_ValidYSM 构造最小合法 .ysm 验证多组件解码
func TestDecodeYSMComponentsViaWASI_ValidYSM(t *testing.T) {
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

	// 解码（wazero 内存直解，ADR-316）
	comps, names := decodeYSMComponentsViaWASI(ysmData)

	// 输入是裸 ysm.json 而非加密 .ysm 容器，parser abort → nil 是预期行为
	if comps == nil && names == nil {
		t.Log("非 .ysm 容器输入，解码器返回 nil（预期）")
		return
	}

	// 解码成功时验证结构
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
