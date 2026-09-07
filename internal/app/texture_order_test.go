package app

import (
	"reflect"
	"testing"
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
	if !reflect.DeepEqual(order, wantOrder) {
		t.Fatalf("ysmTextureOrder order = %v, want %v", order, wantOrder)
	}
	if def != wantDef {
		t.Fatalf("ysmTextureOrder def = %q, want %q", def, wantDef)
	}
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
	// 字符串声明时保留完整文件名（不去扩展名，数组声明时才去扩展名）
	wantOrder := []string{"single.png"}
	wantDef := ""
	if !reflect.DeepEqual(order, wantOrder) {
		t.Fatalf("ysmTextureOrder order = %v, want %v", order, wantOrder)
	}
	if def != wantDef {
		t.Fatalf("ysmTextureOrder def = %q, want %q", def, wantDef)
	}
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
	if !reflect.DeepEqual(order, wantOrder) {
		t.Fatalf("ysmTextureOrder order = %v, want %v", order, wantOrder)
	}
	if def != wantDef {
		t.Fatalf("ysmTextureOrder def = %q, want %q", def, wantDef)
	}
}

// TestYsmTextureOrder_EmptyYSM 测试空 ysm.json
func TestYsmTextureOrder_EmptyYSM(t *testing.T) {
	order, def := ysmTextureOrder([]byte{})
	if order != nil || def != "" {
		t.Fatalf("空 ysm.json 应返回 (nil, \"\"), got (%v, %q)", order, def)
	}
}

// TestYsmTextureOrder_InvalidJSON 测试无效 JSON
func TestYsmTextureOrder_InvalidJSON(t *testing.T) {
	order, def := ysmTextureOrder([]byte("{invalid"))
	if order != nil || def != "" {
		t.Fatalf("无效 JSON 应返回 (nil, \"\"), got (%v, %q)", order, def)
	}
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
	if !reflect.DeepEqual(order, wantOrder) {
		t.Fatalf("路径应去目录和扩展名: got %v, want %v", order, wantOrder)
	}
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
	if !reflect.DeepEqual(gotNames, wantNames) {
		t.Fatalf("default_texture 应置首: got %v, want %v", gotNames, wantNames)
	}
	if !reflect.DeepEqual(gotData, wantData) {
		t.Fatalf("data 同步错误: got %v, want %v", gotData, wantData)
	}
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
	if !reflect.DeepEqual(gotNames, wantNames) {
		t.Fatalf("已在首位不应变序: got %v, want %v", gotNames, wantNames)
	}
	if !reflect.DeepEqual(gotData, wantData) {
		t.Fatalf("data 同步错误: got %v, want %v", gotData, wantData)
	}
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
	if !reflect.DeepEqual(gotNames, wantNames) {
		t.Fatalf("未声明的 default_texture 被忽略: got %v, want %v", gotNames, wantNames)
	}
	if !reflect.DeepEqual(gotData, wantData) {
		t.Fatalf("data 同步错误: got %v, want %v", gotData, wantData)
	}
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
	if !reflect.DeepEqual(gotNames, wantNames) {
		t.Fatalf("同名去重: got %v, want %v", gotNames, wantNames)
	}
}
