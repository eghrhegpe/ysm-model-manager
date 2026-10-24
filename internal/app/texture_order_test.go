package app

import (
	"testing"

	"ysm-model-manager/internal/testutil"
)

// TestYsmTextureOrder_ArrayDeclaration 测试 ysm.json 数组形式的 texture 声明
func TestYsmTextureOrder_ArrayDeclaration(t *testing.T) {
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

	order, def := ysmTextureOrder(ysm)
	wantOrder := []string{"arrow", "default", "default2"}
	wantDef := "default"
	testutil.Equal(t, order, wantOrder, "ysmTextureOrder order")
	testutil.Equal(t, def, wantDef, "ysmTextureOrder def")
}

// TestYsmTextureOrder_StringDeclaration 测试 ysm.json 字符串形式的 texture 声明
func TestYsmTextureOrder_StringDeclaration(t *testing.T) {
	ysm := []byte(`{
  "spec": 2,
  "files": {
    "player": {
      "model": {"main": "main.json"},
      "texture": "single.png"
    }
  },
  "properties": {}
}`)

	order, def := ysmTextureOrder(ysm)
	// 单形态声明与数组声明共用 normTexPath 归一（去扩展名小写）——旧行为「保留完整
	// 文件名 single.png」会让 orderTexByYSM 的 rank（键 single.png）匹配不上收集纹理
	// （norm 后 single）→ 声明被静默吞掉回退尺寸序，而 TS 侧单形态包数组是归一的，
	// 两条解码路径分叉。2026-10-10 跨语言对账收口（本断言此前锁的是 bug）。
	wantOrder := []string{"single"}
	wantDef := ""
	testutil.Equal(t, order, wantOrder, "ysmTextureOrder order")
	testutil.Equal(t, def, wantDef, "ysmTextureOrder def")
}

// TestYsmTextureOrder_ObjectDeclaration 测试 ysm.json 对象形式的 texture 声明
func TestYsmTextureOrder_ObjectDeclaration(t *testing.T) {
	ysm := []byte(`{
  "spec": 2,
  "files": {
    "player": {
      "model": {"main": "main.json"},
      "texture": {"uv": "obj_tex", "path": "fallback.png"}
    }
  },
  "properties": {"default_texture": "obj_tex"}
}`)

	order, def := ysmTextureOrder(ysm)
	wantOrder := []string{"obj_tex"}
	wantDef := "obj_tex"
	testutil.Equal(t, order, wantOrder, "ysmTextureOrder order")
	testutil.Equal(t, def, wantDef, "ysmTextureOrder def")
}

// TestYsmTextureOrder_EmptyYSM 测试空 ysm.json
func TestYsmTextureOrder_EmptyYSM(t *testing.T) {
	order, def := ysmTextureOrder([]byte{})
	testutil.Nil(t, order, "空 ysm.json 应返回 nil order")
	testutil.Equal(t, def, "", "空 ysm.json 应返回空 def")
}

// TestYsmTextureOrder_InvalidJSON 测试无效 JSON
func TestYsmTextureOrder_InvalidJSON(t *testing.T) {
	order, def := ysmTextureOrder([]byte("{invalid"))
	testutil.Nil(t, order, "无效 JSON 应返回 nil order")
	testutil.Equal(t, def, "", "无效 JSON 应返回空 def")
}

// TestYsmTextureOrder_PathTrimming 测试路径去扩展名和目录
func TestYsmTextureOrder_PathTrimming(t *testing.T) {
	ysm := []byte(`{
  "files": {
    "player": {
      "model": {"main": "main.json"},
      "texture": ["textures/arrow.png", "subdir/default.jpg"]
    }
  }
}`)

	order, _ := ysmTextureOrder(ysm)
	wantOrder := []string{"arrow", "default"}
	testutil.Equal(t, order, wantOrder, "路径应去目录和扩展名")
}

// TestOrderTexByYSM_DefaultTextureMoveToFront 测试 default_texture 置首逻辑
func TestOrderTexByYSM_DefaultTextureMoveToFront(t *testing.T) {
	ysm := []byte(`{
  "spec": 2,
  "files": {
    "player": {
      "model": {"main": "main.json"},
      "texture": ["tex1.png", "tex2.png", "tex3.png"]
    }
  },
  "properties": {"default_texture": "tex2.png"}
}`)

	names := []string{"tex1", "tex2", "tex3"}
	data := []string{"d:1", "d:2", "d:3"}

	gotNames, gotData := orderTexByYSM(names, data, ysm)
	// default_texture (tex2) 应置首，其余按声明序
	wantNames := []string{"tex2", "tex1", "tex3"}
	wantData := []string{"d:2", "d:1", "d:3"}
	testutil.Equal(t, gotNames, wantNames, "default_texture 应置首")
	testutil.Equal(t, gotData, wantData, "data 同步错误")
}

// TestOrderTexByYSM_DefaultTextureAlreadyFirst 测试 default_texture 本身就在首位
func TestOrderTexByYSM_DefaultTextureAlreadyFirst(t *testing.T) {
	ysm := []byte(`{
  "files": {
    "player": {
      "model": {"main": "main.json"},
      "texture": ["first.png", "second.png"]
    }
  },
  "properties": {"default_texture": "first.png"}
}`)

	names := []string{"first", "second"}
	data := []string{"d:1", "d:2"}

	gotNames, gotData := orderTexByYSM(names, data, ysm)
	wantNames := []string{"first", "second"}
	wantData := []string{"d:1", "d:2"}
	testutil.Equal(t, gotNames, wantNames, "已在首位不应变序")
	testutil.Equal(t, gotData, wantData, "data 同步错误")
}

// TestOrderTexByYSM_DefaultTextureNotInDeclaration 测试 default_texture 不在声明序中
func TestOrderTexByYSM_DefaultTextureNotInDeclaration(t *testing.T) {
	ysm := []byte(`{
  "files": {
    "player": {
      "model": {"main": "main.json"},
      "texture": ["tex1.png", "tex2.png"]
    }
  },
  "properties": {"default_texture": "notdeclared.png"}
}`)

	names := []string{"tex1", "tex2"}
	data := []string{"d:1", "d:2"}

	gotNames, gotData := orderTexByYSM(names, data, ysm)
	// default_texture 不在声明序中 → 忽略，保持声明序
	wantNames := []string{"tex1", "tex2"}
	wantData := []string{"d:1", "d:2"}
	testutil.Equal(t, gotNames, wantNames, "未声明的 default_texture 被忽略")
	testutil.Equal(t, gotData, wantData, "data 同步错误")
}

// TestOrderTexByYSM_CaseInsensitiveBase 测试文件名大小写不敏感去扩展名
func TestOrderTexByYSM_CaseInsensitiveBase(t *testing.T) {
	ysm := []byte(`{
  "files": {
    "player": {
      "model": {"main": "main.json"},
      "texture": ["TEX.PNG", "tex.JPG"]
    }
  }
}`)

	names := []string{"tex", "tex"} // 同名不同扩展名
	data := []string{"d:1", "d:2"}

	gotNames, _ := orderTexByYSM(names, data, ysm)
	// 两者规范化后同名，第二个被去重（seen 机制）
	wantNames := []string{"tex"}
	testutil.Equal(t, gotNames, wantNames, "同名去重")
}
