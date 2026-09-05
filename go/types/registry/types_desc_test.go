// ===== go/types 补充单测 =====
package types

import (
	"encoding/json"
	"testing"
)

// ====== descString ======

func TestDescString_String(t *testing.T) {
	raw := json.RawMessage(`"简单的描述文本"`)
	result := descString(raw)
	if result != "简单的描述文本" {
		t.Errorf("期望 '简单的描述文本', 得到 %q", result)
	}
}

func TestDescString_Object(t *testing.T) {
	raw := json.RawMessage(`{"text":"带格式的描述","color":"red"}`)
	result := descString(raw)
	if result != "带格式的描述" {
		t.Errorf("期望 '带格式的描述', 得到 %q", result)
	}
}

func TestDescString_Array(t *testing.T) {
	raw := json.RawMessage(`[{"text":"第一段","color":"red"},{"text":"第二段"}]`)
	result := descString(raw)
	if result != "第一段第二段" {
		t.Errorf("期望 '第一段第二段', 得到 %q", result)
	}
}

func TestDescString_ArrayWithExtra(t *testing.T) {
	raw := json.RawMessage(`[{"text":"A","extra":[{"text":"B"},{"text":"C"}]}]`)
	result := descString(raw)
	if result != "ABC" {
		t.Errorf("期望 'ABC', 得到 %q", result)
	}
}

func TestDescString_Empty(t *testing.T) {
	result := descString(nil)
	if result != "" {
		t.Errorf("空输入应返回空字符串, 得到 %q", result)
	}
}

func TestDescString_InvalidJSON(t *testing.T) {
	raw := json.RawMessage(`{invalid}`)
	result := descString(raw)
	if result != "" {
		t.Errorf("非法 JSON 应返回空, 得到 %q", result)
	}
}

func TestDescString_Number(t *testing.T) {
	raw := json.RawMessage(`42`)
	result := descString(raw)
	if result != "" {
		t.Errorf("数字类型应返回空, 得到 %q", result)
	}
}

// ====== Desc ======

func TestDesc_String(t *testing.T) {
	pm := &PackMeta{}
	pm.Pack.Description = json.RawMessage(`"desc string"`)
	result := pm.Desc()
	if result != "desc string" {
		t.Errorf("期望 'desc string', 得到 %q", result)
	}
}

func TestDesc_Object(t *testing.T) {
	pm := &PackMeta{}
	pm.Pack.Description = json.RawMessage(`{"text":"object desc"}`)
	result := pm.Desc()
	if result != "object desc" {
		t.Errorf("期望 'object desc', 得到 %q", result)
	}
}

func TestDesc_Empty(t *testing.T) {
	pm := &PackMeta{}
	result := pm.Desc()
	if result != "" {
		t.Errorf("空描述应返回空, 得到 %q", result)
	}
}

// ====== SetRegistryPath ======

func TestSetRegistryPath(t *testing.T) {
	// 先确保 registry 已加载
	_ = LoadRegistry()

	// 设置新路径
	SetRegistryPath("/tmp/test-path.json")

	if registryPath != "/tmp/test-path.json" {
		t.Errorf("registryPath = %q, 期望 /tmp/test-path.json", registryPath)
	}
	if registry != nil {
		t.Error("SetRegistryPath 后 registry 应为 nil")
	}
	// 恢复（避免影响其他测试）
	SetRegistryPath("")
}
